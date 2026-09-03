import {
  DEFAULT_ITEM_WIDTH,
  DEFAULT_ITEM_HEIGHT,
  SHOW_PROMPTS_SETTING_ID,
  SCALE_VIEWER_MEDIA_SETTING_ID,
} from "./constants.js";

export function installSettings(context) {
  const { app, api, ICONS, state, runtime, actions } = context;
  const { ensureMediaFeedStyles } = context.services;

  const updateViews = (...args) => actions.updateViews(...args);
  const saveWorkflowScrollPositions = (...args) => actions.saveWorkflowScrollPositions(...args);
  const updateViewsForWorkflowTab = (...args) => actions.updateViewsForWorkflowTab(...args);
  const syncFloatingPanel = (...args) => actions.syncFloatingPanel(...args);
  const filteredItems = (...args) => actions.filteredItems(...args);
  const isViewerOpen = (...args) => actions.isViewerOpen(...args);
  const feedCardTopOffset = (...args) => actions.feedCardTopOffset(...args);
  const viewportHeight = (...args) => actions.viewportHeight(...args);
  const railHeight = (...args) => actions.railHeight(...args);
  const fallbackPanelHeight = (...args) => actions.fallbackPanelHeight(...args);
  const normalizeMediaScope = (...args) => actions.normalizeMediaScope(...args);
  const normalizeBooleanSetting = (...args) => actions.normalizeBooleanSetting(...args);
  const applyThumbnailHeight = (...args) => actions.applyThumbnailHeight(...args);
  const applyPlacement = (...args) => actions.applyPlacement(...args);
  const applyShowPrompts = (...args) => actions.applyShowPrompts(...args);
  const applyScaleViewerMedia = (...args) => actions.applyScaleViewerMedia(...args);
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
  const saveThumbnailHeight = (...args) => actions.saveThumbnailHeight(...args);
  const savePlacement = (...args) => actions.savePlacement(...args);
  const saveShowPrompts = (...args) => actions.saveShowPrompts(...args);
  const saveScaleViewerMedia = (...args) => actions.saveScaleViewerMedia(...args);
  const saveFollowLatest = (...args) => actions.saveFollowLatest(...args);
  const saveHistoryLimit = (...args) => actions.saveHistoryLimit(...args);
  const saveMetadataPosition = (...args) => actions.saveMetadataPosition(...args);
  const saveExcludePreviewMedia = (...args) => actions.saveExcludePreviewMedia(...args);
  const saveShowFavoriteButton = (...args) => actions.saveShowFavoriteButton(...args);
  const saveFeedStyle = (...args) => actions.saveFeedStyle(...args);
  const saveMediaScope = (...args) => actions.saveMediaScope(...args);
  const saveBatchDividers = (...args) => actions.saveBatchDividers(...args);
  const saveLoopVideos = (...args) => actions.saveLoopVideos(...args);
  const saveLoopAudio = (...args) => actions.saveLoopAudio(...args);
  const updateViewerPromptPanel = (...args) => actions.updateViewerPromptPanel(...args);
  const syncViewerScaleMedia = (...args) => actions.syncViewerScaleMedia(...args);
  const syncViewerMetadataPosition = (...args) => actions.syncViewerMetadataPosition(...args);
  const syncViewerMetadataToggle = (...args) => actions.syncViewerMetadataToggle(...args);
  const closeViewer = (...args) => actions.closeViewer(...args);
  const syncViewerItems = (...args) => actions.syncViewerItems(...args);
  const trimItemsToHistoryLimit = (...args) => actions.trimItemsToHistoryLimit(...args);
  const saveSessionItems = (...args) => actions.saveSessionItems(...args);
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

  function setHistoryLimit(nextValue) {
    const previousLimit = state.historyLimit;
    applyHistoryLimit(nextValue);
    if (state.historyLimit === previousLimit) return;

    saveHistoryLimit();
    const removedCount = trimItemsToHistoryLimit();
    saveSessionItems();
    if (removedCount > 0) updateViews(false);
    syncViewerItems();
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
  
    if (state.mediaScope === "current-tab") saveWorkflowScrollPositions(runtime.activeWorkflowTabId);
    applyMediaScope(mediaScope);
    saveMediaScope();
    if (state.mediaScope === "current-tab") {
      updateViewsForWorkflowTab(runtime.activeWorkflowTabId);
    } else {
      updateViews(false);
    }
  
    if (isViewerOpen() && runtime.viewer?.item && !filteredItems().some((item) => item.key === runtime.viewer.item.key)) {
      closeViewer();
    } else {
      syncViewerItems();
    }
  }

  function setBatchDividers(nextStyle) {
    applyBatchDividers(nextStyle);
    saveBatchDividers();
    updateViews(false);
  }

  function syncMediaLoopSettings(kind) {
    const selector = kind === "video" ? "video" : "audio";
    const shouldLoop = kind === "video" ? state.loopVideos : state.loopAudio;
    for (const view of state.views) {
      for (const media of view.root.querySelectorAll(selector)) media.loop = shouldLoop;
      for (const card of view.cardCache?.values?.() || []) {
        for (const media of card.querySelectorAll(selector)) media.loop = shouldLoop;
      }
    }

    const viewerMedia = runtime.viewer?.media?.querySelector(selector);
    if (viewerMedia) viewerMedia.loop = shouldLoop;
    const pendingMedia = runtime.viewer?.pendingMedia;
    if (String(pendingMedia?.tagName || "").toLowerCase() === selector) pendingMedia.loop = shouldLoop;
  }

  function setLoopVideos(nextValue) {
    applyLoopVideos(nextValue);
    saveLoopVideos();
    syncMediaLoopSettings("video");
  }

  function setLoopAudio(nextValue) {
    applyLoopAudio(nextValue);
    saveLoopAudio();
    syncMediaLoopSettings("audio");
  }
  
  function setPlacement(nextPlacement) {
    applyPlacement(nextPlacement);
    savePlacement();
    if (runtime.setupComplete) syncFloatingPanel();
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
  
  Object.assign(actions, {
    setThumbnailHeight,
    syncComfySettingValue,
    setShowPrompts,
    setScaleViewerMedia,
    setFollowLatest,
    setHistoryLimit,
    setMetadataPosition,
    setExcludePreviewMedia,
    setShowFavoriteButton,
    setFeedStyle,
    setMediaScope,
    setBatchDividers,
    syncMediaLoopSettings,
    setLoopVideos,
    setLoopAudio,
    setPlacement,
    ensureStyles,
  });
}
