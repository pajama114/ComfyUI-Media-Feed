import {
  VIEWER_IMAGE_DOUBLE_CLICK_ZOOM,
  VIEWER_IMAGE_MIN_ZOOM,
  VIEWER_IMAGE_MAX_ZOOM,
  VIEWER_IMAGE_DRAG_THRESHOLD,
} from "./constants.js";

export function installViewerZoom(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const setScaleViewerMedia = (...args) => actions.setScaleViewerMedia(...args);
  const closeViewer = (...args) => actions.closeViewer(...args);
  function getViewerImage() {
    const image = runtime.viewer?.media?.querySelector("img.cmf-zoomable-image");
    return image instanceof HTMLImageElement && image.dataset.mediaItemKey === runtime.viewer?.item?.key ? image : null;
  }
  
  function getViewerScalableMedia() {
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
  
  function updateViewerImageControls(media = getViewerScalableMedia()) {
    if (!runtime.viewer) return;
    const isScalableItem = runtime.viewer.item?.kind === "image" || runtime.viewer.item?.kind === "video";
    const hasMedia = Boolean(media);
    runtime.viewer.zoomControls.hidden = !isScalableItem;
    if (!isScalableItem) return;
  
    const isBaseZoom = Math.abs(runtime.viewer.imageZoom - 1) < 0.001;
    runtime.viewer.fitButton.setAttribute("aria-pressed", String(runtime.viewer.imageBaseMode === "fit" && isBaseZoom));
    runtime.viewer.nativeButton.setAttribute("aria-pressed", String(runtime.viewer.imageBaseMode === "native" && isBaseZoom));
    runtime.viewer.fitButton.disabled = !hasMedia;
    runtime.viewer.nativeButton.disabled = !hasMedia;
    runtime.viewer.zoomOutButton.disabled = !hasMedia || runtime.viewer.imageZoom <= VIEWER_IMAGE_MIN_ZOOM + 0.001;
    runtime.viewer.zoomInButton.disabled = !hasMedia || runtime.viewer.imageZoom >= VIEWER_IMAGE_MAX_ZOOM - 0.001;
    runtime.viewer.zoomLevel.textContent = runtime.viewer.imageBaseMode === "fit" && isBaseZoom
      ? "Fit"
      : `${Math.round(runtime.viewer.imageZoom * 100)}%`;
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
    const baseScale = runtime.viewer.imageBaseMode === "fit" ? fitScale : 1;
    const layoutZoom = media instanceof HTMLVideoElement ? runtime.viewer.imageZoom : 1;
    media.style.width = `${natural.width * baseScale * layoutZoom}px`;
    media.style.height = `${natural.height * baseScale * layoutZoom}px`;
  
    if (media instanceof HTMLVideoElement) {
      runtime.viewer.media.dataset.pannable = "false";
      runtime.viewer.media.dataset.dragging = "false";
      updateViewerImageControls(media);
      return;
    }
  
    const image = media;
    const bounds = constrainViewerImagePan(image);
    image.style.setProperty("--cmf-image-zoom", String(runtime.viewer.imageZoom));
    image.style.setProperty("--cmf-image-pan-x", `${runtime.viewer.imagePanX}px`);
    image.style.setProperty("--cmf-image-pan-y", `${runtime.viewer.imagePanY}px`);
    runtime.viewer.media.dataset.pannable = String(canPanViewerImage(bounds));
    runtime.viewer.media.dataset.dragging = String(Boolean(runtime.viewer.imageDrag));
    updateViewerImageControls(image);
  }
  
  function resetViewerImageView(baseMode = runtime.viewer?.imageBaseMode || "native") {
    if (!runtime.viewer) return;
    runtime.viewer.imageBaseMode = baseMode === "fit" ? "fit" : "native";
    runtime.viewer.imageZoom = 1;
    runtime.viewer.imagePanX = 0;
    runtime.viewer.imagePanY = 0;
    runtime.viewer.imageDrag = null;
    runtime.viewer.root.dataset.scaleMedia = String(runtime.viewer.imageBaseMode === "fit");
    updateViewerImageLayout();
  }
  
  function setViewerImageBaseMode(baseMode) {
    if (!getViewerScalableMedia()) return;
    const scaleMedia = baseMode === "fit";
    const settingChanged = scaleMedia !== state.scaleViewerMedia;
    setScaleViewerMedia(scaleMedia, { syncSettings: true });
    if (!settingChanged) resetViewerImageView(baseMode);
  }
  
  function setViewerImageZoom(nextZoom, origin) {
    const media = getViewerScalableMedia();
    const image = getViewerImage();
    if (!media || !runtime.viewer) return;
  
    const previousZoom = runtime.viewer.imageZoom;
    const zoom = clampViewerImageZoom(nextZoom);
    if (Math.abs(zoom - previousZoom) < 0.001) return;
  
    if (origin && image) {
      const frame = runtime.viewer.media.getBoundingClientRect();
      const pointX = origin.x - (frame.left + frame.width / 2) - runtime.viewer.imagePanX;
      const pointY = origin.y - (frame.top + frame.height / 2) - runtime.viewer.imagePanY;
      const ratio = zoom / previousZoom;
      runtime.viewer.imagePanX -= pointX * (ratio - 1);
      runtime.viewer.imagePanY -= pointY * (ratio - 1);
    }
  
    runtime.viewer.imageZoom = zoom;
    updateViewerImageLayout();
  }
  
  function handleViewerImageDoubleClick(event) {
    if (!runtime.viewer || event.button !== 0) return;
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
    const bounds = viewerImagePanBounds(image);
    if (event.button !== 0 || !canPanViewerImage(bounds)) return;
  
    event.preventDefault();
    image.setPointerCapture(event.pointerId);
    runtime.viewer.imageDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: runtime.viewer.imagePanX,
      panY: runtime.viewer.imagePanY,
      moved: false,
    };
    updateViewerImageLayout();
  }
  
  function handleViewerImagePointerMove(event) {
    const drag = runtime.viewer?.imageDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
  
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) >= VIEWER_IMAGE_DRAG_THRESHOLD || Math.abs(deltaY) >= VIEWER_IMAGE_DRAG_THRESHOLD) {
      drag.moved = true;
    }
    runtime.viewer.imagePanX = drag.panX + deltaX;
    runtime.viewer.imagePanY = drag.panY + deltaY;
    updateViewerImageLayout();
  }
  
  function finishViewerImageDrag(event) {
    const drag = runtime.viewer?.imageDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
  
    const image = event.currentTarget;
    if (image.hasPointerCapture?.(event.pointerId)) image.releasePointerCapture(event.pointerId);
    runtime.viewer.imageDrag = null;
    if (drag.moved) {
      runtime.viewer.suppressImageClick = true;
      window.setTimeout(() => {
        if (runtime.viewer) runtime.viewer.suppressImageClick = false;
      }, 0);
    }
    updateViewerImageLayout();
  }
  
  function prepareViewerImage(image) {
    image.classList.add("cmf-zoomable-image");
    image.addEventListener("dblclick", handleViewerImageDoubleClick);
    image.addEventListener("pointerdown", handleViewerImagePointerDown);
    image.addEventListener("pointermove", handleViewerImagePointerMove);
    image.addEventListener("pointerup", finishViewerImageDrag);
    image.addEventListener("pointercancel", finishViewerImageDrag);
    image.addEventListener("dragstart", (event) => event.preventDefault());
  }
  
  function viewerMediaNaturalSize(element) {
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
  
    if (event.target === runtime.viewer?.root || event.target === runtime.viewer?.body || event.target === runtime.viewer?.main || event.target === runtime.viewer?.media) {
      closeViewer();
      return;
    }
  
    if (!state.scaleViewerMedia || !runtime.viewer?.media) return;
  
    const element = event.target instanceof Element
      ? event.target.closest(".cmf-viewer-media img, .cmf-viewer-media video")
      : null;
    if (!element || !runtime.viewer.media.contains(element)) return;
  
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
    prepareViewerImage,
    viewerMediaNaturalSize,
    isInsideContainedMedia,
    handleViewerBackdropClick,
  });
}
