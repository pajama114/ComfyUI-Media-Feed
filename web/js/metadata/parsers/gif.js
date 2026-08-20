import {
  decodeLatin1,
  decodeUtf8,
  findJsonMetadataObject,
  parseJsonMetadata,
} from "./shared.js";

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
