import assert from "node:assert/strict";
import test from "node:test";

import { attachThumbnailPreview, mediaPreviewUrl, previewDescription, retainedFeedImageBytes, subscribeMediaPreview } from "../web/js/media_feed/media_previews.js";
import { installAudioWaveforms } from "../web/js/media_feed/audio_waveform.js";
import { createMediaFeedRuntime } from "../web/js/media_feed/runtime.js";
import { installViewerSupport } from "../web/js/media_feed/viewer_support.js";
import { installViewerRender } from "../web/js/media_feed/viewer_render.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const source = "/view?filename=large.png&subfolder=folder&type=output";
function context() {
  return {
    api: { apiURL: (path) => `/api${path}` }, state: { views: new Set() },
    runtime: createMediaFeedRuntime(), ICONS: {},
    actions: { formatMediaDuration: (value) => `${value}s`, removeMissingMediaItem() {} },
  };
}

test("preview URLs preserve media references without requesting originals", () => {
  assert.equal(mediaPreviewUrl(context(), source), "/api/media-feed/preview?filename=large.png&subfolder=folder&type=output");
  assert.throws(() => mediaPreviewUrl(context(), "/unrelated"));
});

test("ordinary preview loading shows file information without a preparation message", () => {
  const item = { filename: "result.png" };
  assert.equal(previewDescription({ status: "pending", width: 1024, height: 1024 }, item), "result.png · 1024 × 1024");
  assert.match(previewDescription({ status: "deferred" }, item), /Waiting for memory/);
  assert.match(previewDescription({ status: "unavailable" }, item), /Preview unavailable/);
});

test("visible consumers share requests, memory deferrals retry, and ready results are cached", async (t) => {
  const owner = context();
  const responses = [
    { status: "deferred", retryAfter: 10, width: 8192, height: 8192 },
    { status: "ready", thumbnail: true, version: "version", width: 8192, height: 8192 },
  ];
  let requested = 0;
  const timers = new Map();
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { timers.set(callback, delay); return callback; });
  t.mock.method(globalThis, "clearTimeout", (callback) => timers.delete(callback));
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.ok(url.startsWith("/api/media-feed/preview?"));
    requested++;
    return new Response(JSON.stringify(responses.shift()));
  });
  const first = [], second = [];
  const stopFirst = subscribeMediaPreview(owner, source, { update: (info) => first.push(info.status) });
  const stopSecond = subscribeMediaPreview(owner, source, { update: (info) => second.push(info.status) });
  await flush();
  assert.equal(requested, 1);
  assert.deepEqual(first, ["deferred"]);
  assert.deepEqual(second, ["deferred"]);
  const [retry, delay] = timers.entries().next().value;
  assert.equal(delay, 10_000);
  timers.delete(retry);
  retry();
  await flush();
  assert.deepEqual(first, ["deferred", "ready"]);
  const third = [];
  subscribeMediaPreview(owner, source, { update: (info) => third.push(info.status) })();
  assert.deepEqual(third, ["ready"]);
  assert.equal(requested, 2);
  assert.equal(owner.runtime.mediaPreviewJobs.size, 0);
  stopFirst(); stopSecond();
});

test("pending previews are checked promptly and back off for longer jobs", async (t) => {
  const owner = context();
  const timers = new Map();
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { timers.set(callback, delay); return callback; });
  t.mock.method(globalThis, "clearTimeout", (callback) => timers.delete(callback));
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    status: ++requests <= 5 ? "pending" : "ready", retryAfter: 2,
  })));
  const updates = [];
  const stop = subscribeMediaPreview(owner, source, { update: (info) => updates.push(info.status) });
  await flush();
  for (const expected of [250, 500, 1000, 2000, 2000]) {
    const [callback, delay] = timers.entries().next().value;
    assert.equal(delay, expected);
    timers.delete(callback);
    callback();
    await flush();
  }
  assert.equal(updates.at(-1), "ready");
  assert.equal(timers.size, 0);
  stop();
});

