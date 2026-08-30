import assert from "node:assert/strict";
import test from "node:test";

import { installLayout } from "../web/js/media_feed/layout.js";
import { installMediaItems } from "../web/js/media_feed/media_items.js";
import { installFeedView } from "../web/js/media_feed/feed_view.js";
import { createMediaFeedRuntime } from "../web/js/media_feed/runtime.js";
import { installSettings } from "../web/js/media_feed/settings.js";
import { installSettingsStorage } from "../web/js/media_feed/settings_storage.js";
import { createMediaFeedState } from "../web/js/media_feed/state.js";
import { visibleItemRange } from "../web/js/media_feed/virtualization.js";

function createContext() {
  const context = {
    app: { extensionManager: { workflow: { activeWorkflow: null } } },
    api: { apiURL: (path) => `/api${path}` },
    ICONS: {},
    state: createMediaFeedState(),
    runtime: createMediaFeedRuntime(),
    services: { ensureMediaFeedStyles() {} },
    actions: {},
  };
  installMediaItems(context);
  installLayout(context);
  installSettingsStorage(context);
  installSettings(context);
  installFeedView(context);
  return context;
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test("media type and duration helpers preserve current behavior", () => {
  const { actions } = createContext();
  assert.equal(actions.getMediaKind("result.PNG?preview=1"), "image");
  assert.equal(actions.getMediaKind("clip.webm"), "video");
  assert.equal(actions.getMediaKind("track.FLAC"), "audio");
  assert.equal(actions.getMediaKind("unknown.bin", "preview_images"), "image");
  assert.equal(actions.getMediaKind("unknown.bin", "files"), null);
  assert.equal(actions.formatMediaDuration(65.9), "1:05");
  assert.equal(actions.formatMediaDuration(3661), "1:01:01");
  assert.equal(actions.formatMediaDuration(-1), "");
});

test("collectMedia walks nested outputs, deduplicates files, and reuses the view URL", () => {
  const { actions } = createContext();
  const file = { filename: "image one.png", subfolder: "nested/folder", type: "output" };
  const items = actions.collectMedia({ images: [file, { ...file }], audio: [{ filename: "sound.mp3" }] }, 42, 7, "tab-a");

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.kind), ["image", "audio"]);
  assert.equal(items[0].promptId, "42");
  assert.equal(items[0].nodeId, 7);
  assert.equal(items[0].workflowTabId, "tab-a");
  assert.equal(items[0].url, "/api/view?filename=image+one.png&subfolder=nested%2Ffolder&type=output");
  assert.doesNotMatch(items[0].url, /[?&](?:v|t|cache)=/i);
});

test("addItems replaces duplicates and keeps the feed bounded at 256 items", () => {
  const context = createContext();
  const { actions, state } = context;
  const discarded = [];
  let viewerSyncs = 0;
  actions.discardCachedCard = (_view, id) => discarded.push(id);
  actions.updateViews = () => {};
  actions.prefetchPromptMetadata = () => {};
  actions.syncViewerItems = () => { viewerSyncs++; };
  state.views.add({});

  const items = Array.from({ length: 257 }, (_, index) => ({
    id: `id-${index}`,
    key: `image:output::file-${index}.png`,
    kind: "image",
  }));
  actions.addItems(items);
  assert.equal(state.items.length, 256);
  assert.equal(state.itemKeys.size, 256);
  assert.equal(state.itemKeys.has(items[0].key), false);

  const replacement = { ...items[100], id: "replacement" };
  actions.addItems([replacement]);
  assert.equal(state.items.length, 256);
  assert.equal(state.items[0], replacement);
  assert.equal(state.items.filter((item) => item.key === replacement.key).length, 1);
  assert.ok(discarded.includes(items[100].id));
  assert.equal(viewerSyncs, 2);
});

