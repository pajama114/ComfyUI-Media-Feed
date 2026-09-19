import {
  VIEWER_IMAGE_DOUBLE_CLICK_ZOOM,
  VIEWER_IMAGE_MIN_ZOOM,
  VIEWER_IMAGE_MAX_ZOOM,
  VIEWER_IMAGE_DRAG_THRESHOLD,
  VIEWER_VIDEO_SINGLE_CLICK_DELAY_MS,
} from "./constants.js";
import { isBatchPresentation } from "./batch_entries.js";

export function installViewerZoom(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const setScaleViewerMedia = (...args) => actions.setScaleViewerMedia(...args);
  const setViewerBatchSelectionVisible = (...args) => actions.setViewerBatchSelectionVisible?.(...args);
  const closeViewer = (...args) => actions.closeViewer(...args);
  const isBatchGrid = (element) => Boolean(element?.classList?.contains("cmf-viewer-batch-grid"));
  const isVideoControlPointer = (event, video) => {
    const rect = video?.getBoundingClientRect?.();
    return Boolean(rect && event.clientY >= rect.bottom - 48);
  };
  function getViewerImage() {
    const image = runtime.viewer?.media?.querySelector("img.cmf-zoomable-image");
    return image instanceof HTMLImageElement && image.dataset.mediaItemKey === runtime.viewer?.item?.key ? image : null;
  }
  
  function getViewerScalableMedia() {
    if (isBatchPresentation(runtime.viewer?.entry)) {
      const grid = runtime.viewer.media?.querySelector(".cmf-zoomable-batch");
      return grid instanceof HTMLElement && grid.dataset.mediaItemKey === runtime.viewer.entry.key ? grid : null;
    }
    const element = runtime.viewer?.media?.querySelector(
      "img.cmf-zoomable-image, video.cmf-zoomable-video",
    );
    return element instanceof HTMLElement && element.dataset.mediaItemKey === runtime.viewer?.item?.key ? element : null;
  }
  
  function clampViewerImageZoom(value) {
    return Math.min(VIEWER_IMAGE_MAX_ZOOM, Math.max(VIEWER_IMAGE_MIN_ZOOM, value));
  }
  
  function viewerImagePanBounds(image) {
    const frame = runtime.viewer?.media?.getBoundingClientRect();
    if (!frame?.width || !frame.height || !image?.offsetWidth || !image.offsetHeight) {
      return { x: 0, y: 0 };
    }
  
    return {
      x: Math.max(0, (image.offsetWidth * runtime.viewer.imageZoom - frame.width) / 2),
      y: Math.max(0, (image.offsetHeight * runtime.viewer.imageZoom - frame.height) / 2),
    };
  }
  
  function constrainViewerImagePan(image) {
    const bounds = viewerImagePanBounds(image);
    runtime.viewer.imagePanX = Math.min(bounds.x, Math.max(-bounds.x, runtime.viewer.imagePanX));
    runtime.viewer.imagePanY = Math.min(bounds.y, Math.max(-bounds.y, runtime.viewer.imagePanY));
    return bounds;
  }
  
  function canPanViewerImage(bounds) {
    if (!runtime.viewer) return false;
    const isFitAtBaseZoom = runtime.viewer.imageBaseMode === "fit" && runtime.viewer.imageZoom <= 1.001;
    return !isFitAtBaseZoom && (bounds.x > 0 || bounds.y > 0);
  }
  
  function updateViewerImageControls(media = getViewerScalableMedia(), displayScale) {
    if (!runtime.viewer) return;
    const batch = isBatchPresentation(runtime.viewer.entry);
    const isScalableItem = batch || runtime.viewer.item?.kind === "image" || runtime.viewer.item?.kind === "video";
    // Keep the controls visually stable while the next image or video is
    // decoding. The previous scalable element remains mounted until the new
    // one is ready, even though its item key no longer matches the viewer.
    const displayedScalableMedia = runtime.viewer.media?.querySelector(
      "img.cmf-zoomable-image, video.cmf-zoomable-video, .cmf-zoomable-batch",
    );
    const hasMedia = Boolean(media || displayedScalableMedia);
    runtime.viewer.zoomControls.hidden = !isScalableItem;
    if (!isScalableItem) return;

    runtime.viewer.nativeButton.hidden = batch;
  
    const isBaseZoom = Math.abs(runtime.viewer.imageZoom - 1) < 0.001;
    runtime.viewer.fitButton.setAttribute("aria-pressed", String(runtime.viewer.imageBaseMode === "fit" && isBaseZoom));
    runtime.viewer.nativeButton.setAttribute("aria-pressed", String(runtime.viewer.imageBaseMode === "native" && isBaseZoom));
    runtime.viewer.fitButton.disabled = !hasMedia;
    runtime.viewer.nativeButton.disabled = batch || !hasMedia;
    runtime.viewer.zoomOutButton.disabled = !hasMedia || runtime.viewer.imageZoom <= VIEWER_IMAGE_MIN_ZOOM + 0.001;
    runtime.viewer.zoomInButton.disabled = !hasMedia || runtime.viewer.imageZoom >= VIEWER_IMAGE_MAX_ZOOM - 0.001;
    if (media && Number.isFinite(displayScale) && displayScale > 0) {
      const percent = (batch ? runtime.viewer.imageZoom : displayScale) * 100;
      const precision = percent < 1 ? 2 : percent < 10 ? 1 : 0;
      const label = `${Number(percent.toFixed(precision))}%`;
      if (runtime.viewer.zoomLevel.textContent !== label) runtime.viewer.zoomLevel.textContent = label;
    } else if (!displayedScalableMedia && runtime.viewer.zoomLevel.textContent !== "—") {
      runtime.viewer.zoomLevel.textContent = "—";
    }
  }
  
  function updateViewerImageLayout() {
    const audio = runtime.viewer?.media?.querySelector("audio.cmf-zoomable-audio");
    if (audio instanceof HTMLAudioElement && audio.dataset.mediaItemKey === runtime.viewer?.item?.key) {
      const frame = runtime.viewer.media.getBoundingClientRect();
      if (!frame.width || !frame.height) return;
      const presentation = audio.closest?.(".cmf-viewer-audio");
      if (presentation) presentation.style.width = `${Math.min(960, frame.width * 0.9)}px`;
      audio.style.width = "100%";
      runtime.viewer.media.dataset.pannable = "false";
      runtime.viewer.media.dataset.dragging = "false";
      updateViewerImageControls(null);
      return;
    }

    const media = getViewerScalableMedia();
    if (!media || !runtime.viewer?.media) {
      updateViewerImageControls(null);
      return;
    }
  
    const frame = runtime.viewer.media.getBoundingClientRect();
    if (!frame.width || !frame.height) return;
  
    const natural = viewerMediaNaturalSize(media);
    if (!natural.width || !natural.height) return;
  
    const fitScale = Math.min(frame.width / natural.width, frame.height / natural.height);
    const baseScale = runtime.viewer.imageBaseMode === "fit" ? fitScale * state.viewerFitScale / 100 : 1;
    media.style.width = `${natural.width * baseScale}px`;
    media.style.height = `${natural.height * baseScale}px`;
  
    const bounds = constrainViewerImagePan(media);
    media.style.setProperty("--cmf-image-zoom", String(runtime.viewer.imageZoom));
    media.style.setProperty("--cmf-image-pan-x", `${runtime.viewer.imagePanX}px`);
    media.style.setProperty("--cmf-image-pan-y", `${runtime.viewer.imagePanY}px`);
    runtime.viewer.media.dataset.pannable = String(canPanViewerImage(bounds));
    runtime.viewer.media.dataset.dragging = String(Boolean(runtime.viewer.imageDrag));
    updateViewerImageControls(media, baseScale * runtime.viewer.imageZoom);
  }
  
  function resetViewerImageView(baseMode = runtime.viewer?.imageBaseMode || "native") {
    if (!runtime.viewer) return;
    runtime.viewer.imageBaseMode = isBatchPresentation(runtime.viewer.entry) || baseMode === "fit" ? "fit" : "native";
    runtime.viewer.imageZoom = 1;
    runtime.viewer.imagePanX = 0;
    runtime.viewer.imagePanY = 0;
    runtime.viewer.imageDrag = null;
    runtime.viewer.root.dataset.scaleMedia = String(runtime.viewer.imageBaseMode === "fit");
    updateViewerImageLayout();
    runtime.viewer.onViewChange?.();
  }
  
  function setViewerImageBaseMode(baseMode) {
    if (!getViewerScalableMedia()) return;
    if (isBatchPresentation(runtime.viewer.entry) && baseMode !== "fit") return;
    if (runtime.viewer.comparing || runtime.viewer.isComparisonPane || isBatchPresentation(runtime.viewer.entry)) {
      resetViewerImageView(baseMode);
      return;
    }
    const scaleMedia = baseMode === "fit";
    const settingChanged = scaleMedia !== state.scaleViewerMedia;
    setScaleViewerMedia(scaleMedia, { syncSettings: true });
    if (!settingChanged) resetViewerImageView(baseMode);
  }
  
  function setViewerImageZoom(nextZoom, origin) {
    const media = getViewerScalableMedia();
    if (!media || !runtime.viewer) return;
  
    const previousZoom = runtime.viewer.imageZoom;
    const zoom = clampViewerImageZoom(nextZoom);
    if (Math.abs(zoom - previousZoom) < 0.001) return;
  
    if (origin) {
      const frame = runtime.viewer.media.getBoundingClientRect();
      const pointX = origin.x - (frame.left + frame.width / 2) - runtime.viewer.imagePanX;
      const pointY = origin.y - (frame.top + frame.height / 2) - runtime.viewer.imagePanY;
      const ratio = zoom / previousZoom;
      runtime.viewer.imagePanX -= pointX * (ratio - 1);
      runtime.viewer.imagePanY -= pointY * (ratio - 1);
    }
  
    runtime.viewer.imageZoom = zoom;
    updateViewerImageLayout();
    runtime.viewer.onViewChange?.();
  }
  
  function handleViewerImageDoubleClick(event) {
    const target = event.currentTarget;
    const standaloneVideo = target instanceof HTMLVideoElement && !isBatchGrid(target);
    if (!runtime.viewer || event.button !== 0
      || !(target instanceof HTMLImageElement || standaloneVideo || isBatchGrid(target))) return;
    if (standaloneVideo) {
      if (isVideoControlPointer(event, target)) return;
      cancelPendingViewerVideoClick();
    } else if (isBatchGrid(target)) {
      const video = event.target?.closest?.("video");
      if (video ? isVideoControlPointer(event, video)
        : event.target?.closest?.("audio, button, input, .cmf-viewer-audio")) return;
      if (video) cancelPendingViewerVideoClick();
    }
    event.preventDefault();
    event.stopPropagation();
  
    if (Math.abs(runtime.viewer.imageZoom - 1) < 0.001) {
      setViewerImageZoom(VIEWER_IMAGE_DOUBLE_CLICK_ZOOM, { x: event.clientX, y: event.clientY });
    } else {
      resetViewerImageView();
    }
  }
  
  function handleViewerImagePointerDown(event) {
    const image = event.currentTarget;
    let pointerVideo = image instanceof HTMLVideoElement ? image : null;
    let batchAudio = null;
    if (isBatchGrid(image)) {
      pointerVideo = event.target?.closest?.("video");
      batchAudio = event.target?.closest?.(".cmf-viewer-audio");
      if (batchAudio && event.target?.closest?.("input, .cmf-viewer-audio-track, .cmf-viewer-audio-volume")) return;
    }
    if (pointerVideo && isVideoControlPointer(event, pointerVideo)) return;
    const bounds = viewerImagePanBounds(image);
    if (event.button !== 0 || !canPanViewerImage(bounds)) return;

    // Delay pointer capture over a player until movement becomes a drag.
    // Otherwise a normal click is retargeted to the grid and cannot toggle the
    // native player.
    const capturePending = Boolean(pointerVideo || batchAudio);
    if (!capturePending) {
      event.preventDefault();
      image.setPointerCapture(event.pointerId);
    }
    runtime.viewer.imageDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: runtime.viewer.imagePanX,
      panY: runtime.viewer.imagePanY,
      moved: false,
      capturePending,
    };
    if (!capturePending) updateViewerImageLayout();
  }
  
  function handleViewerImagePointerMove(event) {
    const drag = runtime.viewer?.imageDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
  
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) >= VIEWER_IMAGE_DRAG_THRESHOLD || Math.abs(deltaY) >= VIEWER_IMAGE_DRAG_THRESHOLD) {
      if (drag.capturePending) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.capturePending = false;
      }
      drag.moved = true;
    }
    if (drag.capturePending) return;
    runtime.viewer.imagePanX = drag.panX + deltaX;
    runtime.viewer.imagePanY = drag.panY + deltaY;
    updateViewerImageLayout();
    runtime.viewer.onViewChange?.();
  }
  
  function finishViewerImageDrag(event) {
    const drag = runtime.viewer?.imageDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
  
    const image = event.currentTarget;
    if (image.hasPointerCapture?.(event.pointerId)) image.releasePointerCapture(event.pointerId);
    runtime.viewer.imageDrag = null;
    if (drag.moved) {
      if (isBatchGrid(image)) runtime.viewer.suppressBatchClick = true;
      else runtime.viewer.suppressImageClick = true;
      window.setTimeout(() => {
        if (!runtime.viewer) return;
        runtime.viewer.suppressImageClick = false;
        runtime.viewer.suppressBatchClick = false;
      }, 0);
    }
    updateViewerImageLayout();
  }

  function cancelPendingViewerVideoClick() {
    const pending = runtime.viewer?.pendingViewerVideoClick;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    runtime.viewer.pendingViewerVideoClick = null;
  }

  function toggleViewerVideoPlayback(video) {
    if (video.paused) {
      video.play()?.catch?.(() => {});
    } else {
      video.pause();
    }
  }

  function handleViewerVideoClick(event) {
    const standaloneVideo = event.currentTarget instanceof HTMLVideoElement
      ? event.currentTarget : null;
    const suppressionKey = standaloneVideo ? "suppressImageClick" : "suppressBatchClick";
    if (runtime.viewer?.[suppressionKey]) {
      runtime.viewer[suppressionKey] = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const video = standaloneVideo || event.target?.closest?.("video");
    if (event.button !== 0 || !video || isVideoControlPointer(event, video)) return;
    event.preventDefault();
    event.stopPropagation();
    cancelPendingViewerVideoClick();
    if (event.detail > 1) return;

    const pending = {};
    pending.timer = window.setTimeout(() => {
      if (runtime.viewer?.pendingViewerVideoClick !== pending) return;
      runtime.viewer.pendingViewerVideoClick = null;
      if (video.isConnected === false) return;
      toggleViewerVideoPlayback(video);
    }, VIEWER_VIDEO_SINGLE_CLICK_DELAY_MS);
    runtime.viewer.pendingViewerVideoClick = pending;
  }
  
  function prepareViewerImage(image) {
    const batch = isBatchGrid(image);
    image.classList.add(batch ? "cmf-zoomable-batch" : image instanceof HTMLVideoElement ? "cmf-zoomable-video" : "cmf-zoomable-image");
    if (batch || image instanceof HTMLImageElement || image instanceof HTMLVideoElement) {
      // Handle standalone videos during capture so their native double-click
      // fullscreen action can be cancelled before applying viewer zoom.
      image.addEventListener("dblclick", handleViewerImageDoubleClick, image instanceof HTMLVideoElement);
    }
    image.addEventListener("pointerdown", handleViewerImagePointerDown);
    image.addEventListener("pointermove", handleViewerImagePointerMove);
    image.addEventListener("pointerup", finishViewerImageDrag);
    image.addEventListener("pointercancel", finishViewerImageDrag);
    if (batch || image instanceof HTMLVideoElement) {
      image.addEventListener("click", handleViewerVideoClick, true);
    }
    image.addEventListener("dragstart", (event) => event.preventDefault());
  }
  
  function viewerMediaNaturalSize(element) {
    if (isBatchGrid(element)) {
      return {
        width: Number(element.dataset.naturalWidth) || 0,
        height: Number(element.dataset.naturalHeight) || 0,
      };
    }
    if (element instanceof HTMLImageElement) {
      return { width: element.naturalWidth, height: element.naturalHeight };
    }
  
    if (element instanceof HTMLVideoElement) {
      return { width: element.videoWidth, height: element.videoHeight };
    }
  
    return { width: 0, height: 0 };
  }
  
  function isInsideContainedMedia(event, element) {
    const rect = element.getBoundingClientRect();
    const natural = viewerMediaNaturalSize(element);
    if (!rect.width || !rect.height || !natural.width || !natural.height) return true;
  
    const scale = Math.min(rect.width / natural.width, rect.height / natural.height);
    const width = natural.width * scale;
    const height = natural.height * scale;
    const left = rect.left + (rect.width - width) / 2;
    const top = rect.top + (rect.height - height) / 2;
    const right = left + width;
    const bottom = top + height;
    const tolerance = 1;
  
    return event.clientX >= left - tolerance
      && event.clientX <= right + tolerance
      && event.clientY >= top - tolerance
      && event.clientY <= bottom + tolerance;
  }
  
  function handleViewerBackdropClick(event) {
    if (runtime.viewer?.suppressImageClick && event.target instanceof HTMLImageElement) {
      runtime.viewer.suppressImageClick = false;
      return;
    }

    if (!event.target?.closest?.(".cmf-viewer-batch-cell")) {
      setViewerBatchSelectionVisible(false);
      if (runtime.viewer?.reference) setViewerBatchSelectionVisible(false, runtime.viewer.reference);
    }
  
    if (event.target === runtime.viewer?.root || event.target === runtime.viewer?.body || event.target === runtime.viewer?.main || event.target === runtime.viewer?.media
      || event.target?.classList?.contains("cmf-viewer-pane")
      || event.target?.classList?.contains("cmf-viewer-media-stage")
      || event.target?.classList?.contains("cmf-viewer-media")) {
      closeViewer();
      return;
    }

    if (event.target?.closest?.(".cmf-viewer-batch-grid")) return;
  
    if (!state.scaleViewerMedia || !runtime.viewer?.media) return;
  
    const element = event.target instanceof Element
      ? event.target.closest(".cmf-viewer-media img, .cmf-viewer-media video")
      : null;
    if (!element || !event.target.closest(".cmf-viewer-pane")?.contains(element)) return;
  
    if (element instanceof HTMLImageElement && element.classList.contains("cmf-zoomable-image")) return;
  
    if (element instanceof HTMLVideoElement && element.controls) {
      const rect = element.getBoundingClientRect();
      if (event.clientY >= rect.bottom - 48) return;
    }
  
    if (!isInsideContainedMedia(event, element)) closeViewer();
  }
  
  Object.assign(actions, {
    getViewerImage,
    getViewerScalableMedia,
    clampViewerImageZoom,
    viewerImagePanBounds,
    constrainViewerImagePan,
    canPanViewerImage,
    updateViewerImageControls,
    updateViewerImageLayout,
    resetViewerImageView,
    setViewerImageBaseMode,
    setViewerImageZoom,
    handleViewerImageDoubleClick,
    handleViewerImagePointerDown,
    handleViewerImagePointerMove,
    finishViewerImageDrag,
    handleViewerVideoClick,
    prepareViewerImage,
    viewerMediaNaturalSize,
    isInsideContainedMedia,
    handleViewerBackdropClick,
  });
}