for (const slow of [false, true]) test(slow
  ? "slow previews keep file information without preparation text while memory deferrals show their reason"
  : "quick previews never flash a preparation label", async (t) => {
  const owner = context();
  const timers = new Map();
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { timers.set(callback, delay); return callback; });
  t.mock.method(globalThis, "clearTimeout", (callback) => timers.delete(callback));
  const replies = [
    { status: "pending" },
    ...(slow ? [{ status: "deferred", retryAfter: 10, width: 16384, height: 8192 }] : []),
    { status: "ready", thumbnail: true, version: "v1" },
  ];
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(replies.shift())));
  const media = { dataset: {}, src: "", addEventListener() {}, removeAttribute(name) { this[name] = ""; } };
  const label = { dataset: {} }, card = {};
  attachThumbnailPreview(owner, card, media, { kind: "image", filename: "large.png", url: source }, label);
  card.activateMediaPreview();
  await flush();
  assert.equal(label.hidden, true);
  if (slow) {
    const reveal = [...timers].find(([, delay]) => delay === 600)[0];
    timers.delete(reveal);
    reveal();
    assert.equal(label.hidden, false);
    assert.equal(label.textContent, "large.png");
  }
  const poll = [...timers].find(([, delay]) => delay === 250)[0];
  timers.delete(poll);
  poll();
  await flush();
  if (slow) {
    assert.equal(label.hidden, false);
    assert.match(label.textContent, /Waiting for memory.*16384 × 8192/);
    const retry = [...timers].find(([, delay]) => delay === 10000)[0];
    timers.delete(retry);
    retry();
    await flush();
  }
  assert.equal(label.hidden, true);
  assert.ok(media.src.includes("thumbnail"));
  assert.equal(timers.size, 0, "a completed preview cannot reveal its old loading label later");
  card.deactivateMediaPreview();
  card.activateMediaPreview();
  assert.equal(label.hidden, true);
  assert.equal(timers.size, 0, "reused previews have no loading delay");
  card.deactivateMediaPreview();
});

test("leaving the feed aborts a preview request only after its last consumer leaves", async (t) => {
  const owner = context();
  let signal;
  t.mock.method(globalThis, "fetch", (_, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  });
  const stopFirst = subscribeMediaPreview(owner, source, { update() {} });
  const stopSecond = subscribeMediaPreview(owner, source, { update() {} });
  stopFirst();
  assert.equal(signal.aborted, false);
  stopSecond();
  assert.equal(signal.aborted, true);
  assert.equal(owner.runtime.mediaPreviewJobs.size, 0);
  await flush();
});

test("thumbnails keep original dimensions, show useful waiting information, and unload outside the feed", async (t) => {
  const owner = context();
  const media = {
    dataset: {}, src: "", addEventListener() {},
    removeAttribute(name) { this[name] = ""; },
  };
  const item = { key: "large", kind: "image", filename: "large.png", url: source };
  const label = { dataset: {} }, card = {};
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    status: "ready", thumbnail: true, width: 16384, height: 8192, version: "v1", bytes: 1048576,
  })));
  attachThumbnailPreview(owner, card, media, item, label);
  assert.equal(media.src, "");
  assert.equal(label.textContent, "large.png");
  card.activateMediaPreview();
  await flush();
  assert.ok(media.src.startsWith("/api/media-feed/thumbnail?"));
  assert.match(label.textContent, /16384 × 8192/);
  assert.equal(media.dataset.originalMediaUrl, source);
  assert.equal(media.dataset.originalWidth, "16384");
  card.deactivateMediaPreview();
  assert.equal(media.src, "");
  card.activateMediaPreview();
  assert.ok(media.src.includes("thumbnail"));
  card.deactivateMediaPreview();
});

test("a video poster does not load the original video and offscreen playback is released", async (t) => {
  const owner = context();
  const video = {
    dataset: {}, addEventListener() {}, pause() { this.paused = true; }, load() { this.reloaded = true; },
    removeAttribute(name) { delete this[name]; },
  };
  const item = { kind: "video", filename: "clip.mp4", url: source.replace("large.png", "clip.mp4") };
  const card = {}, label = { dataset: {} }, duration = {};
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    status: "ready", thumbnail: true, width: 7680, height: 4320, duration: 3600, version: "v1",
  })));
  attachThumbnailPreview(owner, card, video, item, label, duration);
  card.activateMediaPreview();
  await flush();
  assert.ok(video.poster.includes("thumbnail"));
  assert.equal(video.src, undefined);
  assert.equal(duration.textContent, "3600s");
  video.src = item.url;
  card.deactivateMediaPreview();
  assert.equal(video.src, undefined);
  assert.equal(video.poster, undefined);
  assert.equal(video.paused, true);
  assert.equal(video.reloaded, true);
});

