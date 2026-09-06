import {
  parseAudioTextMetadata,
  parseGifTextMetadata,
  parseMp4TextMetadata,
  parsePngTextChunks,
  parseWebmTextMetadata,
} from "../metadata_parsers.js";
import { extractPromptMetadata } from "./extractor.js";

const PROMPT_METADATA_CACHE_SIZE = 32;
const RANGE_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_AUTOMATIC_RANGE_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_AUTOMATIC_FULL_RESPONSE_BYTES = 16 * 1024 * 1024;
const PROMPT_AUDIO_EXTENSIONS = new Set(["flac", "m4a", "mp3", "ogg", "opus"]);
const PROMPT_VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "mkv"]);

const promptMetadataCache = new Map();
const pendingPromptMetadata = new Map();
let promptMetadataCacheGeneration = 0;

function promptMetadataCacheKey(item) {
  return String(item?.id || item?.key || "");
}

function getExtension(filename) {
  const cleanName = String(filename || "").split(/[?#]/, 1)[0];
  const dot = cleanName.lastIndexOf(".");
  return dot === -1 ? "" : cleanName.slice(dot + 1).toLowerCase();
}

export function clearPromptMetadataCache() {
  promptMetadataCache.clear();
  pendingPromptMetadata.clear();
  promptMetadataCacheGeneration++;
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

export function getCachedPromptMetadata(item) {
  const key = promptMetadataCacheKey(item);
  if (!key || !promptMetadataCache.has(key)) return null;

  const result = promptMetadataCache.get(key);
  // Refresh the entry's LRU position when it is used by the viewer.
  promptMetadataCache.delete(key);
  promptMetadataCache.set(key, result);
  return result;
}

export async function loadPromptMetadata(item, options = {}) {
  if (!item?.key) {
    return {
      seed: "",
      positive: "",
      negative: "",
      resources: [],
      details: [],
      embeddedJson: {},
      status: "No media item selected.",
    };
  }

  const fullScan = options.fullScan === true;
  const cacheKey = promptMetadataCacheKey(item);
  if (!fullScan) {
    const cached = getCachedPromptMetadata(item);
    if (cached) return cached;
    if (pendingPromptMetadata.has(cacheKey)) return pendingPromptMetadata.get(cacheKey);
  }

  const cacheGeneration = promptMetadataCacheGeneration;
  const extractionContext = {
    outputNodeId: item.nodeId,
  };
  const request = (async () => {
    const extension = getExtension(item.filename);
    const result = !supportsPromptMetadata(extension)
      ? unsupportedMetadataResult()
      : fullScan
        ? await scanFullMetadata(item.url, extension, extractionContext)
        : await scanMetadataRanges(item.url, extension, extractionContext);
    return cacheGeneration === promptMetadataCacheGeneration
      ? rememberPromptMetadata(cacheKey, result)
      : result;
  })();

  if (!fullScan) pendingPromptMetadata.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (!fullScan && pendingPromptMetadata.get(cacheKey) === request) {
      pendingPromptMetadata.delete(cacheKey);
    }
  }
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
    embeddedJson: {},
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
    || result?.details?.length
    || Object.keys(result?.embeddedJson || {}).length
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

async function scanFullMetadata(url, extension, extractionContext = null) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch media metadata: ${response.status}`);

  const chunks = await parseMetadataBytes(new Uint8Array(await response.arrayBuffer()), extension);
  return extractPromptMetadata(chunks, extractionContext);
}

async function scanMetadataRanges(url, extension, extractionContext = null) {
  const firstRange = await fetchRange(url, 0, RANGE_CHUNK_BYTES - 1);
  if (firstRange.requiresFullScan) {
    return emptyMetadataResult(
      "This server cannot range-scan the media safely. Read the full file to scan embedded metadata.",
      { requiresFullScan: true },
    );
  }

  const leadingParts = [firstRange.bytes];
  let leadingChunks = await parseMetadataBytes(leadingParts[0], extension);
  let result = extractPromptMetadata(leadingChunks, extractionContext);
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
    result = extractPromptMetadata(leadingChunks, extractionContext);
    if (metadataFound(result) || nextRange.complete) return result;
    nextOffset += nextRange.bytes.length;
  }

  if (PROMPT_VIDEO_EXTENSIONS.has(extension) && firstRange.total !== null) {
    const tailStart = Math.max(nextOffset, firstRange.total - RANGE_CHUNK_BYTES);
    if (tailStart < firstRange.total) {
      const tailRange = await fetchRange(url, tailStart, firstRange.total - 1);
      if (!tailRange.requiresFullScan) {
        const tailChunks = await parseMetadataBytes(tailRange.bytes, extension);
        result = extractPromptMetadata(mergeChunks(leadingChunks, tailChunks), extractionContext);
        if (metadataFound(result)) return result;
      }
    }
  }

  return emptyMetadataResult(
    "Metadata was not found in the initial range scan. Read the full file to continue scanning.",
    { requiresFullScan: true },
  );
}
