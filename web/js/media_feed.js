import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "comfyui.media_feed";
const MAX_ITEMS = 256;
const DECODED_IMAGE_CACHE_SIZE = 32;
const PROMPT_METADATA_CACHE_SIZE = 32;
const MAX_METADATA_BYTES = 64 * 1024 * 1024;
const DEFAULT_ITEM_WIDTH = 148;
const DEFAULT_ITEM_HEIGHT = 143;
const MIN_ITEM_HEIGHT = 96;
const MAX_ITEM_HEIGHT = 220;
const ITEM_GAP = 8;
const SCROLLBAR_SPACE = 18;
const RAIL_PADDING = 12;
const OVERSCAN = 5;
const FALLBACK_PANEL_EXTRA_HEIGHT = 80;
const FALLBACK_ROOT_ID = "comfy-media-feed-fallback";
const DEFAULT_PLACEMENT = "bottom";
const DEFAULT_SHOW_PROMPTS = true;
const DEFAULT_SCALE_VIEWER_MEDIA = false;
const SIDE_PLACEMENTS = new Set(["left", "right"]);
const PLACEMENTS = new Set(["top", "right", "bottom", "left"]);
const STORAGE_KEYS = {
  itemHeight: "comfyui-media-feed:item-height",
  placement: "comfyui-media-feed:placement",
  showPrompts: "comfyui-media-feed:show-prompts",
  scaleViewerMedia: "comfyui-media-feed:scale-viewer-media",
};
const ICONS = {
  chevronLeft: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 18-6-6 6-6"></path>
    </svg>
  `,
  chevronRight: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 18 6-6-6-6"></path>
    </svg>
  `,
  close: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6 6 18"></path>
      <path d="m6 6 12 12"></path>
    </svg>
  `,
  copy: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  `,
  externalLink: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 3h6v6"></path>
      <path d="M10 14 21 3"></path>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    </svg>
  `,
  pause: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 4H6v16h4V4Z"></path>
      <path d="M18 4h-4v16h4V4Z"></path>
    </svg>
  `,
  play: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8 5 11 7-11 7V5Z"></path>
    </svg>
  `,
};

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "webp"]);
const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mkv", "mov", "mp4", "webm"]);
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav"]);
const PROMPT_AUDIO_EXTENSIONS = new Set(["flac", "m4a", "mp3", "ogg", "opus"]);

const state = {
  items: [],
  itemKeys: new Set(),
  filter: "all",
  views: new Set(),
  sequence: 0,
  itemHeight: DEFAULT_ITEM_HEIGHT,
  itemWidth: DEFAULT_ITEM_WIDTH,
  placement: DEFAULT_PLACEMENT,
  showPrompts: DEFAULT_SHOW_PROMPTS,
  scaleViewerMedia: DEFAULT_SCALE_VIEWER_MEDIA,
};

const decodedImageCache = new Map();
const promptMetadataCache = new Map();
let bottomPanelView = null;
let floatingView = null;
let setupComplete = false;
let placementSettingSeen = false;
let promptSettingSeen = false;
let scaleViewerMediaSettingSeen = false;
let viewer = null;
let viewerWheelLock = false;

function getExtension(filename) {
  const cleanName = String(filename || "").split(/[?#]/, 1)[0];
  const dot = cleanName.lastIndexOf(".");
  return dot === -1 ? "" : cleanName.slice(dot + 1).toLowerCase();
}

function getMediaKind(filename, parentKey = "") {
  const extension = getExtension(filename);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";

  const key = parentKey.toLowerCase();
  if (key.includes("image")) return "image";
  if (key.includes("video") || key.includes("gif")) return "video";
  if (key.includes("audio") || key.includes("sound")) return "audio";

  return null;
}

function apiUrl(path) {
  if (api?.apiURL) return api.apiURL(path);
  return path;
}

function buildViewUrl(file) {
  const params = new URLSearchParams();
  params.set("filename", file.filename);
  params.set("subfolder", file.subfolder || "");
  params.set("type", file.type || "output");
  return apiUrl(`/view?${params.toString()}`);
}

function mediaKey(file, kind) {
  return [
    kind,
    file.type || "output",
    file.subfolder || "",
    file.filename,
  ].join(":");
}

function collectMedia(output, promptId, nodeId) {
  const results = [];
  const seen = new Set();

  function walk(value, parentKey = "") {
    if (!value) return;

    if (Array.isArray(value)) {
      for (const child of value) walk(child, parentKey);
      return;
    }

    if (typeof value !== "object") return;

    if (typeof value.filename === "string") {
      const kind = getMediaKind(value.filename, parentKey);
      if (kind) {
        const file = {
          filename: value.filename,
          subfolder: value.subfolder || "",
          type: value.type || "output",
        };
        const key = mediaKey(file, kind);
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            id: `${Date.now()}-${state.sequence++}`,
            key,
            kind,
            filename: file.filename,
            subfolder: file.subfolder,
            type: file.type,
            url: buildViewUrl(file),
            promptId: promptId || "",
            nodeId: nodeId || "",
            createdAt: Date.now(),
          });
        }
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === "filename" || key === "subfolder" || key === "type") continue;
      walk(child, key);
    }
  }

  walk(output);
  return results;
}

function addItems(items) {
  const freshItems = [];

  for (const item of items) {
    if (state.itemKeys.has(item.key)) {
      const existingIndex = state.items.findIndex((current) => current.key === item.key);
      if (existingIndex !== -1) state.items.splice(existingIndex, 1);
    }
    state.itemKeys.add(item.key);
    freshItems.push(item);
  }

  if (!freshItems.length) return;

  state.items.unshift(...freshItems.reverse());
  while (state.items.length > MAX_ITEMS) {
    const removed = state.items.pop();
    if (removed) state.itemKeys.delete(removed.key);
  }

  updateViews(!isViewerOpen());
  syncViewerItems();
}

function filteredItems() {
  if (state.filter === "all") return state.items;
  return state.items.filter((item) => item.kind === state.filter);
}

function isViewerOpen() {
  return viewer?.root?.dataset.open === "true";
}

function viewPitch(view) {
  return (isVerticalView(view) ? state.itemHeight : state.itemWidth) + ITEM_GAP;
}

function viewportHeight() {
  return state.itemHeight + SCROLLBAR_SPACE + 22;
}

function railHeight() {
  return state.itemHeight + SCROLLBAR_SPACE + 20;
}

function fallbackPanelHeight() {
  return state.itemHeight + SCROLLBAR_SPACE + FALLBACK_PANEL_EXTRA_HEIGHT;
}

function normalizeThumbnailHeight(nextHeight) {
  return Math.min(MAX_ITEM_HEIGHT, Math.max(MIN_ITEM_HEIGHT, Number(nextHeight) || DEFAULT_ITEM_HEIGHT));
}

function normalizePlacement(nextPlacement) {
  const placement = String(nextPlacement || "").toLowerCase();
  return PLACEMENTS.has(placement) ? placement : DEFAULT_PLACEMENT;
}

function normalizeBooleanSetting(nextValue) {
  return nextValue === true || nextValue === "true" || nextValue === "True" || nextValue === "1";
}

function isVerticalPlacement(placement = state.placement) {
  return SIDE_PLACEMENTS.has(placement);
}

function isVerticalView(view) {
  return view?.root?.dataset.orientation === "vertical";
}

function applyThumbnailHeight(nextHeight) {
  const itemHeight = normalizeThumbnailHeight(nextHeight);
  state.itemHeight = itemHeight;
  state.itemWidth = Math.round(itemHeight * DEFAULT_ITEM_WIDTH / DEFAULT_ITEM_HEIGHT);
}

function applyPlacement(nextPlacement) {
  state.placement = normalizePlacement(nextPlacement);
}

function applyShowPrompts(nextValue) {
  state.showPrompts = normalizeBooleanSetting(nextValue);
}

function applyScaleViewerMedia(nextValue) {
  state.scaleViewerMedia = normalizeBooleanSetting(nextValue);
}

function loadSavedPlacement() {
  try {
    return normalizePlacement(window.localStorage?.getItem(STORAGE_KEYS.placement));
  } catch {
    return DEFAULT_PLACEMENT;
  }
}

function loadSavedShowPrompts() {
  try {
    const savedValue = window.localStorage?.getItem(STORAGE_KEYS.showPrompts);
    return savedValue === null ? DEFAULT_SHOW_PROMPTS : normalizeBooleanSetting(savedValue);
  } catch {
    return DEFAULT_SHOW_PROMPTS;
  }
}

function loadSavedScaleViewerMedia() {
  try {
    const savedValue = window.localStorage?.getItem(STORAGE_KEYS.scaleViewerMedia);
    return savedValue === null ? DEFAULT_SCALE_VIEWER_MEDIA : normalizeBooleanSetting(savedValue);
  } catch {
    return DEFAULT_SCALE_VIEWER_MEDIA;
  }
}

function loadSettings() {
  try {
    const savedHeight = window.localStorage?.getItem(STORAGE_KEYS.itemHeight);
    if (savedHeight !== null) applyThumbnailHeight(savedHeight);
  } catch {
    applyThumbnailHeight(DEFAULT_ITEM_HEIGHT);
  }

  if (!placementSettingSeen) applyPlacement(loadSavedPlacement());
  if (!promptSettingSeen) applyShowPrompts(loadSavedShowPrompts());
  if (!scaleViewerMediaSettingSeen) applyScaleViewerMedia(loadSavedScaleViewerMedia());
}

function saveThumbnailHeight() {
  try {
    window.localStorage?.setItem(STORAGE_KEYS.itemHeight, String(state.itemHeight));
  } catch {
    // Ignore storage failures; the feed should keep working with in-memory settings.
  }
}

function savePlacement() {
  try {
    window.localStorage?.setItem(STORAGE_KEYS.placement, state.placement);
  } catch {
    // Ignore storage failures; the feed should keep working with in-memory settings.
  }
}

function saveShowPrompts() {
  try {
    window.localStorage?.setItem(STORAGE_KEYS.showPrompts, String(state.showPrompts));
  } catch {
    // Ignore storage failures; the feed should keep working with in-memory settings.
  }
}

function saveScaleViewerMedia() {
  try {
    window.localStorage?.setItem(STORAGE_KEYS.scaleViewerMedia, String(state.scaleViewerMedia));
  } catch {
    // Ignore storage failures; the feed should keep working with in-memory settings.
  }
}

function setThumbnailHeight(nextHeight) {
  applyThumbnailHeight(nextHeight);
  saveThumbnailHeight();
  updateViews(false);
}

function setShowPrompts(nextValue) {
  applyShowPrompts(nextValue);
  saveShowPrompts();
  updateViewerPromptPanel();
}

function setScaleViewerMedia(nextValue) {
  applyScaleViewerMedia(nextValue);
  saveScaleViewerMedia();
  syncViewerScaleMedia();
}

function setPlacement(nextPlacement) {
  applyPlacement(nextPlacement);
  savePlacement();
  syncBottomPanelVisibility();
  if (setupComplete) syncFloatingPanel();
  updateViews(false);
}

function ensureStyles() {
  if (document.getElementById("comfy-media-feed-styles")) return;

  const style = document.createElement("style");
  style.id = "comfy-media-feed-styles";
  style.textContent = `
    .cmf-root {
      --cmf-bg: var(--comfy-menu-bg, var(--content-bg, var(--bg-color, #131418)));
      --cmf-panel: var(--comfy-input-bg, var(--content-bg, var(--bg-color, rgba(255, 255, 255, 0.055))));
      --cmf-border: var(--border-color, rgba(255, 255, 255, 0.12));
      --cmf-text: var(--fg-color, var(--comfy-menu-text, rgba(255, 255, 255, 0.86)));
      --cmf-muted: var(--descrip-text, var(--comfy-menu-secondary-text, rgba(255, 255, 255, 0.58)));
      --cmf-accent: var(--p-primary-color, var(--comfy-accent, #4db6ac));
      --cmf-button-bg: var(--comfy-input-bg, rgba(255, 255, 255, 0.06));
      --cmf-button-hover: var(--content-bg, rgba(255, 255, 255, 0.1));
      --cmf-view-bg: var(--bg-color, rgba(0, 0, 0, 0.22));
      --cmf-viewer-bg: rgba(0, 0, 0, 0.82);
      --cmf-viewer-bar-bg: var(--comfy-menu-bg, rgba(16, 17, 19, 0.94));
      --cmf-item-width: ${DEFAULT_ITEM_WIDTH}px;
      --cmf-item-height: ${DEFAULT_ITEM_HEIGHT}px;
      --cmf-panel-height: ${fallbackPanelHeight()}px;
      --cmf-rail-height: ${railHeight()}px;
      --cmf-viewport-height: ${viewportHeight()}px;
      --cmf-safe-left: 76px;
      --cmf-safe-right: 300px;
      --cmf-safe-top: 118px;
      --cmf-safe-bottom: 12px;
      --cmf-minimap-height: 300px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 8px;
      height: 100%;
      min-height: 170px;
      padding: 10px;
      background: var(--cmf-bg);
      color: var(--cmf-text);
      font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .cmf-root.cmf-fallback {
      position: fixed;
      z-index: 10;
      overflow: hidden;
      border: 1px solid var(--cmf-border);
      border-radius: 8px;
    }

    .cmf-root.cmf-fallback[data-orientation="horizontal"] {
      left: var(--cmf-safe-left);
      height: min(var(--cmf-panel-height), calc(100vh - var(--cmf-safe-top) - 24px));
      min-height: 0;
    }

    .cmf-root.cmf-fallback[data-placement="bottom"] {
      right: var(--cmf-safe-right);
      bottom: var(--cmf-safe-bottom);
    }

    .cmf-root.cmf-fallback[data-placement="top"] {
      top: var(--cmf-safe-top);
      right: 12px;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] {
      top: var(--cmf-safe-top);
      width: clamp(196px, calc(var(--cmf-item-width) + 58px), 340px);
      height: auto;
      min-height: 0;
    }

    .cmf-root.cmf-fallback[data-placement="left"] {
      bottom: 24px;
      left: var(--cmf-safe-left);
    }

    .cmf-root.cmf-fallback[data-placement="right"] {
      right: 12px;
      bottom: var(--cmf-minimap-height);
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-toolbar {
      flex-wrap: wrap;
      align-content: flex-start;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-title {
      flex: 1 1 auto;
      order: 1;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-collapse,
    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-clear {
      order: 2;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-spacer {
      display: none;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-filter {
      flex: 1 1 100%;
      order: 3;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-count {
      flex: 1 1 100%;
      order: 4;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-size-control {
      flex: 1 1 100%;
      order: 5;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-size-control input {
      flex: 1;
      width: auto;
      min-width: 0;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-filter button {
      flex: 1 1 auto;
      padding: 0 7px;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-viewport {
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-rail {
      width: 100%;
      min-width: 0;
      min-height: 100%;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-card {
      top: 0;
      left: ${RAIL_PADDING}px;
      width: calc(100% - ${RAIL_PADDING * 2}px);
    }

    .cmf-root.cmf-fallback[data-collapsed="true"] {
      inset: auto;
      width: 260px;
      height: 44px;
      min-height: 44px;
      overflow: hidden;
    }

    .cmf-root.cmf-fallback[data-collapsed="true"][data-placement="bottom"] {
      bottom: var(--cmf-safe-bottom);
      left: var(--cmf-safe-left);
    }

    .cmf-root.cmf-fallback[data-collapsed="true"][data-placement="top"],
    .cmf-root.cmf-fallback[data-collapsed="true"][data-placement="left"] {
      top: var(--cmf-safe-top);
      left: var(--cmf-safe-left);
    }

    .cmf-root.cmf-fallback[data-collapsed="true"][data-placement="right"] {
      top: var(--cmf-safe-top);
      right: 12px;
    }

    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-viewport,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-filter,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-count,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-size-control,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-clear {
      display: none;
    }

    @media (max-width: 980px) {
      .cmf-root.cmf-fallback[data-orientation="horizontal"] {
        right: 12px;
        left: 64px;
      }
    }

    @media (max-width: 720px) {
      .cmf-root.cmf-fallback,
      .cmf-root.cmf-fallback[data-collapsed="true"] {
        right: 12px;
        left: 12px;
        width: auto;
      }
    }

    .cmf-root *,
    .cmf-root *::before,
    .cmf-root *::after {
      box-sizing: border-box;
    }

    .cmf-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 28px;
    }

    .cmf-spacer {
      flex: 1;
    }

    .cmf-title {
      flex: 0 0 auto;
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
    }

    .cmf-count {
      color: var(--cmf-muted);
      white-space: nowrap;
    }

    .cmf-size-control {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--cmf-muted);
      white-space: nowrap;
    }

    .cmf-size-control input {
      width: 104px;
      accent-color: var(--cmf-accent);
      cursor: pointer;
    }

    .cmf-button {
      min-width: 0;
      height: 28px;
      padding: 0 10px;
      border: 1px solid var(--cmf-border);
      border-radius: 6px;
      background: var(--cmf-button-bg);
      color: var(--cmf-text);
      cursor: pointer;
      font: inherit;
    }

    .cmf-button:hover {
      background: var(--cmf-button-hover);
    }

    .cmf-icon-button {
      display: grid;
      place-items: center;
      width: 30px;
      min-width: 30px;
      padding: 0;
    }

    .cmf-icon-button svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 2;
    }

    .cmf-filter {
      display: inline-flex;
      overflow: hidden;
      border: 1px solid var(--cmf-border);
      border-radius: 6px;
    }

    .cmf-filter button {
      height: 28px;
      padding: 0 10px;
      border: 0;
      border-right: 1px solid var(--cmf-border);
      background: transparent;
      color: var(--cmf-muted);
      cursor: pointer;
      font: inherit;
    }

    .cmf-filter button:last-child {
      border-right: 0;
    }

    .cmf-filter button[aria-pressed="true"] {
      background: var(--cmf-panel);
      background: color-mix(in srgb, var(--cmf-accent) 24%, var(--cmf-panel));
      color: var(--cmf-text);
    }

    .cmf-viewport {
      position: relative;
      flex: 1;
      min-height: var(--cmf-viewport-height);
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-color: color-mix(in srgb, var(--cmf-text) 32%, transparent) color-mix(in srgb, var(--cmf-bg) 82%, transparent);
      scrollbar-width: thin;
      border: 1px solid var(--cmf-border);
      border-radius: 8px;
      background: var(--cmf-view-bg);
    }

    .cmf-viewport::-webkit-scrollbar {
      height: 12px;
    }

    .cmf-viewport::-webkit-scrollbar-track {
      border-radius: 0 0 8px 8px;
      background: color-mix(in srgb, var(--cmf-bg) 82%, transparent);
    }

    .cmf-viewport::-webkit-scrollbar-thumb {
      min-width: 36px;
      border: 3px solid color-mix(in srgb, var(--cmf-bg) 82%, transparent);
      border-radius: 999px;
      background: color-mix(in srgb, var(--cmf-text) 32%, transparent);
    }

    .cmf-viewport::-webkit-scrollbar-thumb:hover {
      background: color-mix(in srgb, var(--cmf-text) 44%, transparent);
    }

    .cmf-rail {
      position: relative;
      height: var(--cmf-rail-height);
      min-width: 100%;
    }

    .cmf-empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--cmf-muted);
      pointer-events: none;
    }

    .cmf-card {
      position: absolute;
      top: 10px;
      display: flex;
      flex-direction: column;
      width: var(--cmf-item-width);
      height: var(--cmf-item-height);
      overflow: hidden;
      border: 1px solid var(--cmf-border);
      border-radius: 8px;
      background: var(--cmf-panel);
      color: var(--cmf-text);
      cursor: pointer;
    }

    .cmf-card:hover,
    .cmf-card:focus-visible {
      border-color: var(--cmf-accent);
      outline: none;
    }

    .cmf-preview {
      display: grid;
      flex: 1 1 auto;
      place-items: center;
      width: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--cmf-view-bg);
    }

    .cmf-preview img,
    .cmf-preview video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .cmf-audio-preview {
      display: grid;
      grid-template-rows: 1fr auto;
      gap: 8px;
      width: 100%;
      height: 100%;
      padding: 8px;
    }

    .cmf-audio-main {
      display: grid;
      place-items: center;
      min-height: 0;
    }

    .cmf-audio-controls {
      display: grid;
      grid-template-columns: 30px 1fr;
      align-items: center;
      gap: 8px;
      width: 100%;
    }

    .cmf-audio-seek {
      width: 100%;
      min-width: 0;
      accent-color: var(--cmf-accent);
      cursor: pointer;
    }

    .cmf-audio-preview audio {
      display: none;
    }

    .cmf-kind {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--cmf-panel);
      background: color-mix(in srgb, var(--cmf-accent) 24%, var(--cmf-panel));
      color: var(--cmf-text);
      font-size: 11px;
      text-transform: uppercase;
    }

    .cmf-viewer {
      --cmf-panel: var(--comfy-input-bg, var(--content-bg, var(--bg-color, rgba(255, 255, 255, 0.055))));
      --cmf-border: var(--border-color, rgba(255, 255, 255, 0.12));
      --cmf-text: var(--fg-color, var(--comfy-menu-text, rgba(255, 255, 255, 0.86)));
      --cmf-muted: var(--descrip-text, var(--comfy-menu-secondary-text, rgba(255, 255, 255, 0.58)));
      --cmf-button-bg: var(--comfy-input-bg, rgba(255, 255, 255, 0.06));
      --cmf-button-hover: var(--content-bg, rgba(255, 255, 255, 0.1));
      --cmf-viewer-bg: rgba(0, 0, 0, 0.82);
      --cmf-viewer-bar-bg: var(--comfy-menu-bg, rgba(16, 17, 19, 0.94));
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: none;
      grid-template-rows: auto 1fr;
      background: var(--cmf-viewer-bg);
      color: var(--cmf-text);
    }

    .cmf-viewer[data-open="true"] {
      display: grid;
    }

    .cmf-viewer-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 42px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--cmf-border);
      background: var(--cmf-viewer-bar-bg);
    }

    .cmf-viewer-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cmf-viewer-body {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      gap: 14px;
      place-items: center;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      padding: 14px;
    }

    .cmf-viewer-body[data-prompts="true"] {
      grid-template-columns: minmax(0, 1fr) clamp(260px, 26vw, 360px);
      align-items: stretch;
      place-items: stretch;
    }

    .cmf-viewer-main {
      position: relative;
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .cmf-viewer-media {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .cmf-viewer-media img,
    .cmf-viewer-media video {
      display: block;
      min-width: 0;
      min-height: 0;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    .cmf-viewer[data-scale-media="true"] .cmf-viewer-media img,
    .cmf-viewer[data-scale-media="true"] .cmf-viewer-media video {
      width: 100%;
      height: 100%;
    }

    .cmf-viewer-media audio {
      width: min(720px, 90vw);
    }

    .cmf-prompt-panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      padding: 12px;
      border: 1px solid var(--cmf-border);
      border-radius: 8px;
      background: var(--cmf-viewer-bar-bg);
      color: var(--cmf-text);
    }

    .cmf-prompt-panel[hidden] {
      display: none;
    }

    .cmf-prompt-panel-title {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
    }

    .cmf-prompt-status {
      color: var(--cmf-muted);
      font-size: 12px;
    }

    .cmf-prompt-section {
      display: grid;
      gap: 5px;
      min-height: 0;
    }

    .cmf-prompt-section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .cmf-prompt-heading {
      margin: 0;
      flex: 1 1 auto;
      color: var(--cmf-muted);
      font-size: 11px;
      font-weight: 650;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .cmf-prompt-copy {
      width: 26px;
      min-width: 26px;
      height: 24px;
    }

    .cmf-prompt-copy svg {
      width: 14px;
      height: 14px;
    }

    .cmf-prompt-text {
      min-height: 76px;
      max-height: 34vh;
      overflow: auto;
      margin: 0;
      padding: 9px;
      border: 1px solid var(--cmf-border);
      border-radius: 6px;
      background: var(--cmf-panel);
      color: var(--cmf-text);
      font: 13.2px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .cmf-seed-text {
      min-height: 0;
      max-height: 16vh;
    }

    @media (max-width: 860px) {
      .cmf-viewer-body[data-prompts="true"] {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) minmax(180px, 34vh);
      }

      .cmf-prompt-panel {
        max-width: none;
      }
    }

    .cmf-nav-button {
      position: absolute;
      top: 50%;
      z-index: 1;
      width: 42px;
      min-width: 42px;
      height: 54px;
      transform: translateY(-50%);
      border-radius: 8px;
      background: var(--cmf-panel);
    }

    .cmf-nav-button:disabled {
      opacity: 0.32;
      cursor: default;
    }

    .cmf-nav-button svg {
      width: 24px;
      height: 24px;
    }

    .cmf-nav-prev {
      left: 12px;
    }

    .cmf-nav-next {
      right: 12px;
    }
  `;
  document.head.appendChild(style);
}

function rememberDecodedImage(url, image) {
  if (!url || !image?.complete) return;
  decodedImageCache.delete(url);
  decodedImageCache.set(url, image);

  while (decodedImageCache.size > DECODED_IMAGE_CACHE_SIZE) {
    const oldestKey = decodedImageCache.keys().next().value;
    decodedImageCache.delete(oldestKey);
  }
}

function warmImage(url) {
  if (decodedImageCache.has(url)) return Promise.resolve(decodedImageCache.get(url));

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = async () => {
      try {
        await image.decode?.();
      } catch {
        // The image is still usable if decode() is not supported or rejects.
      }
      rememberDecodedImage(url, image);
      resolve(image);
    };
    image.onerror = reject;
    image.src = url;
  });
}

async function copyPromptText(event, source) {
  const button = event.currentTarget;
  button.blur();

  const text = String(source?.textContent || "");
  if (!text.trim()) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      try {
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
      } finally {
        textarea.remove();
      }
    }
  } catch {
    return;
  }

  const previousTitle = button.title;
  button.title = "Copied";
  button.setAttribute("aria-label", "Copied");
  window.setTimeout(() => {
    button.title = previousTitle;
    button.setAttribute("aria-label", previousTitle);
  }, 900);
}

function ensureViewer() {
  if (viewer) return viewer;

  ensureStyles();

  const root = document.createElement("div");
  root.className = "cmf-viewer";
  root.tabIndex = -1;
  root.dataset.scaleMedia = String(state.scaleViewerMedia);
  root.innerHTML = `
    <div class="cmf-viewer-bar">
      <div class="cmf-viewer-title"></div>
      <div class="cmf-spacer"></div>
      <a class="cmf-button cmf-icon-button cmf-open-link" target="_blank" rel="noopener noreferrer" title="Open original" aria-label="Open original">${ICONS.externalLink}</a>
      <button class="cmf-button cmf-icon-button cmf-close" type="button" title="Close" aria-label="Close">${ICONS.close}</button>
    </div>
    <div class="cmf-viewer-body">
      <section class="cmf-viewer-main" aria-label="Media preview">
        <button class="cmf-button cmf-icon-button cmf-nav-button cmf-nav-prev" type="button" title="Previous" aria-label="Previous">${ICONS.chevronLeft}</button>
        <button class="cmf-button cmf-icon-button cmf-nav-button cmf-nav-next" type="button" title="Next" aria-label="Next">${ICONS.chevronRight}</button>
        <div class="cmf-viewer-media"></div>
      </section>
      <aside class="cmf-prompt-panel" hidden aria-label="Metadata">
        <h2 class="cmf-prompt-panel-title">Metadata</h2>
        <div class="cmf-prompt-status"></div>
        <section class="cmf-prompt-section">
          <div class="cmf-prompt-section-header">
            <h2 class="cmf-prompt-heading">Prompt</h2>
            <button class="cmf-button cmf-icon-button cmf-prompt-copy cmf-copy-positive" type="button" title="Copy prompt" aria-label="Copy prompt">${ICONS.copy}</button>
          </div>
          <pre class="cmf-prompt-text cmf-prompt-positive"></pre>
        </section>
        <section class="cmf-prompt-section">
          <div class="cmf-prompt-section-header">
            <h2 class="cmf-prompt-heading">Negative Prompt</h2>
            <button class="cmf-button cmf-icon-button cmf-prompt-copy cmf-copy-negative" type="button" title="Copy negative prompt" aria-label="Copy negative prompt">${ICONS.copy}</button>
          </div>
          <pre class="cmf-prompt-text cmf-prompt-negative"></pre>
        </section>
        <section class="cmf-prompt-section">
          <div class="cmf-prompt-section-header">
            <h2 class="cmf-prompt-heading">Seed</h2>
            <button class="cmf-button cmf-icon-button cmf-prompt-copy cmf-copy-seed" type="button" title="Copy seed" aria-label="Copy seed">${ICONS.copy}</button>
          </div>
          <pre class="cmf-prompt-text cmf-seed-text"></pre>
        </section>
      </aside>
    </div>
  `;

  root.addEventListener("click", handleViewerBackdropClick);
  root.querySelector(".cmf-close").addEventListener("click", closeViewer);
  root.querySelector(".cmf-copy-seed").addEventListener("click", (event) => copyPromptText(event, viewer?.promptSeed));
  root.querySelector(".cmf-copy-positive").addEventListener("click", (event) => copyPromptText(event, viewer?.promptPositive));
  root.querySelector(".cmf-copy-negative").addEventListener("click", (event) => copyPromptText(event, viewer?.promptNegative));
  root.addEventListener("keydown", handleViewerControlKeydown, true);
  for (const button of root.querySelectorAll(".cmf-nav-button")) {
    button.addEventListener("mousedown", (event) => event.preventDefault());
  }
  root.querySelector(".cmf-nav-prev").addEventListener("click", (event) => {
    event.currentTarget.blur();
    showViewerRelative(-1);
  });
  root.querySelector(".cmf-nav-next").addEventListener("click", (event) => {
    event.currentTarget.blur();
    showViewerRelative(1);
  });
  root.addEventListener("wheel", handleViewerWheel, { passive: false });
  document.addEventListener("keydown", handleViewerGlobalKeydown, true);

  document.body.appendChild(root);
  viewer = {
    root,
    title: root.querySelector(".cmf-viewer-title"),
    body: root.querySelector(".cmf-viewer-body"),
    main: root.querySelector(".cmf-viewer-main"),
    media: root.querySelector(".cmf-viewer-media"),
    promptPanel: root.querySelector(".cmf-prompt-panel"),
    promptStatus: root.querySelector(".cmf-prompt-status"),
    promptSeed: root.querySelector(".cmf-seed-text"),
    promptPositive: root.querySelector(".cmf-prompt-positive"),
    promptNegative: root.querySelector(".cmf-prompt-negative"),
    openLink: root.querySelector(".cmf-open-link"),
    prevButton: root.querySelector(".cmf-nav-prev"),
    nextButton: root.querySelector(".cmf-nav-next"),
    promptRequestId: 0,
    item: null,
    items: [],
    index: -1,
  };
  return viewer;
}

function syncViewerScaleMedia() {
  if (!viewer) return;
  viewer.root.dataset.scaleMedia = String(state.scaleViewerMedia);
}

function closeViewer() {
  if (!viewer) return;
  viewer.root.dataset.open = "false";
  viewer.promptRequestId++;
  viewer.body.dataset.prompts = "false";
  viewer.promptPanel.hidden = true;
  viewer.media.replaceChildren();
  viewer.item = null;
  viewer.items = [];
  viewer.index = -1;
}

function openViewer(item, thumbnail) {
  const currentViewer = ensureViewer();
  const items = filteredItems();
  const index = Math.max(0, items.findIndex((current) => current.key === item.key));
  currentViewer.items = items;
  currentViewer.index = index;
  currentViewer.title.textContent = item.filename;
  currentViewer.root.dataset.open = "true";
  currentViewer.root.focus({ preventScroll: true });
  renderViewerItem(item, thumbnail);
  updateViewerPromptPanel();
}

function showViewerRelative(direction) {
  if (!viewer || viewer.root.dataset.open !== "true") return;
  syncViewerItems();

  const nextIndex = viewer.index + direction;
  if (nextIndex < 0 || nextIndex >= viewer.items.length) return;

  viewer.index = nextIndex;
  renderViewerItem(viewer.items[nextIndex]);
  updateViewerPromptPanel();
}

function syncViewerNav() {
  if (!viewer) return;
  viewer.prevButton.disabled = viewer.index <= 0;
  viewer.nextButton.disabled = viewer.index >= viewer.items.length - 1;
}

function syncViewerItems() {
  if (!viewer || viewer.root.dataset.open !== "true" || !viewer.item) return;

  const items = filteredItems();
  const index = items.findIndex((current) => current.key === viewer.item.key);
  viewer.items = items;
  if (index !== -1) {
    viewer.index = index;
    viewer.item = items[index];
  } else {
    viewer.index = Math.min(viewer.index, Math.max(0, items.length - 1));
  }
  syncViewerNav();
}

function handleViewerControlKeydown(event) {
  if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  if (!event.target.closest?.(".cmf-viewer")) return;

  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function handleViewerGlobalKeydown(event) {
  if (!isViewerOpen()) return;

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeViewer();
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    event.stopImmediatePropagation();
    showViewerRelative(-1);
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    event.stopImmediatePropagation();
    showViewerRelative(1);
  }
}

function handleViewerWheel(event) {
  if (!viewer || viewer.root.dataset.open !== "true") return;
  if (Math.abs(event.deltaY) < 8 && Math.abs(event.deltaX) < 8) return;

  event.preventDefault();
  event.stopPropagation();
  if (viewerWheelLock) return;

  viewerWheelLock = true;
  window.setTimeout(() => {
    viewerWheelLock = false;
  }, 180);

  const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  showViewerRelative(dominantDelta > 0 ? 1 : -1);
}

function viewerMediaNaturalSize(element) {
  if (element instanceof HTMLImageElement) {
    return { width: element.naturalWidth, height: element.naturalHeight };
  }

  if (element instanceof HTMLVideoElement) {
    return { width: element.videoWidth, height: element.videoHeight };
  }

  return { width: 0, height: 0 };
}

function isInsideContainedMedia(event, element) {
  const rect = element.getBoundingClientRect();
  const natural = viewerMediaNaturalSize(element);
  if (!rect.width || !rect.height || !natural.width || !natural.height) return true;

  const scale = Math.min(rect.width / natural.width, rect.height / natural.height);
  const width = natural.width * scale;
  const height = natural.height * scale;
  const left = rect.left + (rect.width - width) / 2;
  const top = rect.top + (rect.height - height) / 2;
  const right = left + width;
  const bottom = top + height;
  const tolerance = 1;

  return event.clientX >= left - tolerance
    && event.clientX <= right + tolerance
    && event.clientY >= top - tolerance
    && event.clientY <= bottom + tolerance;
}

function handleViewerBackdropClick(event) {
  if (event.target === viewer?.root || event.target === viewer?.body || event.target === viewer?.main || event.target === viewer?.media) {
    closeViewer();
    return;
  }

  if (!state.scaleViewerMedia || !viewer?.media) return;

  const element = event.target instanceof Element
    ? event.target.closest(".cmf-viewer-media img, .cmf-viewer-media video")
    : null;
  if (!element || !viewer.media.contains(element)) return;

  if (element instanceof HTMLVideoElement && element.controls) {
    const rect = element.getBoundingClientRect();
    if (event.clientY >= rect.bottom - 48) return;
  }

  if (!isInsideContainedMedia(event, element)) closeViewer();
}

async function renderViewerItem(item, thumbnail) {
  const currentViewer = ensureViewer();
  currentViewer.item = item;
  currentViewer.title.textContent = item.filename;
  currentViewer.openLink.href = item.url;
  currentViewer.media.replaceChildren();
  syncViewerNav();

  if (item.kind === "image") {
    const image = document.createElement("img");
    image.alt = item.filename;
    image.decoding = "async";

    const cached = decodedImageCache.get(item.url);
    if (cached?.complete) {
      image.src = cached.currentSrc || cached.src;
      currentViewer.media.appendChild(image);
      return;
    }

    if (thumbnail?.complete) {
      rememberDecodedImage(item.url, thumbnail);
      image.src = thumbnail.currentSrc || thumbnail.src;
      currentViewer.media.appendChild(image);
      return;
    }

    image.src = item.url;
    currentViewer.media.appendChild(image);
    try {
      await warmImage(item.url);
    } catch {
      // Keep the normal image element in place so the browser can show its error UI.
    }
    return;
  }

  if (item.kind === "video") {
    const video = document.createElement("video");
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.src = item.url;
    currentViewer.media.appendChild(video);
    return;
  }

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.autoplay = true;
  audio.src = item.url;
  currentViewer.media.appendChild(audio);
}

function resetViewerPromptPanel(status = "") {
  if (!viewer) return;
  viewer.promptStatus.textContent = status;
  viewer.promptSeed.textContent = "";
  viewer.promptPositive.textContent = "";
  viewer.promptNegative.textContent = "";
}

function renderPromptMetadata(result) {
  if (!viewer) return;
  viewer.promptStatus.textContent = result.status || "";
  viewer.promptSeed.textContent = result.seed || "(not found)";
  viewer.promptPositive.textContent = result.positive || "(not found)";
  viewer.promptNegative.textContent = result.negative || "(not found)";
}

function updateViewerPromptPanel() {
  if (!viewer || viewer.root.dataset.open !== "true") return;

  const item = viewer.item;
  const shouldShow = state.showPrompts && (item?.kind === "image" || item?.kind === "video" || item?.kind === "audio");
  viewer.promptRequestId++;
  viewer.body.dataset.prompts = String(shouldShow);
  viewer.promptPanel.hidden = !shouldShow;

  if (!shouldShow) {
    resetViewerPromptPanel();
    return;
  }

  const requestId = viewer.promptRequestId;
  resetViewerPromptPanel("Loading embedded prompt metadata...");

  loadPromptMetadata(item)
    .then((result) => {
      if (!viewer || requestId !== viewer.promptRequestId || viewer.item?.key !== item.key) return;
      renderPromptMetadata(result);
    })
    .catch(() => {
      if (!viewer || requestId !== viewer.promptRequestId || viewer.item?.key !== item.key) return;
      renderPromptMetadata({
        seed: "",
        positive: "",
        negative: "",
        status: "Could not read embedded prompt metadata.",
      });
    });
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

async function loadPromptMetadata(item) {
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

function createCard(item) {
  const card = document.createElement("div");
  card.className = "cmf-card";
  card.role = "button";
  card.tabIndex = 0;
  card.title = item.filename;
  card.dataset.itemId = item.id;

  const preview = document.createElement("div");
  preview.className = "cmf-preview";

  if (item.kind === "image") {
    const image = document.createElement("img");
    image.alt = item.filename;
    image.decoding = "async";
    image.loading = "lazy";
    image.src = item.url;
    image.addEventListener("load", () => rememberDecodedImage(item.url, image), { once: true });
    preview.appendChild(image);
  } else if (item.kind === "video") {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.loop = true;
    video.src = item.url;
    preview.appendChild(video);
  } else {
    const audioPreview = document.createElement("div");
    audioPreview.className = "cmf-audio-preview";
    const audioMain = document.createElement("div");
    audioMain.className = "cmf-audio-main";
    const badge = document.createElement("div");
    badge.className = "cmf-kind";
    badge.textContent = "Audio";
    audioMain.appendChild(badge);
    const controls = document.createElement("div");
    controls.className = "cmf-audio-controls";
    controls.innerHTML = `
      <button class="cmf-button cmf-icon-button cmf-audio-play" type="button" title="Play" aria-label="Play">${ICONS.play}</button>
      <input class="cmf-audio-seek" type="range" min="0" max="1000" value="0" aria-label="Seek">
    `;
    const audio = document.createElement("audio");
    audio.preload = "none";
    audio.src = item.url;
    audioPreview.append(audioMain, controls, audio);
    setupAudioPreview(audioPreview, audio);
    preview.appendChild(audioPreview);
  }

  card.append(preview);
  const previewVideo = card.querySelector("video");
  if (previewVideo && item.kind === "video") {
    const playPreview = () => {
      previewVideo.play().catch(() => {});
    };
    const pausePreview = () => {
      previewVideo.pause();
      try {
        previewVideo.currentTime = 0;
      } catch {
        // Some browsers reject seeking before metadata is ready.
      }
    };
    card.addEventListener("mouseenter", playPreview);
    card.addEventListener("mouseleave", pausePreview);
    card.addEventListener("focus", playPreview);
    card.addEventListener("blur", pausePreview);
  }
  card.addEventListener("click", (event) => {
    if (event.target.closest(".cmf-audio-controls")) return;
    openViewer(item, card.querySelector("img"));
  });
  card.addEventListener("keydown", (event) => {
    if (event.target.closest(".cmf-audio-controls")) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openViewer(item, card.querySelector("img"));
  });

  return card;
}

function setupAudioPreview(audioPreview, audio) {
  const playButton = audioPreview.querySelector(".cmf-audio-play");
  const seek = audioPreview.querySelector(".cmf-audio-seek");

  const updatePlayButton = () => {
    playButton.innerHTML = audio.paused ? ICONS.play : ICONS.pause;
    playButton.title = audio.paused ? "Play" : "Pause";
    playButton.setAttribute("aria-label", playButton.title);
  };

  const updateSeek = () => {
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    seek.value = duration ? String(Math.round(audio.currentTime / duration * 1000)) : "0";
  };

  playButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  });

  seek.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  seek.addEventListener("input", (event) => {
    event.stopPropagation();
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    if (!duration) return;
    audio.currentTime = Number(seek.value) / 1000 * duration;
  });

  audio.addEventListener("play", updatePlayButton);
  audio.addEventListener("pause", updatePlayButton);
  audio.addEventListener("loadedmetadata", updateSeek);
  audio.addEventListener("timeupdate", updateSeek);
  updatePlayButton();
}

function createView(root, kind = "embedded") {
  ensureStyles();

  root.className = kind === "floating" ? "cmf-root cmf-fallback" : "cmf-root";
  root.innerHTML = `
    <div class="cmf-toolbar">
      <strong class="cmf-title">Media Feed</strong>
      <div class="cmf-filter" role="group" aria-label="Media filter">
        <button type="button" data-filter="all" aria-pressed="true">All</button>
        <button type="button" data-filter="image" aria-pressed="false">Images</button>
        <button type="button" data-filter="video" aria-pressed="false">Videos</button>
        <button type="button" data-filter="audio" aria-pressed="false">Audio</button>
      </div>
      <span class="cmf-count"></span>
      <div class="cmf-spacer"></div>
      <label class="cmf-size-control" title="Thumbnail size">
        <span>Size</span>
        <input class="cmf-size-slider" type="range" min="${MIN_ITEM_HEIGHT}" max="${MAX_ITEM_HEIGHT}" value="${state.itemHeight}">
      </label>
      <button class="cmf-button cmf-collapse" type="button" hidden>Hide</button>
      <button class="cmf-button cmf-clear" type="button">Clear</button>
    </div>
    <div class="cmf-viewport">
      <div class="cmf-rail"></div>
      <div class="cmf-empty">Generated media will appear here.</div>
    </div>
  `;

  const view = {
    root,
    viewport: root.querySelector(".cmf-viewport"),
    rail: root.querySelector(".cmf-rail"),
    empty: root.querySelector(".cmf-empty"),
    count: root.querySelector(".cmf-count"),
    sizeSlider: root.querySelector(".cmf-size-slider"),
    cards: new Map(),
    kind,
    lastRange: "",
  };

  view.viewport.addEventListener("scroll", () => renderVisibleItems(view), { passive: true });
  view.viewport.addEventListener("wheel", (event) => handleFeedWheel(event, view), { passive: false });
  view.resizeObserver = new ResizeObserver(() => updateView(view, false));
  view.resizeObserver.observe(view.viewport);

  root.querySelector(".cmf-filter").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;

    state.filter = button.dataset.filter;
    for (const filterButton of root.querySelectorAll("button[data-filter]")) {
      filterButton.setAttribute("aria-pressed", String(filterButton === button));
    }
    updateViews(false);
  });

  root.querySelector(".cmf-clear").addEventListener("click", () => {
    state.items = [];
    state.itemKeys.clear();
    decodedImageCache.clear();
    promptMetadataCache.clear();
    updateViews(false);
  });

  view.sizeSlider.addEventListener("input", (event) => {
    setThumbnailHeight(event.target.value);
  });

  state.views.add(view);
  updateView(view, false);
  return view;
}

function renderBottomPanelView(root) {
  if (bottomPanelView && bottomPanelView.root !== root) destroyView(bottomPanelView, false);
  bottomPanelView = createView(root, "bottom-panel");
  syncBottomPanelVisibility();
  syncFloatingPanel();
  return bottomPanelView;
}

function createFloatingPanel() {
  if (floatingView) return floatingView;
  if (document.getElementById(FALLBACK_ROOT_ID)) return floatingView;

  const root = document.createElement("div");
  root.id = FALLBACK_ROOT_ID;
  document.body.appendChild(root);
  const view = createView(root, "floating");
  floatingView = view;

  const collapseButton = root.querySelector(".cmf-collapse");
  collapseButton.hidden = false;
  collapseButton.addEventListener("click", () => {
    const collapsed = root.dataset.collapsed === "true";
    root.dataset.collapsed = String(!collapsed);
    collapseButton.textContent = collapsed ? "Hide" : "Show";
  });

  return view;
}

function destroyView(view, removeRoot) {
  view?.resizeObserver?.disconnect();
  state.views.delete(view);
  if (removeRoot) view?.root?.remove();
}

function shouldUseFloatingPanel() {
  return state.placement !== "bottom" || !bottomPanelView;
}

function syncBottomPanelVisibility() {
  if (!bottomPanelView) return;
  bottomPanelView.root.hidden = state.placement !== "bottom";
}

function syncFloatingPanel() {
  if (!shouldUseFloatingPanel()) {
    if (floatingView) {
      destroyView(floatingView, true);
      floatingView = null;
    }
    return;
  }

  const view = createFloatingPanel();
  if (!view) return;
  applyFallbackPlacement(view.root);
  updateView(view, false);
}

function applyFallbackPlacement(root) {
  if (!root?.classList?.contains("cmf-fallback")) return;
  root.dataset.placement = state.placement;
  root.dataset.orientation = isVerticalPlacement() ? "vertical" : "horizontal";
}

function updateViews(scrollToLatest) {
  for (const view of state.views) updateView(view, scrollToLatest);
}

function applyViewSizing(view) {
  applyFallbackPlacement(view.root);
  view.root.style.setProperty("--cmf-item-width", `${state.itemWidth}px`);
  view.root.style.setProperty("--cmf-item-height", `${state.itemHeight}px`);
  view.root.style.setProperty("--cmf-panel-height", `${fallbackPanelHeight()}px`);
  view.root.style.setProperty("--cmf-rail-height", `${railHeight()}px`);
  view.root.style.setProperty("--cmf-viewport-height", `${viewportHeight()}px`);
  view.sizeSlider.value = String(state.itemHeight);
}

function handleFeedWheel(event, view) {
  if (viewer?.root?.dataset.open === "true") return;
  if (isVerticalView(view)) return;

  const canScroll = view.viewport.scrollWidth > view.viewport.clientWidth;
  if (!canScroll) return;

  const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (Math.abs(dominantDelta) < 1) return;

  event.preventDefault();
  view.viewport.scrollLeft += dominantDelta;
  renderVisibleItems(view);
}

function updateView(view, scrollToLatest) {
  applyViewSizing(view);
  const items = filteredItems();
  const pitch = viewPitch(view);

  if (isVerticalView(view)) {
    const totalHeight = Math.max(view.viewport.clientHeight, RAIL_PADDING * 2 + items.length * pitch);
    view.rail.style.width = "100%";
    view.rail.style.height = `${totalHeight}px`;
  } else {
    const totalWidth = Math.max(view.viewport.clientWidth, RAIL_PADDING * 2 + items.length * pitch);
    view.rail.style.width = `${totalWidth}px`;
    view.rail.style.height = "";
  }

  view.empty.style.display = items.length ? "none" : "grid";
  view.count.textContent = `${items.length} shown / ${state.items.length} kept`;

  if (scrollToLatest) {
    view.viewport.scrollLeft = 0;
    view.viewport.scrollTop = 0;
  }
  view.lastRange = "";
  renderVisibleItems(view);
}

function renderVisibleItems(view) {
  const items = filteredItems();
  const vertical = isVerticalView(view);
  const viewportSize = vertical ? view.viewport.clientHeight || 1 : view.viewport.clientWidth || 1;
  const scrollOffset = vertical ? view.viewport.scrollTop : view.viewport.scrollLeft;
  const pitch = viewPitch(view);
  const rawStart = Math.floor((scrollOffset - RAIL_PADDING) / pitch) - OVERSCAN;
  const rawEnd = Math.ceil((scrollOffset + viewportSize - RAIL_PADDING) / pitch) + OVERSCAN;
  const start = Math.max(0, rawStart);
  const end = Math.min(items.length, rawEnd);
  const rangeKey = `${state.filter}:${vertical ? "vertical" : "horizontal"}:${items.length}:${start}:${end}`;

  if (view.lastRange === rangeKey) return;
  view.lastRange = rangeKey;

  const visibleIds = new Set();
  for (let index = start; index < end; index++) {
    const item = items[index];
    visibleIds.add(item.id);

    let card = view.cards.get(item.id);
    if (!card) {
      card = createCard(item);
      view.cards.set(item.id, card);
      view.rail.appendChild(card);
    }
    card.style.transform = vertical
      ? `translateY(${RAIL_PADDING + index * pitch}px)`
      : `translateX(${RAIL_PADDING + index * pitch}px)`;
  }

  for (const [id, card] of view.cards) {
    if (visibleIds.has(id)) continue;
    card.remove();
    view.cards.delete(id);
  }
}

function handleExecuted(event) {
  const detail = event?.detail || {};
  const mediaItems = collectMedia(detail.output, detail.prompt_id, detail.node);
  addItems(mediaItems);
}

app.registerExtension({
  name: EXTENSION_NAME,
  settings: [
    {
      id: "comfyui-media-feed.placement",
      name: "Placement",
      type: "combo",
      defaultValue: loadSavedPlacement(),
      options: [
        { text: "Bottom", value: "bottom" },
        { text: "Top", value: "top" },
        { text: "Left", value: "left" },
        { text: "Right", value: "right" },
      ],
      category: ["Media Feed", "Panel", "Placement"],
      tooltip: "Choose where the floating Media Feed panel appears.",
      onChange: (newValue) => {
        placementSettingSeen = true;
        setPlacement(newValue);
      },
    },
    {
      id: "comfyui-media-feed.show-prompts",
      name: "Show prompts in viewer",
      type: "boolean",
      defaultValue: loadSavedShowPrompts(),
      category: ["Media Feed", "Viewer", "Show prompts in viewer"],
      tooltip: "Read embedded PNG, GIF, MP4, WebM, M4A, MP3, FLAC, OGG, or Opus metadata and show inferred prompt and seed metadata when viewing media.",
      onChange: (newValue) => {
        promptSettingSeen = true;
        setShowPrompts(newValue);
      },
    },
    {
      id: "comfyui-media-feed.scale-viewer-media",
      name: "Fit media to viewer",
      type: "boolean",
      defaultValue: loadSavedScaleViewerMedia(),
      category: ["Media Feed", "Viewer", "Fit media to viewer"],
      tooltip: "Upscale small images and videos to the largest size that fits entirely within the viewer while preserving their aspect ratio.",
      onChange: (newValue) => {
        scaleViewerMediaSettingSeen = true;
        setScaleViewerMedia(newValue);
      },
    },
  ],
  bottomPanelTabs: [
    {
      id: "comfyui-media-feed",
      title: "Media Feed",
      type: "custom",
      render: renderBottomPanelView,
    },
  ],
  async setup() {
    console.info("[ComfyUI Media Feed] extension loaded");
    loadSettings();
    ensureStyles();
    api.addEventListener("executed", handleExecuted);
    setupComplete = true;
    window.setTimeout(syncFloatingPanel, 1000);
  },
});