test("waveforms use server levels and never decode or download the original recording", async (t) => {
  const owner = context();
  installAudioWaveforms(owner);
  const url = source.replace("large.png", "hour.wav");
  const requests = [];
  t.mock.method(globalThis, "fetch", async (requested) => {
    requests.push(requested);
    return new Response(JSON.stringify({ status: "ready", duration: 3600, peaks: new Array(512).fill(0.5) }));
  });
  const rendered = [], durations = [];
  const stop = owner.actions.subscribeAudioWaveform(url, 64, {
    render: (peaks) => rendered.push(peaks), update: (info) => durations.push(info.duration),
    fail(error) { throw error; },
  });
  await flush();
  assert.equal(requests.length, 1);
  assert.match(requests[0], /^\/api\/media-feed\/preview\?/);
  assert.equal(rendered[0].length, 64);
  assert.deepEqual(durations, [3600]);
  assert.equal(owner.runtime.activeAudioWaveformLoads, 0);
  stop();
});

test("image cache observes a combined byte budget and never caches thumbnails as originals", () => {
  const owner = context();
  installViewerSupport(owner);
  const image = (width, height) => ({ complete: true, naturalWidth: width, naturalHeight: height, dataset: {} });
  const first = image(3000, 3000), second = image(3000, 3000);
  owner.actions.rememberDecodedImage("one", first);
  owner.actions.rememberDecodedImage("two", second);
  assert.deepEqual([...owner.runtime.decodedImageCache.keys()], ["two"]);
  const thumb = image(512, 512);
  thumb.dataset.originalMediaUrl = source;
  owner.actions.rememberDecodedImage(source, thumb);
  assert.equal(owner.runtime.decodedImageCache.has(source), false);
  const feedImages = Array.from({ length: 32 }, () => image(512, 512));
  const poster = {
    tagName: "VIDEO", dataset: { thumbnailWidth: "512", thumbnailHeight: "512" },
    getAttribute: () => "poster.webp",
  };
  feedImages.push(poster);
  owner.state.views.add({ cards: new Map([["card", { querySelectorAll: () => feedImages }]]), cardCache: new Map() });
  owner.actions.trimDecodedImageCache();
  assert.equal(owner.runtime.decodedImageCache.size, 0);
  assert.equal(retainedFeedImageBytes(owner.runtime, owner.state), 33 * 1048576);
  poster.getAttribute = () => null;
  assert.equal(retainedFeedImageBytes(owner.runtime, owner.state), 32 * 1048576);
  owner.actions.rememberDecodedImage("huge", image(16384, 16384));
  assert.equal(owner.runtime.decodedImageCache.size, 0);
});

test("the viewer loads the original even when opened from a ready thumbnail", async (t) => {
  const image = { dataset: {} };
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => image };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const owner = context();
  const item = { id: "large", key: "large", kind: "image", filename: "large.png", url: source };
  const viewer = {
    root: { dataset: { open: "true" } }, renderRequestId: 0,
    media: { querySelector: () => null, replaceChildren(next) { this.image = next; } },
    title: {}, openLink: {}, copyImageButton: {}, favoriteButton: {},
  };
  owner.runtime.viewer = viewer;
  const thumb = { complete: true, src: "/media-feed/thumbnail?filename=large.png", dataset: { originalMediaUrl: source } };
  owner.runtime.decodedImageCache.set(source, thumb);
  Object.assign(owner.actions, {
    ensureViewer: () => viewer, clearViewerAudioWaveform() {}, discardStagedMedia() {},
    resetViewerImageView() {}, syncFavoriteButton() {}, syncViewerNav() {}, prepareViewerImage() {},
    updateViewerImageControls() {}, decodeImageElement: async () => {},
    isCurrentViewerRender: () => true, rememberDecodedImage() {}, rememberMediaDimensions() {},
    updateViewerImageLayout() {}, refreshViewerPromptPanelDetails() {},
  });
  installViewerRender(owner);
  await owner.actions.renderViewerItem(item, thumb);
  assert.equal(image.src, source);
  assert.equal(viewer.media.image, image);
});
