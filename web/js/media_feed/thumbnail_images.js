import { FEED_IMAGE_MEMORY_BUDGET } from "./constants.js";

const THUMBNAIL_IMAGE_CACHE_SIZE = 128;

export function estimatedImageBytes(element) {
  if (element?.tagName === "VIDEO") {
    return element.getAttribute("poster")
      ? (Number(element.dataset.thumbnailWidth) || 0) * (Number(element.dataset.thumbnailHeight) || 0) * 4
      : 0;
  }
  return Math.max(0, Number(element?.naturalWidth) || 0) * Math.max(0, Number(element?.naturalHeight) || 0) * 4;
}

export function cachedImageBytes(runtime) {
  const images = new Set(runtime.decodedImageCache?.values() || []);
  for (const image of runtime.thumbnailImageCache?.keys() || []) images.add(image);
  let total = 0;
  for (const image of images) total += estimatedImageBytes(image);
  return total;
}

function releaseImage(context, image) {
  activateThumbnailImage(context, image);
  for (const [url, cached] of context.runtime.decodedImageCache || []) {
    if (cached === image) context.runtime.decodedImageCache.delete(url);
  }
  image.mediaFeedPreviewInfo = null;
  image.dataset.previewLoaded = "false";
  image.removeAttribute("src");
}

export function activateThumbnailImage(context, image) {
  const entry = context.runtime.thumbnailImageCache?.get(image);
  if (entry) image.removeEventListener?.("load", entry.onLoad);
  context.runtime.thumbnailImageCache?.delete(image);
}

export function trimThumbnailImageCache(context) {
  if (context.runtime.transferringThumbnailImages) return;
  const cache = context.runtime.thumbnailImageCache;
  while (cache?.size && (cache.size > THUMBNAIL_IMAGE_CACHE_SIZE
    || cachedImageBytes(context.runtime) > FEED_IMAGE_MEMORY_BUDGET)) {
    releaseImage(context, cache.keys().next().value);
  }
}

export function retainThumbnailImage(context, image, item, info, reusable = false) {
  const cache = context.runtime.thumbnailImageCache ||= new Map();
  const previous = cache.get(image);
  image.mediaFeedPreviewInfo = info;
  // Disposing a cached card makes its image available to another layout,
  // without promoting an old offscreen image ahead of recently visible ones.
  if (previous && reusable) previous.reusable = true;
  else {
    activateThumbnailImage(context, image);
    const onLoad = () => {
      if (context.actions.trimDecodedImageCache) context.actions.trimDecodedImageCache();
      else trimThumbnailImageCache(context);
    };
    cache.set(image, { url: item.url, id: item.id || item.key || item.url, reusable, onLoad });
    image.addEventListener("load", onLoad);
  }
  if (context.runtime.transferringThumbnailImages) return;
  if (context.actions.trimDecodedImageCache) context.actions.trimDecodedImageCache();
  else trimThumbnailImageCache(context);
}

export function takeThumbnailImage(context, item) {
  const id = item.id || item.key || item.url;
  for (const [image, entry] of context.runtime.thumbnailImageCache || []) {
    if (entry.reusable && entry.url === item.url && entry.id === id) {
      activateThumbnailImage(context, image);
      return image;
    }
  }
  return null;
}

export function clearThumbnailImages(context, url = null) {
  for (const [image, entry] of context.runtime.thumbnailImageCache || []) {
    if (url === null || entry.url === url) releaseImage(context, image);
  }
}
