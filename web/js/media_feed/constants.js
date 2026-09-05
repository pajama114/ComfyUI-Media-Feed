export const EXTENSION_NAME = "comfyui.media_feed";
export const DEFAULT_HISTORY_LIMIT = 256;
export const HISTORY_LIMIT_OPTIONS = [64, 128, 256, 512, 1024];
export const MEDIA_DIMENSION_CACHE_SIZE = 256;
export const DECODED_IMAGE_CACHE_SIZE = 32;
export const THUMBNAIL_CARD_CACHE_SIZE = 32;
export const WORKFLOW_SCROLL_POSITION_CACHE_SIZE = 64;
export const DEFAULT_ITEM_WIDTH = 143;
export const DEFAULT_ITEM_HEIGHT = 143;
export const MIN_ITEM_HEIGHT = 96;
export const MAX_ITEM_HEIGHT = 220;
export const ITEM_GAP = 8;
export const SCROLLBAR_SPACE = 14;
export const RAIL_PADDING = 4;
export const CARD_TOP_OFFSET = 10;
export const DEFAULT_CARD_TOP_OFFSET = 2;
export const OVERSCAN = 5;
export const FALLBACK_PANEL_EXTRA_HEIGHT = 80;
export const FALLBACK_ROOT_ID = "comfy-media-feed-fallback";
export const FALLBACK_EDGE_GAP = 12;
export const FALLBACK_MIN_LEFT_INSET = 76;
export const FALLBACK_MIN_RIGHT_INSET = 12;
export const FALLBACK_MIN_BOTTOM_INSET = 12;
export const FALLBACK_BOTTOM_PLACEMENT_GAP = 1;
export const FALLBACK_MIN_TOP_INSET = 118;
export const FALLBACK_MIN_BOTTOM_RIGHT_INSET = 300;
export const FALLBACK_MIN_RIGHT_BOTTOM_INSET = 280;
export const FLOATING_CANVAS_CONTROLS_MARGIN = 5;
export const FLOATING_TOP_PROGRESS_MARGIN = 5;
export const FLOATING_CANVAS_CONTROLS_SELECTOR = [
  ".minimap-main-container",
  "[data-testid='minimap-container']",
  "[data-testid='toggle-minimap-button']",
].join(", ");
export const FLOATING_TOP_PROGRESS_SELECTOR = [
  "[data-testid='action-bar-card']",
  "[data-testid='queue-progress-overlay']",
].join(", ");
export const DEFAULT_PLACEMENT = "bottom";
export const DEFAULT_SHOW_PROMPTS = true;
export const DEFAULT_SHOW_COMFY_PROGRESS = false;
export const DEFAULT_SCALE_VIEWER_MEDIA = false;
export const DEFAULT_FOLLOW_LATEST = true;
export const DEFAULT_METADATA_POSITION = "left";
export const DEFAULT_EXCLUDE_PREVIEW_MEDIA = false;
export const DEFAULT_SHOW_FAVORITE_BUTTON = true;
export const DEFAULT_FEED_STYLE = "default";
export const DEFAULT_MEDIA_SCOPE = "all";
export const DEFAULT_BATCH_DIVIDERS = "line";
export const DEFAULT_LOOP_VIDEOS = true;
export const DEFAULT_LOOP_AUDIO = false;
export const VIEWER_IMAGE_ZOOM_STEP = 0.25;
export const VIEWER_IMAGE_WHEEL_ZOOM_FACTOR = 1.1;
export const VIEWER_IMAGE_DOUBLE_CLICK_ZOOM = 2;
export const VIEWER_IMAGE_MIN_ZOOM = 0.25;
export const VIEWER_IMAGE_MAX_ZOOM = 8;
export const VIEWER_IMAGE_DRAG_THRESHOLD = 4;
export const VIEWER_METADATA_LOADING_DELAY_MS = 120;
export const SIDE_PLACEMENTS = new Set(["left", "right"]);
export const PLACEMENTS = new Set(["top", "right", "bottom", "left"]);
export const METADATA_POSITIONS = new Set(["left", "right"]);
export const FEED_STYLES = new Set(["default", "frameless"]);
export const MEDIA_SCOPES = new Set(["all", "current-tab"]);
export const BATCH_DIVIDER_STYLES = new Set(["none", "line"]);
export const STORAGE_KEYS = {
  itemHeight: "comfyui-media-feed:item-height",
  historyLimit: "comfyui-media-feed:history-limit",
  placement: "comfyui-media-feed:placement",
  showPrompts: "comfyui-media-feed:show-prompts",
  showComfyProgress: "comfyui-media-feed:show-comfy-progress",
  scaleViewerMedia: "comfyui-media-feed:scale-viewer-media",
  followLatest: "comfyui-media-feed:follow-latest",
  metadataPosition: "comfyui-media-feed:metadata-position",
  excludePreviewMedia: "comfyui-media-feed:exclude-preview-media",
  showFavoriteButton: "comfyui-media-feed:show-favorite-button",
  feedStyle: "comfyui-media-feed:feed-style",
  mediaScope: "comfyui-media-feed:media-scope",
  batchDividers: "comfyui-media-feed:batch-dividers",
  loopVideos: "comfyui-media-feed:loop-videos",
  loopAudio: "comfyui-media-feed:loop-audio",
  favorites: "comfyui-media-feed:favorites",
};
export const SESSION_ITEMS_STORAGE_KEY = "comfyui-media-feed:session-items";
export const SESSION_ITEMS_VERSION = 1;
export const SHOW_PROMPTS_SETTING_ID = "comfyui-media-feed.show-prompts";
export const SCALE_VIEWER_MEDIA_SETTING_ID = "comfyui-media-feed.scale-viewer-media";
export const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "webp"]);
export const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mkv", "mov", "mp4", "webm"]);
export const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav"]);
