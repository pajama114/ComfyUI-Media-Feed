import { FEED_IMAGE_MEMORY_BUDGET } from "./constants.js";

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
        cache.set(url, info);
        while (cache.size > PREVIEW_CACHE_SIZE) cache.delete(cache.keys().next().value);
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
    clearTimeout(job.timer);
    job.controller?.abort();
    if (jobs.get(url) === job) jobs.delete(url);
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
  let info = null;
  let retryTimer = null;
  let statusTimer = null;
  // Account for overscan and the four images in a batch card before loading.
  const views = [...(context.state.views || [])];
  const slots = views.reduce((total, view) => total + Math.ceil(
    Math.max(view.viewport?.clientWidth || 0, view.viewport?.clientHeight || 0)
      / Math.max(96, Math.min(context.state.itemWidth || 143, context.state.itemHeight || 143)),
  ) + 12, 0) || 26;
  const size = Math.max(128, Math.min(512, 2 ** Math.floor(Math.log2(
    Math.sqrt(FEED_IMAGE_MEMORY_BUDGET / (slots * (context.state.batchMode ? 4 : 1) * 4)),
  ))));
  const requestUrl = new URL(item.url, globalThis.location?.href || "http://localhost/");
  requestUrl.searchParams.set("preview_size", String(size));
  const previewKey = requestUrl.href;
  media.dataset.originalMediaUrl = item.url;
  media.addEventListener("load", () => context.actions.trimDecodedImageCache?.());
  if (item.kind === "image") media.addEventListener("error", () => {
    label.dataset.ready = "false";
    label.hidden = false;
    clearTimeout(statusTimer);
    statusTimer = null;
    info = null;
    context.runtime.mediaPreviewCache?.delete(previewKey);
    unsubscribe?.();
    unsubscribe = null;
    if (active && !retryTimer) retryTimer = setTimeout(() => {
      retryTimer = null;
      active = false;
      owner.activateMediaPreview();
    }, 5000);
  });
  const update = (result) => {
    info = result;
    label.textContent = previewDescription(result, item, context.actions.formatMediaDuration);
    label.title = label.textContent;
    label.hidden = result.status === "pending" && statusTimer !== null;
    if (result.status !== "pending") {
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
    if (result.status === "ready" && result.thumbnail) {
      const url = mediaPreviewUrl(context, previewKey, "thumbnail", result.version);
      media.dataset.thumbnailWidth = String(result.thumbnailWidth || size);
      media.dataset.thumbnailHeight = String(result.thumbnailHeight || size);
      if (item.kind === "video") media.poster = url;
      else if (media.src !== url && media.getAttribute?.("src") !== url) media.src = url;
      label.dataset.ready = "true";
      label.hidden = true;
      context.actions.trimDecodedImageCache?.();
    }
  };
  owner.activateMediaPreview = () => {
    if (active) return;
    active = true;
    if (info?.status === "ready") update(info);
    else {
      label.hidden = true;
      statusTimer = setTimeout(() => {
        statusTimer = null;
        if (active) label.hidden = false;
      }, 600);
      unsubscribe = subscribeMediaPreview(context, previewKey, {
        update,
        fail(error) {
          clearTimeout(statusTimer);
          statusTimer = null;
          label.hidden = false;
          label.textContent = previewDescription(info, item, context.actions.formatMediaDuration);
          if (error.status === 404) context.actions.removeMissingMediaItem(item);
        },
      });
    }
  };
  owner.deactivateMediaPreview = () => {
    active = false;
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
      media.removeAttribute("src");
    }
  };
  label.textContent = item.filename;
  label.hidden = true;
}

export function estimatedImageBytes(element) {
  if (element?.tagName === "VIDEO") {
    return element.getAttribute("poster")
      ? (Number(element.dataset.thumbnailWidth) || 0) * (Number(element.dataset.thumbnailHeight) || 0) * 4
      : 0;
  }
  return Math.max(0, Number(element?.naturalWidth) || 0) * Math.max(0, Number(element?.naturalHeight) || 0) * 4;
}

export function retainedFeedImageBytes(runtime, state) {
  const images = new Set(runtime.decodedImageCache?.values() || []);
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
