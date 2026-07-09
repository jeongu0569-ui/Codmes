import fs from "node:fs/promises";
import { exec, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { fileKind, joinWorkspacePath, resolveWorkspacePath } from "./path-utils.mjs";
import { searchWorkspace } from "./search-service.mjs";
const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".swiftpm",
  "DerivedData"
]);

const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".swift", ".go", ".rs", ".java", ".c", ".cc", ".cpp", ".h", ".hpp",
  ".cs", ".rb", ".php", ".html", ".css", ".json", ".yaml", ".yml", ".toml",
  ".sh", ".ps1", ".md", ".txt", ".xml", ".sql"
]);

const PATCH_CONTENT_LIMIT = 2 * 1024 * 1024;

export class CodeAgentRuntime {
  constructor({ workspaceRoot, stateStore, llmRuntime }) {
    this.workspaceRoot = workspaceRoot;
    this.state = stateStore;
    this.llmRuntime = llmRuntime;
  }

  async inspectTask(params = {}) {
    const instruction = requireInstruction(params.instruction || params.message);
    const scope = this.resolveCodeScope(params.scopePath || "Code");
    const task = await this.state.startTask({
      type: "code",
      adapter: "code-runtime",
      message: instruction,
      scopePath: scope.relativePath,
      accessMode: params.accessMode || "confirm",
      requestedAction: "inspect"
    });

    try {
      await this.state.recordToolLog({
        type: "code.inspect.start",
        taskId: task.id,
        scopePath: scope.relativePath,
        instruction
      });
      const inspection = await this.inspectProject(scope, params);
      const search = await this.searchProject(scope, instruction, params);
      const git = await this.inspectGit(scope.absolutePath);
      const plan = this.buildInitialPlan({ instruction, scope, inspection, search, git });
      const diffRef = await this.state.writeDiff(task.id, git.diff || "");
      const decision = await this.state.recordDecision({
        type: "code.inspect.plan",
        taskId: task.id,
        scopePath: scope.relativePath,
        summary: plan.summary,
        nextStep: plan.steps[0]?.title
      });
      const updated = await this.state.finishTask(task.id, {
        status: "inspected",
        scopePath: scope.relativePath,
        inspection,
        search,
        git: {
          isRepository: git.isRepository,
          root: git.root,
          status: git.status,
          diffStat: git.diffStat,
          diffRef
        },
        plan,
        taskMemory: buildInspectTaskMemory({ inspection, search, plan }),
        decisionRef: decision.path
      });
      await this.state.recordToolLog({
        type: "code.inspect.complete",
        taskId: task.id,
        scopePath: scope.relativePath,
        fileCount: inspection.fileCount,
        relevantResultCount: search.resultCount
      });
      return {
        ok: true,
        engine: "workspace-agent",
        runtime: "code-agent",
        taskId: task.id,
        status: updated.status,
        scopePath: scope.relativePath,
        summary: plan.summary,
        inspection,
        search,
        git: updated.git,
        plan,
        taskMemory: updated.taskMemory
      };
    } catch (error) {
      await this.state.finishTask(task.id, {
        status: "failed",
        error: error?.message || "Code task failed."
      });
      await this.state.recordToolLog({
        type: "code.inspect.failed",
        taskId: task.id,
        scopePath: scope.relativePath,
        error: error?.message || "Code task failed."
      });
      throw error;
    }
  }

  async runChecks(taskId, params = {}) {
    if (params.approved !== true) {
      throw Object.assign(new Error("Code task check execution requires approved: true."), { status: 428 });
    }
    const task = await this.state.readTask(requireTaskId(taskId));
    if (task.type !== "code") {
      throw Object.assign(new Error("Only code tasks can run code checks."), { status: 400 });
    }
    const scope = this.resolveCodeScope(task.scopePath || params.scopePath || "Code");
    const commands = resolveCheckCommands(task, params);
    if (!commands.length) {
      throw Object.assign(new Error("No check commands were provided or detected."), { status: 400 });
    }
    await this.state.recordToolLog({
      type: "code.checks.start",
      taskId: task.id,
      scopePath: scope.relativePath,
      commands
    });
    const startedAt = new Date().toISOString();
    const results = [];
    for (const command of commands) {
      const result = await runShellCommand(scope.absolutePath, command, params);
      results.push(result);
      await this.state.recordToolLog({
        type: "code.check.command",
        taskId: task.id,
        scopePath: scope.relativePath,
        command,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        ok: result.ok
      });
    }
    const finishedAt = new Date().toISOString();
    const allPassed = results.every((result) => result.ok);
    const checkRun = {
      id: `check-${Date.now()}`,
      approved: true,
      startedAt,
      finishedAt,
      scopePath: scope.relativePath,
      commands,
      allPassed,
      results
    };
    const checks = [...(Array.isArray(task.checks) ? task.checks : []), checkRun];
    const git = await this.inspectGit(scope.absolutePath);
    const diffRef = await this.state.writeDiff(task.id, git.diff || "");
    const taskMemory = updateTaskMemoryForChecks(task.taskMemory, checkRun, allPassed, task.plan);
    const updated = await this.state.finishTask(task.id, {
      status: allPassed ? "checked" : "check_failed",
      checks,
      taskMemory,
      git: {
        ...(task.git || {}),
        isRepository: git.isRepository,
        root: git.root,
        status: git.status,
        diffStat: git.diffStat,
        diffRef
      }
    });
    await this.state.recordDecision({
      type: "code.checks.result",
      taskId: task.id,
      scopePath: scope.relativePath,
      summary: allPassed ? "All code checks passed." : "One or more code checks failed.",
      commands: commands.join("; ")
    });
    await this.state.recordToolLog({
      type: "code.checks.complete",
      taskId: task.id,
      scopePath: scope.relativePath,
      allPassed
    });
    if (params.approvalId) {
      await this.state.resolveApproval(params.approvalId, {
        approved: true,
        response: {
          taskId: task.id,
          checkRunId: checkRun.id,
          allPassed,
          commands
        }
      });
    }
    return {
      ok: allPassed,
      engine: "workspace-agent",
      runtime: "code-agent",
      taskId: task.id,
      status: updated.status,
      scopePath: scope.relativePath,
      checkRun,
      git: updated.git,
      taskMemory: updated.taskMemory
    };
  }

