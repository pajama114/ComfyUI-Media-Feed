export function uniqueNonEmpty(values) {
  const seen = new Set();
  const results = [];

  for (const value of values.flat()) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    results.push(text);
  }

  return results;
}

export function joinPrompts(values) {
  return uniqueNonEmpty(values).join("\n\n");
}

export function normalizeMetadataValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value !== "string") return "";

  const text = value.trim();
  if (!text || text.length > 160) return "";
  return text;
}

export function addMetadataEntry(entries, label, value) {
  const text = normalizeMetadataValue(value);
  if (!text) return;
  entries.push({ label, value: text });
}

export function metadataLabelForField(name) {
  const normalized = String(name || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  if (!normalized) return "";

  if (isSeedFieldName(normalized)) return "Seed";
  if (/^(cfg|cfg scale|cfgscale|guidance|guidance scale)$/.test(normalized)) return "CFG scale";
  if (/^steps?$/.test(normalized)) return "Steps";
  if (/^(sampler|sampler name)$/.test(normalized)) return "Sampler";
  if (/^scheduler$/.test(normalized)) return "Scheduler";
  if (/^(denoise|denoising strength)$/.test(normalized)) return "Denoise";
  if (/^width$/.test(normalized)) return "Width";
  if (/^height$/.test(normalized)) return "Height";
  if (/^batch size$/.test(normalized)) return "Batch size";
  if (/^model$/.test(normalized)) return "Model";
  if (/^model hash$/.test(normalized)) return "Model hash";
  if (/^clip skip$/.test(normalized)) return "Clip skip";
  if (/^vae$/.test(normalized)) return "VAE";

  return "";
}

export function addMetadataField(entries, name, value) {
  const label = metadataLabelForField(name);
  if (!label) return false;
  addMetadataEntry(entries, label, value);
  return true;
}

export function addSizeMetadata(entries, value) {
  const text = normalizeMetadataValue(value);
  const match = text.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return false;

  addMetadataEntry(entries, "Width", match[1]);
  addMetadataEntry(entries, "Height", match[2]);
  return true;
}

export function formatMetadataEntries(entries) {
  const priority = new Map([
    ["CFG scale", 10],
    ["Steps", 20],
    ["Sampler", 30],
    ["Scheduler", 40],
    ["Seed", 50],
    ["Width", 60],
    ["Height", 70],
    ["Denoise", 80],
    ["Batch size", 90],
    ["Model", 100],
    ["Model hash", 110],
    ["Clip skip", 120],
    ["VAE", 130],
  ]);
  const seen = new Set();
  const results = [];

  for (const entry of entries) {
    const label = String(entry?.label || "").trim();
    const value = normalizeMetadataValue(entry?.value);
    if (!label || !value) continue;

    const key = `${label.toLowerCase()}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ label, value, order: priority.get(label) ?? 1000 });
  }

  results.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  return results.map(({ label, value }) => ({ label, value }));
}

export function normalizeResourceValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text && text.length <= 300 ? text : "";
}

export function addResourceEntry(entries, label, value) {
  const normalizedLabel = String(label || "").trim();
  const normalizedValue = normalizeResourceValue(value);
  if (!normalizedLabel || !normalizedValue) return;
  entries.push({ label: normalizedLabel, value: normalizedValue });
}

export function resourceBasename(value) {
  const text = normalizeResourceValue(value);
  const parts = text.split(/[\\/]+/);
  return parts[parts.length - 1] || text;
}

export function formatResourceEntries(entries) {
  const priority = new Map([
    ["Checkpoint", 10],
    ["LoRA", 20],
  ]);
  const seen = new Set();
  const results = [];

  for (const entry of entries || []) {
    const label = String(entry?.label || "").trim();
    const value = normalizeResourceValue(entry?.value);
    if (!label || !value) continue;

    const key = `${label.toLowerCase()}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ label, value, order: priority.get(label) ?? 1000 });
  }

  results.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  return results.map(({ label, value }) => ({ label, value }));
}

export function mergeResourceEntriesByLabel(primary, fallback) {
  const primaryLabels = new Set(
    (primary || [])
      .map((entry) => String(entry?.label || "").trim().toLowerCase())
      .filter(Boolean),
  );
  return formatResourceEntries([
    ...(primary || []),
    ...(fallback || []).filter((entry) => !primaryLabels.has(String(entry?.label || "").trim().toLowerCase())),
  ]);
}

