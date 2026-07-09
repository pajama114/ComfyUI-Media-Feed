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
  const metadataKeys = new Map();
  const containerTypes = new Set(["moov", "udta", "meta", "ilst"]);

  function parseBoxes(start, end, parentType = "") {
    let offset = start;
    while (offset + 8 <= end) {
      const box = readMp4Size(bytes, offset);
      if (!box) break;

      const type = decodeLatin1(bytes.subarray(offset + 4, offset + 8));
      const dataStart = offset + box.headerSize;
      const dataEnd = offset + box.size;

      if (type === "keys" && dataStart + 8 <= dataEnd) {
        parseMp4Keys(dataStart, dataEnd);
      } else if (type === "data" && dataStart + 8 <= dataEnd) {
        const payload = bytes.subarray(dataStart + 8, dataEnd);
        const text = decodeUtf8(payload).replace(/\0+$/g, "").trim();
        const key = mp4MetadataKey(parentType, metadataKeys) || `mp4_${Object.keys(chunks).length + 1}`;
        setMetadataText(chunks, key, text);
      } else if (containerTypes.has(type) || parentType === "ilst") {
        parseBoxes(dataStart + (type === "meta" ? 4 : 0), dataEnd, type);
      } else if (parentType === "ilst") {
        parseBoxes(dataStart, dataEnd, type);
      }

      offset += box.size;
    }
  }

  function parseMp4Keys(start, end) {
    let cursor = start + 4;
    if (cursor + 4 > end) return;

    const count = readUint32(bytes, cursor);
    cursor += 4;
    for (let index = 1; index <= count && cursor + 8 <= end; index++) {
      const size = readUint32(bytes, cursor);
      if (!size || cursor + size > end) break;

      const namespace = decodeLatin1(bytes.subarray(cursor + 4, cursor + 8));
      const name = decodeUtf8(bytes.subarray(cursor + 8, cursor + size)).replace(/\0+$/g, "").trim();
      if (namespace === "mdta" && name) metadataKeys.set(index, name);
      cursor += size;
    }
  }

  parseBoxes(0, bytes.length);

  const parsed = findJsonMetadataObject(decodeUtf8(bytes));
  if (parsed) {
    if (parsed.prompt !== undefined) chunks.prompt = parsed.prompt;
    if (parsed.workflow !== undefined) chunks.workflow = parsed.workflow;
    if (parsed.Prompt !== undefined) chunks.Prompt = parsed.Prompt;
    if (parsed.Workflow !== undefined) chunks.Workflow = parsed.Workflow;
    if (!chunks.workflow && looksLikeWorkflow(parsed)) chunks.workflow = parsed;
  }

  return chunks;
}

