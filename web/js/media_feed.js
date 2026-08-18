import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ICONS } from "./icons.js";
import { clearPromptMetadataCache, getCachedPromptMetadata, loadPromptMetadata } from "./metadata.js";
import { ensureMediaFeedStyles } from "./styles.js";

const EXTENSION_NAME = "comfyui.media_feed";
const MAX_ITEMS = 256;
const DECODED_IMAGE_CACHE_SIZE = 32;
const THUMBNAIL_CARD_CACHE_SIZE = 32;
const WORKFLOW_SCROLL_POSITION_CACHE_SIZE = 64;
const DEFAULT_ITEM_WIDTH = 143;
const DEFAULT_ITEM_HEIGHT = 143;
const MIN_ITEM_HEIGHT = 96;
const MAX_ITEM_HEIGHT = 220;
const ITEM_GAP = 8;
const SCROLLBAR_SPACE = 14;
const RAIL_PADDING = 4;
const CARD_TOP_OFFSET = 10;
const DEFAULT_CARD_TOP_OFFSET = 2;
const OVERSCAN = 5;
const FALLBACK_PANEL_EXTRA_HEIGHT = 80;
const FALLBACK_ROOT_ID = "comfy-media-feed-fallback";
const FALLBACK_EDGE_GAP = 12;
const FALLBACK_MIN_LEFT_INSET = 76;
const FALLBACK_MIN_RIGHT_INSET = 12;
const FALLBACK_MIN_BOTTOM_INSET = 12;
const FALLBACK_MIN_TOP_INSET = 118;
const FALLBACK_MIN_BOTTOM_RIGHT_INSET = 300;
const FALLBACK_MIN_RIGHT_BOTTOM_INSET = 280;
const FLOATING_CANVAS_CONTROLS_MARGIN = 5;
const FLOATING_TOP_PROGRESS_MARGIN = 5;
const FLOATING_CANVAS_CONTROLS_SELECTOR = [
  ".minimap-main-container",
  "[data-testid='minimap-container']",
  "[data-testid='toggle-minimap-button']",
].join(", ");
const FLOATING_TOP_PROGRESS_SELECTOR = [
  "[data-testid='action-bar-card']",
  "[data-testid='queue-progress-overlay']",
].join(", ");
const DEFAULT_PLACEMENT = "bottom";
const DEFAULT_SHOW_PROMPTS = true;
const DEFAULT_SCALE_VIEWER_MEDIA = false;
const DEFAULT_FOLLOW_LATEST = true;
const DEFAULT_METADATA_POSITION = "left";
const DEFAULT_EXCLUDE_PREVIEW_MEDIA = false;
const DEFAULT_SHOW_FAVORITE_BUTTON = true;
const DEFAULT_FEED_STYLE = "default";
const DEFAULT_MEDIA_SCOPE = "all";
const VIEWER_IMAGE_ZOOM_STEP = 0.25;
const VIEWER_IMAGE_WHEEL_ZOOM_FACTOR = 1.1;
const VIEWER_IMAGE_DOUBLE_CLICK_ZOOM = 2;
const VIEWER_IMAGE_MIN_ZOOM = 0.25;
const VIEWER_IMAGE_MAX_ZOOM = 8;
const VIEWER_IMAGE_DRAG_THRESHOLD = 4;
const VIEWER_METADATA_LOADING_DELAY_MS = 120;
const SIDE_PLACEMENTS = new Set(["left", "right"]);
const PLACEMENTS = new Set(["top", "right", "bottom", "left"]);
const METADATA_POSITIONS = new Set(["left", "right"]);
const FEED_STYLES = new Set(["default", "frameless"]);
const MEDIA_SCOPES = new Set(["all", "current-tab"]);
const STORAGE_KEYS = {
  itemHeight: "comfyui-media-feed:item-height",
  placement: "comfyui-media-feed:placement",
  showPrompts: "comfyui-media-feed:show-prompts",
  scaleViewerMedia: "comfyui-media-feed:scale-viewer-media",
  followLatest: "comfyui-media-feed:follow-latest",
  metadataPosition: "comfyui-media-feed:metadata-position",
  excludePreviewMedia: "comfyui-media-feed:exclude-preview-media",
  showFavoriteButton: "comfyui-media-feed:show-favorite-button",
  feedStyle: "comfyui-media-feed:feed-style",
  mediaScope: "comfyui-media-feed:media-scope",
  favorites: "comfyui-media-feed:favorites",
};
const SHOW_PROMPTS_SETTING_ID = "comfyui-media-feed.show-prompts";
const SCALE_VIEWER_MEDIA_SETTING_ID = "comfyui-media-feed.scale-viewer-media";
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
  excludePreviewMedia: DEFAULT_EXCLUDE_PREVIEW_MEDIA,
  showFavoriteButton: DEFAULT_SHOW_FAVORITE_BUTTON,
  feedStyle: DEFAULT_FEED_STYLE,
  mediaScope: DEFAULT_MEDIA_SCOPE,
  favoriteFiles: new Map(),
  favoritingKeys: new Set(),
};

const decodedImageCache = new Map();
const mediaDimensionCache = new Map();
let floatingView = null;
let floatingWorkspaceResizeObserver = null;
let floatingWorkspaceMutationObserver = null;
let floatingWorkspaceElement = null;
let floatingCanvasControlsResizeObserver = null;
let floatingCanvasControlsElements = [];
let floatingTopProgressResizeObserver = null;
let floatingTopProgressElements = [];
let floatingBoundsAnimationFrame = 0;
let floatingBoundsWindowListenerAdded = false;
let setupComplete = false;
let placementSettingSeen = false;
let promptSettingSeen = false;
let scaleViewerMediaSettingSeen = false;
let followLatestSettingSeen = false;
let metadataPositionSettingSeen = false;
let excludePreviewMediaSettingSeen = false;
let showFavoriteButtonSettingSeen = false;
let feedStyleSettingSeen = false;
let mediaScopeSettingSeen = false;
let viewer = null;
let viewerWheelLock = false;
let workflowTabSequence = 0;
let activeWorkflowTabId = "";
let activeQueueRequest = null;
const workflowTabIds = new WeakMap();
const promptWorkflowTabs = new Map();
const pendingQueueRequests = [];
const copyFeedbackTimers = new WeakMap();

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

function formatMediaDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const remainingSeconds = totalSeconds % 60;
  const paddedSeconds = String(remainingSeconds).padStart(2, "0");

  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
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

function collectMedia(output, promptId, nodeId, workflowTabId = "") {
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
            promptId: String(promptId || ""),
            nodeId: nodeId || "",
            workflowTabId,
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
      if (existingIndex !== -1) {
        const [replaced] = state.items.splice(existingIndex, 1);
        for (const view of state.views) discardCachedCard(view, replaced.id);
      }
    }
    state.itemKeys.add(item.key);
    freshItems.push(item);
  }

  if (!freshItems.length) return;

  state.items.unshift(...freshItems.reverse());
  while (state.items.length > MAX_ITEMS) {
    const removed = state.items.pop();
    if (removed) {
      state.itemKeys.delete(removed.key);
      for (const view of state.views) discardCachedCard(view, removed.id);
    }
  }

  const visibleFreshCount = freshItems.filter(itemMatchesFilters).length;
  updateViews(
    visibleFreshCount > 0 && state.followLatest && !isViewerOpen(),
    state.followLatest ? 0 : visibleFreshCount,
  );
  if (isViewerOpen() && state.showPrompts) {
    const newestImage = freshItems.find((item) => item.kind === "image");
    if (newestImage) prefetchPromptMetadata(newestImage);
  }
  syncViewerItems();
}

function currentWorkflow() {
  return app.extensionManager?.workflow?.activeWorkflow || null;
}

function workflowTabId(workflow) {
  if (!workflow || (typeof workflow !== "object" && typeof workflow !== "function")) return "";

  let tabId = workflowTabIds.get(workflow);
  if (!tabId) {
    tabId = `workflow-tab-${++workflowTabSequence}`;
    workflowTabIds.set(workflow, tabId);
  }
  return tabId;
}

function currentWorkflowTabId() {
  return workflowTabId(currentWorkflow());
}

function itemMatchesMediaScope(item) {
  if (state.mediaScope !== "current-tab") return true;

  const tabId = currentWorkflowTabId();
  return !tabId || item.workflowTabId === tabId;
}

function itemMatchesFilters(item) {
  return itemMatchesMediaScope(item) && (state.filter === "all" || item.kind === state.filter);
}

function filteredItems() {
  return state.items.filter(itemMatchesFilters);
}

function isViewerOpen() {
  return viewer?.root?.dataset.open === "true";
}

function viewPitch(view) {
  return (isVerticalView(view) ? state.itemHeight : state.itemWidth) + ITEM_GAP;
}

function feedRailPadding() {
  return RAIL_PADDING;
}

function feedCardTopOffset() {
  if (state.placement === "top") return DEFAULT_CARD_TOP_OFFSET;
  return state.feedStyle === "default" ? DEFAULT_CARD_TOP_OFFSET : CARD_TOP_OFFSET;
}

function viewportHeight() {
  return state.itemHeight + feedCardTopOffset() + SCROLLBAR_SPACE;
}

function railHeight() {
  return state.itemHeight + feedCardTopOffset();
}

function fallbackPanelHeight() {
  return state.itemHeight + SCROLLBAR_SPACE + FALLBACK_PANEL_EXTRA_HEIGHT;
}