  async runGitCommand(taskId, params = {}) {
    if (params.approved !== true) {
      throw Object.assign(new Error("Git command execution requires approved: true."), { status: 428 });
    }
    const task = await this.state.readTask(requireTaskId(taskId));
    if (task.type !== "code") {
      throw Object.assign(new Error("Only code tasks can run git commands."), { status: 400 });
    }
    const scope = this.resolveCodeScope(task.scopePath || params.scopePath || "Code");

    const command = String(params.command || "").trim();
    if (!command.startsWith("git ")) {
      throw Object.assign(new Error("Only 'git' commands are allowed in this runtime."), { status: 400 });
    }

    // Block shell metacharacters and multi-command injections
    const metacharacters = /[;&|`$\n\r<>]/;
    if (metacharacters.test(command)) {
      throw Object.assign(new Error("Security block: Shell metacharacters are not allowed in git commands."), { status: 400 });
    }

    // Strong Approval Policy
    const isPush = /\bpush\b/.test(command);
    const isForcePush = /\bpush\b/.test(command) && (
      /\s(--force|-f|--force-with-lease)\b/.test(command) || 
      command.endsWith(" -f") || 
      command.endsWith(" --force") ||
      command.endsWith(" --force-with-lease")
    );

    if (isPush) {
      if (params.gitPushApproved !== true && params.dangerApproved !== true) {
        throw Object.assign(new Error("Git push commands require explicit gitPushApproved: true safety approval."), { status: 403 });
      }
    }
    if (isForcePush) {
      if (params.dangerApproved !== true) {
        throw Object.assign(new Error("Git force-push commands are blocked. Set dangerApproved: true explicitly to override."), { status: 403 });
      }
    }

    await this.state.recordToolLog({
      type: "code.git.start",
      taskId: task.id,
      scopePath: scope.relativePath,
      command
    });

    const startedAt = new Date().toISOString();
    const result = await runGitFileCommand(scope.absolutePath, command, params);
    const finishedAt = new Date().toISOString();

    await this.state.recordToolLog({
      type: "code.git.command",
      taskId: task.id,
      scopePath: scope.relativePath,
      command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      ok: result.ok
    });

    const currentMemory = task.taskMemory || { commands: [], check_results: [], readFiles: [], proposedFiles: [], changedFiles: [], failureLogs: [], nextSteps: [] };
    const taskMemory = {
      ...currentMemory,
      commands: [...(currentMemory.commands || []), command].slice(-50),
      check_results: [...(currentMemory.check_results || []), `${command} (${result.ok ? "OK" : "FAIL"}:${result.exitCode})`].slice(-50)
    };

    const gitRun = {
      command,
      ok: result.ok,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      startedAt,
      finishedAt
    };

    const gitRuns = [...(Array.isArray(task.gitRuns) ? task.gitRuns : []), gitRun];
    const gitState = await this.inspectGit(scope.absolutePath);
    const diffRef = await this.state.writeDiff(task.id, gitState.diff || "");

    const updated = await this.state.finishTask(task.id, {
      gitRuns,
      taskMemory,
      git: {
        ...(task.git || {}),
        isRepository: gitState.isRepository,
        root: gitState.root,
        status: gitState.status,
        diffStat: gitState.diffStat,
        diffRef
      }
    });

    await this.state.recordDecision({
      type: "code.git.result",
      taskId: task.id,
      scopePath: scope.relativePath,
      summary: `Git command '${command}' executed with exit code ${result.exitCode}.`,
      command
    });

    return {
      ok: result.ok,
      engine: "workspace-agent",
      runtime: "code-agent",
      taskId: task.id,
      command,
      result,
      git: updated.git,
      taskMemory: updated.taskMemory
    };
  }

  async generateAutomaticPatch(taskId, params = {}) {
    const task = await this.state.readTask(requireTaskId(taskId));
    if (task.type !== "code") {
      throw Object.assign(new Error("Only code tasks can generate automatic patches."), { status: 400 });
    }
    const scope = this.resolveCodeScope(task.scopePath || params.scopePath || "Code");

    const readFiles = task.taskMemory?.readFiles || [];
    const fileContents = [];
    for (const relPath of readFiles) {
      try {
        const absPath = path.join(this.workspaceRoot, relPath);
        const stat = await fs.stat(absPath);
        if (stat.isFile() && stat.size < 150000) {
          const content = await fs.readFile(absPath, "utf8");
          fileContents.push({ path: relPath, content });
        }
      } catch {}
    }

    await this.state.recordToolLog({
      type: "code.patch.generate.start",
      taskId: task.id,
      scopePath: scope.relativePath
    });

    let patchSpec;

    if (this.llmRuntime && this.llmRuntime.chatRuntime && this.llmRuntime.chatRuntime.isAvailable()) {
      try {
        const promptParams = {
          instruction: task.message,
          files: fileContents,
          model: params.model,
          provider: params.provider
        };
        patchSpec = await this.llmRuntime.generateCodePatch(promptParams);
      } catch (err) {
        throw Object.assign(new Error(`Failed to generate automatic patch: ${err.message}`), { status: 500 });
      }
    } else {
      throw Object.assign(new Error("Automatic patch generation requires a configured LLM runtime."), { status: 503 });
    }

    if (!patchSpec || !Array.isArray(patchSpec.changes)) {
      throw Object.assign(new Error("LLM response did not contain a valid changes array."), { status: 500 });
    }

    const result = await this.proposePatch(task.id, {
      changes: patchSpec.changes,
      summary: patchSpec.summary || `LLM-generated patch for task: ${task.message}`
    });

    await this.state.recordToolLog({
      type: "code.patch.generate.complete",
      taskId: task.id,
      scopePath: scope.relativePath,
      proposalId: result.proposal.id
    });

    return result;
  }

  async proposePatch(taskId, params = {}) {
    const task = await this.state.readTask(requireTaskId(taskId));
    if (task.type !== "code") {
      throw Object.assign(new Error("Only code tasks can propose patches."), { status: 400 });
    }
    const scope = this.resolveCodeScope(task.scopePath || params.scopePath || "Code");
    const changes = await this.resolveProposedChanges(scope, params.changes);
    if (!changes.length) {
      throw Object.assign(new Error("Patch proposal requires at least one change."), { status: 400 });
    }
    const proposalId = `patch-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const diff = buildUnifiedDiff(changes);
    const diffRef = await this.state.writeDiff(task.id, diff, proposalId);
    const approvalRequest = {
      type: "approval.request",
      category: "code.patch.apply",
      taskId: task.id,
      proposalId,
      scopePath: scope.relativePath,
      summary: stringValue(params.summary) || summarizePatchChanges(changes),
      diffRef
    };
    const approval = await this.state.recordApprovalRequest(approvalRequest);
    const proposal = {
      id: proposalId,
      status: "proposed",
      approved: false,
      approvalId: approval.id,
      createdAt: new Date().toISOString(),
      scopePath: scope.relativePath,
      summary: approval.summary,
      diffRef,
      changes: changes.map((change) => ({
        operation: change.operation,
        path: change.path,
        existed: change.existed,
        oldHash: change.oldHash,
        newHash: change.newHash,
        oldSize: change.oldSize,
        newSize: change.newSize,
        content: change.newContent
      }))
    };
    const proposals = [...(Array.isArray(task.patchProposals) ? task.patchProposals : []), proposal];
    const taskMemory = updateTaskMemoryForProposal(task.taskMemory, proposal);
    const updated = await this.state.finishTask(task.id, {
      status: "patch_proposed",
      patchProposals: proposals,
      proposedChanges: proposal.changes.map(({ content, ...metadata }) => metadata),
      taskMemory
    });
    await this.state.recordToolLog({
      type: "code.patch.propose",
      taskId: task.id,
      proposalId,
      scopePath: scope.relativePath,
      files: proposal.changes.map((change) => change.path),
      diffRef
    });
    await this.state.recordToolLog(approval);
    await this.state.recordDecision({
      type: "code.patch.proposed",
      taskId: task.id,
      proposalId,
      scopePath: scope.relativePath,
      summary: proposal.summary,
      diffRef
    });
    return {
      ok: true,
      engine: "workspace-agent",
      runtime: "code-agent",
      taskId: task.id,
      status: updated.status,
      scopePath: scope.relativePath,
      proposal: {
        id: proposal.id,
        status: proposal.status,
        approvalId: proposal.approvalId,
        summary: proposal.summary,
        diffRef,
        changes: proposal.changes.map(({ content, ...metadata }) => metadata)
      },
      taskMemory: updated.taskMemory,
      approvalRequired: true,
      approvalRequest: approval
    };
  }

  async applyPatch(taskId, params = {}) {
    if (params.approved !== true) {
      throw Object.assign(new Error("Code patch apply requires approved: true."), { status: 428 });
    }
    const task = await this.state.readTask(requireTaskId(taskId));
    if (task.type !== "code") {
      throw Object.assign(new Error("Only code tasks can apply patches."), { status: 400 });
    }
    const proposals = Array.isArray(task.patchProposals) ? task.patchProposals : [];
    const proposal = findPatchProposal(proposals, params.proposalId);
    if (!proposal) {
      throw Object.assign(new Error("Patch proposal was not found."), { status: 404 });
    }
    if (proposal.status !== "proposed") {
      throw Object.assign(new Error(`Patch proposal is already ${proposal.status}.`), { status: 409 });
    }
    const scope = this.resolveCodeScope(proposal.scopePath || task.scopePath || params.scopePath || "Code");
    const postPatchChecks = preparePostPatchChecks(task, params);
    await this.state.recordToolLog({
      type: "code.patch.apply.start",
      taskId: task.id,
      proposalId: proposal.id,
      scopePath: scope.relativePath
    });
    const targets = [];
    for (const change of proposal.changes || []) {
      const target = resolveCodeChangePath(this.workspaceRoot, scope, change.path);
      await assertCurrentContent(target.absolutePath, change);
      targets.push({ change, target });
    }
    const filesChanged = [];
    for (const { change, target } of targets) {
      if (change.operation === "delete") {
        await fs.rm(target.absolutePath, { force: false });
      } else {
        await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
        await fs.writeFile(target.absolutePath, String(change.content ?? ""), "utf8");
      }
      filesChanged.push(target.relativePath);
    }
    const appliedAt = new Date().toISOString();
    const patchedProposals = proposals.map((item) => item.id === proposal.id
      ? {
          ...item,
          status: "applied",
          approved: true,
          appliedAt,
          filesChanged
        }
      : item);
    const git = await this.inspectGit(scope.absolutePath);
    const diffRef = await this.state.writeDiff(task.id, git.diff || "", `after-${proposal.id}`);
    const taskMemory = updateTaskMemoryForAppliedPatch(task.taskMemory, filesChanged, proposal);
    const updated = await this.state.finishTask(task.id, {
      status: "patched",
      patchProposals: patchedProposals,
      filesChanged: [...new Set([...(task.filesChanged || []), ...filesChanged])],
      taskMemory,
      git: {
        ...(task.git || {}),
        isRepository: git.isRepository,
        root: git.root,
        status: git.status,
        diffStat: git.diffStat,
        diffRef
      }
    });
    await this.state.recordDecision({
      type: "code.patch.applied",
      taskId: task.id,
      proposalId: proposal.id,
      scopePath: scope.relativePath,
      summary: `Applied ${filesChanged.length} file change(s).`,
      diffRef
    });
    await this.state.recordToolLog({
      type: "code.patch.apply.complete",
      taskId: task.id,
      proposalId: proposal.id,
      scopePath: scope.relativePath,
      filesChanged,
      diffRef
    });
    if (proposal.approvalId || params.approvalId) {
      await this.state.resolveApproval(params.approvalId || proposal.approvalId, {
        approved: true,
        response: {
          taskId: task.id,
          proposalId: proposal.id,
          filesChanged,
          diffRef
        }
      });
    }
    const response = {
      ok: true,
      engine: "workspace-agent",
      runtime: "code-agent",
      taskId: task.id,
      status: updated.status,
      scopePath: scope.relativePath,
      proposalId: proposal.id,
      filesChanged,
      git: updated.git,
      taskMemory: updated.taskMemory
    };
    if (postPatchChecks?.approvalRequest) {
      const checkApproval = await this.state.recordApprovalRequest(postPatchChecks.approvalRequest);
      await this.state.recordToolLog(checkApproval);
      return {
        ...response,
        checkApprovalRequired: true,
        checkApprovalRequest: checkApproval
      };
    }
    if (postPatchChecks?.params) {
      const checkResult = await this.runChecks(task.id, postPatchChecks.params);
      return {
        ...response,
        ok: checkResult.ok,
        status: checkResult.status,
        checkRun: checkResult.checkRun,
        git: checkResult.git,
        taskMemory: checkResult.taskMemory
      };
    }
    return response;
  }

  async rejectPatch(taskId, params = {}) {
    const task = await this.state.readTask(requireTaskId(taskId));
    if (task.type !== "code") {
      throw Object.assign(new Error("Only code tasks can reject patches."), { status: 400 });
    }
    const proposals = Array.isArray(task.patchProposals) ? task.patchProposals : [];
    const proposal = findPatchProposal(proposals, params.proposalId);
    if (!proposal) {
      throw Object.assign(new Error("Patch proposal was not found."), { status: 404 });
    }
    if (proposal.status !== "proposed") {
      throw Object.assign(new Error(`Patch proposal is already ${proposal.status}.`), { status: 409 });
    }
    const reason = stringValue(params.reason) || "Rejected by user.";
    const rejectedAt = new Date().toISOString();
    const patchedProposals = proposals.map((item) => item.id === proposal.id
      ? {
          ...item,
          status: "rejected",
          approved: false,
          rejectedAt,
          rejectionReason: reason
        }
      : item);
    const taskMemory = updateTaskMemoryForRejectedPatch(task.taskMemory, proposal, reason);
    const updated = await this.state.finishTask(task.id, {
      status: "patch_rejected",
      patchProposals: patchedProposals,
      taskMemory
    });
    await this.state.recordDecision({
      type: "code.patch.rejected",
      taskId: task.id,
      proposalId: proposal.id,
      scopePath: proposal.scopePath || task.scopePath,
      summary: reason,
      diffRef: proposal.diffRef
    });
    await this.state.recordToolLog({
      type: "code.patch.reject",
      taskId: task.id,
      proposalId: proposal.id,
      scopePath: proposal.scopePath || task.scopePath,
      reason
    });
    if (proposal.approvalId || params.approvalId) {
      await this.state.resolveApproval(params.approvalId || proposal.approvalId, {
        approved: false,
        reason
      });
    }
    return {
      ok: true,
      engine: "workspace-agent",
      runtime: "code-agent",
      taskId: task.id,
      status: updated.status,
      scopePath: proposal.scopePath || task.scopePath,
      proposalId: proposal.id,
      taskMemory: updated.taskMemory
    };
  }

  resolveCodeScope(scopePath) {
    const relativePath = scopePath ? joinWorkspacePath(scopePath) : "Code";
    const scope = resolveWorkspacePath(this.workspaceRoot, relativePath);
    if (scope.relativePath !== "Code" && !scope.relativePath.startsWith("Code/")) {
      throw Object.assign(new Error("Code tasks must use a path under the Code workspace root."), { status: 400 });
    }
    return scope;
  }

  async inspectProject(scope, params) {
    const maxFiles = clampNumber(params.maxFiles, 20, 400, 120);
    const maxDepth = clampNumber(params.maxDepth, 1, 10, 5);
    const files = [];
    await walkProject(scope.absolutePath, scope.relativePath, {
      maxFiles,
      maxDepth,
      files
    });
    const packageInfo = await readPackageInfo(scope.absolutePath);
    const markers = await detectProjectMarkers(scope.absolutePath);
    return {
      scopePath: scope.relativePath,
      fileCount: files.length,
      files,
      package: packageInfo,
      markers,
      suggestedCheckCommands: suggestedCheckCommands(packageInfo, markers)
    };
  }

  async searchProject(scope, instruction, params) {
    const maxResults = clampNumber(params.maxSearchResults, 1, 20, 8);
    const queries = searchQueriesFromInstruction(instruction);
    if (!queries.length) {
      return {
        provider: "workspace-scan",
        query: "",
        scopePath: scope.relativePath,
        resultCount: 0,
        results: []
      };
    }
    const merged = [];
    let provider = "workspace-scan";
    let usedQuery = queries[0];
    for (const query of queries) {
      const result = await searchWorkspace(this.workspaceRoot, {
        query,
        scopePath: scope.relativePath,
        maxResults
      });
      provider = result.provider;
      if (result.resultCount > 0 && usedQuery === queries[0]) usedQuery = query;
      for (const item of result.results) {
        if (merged.some((existing) => existing.path === item.path)) continue;
        merged.push(item);
        if (merged.length >= maxResults) break;
      }
      if (merged.length >= maxResults) break;
    }
    return {
      provider,
      query: usedQuery,
      scopePath: scope.relativePath,
      resultCount: merged.length,
      results: merged.map((item) => ({
        path: item.path,
        kind: item.kind,
        score: item.score,
        snippet: item.snippet
      }))
    };
  }

  async inspectGit(cwd) {
    const root = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
    if (!root.ok) {
      return {
        isRepository: false,
        root: "",
        status: "",
        diffStat: "",
        diff: ""
      };
    }
    const status = await runGit(cwd, ["status", "--short"]);
    const diffStat = await runGit(cwd, ["diff", "--stat"]);
    const diff = await runGit(cwd, ["diff", "--binary"]);
    return {
      isRepository: true,
      root: root.stdout.trim(),
      status: status.stdout.trim(),
      diffStat: diffStat.stdout.trim(),
      diff: diff.stdout
    };
  }

  async resolveProposedChanges(scope, inputChanges) {
    if (!Array.isArray(inputChanges)) {
      throw Object.assign(new Error("Patch proposal requires changes[]."), { status: 400 });
    }
    const changes = [];
    for (const rawChange of inputChanges) {
      const change = rawChange || {};
      const operation = normalizePatchOperation(change);
      const target = resolveCodeChangePath(this.workspaceRoot, scope, change.path);
      const old = await readPatchTarget(target.absolutePath, operation);
      let newContent = "";
      if (operation === "delete") {
        if (!old.exists) {
          throw Object.assign(new Error(`Cannot delete missing file: ${target.relativePath}`), { status: 404 });
        }
        newContent = "";
      } else if (operation === "replace") {
        if (!old.exists) {
          throw Object.assign(new Error(`Cannot replace text in missing file: ${target.relativePath}`), { status: 404 });
        }
        newContent = replaceText(old.content, change);
      } else {
        if (operation === "create" && old.exists) {
          throw Object.assign(new Error(`Cannot create an existing file: ${target.relativePath}`), { status: 409 });
        }
        if (typeof change.content !== "string") {
          throw Object.assign(new Error(`Patch change for ${target.relativePath} requires string content.`), { status: 400 });
        }
        newContent = change.content;
      }
      assertPatchSize(target.relativePath, newContent);
      const oldContent = old.exists ? old.content : "";
      if (operation !== "delete" && old.exists && oldContent === newContent) {
        throw Object.assign(new Error(`Patch change does not modify file: ${target.relativePath}`), { status: 400 });
      }
      changes.push({
        operation,
        path: target.relativePath,
        existed: old.exists,
        oldContent,
        newContent,
        oldHash: sha256(oldContent),
        newHash: operation === "delete" ? "" : sha256(newContent),
        oldSize: Buffer.byteLength(oldContent, "utf8"),
        newSize: operation === "delete" ? 0 : Buffer.byteLength(newContent, "utf8")
      });
    }
    return changes;
  }

  buildInitialPlan({ instruction, scope, inspection, search, git }) {
    const relevantFiles = search.results.map((item) => item.path);
    const steps = [
      {
        id: "inspect",
        title: "Inspect relevant files",
        status: "done",
        detail: `Scanned ${inspection.fileCount} files under ${scope.relativePath}.`
      },
      {
        id: "plan",
        title: "Build edit plan",
        status: "ready",
        detail: relevantFiles.length
          ? `Use the search hits first: ${relevantFiles.slice(0, 5).join(", ")}.`
          : "No direct text hits were found; start from project markers and file tree."
      },
      {
        id: "patch",
        title: "Apply patches after approval",
        status: "ready",
        detail: "Use patch proposal APIs to create a diff first, then apply it only after approval."
      },
      {
        id: "verify",
        title: "Run checks and collect diff",
        status: "pending",
        detail: inspection.suggestedCheckCommands.length
          ? `Suggested checks: ${inspection.suggestedCheckCommands.join("; ")}.`
          : "No project check command was detected yet."
      }
    ];
    return {
      summary: [
        `Code task prepared for ${scope.relativePath}.`,
        git.isRepository ? "Git repository detected." : "No git repository detected.",
        search.resultCount ? `${search.resultCount} relevant search results found.` : "No direct search hits found."
      ].join(" "),
      instruction,
      steps,
      risks: [
        "Patch application and check execution require explicit approval.",
        "Detected check commands are suggestions only and are not run automatically."
      ]
    };
  }
}

async function walkProject(absoluteRoot, relativeRoot, options, depth = 0) {
  if (options.files.length >= options.maxFiles || depth > options.maxDepth) return;
  let entries;
  try {
    entries = await fs.readdir(absoluteRoot, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (options.files.length >= options.maxFiles) return;
    if (entry.name.startsWith(".DS_Store")) continue;
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const absolutePath = path.join(absoluteRoot, entry.name);
    const relativePath = joinWorkspacePath(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      await walkProject(absolutePath, relativePath, options, depth + 1);
      continue;
    }
    const stat = await fs.stat(absolutePath);
    options.files.push({
      path: relativePath,
      kind: fileKind(entry.name, false),
      size: stat.size,
      readable: isLikelyText(entry.name, stat.size)
    });
  }
}

async function readPackageInfo(projectRoot) {
  try {
    const text = await fs.readFile(path.join(projectRoot, "package.json"), "utf8");
    const json = JSON.parse(text);
    return {
      name: stringValue(json.name),
      type: stringValue(json.type),
      scripts: Object.fromEntries(Object.entries(json.scripts || {}).map(([key, value]) => [key, String(value)]))
    };
  } catch {
    return null;
  }
}

async function detectProjectMarkers(projectRoot) {
  const markers = [];
  for (const marker of [
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "Package.swift",
    "Makefile",
    "Dockerfile"
  ]) {
    try {
      await fs.access(path.join(projectRoot, marker));
      markers.push(marker);
    } catch {}
  }
  return markers;
}

function suggestedCheckCommands(packageInfo, markers) {
  const commands = [];
  const scripts = packageInfo?.scripts || {};
  for (const name of ["test", "check", "lint", "typecheck", "build"]) {
    if (scripts[name]) commands.push(`npm run ${name}`);
  }
  if (markers.includes("pyproject.toml")) commands.push("pytest");
  if (markers.includes("Cargo.toml")) commands.push("cargo test");
  if (markers.includes("go.mod")) commands.push("go test ./...");
  if (markers.includes("Package.swift")) commands.push("swift test");
  if (markers.includes("Makefile")) commands.push("make test");
  return [...new Set(commands)].slice(0, 8);
}

function buildInspectTaskMemory({ inspection, search, plan }) {
  const readableFiles = (inspection.files || [])
    .filter((file) => file.readable)
    .map((file) => file.path);
  const searchFiles = (search.results || []).map((item) => item.path);
  return normalizeTaskMemory({
    readFiles: uniqueStrings([...searchFiles, ...readableFiles.slice(0, 40)]),
    proposedFiles: [],
    changedFiles: [],
    commands: [],
    checkResults: [],
    failureLogs: [],
    nextSteps: extractNextSteps(plan),
    notes: [
      `Inspected ${inspection.fileCount || 0} file(s).`,
      search.resultCount ? `Found ${search.resultCount} relevant search result(s).` : "No direct search hits found."
    ]
  });
}

function updateTaskMemoryForProposal(memory, proposal) {
  return normalizeTaskMemory({
    ...memory,
    proposedFiles: uniqueStrings([
      ...(memory?.proposedFiles || []),
      ...(proposal.changes || []).map((change) => change.path)
    ]),
    nextSteps: [
      `Review proposal ${proposal.id}.`,
      "Approve the patch before applying it.",
      "Run checks after applying the patch."
    ],
    notes: appendBounded(memory?.notes, `Proposed patch ${proposal.id}: ${proposal.summary}`)
  });
}

function updateTaskMemoryForAppliedPatch(memory, filesChanged, proposal) {
  return normalizeTaskMemory({
    ...memory,
    changedFiles: uniqueStrings([...(memory?.changedFiles || []), ...filesChanged]),
    nextSteps: [
      "Run the suggested check commands.",
      "Review git diff before finalizing the code task."
    ],
    notes: appendBounded(memory?.notes, `Applied patch ${proposal.id} to ${filesChanged.length} file(s).`)
  });
}

function updateTaskMemoryForRejectedPatch(memory, proposal, reason) {
  return normalizeTaskMemory({
    ...memory,
    nextSteps: [
      "Revise the patch proposal.",
      "Create a safer or more targeted patch before applying changes."
    ],
    notes: appendBounded(memory?.notes, `Rejected patch ${proposal.id}: ${reason}`)
  });
}

function updateTaskMemoryForChecks(memory, checkRun, allPassed, plan) {
  const commandRecords = checkRun.results.map((result) => ({
    command: result.command,
    ok: result.ok,
    exitCode: result.exitCode,
    durationMs: result.durationMs
  }));
  const failures = checkRun.results
    .filter((result) => !result.ok)
    .map((result) => ({
      command: result.command,
      exitCode: result.exitCode,
      stderr: truncateMemoryLog(result.stderr),
      stdout: truncateMemoryLog(result.stdout)
    }));
  return normalizeTaskMemory({
    ...memory,
    commands: uniqueStrings([
      ...(memory?.commands || []),
      ...checkRun.commands
    ]),
    checkResults: appendBounded(memory?.checkResults, {
      id: checkRun.id,
      allPassed,
      finishedAt: checkRun.finishedAt,
      results: commandRecords
    }),
    failureLogs: appendBounded(memory?.failureLogs, ...failures),
    nextSteps: allPassed
      ? ["Review git diff and mark the task ready for user confirmation."]
      : [
          "Inspect failing command output.",
          "Revise the patch or plan.",
          ...extractNextSteps(plan).slice(0, 2)
        ],
    notes: appendBounded(memory?.notes, allPassed
      ? `Checks passed: ${checkRun.commands.join("; ")}`
      : `Checks failed: ${checkRun.commands.join("; ")}`)
  });
}

function normalizeTaskMemory(memory = {}) {
  return {
    readFiles: uniqueStrings(memory.readFiles || []).slice(0, 80),
    proposedFiles: uniqueStrings(memory.proposedFiles || []).slice(0, 80),
    changedFiles: uniqueStrings(memory.changedFiles || []).slice(0, 80),
    commands: uniqueStrings(memory.commands || []).slice(0, 40),
    checkResults: Array.isArray(memory.checkResults) ? memory.checkResults.slice(-20) : [],
    failureLogs: Array.isArray(memory.failureLogs) ? memory.failureLogs.slice(-20) : [],
    nextSteps: uniqueStrings(memory.nextSteps || []).slice(0, 10),
    notes: Array.isArray(memory.notes) ? memory.notes.map((item) => String(item)).filter(Boolean).slice(-40) : []
  };
}

function extractNextSteps(plan) {
  return (plan?.steps || [])
    .filter((step) => step.status !== "done")
    .map((step) => step.detail || step.title)
    .filter(Boolean);
}

function appendBounded(existing, ...items) {
  return [
    ...(Array.isArray(existing) ? existing : []),
    ...items.filter((item) => item !== undefined && item !== null && item !== "")
  ].slice(-40);
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function truncateMemoryLog(value) {
  const text = String(value || "");
  const max = 4000;
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n[truncated ${text.length - max} chars]`;
}

function preparePostPatchChecks(task, params) {
  const requested = params.runChecksAfterApply === true || params.runChecks === true || params.checkAfterApply === true;
  if (!requested) return null;
  const commands = Array.isArray(params.checkCommands)
    ? params.checkCommands
    : Array.isArray(params.commands)
      ? params.commands
      : undefined;
  const checkParams = {
    approved: true,
    commands,
    allowCustomCommands: params.allowCustomCommands === true,
    timeoutMs: params.checkTimeoutMs || params.timeoutMs
  };
  if (params.checksApproved !== true && params.checkApproved !== true) {
    return {
      approvalRequest: {
        type: "approval.request",
        category: "code.checks.run",
        taskId: task.id,
        scopePath: task.scopePath,
        summary: "Run code checks after applying the patch.",
        commands: resolveCheckCommands(task, checkParams)
      }
    };
  }
  const resolvedCommands = resolveCheckCommands(task, checkParams);
  return {
    params: {
      ...checkParams,
      commands: resolvedCommands,
      allowCustomCommands: true
    }
  };
}

function resolveCheckCommands(task, params) {
  const customCommands = Array.isArray(params.commands)
    ? params.commands.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (customCommands.length) {
    if (params.allowCustomCommands !== true) {
      throw Object.assign(new Error("Custom check commands require allowCustomCommands: true."), { status: 428 });
    }
    return customCommands.slice(0, 8);
  }
  return (task.inspection?.suggestedCheckCommands || []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8);
}

async function runShellCommand(cwd, command, params) {
  const started = Date.now();
  const timeoutMs = clampNumber(params.timeoutMs, 1000, 300000, 60000);
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        CI: process.env.CI || "1"
      }
    });
    return {
      command,
      ok: true,
      exitCode: 0,
      durationMs: Date.now() - started,
      stdout: truncateOutput(stdout),
      stderr: truncateOutput(stderr)
    };
  } catch (error) {
    return {
      command,
      ok: false,
      exitCode: Number.isInteger(error?.code) ? error.code : 1,
      signal: error?.signal || "",
      durationMs: Date.now() - started,
      stdout: truncateOutput(error?.stdout || ""),
      stderr: truncateOutput(error?.stderr || error?.message || "")
    };
  }
}

async function runGit(cwd, args) {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error?.stdout || "",
      stderr: error?.stderr || error?.message || ""
    };
  }
}

function searchQueriesFromInstruction(instruction) {
  const words = String(instruction || "")
    .replace(/[^\p{L}\p{N}_./:-]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .slice(0, 12);
  const useful = words.filter((word) => word.length >= 4);
  return [...new Set([
    words.join(" "),
    ...useful,
    ...useful.slice(0, 6).flatMap((word, index) => useful[index + 1] ? [`${word} ${useful[index + 1]}`] : [])
  ].map((query) => query.trim()).filter(Boolean))];
}

function isLikelyText(name, size) {
  if (size > 2 * 1024 * 1024) return false;
  return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function parseJsonAnswer(text) {
  let cleaned = text.trim();
  const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
  const match = cleaned.match(jsonBlockRegex);
  if (match) {
    cleaned = match[1].trim();
  }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

function requireInstruction(value) {
  const text = String(value || "").trim();
  if (!text) throw Object.assign(new Error("Missing code task instruction."), { status: 400 });
  return text;
}

function requireTaskId(value) {
  const text = String(value || "").trim();
  if (!text) throw Object.assign(new Error("Missing task id."), { status: 400 });
  return text;
}

function normalizePatchOperation(change) {
  const operation = String(change.operation || change.type || "").trim().toLowerCase();
  if (operation === "delete" || change.delete === true) return "delete";
  if (operation === "replace" || typeof change.find === "string") return "replace";
  if (operation === "create") return "create";
  return "write";
}

function resolveCodeChangePath(workspaceRoot, scope, inputPath) {
  const raw = String(inputPath || "").trim();
  if (!raw) throw Object.assign(new Error("Patch change requires a file path."), { status: 400 });
  const candidate = raw.replace(/\\/g, "/").startsWith("Code/")
    ? raw
    : joinWorkspacePath(scope.relativePath, raw);
  const target = resolveWorkspacePath(workspaceRoot, candidate);
  if (target.relativePath !== scope.relativePath && !target.relativePath.startsWith(scope.relativePath + "/")) {
    throw Object.assign(new Error("Patch changes must stay inside the code task scope."), { status: 400 });
  }
  return target;
}

async function readPatchTarget(absolutePath, operation) {
  try {
    const stat = await fs.stat(absolutePath);
    if (stat.isDirectory()) {
      throw Object.assign(new Error("Patch target cannot be a folder."), { status: 400 });
    }
    if (stat.size > PATCH_CONTENT_LIMIT) {
      throw Object.assign(new Error("Patch target is too large for text patching."), { status: 413 });
    }
    return {
      exists: true,
      content: await fs.readFile(absolutePath, "utf8")
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (operation === "replace" || operation === "delete") {
        throw Object.assign(new Error("Patch target was not found."), { status: 404 });
      }
      return { exists: false, content: "" };
    }
    throw error;
  }
}

function replaceText(content, change) {
  const find = String(change.find ?? "");
  if (!find) throw Object.assign(new Error("Replace patch requires a non-empty find value."), { status: 400 });
  const replace = String(change.replace ?? "");
  if (!content.includes(find)) {
    throw Object.assign(new Error("Replace patch could not find the requested text."), { status: 404 });
  }
  return change.replaceAll === true
    ? content.split(find).join(replace)
    : content.replace(find, replace);
}

function assertPatchSize(relativePath, content) {
  const size = Buffer.byteLength(String(content || ""), "utf8");
  if (size > PATCH_CONTENT_LIMIT) {
    throw Object.assign(new Error(`Patch content is too large: ${relativePath}`), { status: 413 });
  }
}

async function assertCurrentContent(absolutePath, change) {
  let currentExists = true;
  let currentContent = "";
  try {
    const stat = await fs.stat(absolutePath);
    if (stat.isDirectory()) {
      throw Object.assign(new Error("Patch target cannot be a folder."), { status: 400 });
    }
    if (stat.size > PATCH_CONTENT_LIMIT) {
      throw Object.assign(new Error("Patch target is too large for text patching."), { status: 413 });
    }
    currentContent = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    currentExists = false;
  }
  if (Boolean(change.existed) !== currentExists) {
    throw Object.assign(new Error(`Patch target changed since proposal: ${change.path}`), { status: 409 });
  }
  const currentHash = sha256(currentContent);
  if (currentHash !== change.oldHash) {
    throw Object.assign(new Error(`Patch target content changed since proposal: ${change.path}`), { status: 409 });
  }
}

function findPatchProposal(proposals, proposalId) {
  const id = String(proposalId || "").trim();
  if (id) return proposals.find((proposal) => proposal.id === id) || null;
  return [...proposals].reverse().find((proposal) => proposal.status === "proposed") || null;
}

function buildUnifiedDiff(changes) {
  return changes.map((change) => {
    const oldLines = splitDiffLines(change.oldContent);
    const newLines = splitDiffLines(change.operation === "delete" ? "" : change.newContent);
    const oldName = change.existed ? `a/${change.path}` : "/dev/null";
    const newName = change.operation === "delete" ? "/dev/null" : `b/${change.path}`;
    return [
      `--- ${oldName}`,
      `+++ ${newName}`,
      `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
      ...oldLines.map((line) => `-${line}`),
      ...newLines.map((line) => `+${line}`)
    ].join("\n");
  }).join("\n\n") + "\n";
}

