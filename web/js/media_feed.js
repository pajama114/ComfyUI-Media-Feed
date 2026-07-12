import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ICONS } from "./icons.js";
import { clearPromptMetadataCache, loadPromptMetadata } from "./metadata.js";
import { ensureMediaFeedStyles } from "./styles.js";

const EXTENSION_NAME = "comfyui.media_feed";
const MAX_ITEMS = 256;
const DECODED_IMAGE_CACHE_SIZE = 32;
const DEFAULT_ITEM_WIDTH = 148;
const DEFAULT_ITEM_HEIGHT = 143;
const MIN_ITEM_HEIGHT = 96;
const MAX_ITEM_HEIGHT = 220;
const ITEM_GAP = 8;
const SCROLLBAR_SPACE = 14;
const RAIL_PADDING = 12;
const CARD_TOP_OFFSET = 10;
const OVERSCAN = 5;
const FALLBACK_PANEL_EXTRA_HEIGHT = 80;
const FALLBACK_ROOT_ID = "comfy-media-feed-fallback";
const DEFAULT_PLACEMENT = "bottom";
const DEFAULT_SHOW_PROMPTS = true;
const DEFAULT_SCALE_VIEWER_MEDIA = false;
const DEFAULT_FOLLOW_LATEST = true;
const DEFAULT_METADATA_POSITION = "left";
const SIDE_PLACEMENTS = new Set(["left", "right"]);
const PLACEMENTS = new Set(["top", "right", "bottom", "left"]);
const METADATA_POSITIONS = new Set(["left", "right"]);
const STORAGE_KEYS = {
  itemHeight: "comfyui-media-feed:item-height",
  placement: "comfyui-media-feed:placement",
  showPrompts: "comfyui-media-feed:show-prompts",
  scaleViewerMedia: "comfyui-media-feed:scale-viewer-media",
  followLatest: "comfyui-media-feed:follow-latest",
  metadataPosition: "comfyui-media-feed:metadata-position",
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
  placement: DEFAULT_PLACEMENT,
  showPrompts: DEFAULT_SHOW_PROMPTS,
  scaleViewerMedia: DEFAULT_SCALE_VIEWER_MEDIA,
  followLatest: DEFAULT_FOLLOW_LATEST,
  metadataPosition: DEFAULT_METADATA_POSITION,
};

const decodedImageCache = new Map();
let bottomPanelView = null;
let floatingView = null;
let setupComplete = false;
let placementSettingSeen = false;
let promptSettingSeen = false;
let scaleViewerMediaSettingSeen = false;
let followLatestSettingSeen = false;
let metadataPositionSettingSeen = false;
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

  updateViews(state.followLatest && !isViewerOpen(), state.followLatest ? 0 : freshItems.length);
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
  return state.itemHeight + CARD_TOP_OFFSET + SCROLLBAR_SPACE;
}

function railHeight() {
  return state.itemHeight + CARD_TOP_OFFSET;
}

function fallbackPanelHeight() {
  return state.itemHeight + SCROLLBAR_SPACE + FALLBACK_PANEL_EXTRA_HEIGHT;
}

function horizontalContentWidth(itemCount) {
  if (!itemCount) return 0;
  return RAIL_PADDING * 2 + itemCount * state.itemWidth + (itemCount - 1) * ITEM_GAP;
}

function normalizeThumbnailHeight(nextHeight) {
  return Math.min(MAX_ITEM_HEIGHT, Math.max(MIN_ITEM_HEIGHT, Number(nextHeight) || DEFAULT_ITEM_HEIGHT));
}

function normalizePlacement(nextPlacement) {
  const placement = String(nextPlacement || "").toLowerCase();
  return PLACEMENTS.has(placement) ? placement : DEFAULT_PLACEMENT;
}

