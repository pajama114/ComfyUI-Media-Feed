import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "comfyui.media_feed";
const MAX_ITEMS = 256;
const DECODED_IMAGE_CACHE_SIZE = 32;
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
const STORAGE_KEYS = {
  itemHeight: "comfyui-media-feed:item-height",
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

const state = {
  items: [],
  itemKeys: new Set(),
  filter: "all",
  views: new Set(),
  sequence: 0,
  itemHeight: DEFAULT_ITEM_HEIGHT,
  itemWidth: DEFAULT_ITEM_WIDTH,
};

const decodedImageCache = new Map();
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

function itemPitch() {
  return state.itemWidth + ITEM_GAP;
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

function applyThumbnailHeight(nextHeight) {
  const itemHeight = normalizeThumbnailHeight(nextHeight);
  state.itemHeight = itemHeight;
  state.itemWidth = Math.round(itemHeight * DEFAULT_ITEM_WIDTH / DEFAULT_ITEM_HEIGHT);
}

function loadSettings() {
  try {
    const savedHeight = window.localStorage?.getItem(STORAGE_KEYS.itemHeight);
    if (savedHeight !== null) applyThumbnailHeight(savedHeight);
  } catch {
    applyThumbnailHeight(DEFAULT_ITEM_HEIGHT);
  }
}

function saveSettings() {
  try {
    window.localStorage?.setItem(STORAGE_KEYS.itemHeight, String(state.itemHeight));
  } catch {
    // Ignore storage failures; the feed should keep working with in-memory settings.
  }
}

function setThumbnailHeight(nextHeight) {
  applyThumbnailHeight(nextHeight);
  saveSettings();
  updateViews(false);
}

function ensureStyles() {
  if (document.getElementById("comfy-media-feed-styles")) return;

  const style = document.createElement("style");
  style.id = "comfy-media-feed-styles";
  style.textContent = `
    .cmf-root {
      --cmf-bg: rgba(19, 20, 24, 0.96);
      --cmf-panel: rgba(255, 255, 255, 0.055);
      --cmf-border: rgba(255, 255, 255, 0.12);
      --cmf-text: rgba(255, 255, 255, 0.86);
      --cmf-muted: rgba(255, 255, 255, 0.58);
      --cmf-accent: #4db6ac;
      --cmf-item-width: ${DEFAULT_ITEM_WIDTH}px;
      --cmf-item-height: ${DEFAULT_ITEM_HEIGHT}px;
      --cmf-panel-height: ${fallbackPanelHeight()}px;
      --cmf-rail-height: ${railHeight()}px;
      --cmf-viewport-height: ${viewportHeight()}px;
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
      right: 300px;
      bottom: 12px;
      left: 76px;
      z-index: 999;
      height: var(--cmf-panel-height);
      overflow: hidden;
      border: 1px solid var(--cmf-border);
      border-radius: 8px;
      box-shadow: 0 18px 46px rgba(0, 0, 0, 0.38);
    }

    .cmf-root.cmf-fallback[data-collapsed="true"] {
      right: auto;
      left: 76px;
      width: 260px;
      height: 44px;
      min-height: 44px;
      overflow: hidden;
    }

    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-viewport,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-filter,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-count,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-size-control,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-clear {
      display: none;
    }

    @media (max-width: 980px) {
      .cmf-root.cmf-fallback {
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
      background: rgba(255, 255, 255, 0.06);
      color: var(--cmf-text);
      cursor: pointer;
      font: inherit;
    }

    .cmf-button:hover {
      background: rgba(255, 255, 255, 0.1);
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
      background: rgba(77, 182, 172, 0.18);
      color: var(--cmf-text);
    }

    .cmf-viewport {
      position: relative;
      flex: 1;
      min-height: var(--cmf-viewport-height);
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-color: rgba(255, 255, 255, 0.24) rgba(0, 0, 0, 0.18);
      scrollbar-width: thin;
      border: 1px solid var(--cmf-border);
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.22);
    }

    .cmf-viewport::-webkit-scrollbar {
      height: 12px;
    }

    .cmf-viewport::-webkit-scrollbar-track {
      border-radius: 0 0 8px 8px;
      background: rgba(0, 0, 0, 0.18);
    }

    .cmf-viewport::-webkit-scrollbar-thumb {
      min-width: 36px;
      border: 3px solid rgba(0, 0, 0, 0.18);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.24);
    }

    .cmf-viewport::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.34);
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
      border-color: rgba(77, 182, 172, 0.72);
      outline: none;
    }

    .cmf-preview {
      display: grid;
      flex: 1 1 auto;
      place-items: center;
      width: 100%;
      min-height: 0;
      overflow: hidden;
      background: rgba(0, 0, 0, 0.28);
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
      background: rgba(77, 182, 172, 0.18);
      color: var(--cmf-text);
      font-size: 11px;
      text-transform: uppercase;
    }

    .cmf-viewer {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: none;
      grid-template-rows: auto 1fr;
      background: rgba(0, 0, 0, 0.82);
      color: rgba(255, 255, 255, 0.9);
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
      border-bottom: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(16, 17, 19, 0.94);
    }

    .cmf-viewer-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cmf-viewer-body {
      position: relative;
      display: grid;
      place-items: center;
      min-width: 0;
      min-height: 0;
      padding: 14px;
    }

    .cmf-viewer-media {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
    }

    .cmf-viewer-media img,
    .cmf-viewer-media video {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    .cmf-viewer-media audio {
      width: min(720px, 90vw);
    }

    .cmf-nav-button {
      position: fixed;
      top: 50%;
      z-index: 1;
      width: 42px;
      min-width: 42px;
      height: 54px;
      transform: translateY(-50%);
      border-radius: 8px;
      background: rgba(18, 19, 22, 0.76);
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
      left: 18px;
    }

    .cmf-nav-next {
      right: 18px;
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

function ensureViewer() {
  if (viewer) return viewer;

  ensureStyles();

  const root = document.createElement("div");
  root.className = "cmf-viewer";
  root.tabIndex = -1;
  root.innerHTML = `
    <div class="cmf-viewer-bar">
      <div class="cmf-viewer-title"></div>
      <div class="cmf-spacer"></div>
      <a class="cmf-button cmf-icon-button cmf-open-link" target="_blank" rel="noopener noreferrer" title="Open original" aria-label="Open original">${ICONS.externalLink}</a>
      <button class="cmf-button cmf-icon-button cmf-close" type="button" title="Close" aria-label="Close">${ICONS.close}</button>
    </div>
    <div class="cmf-viewer-body">
      <button class="cmf-button cmf-icon-button cmf-nav-button cmf-nav-prev" type="button" title="Previous" aria-label="Previous">${ICONS.chevronLeft}</button>
      <button class="cmf-button cmf-icon-button cmf-nav-button cmf-nav-next" type="button" title="Next" aria-label="Next">${ICONS.chevronRight}</button>
      <div class="cmf-viewer-media"></div>
    </div>
  `;

  root.addEventListener("click", (event) => {
    if (event.target === root || event.target === viewer?.body || event.target === viewer?.media) {
      closeViewer();
    }
  });
  root.querySelector(".cmf-close").addEventListener("click", closeViewer);
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
  document.addEventListener("keydown", (event) => {
    if (root.dataset.open !== "true") return;
    if (event.key === "Escape") {
      closeViewer();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showViewerRelative(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      showViewerRelative(1);
    }
  });

  document.body.appendChild(root);
  viewer = {
    root,
    title: root.querySelector(".cmf-viewer-title"),
    body: root.querySelector(".cmf-viewer-body"),
    media: root.querySelector(".cmf-viewer-media"),
    openLink: root.querySelector(".cmf-open-link"),
    prevButton: root.querySelector(".cmf-nav-prev"),
    nextButton: root.querySelector(".cmf-nav-next"),
    item: null,
    items: [],
    index: -1,
  };
  return viewer;
}

function closeViewer() {
  if (!viewer) return;
  viewer.root.dataset.open = "false";
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
}

function showViewerRelative(direction) {
  if (!viewer || viewer.root.dataset.open !== "true") return;
  syncViewerItems();

  const nextIndex = viewer.index + direction;
  if (nextIndex < 0 || nextIndex >= viewer.items.length) return;

  viewer.index = nextIndex;
  renderViewerItem(viewer.items[nextIndex]);
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

function createView(root) {
  ensureStyles();

  root.className = "cmf-root";
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
    updateViews(false);
  });

  view.sizeSlider.addEventListener("input", (event) => {
    setThumbnailHeight(event.target.value);
  });

  state.views.add(view);
  updateView(view, false);
  return view;
}

function createFallbackPanel() {
  if (document.querySelector(".cmf-root")) return;
  if (document.getElementById(FALLBACK_ROOT_ID)) return;

  const root = document.createElement("div");
  root.id = FALLBACK_ROOT_ID;
  document.body.appendChild(root);
  createView(root);
  root.classList.add("cmf-fallback");

  const collapseButton = root.querySelector(".cmf-collapse");
  collapseButton.hidden = false;
  collapseButton.addEventListener("click", () => {
    const collapsed = root.dataset.collapsed === "true";
    root.dataset.collapsed = String(!collapsed);
    collapseButton.textContent = collapsed ? "Hide" : "Show";
  });
}

function updateViews(scrollToLatest) {
  for (const view of state.views) updateView(view, scrollToLatest);
}

function applyViewSizing(view) {
  view.root.style.setProperty("--cmf-item-width", `${state.itemWidth}px`);
  view.root.style.setProperty("--cmf-item-height", `${state.itemHeight}px`);
  view.root.style.setProperty("--cmf-panel-height", `${fallbackPanelHeight()}px`);
  view.root.style.setProperty("--cmf-rail-height", `${railHeight()}px`);
  view.root.style.setProperty("--cmf-viewport-height", `${viewportHeight()}px`);
  view.sizeSlider.value = String(state.itemHeight);
}

function handleFeedWheel(event, view) {
  if (viewer?.root?.dataset.open === "true") return;

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
  const totalWidth = Math.max(view.viewport.clientWidth, RAIL_PADDING * 2 + items.length * itemPitch());
  view.rail.style.width = `${totalWidth}px`;
  view.empty.style.display = items.length ? "none" : "grid";
  view.count.textContent = `${items.length} shown / ${state.items.length} kept`;

  if (scrollToLatest) view.viewport.scrollLeft = 0;
  view.lastRange = "";
  renderVisibleItems(view);
}

function renderVisibleItems(view) {
  const items = filteredItems();
  const viewportWidth = view.viewport.clientWidth || 1;
  const pitch = itemPitch();
  const rawStart = Math.floor((view.viewport.scrollLeft - RAIL_PADDING) / pitch) - OVERSCAN;
  const rawEnd = Math.ceil((view.viewport.scrollLeft + viewportWidth - RAIL_PADDING) / pitch) + OVERSCAN;
  const start = Math.max(0, rawStart);
  const end = Math.min(items.length, rawEnd);
  const rangeKey = `${state.filter}:${items.length}:${start}:${end}`;

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
    card.style.transform = `translateX(${RAIL_PADDING + index * pitch}px)`;
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
  bottomPanelTabs: [
    {
      id: "comfyui-media-feed",
      title: "Media Feed",
      type: "custom",
      render: createView,
    },
  ],
  async setup() {
    console.info("[ComfyUI Media Feed] extension loaded");
    loadSettings();
    ensureStyles();
    api.addEventListener("executed", handleExecuted);
    window.setTimeout(createFallbackPanel, 1000);
  },
});
