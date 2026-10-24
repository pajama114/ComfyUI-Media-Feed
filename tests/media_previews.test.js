import assert from "node:assert/strict";
import test from "node:test";

import { attachThumbnailPreview, mediaPreviewUrl, previewDescription, retainedFeedImageBytes, subscribeMediaPreview } from "../web/js/media_feed/media_previews.js";
import { installAudioWaveforms } from "../web/js/media_feed/audio_waveform.js";
import { createMediaFeedRuntime } from "../web/js/media_feed/runtime.js";
import { installViewerSupport } from "../web/js/media_feed/viewer_support.js";
import { installViewerRender } from "../web/js/media_feed/viewer_render.js";
import { cachedImageBytes, clearThumbnailImages, retainThumbnailImage, takeThumbnailImage } from "../web/js/media_feed/thumbnail_images.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const source = "/view?filename=large.png&subfolder=folder&type=output";
function previewImage() {
  const listeners = new Map();
  return {
    dataset: {}, src: "", complete: true, naturalWidth: 0, naturalHeight: 0,
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) || [];
      callbacks.push(callback);
      listeners.set(type, callbacks);
    },
    removeEventListener(type, callback) {
      listeners.set(type, (listeners.get(type) || []).filter((current) => current !== callback));
    },
    removeAttribute(name) {
      this[name] = "";
      if (name === "src") this.naturalWidth = this.naturalHeight = 0;
    },
    finishLoading(width = 512, height = 256) {
      this.complete = true;
      this.naturalWidth = width;
      this.naturalHeight = height;
      for (const callback of listeners.get("load") || []) callback();
    },
    failLoading() {
      this.complete = true;
      this.naturalWidth = this.naturalHeight = 0;
      for (const callback of listeners.get("error") || []) callback();
    },
  };
}

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
  const media = previewImage();
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
  assert.ok(media.src.includes("thumbnail"));
  assert.equal(media.dataset.previewLoaded, "false", "a ready descriptor does not mean the image is loaded");
  media.finishLoading();
  assert.equal(label.hidden, true);
  assert.equal(timers.size, 0, "a completed preview cannot reveal its old loading label later");
  card.deactivateMediaPreview();
  card.activateMediaPreview();
  assert.equal(label.hidden, true);
  media.finishLoading();
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
  await flush();
  assert.equal(signal.aborted, true);
  assert.equal(owner.runtime.mediaPreviewJobs.size, 0);
  await flush();
});

test("thumbnails keep dimensions and loaded pixels when returning from outside the feed", async (t) => {
  const owner = context();
  const media = previewImage();
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
  assert.equal(media.dataset.previewLoaded, "false");
  media.finishLoading();
  assert.equal(media.dataset.previewLoaded, "true");
  card.deactivateMediaPreview();
  assert.ok(media.src.includes("thumbnail"));
  assert.equal(media.dataset.previewLoaded, "true");
  assert.equal(owner.runtime.thumbnailImageCache.has(media), true);
  card.activateMediaPreview();
  assert.ok(media.src.includes("thumbnail"));
  assert.equal(media.dataset.previewLoaded, "true");
  assert.equal(owner.runtime.thumbnailImageCache.has(media), false);
  card.deactivateMediaPreview();
});

test("a thumbnail stays hidden until image load and keeps useful file information during a slow download", async (t) => {
  const owner = context();
  const timers = new Map();
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { timers.set(callback, delay); return callback; });
  t.mock.method(globalThis, "clearTimeout", (callback) => timers.delete(callback));
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    status: "ready", thumbnail: true, width: 1024, height: 1024, version: "v1",
  })));
  const media = previewImage(), label = { dataset: {} }, card = {};
  attachThumbnailPreview(owner, card, media, { kind: "image", filename: "large.png", url: source }, label);
  assert.equal(media.dataset.previewLoaded, "false");
  card.activateMediaPreview();
  await flush();
  assert.equal(media.dataset.previewLoaded, "false");
  assert.equal(label.hidden, true);
  const [reveal, delay] = timers.entries().next().value;
  assert.equal(delay, 600);
  timers.delete(reveal);
  reveal();
  assert.equal(label.hidden, false);
  assert.match(label.textContent, /large.png.*1024 × 1024/);
  media.finishLoading();
  assert.equal(media.dataset.previewLoaded, "true");
  assert.equal(label.hidden, true);
  card.deactivateMediaPreview();
  media.finishLoading();
  assert.equal(media.dataset.previewLoaded, "true", "an offscreen image retains its loaded pixels");
  assert.equal(timers.size, 0);
});

