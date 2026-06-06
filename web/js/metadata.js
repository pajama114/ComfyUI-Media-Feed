const PROMPT_METADATA_CACHE_SIZE = 32;
const MAX_METADATA_BYTES = 64 * 1024 * 1024;
const PROMPT_AUDIO_EXTENSIONS = new Set(["flac", "m4a", "mp3", "ogg", "opus"]);

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

export async function loadPromptMetadata(item) {
  if (!item?.key) {
    return { seed: "", positive: "", negative: "", status: "No media item selected." };
  }

  if (promptMetadataCache.has(item.key)) return promptMetadataCache.get(item.key);

  const extension = getExtension(item.filename);
  if (extension === "png" || extension === "gif") {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(`Failed to fetch image metadata: ${response.status}`);

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_METADATA_BYTES) {
      return rememberPromptMetadata(item.key, {
        seed: "",
        positive: "",
        negative: "",
        status: "Media is too large to scan prompt metadata.",
      });
    }

    const bytes = new Uint8Array(buffer);
    const chunks = extension === "gif" ? parseGifTextMetadata(bytes) : await parsePngTextChunks(bytes);
    const result = extractPromptMetadata(chunks);
    return rememberPromptMetadata(item.key, result);
  }

  if (extension === "mp4" || extension === "m4v" || extension === "mov" || extension === "webm" || extension === "mkv") {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(`Failed to fetch video metadata: ${response.status}`);

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_METADATA_BYTES) {
      return rememberPromptMetadata(item.key, {
        seed: "",
        positive: "",
        negative: "",
        status: "Media is too large to scan prompt metadata.",
      });
    }

    const bytes = new Uint8Array(buffer);
    const chunks = extension === "webm" || extension === "mkv"
      ? parseWebmTextMetadata(bytes)
      : parseMp4TextMetadata(bytes);
    const result = extractPromptMetadata(chunks);
    return rememberPromptMetadata(item.key, result);
  }

  if (PROMPT_AUDIO_EXTENSIONS.has(extension)) {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(`Failed to fetch audio metadata: ${response.status}`);

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_METADATA_BYTES) {
      return rememberPromptMetadata(item.key, {
        seed: "",
        positive: "",
        negative: "",
        status: "Media is too large to scan prompt metadata.",
      });
    }

    const bytes = new Uint8Array(buffer);
    const chunks = parseAudioTextMetadata(bytes, extension);
    const result = extractPromptMetadata(chunks);
    return rememberPromptMetadata(item.key, result);
  }

  {
    return rememberPromptMetadata(item.key, {
      seed: "",
      positive: "",
      negative: "",
      status: "Embedded prompt reading currently supports PNG, GIF, MP4, WebM, M4A, MP3, FLAC, OGG, and Opus metadata.",
    });
  }
}

function readUint32(bytes, offset) {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  ) >>> 0;
}

function readUint32LittleEndian(bytes, offset) {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  ) >>> 0;
}

function readSyncsafeUint28(bytes, offset) {
  return (
    bytes[offset] * 0x200000 +
    bytes[offset + 1] * 0x4000 +
    bytes[offset + 2] * 0x80 +
    bytes[offset + 3]
  ) >>> 0;
}

