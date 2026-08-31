import {
  MAX_ITEMS,
  DECODED_IMAGE_CACHE_SIZE,
} from "./constants.js";

export function installViewerSupport(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const viewerMediaNaturalSize = (...args) => actions.viewerMediaNaturalSize(...args);
  function rememberDecodedImage(url, image) {
    if (!url || !image?.complete) return;
    if (!image.naturalWidth && !image.naturalHeight) return;
    runtime.decodedImageCache.delete(url);
    runtime.decodedImageCache.set(url, image);
  
    while (runtime.decodedImageCache.size > DECODED_IMAGE_CACHE_SIZE) {
      const oldestKey = runtime.decodedImageCache.keys().next().value;
      runtime.decodedImageCache.delete(oldestKey);
    }
  }
  
  function rememberMediaDimensions(item, element) {
    if (!item?.key) return;
  
    const size = viewerMediaNaturalSize(element);
    if (!size.width || !size.height) return;
  
    runtime.mediaDimensionCache.delete(item.key);
    runtime.mediaDimensionCache.set(item.key, size);
  
    while (runtime.mediaDimensionCache.size > MAX_ITEMS) {
      const oldestKey = runtime.mediaDimensionCache.keys().next().value;
      runtime.mediaDimensionCache.delete(oldestKey);
    }
  }
  
  function discardStagedMedia(element) {
    if (!(element instanceof HTMLMediaElement)) return;
    element.pause();
    element.removeAttribute("src");
    element.load();
  }
  
  function waitForMediaReady(element) {
    if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  
    return new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve();
      };
      const timeoutId = window.setTimeout(settle, 2500);
  
      element.addEventListener("loadeddata", settle, { once: true });
      element.addEventListener("canplay", settle, { once: true });
      element.addEventListener("error", settle, { once: true });
    });
  }
  
  function replaceViewerMedia(currentViewer, nextMedia) {
    const previousMedia = currentViewer.media.querySelector("video, audio");
    currentViewer.media.replaceChildren(nextMedia);
    previousMedia?.pause();
    const playbackMedia = nextMedia.matches?.("video, audio")
      ? nextMedia
      : nextMedia.querySelector?.("video, audio");
    if (!playbackMedia) return;
    playbackMedia.muted = false;
    playbackMedia.play().catch(() => {});
  }
  
  function waitForImageReady(image) {
    if (image.complete) return Promise.resolve();
  
    return new Promise((resolve) => {
      const settle = () => resolve();
      image.addEventListener("load", settle, { once: true });
      image.addEventListener("error", settle, { once: true });
    });
  }
  
  async function decodeImageElement(image) {
    await waitForImageReady(image);
    try {
      await image.decode?.();
    } catch {
      // The image element should still be shown so the browser can expose errors.
    }
  }
  
  function isCurrentViewerRender(currentViewer, requestId, item) {
    return runtime.viewer === currentViewer
      && currentViewer.root.dataset.open === "true"
      && currentViewer.renderRequestId === requestId
      && currentViewer.item?.key === item.key;
  }
  
  function showCopyFeedback(button) {
    const previousFeedback = runtime.copyFeedbackTimers.get(button);
    if (previousFeedback) window.clearTimeout(previousFeedback.timeoutId);
  
    const title = previousFeedback?.title ?? button.title;
    const ariaLabel = previousFeedback?.ariaLabel ?? button.getAttribute("aria-label");
    button.title = "Copied";
    button.setAttribute("aria-label", "Copied");
    button.classList.remove("cmf-copy-success");
    void button.offsetWidth;
    button.classList.add("cmf-copy-success");
  
    const timeoutId = window.setTimeout(() => {
      button.classList.remove("cmf-copy-success");
      button.title = title;
      if (ariaLabel === null) {
        button.removeAttribute("aria-label");
      } else {
        button.setAttribute("aria-label", ariaLabel);
      }
      runtime.copyFeedbackTimers.delete(button);
    }, 1200);
    runtime.copyFeedbackTimers.set(button, { timeoutId, title, ariaLabel });
  }
  
  async function copyPromptText(event, source) {
    const button = event.currentTarget;
    button.blur();
  
    const text = typeof source === "string" ? source : String(source?.textContent || "");
    if (!text.trim()) return;
  
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        try {
          document.body.appendChild(textarea);
          textarea.select();
          if (!document.execCommand("copy")) throw new Error("Clipboard copy failed");
        } finally {
          textarea.remove();
        }
      }
    } catch {
      return;
    }
  
    showCopyFeedback(button);
  }
  
  function formatAllViewerMetadata(result, details) {
    const sections = [];
    const appendSection = (heading, values) => {
      const lines = values.filter((value) => String(value || "").trim());
      if (lines.length) sections.push(`${heading}:\n${lines.join("\n")}`);
    };
  
    appendSection(
      "Resources",
      (Array.isArray(result?.resources) ? result.resources : [])
        .map((entry) => `${entry.label}: ${entry.value}`),
    );
    appendSection("Prompt", [result?.positive]);
    appendSection("Negative Prompt", [result?.negative]);
    appendSection("Seed", [result?.seed]);
    appendSection(
      "Other Metadata",
      (Array.isArray(details) ? details : [])
        .filter((entry) => String(entry?.label || "").toLowerCase() !== "seed")
        .map((entry) => `${entry.label}: ${entry.value}`),
    );
  
    return sections.join("\n\n");
  }
  
  function copyAllViewerMetadata(event) {
    const text = formatAllViewerMetadata(runtime.viewer?.lastPromptMetadata, runtime.viewer?.lastMetadataDetails);
    return copyPromptText(event, text);
  }
  
  function formatMetadataEntriesForCopy(entries, options = {}) {
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => !options.skipSeed || String(entry?.label || "").toLowerCase() !== "seed")
      .map((entry) => `${entry?.label || ""}: ${entry?.value || ""}`)
      .filter((line) => line !== ": ")
      .join("\n");
  }
  
  function copyViewerResources(event) {
    return copyPromptText(event, formatMetadataEntriesForCopy(runtime.viewer?.lastPromptMetadata?.resources));
  }
  
  function copyViewerOtherMetadata(event) {
    return copyPromptText(event, formatMetadataEntriesForCopy(runtime.viewer?.lastMetadataDetails, { skipSeed: true }));
  }
  
  function metadataDownloadFilename(filename) {
    const basename = String(filename || "metadata")
      .replace(/\.[^./\\]+$/, "")
      .replace(/[^\p{L}\p{N}._-]+/gu, "_")
      .replace(/^_+|_+$/g, "");
    return `${basename || "metadata"}-metadata.json`;
  }

  function mediaDownloadFilename(filename) {
    return String(filename || "media")
      .split(/[\\/]/)
      .pop()
      .replace(/[<>:"|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "") || "media";
  }

  function startBrowserDownload(item) {
    const link = document.createElement("a");
    link.href = item.url;
    link.download = mediaDownloadFilename(item.filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function imageBlobAsPng(blob) {
    if (String(blob?.type || "").toLowerCase() === "image/png") return blob;

    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) throw new Error("Could not create an image canvas");
      canvasContext.drawImage(bitmap, 0, 0);

      return await new Promise((resolve, reject) => {
        canvas.toBlob((pngBlob) => {
          if (pngBlob) {
            resolve(pngBlob);
          } else {
            reject(new Error("Could not encode the image as PNG"));
          }
        }, "image/png");
      });
    } finally {
      bitmap.close?.();
    }
  }

  async function loadViewerImageClipboardBlob(item) {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(`Could not load image (${response.status})`);
    return imageBlobAsPng(await response.blob());
  }

  async function copyViewerImage(event) {
    const button = event.currentTarget;
    button.blur();

    const item = runtime.viewer?.item;
    if (item?.kind !== "image" || !item.url) return;
    if (typeof navigator.clipboard?.write !== "function" || typeof ClipboardItem !== "function") {
      console.error("[ComfyUI Media Feed] Image clipboard copying is not supported by this browser");
      return;
    }

    button.disabled = true;
    try {
      // Start the clipboard write while the click's user activation is still available.
      const pngBlob = loadViewerImageClipboardBlob(item);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": pngBlob }),
      ]);
      showCopyFeedback(button);
    } catch (error) {
      console.error("[ComfyUI Media Feed] Could not copy image", error);
    } finally {
      button.disabled = false;
    }
  }

  async function downloadViewerMedia(event) {
    const button = event.currentTarget;
    button.blur();

    const item = runtime.viewer?.item;
    if (!item?.url) return;

    if (typeof window.showSaveFilePicker !== "function") {
      startBrowserDownload(item);
      return;
    }

    let fileHandle;
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: mediaDownloadFilename(item.filename),
      });
    } catch (error) {
      if (error?.name !== "AbortError") startBrowserDownload(item);
      return;
    }

    button.disabled = true;
    try {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error(`Could not download media (${response.status})`);

      const writable = await fileHandle.createWritable();
      if (response.body) {
        await response.body.pipeTo(writable);
      } else {
        await writable.write(await response.blob());
        await writable.close();
      }
    } catch (error) {
      console.error("[ComfyUI Media Feed] Could not download media", error);
    } finally {
      button.disabled = false;
    }
  }
  
  function downloadViewerEmbeddedJson(event) {
    const button = event.currentTarget;
    button.blur();
  
    const embeddedJson = runtime.viewer?.lastPromptMetadata?.embeddedJson;
    if (!embeddedJson || !Object.keys(embeddedJson).length) return;
  
    let json;
    try {
      json = JSON.stringify(embeddedJson, null, 2);
    } catch {
      return;
    }
  
    const url = URL.createObjectURL(new Blob([`${json}\n`], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = metadataDownloadFilename(runtime.viewer?.item?.filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  
  Object.assign(actions, {
    rememberDecodedImage,
    rememberMediaDimensions,
    discardStagedMedia,
    waitForMediaReady,
    replaceViewerMedia,
    waitForImageReady,
    decodeImageElement,
    isCurrentViewerRender,
    showCopyFeedback,
    copyPromptText,
    formatAllViewerMetadata,
    copyAllViewerMetadata,
    formatMetadataEntriesForCopy,
    copyViewerResources,
    copyViewerOtherMetadata,
    metadataDownloadFilename,
    mediaDownloadFilename,
    startBrowserDownload,
    imageBlobAsPng,
    loadViewerImageClipboardBlob,
    copyViewerImage,
    downloadViewerMedia,
    downloadViewerEmbeddedJson,
  });
}
