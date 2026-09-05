import {
  DEFAULT_ITEM_HEIGHT,
  DEFAULT_PLACEMENT,
  DEFAULT_SHOW_PROMPTS,
  DEFAULT_SHOW_COMFY_PROGRESS,
  DEFAULT_SCALE_VIEWER_MEDIA,
  DEFAULT_VIEWER_FIT_SCALE,
  DEFAULT_FOLLOW_LATEST,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_METADATA_POSITION,
  DEFAULT_EXCLUDE_PREVIEW_MEDIA,
  DEFAULT_SHOW_FAVORITE_BUTTON,
  DEFAULT_FEED_STYLE,
  DEFAULT_MEDIA_SCOPE,
  DEFAULT_BATCH_DIVIDERS,
  DEFAULT_LOOP_AUDIO,
  DEFAULT_LOOP_VIDEOS,
  SESSION_ITEMS_STORAGE_KEY,
  SESSION_ITEMS_VERSION,
  STORAGE_KEYS,
} from "./constants.js";

const SESSION_MEDIA_KINDS = new Set(["image", "video", "audio"]);

export function installSettingsStorage(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const normalizePlacement = (...args) => actions.normalizePlacement(...args);
  const normalizeMetadataPosition = (...args) => actions.normalizeMetadataPosition(...args);
  const normalizeFeedStyle = (...args) => actions.normalizeFeedStyle(...args);
  const normalizeMediaScope = (...args) => actions.normalizeMediaScope(...args);
  const normalizeBatchDividers = (...args) => actions.normalizeBatchDividers(...args);
  const normalizeBooleanSetting = (...args) => actions.normalizeBooleanSetting(...args);
  const normalizeHistoryLimit = (...args) => actions.normalizeHistoryLimit(...args);
  const normalizeViewerFitScale = (...args) => actions.normalizeViewerFitScale(...args);
  const applyThumbnailHeight = (...args) => actions.applyThumbnailHeight(...args);
  const applyPlacement = (...args) => actions.applyPlacement(...args);
  const applyShowPrompts = (...args) => actions.applyShowPrompts(...args);
  const applyShowComfyProgress = (...args) => actions.applyShowComfyProgress(...args);
  const applyScaleViewerMedia = (...args) => actions.applyScaleViewerMedia(...args);
  const applyViewerFitScale = (...args) => actions.applyViewerFitScale(...args);
  const applyFollowLatest = (...args) => actions.applyFollowLatest(...args);
  const applyHistoryLimit = (...args) => actions.applyHistoryLimit(...args);
  const applyMetadataPosition = (...args) => actions.applyMetadataPosition(...args);
  const applyExcludePreviewMedia = (...args) => actions.applyExcludePreviewMedia(...args);
  const applyShowFavoriteButton = (...args) => actions.applyShowFavoriteButton(...args);
  const applyFeedStyle = (...args) => actions.applyFeedStyle(...args);
  const applyMediaScope = (...args) => actions.applyMediaScope(...args);
  const applyBatchDividers = (...args) => actions.applyBatchDividers(...args);
  const applyLoopVideos = (...args) => actions.applyLoopVideos(...args);
  const applyLoopAudio = (...args) => actions.applyLoopAudio(...args);
  const buildViewUrl = (...args) => actions.buildViewUrl(...args);
  const mediaKey = (...args) => actions.mediaKey(...args);
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

  function loadSavedShowComfyProgress() {
    try {
      const savedValue = window.localStorage?.getItem(STORAGE_KEYS.showComfyProgress);
      return savedValue == null ? DEFAULT_SHOW_COMFY_PROGRESS : normalizeBooleanSetting(savedValue);
    } catch {
      return DEFAULT_SHOW_COMFY_PROGRESS;
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

  function loadSavedViewerFitScale() {
    try {
      const savedValue = window.localStorage?.getItem(STORAGE_KEYS.viewerFitScale);
      return savedValue === null ? DEFAULT_VIEWER_FIT_SCALE : normalizeViewerFitScale(savedValue);
    } catch {
      return DEFAULT_VIEWER_FIT_SCALE;
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

  function loadSavedHistoryLimit() {
    try {
      const savedValue = window.localStorage?.getItem(STORAGE_KEYS.historyLimit);
      return savedValue === null ? DEFAULT_HISTORY_LIMIT : normalizeHistoryLimit(savedValue);
    } catch {
      return DEFAULT_HISTORY_LIMIT;
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

  function loadSavedBatchDividers() {
    try {
      return normalizeBatchDividers(window.localStorage?.getItem(STORAGE_KEYS.batchDividers));
    } catch {
      return DEFAULT_BATCH_DIVIDERS;
    }
  }

  function loadSavedLoopVideos() {
    try {
      const savedValue = window.localStorage?.getItem(STORAGE_KEYS.loopVideos);
      return savedValue === null ? DEFAULT_LOOP_VIDEOS : normalizeBooleanSetting(savedValue);
    } catch {
      return DEFAULT_LOOP_VIDEOS;
    }
  }

  function loadSavedLoopAudio() {
    try {
      const savedValue = window.localStorage?.getItem(STORAGE_KEYS.loopAudio);
      return savedValue === null ? DEFAULT_LOOP_AUDIO : normalizeBooleanSetting(savedValue);
    } catch {
      return DEFAULT_LOOP_AUDIO;
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

  function sessionItemRecord(item) {
    return {
      kind: item.kind,
      filename: boundedString(item.filename, 4096),
      subfolder: boundedString(item.subfolder, 4096),
      type: boundedString(item.type, 64, "output") || "output",
      promptId: boundedString(item.promptId, 256),
      nodeId: typeof item.nodeId === "number"
        ? item.nodeId
        : boundedString(item.nodeId, 256),
      workflowTabId: boundedString(item.workflowTabId, 4096),
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
    };
  }

  function saveSessionItems() {
    try {
      window.sessionStorage?.setItem(SESSION_ITEMS_STORAGE_KEY, JSON.stringify({
        version: SESSION_ITEMS_VERSION,
        items: state.items.slice(0, state.historyLimit).map(sessionItemRecord),
      }));
    } catch {
      // Ignore storage failures; the feed should keep working in memory.
    }
  }

  function clearSessionItems() {
    try {
      window.sessionStorage?.removeItem(SESSION_ITEMS_STORAGE_KEY);
    } catch {
      // Ignore storage failures; the in-memory feed can still be cleared.
    }
  }

  function boundedString(value, maximumLength, fallback = "") {
    return typeof value === "string" && value.length <= maximumLength ? value : fallback;
  }

  function restoreSessionItem(savedItem) {
    if (!savedItem || typeof savedItem !== "object" || Array.isArray(savedItem)) return null;
    if (!SESSION_MEDIA_KINDS.has(savedItem.kind)) return null;

    const filename = boundedString(savedItem.filename, 4096);
    if (!filename) return null;
    const file = {
      filename,
      subfolder: boundedString(savedItem.subfolder, 4096),
      type: boundedString(savedItem.type, 64, "output") || "output",
    };
    const key = mediaKey(file, savedItem.kind);
    return {
      id: `restored-${Date.now()}-${state.sequence++}`,
      key,
      kind: savedItem.kind,
      filename: file.filename,
      subfolder: file.subfolder,
      type: file.type,
      url: buildViewUrl(file),
      promptId: boundedString(savedItem.promptId, 256),
      nodeId: typeof savedItem.nodeId === "number"
        ? savedItem.nodeId
        : boundedString(savedItem.nodeId, 256),
      workflowTabId: boundedString(savedItem.workflowTabId, 4096),
      createdAt: Number.isFinite(savedItem.createdAt) ? savedItem.createdAt : Date.now(),
    };
  }

  function loadSessionItems() {
    try {
      const savedValue = window.sessionStorage?.getItem(SESSION_ITEMS_STORAGE_KEY);
      if (!savedValue) return;
      const saved = JSON.parse(savedValue);
      if (saved?.version !== SESSION_ITEMS_VERSION || !Array.isArray(saved.items)) {
        clearSessionItems();
        return;
      }

      const restoredItems = [];
      const restoredKeys = new Set();
      for (const savedItem of saved.items.slice(0, state.historyLimit)) {
        const item = restoreSessionItem(savedItem);
        if (!item || restoredKeys.has(item.key)) continue;
        restoredKeys.add(item.key);
        restoredItems.push(item);
      }
      state.items = restoredItems;
      state.itemKeys = restoredKeys;
    } catch {
      clearSessionItems();
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
    if (!runtime.showComfyProgressSettingSeen) applyShowComfyProgress(loadSavedShowComfyProgress());
    if (!runtime.scaleViewerMediaSettingSeen) applyScaleViewerMedia(loadSavedScaleViewerMedia());
    if (!runtime.viewerFitScaleSettingSeen) applyViewerFitScale(loadSavedViewerFitScale());
    if (!runtime.followLatestSettingSeen) applyFollowLatest(loadSavedFollowLatest());
    if (!runtime.historyLimitSettingSeen) applyHistoryLimit(loadSavedHistoryLimit());
    if (!runtime.metadataPositionSettingSeen) applyMetadataPosition(loadSavedMetadataPosition());
    if (!runtime.excludePreviewMediaSettingSeen) applyExcludePreviewMedia(loadSavedExcludePreviewMedia());
    if (!runtime.showFavoriteButtonSettingSeen) applyShowFavoriteButton(loadSavedShowFavoriteButton());
    if (!runtime.feedStyleSettingSeen) applyFeedStyle(loadSavedFeedStyle());
    if (!runtime.mediaScopeSettingSeen) applyMediaScope(loadSavedMediaScope());
    if (!runtime.batchDividersSettingSeen) applyBatchDividers(loadSavedBatchDividers());
    if (!runtime.loopVideosSettingSeen) applyLoopVideos(loadSavedLoopVideos());
    if (!runtime.loopAudioSettingSeen) applyLoopAudio(loadSavedLoopAudio());
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

  function saveShowComfyProgress() {
    try {
      window.localStorage?.setItem(STORAGE_KEYS.showComfyProgress, String(state.showComfyProgress));
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

  function saveViewerFitScale() {
    try {
      window.localStorage?.setItem(STORAGE_KEYS.viewerFitScale, String(state.viewerFitScale));
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

  function saveHistoryLimit() {
    try {
      window.localStorage?.setItem(STORAGE_KEYS.historyLimit, String(state.historyLimit));
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

  function saveBatchDividers() {
    try {
      window.localStorage?.setItem(STORAGE_KEYS.batchDividers, state.batchDividers);
    } catch {
      // Ignore storage failures; the feed should keep working with in-memory settings.
    }
  }

  function saveLoopVideos() {
    try {
      window.localStorage?.setItem(STORAGE_KEYS.loopVideos, String(state.loopVideos));
    } catch {
      // Ignore storage failures; the feed should keep working with in-memory settings.
    }
  }

  function saveLoopAudio() {
    try {
      window.localStorage?.setItem(STORAGE_KEYS.loopAudio, String(state.loopAudio));
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
    loadSavedShowComfyProgress,
    loadSavedScaleViewerMedia,
    loadSavedViewerFitScale,
    loadSavedFollowLatest,
    loadSavedHistoryLimit,
    loadSavedMetadataPosition,
    loadSavedExcludePreviewMedia,
    loadSavedShowFavoriteButton,
    loadSavedFeedStyle,
    loadSavedMediaScope,
    loadSavedBatchDividers,
    loadSavedLoopVideos,
    loadSavedLoopAudio,
    loadSavedFavoriteFiles,
    sessionItemRecord,
    saveSessionItems,
    clearSessionItems,
    restoreSessionItem,
    loadSessionItems,
    loadSettings,
    saveThumbnailHeight,
    savePlacement,
    saveShowPrompts,
    saveShowComfyProgress,
    saveScaleViewerMedia,
    saveViewerFitScale,
    saveFollowLatest,
    saveHistoryLimit,
    saveMetadataPosition,
    saveExcludePreviewMedia,
    saveShowFavoriteButton,
    saveFeedStyle,
    saveMediaScope,
    saveBatchDividers,
    saveLoopVideos,
    saveLoopAudio,
    saveFavoriteFiles,
  });
}