export function mergeMetadataDetailsByLabel(primary, fallback) {
  const usedLabels = new Set();
  const results = [];

  for (const entry of primary) {
    const label = String(entry?.label || "").trim();
    const value = normalizeMetadataValue(entry?.value);
    if (!label || !value) continue;
    usedLabels.add(label.toLowerCase());
    results.push(entry);
  }

  for (const entry of fallback) {
    const label = String(entry?.label || "").trim();
    const value = normalizeMetadataValue(entry?.value);
    if (!label || !value || usedLabels.has(label.toLowerCase())) continue;
    usedLabels.add(label.toLowerCase());
    results.push(entry);
  }

  return results;
}

export function isSeedFieldName(name) {
  const normalized = String(name || "").replace(/[_-]+/g, " ").toLowerCase();
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (!parts.includes("seed")) return false;
  return !/(behavior|mode|control|action|randomize|fixed)/i.test(normalized);
}

export function normalizeSeedValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "string") return "";

  const text = value.trim();
  if (!text || text.length > 100) return "";
  return /^[+-]?\d+(?:\.\d+)?$/.test(text) ? text : "";
}

export function collectSeedValues(value, results = []) {
  const normalized = normalizeSeedValue(value);
  if (normalized) {
    results.push(normalized);
  } else if (Array.isArray(value) && !isPromptLink(value)) {
    for (const child of value) collectSeedValues(child, results);
  } else if (value && typeof value === "object") {
    for (const key of ["value", "default", "seed"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) collectSeedValues(value[key], results);
    }
  }

  return uniqueNonEmpty(results);
}

export function formatSeedEntries(entries) {
  const seedEntries = entries.filter((entry) => entry?.value);
  const uniqueValues = uniqueNonEmpty(seedEntries.map((entry) => entry.value));
  if (uniqueValues.length <= 1) return uniqueValues[0] || "";

  const seen = new Set();
  const lines = [];
  for (const entry of seedEntries) {
    const label = String(entry.label || "Seed").trim() || "Seed";
    const line = `${label}: ${entry.value}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }

  return lines.join("\n");
}

export function extractSeedEntriesFromText(text, label) {
  if (typeof text !== "string" || !text.trim() || text.length > 200000) return [];

  const entries = [];
  const pattern = /(?:^|[,;\n\r])\s*(seed|noise[_\s-]*seed|random[_\s-]*seed|rand[_\s-]*seed)\s*:\s*([+-]?\d+(?:\.\d+)?)/gi;
  for (const match of text.matchAll(pattern)) {
    entries.push({ label: `${label || "Metadata"} ${match[1]}`, value: match[2] });
  }
  return entries;
}

export function extractMetadataEntriesFromText(text) {
  if (typeof text !== "string" || !text.trim() || text.length > 200000) return [];

  const entries = [];
  const pattern = /(?:^|[,;\n\r])\s*([A-Za-z][A-Za-z0-9 _-]{1,32})\s*:\s*([^,\n\r]+)/g;
  for (const match of text.matchAll(pattern)) {
    const key = match[1].trim();
    const value = match[2].trim();
    if (/^size$/i.test(key)) {
      addSizeMetadata(entries, value);
      continue;
    }

    addMetadataField(entries, key, value);
  }

  return entries;
}

export function extractFromLooseMetadata(chunks) {
  const entries = [];
  const details = [];
  for (const [key, value] of Object.entries(chunks || {})) {
    if (isSeedFieldName(key)) {
      for (const seed of collectSeedValues(value)) entries.push({ label: key, value: seed });
    }

    if (String(key).toLowerCase() === "size") {
      addSizeMetadata(details, value);
    } else {
      addMetadataField(details, key, value);
    }

    const lowerKey = String(key || "").toLowerCase();
    if (/parameters|settings|comment|description/.test(lowerKey)) {
      entries.push(...extractSeedEntriesFromText(value, key));
      details.push(...extractMetadataEntriesFromText(value));
    }
  }

  return {
    seed: formatSeedEntries(entries),
    details,
    source: entries.length || details.length ? "metadata" : "",
  };
}

export function isPromptLink(value) {
  return Array.isArray(value)
    && value.length >= 2
    && (typeof value[0] === "string" || typeof value[0] === "number")
    && (typeof value[1] === "number" || typeof value[1] === "string");
}