test("the latest feed items survive a reload in the same browser tab", () => {
  const originalWindow = globalThis.window;
  const sessionStorage = createMemoryStorage();
  globalThis.window = { sessionStorage };

  try {
    const firstContext = createContext();
    const firstWorkflow = { activeState: { id: "workflow-a" } };
    firstContext.app.extensionManager.workflow.activeWorkflow = firstWorkflow;
    firstContext.actions.syncViewerItems = () => {};
    const [item] = firstContext.actions.collectMedia(
      { images: [{ filename: "restored image.png", subfolder: "session" }] },
      "prompt-1",
      7,
      firstContext.actions.currentWorkflowTabId(),
    );
    firstContext.actions.addItems([item]);

    const secondContext = createContext();
    secondContext.app.extensionManager.workflow.activeWorkflow = { activeState: { id: "workflow-a" } };
    secondContext.actions.loadSessionItems();

    assert.equal(secondContext.state.items.length, 1);
    assert.equal(secondContext.state.itemKeys.size, 1);
    assert.equal(secondContext.state.items[0].filename, "restored image.png");
    assert.equal(secondContext.state.items[0].url, "/api/view?filename=restored+image.png&subfolder=session&type=output");
    secondContext.state.mediaScope = "current-tab";
    assert.equal(secondContext.actions.filteredItems().length, 1);

    secondContext.actions.clearSessionItems();
    const thirdContext = createContext();
    thirdContext.actions.loadSessionItems();
    assert.equal(thirdContext.state.items.length, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("session restore rejects malformed, duplicate, and unsupported records", () => {
  const originalWindow = globalThis.window;
  const sessionStorage = createMemoryStorage();
  globalThis.window = { sessionStorage };

  try {
    sessionStorage.setItem("comfyui-media-feed:session-items", JSON.stringify({
      version: 1,
      items: [
        { kind: "image", filename: "valid.png", subfolder: "", type: "output" },
        { kind: "image", filename: "valid.png", subfolder: "", type: "output" },
        { kind: "document", filename: "invalid.pdf", subfolder: "", type: "output" },
        { kind: "video", filename: "" },
      ],
    }));
    const context = createContext();
    context.actions.loadSessionItems();
    assert.deepEqual(context.state.items.map((item) => item.filename), ["valid.png"]);

    sessionStorage.setItem("comfyui-media-feed:session-items", "not-json");
    context.actions.loadSessionItems();
    assert.equal(sessionStorage.getItem("comfyui-media-feed:session-items"), null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("missing restored media is pruned only after a definitive response", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const context = createContext();
    const { actions, state } = context;
    actions.syncViewerItems = () => {};
    actions.addItems([{
      id: "missing-id",
      key: "image:output::missing.png",
      kind: "image",
      filename: "missing.png",
      subfolder: "",
      type: "output",
      url: "/api/view?filename=missing.png&type=output",
    }]);

    globalThis.fetch = async () => ({ status: 503 });
    await actions.removeMissingMediaItem(state.items[0]);
    assert.equal(state.items.length, 1);

    globalThis.fetch = async (_url, options) => {
      assert.equal(options.method, "HEAD");
      return { status: 404 };
    };
    await actions.removeMissingMediaItem(state.items[0]);
    assert.equal(state.items.length, 0);
    assert.equal(state.itemKeys.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("workflow tab filtering tracks object identity", () => {
  const context = createContext();
  const { actions, app, state } = context;
  const firstWorkflow = {};
  const secondWorkflow = {};
  app.extensionManager.workflow.activeWorkflow = firstWorkflow;
  const firstId = actions.currentWorkflowTabId();
  assert.equal(actions.currentWorkflowTabId(), firstId);

  app.extensionManager.workflow.activeWorkflow = secondWorkflow;
  const secondId = actions.currentWorkflowTabId();
  assert.notEqual(secondId, firstId);

  state.mediaScope = "current-tab";
  state.items = [
    { id: "first", kind: "image", workflowTabId: firstId },
    { id: "second", kind: "video", workflowTabId: secondId },
  ];
  assert.deepEqual(actions.filteredItems().map((item) => item.id), ["second"]);
  state.filter = "image";
  assert.deepEqual(actions.filteredItems(), []);
});

test("workflow tab filtering uses persisted workflow ids when available", () => {
  const context = createContext();
  const { actions, app } = context;
  app.extensionManager.workflow.activeWorkflow = { activeState: { id: "saved-workflow" } };
  const firstId = actions.currentWorkflowTabId();
  app.extensionManager.workflow.activeWorkflow = { activeState: { id: "saved-workflow" } };
  assert.equal(actions.currentWorkflowTabId(), firstId);
  assert.equal(firstId, "workflow-id:saved-workflow");
});

test("loop settings persist and update mounted feed and viewer players", () => {
  const originalWindow = globalThis.window;
  const localStorage = createMemoryStorage();
  globalThis.window = { localStorage };

  try {
    const context = createContext();
    const feedVideo = { loop: true };
    const feedAudio = { loop: false };
    const viewerVideo = { loop: true };
    const pendingAudio = { tagName: "AUDIO", loop: false };
    const cachedVideo = { loop: true };
    const cachedAudio = { loop: false };
    context.state.views.add({
      root: {
        querySelectorAll(selector) {
          return selector === "video" ? [feedVideo] : [feedAudio];
        },
      },
      cardCache: new Map([["cached", {
        querySelectorAll(selector) {
          return selector === "video" ? [cachedVideo] : [cachedAudio];
        },
      }]]),
    });
    context.runtime.viewer = {
      media: {
        querySelector(selector) {
          return selector === "video" ? viewerVideo : null;
        },
      },
      pendingMedia: pendingAudio,
    };

    context.actions.setLoopVideos(false);
    context.actions.setLoopAudio(true);

    assert.equal(feedVideo.loop, false);
    assert.equal(viewerVideo.loop, false);
    assert.equal(cachedVideo.loop, false);
    assert.equal(feedAudio.loop, true);
    assert.equal(cachedAudio.loop, true);
    assert.equal(pendingAudio.loop, true);
    assert.equal(localStorage.getItem("comfyui-media-feed:loop-videos"), "false");
    assert.equal(localStorage.getItem("comfyui-media-feed:loop-audio"), "true");

    const restoredContext = createContext();
    restoredContext.actions.loadSettings();
    assert.equal(restoredContext.state.loopVideos, false);
    assert.equal(restoredContext.state.loopAudio, true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("settings normalization and feed geometry remain bounded", () => {
  const { actions, state } = createContext();
  assert.equal(state.loopVideos, true);
  assert.equal(state.loopAudio, false);
  assert.equal(actions.normalizeThumbnailHeight(1), 96);
  assert.equal(actions.normalizeThumbnailHeight(999), 220);
  assert.equal(actions.normalizePlacement("LEFT"), "left");
  assert.equal(actions.normalizePlacement("diagonal"), "bottom");
  assert.equal(actions.normalizeBooleanSetting("True"), true);
  assert.equal(actions.normalizeBooleanSetting("false"), false);
  assert.equal(actions.normalizeBatchDividers("LINE"), "line");
  assert.equal(actions.normalizeBatchDividers("invalid"), "line");
  assert.equal(actions.normalizeBatchDividers("labeled"), "line");

  assert.equal(actions.isBatchBoundary(
    { promptId: "prompt-2" },
    { promptId: "prompt-1" },
  ), true);
  assert.equal(actions.isBatchBoundary(
    { promptId: "prompt-1" },
    { promptId: "prompt-1" },
  ), false);
  assert.equal(actions.isBatchBoundary(
    { promptId: "" },
    { promptId: "prompt-1" },
  ), false);

  actions.applyThumbnailHeight(180);
  assert.equal(state.itemHeight, 180);
  assert.equal(state.itemWidth, 180);
  assert.equal(actions.horizontalContentWidth(3), 564);

  state.placement = "bottom";
  state.feedStyle = "default";
  assert.equal(actions.feedCardTopOffset(), 2);
  state.feedStyle = "frameless";
  assert.equal(actions.feedCardTopOffset(), 10);
  state.placement = "top";
  assert.equal(actions.feedCardTopOffset(), 2);
});

test("virtualization bounds include overscan without escaping the item list", () => {
  assert.deepEqual(visibleItemRange({
    itemCount: 100,
    viewportSize: 300,
    scrollOffset: 0,
    pitch: 151,
    railPadding: 4,
  }), { start: 0, end: 7 });

  assert.deepEqual(visibleItemRange({
    itemCount: 100,
    viewportSize: 300,
    scrollOffset: 7550,
    pitch: 151,
    railPadding: 4,
  }), { start: 44, end: 57 });

  assert.deepEqual(visibleItemRange({
    itemCount: 3,
    viewportSize: 1000,
    scrollOffset: 0,
    pitch: 151,
    railPadding: 4,
  }), { start: 0, end: 3 });
});