function splitDiffLines(content) {
  const text = String(content || "");
  if (!text) return [];
  return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}

function summarizePatchChanges(changes) {
  return `Proposed ${changes.length} change(s): ${changes.map((change) => `${change.operation} ${change.path}`).join(", ")}`;
}

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function truncateOutput(value) {
  const text = String(value || "");
  const max = 100000;
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n[truncated ${text.length - max} chars]`;
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

export function parseGitCommand(command) {
  const parts = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
        quoteChar = "";
      } else {
        current += char;
      }
    } else {
      if (char === '"' || char === "'") {
        inQuotes = true;
        quoteChar = char;
      } else if (char === " " || char === "\t") {
        if (current) {
          parts.push(current);
          current = "";
        }
      } else {
        current += char;
      }
    }
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

async function runGitFileCommand(cwd, command, params) {
  const started = Date.now();
  const timeoutMs = clampNumber(params.timeoutMs, 1000, 300000, 60000);
  const parsed = parseGitCommand(command);

  if (parsed[0] !== "git") {
    throw new Error(`Only 'git' commands are permitted. Parsed executable: ${parsed[0]}`);
  }
  const args = parsed.slice(1);

  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        CI: process.env.CI || "1"
      }
    });
    return {
      command,
      ok: true,
      exitCode: 0,
      durationMs: Date.now() - started,
      stdout: truncateOutput(stdout),
      stderr: truncateOutput(stderr)
    };
  } catch (error) {
    return {
      command,
      ok: false,
      exitCode: Number.isInteger(error?.code) ? error.code : 1,
      signal: error?.signal || "",
      durationMs: Date.now() - started,
      stdout: truncateOutput(error?.stdout || ""),
      stderr: truncateOutput(error?.stderr || "")
    };
  }
}
