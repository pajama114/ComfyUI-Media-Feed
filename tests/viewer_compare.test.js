import assert from "node:assert/strict";
import test from "node:test";
import {
  captureComparisonView,
  applyComparisonView,
  comparisonMetadataSpace,
  sharedComparisonFitFrame,
} from "../web/js/media_feed/viewer_compare.js";
import { installViewerSupport } from "../web/js/media_feed/viewer_support.js";
import { installViewerMetadata } from "../web/js/media_feed/viewer_metadata.js";
import { installViewerZoom } from "../web/js/media_feed/viewer_zoom.js";

function pane(width, height, frameWidth = 500, frameHeight = 500) {
  const media = {};
  const viewer = {
    imageBaseMode: "fit", imageZoom: 2, imagePanX: 100, imagePanY: -50,
    media: { getBoundingClientRect: () => ({ width: frameWidth, height: frameHeight }) },
  };
  const controller = {
    getViewerScalableMedia: () => media,
    viewerMediaNaturalSize: () => ({ width, height }),
    clampViewerImageZoom: (zoom) => Math.min(8, Math.max(0.1, zoom)),
    updateViewerImageLayout() {},
  };
  return { viewer, controller };
}

test("comparison synchronizes fitted scale and relative position across aspect ratios", () => {
  const left = pane(2000, 1000);
  const right = pane(600, 1200);
  const view = captureComparisonView(left.viewer, left.controller, 100);
  assert.deepEqual(view, { zoom: 2, x: 0.1, y: -0.1 });
  applyComparisonView(right.viewer, right.controller, view, 100);
  assert.equal(right.viewer.imageZoom, 2);
  assert.ok(Math.abs(right.viewer.imagePanX - 50) < 1e-9);
  assert.ok(Math.abs(right.viewer.imagePanY + 100) < 1e-9);
  const actual = captureComparisonView(right.viewer, right.controller, 100);
  for (const key of ["zoom", "x", "y"]) assert.ok(Math.abs(actual[key] - view[key]) < 1e-9);
});

test("actual-size zoom is converted to the same relative fit magnification", () => {
  const left = pane(2000, 1000);
  left.viewer.imageBaseMode = "native";
  left.viewer.imageZoom = 1;
  const view = captureComparisonView(left.viewer, left.controller, 75);
  assert.equal(view.zoom, 1 / 0.1875);
  const right = pane(1000, 500);
  applyComparisonView(right.viewer, right.controller, view, 75);
  assert.deepEqual(captureComparisonView(right.viewer, right.controller, 75), view);
});

test("synchronized comparison uses the smaller media area for fitted size", () => {
  assert.deepEqual(
    sharedComparisonFitFrame({ width: 800, height: 600 }, { width: 500, height: 700 }),
    { width: 500, height: 600 },
  );
  assert.equal(sharedComparisonFitFrame({ width: 0, height: 600 }, { width: 500, height: 700 }), null);
});

test("synchronized comparison reserves matching metadata space on the hidden side", () => {
  assert.deepEqual(comparisonMetadataSpace(true, false, true), { left: false, right: true });
  assert.deepEqual(comparisonMetadataSpace(false, true, true), { left: true, right: false });
  assert.deepEqual(comparisonMetadataSpace(false, false, true), { left: false, right: false });
  assert.deepEqual(comparisonMetadataSpace(true, false, false), { left: false, right: false });
});

test("audio and unmeasured frames leave comparison view unchanged", () => {
  const { viewer, controller } = pane(0, 0);
  assert.equal(captureComparisonView(viewer, controller, 100), null);
  controller.getViewerScalableMedia = () => null;
  applyComparisonView(viewer, controller, { zoom: 4, x: 0, y: 0 }, 100);
  assert.equal(viewer.imageZoom, 2);
  assert.equal(captureComparisonView(viewer, controller, 100), null);
});

test("comparison duplicates mount paused with independent audible playback available", () => {
  let plays = 0;
  let pauses = 0;
  const playback = { muted: true, play() { plays++; return Promise.resolve(); } };
  const viewer = {
    isComparisonPane: true,
    media: {
      querySelector: () => ({ pause() { pauses++; } }),
      replaceChildren() {},
    },
  };
  const context = { runtime: {}, actions: {} };
  installViewerSupport(context);
  context.actions.replaceViewerMedia(viewer, { matches: () => false, querySelector: () => playback }, { autoplay: false });
  assert.equal(plays, 0);
  assert.equal(pauses, 1);
  assert.equal(playback.muted, false);
});