function horizontalContentWidth(itemCount) {
  if (!itemCount) return 0;
  return feedRailPadding() * 2 + itemCount * state.itemWidth + (itemCount - 1) * ITEM_GAP;
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

function normalizeFeedStyle(nextStyle) {
  const style = String(nextStyle || "").toLowerCase();
  return FEED_STYLES.has(style) ? style : DEFAULT_FEED_STYLE;
}

function normalizeMediaScope(nextScope) {
  const scope = String(nextScope || "").toLowerCase();
  return MEDIA_SCOPES.has(scope) ? scope : DEFAULT_MEDIA_SCOPE;
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
  state.itemWidth = itemHeight;
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

function applyExcludePreviewMedia(nextValue) {
  state.excludePreviewMedia = normalizeBooleanSetting(nextValue);
}

function applyShowFavoriteButton(nextValue) {
  state.showFavoriteButton = normalizeBooleanSetting(nextValue);
}

function applyFeedStyle(nextStyle) {
  state.feedStyle = normalizeFeedStyle(nextStyle);
}

function applyMediaScope(nextScope) {
  state.mediaScope = normalizeMediaScope(nextScope);
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

function loadSavedExcludePreviewMedia() {
  try {
    const savedValue = window.localStorage?.getItem(STORAGE_KEYS.excludePreviewMedia);
    return savedValue === null ? DEFAULT_EXCLUDE_PREVIEW_MEDIA : normalizeBooleanSetting(savedValue);
  } catch {
    return DEFAULT_EXCLUDE_PREVIEW_MEDIA;
  }
}

function loadSavedShowFavoriteButton() {
  try {
    const savedValue = window.localStorage?.getItem(STORAGE_KEYS.showFavoriteButton);
    return savedValue === null ? DEFAULT_SHOW_FAVORITE_BUTTON : normalizeBooleanSetting(savedValue);
  } catch {
    return DEFAULT_SHOW_FAVORITE_BUTTON;
  }
}

function loadSavedFeedStyle() {
  try {
    return normalizeFeedStyle(window.localStorage?.getItem(STORAGE_KEYS.feedStyle));
  } catch {
    return DEFAULT_FEED_STYLE;
  }
}

function loadSavedMediaScope() {
  try {
    return normalizeMediaScope(window.localStorage?.getItem(STORAGE_KEYS.mediaScope));
  } catch {
    return DEFAULT_MEDIA_SCOPE;
  }
}

function loadSavedFavoriteFiles() {
  try {
    const savedValue = window.localStorage?.getItem(STORAGE_KEYS.favorites);
    const savedFiles = JSON.parse(savedValue || "{}");
    if (!savedFiles || Array.isArray(savedFiles) || typeof savedFiles !== "object") return new Map();

    return new Map(Object.entries(savedFiles)
      .filter(([key, filename]) => typeof key === "string" && typeof filename === "string" && !/[\\\\/]/.test(filename))
      .slice(0, 2048));
  } catch {
    return new Map();
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
  if (!excludePreviewMediaSettingSeen) applyExcludePreviewMedia(loadSavedExcludePreviewMedia());
  if (!showFavoriteButtonSettingSeen) applyShowFavoriteButton(loadSavedShowFavoriteButton());
  if (!feedStyleSettingSeen) applyFeedStyle(loadSavedFeedStyle());
  if (!mediaScopeSettingSeen) applyMediaScope(loadSavedMediaScope());
  state.favoriteFiles = loadSavedFavoriteFiles();
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

function saveExcludePreviewMedia() {
  try {
    window.localStorage?.setItem(STORAGE_KEYS.excludePreviewMedia, String(state.excludePreviewMedia));
  } catch {
    // Ignore storage failures; the feed should keep working with in-memory settings.
  }
}

function saveShowFavoriteButton() {
  try {
    window.localStorage?.setItem(STORAGE_KEYS.showFavoriteButton, String(state.showFavoriteButton));
  } catch {
    // Ignore storage failures; the feed should keep working with in-memory settings.
  }
}

function saveFeedStyle() {
  try {
    window.localStorage?.setItem(STORAGE_KEYS.feedStyle, state.feedStyle);
  } catch {
    // Ignore storage failures; the feed should keep working with in-memory settings.
  }
}

function saveMediaScope() {
  try {
    window.localStorage?.setItem(STORAGE_KEYS.mediaScope, state.mediaScope);
  } catch {
    // Ignore storage failures; the feed should keep working with in-memory settings.
  }
}

function saveFavoriteFiles() {
  try {
    window.localStorage?.setItem(STORAGE_KEYS.favorites, JSON.stringify(Object.fromEntries(state.favoriteFiles)));
  } catch {
    // Ignore storage failures; favoriting should still work for this session.
  }
}

function setThumbnailHeight(nextHeight) {
  applyThumbnailHeight(nextHeight);
  saveThumbnailHeight();
  updateViews(false);
}

function syncComfySettingValue(settingId, value) {
  try {
    app.ui?.settings?.setSettingValue?.(settingId, value);
  } catch {
    // Older ComfyUI frontends do not expose a way to update an open settings panel.
  }
}

function setShowPrompts(nextValue, { syncSettings = false } = {}) {
  const showPrompts = normalizeBooleanSetting(nextValue);
  if (showPrompts !== state.showPrompts) {
    applyShowPrompts(showPrompts);
    saveShowPrompts();
    syncViewerMetadataToggle();
    updateViewerPromptPanel();
  }
  if (syncSettings) syncComfySettingValue(SHOW_PROMPTS_SETTING_ID, state.showPrompts);
}

function setScaleViewerMedia(nextValue, { syncSettings = false } = {}) {
  const scaleViewerMedia = normalizeBooleanSetting(nextValue);
  if (scaleViewerMedia !== state.scaleViewerMedia) {
    applyScaleViewerMedia(scaleViewerMedia);
    saveScaleViewerMedia();
    syncViewerScaleMedia();
  }
  if (syncSettings) syncComfySettingValue(SCALE_VIEWER_MEDIA_SETTING_ID, state.scaleViewerMedia);
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

function setExcludePreviewMedia(nextValue) {
  applyExcludePreviewMedia(nextValue);
  saveExcludePreviewMedia();
}

function setShowFavoriteButton(nextValue) {
  applyShowFavoriteButton(nextValue);
  saveShowFavoriteButton();
  for (const view of state.views) view.root.dataset.showFavoriteButton = String(state.showFavoriteButton);
}

function setFeedStyle(nextStyle) {
  applyFeedStyle(nextStyle);
  saveFeedStyle();
  updateViews(false);
}

function setMediaScope(nextScope) {
  const mediaScope = normalizeMediaScope(nextScope);
  if (mediaScope === state.mediaScope) return;

  if (state.mediaScope === "current-tab") saveWorkflowScrollPositions(activeWorkflowTabId);
  applyMediaScope(mediaScope);
  saveMediaScope();
  if (state.mediaScope === "current-tab") {
    updateViewsForWorkflowTab(activeWorkflowTabId);
  } else {
    updateViews(false);
  }

  if (isViewerOpen() && viewer?.item && !filteredItems().some((item) => item.key === viewer.item.key)) {
    closeViewer();
  } else {
    syncViewerItems();
  }
}

function setPlacement(nextPlacement) {
  applyPlacement(nextPlacement);
  savePlacement();
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
    cardTopOffset: feedCardTopOffset(),
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

function rememberMediaDimensions(item, element) {
  if (!item?.key) return;

  const size = viewerMediaNaturalSize(element);
  if (!size.width || !size.height) return;

  mediaDimensionCache.delete(item.key);
  mediaDimensionCache.set(item.key, size);

  while (mediaDimensionCache.size > MAX_ITEMS) {
    const oldestKey = mediaDimensionCache.keys().next().value;
    mediaDimensionCache.delete(oldestKey);
  }
}

function discardStagedMedia(element) {
  if (!(element instanceof HTMLMediaElement)) return;
  element.pause();
  element.removeAttribute("src");
  element.load();
}

function waitForMediaReady(element) {
  if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = window.setTimeout(settle, 2500);

    element.addEventListener("loadeddata", settle, { once: true });
    element.addEventListener("canplay", settle, { once: true });
    element.addEventListener("error", settle, { once: true });
  });
}

function replaceViewerMedia(currentViewer, nextMedia) {
  const previousMedia = currentViewer.media.querySelector("video, audio");
  currentViewer.media.replaceChildren(nextMedia);
  previousMedia?.pause();
  nextMedia.muted = false;
  nextMedia.play().catch(() => {});
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

function showCopyFeedback(button) {
  const previousFeedback = copyFeedbackTimers.get(button);
  if (previousFeedback) window.clearTimeout(previousFeedback.timeoutId);

  const title = previousFeedback?.title ?? button.title;
  const ariaLabel = previousFeedback?.ariaLabel ?? button.getAttribute("aria-label");
  button.title = "Copied";
  button.setAttribute("aria-label", "Copied");
  button.classList.remove("cmf-copy-success");
  void button.offsetWidth;
  button.classList.add("cmf-copy-success");

  const timeoutId = window.setTimeout(() => {
    button.classList.remove("cmf-copy-success");
    button.title = title;
    if (ariaLabel === null) {
      button.removeAttribute("aria-label");
    } else {
      button.setAttribute("aria-label", ariaLabel);
    }
    copyFeedbackTimers.delete(button);
  }, 1200);
  copyFeedbackTimers.set(button, { timeoutId, title, ariaLabel });
}

async function copyPromptText(event, source) {
  const button = event.currentTarget;
  button.blur();

  const text = typeof source === "string" ? source : String(source?.textContent || "");
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
        if (!document.execCommand("copy")) throw new Error("Clipboard copy failed");
      } finally {
        textarea.remove();
      }
    }
  } catch {
    return;
  }

  showCopyFeedback(button);
}

function formatAllViewerMetadata(result, details) {
  const sections = [];
  const appendSection = (heading, values) => {
    const lines = values.filter((value) => String(value || "").trim());
    if (lines.length) sections.push(`${heading}:\n${lines.join("\n")}`);
  };

  appendSection(
    "Resources",
    (Array.isArray(result?.resources) ? result.resources : [])
      .map((entry) => `${entry.label}: ${entry.value}`),
  );
  appendSection("Prompt", [result?.positive]);
  appendSection("Negative Prompt", [result?.negative]);
  appendSection("Seed", [result?.seed]);
  appendSection(
    "Other Metadata",
    (Array.isArray(details) ? details : [])
      .filter((entry) => String(entry?.label || "").toLowerCase() !== "seed")
      .map((entry) => `${entry.label}: ${entry.value}`),
  );

  return sections.join("\n\n");
}

function copyAllViewerMetadata(event) {
  const text = formatAllViewerMetadata(viewer?.lastPromptMetadata, viewer?.lastMetadataDetails);
  return copyPromptText(event, text);
}

function formatMetadataEntriesForCopy(entries, options = {}) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => !options.skipSeed || String(entry?.label || "").toLowerCase() !== "seed")
    .map((entry) => `${entry?.label || ""}: ${entry?.value || ""}`)
    .filter((line) => line !== ": ")
    .join("\n");
}

function copyViewerResources(event) {
  return copyPromptText(event, formatMetadataEntriesForCopy(viewer?.lastPromptMetadata?.resources));
}

function copyViewerOtherMetadata(event) {
  return copyPromptText(event, formatMetadataEntriesForCopy(viewer?.lastMetadataDetails, { skipSeed: true }));
}

function metadataDownloadFilename(filename) {
  const basename = String(filename || "metadata")
    .replace(/\.[^./\\]+$/, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return `${basename || "metadata"}-metadata.json`;
}

function downloadViewerEmbeddedJson(event) {
  const button = event.currentTarget;
  button.blur();

  const embeddedJson = viewer?.lastPromptMetadata?.embeddedJson;
  if (!embeddedJson || !Object.keys(embeddedJson).length) return;

  let json;
  try {
    json = JSON.stringify(embeddedJson, null, 2);
  } catch {
    return;
  }

  const url = URL.createObjectURL(new Blob([`${json}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = metadataDownloadFilename(viewer?.item?.filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
      <div class="cmf-viewer-zoom-controls" hidden aria-label="Media zoom controls">
        <div class="cmf-viewer-size-toggle" role="group" aria-label="Media display size">
          <button class="cmf-button cmf-viewer-zoom-text cmf-viewer-fit" type="button" title="Fit to viewer" aria-label="Fit to viewer" aria-pressed="false">Fit</button>
          <button class="cmf-button cmf-viewer-zoom-text cmf-viewer-native" type="button" title="Actual size" aria-label="Actual size" aria-pressed="false">1:1</button>
        </div>
        <button class="cmf-button cmf-icon-button cmf-viewer-zoom-out" type="button" title="Zoom out" aria-label="Zoom out">${ICONS.zoomOut}</button>
        <output class="cmf-viewer-zoom-level" aria-live="polite">Fit</output>
        <button class="cmf-button cmf-icon-button cmf-viewer-zoom-in" type="button" title="Zoom in" aria-label="Zoom in">${ICONS.zoomIn}</button>
      </div>
      <button class="cmf-button cmf-icon-button cmf-viewer-favorite" type="button" title="Add to favorites" aria-label="Add to favorites" aria-pressed="false">${ICONS.star}</button>
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
        <div class="cmf-prompt-panel-header">
          <h2 class="cmf-prompt-panel-title">Metadata</h2>
          <button class="cmf-button cmf-viewer-metadata-toggle cmf-hide-metadata" type="button" title="Hide metadata" aria-label="Hide metadata" aria-pressed="true">${ICONS.eyeOff}<span>Hide</span></button>
        </div>
        <div class="cmf-metadata-toolbar" role="group" aria-label="Metadata actions">
          <button class="cmf-button cmf-metadata-action cmf-copy-all" type="button" title="Copy all metadata" aria-label="Copy all metadata" disabled>${ICONS.copy}<span>Copy all</span></button>
          <button class="cmf-button cmf-metadata-action cmf-download-json" type="button" title="Download all embedded JSON" aria-label="Download all embedded JSON" disabled>${ICONS.download}<span>JSON</span></button>
        </div>
        <div class="cmf-prompt-status"></div>
        <button class="cmf-button cmf-scan-full-metadata" type="button" hidden>Read full file metadata</button>
        <section class="cmf-prompt-section cmf-resources-section" hidden>
          <div class="cmf-prompt-section-header">
            <h2 class="cmf-prompt-heading">Resources</h2>
            <button class="cmf-button cmf-icon-button cmf-prompt-copy cmf-copy-resources" type="button" title="Copy all resources" aria-label="Copy all resources">${ICONS.copy}</button>
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
            <button class="cmf-button cmf-icon-button cmf-prompt-copy cmf-copy-other-metadata" type="button" title="Copy all other metadata" aria-label="Copy all other metadata">${ICONS.copy}</button>
          </div>
          <div class="cmf-metadata-grid"></div>
        </section>
      </aside>
      <button class="cmf-button cmf-viewer-metadata-toggle cmf-show-metadata" type="button" title="Show metadata" aria-label="Show metadata" aria-pressed="false">${ICONS.eye}<span>Show metadata</span></button>
    </div>
  `;

  root.addEventListener("click", handleViewerBackdropClick);
  root.querySelector(".cmf-close").addEventListener("click", closeViewer);
  for (const button of root.querySelectorAll(".cmf-viewer-metadata-toggle")) {
    button.addEventListener("click", () => setShowPrompts(!state.showPrompts, { syncSettings: true }));
  }
  root.querySelector(".cmf-viewer-favorite").addEventListener("click", () => toggleFavorite(viewer?.item));
  root.querySelector(".cmf-copy-seed").addEventListener("click", (event) => copyPromptText(event, viewer?.promptSeed));
  root.querySelector(".cmf-copy-positive").addEventListener("click", (event) => copyPromptText(event, viewer?.promptPositive));
  root.querySelector(".cmf-copy-negative").addEventListener("click", (event) => copyPromptText(event, viewer?.promptNegative));
  root.querySelector(".cmf-copy-all").addEventListener("click", copyAllViewerMetadata);
  root.querySelector(".cmf-copy-resources").addEventListener("click", copyViewerResources);
  root.querySelector(".cmf-copy-other-metadata").addEventListener("click", copyViewerOtherMetadata);
  root.querySelector(".cmf-download-json").addEventListener("click", downloadViewerEmbeddedJson);
  root.querySelector(".cmf-scan-full-metadata").addEventListener("click", scanFullViewerMetadata);
  root.querySelector(".cmf-viewer-fit").addEventListener("click", () => setViewerImageBaseMode("fit"));
  root.querySelector(".cmf-viewer-native").addEventListener("click", () => setViewerImageBaseMode("native"));
  root.querySelector(".cmf-viewer-zoom-out").addEventListener("click", () => {
    setViewerImageZoom(viewer?.imageZoom - VIEWER_IMAGE_ZOOM_STEP);
  });
  root.querySelector(".cmf-viewer-zoom-in").addEventListener("click", () => {
    setViewerImageZoom(viewer?.imageZoom + VIEWER_IMAGE_ZOOM_STEP);
  });
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
    copyAllMetadataButton: root.querySelector(".cmf-copy-all"),
    downloadMetadataButton: root.querySelector(".cmf-download-json"),
    resourcesSection: root.querySelector(".cmf-resources-section"),
    resourcesGrid: root.querySelector(".cmf-resource-grid"),
    metadataSection: root.querySelector(".cmf-metadata-section"),
    metadataGrid: root.querySelector(".cmf-metadata-grid"),
    promptSeed: root.querySelector(".cmf-seed-text"),
    promptPositive: root.querySelector(".cmf-prompt-positive"),
    promptNegative: root.querySelector(".cmf-prompt-negative"),
    openLink: root.querySelector(".cmf-open-link"),
    hideMetadataButton: root.querySelector(".cmf-hide-metadata"),
    showMetadataButton: root.querySelector(".cmf-show-metadata"),
    favoriteButton: root.querySelector(".cmf-viewer-favorite"),
    zoomControls: root.querySelector(".cmf-viewer-zoom-controls"),
    fitButton: root.querySelector(".cmf-viewer-fit"),
    nativeButton: root.querySelector(".cmf-viewer-native"),
    zoomOutButton: root.querySelector(".cmf-viewer-zoom-out"),
    zoomInButton: root.querySelector(".cmf-viewer-zoom-in"),
    zoomLevel: root.querySelector(".cmf-viewer-zoom-level"),
    prevButton: root.querySelector(".cmf-nav-prev"),
    nextButton: root.querySelector(".cmf-nav-next"),
    promptRequestId: 0,
    promptLoadingTimer: 0,
    renderRequestId: 0,
    lastPromptMetadataItemId: "",
    lastMetadataDetails: [],
    pendingPromptMetadataResult: null,
    mediaReadyItemId: "",
    pendingMedia: null,
    item: null,
    items: [],
    index: -1,
    imageBaseMode: state.scaleViewerMedia ? "fit" : "native",
    imageZoom: 1,
    imagePanX: 0,
    imagePanY: 0,
    imageDrag: null,
    suppressImageClick: false,
  };
  viewer.resizeObserver = new ResizeObserver(() => updateViewerImageLayout());
  viewer.resizeObserver.observe(viewer.media);
  syncViewerMetadataToggle();
  syncViewerMetadataPosition();
  return viewer;
}

function syncViewerScaleMedia() {
  if (!viewer) return;
  resetViewerImageView(state.scaleViewerMedia ? "fit" : "native");
}

function syncViewerMetadataPosition() {
  if (!viewer) return;
  viewer.body.dataset.metadataPosition = state.metadataPosition;
}

function syncViewerMetadataToggle() {
  if (!viewer) return;

  const showing = state.showPrompts;
  viewer.hideMetadataButton.hidden = !showing;
  viewer.showMetadataButton.hidden = showing;
  viewer.hideMetadataButton.setAttribute("aria-pressed", String(showing));
  viewer.showMetadataButton.setAttribute("aria-pressed", String(showing));
}

function closeViewer() {
  if (!viewer) return;
  viewer.root.dataset.open = "false";
  viewer.promptRequestId++;
  viewer.renderRequestId++;
  clearViewerPromptLoadingTimer();
  viewer.body.dataset.prompts = "false";
  viewer.promptPanel.hidden = true;
  discardStagedMedia(viewer.pendingMedia);
  viewer.pendingMedia = null;
  viewer.media.querySelector("video, audio")?.pause();
  viewer.media.replaceChildren();
  viewer.item = null;
  viewer.items = [];
  viewer.index = -1;
  resetViewerImageView(state.scaleViewerMedia ? "fit" : "native");
}

function openViewer(item, thumbnail) {
  const currentViewer = ensureViewer();
  const items = filteredItems();
  const index = Math.max(0, items.findIndex((current) => current.key === item.key));
  currentViewer.items = items;
  currentViewer.index = index;
  resetViewerImageView(state.scaleViewerMedia ? "fit" : "native");
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
  let replacedCurrentItem = false;
  viewer.items = items;
  if (index !== -1) {
    replacedCurrentItem = viewer.item.id !== items[index].id;
    viewer.index = index;
    viewer.item = items[index];
  } else {
    viewer.index = Math.min(viewer.index, Math.max(0, items.length - 1));
  }
  syncViewerNav();

  if (replacedCurrentItem) {
    renderViewerItem(viewer.item);
    updateViewerPromptPanel();
  }
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

  const image = getViewerImage();
  if ((event.ctrlKey || event.metaKey) && image) {
    event.preventDefault();
    event.stopPropagation();
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (delta) {
      const factor = delta < 0 ? VIEWER_IMAGE_WHEEL_ZOOM_FACTOR : 1 / VIEWER_IMAGE_WHEEL_ZOOM_FACTOR;
      setViewerImageZoom(viewer.imageZoom * factor, { x: event.clientX, y: event.clientY });
    }
    return;
  }

  if (Math.abs(event.deltaY) < 8 && Math.abs(event.deltaX) < 8) return;

  event.preventDefault();
  event.stopPropagation();
  if (viewerWheelLock) return;

  viewerWheelLock = true;
  window.setTimeout(() => {
    viewerWheelLock = false;
  }, 70);

  const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  showViewerRelative(dominantDelta > 0 ? 1 : -1);
}

function getViewerImage() {
  const image = viewer?.media?.querySelector("img.cmf-zoomable-image");
  return image instanceof HTMLImageElement && image.dataset.mediaItemKey === viewer?.item?.key ? image : null;
}

function getViewerScalableMedia() {
  const element = viewer?.media?.querySelector(
    "img.cmf-zoomable-image, video.cmf-zoomable-video, audio.cmf-zoomable-audio",
  );
  return element instanceof HTMLElement && element.dataset.mediaItemKey === viewer?.item?.key ? element : null;
}

function clampViewerImageZoom(value) {
  return Math.min(VIEWER_IMAGE_MAX_ZOOM, Math.max(VIEWER_IMAGE_MIN_ZOOM, value));
}

function viewerImagePanBounds(image) {
  const frame = viewer?.media?.getBoundingClientRect();
  if (!frame?.width || !frame.height || !image?.offsetWidth || !image.offsetHeight) {
    return { x: 0, y: 0 };
  }

  return {
    x: Math.max(0, (image.offsetWidth * viewer.imageZoom - frame.width) / 2),
    y: Math.max(0, (image.offsetHeight * viewer.imageZoom - frame.height) / 2),
  };
}

function constrainViewerImagePan(image) {
  const bounds = viewerImagePanBounds(image);
  viewer.imagePanX = Math.min(bounds.x, Math.max(-bounds.x, viewer.imagePanX));
  viewer.imagePanY = Math.min(bounds.y, Math.max(-bounds.y, viewer.imagePanY));
  return bounds;
}

function canPanViewerImage(bounds) {
  if (!viewer) return false;
  const isFitAtBaseZoom = viewer.imageBaseMode === "fit" && viewer.imageZoom <= 1.001;
  return !isFitAtBaseZoom && (bounds.x > 0 || bounds.y > 0);
}

function updateViewerImageControls(media = getViewerScalableMedia()) {
  if (!viewer) return;
  const isScalableItem = viewer.item?.kind === "image" || viewer.item?.kind === "video" || viewer.item?.kind === "audio";
  const hasMedia = Boolean(media);
  viewer.zoomControls.hidden = !isScalableItem;
  if (!isScalableItem) return;

  const isBaseZoom = Math.abs(viewer.imageZoom - 1) < 0.001;
  viewer.fitButton.setAttribute("aria-pressed", String(viewer.imageBaseMode === "fit" && isBaseZoom));
  viewer.nativeButton.setAttribute("aria-pressed", String(viewer.imageBaseMode === "native" && isBaseZoom));
  viewer.fitButton.disabled = !hasMedia;
  viewer.nativeButton.disabled = !hasMedia;
  viewer.zoomOutButton.disabled = !hasMedia || viewer.imageZoom <= VIEWER_IMAGE_MIN_ZOOM + 0.001;
  viewer.zoomInButton.disabled = !hasMedia || viewer.imageZoom >= VIEWER_IMAGE_MAX_ZOOM - 0.001;
  viewer.zoomLevel.textContent = viewer.imageBaseMode === "fit" && isBaseZoom
    ? "Fit"
    : `${Math.round(viewer.imageZoom * 100)}%`;
}

function updateViewerImageLayout() {
  const media = getViewerScalableMedia();
  if (!media || !viewer?.media) {
    updateViewerImageControls(null);
    return;
  }

  const frame = viewer.media.getBoundingClientRect();
  if (!frame.width || !frame.height) return;

  if (media instanceof HTMLAudioElement) {
    const nativeWidth = 300;
    const fitWidth = Math.min(720, frame.width * 0.9);
    const baseWidth = viewer.imageBaseMode === "fit" ? fitWidth : nativeWidth;
    media.style.width = `${baseWidth * viewer.imageZoom}px`;
    viewer.media.dataset.pannable = "false";
    viewer.media.dataset.dragging = "false";
    updateViewerImageControls(media);
    return;
  }

  const natural = viewerMediaNaturalSize(media);
  if (!natural.width || !natural.height) return;

  const fitScale = Math.min(frame.width / natural.width, frame.height / natural.height);
  const baseScale = viewer.imageBaseMode === "fit" ? fitScale : 1;
  const layoutZoom = media instanceof HTMLVideoElement ? viewer.imageZoom : 1;
  media.style.width = `${natural.width * baseScale * layoutZoom}px`;
  media.style.height = `${natural.height * baseScale * layoutZoom}px`;

  if (media instanceof HTMLVideoElement) {
    viewer.media.dataset.pannable = "false";
    viewer.media.dataset.dragging = "false";
    updateViewerImageControls(media);
    return;
  }

  const image = media;
  const bounds = constrainViewerImagePan(image);
  image.style.setProperty("--cmf-image-zoom", String(viewer.imageZoom));
  image.style.setProperty("--cmf-image-pan-x", `${viewer.imagePanX}px`);
  image.style.setProperty("--cmf-image-pan-y", `${viewer.imagePanY}px`);
  viewer.media.dataset.pannable = String(canPanViewerImage(bounds));
  viewer.media.dataset.dragging = String(Boolean(viewer.imageDrag));
  updateViewerImageControls(image);
}

function resetViewerImageView(baseMode = viewer?.imageBaseMode || "native") {
  if (!viewer) return;
  viewer.imageBaseMode = baseMode === "fit" ? "fit" : "native";
  viewer.imageZoom = 1;
  viewer.imagePanX = 0;
  viewer.imagePanY = 0;
  viewer.imageDrag = null;
  viewer.root.dataset.scaleMedia = String(viewer.imageBaseMode === "fit");
  updateViewerImageLayout();
}

function setViewerImageBaseMode(baseMode) {
  if (!getViewerScalableMedia()) return;
  const scaleMedia = baseMode === "fit";
  const settingChanged = scaleMedia !== state.scaleViewerMedia;
  setScaleViewerMedia(scaleMedia, { syncSettings: true });
  if (!settingChanged) resetViewerImageView(baseMode);
}

function setViewerImageZoom(nextZoom, origin) {
  const media = getViewerScalableMedia();
  const image = getViewerImage();
  if (!media || !viewer) return;

  const previousZoom = viewer.imageZoom;
  const zoom = clampViewerImageZoom(nextZoom);
  if (Math.abs(zoom - previousZoom) < 0.001) return;

  if (origin && image) {
    const frame = viewer.media.getBoundingClientRect();
    const pointX = origin.x - (frame.left + frame.width / 2) - viewer.imagePanX;
    const pointY = origin.y - (frame.top + frame.height / 2) - viewer.imagePanY;
    const ratio = zoom / previousZoom;
    viewer.imagePanX -= pointX * (ratio - 1);
    viewer.imagePanY -= pointY * (ratio - 1);
  }

  viewer.imageZoom = zoom;
  updateViewerImageLayout();
}

function handleViewerImageDoubleClick(event) {
  if (!viewer || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  if (Math.abs(viewer.imageZoom - 1) < 0.001) {
    setViewerImageZoom(VIEWER_IMAGE_DOUBLE_CLICK_ZOOM, { x: event.clientX, y: event.clientY });
  } else {
    resetViewerImageView();
  }
}

function handleViewerImagePointerDown(event) {
  const image = event.currentTarget;
  const bounds = viewerImagePanBounds(image);
  if (event.button !== 0 || !canPanViewerImage(bounds)) return;

  event.preventDefault();
  image.setPointerCapture(event.pointerId);
  viewer.imageDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    panX: viewer.imagePanX,
    panY: viewer.imagePanY,
    moved: false,
  };
  updateViewerImageLayout();
}

function handleViewerImagePointerMove(event) {
  const drag = viewer?.imageDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;

  const deltaX = event.clientX - drag.startX;
  const deltaY = event.clientY - drag.startY;
  if (Math.abs(deltaX) >= VIEWER_IMAGE_DRAG_THRESHOLD || Math.abs(deltaY) >= VIEWER_IMAGE_DRAG_THRESHOLD) {
    drag.moved = true;
  }
  viewer.imagePanX = drag.panX + deltaX;
  viewer.imagePanY = drag.panY + deltaY;
  updateViewerImageLayout();
}

function finishViewerImageDrag(event) {
  const drag = viewer?.imageDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;

  const image = event.currentTarget;
  if (image.hasPointerCapture?.(event.pointerId)) image.releasePointerCapture(event.pointerId);
  viewer.imageDrag = null;
  if (drag.moved) {
    viewer.suppressImageClick = true;
    window.setTimeout(() => {
      if (viewer) viewer.suppressImageClick = false;
    }, 0);
  }
  updateViewerImageLayout();
}

function prepareViewerImage(image) {
  image.classList.add("cmf-zoomable-image");
  image.addEventListener("dblclick", handleViewerImageDoubleClick);
  image.addEventListener("pointerdown", handleViewerImagePointerDown);
  image.addEventListener("pointermove", handleViewerImagePointerMove);
  image.addEventListener("pointerup", finishViewerImageDrag);
  image.addEventListener("pointercancel", finishViewerImageDrag);
  image.addEventListener("dragstart", (event) => event.preventDefault());
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
  if (viewer?.suppressImageClick && event.target instanceof HTMLImageElement) {
    viewer.suppressImageClick = false;
    return;
  }

  if (event.target === viewer?.root || event.target === viewer?.body || event.target === viewer?.main || event.target === viewer?.media) {
    closeViewer();
    return;
  }

  if (!state.scaleViewerMedia || !viewer?.media) return;

  const element = event.target instanceof Element
    ? event.target.closest(".cmf-viewer-media img, .cmf-viewer-media video")
    : null;
  if (!element || !viewer.media.contains(element)) return;

  if (element instanceof HTMLImageElement && element.classList.contains("cmf-zoomable-image")) return;

  if (element instanceof HTMLVideoElement && element.controls) {
    const rect = element.getBoundingClientRect();
    if (event.clientY >= rect.bottom - 48) return;
  }

  if (!isInsideContainedMedia(event, element)) closeViewer();
}

async function renderViewerItem(item, thumbnail) {
  const currentViewer = ensureViewer();
  const requestId = ++currentViewer.renderRequestId;
  discardStagedMedia(currentViewer.pendingMedia);
  currentViewer.pendingMedia = null;
  currentViewer.item = item;
  currentViewer.mediaReadyItemId = "";
  resetViewerImageView();
  currentViewer.title.textContent = item.filename;
  currentViewer.openLink.href = item.url;
  syncFavoriteButton(currentViewer.favoriteButton, item);
  syncViewerNav();

  if (item.kind === "image") {
    const image = document.createElement("img");
    image.alt = item.filename;
    image.decoding = "async";
    image.dataset.mediaItemKey = item.key;
    prepareViewerImage(image);

    const cached = decodedImageCache.get(item.url);
    if (cached?.complete) {
      image.src = cached.currentSrc || cached.src;
      await decodeImageElement(image);
      if (!isCurrentViewerRender(currentViewer, requestId, item)) return;
      currentViewer.media.replaceChildren(image);
      updateViewerImageLayout();
      rememberDecodedImage(item.url, image);
      rememberMediaDimensions(item, image);
      currentViewer.mediaReadyItemId = item.id;
      refreshViewerPromptPanelDetails();
      return;
    }

    if (thumbnail?.complete) {
      rememberDecodedImage(item.url, thumbnail);
      image.src = thumbnail.currentSrc || thumbnail.src;
      await decodeImageElement(image);
      if (!isCurrentViewerRender(currentViewer, requestId, item)) return;
      currentViewer.media.replaceChildren(image);
      updateViewerImageLayout();
      rememberDecodedImage(item.url, image);
      rememberMediaDimensions(item, image);
      currentViewer.mediaReadyItemId = item.id;
      refreshViewerPromptPanelDetails();
      return;
    }

    image.src = item.url;
    await decodeImageElement(image);
    if (!isCurrentViewerRender(currentViewer, requestId, item)) return;
    currentViewer.media.replaceChildren(image);
    updateViewerImageLayout();
    rememberDecodedImage(item.url, image);
    rememberMediaDimensions(item, image);
    currentViewer.mediaReadyItemId = item.id;
    refreshViewerPromptPanelDetails();
    return;
  }

  if (item.kind === "video") {
    const video = document.createElement("video");
    video.classList.add("cmf-zoomable-video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "auto";
    video.muted = true;
    video.dataset.mediaItemKey = item.key;
    video.addEventListener("loadedmetadata", () => {
      rememberMediaDimensions(item, video);
      if (isCurrentViewerRender(currentViewer, requestId, item)) {
        updateViewerImageLayout();
      }
    }, { once: true });
    video.src = item.url;
    currentViewer.pendingMedia = video;
    video.play().catch(() => {});
    await waitForMediaReady(video);
    if (!isCurrentViewerRender(currentViewer, requestId, item)) {
      if (currentViewer.pendingMedia === video) currentViewer.pendingMedia = null;
      discardStagedMedia(video);
      return;
    }
    currentViewer.pendingMedia = null;
    replaceViewerMedia(currentViewer, video);
    updateViewerImageLayout();
    currentViewer.mediaReadyItemId = item.id;
    refreshViewerPromptPanelDetails();
    return;
  }

  const audio = document.createElement("audio");
  audio.classList.add("cmf-zoomable-audio");
  audio.controls = true;
  audio.preload = "auto";
  audio.muted = true;
  audio.dataset.mediaItemKey = item.key;
  audio.src = item.url;
  currentViewer.pendingMedia = audio;
  audio.play().catch(() => {});
  await waitForMediaReady(audio);
  if (!isCurrentViewerRender(currentViewer, requestId, item)) {
    if (currentViewer.pendingMedia === audio) currentViewer.pendingMedia = null;
    discardStagedMedia(audio);
    return;
  }
  currentViewer.pendingMedia = null;
  replaceViewerMedia(currentViewer, audio);
  updateViewerImageLayout();
  currentViewer.mediaReadyItemId = item.id;
}

function resetViewerPromptPanel(status = "") {
  if (!viewer) return;
  clearViewerPromptLoadingTimer();
  viewer.promptPanel.dataset.loading = "false";
  viewer.promptPanel.dataset.rendered = "false";
  viewer.promptPanel.setAttribute("aria-busy", "false");
  viewer.lastPromptMetadata = null;
  viewer.lastPromptMetadataItemId = "";
  viewer.lastMetadataDetails = [];
  viewer.pendingPromptMetadataResult = null;
  viewer.promptStatus.textContent = status;
  viewer.scanFullMetadataButton.hidden = true;
  viewer.scanFullMetadataButton.disabled = false;
  viewer.copyAllMetadataButton.disabled = true;
  viewer.downloadMetadataButton.disabled = true;
  viewer.resourcesGrid.replaceChildren();
  viewer.resourcesSection.hidden = true;
  viewer.metadataGrid.replaceChildren();
  viewer.metadataSection.hidden = true;
  viewer.promptSeed.textContent = "";
  viewer.promptPositive.textContent = "";
  viewer.promptNegative.textContent = "";
}

function clearViewerPromptLoadingTimer() {
  if (!viewer?.promptLoadingTimer) return;
  window.clearTimeout(viewer.promptLoadingTimer);
  viewer.promptLoadingTimer = 0;
}

function beginViewerPromptPanelLoading() {
  if (!viewer) return;

  const hasRenderedMetadata = viewer.promptPanel.dataset.rendered === "true";
  if (!hasRenderedMetadata) resetViewerPromptPanel();
  clearViewerPromptLoadingTimer();
  viewer.lastPromptMetadata = null;
  viewer.lastPromptMetadataItemId = "";
  viewer.lastMetadataDetails = [];
  viewer.pendingPromptMetadataResult = null;
  viewer.promptStatus.textContent = "";
  viewer.scanFullMetadataButton.hidden = true;
  viewer.scanFullMetadataButton.disabled = false;
  viewer.copyAllMetadataButton.disabled = true;
  viewer.downloadMetadataButton.disabled = true;
  viewer.promptPanel.setAttribute("aria-busy", "true");
  if (!hasRenderedMetadata) {
    viewer.promptPanel.dataset.loading = "true";
    return;
  }

  // Fast local Range reads usually finish before this delay. Keeping the
  // existing layout until then avoids a blank intermediate frame.
  viewer.promptPanel.dataset.loading = "false";
  viewer.promptLoadingTimer = window.setTimeout(() => {
    viewer.promptLoadingTimer = 0;
    if (viewer?.promptPanel.getAttribute("aria-busy") === "true") {
      viewer.promptPanel.dataset.loading = "true";
    }
  }, VIEWER_METADATA_LOADING_DELAY_MS);
}

function prefetchPromptMetadata(item) {
  if (!item || item.kind !== "image" || getCachedPromptMetadata(item)) return;
  loadPromptMetadata(item).catch(() => {});
}

function prefetchAdjacentViewerPromptMetadata() {
  if (!viewer || !state.showPrompts || viewer.root.dataset.open !== "true") return;
  for (const index of [viewer.index - 1, viewer.index + 1]) {
    if (index >= 0 && index < viewer.items.length) prefetchPromptMetadata(viewer.items[index]);
  }
}

function currentViewerMediaDetails() {
  if (!viewer?.media) return [];

  const element = viewer.media.querySelector("img, video");
  if (element?.dataset.mediaItemKey !== viewer.item?.key) {
    const cachedSize = mediaDimensionCache.get(viewer.item?.key);
    if (!cachedSize?.width || !cachedSize?.height) return [];
    return [
      { label: "Width", value: String(cachedSize.width) },
      { label: "Height", value: String(cachedSize.height) },
    ];
  }
  const naturalSize = viewerMediaNaturalSize(element);
  if (naturalSize.width && naturalSize.height) rememberMediaDimensions(viewer.item, element);
  const size = naturalSize.width && naturalSize.height
    ? naturalSize
    : mediaDimensionCache.get(viewer.item?.key) || { width: 0, height: 0 };
  if (!size.width || !size.height) return [];

  return [
    { label: "Width", value: String(size.width) },
    { label: "Height", value: String(size.height) },
  ];
}

function appendMetadataDetails(details, fallbackDetails, preferredLabels = []) {
  const preferred = new Set(preferredLabels.map((label) => String(label).toLowerCase()));
  const usedLabels = new Set();
  const results = [];

  for (const entry of details) {
    const label = String(entry?.label || "").trim();
    const value = String(entry?.value || "").trim();
    if (!label || !value || preferred.has(label.toLowerCase())) continue;
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
  const pending = viewer?.pendingPromptMetadataResult;
  if (pending && pending.itemId === viewer.item?.id && viewer.mediaReadyItemId === pending.itemId) {
    viewer.pendingPromptMetadataResult = null;
    renderPromptMetadata(pending.result, pending.itemId);
    return;
  }

  if (!viewer?.lastPromptMetadata || viewer.root.dataset.open !== "true") return;
  if (viewer.lastPromptMetadataItemId !== viewer.item?.id) return;
  renderPromptMetadata(viewer.lastPromptMetadata);
}

function renderPromptMetadataWhenMediaReady(result, item) {
  if (!viewer || viewer.item?.id !== item?.id) return;
  const needsMediaDetails = item.kind === "image" || item.kind === "video";
  if (needsMediaDetails && viewer.mediaReadyItemId !== item.id) {
    viewer.pendingPromptMetadataResult = { result, itemId: item.id };
    return;
  }

  viewer.pendingPromptMetadataResult = null;
  renderPromptMetadata(result, item.id);
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

function renderPromptMetadata(result, itemId = viewer?.item?.id || "") {
  if (!viewer) return;
  clearViewerPromptLoadingTimer();
  viewer.promptPanel.dataset.loading = "false";
  viewer.promptPanel.dataset.rendered = "true";
  viewer.promptPanel.setAttribute("aria-busy", "false");
  viewer.lastPromptMetadata = result;
  viewer.lastPromptMetadataItemId = itemId;
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
    // Workflow metadata can describe a pre-upscale latent; the rendered media is authoritative.
    viewer.item?.kind === "image" || viewer.item?.kind === "video" ? ["Width", "Height"] : [],
  );
  viewer.lastMetadataDetails = details;
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
  viewer.copyAllMetadataButton.disabled = !formatAllViewerMetadata(result, details);
  viewer.downloadMetadataButton.disabled = !Object.keys(result.embeddedJson || {}).length;
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
    if (!viewer || viewer !== currentViewer || requestId !== currentViewer.promptRequestId || currentViewer.item?.id !== item.id) return;
    renderPromptMetadata(result, item.id);
  } catch {
    if (!viewer || viewer !== currentViewer || requestId !== currentViewer.promptRequestId || currentViewer.item?.id !== item.id) return;
    renderPromptMetadata({
      seed: "",
      positive: "",
      negative: "",
      resources: [],
      details: [],
      status: "Could not read embedded prompt metadata.",
      requiresFullScan: false,
    }, item.id);
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
  const cached = getCachedPromptMetadata(item);
  if (cached) {
    renderPromptMetadataWhenMediaReady(cached, item);
    prefetchAdjacentViewerPromptMetadata();
    return;
  }

  beginViewerPromptPanelLoading();

  loadPromptMetadata(item)
    .then((result) => {
      if (!viewer || requestId !== viewer.promptRequestId || viewer.item?.id !== item.id) return;
      renderPromptMetadataWhenMediaReady(result, item);
      prefetchAdjacentViewerPromptMetadata();
    })
    .catch(() => {
      if (!viewer || requestId !== viewer.promptRequestId || viewer.item?.id !== item.id) return;
      renderPromptMetadataWhenMediaReady({
        seed: "",
        positive: "",
        negative: "",
        resources: [],
        details: [],
        status: "Could not read embedded prompt metadata.",
      }, item);
    });
}

function fitThumbnailMedia(media, preview) {
  const width = preview.clientWidth;
  const height = preview.clientHeight;
  const mediaWidth = media.naturalWidth || media.videoWidth;
  const mediaHeight = media.naturalHeight || media.videoHeight;
  if (!width || !height || !mediaWidth || !mediaHeight) return;

  const scale = Math.min(width / mediaWidth, height / mediaHeight);
  media.style.width = `${mediaWidth * scale}px`;
  media.style.height = `${mediaHeight * scale}px`;
}

function canFavorite(item) {
  return item?.type === "output";
}

function isFavorite(item) {
  return Boolean(item && state.favoriteFiles.has(item.key));
}

function syncFavoriteButton(button, item) {
  if (!button) return;

  const supported = canFavorite(item);
  const favorited = isFavorite(item);
  const pending = Boolean(item && state.favoritingKeys.has(item.key));
  const label = !supported
    ? "Only output media can be favorited"
    : favorited
      ? "Remove from favorites"
      : pending
        ? "Updating favorites"
        : "Add to favorites";

  button.disabled = !supported || pending;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(favorited));
}

function syncFavoriteControls() {
  for (const view of state.views) {
    for (const [id, card] of view.cards) {
      const item = state.items.find((current) => current.id === id);
      syncFavoriteButton(card.favoriteButton, item);
    }
  }
  syncFavoriteButton(viewer?.favoriteButton, viewer?.item);
}

async function toggleFavorite(item) {
  if (!canFavorite(item) || state.favoritingKeys.has(item.key)) return;

  state.favoritingKeys.add(item.key);
  syncFavoriteControls();
  try {
    const favoriteFilename = state.favoriteFiles.get(item.key);
    const adding = !favoriteFilename;
    const response = await fetch(apiUrl("/media-feed/favorite"), {
      method: adding ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adding
        ? {
          filename: item.filename,
          subfolder: item.subfolder,
          type: item.type,
        }
        : { filename: favoriteFilename }),
    });
    if (!response.ok) throw new Error("Could not update favorites");

    if (adding) {
      const result = await response.json();
      if (typeof result?.filename !== "string" || /[\\\\/]/.test(result.filename)) {
        throw new Error("Invalid favorite response");
      }
      state.favoriteFiles.set(item.key, result.filename);
    } else {
      state.favoriteFiles.delete(item.key);
    }
    saveFavoriteFiles();
  } catch {
    // Keep the action available so the user can retry after resolving a file error.
  } finally {
    state.favoritingKeys.delete(item.key);
    syncFavoriteControls();
  }
}

function createCard(item) {
  const card = document.createElement("div");
  card.className = "cmf-card";
  card.role = "button";
  card.tabIndex = 0;
  card.title = item.filename;
  card.setAttribute("aria-label", item.kind === "video" ? `${item.filename} (video)` : item.filename);
  card.dataset.itemId = item.id;

  const preview = document.createElement("div");
  preview.className = "cmf-preview";

  if (item.kind === "image") {
    const image = document.createElement("img");
    image.alt = item.filename;
    image.decoding = "async";
    // Cards are already virtualized, so every created thumbnail is in or near the viewport.
    image.loading = "eager";
    image.src = item.url;
    const thumbnailResizeObserver = new ResizeObserver(() => fitThumbnailMedia(image, preview));
    thumbnailResizeObserver.observe(preview);
    card.thumbnailResizeObserver = thumbnailResizeObserver;
    image.addEventListener("load", () => {
      rememberDecodedImage(item.url, image);
      rememberMediaDimensions(item, image);
      fitThumbnailMedia(image, preview);
    }, { once: true });
    preview.appendChild(image);
    if (image.complete) window.requestAnimationFrame(() => fitThumbnailMedia(image, preview));
  } else if (item.kind === "video") {
    const video = document.createElement("video");
    const videoBadge = document.createElement("span");
    const duration = document.createElement("span");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.loop = true;
    videoBadge.className = "cmf-video-badge";
    videoBadge.title = "Video";
    videoBadge.setAttribute("aria-hidden", "true");
    videoBadge.innerHTML = ICONS.play;
    duration.className = "cmf-video-duration";
    duration.hidden = true;
    const thumbnailResizeObserver = new ResizeObserver(() => fitThumbnailMedia(video, preview));
    thumbnailResizeObserver.observe(preview);
    card.thumbnailResizeObserver = thumbnailResizeObserver;
    video.addEventListener("loadedmetadata", () => {
      rememberMediaDimensions(item, video);
      fitThumbnailMedia(video, preview);
      const text = formatMediaDuration(video.duration);
      if (!text) return;
      duration.textContent = text;
      duration.hidden = false;
    }, { once: true });
    video.src = item.url;
    preview.append(video, videoBadge, duration);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      window.requestAnimationFrame(() => fitThumbnailMedia(video, preview));
    }
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

  const favoriteButton = document.createElement("button");
  favoriteButton.className = "cmf-button cmf-icon-button cmf-card-favorite";
  favoriteButton.type = "button";
  favoriteButton.innerHTML = ICONS.star;
  favoriteButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleFavorite(item);
  });
  card.favoriteButton = favoriteButton;
  card.thumbnailPreview = preview;
  syncFavoriteButton(favoriteButton, item);
  card.append(preview, favoriteButton);
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
    if (event.target.closest(".cmf-audio-controls, .cmf-card-favorite")) return;
    openViewer(item, card.querySelector("img"));
  });
  card.addEventListener("keydown", (event) => {
    if (event.target.closest(".cmf-audio-controls, .cmf-card-favorite")) return;
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
        <button type="button" data-filter="all" data-filter-label="All media" aria-pressed="true" title="All media" aria-label="All media">${ICONS.grid}<span class="cmf-filter-count">0</span></button>
        <button type="button" data-filter="image" data-filter-label="Images" aria-pressed="false" title="Images" aria-label="Images">${ICONS.image}<span class="cmf-filter-count">0</span></button>
        <button type="button" data-filter="video" data-filter-label="Videos" aria-pressed="false" title="Videos" aria-label="Videos">${ICONS.video}<span class="cmf-filter-count">0</span></button>
        <button type="button" data-filter="audio" data-filter-label="Audio" aria-pressed="false" title="Audio" aria-label="Audio">${ICONS.music}<span class="cmf-filter-count">0</span></button>
      </div>
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
    sizeSlider: root.querySelector(".cmf-size-slider"),
    jumpLatest: root.querySelector(".cmf-jump-latest"),
    jumpOldest: root.querySelector(".cmf-jump-oldest"),
    cards: new Map(),
    cardCache: new Map(),
    workflowScrollPositions: new Map(),
    gaps: new Map(),
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
    for (const currentView of state.views) {
      clearCachedCards(currentView);
      currentView.workflowScrollPositions.clear();
    }
    state.items = [];
    state.itemKeys.clear();
    decodedImageCache.clear();
    mediaDimensionCache.clear();
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

function floatingWorkspaceTarget() {
  const graphPanel = document.querySelector(".graph-canvas-panel");
  if (graphPanel instanceof Element) return graphPanel;

  const canvas = app.canvas?.canvas;
  return canvas instanceof Element ? canvas : null;
}

function floatingCanvasControls() {
  const minimap = document.querySelector(".minimap-main-container")
    || document.querySelector("[data-testid='minimap-container']");
  const toolbar = document
    .querySelector("[data-testid='toggle-minimap-button']")
    ?.closest("[role='toolbar']");

  return [...new Set([minimap, toolbar].filter((element) => element instanceof Element))];
}

function floatingCanvasControlsBounds() {
  const rects = floatingCanvasControls()
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rects.length) return null;

  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function refreshFloatingCanvasControlsObserver() {
  const elements = floatingCanvasControls();
  const unchanged = elements.length === floatingCanvasControlsElements.length
    && elements.every((element, index) => element === floatingCanvasControlsElements[index]);
  if (unchanged) return;

  floatingCanvasControlsResizeObserver?.disconnect();
  floatingCanvasControlsElements = elements;
  floatingCanvasControlsResizeObserver = elements.length
    ? new ResizeObserver(scheduleFloatingPanelBoundsUpdate)
    : null;
  for (const element of elements) floatingCanvasControlsResizeObserver?.observe(element);
}

function nodeContainsFloatingCanvasControls(node) {
  if (!(node instanceof Element)) return false;
  return node.matches(FLOATING_CANVAS_CONTROLS_SELECTOR)
    || Boolean(node.querySelector(FLOATING_CANVAS_CONTROLS_SELECTOR));
}

function mutationChangesFloatingCanvasControls(mutation) {
  return [...mutation.addedNodes, ...mutation.removedNodes]
    .some(nodeContainsFloatingCanvasControls);
}

function floatingTopProgressTargets() {
  return [
    document.querySelector("[data-testid='action-bar-card']"),
    document.querySelector("[data-testid='queue-progress-overlay']"),
  ].filter((element) => element instanceof Element);
}

function floatingTopProgressLeft() {
  const actionBar = document.querySelector("[data-testid='action-bar-card']");
  const progress = document.querySelector("[data-testid='queue-progress-overlay']");
  const progressRect = progress?.getBoundingClientRect();
  if (progressRect?.width > 0 && progressRect.height > 0) return progressRect.left;

  const actionBarRect = actionBar?.getBoundingClientRect();
  if (!actionBarRect?.width || !actionBarRect.height) return null;

  const hiddenProgressWidth = Number.parseFloat(progress ? getComputedStyle(progress).width : "");
  return Number.isFinite(hiddenProgressWidth) && hiddenProgressWidth > 0
    ? actionBarRect.right - hiddenProgressWidth
    : actionBarRect.left;
}

function refreshFloatingTopProgressObserver() {
  const elements = floatingTopProgressTargets();
  const unchanged = elements.length === floatingTopProgressElements.length
    && elements.every((element, index) => element === floatingTopProgressElements[index]);
  if (unchanged) return;

  floatingTopProgressResizeObserver?.disconnect();
  floatingTopProgressElements = elements;
  floatingTopProgressResizeObserver = elements.length
    ? new ResizeObserver(scheduleFloatingPanelBoundsUpdate)
    : null;
  for (const element of elements) floatingTopProgressResizeObserver?.observe(element);
}

function nodeContainsFloatingTopProgress(node) {
  if (!(node instanceof Element)) return false;
  return node.matches(FLOATING_TOP_PROGRESS_SELECTOR)
    || Boolean(node.querySelector(FLOATING_TOP_PROGRESS_SELECTOR));
}

function mutationChangesFloatingTopProgress(mutation) {
  return [...mutation.addedNodes, ...mutation.removedNodes]
    .some(nodeContainsFloatingTopProgress);
}

function updateFloatingTopControlsInset(root) {
  if (root.dataset.placement !== "top" || window.matchMedia("(max-width: 720px)").matches) {
    root.style.removeProperty("--cmf-top-controls-inset");
    return;
  }

  const progressLeft = floatingTopProgressLeft();
  const toolbarRect = root.querySelector(".cmf-toolbar")?.getBoundingClientRect();
  if (!Number.isFinite(progressLeft) || !toolbarRect?.width) {
    root.style.removeProperty("--cmf-top-controls-inset");
    return;
  }

  const reservedInset = Math.max(0, toolbarRect.right - progressLeft + FLOATING_TOP_PROGRESS_MARGIN);
  root.style.setProperty("--cmf-top-controls-inset", `${Math.ceil(reservedInset)}px`);
}

function updateFloatingPanelBounds() {
  floatingBoundsAnimationFrame = 0;
  const root = floatingView?.root;
  const target = floatingWorkspaceTarget();
  if (!root || !target) return;

  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const leftInset = Math.max(FALLBACK_MIN_LEFT_INSET, rect.left + FALLBACK_EDGE_GAP);
  const rightInset = Math.max(FALLBACK_MIN_RIGHT_INSET, window.innerWidth - rect.right + FALLBACK_EDGE_GAP);
  const bottomInset = Math.max(FALLBACK_MIN_BOTTOM_INSET, window.innerHeight - rect.bottom + FALLBACK_EDGE_GAP);
  const controlsBounds = floatingCanvasControlsBounds();
  const bottomFeedRightInset = controlsBounds
    ? Math.max(rightInset, window.innerWidth - controlsBounds.left + FLOATING_CANVAS_CONTROLS_MARGIN)
    : FALLBACK_MIN_BOTTOM_RIGHT_INSET + rightInset - FALLBACK_MIN_RIGHT_INSET;
  const rightFeedBottomInset = controlsBounds
    ? Math.max(bottomInset, window.innerHeight - controlsBounds.top + FLOATING_CANVAS_CONTROLS_MARGIN)
    : FALLBACK_MIN_RIGHT_BOTTOM_INSET + bottomInset - FALLBACK_MIN_BOTTOM_INSET;

  root.style.setProperty("--cmf-safe-left", `${Math.round(leftInset)}px`);
  root.style.setProperty("--cmf-edge-right", `${Math.round(rightInset)}px`);
  root.style.setProperty("--cmf-safe-right", `${Math.ceil(bottomFeedRightInset)}px`);
  root.style.setProperty("--cmf-safe-right-bottom", `${Math.ceil(rightFeedBottomInset)}px`);

  // The graph bounds keep placements clear of persistent side and bottom panels.
  // Bottom and right placements additionally hug the measured canvas controls.
  root.style.setProperty("--cmf-safe-bottom", `${Math.round(bottomInset)}px`);
  root.style.setProperty("--cmf-safe-top", `${FALLBACK_MIN_TOP_INSET}px`);
  updateFloatingTopControlsInset(root);
}

function scheduleFloatingPanelBoundsUpdate() {
  if (floatingBoundsAnimationFrame) return;
  floatingBoundsAnimationFrame = window.requestAnimationFrame(updateFloatingPanelBounds);
}

function watchFloatingPanelBounds() {
  const target = floatingWorkspaceTarget();
  if (target !== floatingWorkspaceElement) {
    floatingWorkspaceResizeObserver?.disconnect();
    floatingWorkspaceElement = target;
    floatingWorkspaceResizeObserver = target
      ? new ResizeObserver(scheduleFloatingPanelBoundsUpdate)
      : null;
    floatingWorkspaceResizeObserver?.observe(target);
  }
  refreshFloatingCanvasControlsObserver();
  refreshFloatingTopProgressObserver();

  if (!floatingBoundsWindowListenerAdded) {
    window.addEventListener("resize", scheduleFloatingPanelBoundsUpdate, { passive: true });
    window.visualViewport?.addEventListener("resize", scheduleFloatingPanelBoundsUpdate, { passive: true });
    floatingBoundsWindowListenerAdded = true;
  }
  if (!floatingWorkspaceMutationObserver) {
    floatingWorkspaceMutationObserver = new MutationObserver((mutations) => {
      if (floatingWorkspaceTarget() !== floatingWorkspaceElement) {
        watchFloatingPanelBounds();
        return;
      }
      if (mutations.some(mutationChangesFloatingCanvasControls)) {
        refreshFloatingCanvasControlsObserver();
        scheduleFloatingPanelBoundsUpdate();
      }
      if (mutations.some(mutationChangesFloatingTopProgress)) {
        refreshFloatingTopProgressObserver();
        scheduleFloatingPanelBoundsUpdate();
      }
    });
    floatingWorkspaceMutationObserver.observe(document.body, { childList: true, subtree: true });
  }
  scheduleFloatingPanelBoundsUpdate();
}

function syncFloatingPanel() {
  const view = createFloatingPanel();
  if (!view) return;
  watchFloatingPanelBounds();
  applyFallbackPlacement(view.root);
  updateView(view, false);
}

function applyFallbackPlacement(root) {
  if (!root) return;
  root.dataset.placement = state.placement;
  if (!root.classList?.contains("cmf-fallback")) return;
  root.dataset.orientation = isVerticalPlacement() ? "vertical" : "horizontal";
}

function updateViews(scrollToLatest, prependedCount = 0) {
  for (const view of state.views) updateView(view, scrollToLatest, prependedCount);
}

function saveWorkflowScrollPositions(tabId) {
  if (!tabId) return;

  for (const view of state.views) {
    view.workflowScrollPositions.delete(tabId);
    view.workflowScrollPositions.set(tabId, {
      left: view.viewport.scrollLeft,
      top: view.viewport.scrollTop,
    });
    while (view.workflowScrollPositions.size > WORKFLOW_SCROLL_POSITION_CACHE_SIZE) {
      view.workflowScrollPositions.delete(view.workflowScrollPositions.keys().next().value);
    }
  }
}

function updateViewsForWorkflowTab(tabId) {
  for (const view of state.views) {
    const savedPosition = tabId ? view.workflowScrollPositions.get(tabId) : null;
    if (savedPosition) {
      view.workflowScrollPositions.delete(tabId);
      view.workflowScrollPositions.set(tabId, savedPosition);
    }
    updateView(view, false, 0, savedPosition || { left: 0, top: 0 });
  }
}

function applyViewSizing(view) {
  applyFallbackPlacement(view.root);
  view.root.dataset.showFavoriteButton = String(state.showFavoriteButton);
  view.root.dataset.feedStyle = state.feedStyle;
  view.root.style.setProperty("--cmf-item-width", `${state.itemWidth}px`);
  view.root.style.setProperty("--cmf-item-height", `${state.itemHeight}px`);
  view.root.style.setProperty("--cmf-panel-height", `${fallbackPanelHeight()}px`);
  view.root.style.setProperty("--cmf-rail-height", `${railHeight()}px`);
  view.root.style.setProperty("--cmf-viewport-height", `${viewportHeight()}px`);
  view.root.style.setProperty("--cmf-card-top-offset", `${feedCardTopOffset()}px`);
  view.sizeSlider.value = String(state.itemHeight);
}

function handleFeedWheel(event, view) {
  if (viewer?.root?.dataset.open === "true") return;
  if (view.root.dataset.feedStyle === "frameless") event.stopPropagation();
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

function updateFilterCounts(view) {
  const counts = { all: 0, image: 0, video: 0, audio: 0 };
  for (const item of state.items) {
    if (!itemMatchesMediaScope(item)) continue;
    counts.all++;
    if (counts[item.kind] !== undefined) counts[item.kind]++;
  }

  for (const button of view.root.querySelectorAll("button[data-filter]")) {
    const count = counts[button.dataset.filter] || 0;
    const label = button.dataset.filterLabel || "Media";
    button.querySelector(".cmf-filter-count").textContent = String(count);
    button.title = `${label}: ${count}`;
    button.setAttribute("aria-label", `${label}: ${count}`);
  }
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

function updateView(view, scrollToLatest, prependedCount = 0, scrollPosition = null) {
  applyViewSizing(view);
  const items = filteredItems();
  const pitch = viewPitch(view);
  const vertical = isVerticalView(view);

  if (vertical) {
    const totalHeight = Math.max(view.viewport.clientHeight, feedRailPadding() * 2 + items.length * pitch);
    view.rail.style.width = "100%";
    view.rail.style.height = `${totalHeight}px`;
    view.root.dataset.scrollable = String(totalHeight > view.viewport.clientHeight + 1);
  } else {
    const totalWidth = Math.max(view.viewport.clientWidth, horizontalContentWidth(items.length));
    view.rail.style.width = `${totalWidth}px`;
    view.rail.style.height = "";
    view.root.dataset.scrollable = String(totalWidth > view.viewport.clientWidth + 1);
  }

  view.empty.style.display = items.length || state.feedStyle === "frameless" ? "none" : "grid";
  updateFilterCounts(view);

  if (scrollToLatest) {
    view.viewport.scrollLeft = 0;
    view.viewport.scrollTop = 0;
  } else if (scrollPosition) {
    view.viewport.scrollLeft = Math.max(0, Number(scrollPosition.left) || 0);
    view.viewport.scrollTop = Math.max(0, Number(scrollPosition.top) || 0);
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

function destroyCard(card) {
  if (!card) return;
  card.thumbnailResizeObserver?.disconnect();
  for (const media of card.querySelectorAll("video, audio")) discardStagedMedia(media);
  card.remove();
}

function discardCachedCard(view, id) {
  const card = view?.cardCache?.get(id);
  if (!card) return;
  view.cardCache.delete(id);
  destroyCard(card);
}

function clearCachedCards(view) {
  if (!view?.cardCache) return;
  for (const card of view.cardCache.values()) destroyCard(card);
  view.cardCache.clear();
}

function cacheCard(view, id, card) {
  card.thumbnailResizeObserver?.disconnect();
  for (const media of card.querySelectorAll("video, audio")) media.pause();
  card.remove();
  view.cards.delete(id);

  if (!state.items.some((item) => item.id === id)) {
    destroyCard(card);
    return;
  }

  view.cardCache.delete(id);
  view.cardCache.set(id, card);
  while (view.cardCache.size > THUMBNAIL_CARD_CACHE_SIZE) {
    discardCachedCard(view, view.cardCache.keys().next().value);
  }
}

function takeCachedCard(view, id) {
  const card = view.cardCache.get(id);
  if (!card) return null;
  view.cardCache.delete(id);
  syncFavoriteButton(card.favoriteButton, state.items.find((item) => item.id === id));
  if (card.thumbnailResizeObserver && card.thumbnailPreview) {
    card.thumbnailResizeObserver.observe(card.thumbnailPreview);
  }
  return card;
}

function renderVisibleItems(view) {
  const items = filteredItems();
  const vertical = isVerticalView(view);
  const viewportSize = vertical ? view.viewport.clientHeight || 1 : view.viewport.clientWidth || 1;
  const scrollOffset = vertical ? view.viewport.scrollTop : view.viewport.scrollLeft;
  const pitch = viewPitch(view);
  const railPadding = feedRailPadding();
  const rawStart = Math.floor((scrollOffset - railPadding) / pitch) - OVERSCAN;
  const rawEnd = Math.ceil((scrollOffset + viewportSize - railPadding) / pitch) + OVERSCAN;
  const start = Math.max(0, rawStart);
  const end = Math.min(items.length, rawEnd);
  const rangeKey = `${state.filter}:${vertical ? "vertical" : "horizontal"}:${items.length}:${start}:${end}`;

  if (view.lastRange === rangeKey) return;
  view.lastRange = rangeKey;

  const visibleIds = new Set();
  const visibleGapIds = new Set();
  for (let index = start; index < end; index++) {
    const item = items[index];
    visibleIds.add(item.id);

    let card = view.cards.get(item.id);
    if (!card) {
      card = takeCachedCard(view, item.id) || createCard(item);
      view.cards.set(item.id, card);
      view.rail.appendChild(card);
    }
    card.style.transform = vertical
      ? `translateY(${railPadding + index * pitch}px)`
      : `translateX(${railPadding + index * pitch}px)`;

    if (index < items.length - 1) {
      visibleGapIds.add(item.id);
      let gap = view.gaps.get(item.id);
      if (!gap) {
        gap = document.createElement("div");
        gap.className = "cmf-feed-gap";
        gap.setAttribute("aria-hidden", "true");
        view.gaps.set(item.id, gap);
        view.rail.appendChild(gap);
      }
      gap.style.width = `${vertical ? state.itemWidth : ITEM_GAP}px`;
      gap.style.height = `${vertical ? ITEM_GAP : state.itemHeight}px`;
      gap.style.transform = vertical
        ? `translateY(${railPadding + index * pitch + state.itemHeight}px)`
        : `translateX(${railPadding + index * pitch + state.itemWidth}px)`;
    }
  }

  for (const [id, card] of view.cards) {
    if (visibleIds.has(id)) continue;
    cacheCard(view, id, card);
  }

  for (const [id, gap] of view.gaps) {
    if (visibleGapIds.has(id)) continue;
    gap.remove();
    view.gaps.delete(id);
  }
}

function isPreviewNode(nodeId) {
  const graph = app.graph;
  const node = graph?.getNodeById?.(nodeId) || graph?._nodes_by_id?.[nodeId];
  return /^preview/i.test(String(node?.type || ""));
}

function rememberPromptWorkflowTab(promptId, tabId) {
  const normalizedPromptId = String(promptId || "");
  if (!normalizedPromptId || !tabId) return;

  promptWorkflowTabs.delete(normalizedPromptId);
  promptWorkflowTabs.set(normalizedPromptId, tabId);
  while (promptWorkflowTabs.size > 1024) {
    promptWorkflowTabs.delete(promptWorkflowTabs.keys().next().value);
  }

  let updatedItems = false;
  let newlyVisibleCount = 0;
  for (const item of state.items) {
    if (item.promptId !== normalizedPromptId || item.workflowTabId === tabId) continue;
    const wasVisible = itemMatchesFilters(item);
    item.workflowTabId = tabId;
    if (!wasVisible && itemMatchesFilters(item)) newlyVisibleCount++;
    updatedItems = true;
  }
  if (updatedItems) {
    // A very fast execution can emit output before the /prompt response arrives.
    // Reveal those items once the response supplies the prompt ID mapping.
    updateViews(
      newlyVisibleCount > 0 && state.followLatest && !isViewerOpen(),
      state.followLatest ? 0 : newlyVisibleCount,
    );
    syncViewerItems();
  }
}

function handlePromptQueueing(event) {
  const detail = event?.detail || {};
  pendingQueueRequests.push({
    requestId: detail.requestId,
    workflowTabId: currentWorkflowTabId(),
  });
  while (pendingQueueRequests.length > 1024) pendingQueueRequests.shift();
}

function handlePromptQueued(event) {
  const requestId = event?.detail?.requestId;
  if (activeQueueRequest && (requestId === undefined || activeQueueRequest.requestId === requestId)) {
    activeQueueRequest = null;
  }
}

function beginPromptSubmission() {
  if (!activeQueueRequest && pendingQueueRequests.length) {
    activeQueueRequest = pendingQueueRequests.pop();
  }

  if (activeQueueRequest) {
    return {
      workflowTabId: activeQueueRequest.workflowTabId,
      trackedRequest: activeQueueRequest,
    };
  }
  return { workflowTabId: currentWorkflowTabId(), trackedRequest: null };
}

function wrapQueuePrompt() {
  if (typeof api.queuePrompt !== "function" || api.queuePrompt.__mediaFeedWrapped) return;

  const originalQueuePrompt = api.queuePrompt;
  async function mediaFeedQueuePrompt(...args) {
    const submission = beginPromptSubmission();
    try {
      const response = await Reflect.apply(originalQueuePrompt, this, args);
      rememberPromptWorkflowTab(response?.prompt_id, submission.workflowTabId);
      return response;
    } catch (error) {
      if (submission.trackedRequest === activeQueueRequest) activeQueueRequest = null;
      throw error;
    }
  }
  mediaFeedQueuePrompt.__mediaFeedWrapped = true;
  api.queuePrompt = mediaFeedQueuePrompt;
}

function handleActiveWorkflowChange() {
  const nextTabId = currentWorkflowTabId();
  if (nextTabId === activeWorkflowTabId) return;

  if (state.mediaScope === "current-tab") saveWorkflowScrollPositions(activeWorkflowTabId);
  activeWorkflowTabId = nextTabId;
  if (state.mediaScope !== "current-tab") return;

  updateViewsForWorkflowTab(activeWorkflowTabId);
  if (isViewerOpen() && viewer?.item && !filteredItems().some((item) => item.key === viewer.item.key)) {
    closeViewer();
  } else {
    syncViewerItems();
  }
}

function watchActiveWorkflow() {
  activeWorkflowTabId = currentWorkflowTabId();
  const workflowStore = app.extensionManager?.workflow;
  workflowStore?.$subscribe?.(handleActiveWorkflowChange, { detached: true, flush: "sync" });
}

function handleExecuted(event) {
  const detail = event?.detail || {};
  if (state.excludePreviewMedia && isPreviewNode(detail.node)) return;
  const promptId = String(detail.prompt_id || "");
  const tabId = promptWorkflowTabs.get(promptId) || "";
  const mediaItems = collectMedia(detail.output, promptId, detail.node, tabId);
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
      sortOrder: 1,
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
      sortOrder: 1,
      tooltip: "Automatically scroll the feed to newly generated media.",
      onChange: (newValue) => {
        followLatestSettingSeen = true;
        setFollowLatest(newValue);
      },
    },
    {
      id: "comfyui-media-feed.exclude-preview-media",
      name: "Exclude Preview node media",
      type: "boolean",
      defaultValue: loadSavedExcludePreviewMedia(),
      category: ["Media Feed", "Feed", "Exclude Preview node media"],
      sortOrder: 1,
      tooltip: "Do not add media emitted by Preview nodes, such as Preview Image, to the feed.",
      onChange: (newValue) => {
        excludePreviewMediaSettingSeen = true;
        setExcludePreviewMedia(newValue);
      },
    },
    {
      id: "comfyui-media-feed.feed-style",
      name: "Feed style",
      type: "combo",
      defaultValue: loadSavedFeedStyle(),
      options: [
        { text: "Default", value: "default" },
        { text: "Frameless", value: "frameless" },
      ],
      category: ["Media Feed", "Feed", "Feed style"],
      sortOrder: 1,
      tooltip: "Choose the standard feed or a frameless feed that keeps the on-panel size control while hiding other panel chrome.",
      onChange: (newValue) => {
        feedStyleSettingSeen = true;
        setFeedStyle(newValue);
      },
    },
    {
      id: "comfyui-media-feed.media-scope",
      name: "Media from",
      type: "combo",
      defaultValue: loadSavedMediaScope(),
      options: [
        { text: "All workflow tabs", value: "all" },
        { text: "Current workflow tab", value: "current-tab" },
      ],
      category: ["Media Feed", "Feed", "Media from"],
      sortOrder: 1,
      tooltip: "Show media from every workflow tab or only media queued from the currently active workflow tab.",
      onChange: (newValue) => {
        mediaScopeSettingSeen = true;
        setMediaScope(newValue);
      },
    },
    {
      id: "comfyui-media-feed.show-prompts",
      name: "Show metadata in viewer",
      type: "boolean",
      defaultValue: loadSavedShowPrompts(),
      category: ["Media Feed", "Viewer", "Show metadata in viewer"],
      sortOrder: 1,
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
      sortOrder: 1,
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
      sortOrder: 1,
      tooltip: "Fit images, videos, and audio players to the available viewer area.",
      onChange: (newValue) => {
        scaleViewerMediaSettingSeen = true;
        setScaleViewerMedia(newValue);
      },
    },
    {
      id: "comfyui-media-feed.show-favorite-button",
      name: "Show favorite button on hover",
      type: "boolean",
      defaultValue: loadSavedShowFavoriteButton(),
      category: ["Media Feed", "Favorites", "Show favorite button on hover"],
      tooltip: "Show the favorite star in the upper-right corner of a feed card when you hover over it.",
      onChange: (newValue) => {
        showFavoriteButtonSettingSeen = true;
        setShowFavoriteButton(newValue);
      },
    },
    {
      id: "comfyui-media-feed.favorite-folder",
      name: "Favorite storage folder",
      type: "combo",
      defaultValue: "output/favorites",
      options: [{ text: "output/favorites", value: "output/favorites" }],
      attrs: { disabled: true },
      category: ["Media Feed", "Favorites", "Favorite storage folder"],
      tooltip: "Favorites are always stored in the output/favorites folder and this location cannot be changed.",
    },
  ],
  async setup() {
    console.info("[ComfyUI Media Feed] extension loaded");
    loadSettings();
    ensureStyles();
    watchActiveWorkflow();
    api.addEventListener("promptQueueing", handlePromptQueueing);
    api.addEventListener("promptQueued", handlePromptQueued);
    api.addEventListener("executed", handleExecuted);
    wrapQueuePrompt();
    setupComplete = true;
    window.setTimeout(syncFloatingPanel, 1000);
  },
});
