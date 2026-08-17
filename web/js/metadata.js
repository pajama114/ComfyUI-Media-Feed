import {
  parseAudioTextMetadata,
  parseGifTextMetadata,
  parseJsonMetadata,
  parseMp4TextMetadata,
  parsePngTextChunks,
  parseWebmTextMetadata,
} from "./metadata_parsers.js";

const PROMPT_METADATA_CACHE_SIZE = 32;
const RANGE_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_AUTOMATIC_RANGE_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_AUTOMATIC_FULL_RESPONSE_BYTES = 16 * 1024 * 1024;
const PROMPT_AUDIO_EXTENSIONS = new Set(["flac", "m4a", "mp3", "ogg", "opus"]);
const PROMPT_VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "mkv"]);

const promptMetadataCache = new Map();

function getExtension(filename) {
  const cleanName = String(filename || "").split(/[?#]/, 1)[0];
  const dot = cleanName.lastIndexOf(".");
  return dot === -1 ? "" : cleanName.slice(dot + 1).toLowerCase();
}

export function clearPromptMetadataCache() {
  promptMetadataCache.clear();
}

function rememberPromptMetadata(key, result) {
  if (!key) return result;
  promptMetadataCache.delete(key);
  promptMetadataCache.set(key, result);

  while (promptMetadataCache.size > PROMPT_METADATA_CACHE_SIZE) {
    const oldestKey = promptMetadataCache.keys().next().value;
    promptMetadataCache.delete(oldestKey);
  }

  return result;
}

export async function loadPromptMetadata(item, options = {}) {
  if (!item?.key) {
    return { seed: "", positive: "", negative: "", resources: [], status: "No media item selected." };
  }

  const fullScan = options.fullScan === true;
  if (!fullScan && promptMetadataCache.has(item.key)) return promptMetadataCache.get(item.key);

  const extension = getExtension(item.filename);
  if (!supportsPromptMetadata(extension)) {
    return rememberPromptMetadata(item.key, unsupportedMetadataResult());
  }

  const result = fullScan
    ? await scanFullMetadata(item.url, extension)
    : await scanMetadataRanges(item.url, extension);
  return rememberPromptMetadata(item.key, result);
}

function supportsPromptMetadata(extension) {
  return extension === "png"
    || extension === "gif"
    || PROMPT_VIDEO_EXTENSIONS.has(extension)
    || PROMPT_AUDIO_EXTENSIONS.has(extension);
}

function emptyMetadataResult(status, options = {}) {
  return {
    seed: "",
    positive: "",
    negative: "",
    resources: [],
    details: [],
    status,
    requiresFullScan: options.requiresFullScan === true,
  };
}

function unsupportedMetadataResult() {
  return emptyMetadataResult(
    "Embedded prompt reading currently supports PNG, GIF, MP4, M4V, MOV, WebM, MKV, M4A, MP3, FLAC, OGG, and Opus metadata.",
  );
}

function metadataFound(result) {
  return Boolean(
    result?.seed
    || result?.positive
    || result?.negative
    || result?.resources?.length
    || result?.details?.length,
  );
}

function mergeChunks(...sources) {
  return Object.assign({}, ...sources.filter(Boolean));
}

function appendBytes(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function parseContentRange(value) {
  const match = String(value || "").match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === "*" ? null : Number(match[3]),
  };
}

function contentLength(response) {
  const value = Number(response.headers.get("content-length"));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function cancelResponse(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The browser may already have consumed or closed the response body.
  }
}

async function fetchRange(url, start, end) {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!response.ok) throw new Error(`Failed to fetch media metadata: ${response.status}`);

  const range = response.status === 206 ? parseContentRange(response.headers.get("content-range")) : null;
  if (!range) {
    const total = contentLength(response);
    if (total === null || total > MAX_AUTOMATIC_FULL_RESPONSE_BYTES) {
      await cancelResponse(response);
      return { requiresFullScan: true, total };
    }

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      total,
      complete: true,
      ranged: false,
    };
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    total: range.total,
    complete: range.total !== null && range.end + 1 >= range.total,
    ranged: true,
  };
}

async function parseMetadataBytes(bytes, extension) {
  if (extension === "png") return parsePngTextChunks(bytes);
  if (extension === "gif") return parseGifTextMetadata(bytes);
  if (extension === "webm" || extension === "mkv") return parseWebmTextMetadata(bytes);
  if (PROMPT_VIDEO_EXTENSIONS.has(extension)) return parseMp4TextMetadata(bytes);
  return parseAudioTextMetadata(bytes, extension);
}

