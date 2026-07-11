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

export async function parsePngTextChunks(bytes) {
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

export function parseGifTextMetadata(bytes) {
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

export function parseMp4TextMetadata(bytes) {
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

export function parseWebmTextMetadata(bytes) {
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

export function parseAudioTextMetadata(bytes, extension) {
  if (extension === "mp3") return parseId3TextMetadata(bytes);
  if (extension === "flac") return parseFlacTextMetadata(bytes);
  if (extension === "opus" || extension === "ogg") return parseOggTextMetadata(bytes);
  if (extension === "m4a") return parseMp4TextMetadata(bytes);
  return {};
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