test("ordinary images reuse the original URL and remain loaded within the offscreen cache", async (t) => {
  const owner = context();
  const media = previewImage(), label = { dataset: {} }, card = {};
  const item = { kind: "image", filename: "ordinary.png", url: source };
  let requests = 0;
  const timers = new Map();
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { timers.set(callback, delay); return callback; });
  t.mock.method(globalThis, "clearTimeout", (callback) => timers.delete(callback));
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response(JSON.stringify({ status: "ready", thumbnail: false, width: 2000, height: 3999 }));
  });
  const dimensions = [];
  owner.actions.rememberMediaDimensions = (item, image) => dimensions.push([image.dataset.originalWidth, image.dataset.originalHeight]);
  attachThumbnailPreview(owner, card, media, item, label);
  card.activateMediaPreview();
  await flush();
  assert.equal(media.src, source);
  assert.equal(media.dataset.originalMediaUrl, undefined, "the viewer can reuse an original image");
  assert.equal(media.dataset.previewLoaded, "false");
  assert.equal(label.hidden, true);
  const [reveal, delay] = timers.entries().next().value;
  assert.equal(delay, 600);
  timers.delete(reveal);
  reveal();
  assert.equal(label.hidden, false);
  media.finishLoading(3999, 2000);
  assert.equal(media.dataset.previewLoaded, "true");
  assert.equal(label.hidden, true);
  assert.deepEqual(dimensions.at(-1), ["3999", "2000"], "browser dimensions account for orientation");
  card.deactivateMediaPreview();
  assert.equal(media.src, source);
  assert.equal(media.dataset.previewLoaded, "true");
  card.activateMediaPreview();
  assert.equal(media.src, source);
  assert.equal(requests, 1, "reactivation reuses the descriptor without requesting a thumbnail");
  card.deactivateMediaPreview();
  assert.equal(timers.size, 0);
});

test("a failed thumbnail is hidden, explains the failure, and can retry without invalidating offscreen previews", async (t) => {
  const owner = context();
  const timers = new Map();
  let requests = 0;
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { timers.set(callback, delay); return callback; });
  t.mock.method(globalThis, "clearTimeout", (callback) => timers.delete(callback));
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response(JSON.stringify({ status: "ready", thumbnail: true, version: "v1" }));
  });
  const media = previewImage(), label = { dataset: {} }, card = {};
  let assignedSource = "", sourceAssignments = 0;
  Object.defineProperty(media, "src", {
    get: () => assignedSource,
    set(value) { assignedSource = value; sourceAssignments++; media.complete = false; },
  });
  attachThumbnailPreview(owner, card, media, { kind: "image", filename: "large.png", url: source }, label);
  card.activateMediaPreview();
  await flush();
  media.finishLoading();
  media.failLoading();
  assert.equal(media.dataset.previewLoaded, "false");
  assert.equal(label.hidden, false);
  assert.match(label.textContent, /Preview unavailable.*large.png/);
  assert.equal(owner.runtime.mediaPreviewCache.size, 0);
  const [retry, delay] = timers.entries().next().value;
  assert.equal(delay, 5000);
  timers.delete(retry);
  retry();
  await flush();
  assert.equal(requests, 2);
  assert.equal(sourceAssignments, 2, "retrying the same URL must start a new image load");
  media.finishLoading();
  assert.equal(media.dataset.previewLoaded, "true");
  assert.equal(label.hidden, true);
  card.deactivateMediaPreview();
  media.failLoading();
  assert.equal(owner.runtime.mediaPreviewCache.size, 1);
  assert.equal(timers.size, 0);
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

for (const reduced of [false, true]) test(`switching layouts transfers a loaded ${reduced ? "thumbnail" : "original"} without another load`, async (t) => {
  const owner = context();
  const item = { id: "same-output", kind: "image", filename: "large.png", url: source };
  const media = previewImage();
  let assigned = "", assignments = 0, requests = 0;
  Object.defineProperty(media, "src", {
    get: () => assigned,
    set(value) { assigned = value; assignments++; media.complete = false; },
  });
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response(JSON.stringify({ status: "ready", thumbnail: reduced, version: "v1", width: 4096, height: 4096 }));
  });
  let card = {}, label = { dataset: {} };
  attachThumbnailPreview(owner, card, media, item, label);
  card.activateMediaPreview();
  await flush();
  media.finishLoading();
  const loadedUrl = media.src;
  for (const batchMode of [true, false, true]) {
    card.disposeMediaPreview();
    owner.state.batchMode = batchMode;
    const reused = takeThumbnailImage(owner, item);
    assert.equal(reused, media, "the exact loaded element moves into the new layout");
    card = {};
    label = { dataset: {} };
    attachThumbnailPreview(owner, card, reused, item, label);
    card.activateMediaPreview();
    assert.equal(media.src, loadedUrl);
    assert.equal(media.complete, true);
    assert.equal(media.dataset.previewLoaded, "true");
    assert.equal(label.hidden, true, "no load event or timer is needed to reveal the new layout");
  }
  assert.equal(requests, 1);
  assert.equal(assignments, 1);
  card.disposeMediaPreview();
  clearThumbnailImages(owner);
});

