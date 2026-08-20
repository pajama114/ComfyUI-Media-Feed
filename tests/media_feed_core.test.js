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

test("settings normalization and feed geometry remain bounded", () => {
  const { actions, state } = createContext();
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
