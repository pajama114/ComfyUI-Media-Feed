import {
  DEFAULT_ITEM_HEIGHT,
  DEFAULT_PLACEMENT,
  DEFAULT_SHOW_PROMPTS,
  DEFAULT_SCALE_VIEWER_MEDIA,
  DEFAULT_FOLLOW_LATEST,
  DEFAULT_METADATA_POSITION,
  DEFAULT_EXCLUDE_PREVIEW_MEDIA,
  DEFAULT_SHOW_FAVORITE_BUTTON,
  DEFAULT_FEED_STYLE,
  DEFAULT_MEDIA_SCOPE,
  STORAGE_KEYS,
} from "./constants.js";

export function installSettingsStorage(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const normalizePlacement = (...args) => actions.normalizePlacement(...args);
  const normalizeMetadataPosition = (...args) => actions.normalizeMetadataPosition(...args);
  const normalizeFeedStyle = (...args) => actions.normalizeFeedStyle(...args);
  const normalizeMediaScope = (...args) => actions.normalizeMediaScope(...args);
  const normalizeBooleanSetting = (...args) => actions.normalizeBooleanSetting(...args);
  const applyThumbnailHeight = (...args) => actions.applyThumbnailHeight(...args);
  const applyPlacement = (...args) => actions.applyPlacement(...args);
  const applyShowPrompts = (...args) => actions.applyShowPrompts(...args);
  const applyScaleViewerMedia = (...args) => actions.applyScaleViewerMedia(...args);
  const applyFollowLatest = (...args) => actions.applyFollowLatest(...args);
  const applyMetadataPosition = (...args) => actions.applyMetadataPosition(...args);
  const applyExcludePreviewMedia = (...args) => actions.applyExcludePreviewMedia(...args);
  const applyShowFavoriteButton = (...args) => actions.applyShowFavoriteButton(...args);
  const applyFeedStyle = (...args) => actions.applyFeedStyle(...args);
  const applyMediaScope = (...args) => actions.applyMediaScope(...args);
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
  
    if (!runtime.placementSettingSeen) applyPlacement(loadSavedPlacement());
    if (!runtime.promptSettingSeen) applyShowPrompts(loadSavedShowPrompts());
    if (!runtime.scaleViewerMediaSettingSeen) applyScaleViewerMedia(loadSavedScaleViewerMedia());
    if (!runtime.followLatestSettingSeen) applyFollowLatest(loadSavedFollowLatest());
    if (!runtime.metadataPositionSettingSeen) applyMetadataPosition(loadSavedMetadataPosition());
    if (!runtime.excludePreviewMediaSettingSeen) applyExcludePreviewMedia(loadSavedExcludePreviewMedia());
    if (!runtime.showFavoriteButtonSettingSeen) applyShowFavoriteButton(loadSavedShowFavoriteButton());
    if (!runtime.feedStyleSettingSeen) applyFeedStyle(loadSavedFeedStyle());
    if (!runtime.mediaScopeSettingSeen) applyMediaScope(loadSavedMediaScope());
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
  
  Object.assign(actions, {
    loadSavedPlacement,
    loadSavedShowPrompts,
    loadSavedScaleViewerMedia,
    loadSavedFollowLatest,
    loadSavedMetadataPosition,
    loadSavedExcludePreviewMedia,
    loadSavedShowFavoriteButton,
    loadSavedFeedStyle,
    loadSavedMediaScope,
    loadSavedFavoriteFiles,
    loadSettings,
    saveThumbnailHeight,
    savePlacement,
    saveShowPrompts,
    saveScaleViewerMedia,
    saveFollowLatest,
    saveMetadataPosition,
    saveExcludePreviewMedia,
    saveShowFavoriteButton,
    saveFeedStyle,
    saveMediaScope,
    saveFavoriteFiles,
  });
}

