import { IMAGE_THUMBNAIL_MIN_PIXELS } from "./constants.js";
import { activateThumbnailImage, clearThumbnailImages, estimatedImageBytes, retainThumbnailImage } from "./thumbnail_images.js";

export { estimatedImageBytes } from "./thumbnail_images.js";

// Preview descriptors are small. Media files and decoded recordings stay out of
// this cache; thumbnail pixels are accounted for separately by the feed.
const PREVIEW_CACHE_SIZE = 128;

export function invalidateMediaPreview(context, url) {
  if (!url) return;
  const source = new URL(url, globalThis.location?.href || "http://localhost/").href;
  for (const key of context.runtime.mediaPreviewCache?.keys() || []) {
    const candidate = new URL(key, globalThis.location?.href || "http://localhost/");
    candidate.searchParams.delete("preview_size");
    if (candidate.href === source) context.runtime.mediaPreviewCache.delete(key);
  }
  context.runtime.audioWaveformCache?.delete(url);
  context.runtime.decodedImageCache?.delete(url);
  clearThumbnailImages(context, url);
}

export function mediaPreviewUrl(context, url, resource = "preview", version = "") {
  const source = new URL(url, globalThis.location?.href || "http://localhost/");
  const params = new URLSearchParams();
  for (const name of ["filename", "subfolder", "type"]) {
    const value = source.searchParams.get(name);
    if (value !== null) params.set(name, value);
  }
  if (!params.has("filename")) throw new Error("Invalid media URL");
  if (source.searchParams.has("preview_size")) params.set("size", source.searchParams.get("preview_size"));
  if (version) params.set("v", version);
  const path = `/media-feed/${resource}?${params}`;
  return context.api?.apiURL ? context.api.apiURL(path) : path;
}

function rememberMediaPreview(context, url, info) {
  const cache = context.runtime.mediaPreviewCache ||= new Map();
  cache.delete(url);
  cache.set(url, info);
  while (cache.size > PREVIEW_CACHE_SIZE) cache.delete(cache.keys().next().value);
}

export function subscribeMediaPreview(context, url, consumer) {
  const { runtime } = context;
  const cache = runtime.mediaPreviewCache ||= new Map();
  const jobs = runtime.mediaPreviewJobs ||= new Map();
  const cached = cache.get(url);
  if (cached) {
    cache.delete(url);
    cache.set(url, cached);
    consumer.update(cached);
    return () => {};
  }
  let job = jobs.get(url);
  if (!job) {
    job = { consumers: new Set(), controller: null, timer: null, running: false, pendingChecks: 0 };
    jobs.set(url, job);
  }
  job.consumers.add(consumer);
  const run = async () => {
    if (!job.consumers.size || jobs.get(url) !== job) return;
    job.running = true;
    job.timer = null;
    const controller = new AbortController();
    job.controller = controller;
    try {
      const response = await fetch(mediaPreviewUrl(context, url), { signal: controller.signal });
      if (!response.ok) throw Object.assign(new Error("Unable to load preview"), { status: response.status });
      const info = await response.json();
      if (controller.signal.aborted || jobs.get(url) !== job) return;
      const finished = info.status === "ready" || info.status === "unavailable";
      if (finished) {
        rememberMediaPreview(context, url, info);
        jobs.delete(url);
      }
      for (const current of job.consumers) current.update(info);
      if (!finished && job.consumers.size) {
        // Probe quick jobs promptly, then back off for expensive files.
        const delay = info.status === "pending"
          ? Math.min(2000, 250 * 2 ** Math.min(job.pendingChecks++, 3))
          : Math.max(1000, Math.min(30_000, (Number(info.retryAfter) || 2) * 1000));
        if (info.status !== "pending") job.pendingChecks = 0;
        job.timer = setTimeout(run, delay);
      }
    } catch (error) {
      if (controller.signal.aborted || jobs.get(url) !== job) return;
      for (const current of job.consumers) current.fail?.(error);
      if (error.status === 400 || error.status === 404) jobs.delete(url);
      else if (job.consumers.size) job.timer = setTimeout(run, 5000);
    } finally {
      job.running = false;
    }
  };
  if (!job.running && !job.timer) void run();
  return () => {
    job.consumers.delete(consumer);
    if (job.consumers.size) return;
    // A layout switch hands a pending request to its replacement card in
    // the same turn, so it must not abort and restart that request.
    queueMicrotask(() => {
      if (job.consumers.size || jobs.get(url) !== job) return;
      clearTimeout(job.timer);
      job.controller?.abort();
      jobs.delete(url);
    });
  };
}