function decodeLatin1(bytes) {
  return new TextDecoder("latin1").decode(bytes);
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

function decodeUtf16(bytes, bigEndian = false) {
  try {
    return new TextDecoder(bigEndian ? "utf-16be" : "utf-16le").decode(bytes);
  } catch {
    return decodeUtf8(bytes);
  }
}

function findNullByte(bytes, start, end = bytes.length) {
  for (let index = start; index < end; index++) {
    if (bytes[index] === 0) return index;
  }
  return -1;
}

async function inflateBytes(bytes) {
  if (typeof DecompressionStream !== "function") return null;

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function parsePngTextChunks(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < signature.length || !signature.every((value, index) => bytes[index] === value)) {
    return {};
  }

  const chunks = {};
  let offset = signature.length;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const nextOffset = dataEnd + 4;
    if (dataEnd > bytes.length || nextOffset > bytes.length) break;

    const type = decodeLatin1(bytes.subarray(typeStart, typeStart + 4));
    const data = bytes.subarray(dataStart, dataEnd);

    if (type === "tEXt") {
      const split = findNullByte(data, 0);
      if (split > 0) chunks[decodeLatin1(data.subarray(0, split))] = decodeLatin1(data.subarray(split + 1));
    } else if (type === "iTXt") {
      const split = findNullByte(data, 0);
      if (split > 0 && split + 2 < data.length) {
        const keyword = decodeLatin1(data.subarray(0, split));
        const compressed = data[split + 1] === 1;
        let cursor = split + 3;
        const languageEnd = findNullByte(data, cursor);
        if (languageEnd !== -1) {
          cursor = languageEnd + 1;
          const translatedEnd = findNullByte(data, cursor);
          if (translatedEnd !== -1) {
            cursor = translatedEnd + 1;
            const textBytes = compressed ? await inflateBytes(data.subarray(cursor)) : data.subarray(cursor);
            if (textBytes) chunks[keyword] = decodeUtf8(textBytes);
          }
        }
      }
    } else if (type === "zTXt") {
      const split = findNullByte(data, 0);
      if (split > 0 && split + 2 < data.length) {
        const inflated = await inflateBytes(data.subarray(split + 2));
        if (inflated) chunks[decodeLatin1(data.subarray(0, split))] = decodeLatin1(inflated);
      }
    } else if (type === "IEND") {
      break;
    }

    offset = nextOffset;
  }

  return chunks;
}

