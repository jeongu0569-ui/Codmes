export class LLMRuntime {
  constructor({ chatRuntime }) {
    this.chatRuntime = chatRuntime;
  }

  async generateCodePatch(params) {
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
    
    let cleaned = reply;
    if (cleaned.startsWith("```")) {
      const lines = cleaned.split("\n");
      if (lines[0].startsWith("```")) {
        lines.shift();
      }
      if (lines.length > 0 && lines[lines.length - 1].startsWith("```")) {
        lines.pop();
      }
      cleaned = lines.join("\n").trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      try {
        const jsonStart = cleaned.indexOf("{");
        const jsonEnd = cleaned.lastIndexOf("}") + 1;
        if (jsonStart !== -1 && jsonEnd !== -1) {
          parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd));
        } else {
          const arrStart = cleaned.indexOf("[");
          const arrEnd = cleaned.lastIndexOf("]") + 1;
          if (arrStart !== -1 && arrEnd !== -1) {
            parsed = JSON.parse(cleaned.slice(arrStart, arrEnd));
          }
        }
      } catch {}
    }

    if (!parsed) {
      throw new Error(`Failed to parse LLM patch response as JSON. Raw preview: ${reply.slice(0, 200)}`);
    }

    let summary = `LLM-generated patch for instruction: ${params.instruction}`;
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

    const normalizedChanges = rawChanges.map(c => {
      const findVal = c.find !== undefined ? c.find
        : c.targetContent !== undefined ? c.targetContent
          : c.old !== undefined ? c.old
            : "";
      const replaceVal = c.replace !== undefined ? c.replace
        : c.replacementContent !== undefined ? c.replacementContent
          : c.newContent !== undefined ? c.newContent
            : c.new !== undefined ? c.new
              : "";
      return {
        path: c.path || "",
        find: findVal,
        replace: replaceVal
      };
    }).filter(c => c.path && (c.find !== "" || c.replace !== ""));

    if (!normalizedChanges.length) {
      throw new Error("LLM response changes normalization failed (empty or invalid changes).");
    }

    return {
      summary,
      changes: normalizedChanges
    };
  }
}