test("comparison metadata follows its own item and ignores stale loads", async () => {
  const pending = new Map();
  const grid = () => ({ childElementCount: 0, replaceChildren() {} });
  const viewer = {
    isComparisonPane: true,
    showPrompts: true,
    item: { id: "a", kind: "audio" },
    root: { dataset: { open: "true" } },
    body: { dataset: {} },
    media: { querySelector: () => null },
    promptPanel: { hidden: true, dataset: { rendered: "false" }, setAttribute() {}, querySelectorAll: () => [] },
    promptStatus: {},
    scanFullMetadataButton: {},
    copyAllMetadataButton: {},
    downloadMetadataButton: {},
    resourcesGrid: grid(),
    metadataGrid: grid(),
    resourcesSection: {},
    metadataSection: {},
    promptSeed: {},
    promptPositive: {},
    promptNegative: {},
    items: [],
    index: -1,
    promptRequestId: 0,
  };
  const context = {
    state: { showPrompts: false },
    runtime: { viewer, mediaDimensionCache: new Map() },
    services: {
      getCachedPromptMetadata: () => null,
      loadPromptMetadata: (item) => new Promise((resolve) => pending.set(item.id, resolve)),
    },
    actions: { formatAllViewerMetadata: () => "", viewerMediaNaturalSize: () => ({}) },
  };
  installViewerMetadata(context);
  context.actions.updateViewerPromptPanel();
  viewer.item = { id: "b", kind: "audio" };
  context.actions.updateViewerPromptPanel();
  pending.get("b")({ positive: "new prompt" });
  await Promise.resolve();
  pending.get("a")({ positive: "old prompt" });
  await Promise.resolve();
  assert.equal(viewer.promptPanel.hidden, false);
  assert.equal(viewer.promptPositive.textContent, "new prompt");
  assert.equal(viewer.lastPromptMetadataItemId, "b");
  assert.equal(context.state.showPrompts, false);

  viewer.item = { id: "c", kind: "audio" };
  context.actions.updateViewerPromptPanel();
  assert.equal(viewer.promptPositive.textContent, "new prompt");
  assert.equal(viewer.promptPanel.dataset.pending, "true");
  pending.get("c")({ positive: "later prompt" });
  await Promise.resolve();
  assert.equal(viewer.promptPositive.textContent, "later prompt");
  assert.equal(viewer.promptPanel.dataset.pending, "false");

  viewer.item = { id: "d", kind: "image" };
  viewer.mediaReadyItemId = "";
  context.actions.renderPromptMetadataWhenMediaReady({ positive: "image prompt" }, viewer.item);
  assert.equal(viewer.promptPositive.textContent, "image prompt");
  assert.equal(viewer.pendingPromptMetadataResult.itemId, "d");
  viewer.mediaReadyItemId = "d";
  context.actions.refreshViewerPromptPanelDetails();
  assert.equal(viewer.pendingPromptMetadataResult, null);
});

test("clicking empty space around either comparison grid closes the viewer", () => {
  const originalImageElement = globalThis.HTMLImageElement;
  globalThis.HTMLImageElement = class {};
  try {
    let closed = 0;
    const visibilityChanges = [];
    const runtime = { viewer: { comparing: true, root: {}, body: {}, main: {}, media: {} } };
    const context = {
      state: {}, runtime,
      actions: {
        closeViewer: () => { closed++; },
        setViewerBatchSelectionVisible: (visible, viewer) => visibilityChanges.push([visible, viewer]),
      },
    };
    installViewerZoom(context);
    for (const side of ["left", "right"]) {
      for (const name of ["cmf-viewer-pane", "cmf-viewer-media-stage", "cmf-viewer-media"]) {
        const before = closed;
        context.actions.handleViewerBackdropClick({ target: {
          closest: (selector) => selector === ".cmf-viewer-pane" ? { side } : null,
          classList: { contains: (value) => value === name },
        } });
        assert.equal(closed, before + 1);
      }
    }
    context.actions.handleViewerBackdropClick({ target: {
      closest: (selector) => selector === ".cmf-viewer-batch-grid" ? {} : null,
      classList: { contains: () => false },
    } });
    assert.equal(closed, 6, "clicking the grid itself keeps the viewer open");
    context.actions.handleViewerBackdropClick({ target: runtime.viewer.main });
    assert.equal(closed, 7);
    assert.equal(visibilityChanges.length, 8);
  } finally {
    if (originalImageElement === undefined) delete globalThis.HTMLImageElement;
    else globalThis.HTMLImageElement = originalImageElement;
  }
});

test("clicking viewer chrome hides batch selection frames without closing the viewer", () => {
  const originalImageElement = globalThis.HTMLImageElement;
  globalThis.HTMLImageElement = class {};
  try {
    let closed = 0;
    const reference = {};
    const visibilityChanges = [];
    const runtime = { viewer: { root: {}, body: {}, main: {}, media: {}, reference } };
    const context = {
      state: {}, runtime,
      actions: {
        closeViewer: () => { closed++; },
        setViewerBatchSelectionVisible: (visible, viewer) => visibilityChanges.push([visible, viewer]),
      },
    };
    installViewerZoom(context);
    context.actions.handleViewerBackdropClick({
      target: { closest: () => null, classList: { contains: () => false } },
    });
    assert.equal(closed, 0);
    assert.deepEqual(visibilityChanges, [[false, undefined], [false, reference]]);
  } finally {
    if (originalImageElement === undefined) delete globalThis.HTMLImageElement;
    else globalThis.HTMLImageElement = originalImageElement;
  }
});
