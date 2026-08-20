import {
  decodeLatin1,
  decodeUtf8,
  findJsonMetadataObject,
  looksLikeWorkflow,
  readUint32,
  setMetadataText,
} from "./shared.js";

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

function mp4MetadataKey(type, metadataKeys) {
  if (!type) return "";

  if (metadataKeys.size === 0) return type;
  const bytes = [...type].map((char) => char.charCodeAt(0));
  const index = (
    (bytes[0] || 0) * 0x1000000
    + (bytes[1] || 0) * 0x10000
    + (bytes[2] || 0) * 0x100
    + (bytes[3] || 0)
  ) >>> 0;
  return metadataKeys.get(index) || type;
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

  // Range reads can begin inside media data. Find complete metadata containers
  // that are wholly present in the fetched segment and parse them as roots.
  for (let offset = 0; offset + 8 <= bytes.length; offset++) {
    const typeOffset = offset + 4;
    const isMetadataContainer = (
      bytes[typeOffset] === 0x6d && bytes[typeOffset + 1] === 0x6f && bytes[typeOffset + 2] === 0x6f && bytes[typeOffset + 3] === 0x76 // moov
      || bytes[typeOffset] === 0x75 && bytes[typeOffset + 1] === 0x64 && bytes[typeOffset + 2] === 0x74 && bytes[typeOffset + 3] === 0x61 // udta
      || bytes[typeOffset] === 0x6d && bytes[typeOffset + 1] === 0x65 && bytes[typeOffset + 2] === 0x74 && bytes[typeOffset + 3] === 0x61 // meta
      || bytes[typeOffset] === 0x69 && bytes[typeOffset + 1] === 0x6c && bytes[typeOffset + 2] === 0x73 && bytes[typeOffset + 3] === 0x74 // ilst
    );
    if (!isMetadataContainer) continue;

    const box = readMp4Size(bytes, offset);
    if (!box) continue;
    parseBoxes(offset, offset + box.size);
    offset += box.size - 1;
  }

  const parsed = findJsonMetadataObject(decodeUtf8(bytes));
  if (parsed) {
    chunks.embedded_json = parsed;
    if (parsed.prompt !== undefined) chunks.prompt = parsed.prompt;
    if (parsed.workflow !== undefined) chunks.workflow = parsed.workflow;
    if (parsed.Prompt !== undefined) chunks.Prompt = parsed.Prompt;
    if (parsed.Workflow !== undefined) chunks.Workflow = parsed.Workflow;
    if (!chunks.workflow && looksLikeWorkflow(parsed)) chunks.workflow = parsed;
  }

  return chunks;
}