function mp4MetadataKey(type, metadataKeys) {
  if (!type) return "";

  if (metadataKeys.size === 0) return type;
  const bytes = [...type].map((char) => char.charCodeAt(0));
  const index = (
    (bytes[0] || 0) * 0x1000000 +
    (bytes[1] || 0) * 0x10000 +
    (bytes[2] || 0) * 0x100 +
    (bytes[3] || 0)
  ) >>> 0;
  return metadataKeys.get(index) || type;
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

function looksLikeWorkflow(value) {
  return Boolean(value && typeof value === "object" && (
    Array.isArray(value.nodes)
    || value.extra?.prompt
    || Array.isArray(value.definitions?.subgraphs)
  ));
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
  if (!chunks.workflow && looksLikeWorkflow(parsed)) chunks.workflow = parsed;
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
  const workflow = parseJsonMetadata(chunks.workflow || chunks.Workflow);
  const prompt = parseJsonMetadata(chunks.prompt || chunks.Prompt) || parseJsonMetadata(workflow?.extra?.prompt);
  const fromChunks = extractFromLooseMetadata(chunks);
  const fromPrompt = extractFromPromptGraph(prompt);
  const fromWorkflow = extractFromWorkflowGraph(workflow);
  const fromDefinitions = extractFromWorkflowDefinitions(workflow);
  const seed = fromPrompt.seed || fromWorkflow.seed || fromDefinitions.seed || fromChunks.seed || "";
  const positive = fromPrompt.positive || fromWorkflow.positive || fromDefinitions.positive || "";
  const negative = fromPrompt.negative || fromWorkflow.negative || fromDefinitions.negative || "";
  const source = fromPrompt.source || fromWorkflow.source || fromDefinitions.source || fromChunks.source || "";
  const graphDetails = mergeMetadataDetailsByLabel(
    mergeMetadataDetailsByLabel(fromPrompt.details || [], fromWorkflow.details || []),
    fromDefinitions.details || [],
  );
  const details = formatMetadataEntries([
    ...graphDetails,
    ...(fromChunks.details || []),
  ]);
  const found = seed || positive || negative || details.length;

  return {
    seed,
    positive,
    negative,
    details,
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
  const textInputNames = new Set(["text", "value", "string", "prompt", "positive", "negative"]);
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
    if (!/text|string|prompt|caption/i.test(name)) continue;
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

function promptNodeTextInputs(node) {
  return Object.entries(node?.inputs || {})
    .filter(([name]) => /text|string|prompt|caption|input|message/i.test(name));
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
    if (isPromptLink(value)) texts.push(...collectPromptUserInputTexts(prompt, value, visited));
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

    const isTextInput = /text|string|prompt|caption/i.test(name);
    if (textCarrier && !isTextInput) continue;

    if (isPromptLink(value)) {
      texts.push(...collectPromptNodeTexts(prompt, value, visited, isTextInput || Boolean(selectedSwitchInputName), polarity));
    } else if (Array.isArray(value)) {
      for (const child of value) {
        if (isPromptLink(child)) texts.push(...collectPromptNodeTexts(prompt, child, visited, forceText || Boolean(selectedSwitchInputName), polarity));
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
  const details = collectPromptMetadataEntries(prompt);

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
    details,
    source: seedEntries.length || positives.length || negatives.length || details.length ? "prompt" : "",
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

function workflowSubgraphInputName(workflow, slot) {
  const input = workflow?.inputs?.[Number(slot)];
  return String(input?.name || "");
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
        outputName: originId === "-10" ? workflowSubgraphInputName(workflow, originSlot) : workflowOutputName(originNode, originSlot),
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
          outputName: originKey === "-10" ? workflowSubgraphInputName(workflow, originSlot) : workflowOutputName(originNode, originSlot),
        });
      }
    }
  }

  return { workflow, nodes, nodeMap, linkMap };
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
    if (!/text|string|prompt|caption/i.test(String(input?.name || ""))) continue;
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
    .filter((input) => /text|string|prompt|caption|input|message/i.test(String(input?.name || "")));
}

function isWorkflowSubgraphInputOrigin(origin) {
  return String(origin?.originId || "") === "-10";
}

function collectWorkflowExternalInputTexts(origin, maps, visited, context) {
  const externalNode = context?.externalNode;
  const externalMaps = context?.externalMaps;
  const inputName = String(origin?.outputName || workflowSubgraphInputName(maps.workflow, origin?.originSlot));
  if (!externalNode || !externalMaps || !inputName) return [];

  const input = workflowInputByName(externalNode, inputName);
  return workflowInputLinkedTexts(input, externalMaps, new Set(), context?.parentContext || null);
}

function workflowInputLinkedTexts(input, maps, visited, context = null) {
  if (!input) return [];
  if (input.link !== undefined && input.link !== null) {
    const origin = workflowLinkOrigin(maps, input.link);
    if (isWorkflowSubgraphInputOrigin(origin)) {
      return collectWorkflowExternalInputTexts(origin, maps, visited, context);
    }
    return collectWorkflowUserInputTexts(origin?.originId, maps, visited, context);
  }
  return collectStringValues(input.value ?? input.default ?? input.widget?.value);
}

function collectWorkflowUserInputTexts(nodeId, maps, visited = new Set(), context = null) {
  if (!nodeId || visited.has(String(nodeId))) return [];
  visited.add(String(nodeId));

  const node = maps.nodeMap.get(String(nodeId));
  if (!node || isWorkflowSystemNode(node)) return [];

  const selectedSwitchInputName = workflowSwitchSelectedInputName(maps, node);
  if (selectedSwitchInputName) {
    return workflowInputLinkedTexts(workflowInputByName(node, selectedSwitchInputName), maps, visited, context);
  }

  const textInputs = workflowTextInputs(node);
  const preferredNames = preferredUserInputNames(textInputs.map((input) => [String(input?.name || ""), input]));
  if (preferredNames.length) {
    const texts = [];
    for (const name of preferredNames) {
      texts.push(...workflowInputLinkedTexts(workflowInputByName(node, name), maps, visited, context));
    }
    return uniqueNonEmpty(texts);
  }

  if (isWorkflowTextCarrierNode(node) && !workflowNodeHasLinkedTextInput(node)) {
    return uniqueNonEmpty(collectWidgetStringValues(node.widgets_values || []));
  }

  const texts = [];
  for (const input of textInputs) {
    if (input?.link !== undefined && input?.link !== null) texts.push(...workflowInputLinkedTexts(input, maps, visited, context));
  }
  return uniqueNonEmpty(texts);
}

function collectWorkflowTextGenerationInputTexts(node, maps, visited, context) {
  const promptInput = workflowInputByName(node, "prompt")
    || workflowInputByName(node, "text")
    || workflowInputByName(node, "input")
    || workflowInputByName(node, "message")
    || workflowInputByName(node, "messages");
  return workflowInputLinkedTexts(promptInput, maps, new Set(visited), context);
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
    texts.push(...collectWidgetStringValues(node.widgets_values || []));
  }

  for (const input of node.inputs || []) {
    if (selectedSwitchInputName && input.name !== selectedSwitchInputName) continue;

    if (input?.link === undefined || input?.link === null) continue;
    const isTextInput = /text|string|prompt|caption/i.test(String(input.name || ""));
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
  const details = collectWorkflowMetadataEntries(workflow, maps);

  for (const node of maps.nodes) {
    const positiveLink = workflowInputLink(node, "positive");
    const negativeLink = workflowInputLink(node, "negative");
    if (!positiveLink || !negativeLink) continue;

    const positiveOrigin = workflowLinkOrigin(maps, positiveLink);
    const negativeOrigin = workflowLinkOrigin(maps, negativeLink);
    positives.push(...collectWorkflowNodeTexts(positiveOrigin?.originId, maps, new Set(), true, "positive", context));
    negatives.push(...collectWorkflowNodeTexts(negativeOrigin?.originId, maps, new Set(), true, "negative", context));
  }

  return {
    seed: formatSeedEntries(seedEntries),
    positive: joinPrompts(positives),
    negative: joinPrompts(negatives),
    details,
    source: seedEntries.length || positives.length || negatives.length || details.length ? "workflow" : "",
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
    details: collected.details,
    source: collected.seeds.length || collected.positives.length || collected.negatives.length || collected.details.length ? "workflow" : "",
  };
}