test("switching layouts hands an unfinished preview request to the new card without aborting or restarting it", async (t) => {
  const owner = context();
  const item = { id: "pending-output", kind: "image", filename: "large.png", url: source };
  const media = previewImage();
  let respond, signal, requests = 0;
  t.mock.method(globalThis, "fetch", (_url, options) => {
    requests++;
    signal = options.signal;
    return new Promise((resolve) => { respond = resolve; });
  });
  const first = {}, firstLabel = { dataset: {} };
  attachThumbnailPreview(owner, first, media, item, firstLabel);
  first.activateMediaPreview();
  first.disposeMediaPreview();
  owner.state.batchMode = true;
  const next = {}, nextLabel = { dataset: {} };
  attachThumbnailPreview(owner, next, takeThumbnailImage(owner, item), item, nextLabel);
  next.activateMediaPreview();
  await flush();
  assert.equal(signal.aborted, false);
  assert.equal(requests, 1);
  respond(new Response(JSON.stringify({ status: "ready", thumbnail: true, version: "v1" })));
  await flush();
  assert.ok(media.src.includes("size=512"));
  media.finishLoading();
  assert.equal(nextLabel.hidden, true);
  assert.equal(media.dataset.previewLoaded, "true");
  assert.equal(firstLabel.textContent, "large.png", "disposed card callbacks do not handle the transferred image");
  next.disposeMediaPreview();
  clearThumbnailImages(owner);
});

test("offscreen images share a bounded cache with viewer images and old output versions cannot be reused", () => {
  const owner = context();
  installViewerSupport(owner);
  const images = Array.from({ length: 5 }, () => previewImage());
  for (const [index, image] of images.entries()) {
    image.src = source;
    image.finishLoading(4000, 4000);
    retainThumbnailImage(owner, image, { id: String(index), url: source }, { status: "ready" }, true);
  }
  assert.equal(images[0].src, "", "the oldest extra image releases its source when the cache is full");
  assert.equal(owner.runtime.thumbnailImageCache.size, 4);
  assert.ok(cachedImageBytes(owner.runtime) <= 256 * 1024 * 1024);
  assert.equal(takeThumbnailImage(owner, { id: "new-output", url: source }), null);
  assert.equal(takeThumbnailImage(owner, { id: "4", url: source }), images[4]);
  clearThumbnailImages(owner);
  assert.equal(owner.runtime.thumbnailImageCache.size, 0);
  assert.equal(images[1].src, "");
  assert.equal(images[4].src, source, "the image already handed to an active card is not released");
});

test("a layout transfer keeps active images available even when they exceed the extra cache budget", () => {
  const owner = context();
  installViewerSupport(owner);
  owner.runtime.transferringThumbnailImages = true;
  const image = previewImage();
  image.src = source;
  image.finishLoading(10000, 10000);
  retainThumbnailImage(owner, image, { id: "active", url: source }, { status: "ready" }, true);
  assert.equal(takeThumbnailImage(owner, { id: "active", url: source }), image);
  owner.runtime.transferringThumbnailImages = false;
  owner.actions.trimDecodedImageCache();
  assert.equal(image.src, source);
});

test("a disposed image that finishes loading offscreen still obeys the cache budget", async (t) => {
  const owner = context();
  installViewerSupport(owner);
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ status: "ready", thumbnail: false })));
  const media = previewImage(), card = {};
  attachThumbnailPreview(owner, card, media, { kind: "image", filename: "large.png", url: source }, { dataset: {} });
  card.activateMediaPreview();
  await flush();
  card.disposeMediaPreview();
  assert.equal(owner.runtime.thumbnailImageCache.size, 1);
  media.finishLoading(10000, 10000);
  assert.equal(owner.runtime.thumbnailImageCache.size, 0);
  assert.equal(media.src, "");
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

test("extra image caching has a byte budget independent of active cards and excludes thumbnails from originals", () => {
  const owner = context();
  installViewerSupport(owner);
  const image = (width, height) => ({ complete: true, naturalWidth: width, naturalHeight: height, dataset: {} });
  const first = image(6000, 6000), second = image(6000, 6000);
  owner.actions.rememberDecodedImage("one", first);
  owner.actions.rememberDecodedImage("two", second);
  assert.deepEqual([...owner.runtime.decodedImageCache.keys()], ["two"]);
  const thumb = image(512, 512);
  thumb.dataset.originalMediaUrl = source;
  owner.actions.rememberDecodedImage(source, thumb);
  assert.equal(owner.runtime.decodedImageCache.has(source), false);
  const feedImages = Array.from({ length: 32 }, () => image(2048, 2048));
  const poster = {
    tagName: "VIDEO", dataset: { thumbnailWidth: "512", thumbnailHeight: "512" },
    getAttribute: () => "poster.webp",
  };
  feedImages.push(poster);
  owner.state.views.add({ cards: new Map([["card", { querySelectorAll: () => feedImages }]]), cardCache: new Map() });
  owner.actions.trimDecodedImageCache();
  assert.equal(owner.runtime.decodedImageCache.size, 1, "active cards do not consume the extra cache budget");
  assert.equal(retainedFeedImageBytes(owner.runtime, owner.state), 513 * 1048576 + 6000 * 6000 * 4);
  poster.getAttribute = () => null;
  assert.equal(retainedFeedImageBytes(owner.runtime, owner.state), 512 * 1048576 + 6000 * 6000 * 4);
  owner.actions.rememberDecodedImage("huge", image(16384, 16384));
  assert.equal(owner.runtime.decodedImageCache.size, 1);
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