async function scanFullMetadata(url, extension) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch media metadata: ${response.status}`);

  const chunks = await parseMetadataBytes(new Uint8Array(await response.arrayBuffer()), extension);
  return extractPromptMetadata(chunks);
}

async function scanMetadataRanges(url, extension) {
  const firstRange = await fetchRange(url, 0, RANGE_CHUNK_BYTES - 1);
  if (firstRange.requiresFullScan) {
    return emptyMetadataResult(
      "This server cannot range-scan the media safely. Read the full file to scan embedded metadata.",
      { requiresFullScan: true },
    );
  }

  const leadingParts = [firstRange.bytes];
  let leadingChunks = await parseMetadataBytes(leadingParts[0], extension);
  let result = extractPromptMetadata(leadingChunks);
  if (metadataFound(result) || firstRange.complete) return result;

  const scanLimit = firstRange.total === null
    ? MAX_AUTOMATIC_RANGE_SCAN_BYTES
    : Math.min(firstRange.total, MAX_AUTOMATIC_RANGE_SCAN_BYTES);
  let nextOffset = firstRange.bytes.length;
  while (nextOffset < scanLimit) {
    const nextRange = await fetchRange(url, nextOffset, Math.min(scanLimit - 1, nextOffset + RANGE_CHUNK_BYTES - 1));
    if (nextRange.requiresFullScan || !nextRange.ranged) break;

    leadingParts.push(nextRange.bytes);
    leadingChunks = await parseMetadataBytes(appendBytes(leadingParts), extension);
    result = extractPromptMetadata(leadingChunks);
    if (metadataFound(result) || nextRange.complete) return result;
    nextOffset += nextRange.bytes.length;
  }

  if (PROMPT_VIDEO_EXTENSIONS.has(extension) && firstRange.total !== null) {
    const tailStart = Math.max(nextOffset, firstRange.total - RANGE_CHUNK_BYTES);
    if (tailStart < firstRange.total) {
      const tailRange = await fetchRange(url, tailStart, firstRange.total - 1);
      if (!tailRange.requiresFullScan) {
        const tailChunks = await parseMetadataBytes(tailRange.bytes, extension);
        result = extractPromptMetadata(mergeChunks(leadingChunks, tailChunks));
        if (metadataFound(result)) return result;
      }
    }
  }

  return emptyMetadataResult(
    "Metadata was not found in the initial range scan. Read the full file to continue scanning.",
    { requiresFullScan: true },
  );
}

function extractPromptMetadata(chunks) {
  const workflow = parseJsonMetadata(chunks.workflow || chunks.Workflow);
  const prompt = parseJsonMetadata(chunks.prompt || chunks.Prompt) || parseJsonMetadata(workflow?.extra?.prompt);
  const fromChunks = extractFromLooseMetadata(chunks);
  const fromPrompt = extractFromPromptGraph(prompt);
  const fromWorkflow = extractFromWorkflowGraph(workflow);
  const fromDefinitions = extractFromWorkflowDefinitions(workflow);
  const seed = fromPrompt.seed || fromWorkflow.seed || fromDefinitions.seed || fromChunks.seed || "";
  const positive = fromPrompt.positive || fromWorkflow.positive || fromDefinitions.positive || "";
  const negative = fromPrompt.negative || fromWorkflow.negative || fromDefinitions.negative || "";
  const workflowResources = formatResourceEntries([
    ...(fromWorkflow.resources || []),
    ...(fromDefinitions.resources || []),
  ]);
  const resources = mergeResourceEntriesByLabel(fromPrompt.resources || [], workflowResources);
  const source = fromPrompt.source || fromWorkflow.source || fromDefinitions.source || fromChunks.source || "";
  const graphDetails = mergeMetadataDetailsByLabel(
    mergeMetadataDetailsByLabel(fromPrompt.details || [], fromWorkflow.details || []),
    fromDefinitions.details || [],
  );
  const details = formatMetadataEntries([
    ...graphDetails,
    ...(fromChunks.details || []),
  ]);
  const found = seed || positive || negative || resources.length || details.length;

  return {
    seed,
    positive,
    negative,
    resources,
    details,
    status: found
      ? `Loaded embedded ${source || "prompt"} metadata.`
      : "No prompt or seed metadata found in embedded metadata.",
    requiresFullScan: false,
  };
}

function uniqueNonEmpty(values) {
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

function joinPrompts(values) {
  return uniqueNonEmpty(values).join("\n\n");
}

function normalizeMetadataValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value !== "string") return "";

  const text = value.trim();
  if (!text || text.length > 160) return "";
  return text;
}

function addMetadataEntry(entries, label, value) {
  const text = normalizeMetadataValue(value);
  if (!text) return;
  entries.push({ label, value: text });
}

function metadataLabelForField(name) {
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

function addMetadataField(entries, name, value) {
  const label = metadataLabelForField(name);
  if (!label) return false;
  addMetadataEntry(entries, label, value);
  return true;
}

function addSizeMetadata(entries, value) {
  const text = normalizeMetadataValue(value);
  const match = text.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return false;

  addMetadataEntry(entries, "Width", match[1]);
  addMetadataEntry(entries, "Height", match[2]);
  return true;
}

function formatMetadataEntries(entries) {
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

function normalizeResourceValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text && text.length <= 300 ? text : "";
}

function addResourceEntry(entries, label, value) {
  const normalizedLabel = String(label || "").trim();
  const normalizedValue = normalizeResourceValue(value);
  if (!normalizedLabel || !normalizedValue) return;
  entries.push({ label: normalizedLabel, value: normalizedValue });
}

function resourceBasename(value) {
  const text = normalizeResourceValue(value);
  const parts = text.split(/[\\/]+/);
  return parts[parts.length - 1] || text;
}

function formatResourceEntries(entries) {
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

function mergeResourceEntriesByLabel(primary, fallback) {
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

function mergeMetadataDetailsByLabel(primary, fallback) {
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

function isSeedFieldName(name) {
  const normalized = String(name || "").replace(/[_-]+/g, " ").toLowerCase();
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (!parts.includes("seed")) return false;
  return !/(behavior|mode|control|action|randomize|fixed)/i.test(normalized);
}

function normalizeSeedValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "string") return "";

  const text = value.trim();
  if (!text || text.length > 100) return "";
  return /^[+-]?\d+(?:\.\d+)?$/.test(text) ? text : "";
}

function collectSeedValues(value, results = []) {
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

function formatSeedEntries(entries) {
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

function extractSeedEntriesFromText(text, label) {
  if (typeof text !== "string" || !text.trim() || text.length > 200000) return [];

  const entries = [];
  const pattern = /(?:^|[,;\n\r])\s*(seed|noise[_\s-]*seed|random[_\s-]*seed|rand[_\s-]*seed)\s*:\s*([+-]?\d+(?:\.\d+)?)/gi;
  for (const match of text.matchAll(pattern)) {
    entries.push({ label: `${label || "Metadata"} ${match[1]}`, value: match[2] });
  }
  return entries;
}

function extractMetadataEntriesFromText(text) {
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

function extractFromLooseMetadata(chunks) {
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

function isPromptLink(value) {
  return Array.isArray(value)
    && value.length >= 2
    && (typeof value[0] === "string" || typeof value[0] === "number")
    && (typeof value[1] === "number" || typeof value[1] === "string");
}

function promptNodeClass(node) {
  return String(node?.class_type || node?.type || "");
}

function isTextEncodeNode(node) {
  return /text.*encode|clip.*text/i.test(promptNodeClass(node));
}

function isTextCarrierNode(node) {
  const nodeClass = promptNodeClass(node);
  const title = String(node?.title || node?.properties?.["Node name for S&R"] || "");
  if (isTextEncodeNode(node)) return true;
  if (Object.entries(node?.inputs || {}).some(([name, value]) => promptInputIsText(node, name, value))) return true;
  return /(^|[^a-z])(text|string|prompt)([^a-z]|$)/i.test(`${nodeClass} ${title}`);
}

function collectStringValues(value, results = []) {
  if (typeof value === "string" && value.trim()) {
    results.push(value);
  } else if (Array.isArray(value)) {
    for (const child of value) collectStringValues(child, results);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectStringValues(child, results);
  }

  return results;
}

function widgetValueHasActivationState(value) {
  if (Array.isArray(value)) return value.some((child) => widgetValueHasActivationState(child));
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "active"));
}

function collectWidgetStringValues(value, results = []) {
  if (typeof value === "string" && value.trim()) {
    results.push(value);
  } else if (Array.isArray(value)) {
    const hasActivationState = widgetValueHasActivationState(value);
    for (const child of value) {
      if (hasActivationState && typeof child === "string") continue;
      collectWidgetStringValues(child, results);
    }
  } else if (value && typeof value === "object") {
    if (value.active === false) return results;

    if (typeof value.text === "string" && value.text.trim()) {
      results.push(value.text);
      return results;
    }

    for (const [key, child] of Object.entries(value)) {
      if (/^(items?|children|values?)$/i.test(key)) collectWidgetStringValues(child, results);
    }
  }

  return results;
}

function collectPromptInputTexts(node) {
  const inputs = node?.inputs || {};
  const texts = [];

  for (const [name, value] of Object.entries(inputs)) {
    if (!promptInputIsText(node, name, value)) continue;
    if (isPromptLink(value)) continue;
    texts.push(...collectStringValues(value));
  }

  return uniqueNonEmpty(texts);
}

function collectPromptNodeStrings(node) {
  const texts = [];
  texts.push(...collectPromptInputTexts(node));
  texts.push(...collectWidgetStringValues(node?.widgets_values || []));
  texts.push(...collectWidgetStringValues(node?.widgets || []));
  return uniqueNonEmpty(texts);
}

function promptNodeHasPolarityInputs(node) {
  const names = new Set(Object.keys(node?.inputs || {}));
  return names.has("positive") && names.has("negative");
}

function promptNodeLabel(node, nodeId) {
  return String(node?.title || node?.properties?.["Node name for S&R"] || promptNodeClass(node) || `Node ${nodeId}`).trim();
}

function isSystemPromptLabel(label) {
  return /(^|[^a-z])system\s*prompt([^a-z]|$)/i.test(String(label || ""));
}

function isPromptSystemNode(node, nodeId = "") {
  return isSystemPromptLabel(promptNodeLabel(node, nodeId));
}

function isConditioningZeroNodeClass(nodeClass) {
  return /conditioning.*zero|zero.*conditioning|zeroout/i.test(String(nodeClass || ""));
}

function isPromptConditioningZeroNode(node) {
  return isConditioningZeroNodeClass(promptNodeClass(node));
}

function isPromptTextGenerationNode(node) {
  const nodeClass = promptNodeClass(node);
  return /textgenerate|text.*generation|llm|gemini|openai|chat|prompt.*enhance|enhance.*prompt/i.test(nodeClass)
    && !isTextEncodeNode(node);
}

function promptNodeHasLinkedTextInput(node) {
  const inputs = node?.inputs || {};
  for (const [name, value] of Object.entries(inputs)) {
    if (!promptInputIsText(node, name, value)) continue;
    if (isPromptLink(value)) return true;
  }
  return false;
}

function promptNodeBooleanValue(prompt, reference, visited = new Set()) {
  if (!prompt || !isPromptLink(reference)) return undefined;

  const nodeId = String(reference[0]);
  if (visited.has(nodeId)) return undefined;
  visited.add(nodeId);

  const node = prompt[nodeId];
  if (!node) return undefined;

  for (const value of Object.values(node.inputs || {})) {
    if (typeof value === "boolean") return value;
    if (isPromptLink(value)) {
      const linkedValue = promptNodeBooleanValue(prompt, value, visited);
      if (typeof linkedValue === "boolean") return linkedValue;
    }
  }

  for (const value of node.widgets_values || []) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) {
      return value.trim().toLowerCase() === "true";
    }
  }

  return undefined;
}

function promptSwitchSelectedInputName(prompt, node) {
  const inputs = node?.inputs || {};
  if (!("on_true" in inputs) || !("on_false" in inputs)) return "";

  const switchValue = typeof inputs.switch === "boolean"
    ? inputs.switch
    : promptNodeBooleanValue(prompt, inputs.switch);
  if (typeof switchValue !== "boolean") return "";
  return switchValue ? "on_true" : "on_false";
}

function promptNodeInputValue(node, name) {
  const inputs = node?.inputs || {};
  return Object.prototype.hasOwnProperty.call(inputs, name) ? inputs[name] : undefined;
}

function isPromptStringCombinerNode(node) {
  return /string.*(function|concat|join|combine)|(concat|join|combine).*string|text.*(concat|join|combine)|(concat|join|combine).*text/i
    .test(promptNodeClass(node));
}

function promptInputIsText(node, name, value) {
  if (/text|string|prompt|caption|input|message|^value$/i.test(String(name || ""))) return true;
  if (!isPromptStringCombinerNode(node)) return false;
  if (/action|operation|function|separator|delimiter|tidy|mode/i.test(String(name || ""))) return false;
  return typeof value === "string" || isPromptLink(value) || Array.isArray(value);
}

function promptNodeTextInputs(node) {
  return Object.entries(node?.inputs || {})
    .filter(([name, value]) => promptInputIsText(node, name, value));
}

function preferredUserInputNames(entries) {
  const userNamed = entries
    .filter(([name]) => /(^|[_\s-])user([_\s-]|$)|user.*prompt|prompt.*user/i.test(name))
    .map(([name]) => name);
  if (userNamed.length) return userNamed;

  const secondInputs = entries
    .filter(([name]) => /(^|[_\s-])(string|text|prompt)?_?b$|^b$/i.test(name))
    .map(([name]) => name);
  if (secondInputs.length) return secondInputs;

  return [];
}

function collectPromptUserInputTexts(prompt, reference, visited = new Set()) {
  if (!prompt || !isPromptLink(reference)) return [];

  const nodeId = String(reference[0]);
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);

  const node = prompt[nodeId];
  if (!node || isPromptSystemNode(node, nodeId)) return [];

  const selectedSwitchInputName = promptSwitchSelectedInputName(prompt, node);
  if (selectedSwitchInputName) {
    const selectedValue = promptNodeInputValue(node, selectedSwitchInputName);
    return isPromptLink(selectedValue)
      ? collectPromptUserInputTexts(prompt, selectedValue, visited)
      : collectStringValues(selectedValue);
  }

  const textInputs = promptNodeTextInputs(node);
  const preferredNames = preferredUserInputNames(textInputs);
  if (preferredNames.length) {
    const texts = [];
    for (const name of preferredNames) {
      const value = promptNodeInputValue(node, name);
      if (isPromptLink(value)) {
        texts.push(...collectPromptUserInputTexts(prompt, value, visited));
      } else {
        texts.push(...collectStringValues(value));
      }
    }
    return uniqueNonEmpty(texts);
  }

  const directTexts = promptNodeHasLinkedTextInput(node) ? [] : collectPromptNodeStrings(node);
  if (directTexts.length) return directTexts;

  const texts = [];
  for (const [, value] of textInputs) {
    if (isPromptLink(value)) {
      texts.push(...collectPromptUserInputTexts(prompt, value, visited));
    } else {
      texts.push(...collectStringValues(value));
    }
  }
  return uniqueNonEmpty(texts);
}

function collectPromptTextGenerationInputTexts(prompt, node, visited) {
  const inputs = node?.inputs || {};
  const promptReference = inputs.prompt || inputs.text || inputs.input || inputs.message || inputs.messages;
  return collectPromptUserInputTexts(prompt, promptReference, new Set(visited));
}

function collectLinkedPromptSeedValues(prompt, reference, visited = new Set()) {
  if (!prompt || !isPromptLink(reference)) return [];

  const nodeId = String(reference[0]);
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);

  const node = prompt[nodeId];
  const inputs = node?.inputs || {};
  if (!node) return [];

  const seeds = [];
  const seedishNode = /seed|primitive|integer|number/i.test(promptNodeClass(node));
  for (const [name, value] of Object.entries(inputs)) {
    const valueName = String(name || "").toLowerCase();
    const valueIsSeed = isSeedFieldName(name) || (seedishNode && /^(value|int|integer|number)$/.test(valueName));
    if (valueIsSeed && !isPromptLink(value)) seeds.push(...collectSeedValues(value));

    if (isPromptLink(value)) {
      seeds.push(...collectLinkedPromptSeedValues(prompt, value, visited));
    } else if (Array.isArray(value)) {
      for (const child of value) {
        if (isPromptLink(child)) seeds.push(...collectLinkedPromptSeedValues(prompt, child, visited));
      }
    }
  }

  if (seedishNode) seeds.push(...collectSeedValues(node.widgets_values || []));
  return uniqueNonEmpty(seeds);
}

function collectPromptSeedEntries(prompt) {
  const entries = [];
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return entries;

  for (const [nodeId, node] of Object.entries(prompt)) {
    const inputs = node?.inputs || {};
    const nodeLabel = promptNodeLabel(node, nodeId);
    const nodeClass = promptNodeClass(node);
    for (const [name, value] of Object.entries(inputs)) {
      if (!isSeedFieldName(name)) continue;

      const seeds = isPromptLink(value)
        ? collectLinkedPromptSeedValues(prompt, value, new Set())
        : collectSeedValues(value);
      for (const seed of seeds) entries.push({
        label: `${nodeLabel}.${name}`,
        value: seed,
        nodeId: String(nodeId),
        nodeClass,
        fieldName: name,
      });
    }
  }

  return selectPromptSeedEntries(prompt, entries);
}

function promptTerminalNodeIds(prompt) {
  const consumers = new Set();
  const terminals = [];

  for (const node of Object.values(prompt || {})) {
    for (const value of Object.values(node?.inputs || {})) {
      if (isPromptLink(value)) consumers.add(String(value[0]));
    }
  }

  for (const [nodeId, node] of Object.entries(prompt || {})) {
    const nodeClass = promptNodeClass(node);
    if (/save|preview|create.*video|video.*combine/i.test(nodeClass) || !consumers.has(String(nodeId))) {
      terminals.push(String(nodeId));
    }
  }

  return terminals;
}

function promptAncestorDistances(prompt) {
  const distances = new Map();
  const queue = promptTerminalNodeIds(prompt).map((nodeId) => [nodeId, 0]);

  for (const [nodeId, distance] of queue) distances.set(nodeId, distance);

  for (let index = 0; index < queue.length; index++) {
    const [nodeId, distance] = queue[index];
    const node = prompt?.[nodeId];
    if (!node) continue;

    for (const value of Object.values(node.inputs || {})) {
      const links = [];
      if (isPromptLink(value)) {
        links.push(value);
      } else if (Array.isArray(value)) {
        for (const child of value) {
          if (isPromptLink(child)) links.push(child);
        }
      }

      for (const link of links) {
        const linkedId = String(link[0]);
        if (distances.has(linkedId)) continue;
        distances.set(linkedId, distance + 1);
        queue.push([linkedId, distance + 1]);
      }
    }
  }

  return distances;
}

function promptSeedPriority(entry) {
  const nodeClass = String(entry?.nodeClass || "");
  const fieldName = String(entry?.fieldName || "");
  if (/^RandomNoise$/i.test(nodeClass) && /^noise_seed$/i.test(fieldName)) return 0;
  if (/noise/i.test(nodeClass) && /seed/i.test(fieldName)) return 1;
  if (/sampler/i.test(nodeClass)) return 2;
  return 3;
}

function selectPromptSeedEntries(prompt, entries) {
  if (entries.length <= 1) return entries;

  const distances = promptAncestorDistances(prompt);
  const ranked = entries.map((entry) => ({
    ...entry,
    priority: promptSeedPriority(entry),
    distance: distances.get(entry.nodeId) ?? Number.POSITIVE_INFINITY,
  }));
  const bestPriority = Math.min(...ranked.map((entry) => entry.priority));
  const priorityMatches = ranked.filter((entry) => entry.priority === bestPriority);
  if (bestPriority === 0 && priorityMatches.length > 1) {
    return labelPromptNoiseSeedEntries(priorityMatches);
  }

  const bestDistance = Math.min(...priorityMatches.map((entry) => entry.distance));
  const selected = priorityMatches.filter((entry) => entry.distance === bestDistance);

  return selected.map(({ priority, distance, nodeId, nodeClass, fieldName, ...entry }) => entry);
}

function labelPromptNoiseSeedEntries(entries) {
  const sorted = [...entries].sort((a, b) => {
    const distanceDelta = (b.distance ?? 0) - (a.distance ?? 0);
    if (distanceDelta) return distanceDelta;
    return String(a.nodeId || "").localeCompare(String(b.nodeId || ""));
  });

  return sorted.map(({ priority, distance, nodeId, nodeClass, fieldName, ...entry }, index) => {
    if (sorted.length === 2) {
      return { ...entry, label: index === 0 ? "Low" : "High" };
    }

    return { ...entry, label: `Seed ${index + 1}` };
  });
}

function collectPromptMetadataEntries(prompt) {
  const entries = [];
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return entries;

  for (const node of Object.values(prompt)) {
    const inputs = node?.inputs || {};
    const nodeClass = promptNodeClass(node);
    const samplerNode = /sampler/i.test(nodeClass);
    const schedulerNode = /scheduler/i.test(nodeClass);
    const guiderNode = /guider|guidance/i.test(nodeClass);
    const latentNode = /latent|empty.*image/i.test(nodeClass);

    for (const [name, value] of Object.entries(inputs)) {
      if (isPromptLink(value)) continue;
      if (!samplerNode && !schedulerNode && !guiderNode && !latentNode) continue;
      addMetadataField(entries, name, value);
    }
  }

  return entries;
}

function collectPromptResourceEntries(prompt) {
  const entries = [];
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return entries;

  for (const node of Object.values(prompt)) {
    const nodeClass = promptNodeClass(node);
    if (!/checkpoint|unetloader|diffusion/i.test(nodeClass)) continue;

    for (const [name, value] of Object.entries(node?.inputs || {})) {
      if (!/^(ckpt|ckpt_name|checkpoint|checkpoint_name|model_name|unet_name|diffusion_model_name)$/i.test(name)) continue;
      if (isPromptLink(value)) continue;

      const checkpoint = resourceBasename(value);
      if (checkpoint) addResourceEntry(entries, "Checkpoint", checkpoint);
    }
  }

  return formatResourceEntries(entries);
}

function collectPromptNodeTexts(prompt, reference, visited = new Set(), forceText = false, polarity = "") {
  if (!prompt || !isPromptLink(reference)) return [];

  const nodeId = String(reference[0]);
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);

  const node = prompt[nodeId];
  const inputs = node?.inputs || {};
  if (!node) return [];
  if (isPromptSystemNode(node, nodeId) || isPromptConditioningZeroNode(node)) return [];
  if (isPromptTextGenerationNode(node)) return collectPromptTextGenerationInputTexts(prompt, node, visited);

  const texts = [];
  const textCarrier = isTextCarrierNode(node);
  const selectedSwitchInputName = promptSwitchSelectedInputName(prompt, node);
  if ((forceText || textCarrier) && !promptNodeHasLinkedTextInput(node)) {
    texts.push(...collectPromptNodeStrings(node));
  }

  for (const [name, value] of Object.entries(inputs)) {
    if (selectedSwitchInputName && name !== selectedSwitchInputName) continue;

    if (
      polarity
      && promptNodeHasPolarityInputs(node)
      && name !== polarity
    ) {
      continue;
    }

    const isTextInput = promptInputIsText(node, name, value);
    if (textCarrier && !isTextInput) continue;

    if (isPromptLink(value)) {
      texts.push(...collectPromptNodeTexts(prompt, value, visited, isTextInput || Boolean(selectedSwitchInputName), polarity));
    } else if (Array.isArray(value)) {
      for (const child of value) {
        if (isPromptLink(child)) texts.push(...collectPromptNodeTexts(prompt, child, visited, forceText || Boolean(selectedSwitchInputName), polarity));
        else if ((forceText || textCarrier) && isTextInput) texts.push(...collectStringValues(child));
      }
    } else if ((forceText || textCarrier) && isTextInput) {
      texts.push(...collectStringValues(value));
    }
  }

  return uniqueNonEmpty(texts);
}

function extractFromPromptGraph(prompt) {
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return {};

  const positives = [];
  const negatives = [];
  const seedEntries = collectPromptSeedEntries(prompt);
  const resources = collectPromptResourceEntries(prompt);
  const details = collectPromptMetadataEntries(prompt);

  for (const node of Object.values(prompt)) {
    const inputs = node?.inputs || {};
    if (inputs.positive && inputs.negative) {
      if (!/sampler/i.test(promptNodeClass(node)) && !isPromptLink(inputs.positive)) continue;

      positives.push(...collectPromptNodeTexts(prompt, inputs.positive, new Set(), false, "positive"));
      negatives.push(...collectPromptNodeTexts(prompt, inputs.negative, new Set(), false, "negative"));
      continue;
    }

    if (!/guider|guidance/i.test(promptNodeClass(node)) || !isPromptLink(inputs.conditioning)) continue;
    positives.push(...collectPromptNodeTexts(prompt, inputs.conditioning, new Set(), true, "positive"));
  }

  return {
    seed: formatSeedEntries(seedEntries),
    positive: joinPrompts(positives),
    negative: joinPrompts(negatives),
    resources,
    details,
    source: seedEntries.length || positives.length || negatives.length || resources.length || details.length ? "prompt" : "",
  };
}

function workflowNodeType(node) {
  return String(node?.type || node?.class_type || "");
}

function workflowInputIsText(input) {
  const description = `${input?.name || ""} ${input?.type || ""}`;
  return /text|string|prompt|caption|input|message/i.test(description);
}

function isWorkflowTextCarrierNode(node) {
  const nodeType = workflowNodeType(node);
  const title = String(node?.title || node?.properties?.["Node name for S&R"] || "");
  const outputTypes = (node?.outputs || []).map((output) => `${output?.name || ""} ${output?.type || ""}`).join(" ");
  if (isTextEncodeNode({ class_type: nodeType })) return true;
  if ((node?.inputs || []).some((input) => workflowInputIsText(input))) return true;
  return /(^|[^a-z])(text|string|prompt)([^a-z]|$)/i.test(`${nodeType} ${title} ${outputTypes}`);
}

function workflowNodeId(node) {
  return node?.id === undefined || node?.id === null ? "" : String(node.id);
}

function workflowInputLink(node, name) {
  if (!Array.isArray(node?.inputs)) return null;
  const input = node.inputs.find((current) => current?.name === name);
  return input?.link === undefined || input?.link === null ? null : String(input.link);
}

function workflowOutputName(node, slot) {
  const output = node?.outputs?.[Number(slot)];
  return String(output?.name || "").toLowerCase();
}

function workflowSubgraphInputName(workflow, slot) {
  const input = workflow?.inputs?.[Number(slot)];
  return String(input?.name || "");
}

function buildWorkflowMaps(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const nodeMap = new Map(nodes.map((node) => [workflowNodeId(node), node]));
  const linkMap = new Map();
  const consumerMap = new Map();

  for (const link of workflow?.links || []) {
    if (Array.isArray(link) && link.length >= 3) {
      const id = String(link[0]);
      const originId = String(link[1]);
      const originSlot = link[2];
      const targetId = link[3];
      const targetSlot = link[4];
      const originNode = nodeMap.get(originId);
      linkMap.set(id, {
        originId,
        originSlot,
        outputName: originId === "-10" ? workflowSubgraphInputName(workflow, originSlot) : workflowOutputName(originNode, originSlot),
      });
      if (targetId !== undefined) {
        if (!consumerMap.has(id)) consumerMap.set(id, []);
        consumerMap.get(id).push({ targetId: String(targetId), targetSlot });
      }
    } else if (link && typeof link === "object") {
      const id = link.id ?? link.link_id;
      const originId = link.origin_id ?? link.originId ?? link.from_node_id;
      const originSlot = link.origin_slot ?? link.originSlot ?? link.from_slot ?? link.from_socket;
      const targetId = link.target_id ?? link.targetId ?? link.to_node_id;
      const targetSlot = link.target_slot ?? link.targetSlot ?? link.to_slot ?? link.to_socket;
      if (id !== undefined && originId !== undefined) {
        const linkId = String(id);
        const originKey = String(originId);
        const originNode = nodeMap.get(originKey);
        linkMap.set(linkId, {
          originId: originKey,
          originSlot,
          outputName: originKey === "-10" ? workflowSubgraphInputName(workflow, originSlot) : workflowOutputName(originNode, originSlot),
        });
        if (targetId !== undefined) {
          if (!consumerMap.has(linkId)) consumerMap.set(linkId, []);
          consumerMap.get(linkId).push({ targetId: String(targetId), targetSlot });
        }
      }
    }
  }

  return { workflow, nodes, nodeMap, linkMap, consumerMap };
}

function workflowLinkOrigin(maps, linkId) {
  return maps.linkMap.get(String(linkId)) || null;
}

function workflowNodeHasPolarityInputs(node) {
  if (!Array.isArray(node?.inputs)) return false;
  const names = new Set(node.inputs.map((input) => input?.name));
  return names.has("positive") && names.has("negative");
}

function workflowNodeLabel(node) {
  return String(node?.title || node?.properties?.["Node name for S&R"] || workflowNodeType(node) || `Node ${workflowNodeId(node)}`).trim();
}

function isWorkflowSystemNode(node) {
  return isSystemPromptLabel(workflowNodeLabel(node));
}

function isWorkflowConditioningZeroNode(node) {
  return isConditioningZeroNodeClass(workflowNodeType(node));
}

function isWorkflowTextGenerationNode(node) {
  const nodeType = workflowNodeType(node);
  return /textgenerate|text.*generation|llm|gemini|openai|chat|prompt.*enhance|enhance.*prompt/i.test(nodeType)
    && !isTextEncodeNode({ class_type: nodeType });
}

function workflowNodeHasLinkedTextInput(node) {
  for (const input of node?.inputs || []) {
    if (!workflowInputIsText(input)) continue;
    if (input?.link !== undefined && input?.link !== null) return true;
  }
  return false;
}

function isWorkflowTextPassthroughNode(node) {
  const nodeType = workflowNodeType(node);
  return /previewany|reroute|switch/i.test(nodeType);
}

function workflowInputByName(node, name) {
  return (node?.inputs || []).find((input) => input?.name === name) || null;
}

function workflowNodeBooleanValue(maps, nodeId, visited = new Set()) {
  if (!nodeId || visited.has(String(nodeId))) return undefined;
  visited.add(String(nodeId));

  const node = maps.nodeMap.get(String(nodeId));
  if (!node) return undefined;

  for (const input of node.inputs || []) {
    const directValue = workflowInputValue(node, input);
    if (typeof directValue === "boolean") return directValue;
    if (typeof directValue === "string" && /^(true|false)$/i.test(directValue.trim())) {
      return directValue.trim().toLowerCase() === "true";
    }

    if (input?.link === undefined || input?.link === null) continue;
    const origin = workflowLinkOrigin(maps, input.link);
    const linkedValue = workflowNodeBooleanValue(maps, origin?.originId, visited);
    if (typeof linkedValue === "boolean") return linkedValue;
  }

  for (const value of node.widgets_values || []) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) {
      return value.trim().toLowerCase() === "true";
    }
  }

  return undefined;
}

function workflowSwitchSelectedInputName(maps, node) {
  if (!workflowInputByName(node, "on_true") || !workflowInputByName(node, "on_false")) return "";

  const switchInput = workflowInputByName(node, "switch");
  let switchValue = workflowInputValue(node, switchInput);
  if (typeof switchValue !== "boolean" && typeof switchValue === "string" && /^(true|false)$/i.test(switchValue.trim())) {
    switchValue = switchValue.trim().toLowerCase() === "true";
  }

  if (typeof switchValue !== "boolean" && switchInput?.link !== undefined && switchInput?.link !== null) {
    const origin = workflowLinkOrigin(maps, switchInput.link);
    switchValue = workflowNodeBooleanValue(maps, origin?.originId);
  }

  if (typeof switchValue !== "boolean") return "";
  return switchValue ? "on_true" : "on_false";
}

function workflowTextInputs(node) {
  return (node?.inputs || [])
    .filter((input) => workflowInputIsText(input));
}

function isWorkflowSubgraphInputOrigin(origin) {
  return String(origin?.originId || "") === "-10";
}

function collectWorkflowExternalInputTexts(origin, maps, visited, context, preferUserInputs = false) {
  const externalNode = context?.externalNode;
  const externalMaps = context?.externalMaps;
  const inputName = String(origin?.outputName || workflowSubgraphInputName(maps.workflow, origin?.originSlot));
  if (!externalNode || !externalMaps || !inputName) return [];

  const input = workflowInputByName(externalNode, inputName);
  const texts = workflowInputLinkedTexts(
    input,
    externalMaps,
    new Set(),
    context?.parentContext || null,
    preferUserInputs,
  );
  if (texts.length) return texts;
  return uniqueNonEmpty(collectWidgetStringValues(workflowInputValue(externalNode, input)));
}

function workflowInputLinkedTexts(input, maps, visited, context = null, preferUserInputs = false) {
  if (!input) return [];
  if (input.link !== undefined && input.link !== null) {
    const origin = workflowLinkOrigin(maps, input.link);
    if (isWorkflowSubgraphInputOrigin(origin)) {
      return collectWorkflowExternalInputTexts(origin, maps, visited, context, preferUserInputs);
    }
    return collectWorkflowUserInputTexts(origin?.originId, maps, visited, context, preferUserInputs);
  }
  return collectWidgetStringValues(input.value ?? input.default ?? input.widget?.value);
}

function collectWorkflowUserInputTexts(nodeId, maps, visited = new Set(), context = null, preferUserInputs = false) {
  if (!nodeId || visited.has(String(nodeId))) return [];
  visited.add(String(nodeId));

  const node = maps.nodeMap.get(String(nodeId));
  if (!node || isWorkflowSystemNode(node)) return [];

  const selectedSwitchInputName = workflowSwitchSelectedInputName(maps, node);
  if (selectedSwitchInputName) {
    return workflowInputLinkedTexts(
      workflowInputByName(node, selectedSwitchInputName),
      maps,
      visited,
      context,
      preferUserInputs,
    );
  }

  const textInputs = workflowTextInputs(node);
  const preferredNames = preferUserInputs
    ? preferredUserInputNames(textInputs.map((input) => [String(input?.name || ""), input]))
    : [];
  if (preferredNames.length) {
    const texts = [];
    for (const name of preferredNames) {
      texts.push(...workflowInputLinkedTexts(workflowInputByName(node, name), maps, visited, context, true));
    }
    const preferredTexts = uniqueNonEmpty(texts);
    if (preferredTexts.length) return preferredTexts;
  }

  const texts = [];
  for (const input of textInputs) {
    if (input?.link !== undefined && input?.link !== null) {
      texts.push(...workflowInputLinkedTexts(input, maps, visited, context, preferUserInputs));
    } else {
      texts.push(...collectWidgetStringValues(workflowInputValue(node, input)));
    }
  }
  const inputTexts = uniqueNonEmpty(texts);
  if (inputTexts.length) return inputTexts;

  return isWorkflowTextCarrierNode(node)
    ? uniqueNonEmpty(collectWidgetStringValues(node.widgets_values || []))
    : [];
}

function collectWorkflowTextGenerationInputTexts(node, maps, visited, context) {
  const promptInput = workflowInputByName(node, "prompt")
    || workflowInputByName(node, "text")
    || workflowInputByName(node, "input")
    || workflowInputByName(node, "message")
    || workflowInputByName(node, "messages");
  return workflowInputLinkedTexts(promptInput, maps, new Set(visited), context, true);
}

function collectWorkflowPropertySeedEntries(object, label) {
  const entries = [];
  if (!object || typeof object !== "object" || Array.isArray(object)) return entries;

  for (const [key, value] of Object.entries(object)) {
    if (!isSeedFieldName(key)) continue;
    for (const seed of collectSeedValues(value)) entries.push({ label: `${label}.${key}`, value: seed });
  }

  return entries;
}

function collectLinkedWorkflowSeedValues(maps, nodeId, visited = new Set(), forceValue = false) {
  if (!nodeId || visited.has(String(nodeId))) return [];
  visited.add(String(nodeId));

  const node = maps.nodeMap.get(String(nodeId));
  if (!node) return [];

  const seeds = [];
  const seedishNode = /seed|primitive|integer|number/i.test(workflowNodeType(node));
  const singleWidgetValue = forceValue && Array.isArray(node.widgets_values) && node.widgets_values.length === 1;
  if (seedishNode || singleWidgetValue) seeds.push(...collectSeedValues(node.widgets_values || []));

  for (const input of node.inputs || []) {
    const inputName = String(input?.name || "");
    const valueIsSeed = isSeedFieldName(inputName);
    if (valueIsSeed) seeds.push(...collectSeedValues(input?.value ?? input?.default ?? input?.widget?.value));

    if (input?.link !== undefined && input?.link !== null && (forceValue || seedishNode || valueIsSeed)) {
      const origin = workflowLinkOrigin(maps, input.link);
      seeds.push(...collectLinkedWorkflowSeedValues(maps, origin?.originId, visited, forceValue || valueIsSeed));
    }
  }

  return uniqueNonEmpty(seeds);
}

function collectWorkflowSeedEntries(workflow, maps = buildWorkflowMaps(workflow)) {
  const entries = [];
  if (!workflow || typeof workflow !== "object") return entries;

  for (const node of maps.nodes) {
    const nodeLabel = workflowNodeLabel(node);
    entries.push(...collectWorkflowPropertySeedEntries(node.properties, nodeLabel));

    for (const input of node.inputs || []) {
      const inputName = String(input?.name || "");
      if (!isSeedFieldName(inputName)) continue;

      const directSeeds = collectSeedValues(workflowInputValue(node, input));
      for (const seed of directSeeds) entries.push({ label: `${nodeLabel}.${inputName}`, value: seed });

      if (input?.link === undefined || input?.link === null) continue;
      const origin = workflowLinkOrigin(maps, input.link);
      for (const seed of collectLinkedWorkflowSeedValues(maps, origin?.originId, new Set(), true)) {
        entries.push({ label: `${nodeLabel}.${inputName}`, value: seed });
      }
    }

    if (Array.isArray(node.widgets)) {
      node.widgets.forEach((widget, index) => {
        const widgetName = String(widget?.name || widget?.label || "");
        if (!isSeedFieldName(widgetName)) return;
        const value = widget?.value ?? node.widgets_values?.[index];
        for (const seed of collectSeedValues(value)) entries.push({ label: `${nodeLabel}.${widgetName}`, value: seed });
      });
    }

    if (Array.isArray(node.widgets_values)) {
      for (const value of node.widgets_values) {
        if (!value || typeof value !== "object") continue;
        entries.push(...collectWorkflowPropertySeedEntries(value, nodeLabel));
      }
    }
  }

  return entries;
}

function workflowInputValue(node, input) {
  if (!node || !input) return undefined;
  if (input.link !== undefined && input.link !== null) return undefined;

  const directValue = input.value ?? input.default ?? input.widget?.value;
  if (directValue !== undefined) return directValue;

  const widgetName = input.widget?.name || input.name;
  const widgetsValues = node.widgets_values;
  if (widgetsValues && typeof widgetsValues === "object" && !Array.isArray(widgetsValues)) {
    if (Object.prototype.hasOwnProperty.call(widgetsValues, widgetName)) return widgetsValues[widgetName];
    if (Object.prototype.hasOwnProperty.call(widgetsValues, input.name)) return widgetsValues[input.name];
  }

  if (!Array.isArray(widgetsValues) || !input.widget) return undefined;

  const nodeType = workflowNodeType(node);
  if (/^KSampler$/i.test(nodeType)) {
    const samplerIndexes = {
      seed: 0,
      steps: 2,
      cfg: 3,
      sampler_name: 4,
      scheduler: 5,
      denoise: 6,
    };
    const index = samplerIndexes[widgetName] ?? samplerIndexes[input.name];
    if (index !== undefined) return widgetsValues[index];
  }

  if (/^RandomNoise$/i.test(nodeType) && (widgetName === "noise_seed" || input.name === "noise_seed")) {
    return widgetsValues[0];
  }

  let widgetIndex = -1;
  for (const current of node.inputs || []) {
    if (current?.widget) widgetIndex++;
    if (current === input) return widgetsValues[widgetIndex];
  }

  return undefined;
}

function workflowInputWidgetValue(node, input) {
  if (!node || !input) return undefined;

  const directValue = input.value ?? input.default ?? input.widget?.value;
  if (directValue !== undefined) return directValue;

  const widgetName = input.widget?.name || input.name;
  const widgetsValues = node.widgets_values;
  if (widgetsValues && typeof widgetsValues === "object" && !Array.isArray(widgetsValues)) {
    if (Object.prototype.hasOwnProperty.call(widgetsValues, widgetName)) return widgetsValues[widgetName];
    if (Object.prototype.hasOwnProperty.call(widgetsValues, input.name)) return widgetsValues[input.name];
  }

  if (!Array.isArray(widgetsValues) || !input.widget) return undefined;

  let widgetIndex = -1;
  for (const current of node.inputs || []) {
    if (current?.widget) widgetIndex++;
    if (current === input) return widgetsValues[widgetIndex];
  }

  return undefined;
}

function workflowInputEffectiveValue(node, input, maps, context = null, visited = new Set()) {
  if (!node || !input) return undefined;

  const linked = input.link !== undefined && input.link !== null;
  if (linked) {
    const origin = workflowLinkOrigin(maps, input.link);
    if (isWorkflowSubgraphInputOrigin(origin)) {
      const externalNode = context?.externalNode;
      const externalMaps = context?.externalMaps;
      const inputName = String(origin?.outputName || workflowSubgraphInputName(maps.workflow, origin?.originSlot));
      const externalInput = workflowInputByName(externalNode, inputName);
      const externalValue = workflowInputEffectiveValue(externalNode, externalInput, externalMaps, context?.parentContext || null, visited);
      if (externalValue !== undefined && externalValue !== "") return externalValue;
    } else {
      const originId = String(origin?.originId || "");
      const key = `${originId}:${origin?.originSlot ?? ""}`;
      if (originId && !visited.has(key)) {
        visited.add(key);

        const originNode = maps.nodeMap.get(originId);
        const originValue = workflowOutputValue(originNode, origin?.originSlot, maps, context, visited);
        if (originValue !== undefined && originValue !== "") return originValue;
      }
    }

  }

  const localValue = workflowInputWidgetValue(node, input);
  if (localValue !== undefined) return localValue;
  return linked ? undefined : workflowInputValue(node, input);
}

function workflowOutputValue(node, slot, maps, context, visited) {
  if (!node) return undefined;

  const outputName = workflowOutputName(node, slot);
  if (/^(true|false)$/i.test(outputName)) return outputName.toLowerCase() === "true";

  const nodeType = workflowNodeType(node);
  if (/primitive|boolean|integer|number|string|text|combo/i.test(nodeType) && Array.isArray(node.widgets_values) && node.widgets_values.length) {
    return node.widgets_values[0];
  }

  if (/switch/i.test(nodeType)) {
    const selectedInputName = workflowSwitchSelectedInputName(maps, node);
    const selectedInput = workflowInputByName(node, selectedInputName);
    return workflowInputEffectiveValue(node, selectedInput, maps, context, visited);
  }

  return undefined;
}

function workflowInputBooleanValue(node, input, maps, context = null) {
  const value = workflowInputEffectiveValue(node, input, maps, context);
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) {
    return value.trim().toLowerCase() === "true";
  }
  return undefined;
}

function workflowInputNameAtSlot(node, slot) {
  const input = node?.inputs?.[Number(slot)];
  return String(input?.name || "");
}

function workflowNodeOutputLinks(node) {
  const links = [];
  for (const output of node?.outputs || []) {
    if (Array.isArray(output?.links)) links.push(...output.links);
    else if (output?.links !== undefined && output.links !== null) links.push(output.links);
  }
  return links.map((link) => String(link));
}

function workflowLoraNodeIsActive(node, maps, context) {
  const outputLinks = workflowNodeOutputLinks(node);
  let sawSwitchConsumer = false;

  for (const linkId of outputLinks) {
    for (const consumer of maps.consumerMap.get(linkId) || []) {
      const target = maps.nodeMap.get(String(consumer.targetId));
      if (!target || !/switch/i.test(workflowNodeType(target))) continue;

      const inputName = workflowInputNameAtSlot(target, consumer.targetSlot);
      if (inputName !== "on_true" && inputName !== "on_false") continue;
      const switchValue = workflowInputBooleanValue(target, workflowInputByName(target, "switch"), maps, context);
      if (typeof switchValue !== "boolean") continue;

      sawSwitchConsumer = true;
      if ((inputName === "on_true" && switchValue) || (inputName === "on_false" && !switchValue)) {
        return true;
      }
    }
  }

  return !sawSwitchConsumer;
}

function formatLoraNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? `${value}.00` : value.toFixed(2);
  const text = normalizeResourceValue(value);
  if (!text) return "";
  const number = Number(text);
  return Number.isFinite(number) ? formatLoraNumber(number) : text;
}

function formatLoraResource(name, strength, clipStrength) {
  const cleanName = normalizeResourceValue(name);
  if (!cleanName) return "";

  const parts = [cleanName];
  const cleanStrength = formatLoraNumber(strength);
  const cleanClipStrength = formatLoraNumber(clipStrength);
  if (cleanStrength) parts.push(cleanStrength);
  if (cleanClipStrength && cleanClipStrength !== cleanStrength) parts.push(`clip ${cleanClipStrength}`);
  return parts.join(" · ");
}

function collectLoraResourcesFromValue(value, entries = []) {
  if (typeof value === "string") {
    const pattern = /<lora:([^:>]+):([^:>]+)(?::([^>]+))?>/gi;
    for (const match of value.matchAll(pattern)) {
      const formatted = formatLoraResource(match[1], match[2], match[3]);
      addResourceEntry(entries, "LoRA", formatted);
    }
  } else if (Array.isArray(value)) {
    const hasActivationState = widgetValueHasActivationState(value);
    for (const child of value) {
      if (hasActivationState && typeof child === "string") continue;
      collectLoraResourcesFromValue(child, entries);
    }
  } else if (value && typeof value === "object") {
    if (value.active === false) return entries;

    if (Object.prototype.hasOwnProperty.call(value, "name")) {
      const formatted = formatLoraResource(value.name, value.strength ?? value.modelStrength, value.clipStrength);
      addResourceEntry(entries, "LoRA", formatted);
    }

    for (const [key, child] of Object.entries(value)) {
      if (/lora/i.test(key) || /^(items?|children|values?)$/i.test(key)) collectLoraResourcesFromValue(child, entries);
    }
  }

  return entries;
}

function modelResourceFromProperties(node, directoryPattern) {
  const models = Array.isArray(node?.properties?.models) ? node.properties.models : [];
  const model = models.find((current) => directoryPattern.test(String(current?.directory || "")))
    || models.find((current) => normalizeResourceValue(current?.name));
  return resourceBasename(model?.name);
}

function resourceFilenameLike(value) {
  return /\.(safetensors|ckpt|pt|pth|bin)$/i.test(normalizeResourceValue(value));
}

function collectWorkflowResourceEntries(workflow, maps = buildWorkflowMaps(workflow), context = null) {
  const entries = [];
  if (!workflow || typeof workflow !== "object") return entries;

  for (const node of maps.nodes) {
    const nodeType = workflowNodeType(node);
    const checkpointNode = /checkpoint|unetloader|diffusion/i.test(nodeType)
      || Array.isArray(node?.properties?.models)
        && node.properties.models.some((model) => /diffusion|checkpoint|unet/i.test(String(model?.directory || "")));
    const loraNode = /lora/i.test(nodeType);
    let hasSelectedCheckpoint = false;

    for (const input of node.inputs || []) {
      const inputName = String(input?.name || "");
      if (checkpointNode && /^(ckpt|ckpt_name|checkpoint|checkpoint_name|model_name|unet_name|diffusion_model_name)$/i.test(inputName)) {
        const checkpoint = resourceBasename(workflowInputEffectiveValue(node, input, maps, context));
        if (checkpoint) {
          addResourceEntry(entries, "Checkpoint", checkpoint);
          hasSelectedCheckpoint = true;
        }
      }

      if (loraNode || /lora/i.test(inputName)) {
        collectLoraResourcesFromValue(workflowInputEffectiveValue(node, input, maps, context), entries);
      }
    }

    // `properties.models` is often a workflow template's download hint, not the
    // model selected for this execution. Prefer the resolved loader input and
    // only use that metadata when no selection can be recovered.
    if (checkpointNode && !hasSelectedCheckpoint && Array.isArray(node.widgets_values)) {
      const propertyModel = modelResourceFromProperties(node, /diffusion|checkpoint|unet/i);
      if (propertyModel) {
        addResourceEntry(entries, "Checkpoint", propertyModel);
      } else {
        for (const value of node.widgets_values) {
          if (resourceFilenameLike(value)) addResourceEntry(entries, "Checkpoint", resourceBasename(value));
        }
      }
    }

    if (loraNode || /lora/i.test(JSON.stringify(node.properties || {}))) {
      if (loraNode && !workflowLoraNodeIsActive(node, maps, context)) continue;

      const loraNameInput = workflowInputByName(node, "lora_name");
      const strengthInput = workflowInputByName(node, "strength_model")
        || workflowInputByName(node, "strength")
        || workflowInputByName(node, "model_strength");
      const loraName = workflowInputEffectiveValue(node, loraNameInput, maps, context);
      const loraStrength = workflowInputEffectiveValue(node, strengthInput, maps, context);
      const formatted = formatLoraResource(resourceBasename(loraName), loraStrength);
      addResourceEntry(entries, "LoRA", formatted);

      collectLoraResourcesFromValue(node.widgets_values || [], entries);
      collectLoraResourcesFromValue(node.widgets || [], entries);
    }
  }

  return formatResourceEntries(entries);
}

function collectWorkflowMetadataEntries(workflow, maps = buildWorkflowMaps(workflow)) {
  const entries = [];
  if (!workflow || typeof workflow !== "object") return entries;

  for (const node of maps.nodes) {
    const nodeType = workflowNodeType(node);
    const samplerNode = /sampler/i.test(nodeType);
    const schedulerNode = /scheduler/i.test(nodeType);
    const guiderNode = /guider|guidance/i.test(nodeType);
    const latentNode = /latent|empty.*image/i.test(nodeType);

    for (const input of node.inputs || []) {
      const name = String(input?.name || "");
      if (!samplerNode && !schedulerNode && !guiderNode && !latentNode) continue;
      addMetadataField(entries, name, workflowInputValue(node, input));
    }
  }

  return entries;
}

function collectWorkflowNodeTexts(nodeId, maps, visited = new Set(), forceText = false, polarity = "", context = null) {
  if (!nodeId || visited.has(nodeId)) return [];
  visited.add(nodeId);

  const node = maps.nodeMap.get(String(nodeId));
  if (!node) return [];
  if (isWorkflowSystemNode(node) || isWorkflowConditioningZeroNode(node)) return [];
  if (isWorkflowTextGenerationNode(node)) return collectWorkflowTextGenerationInputTexts(node, maps, visited, context);

  const texts = [];
  const textCarrier = isWorkflowTextCarrierNode(node);
  const selectedSwitchInputName = workflowSwitchSelectedInputName(maps, node);
  const linkedTextInput = workflowNodeHasLinkedTextInput(node);
  if ((forceText || textCarrier) && !linkedTextInput) {
    const directTexts = workflowTextInputs(node)
      .flatMap((input) => collectWidgetStringValues(workflowInputValue(node, input)));
    texts.push(...(directTexts.length ? directTexts : collectWidgetStringValues(node.widgets_values || [])));
  }

  for (const input of node.inputs || []) {
    if (selectedSwitchInputName && input.name !== selectedSwitchInputName) continue;

    const isTextInput = workflowInputIsText(input);
    if (input?.link === undefined || input?.link === null) {
      if ((forceText || textCarrier) && isTextInput) {
        texts.push(...collectWidgetStringValues(workflowInputValue(node, input)));
      }
      continue;
    }
    if (textCarrier && !isTextInput && !isWorkflowTextPassthroughNode(node)) continue;

    if (
      polarity
      && workflowNodeHasPolarityInputs(node)
      && input.name !== polarity
    ) {
      continue;
    }

    const origin = workflowLinkOrigin(maps, input.link);
    if (!origin) continue;
    if (isWorkflowSubgraphInputOrigin(origin)) {
      texts.push(...collectWorkflowExternalInputTexts(origin, maps, new Set(visited), context));
      continue;
    }

    const nextPolarity = origin.outputName === "positive" || origin.outputName === "negative"
      ? origin.outputName
      : polarity;
    const nextForceText = isTextInput || Boolean(selectedSwitchInputName) || (textCarrier && isWorkflowTextPassthroughNode(node));
    texts.push(...collectWorkflowNodeTexts(origin.originId, maps, visited, nextForceText, nextPolarity, context));
  }

  return uniqueNonEmpty(texts);
}

function extractFromWorkflowGraph(workflow, context = null) {
  if (!workflow || typeof workflow !== "object") return {};

  const maps = buildWorkflowMaps(workflow);
  const positives = [];
  const negatives = [];
  const seedEntries = collectWorkflowSeedEntries(workflow, maps);
  const resources = collectWorkflowResourceEntries(workflow, maps, context);
  const details = collectWorkflowMetadataEntries(workflow, maps);

  for (const node of maps.nodes) {
    const positiveLink = workflowInputLink(node, "positive");
    const negativeLink = workflowInputLink(node, "negative");
    if (positiveLink && negativeLink) {
      const positiveOrigin = workflowLinkOrigin(maps, positiveLink);
      const negativeOrigin = workflowLinkOrigin(maps, negativeLink);
      positives.push(...collectWorkflowNodeTexts(positiveOrigin?.originId, maps, new Set(), true, "positive", context));
      negatives.push(...collectWorkflowNodeTexts(negativeOrigin?.originId, maps, new Set(), true, "negative", context));
      continue;
    }

    const conditioningLink = workflowInputLink(node, "conditioning");
    if (!conditioningLink || !/guider|guidance/i.test(workflowNodeType(node))) continue;
    const conditioningOrigin = workflowLinkOrigin(maps, conditioningLink);
    positives.push(...collectWorkflowNodeTexts(conditioningOrigin?.originId, maps, new Set(), true, "positive", context));
  }

  return {
    seed: formatSeedEntries(seedEntries),
    positive: joinPrompts(positives),
    negative: joinPrompts(negatives),
    resources,
    details,
    source: seedEntries.length || positives.length || negatives.length || resources.length || details.length ? "workflow" : "",
  };
}

function workflowSubgraphDefinitions(workflow) {
  return Array.isArray(workflow?.definitions?.subgraphs) ? workflow.definitions.subgraphs : [];
}

function mergeWorkflowSubgraphDefinitions(primary, fallback) {
  const seen = new Set();
  const results = [];

  for (const subgraph of [...(primary || []), ...(fallback || [])]) {
    const id = String(subgraph?.id || "");
    const key = id || results.length;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(subgraph);
  }

  return results;
}

function appendWorkflowExtraction(target, result) {
  if (result.seed) target.seeds.push(result.seed);
  if (result.positive) target.positives.push(result.positive);
  if (result.negative) target.negatives.push(result.negative);
  target.resources.push(...(result.resources || []));
  target.details.push(...(result.details || []));
}

function extractFromWorkflowDefinitions(workflow, context = null, availableSubgraphs = null, visited = new Set()) {
  const subgraphs = mergeWorkflowSubgraphDefinitions(
    workflowSubgraphDefinitions(workflow),
    availableSubgraphs,
  );
  if (!subgraphs.length) return {};

  const parentMaps = buildWorkflowMaps(workflow);
  const collected = {
    seeds: [],
    positives: [],
    negatives: [],
    resources: [],
    details: [],
  };

  for (const subgraph of subgraphs) {
    const subgraphId = String(subgraph?.id || "");
    if (!subgraphId || visited.has(subgraphId)) continue;

    const parentNodes = parentMaps.nodes.filter((node) => workflowNodeType(node) === subgraphId);
    if (!parentNodes.length) continue;

    for (const parentNode of parentNodes) {
      const childContext = {
        externalNode: parentNode,
        externalMaps: parentMaps,
        parentContext: context,
      };
      const nextVisited = new Set(visited);
      nextVisited.add(subgraphId);

      appendWorkflowExtraction(collected, extractFromWorkflowGraph(subgraph, childContext));
      appendWorkflowExtraction(
        collected,
        extractFromWorkflowDefinitions(subgraph, childContext, subgraphs, nextVisited),
      );
    }
  }

  return {
    seed: uniqueNonEmpty(collected.seeds).join("\n"),
    positive: joinPrompts(collected.positives),
    negative: joinPrompts(collected.negatives),
    resources: formatResourceEntries(collected.resources),
    details: collected.details,
    source: collected.seeds.length || collected.positives.length || collected.negatives.length || collected.resources.length || collected.details.length ? "workflow" : "",
  };
}
