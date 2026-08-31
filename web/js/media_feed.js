import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ICONS } from "./icons.js";
import { clearPromptMetadataCache, getCachedPromptMetadata, loadPromptMetadata } from "./metadata.js";
import { installAudioWaveforms } from "./media_feed/audio_waveform.js";
import { installCards } from "./media_feed/cards.js";
import { createMediaFeedExtension } from "./media_feed/extension.js";
import { installFavorites } from "./media_feed/favorites.js";
import { installFeedView } from "./media_feed/feed_view.js";
import { installFloatingPanel } from "./media_feed/floating_panel.js";
import { installLayout } from "./media_feed/layout.js";
import { installMediaItems } from "./media_feed/media_items.js";
import { createMediaFeedRuntime } from "./media_feed/runtime.js";
import { installSettings } from "./media_feed/settings.js";
import { installSettingsStorage } from "./media_feed/settings_storage.js";
import { createMediaFeedState } from "./media_feed/state.js";
import { installViewerMetadata } from "./media_feed/viewer_metadata.js";
import { installViewerRender } from "./media_feed/viewer_render.js";
import { installViewerShell } from "./media_feed/viewer_shell.js";
import { installViewerSupport } from "./media_feed/viewer_support.js";
import { installViewerZoom } from "./media_feed/viewer_zoom.js";
import { installWorkflowTracking } from "./media_feed/workflow_tracking.js";
import { ensureMediaFeedStyles } from "./styles.js";

const context = {
  app,
  api,
  ICONS,
  state: createMediaFeedState(),
  runtime: createMediaFeedRuntime(),
  services: {
    clearPromptMetadataCache,
    getCachedPromptMetadata,
    loadPromptMetadata,
    ensureMediaFeedStyles,
  },
  actions: {},
};

installMediaItems(context);
installLayout(context);
installAudioWaveforms(context);
installSettingsStorage(context);
installSettings(context);
installViewerSupport(context);
installViewerShell(context);
installViewerZoom(context);
installViewerRender(context);
installViewerMetadata(context);
installFavorites(context);
installCards(context);
installFeedView(context);
installFloatingPanel(context);
installWorkflowTracking(context);

app.registerExtension(createMediaFeedExtension(context));
