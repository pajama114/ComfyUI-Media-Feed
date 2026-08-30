import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { installCards } from "../web/js/media_feed/cards.js";
import { createMediaFeedExtension } from "../web/js/media_feed/extension.js";
import { installFavorites } from "../web/js/media_feed/favorites.js";
import { installFeedView } from "../web/js/media_feed/feed_view.js";
import { installFloatingPanel } from "../web/js/media_feed/floating_panel.js";
import { installLayout } from "../web/js/media_feed/layout.js";
import { installMediaItems } from "../web/js/media_feed/media_items.js";
import { createMediaFeedRuntime } from "../web/js/media_feed/runtime.js";
import { installSettings } from "../web/js/media_feed/settings.js";
import { installSettingsStorage } from "../web/js/media_feed/settings_storage.js";
import { createMediaFeedState } from "../web/js/media_feed/state.js";
import { installViewerMetadata } from "../web/js/media_feed/viewer_metadata.js";
import { installViewerRender } from "../web/js/media_feed/viewer_render.js";
import { installViewerShell } from "../web/js/media_feed/viewer_shell.js";
import { installViewerSupport } from "../web/js/media_feed/viewer_support.js";
import { installViewerZoom } from "../web/js/media_feed/viewer_zoom.js";
import { installWorkflowTracking } from "../web/js/media_feed/workflow_tracking.js";

const installers = [
  installMediaItems,
  installLayout,
  installSettingsStorage,
  installSettings,
  installViewerSupport,
  installViewerShell,
  installViewerZoom,
  installViewerRender,
  installViewerMetadata,
  installFavorites,
  installCards,
  installFeedView,
  installFloatingPanel,
  installWorkflowTracking,
];

function createContext() {
  const listeners = new Map();
  const app = {
    extensionManager: { workflow: { activeWorkflow: {} } },
    ui: { settings: { setSettingValue() {} } },
  };
  const api = {
    apiURL: (path) => path,
    addEventListener: (name, listener) => listeners.set(name, listener),
    async queuePrompt() { return { prompt_id: "prompt-1" }; },
  };
  const context = {
    app,
    api,
    ICONS: new Proxy({}, { get: () => "<svg></svg>" }),
    state: createMediaFeedState(),
    runtime: createMediaFeedRuntime(),
    services: {
      clearPromptMetadataCache() {},
      getCachedPromptMetadata() { return null; },
      async loadPromptMetadata() { return {}; },
      ensureMediaFeedStyles() {},
    },
    actions: {},
  };
  for (const install of installers) install(context);
  return { context, listeners };
}

test("every action dependency resolves after controller composition", () => {
  const { context } = createContext();
  const moduleDirectory = new URL("../web/js/media_feed/", import.meta.url);
  const moduleFiles = fs.readdirSync(moduleDirectory)
    .filter((filename) => filename.endsWith(".js") && !["constants.js", "runtime.js", "state.js"].includes(filename));

  const referencedActions = new Set();
  for (const filename of moduleFiles) {
    const source = fs.readFileSync(new URL(filename, moduleDirectory), "utf8");
    for (const match of source.matchAll(/\bactions\.([A-Za-z_$][\w$]*)/g)) {
      referencedActions.add(match[1]);
    }
  }

  const missing = [...referencedActions].filter((name) => typeof context.actions[name] !== "function");
  assert.deepEqual(missing, []);
  assert.ok(Object.keys(context.actions).length > 150);
});

test("viewer metadata panel icons follow the configured side", () => {
  const context = {
    app: {},
    api: {},
    ICONS: {
      panelLeftClose: "left-close",
      panelLeftOpen: "left-open",
      panelRightClose: "right-close",
      panelRightOpen: "right-open",
    },
    state: { metadataPosition: "right" },
    runtime: {
      viewer: {
        body: { dataset: {} },
        hideMetadataButton: { innerHTML: "" },
        showMetadataButton: { innerHTML: "" },
      },
    },
    actions: {},
  };
  installViewerShell(context);

  context.actions.syncViewerMetadataPosition();
  assert.equal(context.runtime.viewer.body.dataset.metadataPosition, "right");
  assert.equal(context.runtime.viewer.hideMetadataButton.innerHTML, "right-close");
  assert.equal(context.runtime.viewer.showMetadataButton.innerHTML, "right-open");

  context.state.metadataPosition = "left";
  context.actions.syncViewerMetadataPosition();
  assert.equal(context.runtime.viewer.body.dataset.metadataPosition, "left");
  assert.equal(context.runtime.viewer.hideMetadataButton.innerHTML, "left-close");
  assert.equal(context.runtime.viewer.showMetadataButton.innerHTML, "left-open");
});

