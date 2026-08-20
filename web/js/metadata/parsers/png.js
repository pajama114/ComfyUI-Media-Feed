import {
  decodeLatin1,
  decodeUtf8,
  findNullByte,
  inflateBytes,
  readUint32,
} from "./shared.js";

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
