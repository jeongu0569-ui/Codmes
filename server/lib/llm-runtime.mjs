export class LLMRuntime {
  constructor({ chatRuntime }) {
    this.chatRuntime = chatRuntime;
  }

  /**
   * Returns true when the underlying chat runtime has a configured backend
   * (either WorkspaceChatBackend or HermesCompatChatBackend).
   */
  isAvailable() {
    return Boolean(this.chatRuntime && this.chatRuntime.isAvailable());
  }

  async generateCodePatch(params) {
    if (!this.isAvailable()) {
      throw Object.assign(
        new Error("Automatic patch generation requires a configured chat backend. Set up a provider first."),
        { status: 503, setupRequired: true }
      );
    }

    const prompt = `You are an expert software developer.
Your task is to generate a code patch proposal (a list of find/replace changes) to fulfill the user's instruction based on the provided file contents.

You MUST respond with a single valid JSON object containing exactly two keys: "summary" and "changes".
The JSON structure MUST look exactly like this:
{
  "summary": "Brief explanation of what this patch does.",
  "changes": [
    {
      "path": "Code/demo-app/src/index.js",
      "find": "Exact code block to find in the target file. MUST match exactly, including spaces, indentation, and newlines.",
      "replace": "The replacement code block."
    }
  ]
}

Rules:
- Do NOT wrap your JSON response in markdown code blocks like \`\`\`json ... \`\`\`. Just return raw JSON.
- The "find" string must exist exactly as written in the target file, otherwise the patch application will fail.
- Output ONLY the JSON object. Do not write any greetings or preambles.

Instruction: ${params.instruction}
Files:
${(params.files || []).map(f => `--- File: ${f.path} ---\n${f.content}`).join("\n\n")}`;

    const session = await this.chatRuntime.createSession({
      accessMode: "full",
      reasoningEffort: "medium"
    });

    const res = await this.chatRuntime.submitPrompt({
      sessionId: session.sessionId,
      prompt,
      message: prompt,
      model: params.model,
      provider: params.provider,
      wait: true
    });

    if (!res.ok) {
      throw new Error("Failed to generate patch from chat backend.");
    }

    const reply = (res.reply || "").trim();
    return normalizePatchResponse(reply, params.instruction);
  }
}

/**
 * Normalize an LLM text response into a standard patch spec:
 *   { summary: string, changes: [{ path, find, replace }] }
 *
 * Supported input shapes:
 *  - { summary, changes: [{ path, find, replace }] }            (canonical)
 *  - { summary, changes: [{ path, targetContent, replacementContent }] }
 *  - { changes: [{ path, operation:"write", content }] }        (full-file write)
 *  - [{ path, find, replace }]                                  (bare array)
 */
export function normalizePatchResponse(rawText, instruction = "") {
  // Strip markdown fences
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```")) {
    const lines = cleaned.split("\n");
    if (lines[0].startsWith("```")) lines.shift();
    if (lines.length > 0 && lines[lines.length - 1].startsWith("```")) lines.pop();
    cleaned = lines.join("\n").trim();
  }

  let parsed;
  // Try direct parse
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try extracting the largest JSON object or array from the text
    try {
      const objStart = cleaned.indexOf("{");
      const objEnd = cleaned.lastIndexOf("}") + 1;
      if (objStart !== -1 && objEnd > objStart) {
        parsed = JSON.parse(cleaned.slice(objStart, objEnd));
      }
    } catch {}
    if (!parsed) {
      try {
        const arrStart = cleaned.indexOf("[");
        const arrEnd = cleaned.lastIndexOf("]") + 1;
        if (arrStart !== -1 && arrEnd > arrStart) {
          parsed = JSON.parse(cleaned.slice(arrStart, arrEnd));
        }
      } catch {}
    }
  }

  if (!parsed) {
    throw new Error(
      `Failed to parse LLM patch response as JSON. Raw preview: ${rawText.slice(0, 200)}`
    );
  }

  let summary = instruction
    ? `LLM-generated patch for instruction: ${instruction}`
    : "LLM-generated patch";
  let rawChanges = [];

  if (Array.isArray(parsed)) {
    rawChanges = parsed;
  } else if (parsed && typeof parsed === "object") {
    summary = parsed.summary || summary;
    rawChanges = Array.isArray(parsed.changes) ? parsed.changes : [];
  }

  if (!rawChanges.length) {
    throw new Error("LLM response did not contain any valid proposed patch changes.");
  }

  const normalizedChanges = rawChanges
    .map(c => {
      // find/replace canonical form
      const findVal =
        c.find !== undefined ? c.find
        : c.targetContent !== undefined ? c.targetContent
        : c.old !== undefined ? c.old
        : "";

      let replaceVal =
        c.replace !== undefined ? c.replace
        : c.replacementContent !== undefined ? c.replacementContent
        : c.newContent !== undefined ? c.newContent
        : c.new !== undefined ? c.new
        : "";

      // "write" operation: treat as full-file replacement (find="", replace=content)
      if (c.operation === "write" && c.content !== undefined) {
        return {
          path: c.path || "",
          find: "",
          replace: c.content,
          operation: "write"
        };
      }

      return {
        path: c.path || "",
        find: findVal,
        replace: replaceVal
      };
    })
    .filter(c => c.path && (c.find !== "" || c.replace !== "" || c.operation === "write"));

  if (!normalizedChanges.length) {
    throw new Error("LLM response changes normalization failed (empty or invalid changes).");
  }

  return { summary, changes: normalizedChanges };
}