test("space toggles viewer media without leaking to the canvas", () => {
  let playCalls = 0;
  let pauseCalls = 0;
  let prevented = 0;
  let stopped = 0;
  const media = {
    paused: true,
    play() {
      playCalls++;
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      pauseCalls++;
      this.paused = true;
    },
  };
  const context = {
    app: {},
    api: {},
    ICONS: {},
    state: {},
    runtime: {
      viewer: {
        root: { dataset: { open: "true" } },
        media: { querySelector: () => media },
      },
    },
    actions: { isViewerOpen: () => true },
  };
  installViewerShell(context);
  const event = {
    key: " ",
    code: "Space",
    target: { closest: () => null },
    preventDefault() { prevented++; },
    stopImmediatePropagation() { stopped++; },
  };

  context.actions.handleViewerGlobalKeydown(event);
  assert.equal(playCalls, 1);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);

  context.actions.handleViewerGlobalKeydown(event);
  assert.equal(pauseCalls, 1);

  context.actions.handleViewerGlobalKeydown({
    ...event,
    target: { closest: () => ({}) },
  });
  assert.equal(playCalls, 1);
  assert.equal(pauseCalls, 1);
});

test("the composed extension registers settings and setup integrations once", async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    setTimeout() { return 1; },
  };

  try {
    const { context, listeners } = createContext();
    const extension = createMediaFeedExtension(context);
    assert.equal(extension.name, "comfyui.media_feed");
    assert.equal(extension.settings.length, 13);
    assert.equal(new Set(extension.settings.map((setting) => setting.id)).size, 13);
    assert.equal(new Set(extension.settings.map((setting) => setting.sortOrder)).size, 13);

    const settingsByGroup = new Map();
    for (const setting of extension.settings) {
      const group = setting.category[1];
      settingsByGroup.set(group, [...(settingsByGroup.get(group) ?? []), setting]);
    }
    const displayedSettings = [...settingsByGroup]
      .sort(([groupA, settingsA], [groupB, settingsB]) => {
        const groupOrderA = Math.max(...settingsA.map((setting) => setting.sortOrder ?? 0));
        const groupOrderB = Math.max(...settingsB.map((setting) => setting.sortOrder ?? 0));
        return groupOrderB - groupOrderA || groupA.localeCompare(groupB);
      })
      .map(([group, settings]) => [
        group,
        [...settings]
          .sort((a, b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0))
          .map((setting) => setting.name),
      ]);
    assert.deepEqual(displayedSettings, [
      ["Panel", ["Placement", "Follow latest media"]],
      ["Feed", ["Feed style", "Media from", "Exclude Preview node media", "Batch dividers"]],
      ["Viewer", ["Show metadata in viewer", "Metadata position", "Fit media to viewer", "Loop videos", "Loop audio"]],
      ["Favorites", ["Show favorite button on hover", "Favorite storage folder"]],
    ]);

    const batchDividerSetting = extension.settings.find((setting) => setting.id === "comfyui-media-feed.batch-dividers");
    assert.equal(batchDividerSetting.defaultValue, "line");
    assert.deepEqual(batchDividerSetting.options.map((option) => option.value), ["none", "line"]);

    const originalQueuePrompt = context.api.queuePrompt;
    await extension.setup();
    assert.equal(context.runtime.setupComplete, true);
    assert.deepEqual([...listeners.keys()].sort(), ["executed", "promptQueued", "promptQueueing"]);
    assert.notEqual(context.api.queuePrompt, originalQueuePrompt);
    assert.equal(context.api.queuePrompt.__mediaFeedWrapped, true);
  } finally {
    globalThis.window = originalWindow;
  }
});
