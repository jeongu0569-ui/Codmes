export function parseConfigYaml(content) {
  const lines = content.split(/\r?\n/);
  const result = {
    model: null,
    custom_providers: [],
    disabled_tools: [],
    mcp_servers: []
  };

  let inModel = false;
  let inCustomProviders = false;
  let inDisabledTools = false;
  let inMcpServers = false;
  let currentCustomProvider = null;
  let currentMcpServer = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.search(/\S/);

    if (indent === 0) {
      inModel = trimmed.startsWith("model:");
      inCustomProviders = trimmed.startsWith("custom_providers:");
      inDisabledTools = trimmed.startsWith("disabled_tools:");
      inMcpServers = trimmed.startsWith("mcp_servers:");
      if (currentCustomProvider) {
        result.custom_providers.push(currentCustomProvider);
        currentCustomProvider = null;
      }
      if (currentMcpServer) {
        result.mcp_servers.push(currentMcpServer);
        currentMcpServer = null;
      }
      continue;
    }

    if (inModel && indent > 0) {
      if (!result.model) result.model = { fallback_chain: [] };
      if (trimmed.startsWith("-")) {
        const v = stripQuotes(trimmed.slice(1).trim());
        if (!result.model.fallback_chain) result.model.fallback_chain = [];
        result.model.fallback_chain.push(v);
      } else {
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx !== -1) {
          const k = trimmed.slice(0, colonIdx).trim();
          const v = stripQuotes(trimmed.slice(colonIdx + 1).trim());
          if (k !== "fallback_chain") {
            result.model[k] = v;
          }
        }
      }
    }

    if (inDisabledTools && indent > 0) {
      if (trimmed.startsWith("-")) {
        result.disabled_tools.push(stripQuotes(trimmed.slice(1).trim()));
      }
    }

    if (inCustomProviders && indent > 0) {
      if (trimmed.startsWith("-")) {
        if (currentCustomProvider) {
          result.custom_providers.push(currentCustomProvider);
        }
        currentCustomProvider = {};
        const rest = trimmed.slice(1).trim();
        const colonIdx = rest.indexOf(":");
        if (colonIdx !== -1) {
          const k = rest.slice(0, colonIdx).trim();
          const v = stripQuotes(rest.slice(colonIdx + 1).trim());
          currentCustomProvider[k] = v;
        }
      } else if (currentCustomProvider) {
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx !== -1) {
          const k = trimmed.slice(0, colonIdx).trim();
          const v = stripQuotes(trimmed.slice(colonIdx + 1).trim());
          currentCustomProvider[k] = v;
        }
      }
    }

    if (inMcpServers && indent > 0) {
      if (trimmed.startsWith("-") && (trimmed.includes(":") || !currentMcpServer)) {
        if (currentMcpServer) {
          result.mcp_servers.push(currentMcpServer);
        }
        currentMcpServer = { args: [] };
        const rest = trimmed.slice(1).trim();
        const colonIdx = rest.indexOf(":");
        if (colonIdx !== -1) {
          const k = rest.slice(0, colonIdx).trim();
          const v = stripQuotes(rest.slice(colonIdx + 1).trim());
          if (k !== "args") {
            currentMcpServer[k] = v;
          }
        }
      } else if (currentMcpServer) {
        if (trimmed.startsWith("-")) {
          currentMcpServer.args.push(stripQuotes(trimmed.slice(1).trim()));
        } else {
          const colonIdx = trimmed.indexOf(":");
          if (colonIdx !== -1) {
            const k = trimmed.slice(0, colonIdx).trim();
            const v = stripQuotes(trimmed.slice(colonIdx + 1).trim());
            if (k !== "args") {
              currentMcpServer[k] = v;
            }
          }
        }
      }
    }
  }

  if (currentCustomProvider) result.custom_providers.push(currentCustomProvider);
  if (currentMcpServer) result.mcp_servers.push(currentMcpServer);

  return result;
}

export function stringifyConfigYaml(content, { model, custom_providers, disabled_tools, mcp_servers }) {
  const lines = content.split(/\r?\n/);
  const resultLines = [];
  let skipUntilUnindented = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.search(/\S/);

    if (indent === 0 && trimmed) {
      skipUntilUnindented = false;
      if (
        trimmed.startsWith("model:") ||
        trimmed.startsWith("custom_providers:") ||
        trimmed.startsWith("disabled_tools:") ||
        trimmed.startsWith("mcp_servers:")
      ) {
        skipUntilUnindented = true;
        continue;
      }
    }

    if (skipUntilUnindented && indent > 0) {
      continue;
    }

    resultLines.push(line);
  }

  while (resultLines.length > 0 && resultLines[resultLines.length - 1].trim() === "") {
    resultLines.pop();
  }

  if (model) {
    resultLines.push("model:");
    resultLines.push(`  default: ${model.default || ""}`);
    resultLines.push(`  provider: ${model.provider || ""}`);
    if (model.base_url) {
      resultLines.push(`  base_url: ${model.base_url}`);
    }
    if (model.fallback_chain && model.fallback_chain.length > 0) {
      resultLines.push("  fallback_chain:");
      for (const fc of model.fallback_chain) {
        resultLines.push(`    - ${fc}`);
      }
    }
  }

  if (custom_providers && custom_providers.length > 0) {
    resultLines.push("custom_providers:");
    for (const cp of custom_providers) {
      resultLines.push(`  - name: ${cp.name}`);
      if (cp.base_url) resultLines.push(`    base_url: ${cp.base_url}`);
      if (cp.key_env) resultLines.push(`    key_env: ${cp.key_env}`);
    }
  }

  if (disabled_tools && disabled_tools.length > 0) {
    resultLines.push("disabled_tools:");
    for (const dt of disabled_tools) {
      resultLines.push(`  - ${dt}`);
    }
  }

  if (mcp_servers && mcp_servers.length > 0) {
    resultLines.push("mcp_servers:");
    for (const mcp of mcp_servers) {
      resultLines.push(`  - name: ${mcp.name}`);
      if (mcp.command) resultLines.push(`    command: ${mcp.command}`);
      if (mcp.enabled !== undefined) resultLines.push(`    enabled: ${mcp.enabled}`);
      if (mcp.args && mcp.args.length > 0) {
        resultLines.push("    args:");
        for (const arg of mcp.args) {
          resultLines.push(`      - ${arg}`);
        }
      }
    }
  }

  resultLines.push("");

  return resultLines.join("\n");
}

function stripQuotes(str) {
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str;
}
