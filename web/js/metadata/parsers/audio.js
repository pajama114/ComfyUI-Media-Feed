import { parseMp4TextMetadata } from "./mp4.js";
import {
  decodeLatin1,
  decodeUtf16,
  decodeUtf8,
  findNullByte,
  readSyncsafeUint28,
  readUint32,
  readUint32LittleEndian,
  setMetadataText,
} from "./shared.js";

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
