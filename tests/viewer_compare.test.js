import assert from "node:assert/strict";
import test from "node:test";
import { captureComparisonView, applyComparisonView } from "../web/js/media_feed/viewer_compare.js";
import { installViewerSupport } from "../web/js/media_feed/viewer_support.js";

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

test("audio and unmeasured frames leave comparison view unchanged", () => {
  const { viewer, controller } = pane(0, 0);
  assert.equal(captureComparisonView(viewer, controller, 100), null);
  controller.getViewerScalableMedia = () => null;
  applyComparisonView(viewer, controller, { zoom: 4, x: 0, y: 0 }, 100);
  assert.equal(viewer.imageZoom, 2);
  assert.equal(captureComparisonView(viewer, controller, 100), null);
});

test("pinned video and audio mount paused with independent audible playback available", () => {
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
  context.actions.replaceViewerMedia(viewer, { matches: () => false, querySelector: () => playback });
  assert.equal(plays, 0);
  assert.equal(pauses, 1);
  assert.equal(playback.muted, false);
});
