import {
  EXTENSION_NAME,
} from "./constants.js";

export function createMediaFeedExtension(context) {
  const { api, runtime, actions } = context;
  const loadSavedPlacement = (...args) => actions.loadSavedPlacement(...args);
  const loadSavedShowPrompts = (...args) => actions.loadSavedShowPrompts(...args);
  const loadSavedScaleViewerMedia = (...args) => actions.loadSavedScaleViewerMedia(...args);
  const loadSavedFollowLatest = (...args) => actions.loadSavedFollowLatest(...args);
  const loadSavedMetadataPosition = (...args) => actions.loadSavedMetadataPosition(...args);
  const loadSavedExcludePreviewMedia = (...args) => actions.loadSavedExcludePreviewMedia(...args);
  const loadSavedShowFavoriteButton = (...args) => actions.loadSavedShowFavoriteButton(...args);
  const loadSavedFeedStyle = (...args) => actions.loadSavedFeedStyle(...args);
  const loadSavedMediaScope = (...args) => actions.loadSavedMediaScope(...args);
  const loadSavedBatchDividers = (...args) => actions.loadSavedBatchDividers(...args);
  const loadSavedLoopVideos = (...args) => actions.loadSavedLoopVideos(...args);
  const loadSavedLoopAudio = (...args) => actions.loadSavedLoopAudio(...args);
  const loadSettings = (...args) => actions.loadSettings(...args);
  const loadSessionItems = (...args) => actions.loadSessionItems(...args);
  const setShowPrompts = (...args) => actions.setShowPrompts(...args);
  const setScaleViewerMedia = (...args) => actions.setScaleViewerMedia(...args);
  const setFollowLatest = (...args) => actions.setFollowLatest(...args);
  const setMetadataPosition = (...args) => actions.setMetadataPosition(...args);
  const setExcludePreviewMedia = (...args) => actions.setExcludePreviewMedia(...args);
  const setShowFavoriteButton = (...args) => actions.setShowFavoriteButton(...args);
  const setFeedStyle = (...args) => actions.setFeedStyle(...args);
  const setMediaScope = (...args) => actions.setMediaScope(...args);
  const setBatchDividers = (...args) => actions.setBatchDividers(...args);
  const setLoopVideos = (...args) => actions.setLoopVideos(...args);
  const setLoopAudio = (...args) => actions.setLoopAudio(...args);
  const setPlacement = (...args) => actions.setPlacement(...args);
  const ensureStyles = (...args) => actions.ensureStyles(...args);
  const syncFloatingPanel = (...args) => actions.syncFloatingPanel(...args);
  const handlePromptQueueing = (...args) => actions.handlePromptQueueing(...args);
  const handlePromptQueued = (...args) => actions.handlePromptQueued(...args);
  const wrapQueuePrompt = (...args) => actions.wrapQueuePrompt(...args);
  const watchActiveWorkflow = (...args) => actions.watchActiveWorkflow(...args);
  const handleExecuted = (...args) => actions.handleExecuted(...args);

  return {
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
        sortOrder: 420,
        tooltip: "Choose where the floating Media Feed panel appears.",
        onChange: (newValue) => {
          runtime.placementSettingSeen = true;
          setPlacement(newValue);
        },
      },
      {
        id: "comfyui-media-feed.follow-latest",
        name: "Follow latest media",
        type: "boolean",
        defaultValue: loadSavedFollowLatest(),
        category: ["Media Feed", "Panel", "Follow latest media"],
        sortOrder: 410,
        tooltip: "Automatically scroll the feed to newly generated media.",
        onChange: (newValue) => {
          runtime.followLatestSettingSeen = true;
          setFollowLatest(newValue);
        },
      },
      {
        id: "comfyui-media-feed.exclude-preview-media",
        name: "Exclude Preview node media",
        type: "boolean",
        defaultValue: loadSavedExcludePreviewMedia(),
        category: ["Media Feed", "Feed", "Exclude Preview node media"],
        sortOrder: 320,
        tooltip: "Do not add media emitted by Preview nodes, such as Preview Image, to the feed.",
        onChange: (newValue) => {
          runtime.excludePreviewMediaSettingSeen = true;
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
        sortOrder: 340,
        tooltip: "Choose the standard feed or a frameless feed that keeps the on-panel size control while hiding other panel chrome.",
        onChange: (newValue) => {
          runtime.feedStyleSettingSeen = true;
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
        sortOrder: 330,
        tooltip: "Show media from every workflow tab or only media queued from the currently active workflow tab.",
        onChange: (newValue) => {
          runtime.mediaScopeSettingSeen = true;
          setMediaScope(newValue);
        },
      },
      {
        id: "comfyui-media-feed.batch-dividers",
        name: "Batch dividers",
        type: "combo",
        defaultValue: loadSavedBatchDividers(),
        options: [
          { text: "Off", value: "none" },
          { text: "Line", value: "line" },
        ],
        category: ["Media Feed", "Feed", "Batch dividers"],
        sortOrder: 310,
        tooltip: "Show a visual separator when adjacent media came from different queued generations.",
        onChange: (newValue) => {
          runtime.batchDividersSettingSeen = true;
          setBatchDividers(newValue);
        },
      },
      {
        id: "comfyui-media-feed.show-prompts",
        name: "Show metadata in viewer",
        type: "boolean",
        defaultValue: loadSavedShowPrompts(),
        category: ["Media Feed", "Viewer", "Show metadata in viewer"],
        sortOrder: 230,
        tooltip: "Read embedded PNG, GIF, MP4, WebM, M4A, MP3, FLAC, OGG, or Opus metadata and show inferred prompt and seed metadata when viewing media.",
        onChange: (newValue) => {
          runtime.promptSettingSeen = true;
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
        sortOrder: 220,
        tooltip: "Choose which side of the viewer shows prompt and metadata details.",
        onChange: (newValue) => {
          runtime.metadataPositionSettingSeen = true;
          setMetadataPosition(newValue);
        },
      },
      {
        id: "comfyui-media-feed.scale-viewer-media",
        name: "Fit media to viewer",
        type: "boolean",
        defaultValue: loadSavedScaleViewerMedia(),
        category: ["Media Feed", "Viewer", "Fit media to viewer"],
        sortOrder: 210,
        tooltip: "Fit images, videos, and audio players to the available viewer area.",
        onChange: (newValue) => {
          runtime.scaleViewerMediaSettingSeen = true;
          setScaleViewerMedia(newValue);
        },
      },
      {
        id: "comfyui-media-feed.loop-videos",
        name: "Loop videos",
        type: "boolean",
        defaultValue: loadSavedLoopVideos(),
        category: ["Media Feed", "Viewer", "Playback"],
        sortOrder: 205,
        tooltip: "Loop video playback in feed previews and the viewer.",
        onChange: (newValue) => {
          runtime.loopVideosSettingSeen = true;
          setLoopVideos(newValue);
        },
      },
      {
        id: "comfyui-media-feed.loop-audio",
        name: "Loop audio",
        type: "boolean",
        defaultValue: loadSavedLoopAudio(),
        category: ["Media Feed", "Viewer", "Playback"],
        sortOrder: 200,
        tooltip: "Loop audio playback in feed cards and the viewer.",
        onChange: (newValue) => {
          runtime.loopAudioSettingSeen = true;
          setLoopAudio(newValue);
        },
      },
      {
        id: "comfyui-media-feed.show-favorite-button",
        name: "Show favorite button on hover",
        type: "boolean",
        defaultValue: loadSavedShowFavoriteButton(),
        category: ["Media Feed", "Favorites", "Show favorite button on hover"],
        sortOrder: 120,
        tooltip: "Show the favorite star in the upper-right corner of a feed card when you hover over it.",
        onChange: (newValue) => {
          runtime.showFavoriteButtonSettingSeen = true;
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
        sortOrder: 110,
        tooltip: "Favorites are always stored in the output/favorites folder and this location cannot be changed.",
      },
    ],
    async setup() {
      console.info("[ComfyUI Media Feed] extension loaded");
      loadSettings();
      loadSessionItems();
      ensureStyles();
      watchActiveWorkflow();
      api.addEventListener("promptQueueing", handlePromptQueueing);
      api.addEventListener("promptQueued", handlePromptQueued);
      api.addEventListener("executed", handleExecuted);
      wrapQueuePrompt();
      runtime.setupComplete = true;
      window.setTimeout(syncFloatingPanel, 1000);
    },
  };
}