function normalizeMetadataPosition(nextPosition) {
  const position = String(nextPosition || "").toLowerCase();
  return METADATA_POSITIONS.has(position) ? position : DEFAULT_METADATA_POSITION;
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

function applyFollowLatest(nextValue) {
  state.followLatest = normalizeBooleanSetting(nextValue);
}

function applyMetadataPosition(nextPosition) {
  state.metadataPosition = normalizeMetadataPosition(nextPosition);
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

function loadSavedFollowLatest() {
  try {
    const savedValue = window.localStorage?.getItem(STORAGE_KEYS.followLatest);
    return savedValue === null ? DEFAULT_FOLLOW_LATEST : normalizeBooleanSetting(savedValue);
  } catch {
    return DEFAULT_FOLLOW_LATEST;
  }
}

function loadSavedMetadataPosition() {
  try {
    return normalizeMetadataPosition(window.localStorage?.getItem(STORAGE_KEYS.metadataPosition));
  } catch {
    return DEFAULT_METADATA_POSITION;
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
  if (!followLatestSettingSeen) applyFollowLatest(loadSavedFollowLatest());
  if (!metadataPositionSettingSeen) applyMetadataPosition(loadSavedMetadataPosition());
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

function saveFollowLatest() {
  try {
    window.localStorage?.setItem(STORAGE_KEYS.followLatest, String(state.followLatest));
  } catch {
    // Ignore storage failures; the feed should keep working with in-memory settings.
  }
}

function saveMetadataPosition() {
  try {
    window.localStorage?.setItem(STORAGE_KEYS.metadataPosition, state.metadataPosition);
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

function setFollowLatest(nextValue) {
  applyFollowLatest(nextValue);
  saveFollowLatest();
}

function setMetadataPosition(nextPosition) {
  applyMetadataPosition(nextPosition);
  saveMetadataPosition();
  syncViewerMetadataPosition();
}

function setPlacement(nextPlacement) {
  applyPlacement(nextPlacement);
  savePlacement();
  syncBottomPanelVisibility();
  if (setupComplete) syncFloatingPanel();
  updateViews(false);
}

function ensureStyles() {
  ensureMediaFeedStyles({
    itemWidth: DEFAULT_ITEM_WIDTH,
    itemHeight: DEFAULT_ITEM_HEIGHT,
    panelHeight: fallbackPanelHeight(),
    railHeight: railHeight(),
    viewportHeight: viewportHeight(),
    railPadding: RAIL_PADDING,
    cardTopOffset: CARD_TOP_OFFSET,
  });
}

function rememberDecodedImage(url, image) {
  if (!url || !image?.complete) return;
  if (!image.naturalWidth && !image.naturalHeight) return;
  decodedImageCache.delete(url);
  decodedImageCache.set(url, image);

  while (decodedImageCache.size > DECODED_IMAGE_CACHE_SIZE) {
    const oldestKey = decodedImageCache.keys().next().value;
    decodedImageCache.delete(oldestKey);
  }
}

function waitForImageReady(image) {
  if (image.complete) return Promise.resolve();

  return new Promise((resolve) => {
    const settle = () => resolve();
    image.addEventListener("load", settle, { once: true });
    image.addEventListener("error", settle, { once: true });
  });
}

async function decodeImageElement(image) {
  await waitForImageReady(image);
  try {
    await image.decode?.();
  } catch {
    // The image element should still be shown so the browser can expose errors.
  }
}

function isCurrentViewerRender(currentViewer, requestId, item) {
  return viewer === currentViewer
    && currentViewer.root.dataset.open === "true"
    && currentViewer.renderRequestId === requestId
    && currentViewer.item?.key === item.key;
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
        <button class="cmf-button cmf-scan-full-metadata" type="button" hidden>Read full file metadata</button>
        <section class="cmf-prompt-section cmf-resources-section" hidden>
          <div class="cmf-prompt-section-header">
            <h2 class="cmf-prompt-heading">Resources</h2>
          </div>
          <div class="cmf-resource-grid"></div>
        </section>
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
        <section class="cmf-prompt-section cmf-metadata-section" hidden>
          <div class="cmf-prompt-section-header">
            <h2 class="cmf-prompt-heading">Other Metadata</h2>
          </div>
          <div class="cmf-metadata-grid"></div>
        </section>
      </aside>
    </div>
  `;

  root.addEventListener("click", handleViewerBackdropClick);
  root.querySelector(".cmf-close").addEventListener("click", closeViewer);
  root.querySelector(".cmf-copy-seed").addEventListener("click", (event) => copyPromptText(event, viewer?.promptSeed));
  root.querySelector(".cmf-copy-positive").addEventListener("click", (event) => copyPromptText(event, viewer?.promptPositive));
  root.querySelector(".cmf-copy-negative").addEventListener("click", (event) => copyPromptText(event, viewer?.promptNegative));
  root.querySelector(".cmf-scan-full-metadata").addEventListener("click", scanFullViewerMetadata);
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
    scanFullMetadataButton: root.querySelector(".cmf-scan-full-metadata"),
    resourcesSection: root.querySelector(".cmf-resources-section"),
    resourcesGrid: root.querySelector(".cmf-resource-grid"),
    metadataSection: root.querySelector(".cmf-metadata-section"),
    metadataGrid: root.querySelector(".cmf-metadata-grid"),
    promptSeed: root.querySelector(".cmf-seed-text"),
    promptPositive: root.querySelector(".cmf-prompt-positive"),
    promptNegative: root.querySelector(".cmf-prompt-negative"),
    openLink: root.querySelector(".cmf-open-link"),
    prevButton: root.querySelector(".cmf-nav-prev"),
    nextButton: root.querySelector(".cmf-nav-next"),
    promptRequestId: 0,
    renderRequestId: 0,
    lastPromptMetadataItemKey: "",
    item: null,
    items: [],
    index: -1,
  };
  syncViewerMetadataPosition();
  return viewer;
}

function syncViewerScaleMedia() {
  if (!viewer) return;
  viewer.root.dataset.scaleMedia = String(state.scaleViewerMedia);
}

function syncViewerMetadataPosition() {
  if (!viewer) return;
  viewer.body.dataset.metadataPosition = state.metadataPosition;
}

function closeViewer() {
  if (!viewer) return;
  viewer.root.dataset.open = "false";
  viewer.promptRequestId++;
  viewer.renderRequestId++;
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
  if (event.target instanceof Element && event.target.closest(".cmf-prompt-panel")) return;
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
  const requestId = ++currentViewer.renderRequestId;
  currentViewer.item = item;
  currentViewer.title.textContent = item.filename;
  currentViewer.openLink.href = item.url;
  syncViewerNav();

  if (item.kind === "image") {
    const image = document.createElement("img");
    image.alt = item.filename;
    image.decoding = "async";

    const cached = decodedImageCache.get(item.url);
    if (cached?.complete) {
      image.src = cached.currentSrc || cached.src;
      await decodeImageElement(image);
      if (!isCurrentViewerRender(currentViewer, requestId, item)) return;
      currentViewer.media.replaceChildren(image);
      rememberDecodedImage(item.url, image);
      refreshViewerPromptPanelDetails();
      return;
    }

    if (thumbnail?.complete) {
      rememberDecodedImage(item.url, thumbnail);
      image.src = thumbnail.currentSrc || thumbnail.src;
      await decodeImageElement(image);
      if (!isCurrentViewerRender(currentViewer, requestId, item)) return;
      currentViewer.media.replaceChildren(image);
      rememberDecodedImage(item.url, image);
      refreshViewerPromptPanelDetails();
      return;
    }

    image.src = item.url;
    await decodeImageElement(image);
    if (!isCurrentViewerRender(currentViewer, requestId, item)) return;
    currentViewer.media.replaceChildren(image);
    rememberDecodedImage(item.url, image);
    refreshViewerPromptPanelDetails();
    return;
  }

  if (item.kind === "video") {
    const video = document.createElement("video");
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.src = item.url;
    currentViewer.media.replaceChildren(video);
    video.addEventListener("loadedmetadata", refreshViewerPromptPanelDetails, { once: true });
    return;
  }

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.autoplay = true;
  audio.src = item.url;
  currentViewer.media.replaceChildren(audio);
}

function resetViewerPromptPanel(status = "") {
  if (!viewer) return;
  viewer.lastPromptMetadata = null;
  viewer.lastPromptMetadataItemKey = "";
  viewer.promptStatus.textContent = status;
  viewer.scanFullMetadataButton.hidden = true;
  viewer.scanFullMetadataButton.disabled = false;
  viewer.resourcesGrid.replaceChildren();
  viewer.resourcesSection.hidden = true;
  viewer.metadataGrid.replaceChildren();
  viewer.metadataSection.hidden = true;
  viewer.promptSeed.textContent = "";
  viewer.promptPositive.textContent = "";
  viewer.promptNegative.textContent = "";
}

function currentViewerMediaDetails() {
  if (!viewer?.media) return [];

  const element = viewer.media.querySelector("img, video");
  const size = viewerMediaNaturalSize(element);
  if (!size.width || !size.height) return [];

  return [
    { label: "Width", value: String(size.width) },
    { label: "Height", value: String(size.height) },
  ];
}

function appendMetadataDetails(details, fallbackDetails) {
  const usedLabels = new Set();
  const results = [];

  for (const entry of details) {
    const label = String(entry?.label || "").trim();
    const value = String(entry?.value || "").trim();
    if (!label || !value) continue;
    usedLabels.add(label.toLowerCase());
    results.push({ label, value });
  }

  for (const entry of fallbackDetails) {
    const label = String(entry?.label || "").trim();
    const value = String(entry?.value || "").trim();
    if (!label || !value || usedLabels.has(label.toLowerCase())) continue;
    usedLabels.add(label.toLowerCase());
    results.push({ label, value });
  }

  return results;
}

function refreshViewerPromptPanelDetails() {
  if (!viewer?.lastPromptMetadata || viewer.root.dataset.open !== "true") return;
  if (viewer.lastPromptMetadataItemKey !== viewer.item?.key) return;
  renderPromptMetadata(viewer.lastPromptMetadata);
}

function appendMetadataChips(grid, entries, chipClassName, labelClassName, options = {}) {
  for (const entry of entries) {
    const label = String(entry?.label || "").trim();
    const value = String(entry?.value || "").trim();
    if (options.skipSeed && label.toLowerCase() === "seed") continue;
    if (!label || !value) continue;

    const chip = document.createElement("span");
    chip.className = chipClassName;

    const labelElement = document.createElement("span");
    labelElement.className = labelClassName;
    labelElement.textContent = label;
    chip.append(labelElement, `: ${value}`);
    grid.appendChild(chip);
  }
}

function renderPromptMetadata(result, itemKey = viewer?.item?.key || "") {
  if (!viewer) return;
  viewer.lastPromptMetadata = result;
  viewer.lastPromptMetadataItemKey = itemKey;
  viewer.promptStatus.textContent = result.status || "";
  viewer.scanFullMetadataButton.hidden = !result.requiresFullScan;
  viewer.scanFullMetadataButton.disabled = false;
  viewer.resourcesGrid.replaceChildren();
  viewer.metadataGrid.replaceChildren();

  appendMetadataChips(
    viewer.resourcesGrid,
    Array.isArray(result.resources) ? result.resources : [],
    "cmf-resource-chip",
    "cmf-resource-chip-label",
  );
  viewer.resourcesSection.hidden = !viewer.resourcesGrid.childElementCount;

  const details = appendMetadataDetails(
    Array.isArray(result.details) ? result.details : [],
    currentViewerMediaDetails(),
  );
  appendMetadataChips(
    viewer.metadataGrid,
    details,
    "cmf-metadata-chip",
    "cmf-metadata-chip-label",
    { skipSeed: true },
  );

  viewer.metadataSection.hidden = !viewer.metadataGrid.childElementCount;
  viewer.promptSeed.textContent = result.seed || "(not found)";
  viewer.promptPositive.textContent = result.positive || "(not found)";
  viewer.promptNegative.textContent = result.negative || "(not found)";
}

async function scanFullViewerMetadata(event) {
  event.currentTarget.blur();
  if (!viewer || viewer.root.dataset.open !== "true" || !viewer.item) return;

  const currentViewer = viewer;
  const item = currentViewer.item;
  const requestId = ++currentViewer.promptRequestId;
  currentViewer.scanFullMetadataButton.disabled = true;
  currentViewer.promptStatus.textContent = "Reading the full file for embedded metadata...";

  try {
    const result = await loadPromptMetadata(item, { fullScan: true });
    if (!viewer || viewer !== currentViewer || requestId !== currentViewer.promptRequestId || currentViewer.item?.key !== item.key) return;
    renderPromptMetadata(result, item.key);
  } catch {
    if (!viewer || viewer !== currentViewer || requestId !== currentViewer.promptRequestId || currentViewer.item?.key !== item.key) return;
    renderPromptMetadata({
      seed: "",
      positive: "",
      negative: "",
      resources: [],
      details: [],
      status: "Could not read embedded prompt metadata.",
      requiresFullScan: false,
    }, item.key);
  }
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
  if (viewer.lastPromptMetadata) {
    viewer.promptStatus.textContent = "Loading embedded prompt metadata...";
  } else {
    resetViewerPromptPanel("Loading embedded prompt metadata...");
  }

  loadPromptMetadata(item)
    .then((result) => {
      if (!viewer || requestId !== viewer.promptRequestId || viewer.item?.key !== item.key) return;
      renderPromptMetadata(result, item.key);
    })
    .catch(() => {
      if (!viewer || requestId !== viewer.promptRequestId || viewer.item?.key !== item.key) return;
      renderPromptMetadata({
        seed: "",
        positive: "",
        negative: "",
        resources: [],
        details: [],
        status: "Could not read embedded prompt metadata.",
      }, item.key);
    });
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
        <button type="button" data-filter="all" aria-pressed="true" title="All" aria-label="All">${ICONS.grid}</button>
        <button type="button" data-filter="image" aria-pressed="false" title="Images" aria-label="Images">${ICONS.image}</button>
        <button type="button" data-filter="video" aria-pressed="false" title="Movies" aria-label="Movies">${ICONS.video}</button>
        <button type="button" data-filter="audio" aria-pressed="false" title="Sound" aria-label="Sound">${ICONS.music}</button>
      </div>
      <span class="cmf-count"></span>
      <div class="cmf-spacer"></div>
      <label class="cmf-size-control" title="Thumbnail size">
        <span>Size</span>
        <input class="cmf-size-slider" type="range" min="${MIN_ITEM_HEIGHT}" max="${MAX_ITEM_HEIGHT}" value="${state.itemHeight}">
      </label>
      <button class="cmf-button cmf-icon-button cmf-clear" type="button" title="Clear" aria-label="Clear">${ICONS.trash}</button>
      <button class="cmf-button cmf-icon-button cmf-collapse" type="button" title="Hide" aria-label="Hide" hidden>${ICONS.eyeOff}</button>
    </div>
    <div class="cmf-feed-frame">
      <div class="cmf-viewport">
        <div class="cmf-rail"></div>
        <div class="cmf-empty">Generated media will appear here.</div>
      </div>
      <button class="cmf-jump cmf-jump-latest" type="button" data-jump="latest" title="Latest" aria-label="Jump to latest media">${ICONS.chevronLeft}</button>
      <button class="cmf-jump cmf-jump-oldest" type="button" data-jump="oldest" title="Oldest" aria-label="Jump to oldest media">${ICONS.chevronRight}</button>
    </div>
  `;

  const view = {
    root,
    viewport: root.querySelector(".cmf-viewport"),
    rail: root.querySelector(".cmf-rail"),
    empty: root.querySelector(".cmf-empty"),
    count: root.querySelector(".cmf-count"),
    sizeSlider: root.querySelector(".cmf-size-slider"),
    jumpLatest: root.querySelector(".cmf-jump-latest"),
    jumpOldest: root.querySelector(".cmf-jump-oldest"),
    cards: new Map(),
    kind,
    lastRange: "",
  };

  view.viewport.addEventListener("scroll", () => {
    renderVisibleItems(view);
    updateJumpButtons(view);
  }, { passive: true });
  view.viewport.addEventListener("wheel", (event) => handleFeedWheel(event, view), { passive: false });
  view.resizeObserver = new ResizeObserver(() => updateView(view, false));
  view.resizeObserver.observe(view.viewport);

  root.querySelectorAll(".cmf-jump").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      scrollFeedToEdge(view, button.dataset.jump);
    });
  });

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
    clearPromptMetadataCache();
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
  collapseButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const collapsed = root.dataset.collapsed === "true";
    root.dataset.collapsed = String(!collapsed);
    const label = collapsed ? "Hide" : "Show";
    collapseButton.innerHTML = collapsed ? ICONS.eyeOff : ICONS.eye;
    collapseButton.title = label;
    collapseButton.setAttribute("aria-label", label);
  });
  root.addEventListener("click", () => {
    if (root.dataset.collapsed !== "true") return;
    root.dataset.collapsed = "false";
    collapseButton.innerHTML = ICONS.eyeOff;
    collapseButton.title = "Hide";
    collapseButton.setAttribute("aria-label", "Hide");
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

function updateViews(scrollToLatest, prependedCount = 0) {
  for (const view of state.views) updateView(view, scrollToLatest, prependedCount);
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
  updateJumpButtons(view);
}

function feedMaxScroll(view) {
  const vertical = isVerticalView(view);
  return vertical
    ? Math.max(0, view.viewport.scrollHeight - view.viewport.clientHeight)
    : Math.max(0, view.viewport.scrollWidth - view.viewport.clientWidth);
}

function feedScrollOffset(view) {
  return isVerticalView(view) ? view.viewport.scrollTop : view.viewport.scrollLeft;
}

function updateJumpButtons(view) {
  const maxScroll = feedMaxScroll(view);
  const scrollOffset = feedScrollOffset(view);
  const atLatest = scrollOffset <= 1;
  const atOldest = scrollOffset >= maxScroll - 1;

  view.jumpLatest.hidden = maxScroll <= 1 || atLatest;
  view.jumpOldest.hidden = maxScroll <= 1 || atOldest;
}

function scrollFeedToEdge(view, edge) {
  const vertical = isVerticalView(view);
  const maxScroll = feedMaxScroll(view);
  const scrollOffset = edge === "oldest" ? maxScroll : 0;

  if (vertical) {
    view.viewport.scrollTop = scrollOffset;
  } else {
    view.viewport.scrollLeft = scrollOffset;
  }
  renderVisibleItems(view);
  updateJumpButtons(view);
}

function updateView(view, scrollToLatest, prependedCount = 0) {
  applyViewSizing(view);
  const items = filteredItems();
  const pitch = viewPitch(view);
  const vertical = isVerticalView(view);

  if (vertical) {
    const totalHeight = Math.max(view.viewport.clientHeight, RAIL_PADDING * 2 + items.length * pitch);
    view.rail.style.width = "100%";
    view.rail.style.height = `${totalHeight}px`;
    view.root.dataset.scrollable = String(totalHeight > view.viewport.clientHeight + 1);
  } else {
    const totalWidth = Math.max(view.viewport.clientWidth, horizontalContentWidth(items.length));
    view.rail.style.width = `${totalWidth}px`;
    view.rail.style.height = "";
    view.root.dataset.scrollable = String(totalWidth > view.viewport.clientWidth + 1);
  }

  view.empty.style.display = items.length ? "none" : "grid";
  view.count.textContent = `${items.length} shown / ${state.items.length} kept`;

  if (scrollToLatest) {
    view.viewport.scrollLeft = 0;
    view.viewport.scrollTop = 0;
  } else if (prependedCount > 0) {
    const prependedDistance = prependedCount * pitch;
    if (vertical) {
      view.viewport.scrollTop += prependedDistance;
    } else {
      view.viewport.scrollLeft += prependedDistance;
    }
  }
  view.lastRange = "";
  renderVisibleItems(view);
  updateJumpButtons(view);
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
      id: "comfyui-media-feed.follow-latest",
      name: "Follow latest media",
      type: "boolean",
      defaultValue: loadSavedFollowLatest(),
      category: ["Media Feed", "Panel", "Follow latest media"],
      tooltip: "Automatically scroll the feed to newly generated media.",
      onChange: (newValue) => {
        followLatestSettingSeen = true;
        setFollowLatest(newValue);
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
      id: "comfyui-media-feed.metadata-position",
      name: "Metadata position",
      type: "combo",
      defaultValue: loadSavedMetadataPosition(),
      options: [
        { text: "Left", value: "left" },
        { text: "Right", value: "right" },
      ],
      category: ["Media Feed", "Viewer", "Metadata position"],
      tooltip: "Choose which side of the viewer shows prompt and metadata details.",
      onChange: (newValue) => {
        metadataPositionSettingSeen = true;
        setMetadataPosition(newValue);
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