export function previewDescription(info, item, formatDuration) {
  const status = {
    deferred: "Waiting for memory",
    unavailable: "Preview unavailable",
  }[info?.status];
  const values = status ? [status, item.filename] : [item.filename];
  if (info?.width && info?.height) values.push(`${info.width} × ${info.height}`);
  if (Number.isFinite(info?.duration)) values.push(formatDuration(info.duration));
  if (info?.bytes) values.push(`${(info.bytes / 1048576).toFixed(1)} MiB`);
  return values.join(" · ");
}

export function attachThumbnailPreview(context, owner, media, item, label, durationLabel = null) {
  let unsubscribe = null;
  let active = false;
  let info = media.mediaFeedPreviewInfo || null;
  let retryTimer = null;
  let statusTimer = null;
  // An image without a descriptor loads its original directly. Its header
  // reveals the size before the download finishes, so only large images
  // switch to a server thumbnail and ordinary images never wait for one.
  let probing = false;
  let probeFrame = null;
  // Both layouts use the same resource; switching must never generate a
  // second thumbnail just because a grid cell is smaller.
  const size = 512;
  const requestUrl = new URL(item.url, globalThis.location?.href || "http://localhost/");
  requestUrl.searchParams.set("preview_size", String(size));
  const previewKey = requestUrl.href;
  if (!info) media.dataset.originalMediaUrl = item.url;
  if (item.kind === "image" && !media.naturalWidth) media.dataset.previewLoaded = "false";
  const stopProbe = () => {
    probing = false;
    if (probeFrame !== null) globalThis.cancelAnimationFrame?.(probeFrame);
    probeFrame = null;
  };
  // Returns true when the original is too large and the thumbnail takes over.
  const checkProbeSize = () => {
    stopProbe();
    if (media.naturalWidth * media.naturalHeight < IMAGE_THUMBNAIL_MIN_PIXELS) return false;
    media.removeAttribute("src");
    media.dataset.previewLoaded = "false";
    media.dataset.originalMediaUrl = item.url;
    media.dataset.serverPreview = "true";
    subscribe();
    return true;
  };
  const watchProbe = () => {
    probeFrame = null;
    if (!probing || !active) return;
    if (media.naturalWidth && media.naturalHeight) checkProbeSize();
    else if (globalThis.requestAnimationFrame) probeFrame = globalThis.requestAnimationFrame(watchProbe);
  };
  const probeOriginal = () => {
    probing = true;
    delete media.dataset.originalMediaUrl;
    media.dataset.previewLoaded = "false";
    if ((media.src !== item.url && media.getAttribute?.("src") !== item.url) || (media.complete && !media.naturalWidth)) {
      media.src = item.url;
    } else if (media.complete && media.naturalWidth) {
      if (!checkProbeSize()) onLoad();
      return;
    }
    watchProbe();
  };
  const onLoad = () => {
    if (item.kind === "image") {
      if (!active || !media.naturalWidth) return;
      if (probing && checkProbeSize()) return;
      if (!info && !media.dataset.originalMediaUrl) {
        info = { status: "ready", thumbnail: false, width: media.naturalWidth, height: media.naturalHeight };
        rememberMediaPreview(context, previewKey, info);
      }
      media.dataset.previewLoaded = "true";
      if (!media.dataset.originalMediaUrl) {
        media.dataset.originalWidth = String(media.naturalWidth);
        media.dataset.originalHeight = String(media.naturalHeight);
        context.actions.rememberMediaDimensions?.(item, media);
      }
      label.hidden = true;
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    context.actions.trimDecodedImageCache?.();
  };
  media.addEventListener("load", onLoad);
  const onError = () => {
    if (!active) return;
    if (probing) {
      // The server distinguishes a missing file from an unreadable one.
      stopProbe();
      media.removeAttribute("src");
      media.dataset.originalMediaUrl = item.url;
      media.dataset.serverPreview = "true";
      subscribe();
      return;
    }
    media.dataset.previewLoaded = "false";
    label.dataset.ready = "false";
    label.hidden = false;
    clearTimeout(statusTimer);
    statusTimer = null;
    label.textContent = previewDescription({ ...info, status: "unavailable" }, item, context.actions.formatMediaDuration);
    label.title = label.textContent;
    info = null;
    context.runtime.mediaPreviewCache?.delete(previewKey);
    unsubscribe?.();
    unsubscribe = null;
    if (active && !retryTimer) retryTimer = setTimeout(() => {
      retryTimer = null;
      active = false;
      owner.activateMediaPreview();
    }, 5000);
  };
  if (item.kind === "image") media.addEventListener("error", onError);
  // The browser may still display an image the server cannot thumbnail.
  const showOriginal = () => {
    delete media.dataset.originalMediaUrl;
    if ((media.src !== item.url && media.getAttribute?.("src") !== item.url) || (media.complete && !media.naturalWidth)) {
      media.dataset.previewLoaded = "false";
      media.src = item.url;
    }
  };
  const update = (result) => {
    info = result;
    const loadingImage = item.kind === "image" && (result.status === "ready" || result.status === "unavailable")
      && media.dataset.previewLoaded !== "true";
    label.textContent = previewDescription(result, item, context.actions.formatMediaDuration);
    label.title = label.textContent;
    label.hidden = (result.status === "pending" || loadingImage) && statusTimer !== null;
    if (result.status !== "pending" && !loadingImage) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    media.dataset.previewState = result.status;
    if (result.width && result.height) {
      media.dataset.originalWidth = String(result.width);
      media.dataset.originalHeight = String(result.height);
      context.actions.rememberMediaDimensions?.(item, media);
    }
    if (durationLabel && Number.isFinite(result.duration)) {
      media.dataset.previewDuration = String(result.duration);
      durationLabel.textContent = context.actions.formatMediaDuration(result.duration);
      durationLabel.hidden = false;
    }
    if (result.status === "ready" && (result.thumbnail || item.kind === "image")) {
      const url = result.thumbnail ? mediaPreviewUrl(context, previewKey, "thumbnail", result.version) : item.url;
      if (item.kind === "image") {
        if (result.thumbnail) media.dataset.originalMediaUrl = item.url;
        else delete media.dataset.originalMediaUrl;
      }
      media.dataset.thumbnailWidth = String(result.thumbnailWidth || size);
      media.dataset.thumbnailHeight = String(result.thumbnailHeight || size);
      if (item.kind === "video") media.poster = url;
      else if ((media.src !== url && media.getAttribute?.("src") !== url) || (media.complete && !media.naturalWidth)) {
        media.dataset.previewLoaded = "false";
        media.src = url;
      }
      label.dataset.ready = "true";
      if (item.kind !== "image" || media.dataset.previewLoaded === "true") label.hidden = true;
      context.actions.trimDecodedImageCache?.();
    } else if (item.kind === "image" && result.status === "unavailable") {
      showOriginal();
    }
  };
  owner.activateMediaPreview = () => {
    if (active) return;
    active = true;
    activateThumbnailImage(context, media);
    label.hidden = true;
    if (item.kind === "image" && info?.status === "ready" && media.complete && media.naturalWidth) {
      media.dataset.previewLoaded = "true";
      update(info);
      return;
    }
    statusTimer = setTimeout(() => {
      statusTimer = null;
      if (active) label.hidden = false;
    }, 600);
    if (info?.status === "ready") update(info);
    else if (item.kind === "image" && media.dataset.serverPreview !== "true"
      && !context.runtime.mediaPreviewCache?.has(previewKey)) probeOriginal();
    else subscribe();
  };
  function subscribe() {
    unsubscribe?.();
    unsubscribe = subscribeMediaPreview(context, previewKey, {
      update,
      fail(error) {
        clearTimeout(statusTimer);
        statusTimer = null;
        label.hidden = false;
        label.textContent = previewDescription(info, item, context.actions.formatMediaDuration);
        if (error.status === 404) context.actions.removeMissingMediaItem(item);
        // Media outside output/temp cannot be thumbnailed but may still load.
        else if (error.status === 400 && item.kind === "image") showOriginal();
      },
    });
  }
  owner.deactivateMediaPreview = () => {
    active = false;
    stopProbe();
    clearTimeout(retryTimer);
    retryTimer = null;
    clearTimeout(statusTimer);
    statusTimer = null;
    unsubscribe?.();
    unsubscribe = null;
    if (item.kind === "video") {
      media.pause();
      media.removeAttribute("src");
      media.removeAttribute("poster");
      media.load?.();
    } else {
      retainThumbnailImage(context, media, item, info);
    }
  };
  owner.disposeMediaPreview = () => {
    owner.deactivateMediaPreview();
    media.removeEventListener?.("load", onLoad);
    if (item.kind === "image") {
      media.removeEventListener?.("error", onError);
      retainThumbnailImage(context, media, item, info, true);
    }
  };
  label.textContent = item.filename;
  label.hidden = true;
}

export function retainedFeedImageBytes(runtime, state) {
  const images = new Set(runtime.decodedImageCache?.values() || []);
  for (const image of runtime.thumbnailImageCache?.keys() || []) images.add(image);
  for (const view of state.views || []) {
    for (const collection of [view.cards, view.cardCache]) {
      for (const card of collection?.values() || []) {
        for (const image of card.querySelectorAll("img, video")) images.add(image);
      }
    }
  }
  let total = 0;
  for (const image of images) total += estimatedImageBytes(image);
  return total;
}
