import {
  DEFAULT_ITEM_HEIGHT,
  MIN_ITEM_HEIGHT,
  MAX_ITEM_HEIGHT,
  ITEM_GAP,
  SCROLLBAR_SPACE,
  RAIL_PADDING,
  CARD_TOP_OFFSET,
  DEFAULT_CARD_TOP_OFFSET,
  FALLBACK_PANEL_EXTRA_HEIGHT,
  DEFAULT_PLACEMENT,
  DEFAULT_METADATA_POSITION,
  DEFAULT_FEED_STYLE,
  DEFAULT_MEDIA_SCOPE,
  DEFAULT_BATCH_DIVIDERS,
  DEFAULT_LOOP_AUDIO,
  DEFAULT_LOOP_VIDEOS,
  DEFAULT_HISTORY_LIMIT,
  HISTORY_LIMIT_OPTIONS,
  DEFAULT_VIEWER_FIT_SCALE,
  VIEWER_FIT_SCALE_MIN,
  VIEWER_FIT_SCALE_MAX,
  VIEWER_FIT_SCALE_STEP,
  SIDE_PLACEMENTS,
  PLACEMENTS,
  METADATA_POSITIONS,
  FEED_STYLES,
  MEDIA_SCOPES,
  BATCH_DIVIDER_STYLES,
} from "./constants.js";

export function installLayout(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

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

  function normalizeBatchDividers(nextStyle) {
    const style = String(nextStyle || "").toLowerCase();
    return BATCH_DIVIDER_STYLES.has(style) ? style : DEFAULT_BATCH_DIVIDERS;
  }
  
  function normalizeBooleanSetting(nextValue) {
    return nextValue === true || nextValue === "true" || nextValue === "True" || nextValue === "1";
  }

  function normalizeHistoryLimit(nextValue) {
    const limit = Number(nextValue);
    return HISTORY_LIMIT_OPTIONS.includes(limit) ? limit : DEFAULT_HISTORY_LIMIT;
  }

  function normalizeViewerFitScale(nextValue) {
    const scale = Number(nextValue);
    if (!Number.isFinite(scale)) return DEFAULT_VIEWER_FIT_SCALE;
    const boundedScale = Math.min(VIEWER_FIT_SCALE_MAX, Math.max(VIEWER_FIT_SCALE_MIN, scale));
    return Math.round(boundedScale / VIEWER_FIT_SCALE_STEP) * VIEWER_FIT_SCALE_STEP;
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

  function applyShowComfyProgress(nextValue) {
    state.showComfyProgress = normalizeBooleanSetting(nextValue);
  }
  
  function applyScaleViewerMedia(nextValue) {
    state.scaleViewerMedia = normalizeBooleanSetting(nextValue);
  }

  function applyViewerFitScale(nextValue) {
    state.viewerFitScale = normalizeViewerFitScale(nextValue);
  }
  
  function applyFollowLatest(nextValue) {
    state.followLatest = normalizeBooleanSetting(nextValue);
  }

  function applyHistoryLimit(nextValue) {
    state.historyLimit = normalizeHistoryLimit(nextValue);
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

  function applyBatchDividers(nextStyle) {
    state.batchDividers = normalizeBatchDividers(nextStyle);
  }

  function applyLoopVideos(nextValue) {
    state.loopVideos = nextValue === null || nextValue === undefined
      ? DEFAULT_LOOP_VIDEOS
      : normalizeBooleanSetting(nextValue);
  }

  function applyLoopAudio(nextValue) {
    state.loopAudio = nextValue === null || nextValue === undefined
      ? DEFAULT_LOOP_AUDIO
      : normalizeBooleanSetting(nextValue);
  }
  
  Object.assign(actions, {
    viewPitch,
    feedRailPadding,
    feedCardTopOffset,
    viewportHeight,
    railHeight,
    fallbackPanelHeight,
    horizontalContentWidth,
    normalizeThumbnailHeight,
    normalizePlacement,
    normalizeMetadataPosition,
    normalizeFeedStyle,
    normalizeMediaScope,
    normalizeBatchDividers,
    normalizeBooleanSetting,
    normalizeHistoryLimit,
    normalizeViewerFitScale,
    isVerticalPlacement,
    isVerticalView,
    applyThumbnailHeight,
    applyPlacement,
    applyShowPrompts,
    applyShowComfyProgress,
    applyScaleViewerMedia,
    applyViewerFitScale,
    applyFollowLatest,
    applyHistoryLimit,
    applyMetadataPosition,
    applyExcludePreviewMedia,
    applyShowFavoriteButton,
    applyFeedStyle,
    applyMediaScope,
    applyBatchDividers,
    applyLoopVideos,
    applyLoopAudio,
  });
}