function readGifSubBlocks(bytes, offset) {
  const parts = [];
  let cursor = offset;

  while (cursor < bytes.length) {
    const size = bytes[cursor++];
    if (size === 0) break;
    if (cursor + size > bytes.length) return { data: new Uint8Array(), offset: bytes.length };
    parts.push(bytes.subarray(cursor, cursor + size));
    cursor += size;
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const data = new Uint8Array(total);
  let writeOffset = 0;
  for (const part of parts) {
    data.set(part, writeOffset);
    writeOffset += part.length;
  }

  return { data, offset: cursor };
}

function appendGifMetadataText(chunks, texts, bytes, key) {
  if (!bytes.length) return;
  const text = decodeUtf8(bytes).replace(/\0+$/g, "").trim();
  if (!text) return;

  texts.push(text);
  chunks[key || `gif_${texts.length}`] = text;
}

function parseGifTextMetadata(bytes) {
  const header = bytes.length >= 6 ? decodeLatin1(bytes.subarray(0, 6)) : "";
  if (header !== "GIF87a" && header !== "GIF89a") return {};
  if (bytes.length < 13) return {};

  const chunks = {};
  const texts = [];
  let offset = 13;

  const globalPacked = bytes[10];
  if (globalPacked & 0x80) {
    offset += 3 * (1 << ((globalPacked & 0x07) + 1));
  }

  while (offset < bytes.length) {
    const marker = bytes[offset++];

    if (marker === 0x3b) break;

    if (marker === 0x2c) {
      if (offset + 9 > bytes.length) break;
      const packed = bytes[offset + 8];
      offset += 9;
      if (packed & 0x80) {
        offset += 3 * (1 << ((packed & 0x07) + 1));
      }
      if (offset >= bytes.length) break;
      offset += 1;
      ({ offset } = readGifSubBlocks(bytes, offset));
      continue;
    }

    if (marker !== 0x21 || offset >= bytes.length) break;

    const label = bytes[offset++];
    const start = offset;
    const block = readGifSubBlocks(bytes, offset);
    offset = block.offset;

    if (label === 0xfe) {
      appendGifMetadataText(chunks, texts, block.data, `gif_comment_${texts.length + 1}`);
    } else if (label === 0xff) {
      const appBlockSize = bytes[start] || 0;
      const appIdEnd = Math.min(start + 1 + appBlockSize, bytes.length);
      const appId = appBlockSize ? decodeLatin1(bytes.subarray(start + 1, appIdEnd)).trim() : "";
      appendGifMetadataText(chunks, texts, block.data, appId || `gif_application_${texts.length + 1}`);
    } else if (label === 0x01) {
      appendGifMetadataText(chunks, texts, block.data, `gif_plain_text_${texts.length + 1}`);
    }
  }

  for (const text of texts) {
    const parsed = parseJsonMetadata(text) || findJsonMetadataObject(text);
    if (!parsed || typeof parsed !== "object") continue;
    if (parsed.prompt !== undefined) chunks.prompt = parsed.prompt;
    if (parsed.workflow !== undefined) chunks.workflow = parsed.workflow;
    if (parsed.Prompt !== undefined) chunks.Prompt = parsed.Prompt;
    if (parsed.Workflow !== undefined) chunks.Workflow = parsed.Workflow;
  }

  return chunks;
}

function readMp4Size(bytes, offset) {
  if (offset + 8 > bytes.length) return null;
  let size = readUint32(bytes, offset);
  let headerSize = 8;

  if (size === 1) {
    if (offset + 16 > bytes.length) return null;
    const high = readUint32(bytes, offset + 8);
    const low = readUint32(bytes, offset + 12);
    size = high * 0x100000000 + low;
    headerSize = 16;
  } else if (size === 0) {
    size = bytes.length - offset;
  }

  if (!Number.isFinite(size) || size < headerSize || offset + size > bytes.length) return null;
  return { size, headerSize };
}

function parseMp4TextMetadata(bytes) {
  const chunks = {};
  const texts = [];
  const containerTypes = new Set(["moov", "udta", "meta", "ilst"]);

  function parseBoxes(start, end, parentType = "") {
    let offset = start;
    while (offset + 8 <= end) {
      const box = readMp4Size(bytes, offset);
      if (!box) break;

      const type = decodeLatin1(bytes.subarray(offset + 4, offset + 8));
      const dataStart = offset + box.headerSize;
      const dataEnd = offset + box.size;

      if (type === "data" && dataStart + 8 <= dataEnd) {
        const payload = bytes.subarray(dataStart + 8, dataEnd);
        const text = decodeUtf8(payload).replace(/\0+$/g, "").trim();
        if (text) {
          texts.push(text);
          chunks[parentType || `mp4_${texts.length}`] = text;
        }
      } else if (containerTypes.has(type) || parentType === "ilst") {
        parseBoxes(dataStart + (type === "meta" ? 4 : 0), dataEnd, type);
      } else if (parentType === "ilst") {
        parseBoxes(dataStart, dataEnd, type);
      }

      offset += box.size;
    }
  }

  parseBoxes(0, bytes.length);

  for (const text of texts) {
    const parsed = parseJsonMetadata(text);
    if (!parsed || typeof parsed !== "object") continue;
    if (parsed.prompt !== undefined) chunks.prompt = parsed.prompt;
    if (parsed.workflow !== undefined) chunks.workflow = parsed.workflow;
    if (parsed.Prompt !== undefined) chunks.Prompt = parsed.Prompt;
    if (parsed.Workflow !== undefined) chunks.Workflow = parsed.Workflow;
  }

  return chunks;
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

function findJsonMetadataObject(text) {
  const needles = ["{\"prompt\"", "{\"workflow\"", "{\"Prompt\"", "{\"Workflow\""];
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

function parseWebmTextMetadata(bytes) {
  const chunks = {};
  const text = decodeUtf8(bytes);
  const parsed = findJsonMetadataObject(text);
  if (!parsed) return chunks;

  if (parsed.prompt !== undefined) chunks.prompt = parsed.prompt;
  if (parsed.workflow !== undefined) chunks.workflow = parsed.workflow;
  if (parsed.Prompt !== undefined) chunks.Prompt = parsed.Prompt;
  if (parsed.Workflow !== undefined) chunks.Workflow = parsed.Workflow;
  return chunks;
}

function setMetadataText(chunks, key, value) {
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
}

function decodeId3Text(bytes, encoding) {
  if (encoding === 0) return decodeLatin1(bytes).replace(/\0+$/g, "");
  if (encoding === 3) return decodeUtf8(bytes).replace(/\0+$/g, "");

  if (encoding === 1 && bytes.length >= 2) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return decodeUtf16(bytes.subarray(2), true).replace(/\0+$/g, "");
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return decodeUtf16(bytes.subarray(2), false).replace(/\0+$/g, "");
    }
  }

  return decodeUtf16(bytes, encoding === 2).replace(/\0+$/g, "");
}

function findId3TextTerminator(bytes, encoding) {
  if (encoding === 1 || encoding === 2) {
    for (let index = 0; index + 1 < bytes.length; index += 2) {
      if (bytes[index] === 0 && bytes[index + 1] === 0) return index;
    }
    return -1;
  }

  return findNullByte(bytes, 0);
}

function parseId3TextMetadata(bytes) {
  const chunks = {};
  if (bytes.length < 10 || decodeLatin1(bytes.subarray(0, 3)) !== "ID3") return chunks;

  const version = bytes[3];
  const flags = bytes[5];
  const tagEnd = Math.min(bytes.length, 10 + readSyncsafeUint28(bytes, 6));
  let offset = 10;

  if (flags & 0x40) {
    if (version === 4 && offset + 4 <= tagEnd) {
      offset += readSyncsafeUint28(bytes, offset);
    } else if (version === 3 && offset + 4 <= tagEnd) {
      offset += readUint32(bytes, offset) + 4;
    }
  }

  while (offset + 10 <= tagEnd) {
    const frameId = decodeLatin1(bytes.subarray(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

    const frameSize = version === 4
      ? readSyncsafeUint28(bytes, offset + 4)
      : readUint32(bytes, offset + 4);
    const dataStart = offset + 10;
    const dataEnd = dataStart + frameSize;
    if (!frameSize || dataEnd > tagEnd) break;

    const data = bytes.subarray(dataStart, dataEnd);
    if (frameId === "TXXX" && data.length > 1) {
      const encoding = data[0];
      const payload = data.subarray(1);
      const separator = findId3TextTerminator(payload, encoding);
      const terminatorSize = encoding === 1 || encoding === 2 ? 2 : 1;
      const descriptionBytes = separator === -1 ? payload : payload.subarray(0, separator);
      const valueBytes = separator === -1 ? new Uint8Array() : payload.subarray(separator + terminatorSize);
      const description = decodeId3Text(descriptionBytes, encoding);
      const value = decodeId3Text(valueBytes, encoding);
      setMetadataText(chunks, description, value);
    } else if (frameId[0] === "T" && data.length > 1) {
      setMetadataText(chunks, frameId, decodeId3Text(data.subarray(1), data[0]));
    }

    offset = dataEnd;
  }

  return chunks;
}

function parseVorbisCommentData(bytes, offset = 0) {
  const chunks = {};
  if (offset + 8 > bytes.length) return chunks;

  const vendorLength = readUint32LittleEndian(bytes, offset);
  let cursor = offset + 4 + vendorLength;
  if (cursor + 4 > bytes.length) return chunks;

  const commentCount = readUint32LittleEndian(bytes, cursor);
  cursor += 4;

  for (let index = 0; index < commentCount && cursor + 4 <= bytes.length; index++) {
    const length = readUint32LittleEndian(bytes, cursor);
    cursor += 4;
    if (cursor + length > bytes.length) break;

    const comment = decodeUtf8(bytes.subarray(cursor, cursor + length));
    cursor += length;
    const split = comment.indexOf("=");
    if (split > 0) setMetadataText(chunks, comment.slice(0, split), comment.slice(split + 1));
  }

  return chunks;
}

function parseFlacTextMetadata(bytes) {
  const chunks = {};
  if (bytes.length < 4 || decodeLatin1(bytes.subarray(0, 4)) !== "fLaC") return chunks;

  let offset = 4;
  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const isLast = Boolean(header & 0x80);
    const type = header & 0x7f;
    const length = bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
    const dataStart = offset + 4;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;

    if (type === 4) {
      Object.assign(chunks, parseVorbisCommentData(bytes.subarray(dataStart, dataEnd)));
      break;
    }

    offset = dataEnd;
    if (isLast) break;
  }

  return chunks;
}

function parseOggTextMetadata(bytes) {
  let offset = 0;
  let packetParts = [];

  while (offset + 27 <= bytes.length) {
    if (decodeLatin1(bytes.subarray(offset, offset + 4)) !== "OggS") break;

    const segmentCount = bytes[offset + 26];
    const segmentTableStart = offset + 27;
    const dataStart = segmentTableStart + segmentCount;
    if (dataStart > bytes.length) break;

    const segments = bytes.subarray(segmentTableStart, dataStart);
    let cursor = dataStart;
    for (const segmentLength of segments) {
      if (cursor + segmentLength > bytes.length) return {};
      packetParts.push(bytes.subarray(cursor, cursor + segmentLength));
      cursor += segmentLength;

      if (segmentLength < 255) {
        const total = packetParts.reduce((sum, part) => sum + part.length, 0);
        const packet = new Uint8Array(total);
        let writeOffset = 0;
        for (const part of packetParts) {
          packet.set(part, writeOffset);
          writeOffset += part.length;
        }
        packetParts = [];

        if (packet.length >= 8 && decodeLatin1(packet.subarray(0, 8)) === "OpusTags") {
          return parseVorbisCommentData(packet, 8);
        }

        if (packet.length >= 7 && packet[0] === 3 && decodeLatin1(packet.subarray(1, 7)) === "vorbis") {
          return parseVorbisCommentData(packet, 7);
        }
      }
    }

    offset = cursor;
  }

  return {};
}

function parseAudioTextMetadata(bytes, extension) {
  if (extension === "mp3") return parseId3TextMetadata(bytes);
  if (extension === "flac") return parseFlacTextMetadata(bytes);
  if (extension === "opus" || extension === "ogg") return parseOggTextMetadata(bytes);
  if (extension === "m4a") return parseMp4TextMetadata(bytes);
  return {};
}

function parseJsonMetadata(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractPromptMetadata(chunks) {
  const prompt = parseJsonMetadata(chunks.prompt || chunks.Prompt);
  const workflow = parseJsonMetadata(chunks.workflow || chunks.Workflow);
  const fromChunks = extractFromLooseMetadata(chunks);
  const fromPrompt = extractFromPromptGraph(prompt);
  const fromWorkflow = extractFromWorkflowGraph(workflow);
  const seed = fromPrompt.seed || fromWorkflow.seed || fromChunks.seed || "";
  const positive = fromPrompt.positive || fromWorkflow.positive || "";
  const negative = fromPrompt.negative || fromWorkflow.negative || "";
  const source = fromPrompt.source || fromWorkflow.source || fromChunks.source || "";
  const found = seed || positive || negative;

  return {
    seed,
    positive,
    negative,
    status: found
      ? `Loaded embedded ${source || "prompt"} metadata.`
      : "No prompt or seed metadata found in embedded metadata.",
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

function extractFromLooseMetadata(chunks) {
  const entries = [];
  for (const [key, value] of Object.entries(chunks || {})) {
    if (isSeedFieldName(key)) {
      for (const seed of collectSeedValues(value)) entries.push({ label: key, value: seed });
    }

    const lowerKey = String(key || "").toLowerCase();
    if (/parameters|settings|comment|description/.test(lowerKey)) {
      entries.push(...extractSeedEntriesFromText(value, key));
    }
  }

  return {
    seed: formatSeedEntries(entries),
    source: entries.length ? "metadata" : "",
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

function collectPromptInputTexts(node) {
  const inputs = node?.inputs || {};
  const textInputNames = new Set(["text", "value", "string", "prompt", "text_a", "text_b", "positive", "negative"]);
  const texts = [];

  for (const [name, value] of Object.entries(inputs)) {
    if (!textInputNames.has(name) && !/text|string|prompt|caption/i.test(name)) continue;
    if (isPromptLink(value)) continue;
    texts.push(...collectStringValues(value));
  }

  return uniqueNonEmpty(texts);
}

function collectPromptNodeStrings(node) {
  const texts = [];
  texts.push(...collectPromptInputTexts(node));
  texts.push(...collectStringValues(node?.widgets_values || []));
  texts.push(...collectStringValues(node?.widgets || []));
  return uniqueNonEmpty(texts);
}

function promptNodeHasPolarityInputs(node) {
  const names = new Set(Object.keys(node?.inputs || {}));
  return names.has("positive") && names.has("negative");
}

function promptNodeLabel(node, nodeId) {
  return String(node?.title || node?.properties?.["Node name for S&R"] || promptNodeClass(node) || `Node ${nodeId}`).trim();
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
    for (const [name, value] of Object.entries(inputs)) {
      if (!isSeedFieldName(name)) continue;

      const seeds = isPromptLink(value)
        ? collectLinkedPromptSeedValues(prompt, value, new Set())
        : collectSeedValues(value);
      for (const seed of seeds) entries.push({ label: `${nodeLabel}.${name}`, value: seed });
    }
  }

  return entries;
}

function collectPromptNodeTexts(prompt, reference, visited = new Set(), forceText = false, polarity = "") {
  if (!prompt || !isPromptLink(reference)) return [];

  const nodeId = String(reference[0]);
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);

  const node = prompt[nodeId];
  const inputs = node?.inputs || {};
  if (!node) return [];

  const texts = [];
  const textCarrier = isTextCarrierNode(node);
  if (forceText || textCarrier) texts.push(...collectPromptNodeStrings(node));

  for (const [name, value] of Object.entries(inputs)) {
    if (
      polarity
      && promptNodeHasPolarityInputs(node)
      && name !== polarity
    ) {
      continue;
    }

    const isTextInput = /text|string|prompt|caption/i.test(name);
    if (textCarrier && !isTextInput) continue;

    if (isPromptLink(value)) {
      texts.push(...collectPromptNodeTexts(prompt, value, visited, isTextInput, polarity));
    } else if (Array.isArray(value)) {
      for (const child of value) {
        if (isPromptLink(child)) texts.push(...collectPromptNodeTexts(prompt, child, visited, forceText, polarity));
      }
    }
  }

  return uniqueNonEmpty(texts);
}

function extractFromPromptGraph(prompt) {
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return {};

  const positives = [];
  const negatives = [];
  const seedEntries = collectPromptSeedEntries(prompt);

  for (const node of Object.values(prompt)) {
    const inputs = node?.inputs || {};
    if (!inputs.positive || !inputs.negative) continue;
    if (!/sampler/i.test(promptNodeClass(node)) && !isPromptLink(inputs.positive)) continue;

    positives.push(...collectPromptNodeTexts(prompt, inputs.positive, new Set(), false, "positive"));
    negatives.push(...collectPromptNodeTexts(prompt, inputs.negative, new Set(), false, "negative"));
  }

  return {
    seed: formatSeedEntries(seedEntries),
    positive: joinPrompts(positives),
    negative: joinPrompts(negatives),
    source: seedEntries.length || positives.length || negatives.length ? "prompt" : "",
  };
}

function workflowNodeType(node) {
  return String(node?.type || node?.class_type || "");
}

function isWorkflowTextCarrierNode(node) {
  const nodeType = workflowNodeType(node);
  const title = String(node?.title || node?.properties?.["Node name for S&R"] || "");
  const outputTypes = (node?.outputs || []).map((output) => `${output?.name || ""} ${output?.type || ""}`).join(" ");
  if (isTextEncodeNode({ class_type: nodeType })) return true;
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

function buildWorkflowMaps(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const nodeMap = new Map(nodes.map((node) => [workflowNodeId(node), node]));
  const linkMap = new Map();

  for (const link of workflow?.links || []) {
    if (Array.isArray(link) && link.length >= 3) {
      const originId = String(link[1]);
      const originSlot = link[2];
      const originNode = nodeMap.get(originId);
      linkMap.set(String(link[0]), {
        originId,
        originSlot,
        outputName: workflowOutputName(originNode, originSlot),
      });
    } else if (link && typeof link === "object") {
      const id = link.id ?? link.link_id;
      const originId = link.origin_id ?? link.originId ?? link.from_node_id;
      const originSlot = link.origin_slot ?? link.originSlot ?? link.from_slot ?? link.from_socket;
      if (id !== undefined && originId !== undefined) {
        const originKey = String(originId);
        const originNode = nodeMap.get(originKey);
        linkMap.set(String(id), {
          originId: originKey,
          originSlot,
          outputName: workflowOutputName(originNode, originSlot),
        });
      }
    }
  }

  return { nodes, nodeMap, linkMap };
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

      const directSeeds = collectSeedValues(input?.value ?? input?.default ?? input?.widget?.value);
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

function collectWorkflowNodeTexts(nodeId, maps, visited = new Set(), forceText = false, polarity = "") {
  if (!nodeId || visited.has(nodeId)) return [];
  visited.add(nodeId);

  const node = maps.nodeMap.get(String(nodeId));
  if (!node) return [];

  const texts = [];
  const textCarrier = isWorkflowTextCarrierNode(node);
  if (forceText || textCarrier) {
    texts.push(...collectStringValues(node.widgets_values || []));
  }

  for (const input of node.inputs || []) {
    if (input?.link === undefined || input?.link === null) continue;
    const isTextInput = /text|string|prompt|caption/i.test(String(input.name || ""));
    if (textCarrier && !isTextInput) continue;

    if (
      polarity
      && workflowNodeHasPolarityInputs(node)
      && input.name !== polarity
    ) {
      continue;
    }

    const origin = workflowLinkOrigin(maps, input.link);
    if (!origin) continue;
    const nextPolarity = origin.outputName === "positive" || origin.outputName === "negative"
      ? origin.outputName
      : polarity;
    texts.push(...collectWorkflowNodeTexts(origin.originId, maps, visited, isTextInput, nextPolarity));
  }

  return uniqueNonEmpty(texts);
}

function extractFromWorkflowGraph(workflow) {
  if (!workflow || typeof workflow !== "object") return {};

  const maps = buildWorkflowMaps(workflow);
  const positives = [];
  const negatives = [];
  const seedEntries = collectWorkflowSeedEntries(workflow, maps);

  for (const node of maps.nodes) {
    const positiveLink = workflowInputLink(node, "positive");
    const negativeLink = workflowInputLink(node, "negative");
    if (!positiveLink || !negativeLink) continue;

    const positiveOrigin = workflowLinkOrigin(maps, positiveLink);
    const negativeOrigin = workflowLinkOrigin(maps, negativeLink);
    positives.push(...collectWorkflowNodeTexts(positiveOrigin?.originId, maps, new Set(), true, "positive"));
    negatives.push(...collectWorkflowNodeTexts(negativeOrigin?.originId, maps, new Set(), true, "negative"));
  }

  return {
    seed: formatSeedEntries(seedEntries),
    positive: joinPrompts(positives),
    negative: joinPrompts(negatives),
    source: seedEntries.length || positives.length || negatives.length ? "workflow" : "",
  };
}
