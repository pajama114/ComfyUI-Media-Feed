export function readUint32(bytes, offset) {
  return (
    bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  ) >>> 0;
}

export function readUint32LittleEndian(bytes, offset) {
  return (
    bytes[offset]
    + bytes[offset + 1] * 0x100
    + bytes[offset + 2] * 0x10000
    + bytes[offset + 3] * 0x1000000
  ) >>> 0;
}

export function readSyncsafeUint28(bytes, offset) {
  return (
    bytes[offset] * 0x200000
    + bytes[offset + 1] * 0x4000
    + bytes[offset + 2] * 0x80
    + bytes[offset + 3]
  ) >>> 0;
}

export function decodeLatin1(bytes) {
  return new TextDecoder("latin1").decode(bytes);
}

export function decodeUtf8(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

export function decodeUtf16(bytes, bigEndian = false) {
  try {
    return new TextDecoder(bigEndian ? "utf-16be" : "utf-16le").decode(bytes);
  } catch {
    return decodeUtf8(bytes);
  }
}

export function findNullByte(bytes, start, end = bytes.length) {
  for (let index = start; index < end; index++) {
    if (bytes[index] === 0) return index;
  }
  return -1;
}

export async function inflateBytes(bytes) {
  if (typeof DecompressionStream !== "function") return null;

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

function findMatchingJsonEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return index + 1;
    }
  }

  return -1;
}

export function findJsonMetadataObject(text) {
  const needles = ["{\"prompt\"", "{\"workflow\"", "{\"Prompt\"", "{\"Workflow\"", "{\"id\"", "{\"nodes\"", "{\"extra\""];
  const starts = needles
    .map((needle) => text.indexOf(needle))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b);

  for (const start of starts) {
    const end = findMatchingJsonEnd(text, start);
    if (end === -1) continue;
    const parsed = parseJsonMetadata(text.slice(start, end));
    if (parsed && typeof parsed === "object") return parsed;
  }

  return null;
}

export function looksLikeWorkflow(value) {
  return Boolean(value && typeof value === "object" && (
    Array.isArray(value.nodes)
    || value.extra?.prompt
    || Array.isArray(value.definitions?.subgraphs)
  ));
}

export function setMetadataText(chunks, key, value) {
  const normalizedKey = String(key || "").trim();
  const text = String(value || "").trim();
  if (!normalizedKey || !text) return;

  chunks[normalizedKey] = text;

  const lowerKey = normalizedKey.toLowerCase();
  if (lowerKey === "prompt") chunks.prompt = text;
  if (lowerKey === "workflow") chunks.workflow = text;

  const parsed = parseJsonMetadata(text) || findJsonMetadataObject(text);
  if (!parsed || typeof parsed !== "object") return;
  if (parsed.prompt !== undefined) chunks.prompt = parsed.prompt;
  if (parsed.workflow !== undefined) chunks.workflow = parsed.workflow;
  if (parsed.Prompt !== undefined) chunks.Prompt = parsed.Prompt;
  if (parsed.Workflow !== undefined) chunks.Workflow = parsed.Workflow;
  if (!chunks.workflow && looksLikeWorkflow(parsed)) chunks.workflow = parsed;
}

export function parseJsonMetadata(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
