export function parseConfigYaml(content) {
  const lines = content.split(/\r?\n/);
  const result = {
    model: null,
    custom_providers: []
  };

  let inModel = false;
  let inCustomProviders = false;
  let currentCustomProvider = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.search(/\S/);

    if (indent === 0) {
      inModel = trimmed.startsWith("model:");
      inCustomProviders = trimmed.startsWith("custom_providers:");
      if (currentCustomProvider) {
        result.custom_providers.push(currentCustomProvider);
        currentCustomProvider = null;
      }
      continue;
    }

    if (inModel && indent > 0) {
      if (!result.model) result.model = {};
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx !== -1) {
        const k = trimmed.slice(0, colonIdx).trim();
        const v = stripQuotes(trimmed.slice(colonIdx + 1).trim());
        result.model[k] = v;
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
  }

  if (currentCustomProvider) {
    result.custom_providers.push(currentCustomProvider);
  }

  return result;
}

export function stringifyConfigYaml(content, { model, custom_providers }) {
  const lines = content.split(/\r?\n/);
  const resultLines = [];
  let skipUntilUnindented = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.search(/\S/);

    if (indent === 0 && trimmed) {
      skipUntilUnindented = false;
      if (trimmed.startsWith("model:") || trimmed.startsWith("custom_providers:")) {
        skipUntilUnindented = true;
        continue;
      }
    }

    if (skipUntilUnindented && indent > 0) {
      continue;
    }

    resultLines.push(line);
  }

  // Trim trailing empty lines to avoid accumulation
  while (resultLines.length > 0 && resultLines[resultLines.length - 1].trim() === "") {
    resultLines.pop();
  }

  // Now append the updated model and custom_providers blocks at the end
  if (model) {
    resultLines.push("model:");
    resultLines.push(`  default: ${model.default || ""}`);
    resultLines.push(`  provider: ${model.provider || ""}`);
    if (model.base_url) {
      resultLines.push(`  base_url: ${model.base_url}`);
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

  // Add one trailing newline
  resultLines.push("");

  return resultLines.join("\n");
}

function stripQuotes(str) {
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str;
}
