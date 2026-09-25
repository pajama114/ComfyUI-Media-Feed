import { VIEWER_IMAGE_DRAG_THRESHOLD } from "./constants.js";
import { isBatchPresentation } from "./batch_entries.js";

export function installViewerRender(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const syncFavoriteButton = (...args) => actions.syncFavoriteButton(...args);
  const rememberDecodedImage = (...args) => actions.rememberDecodedImage(...args);
  const rememberMediaDimensions = (...args) => actions.rememberMediaDimensions(...args);
  const discardStagedMedia = (...args) => actions.discardStagedMedia(...args);
  const waitForMediaReady = (...args) => actions.waitForMediaReady(...args);
  const replaceViewerMedia = (...args) => actions.replaceViewerMedia(...args);
  const decodeImageElement = (...args) => actions.decodeImageElement(...args);
  const isCurrentViewerRender = (...args) => actions.isCurrentViewerRender(...args);
  const ensureViewer = (...args) => actions.ensureViewer(...args);
  const syncViewerNav = (...args) => actions.syncViewerNav(...args);
  const updateViewerImageLayout = (...args) => actions.updateViewerImageLayout(...args);
  const resetViewerImageView = (...args) => actions.resetViewerImageView(...args);
  const prepareViewerImage = (...args) => actions.prepareViewerImage(...args);
  const refreshViewerPromptPanelDetails = (...args) => actions.refreshViewerPromptPanelDetails(...args);
  const clearViewerAudioWaveform = (...args) => actions.clearViewerAudioWaveform(...args);
  const createViewerAudioPresentation = (...args) => actions.createViewerAudioPresentation(...args);
  const setupViewerAudioWaveform = (...args) => actions.setupViewerAudioWaveform(...args);

  function setViewerBatchSelectionVisible(visible, currentViewer = runtime.viewer) {
    if (!currentViewer) return;
    currentViewer.batchSelectionVisible = Boolean(visible);
    const grid = currentViewer.media?.querySelector?.(".cmf-viewer-batch-grid");
    if (grid) grid.dataset.selectionVisible = String(currentViewer.batchSelectionVisible);
  }

  function syncViewerSelection(currentViewer) {
    currentViewer.openLink.href = currentViewer.item.url;
    currentViewer.copyImageButton.hidden = currentViewer.item.kind !== "image";
    syncFavoriteButton(currentViewer.favoriteButton, currentViewer.item);
    setViewerBatchSelectionVisible(currentViewer.batchSelectionVisible !== false, currentViewer);
    for (const cell of currentViewer.media.querySelectorAll(".cmf-viewer-batch-cell")) {
      const selected = cell.dataset.mediaItemKey === currentViewer.item.key;
      cell.dataset.selected = String(selected);
      cell.setAttribute("aria-current", String(selected));
    }
  }

  function selectViewerBatchItem(key) {
    const currentViewer = runtime.viewer;
    const batch = currentViewer?.entry;
    if (batch?.kind !== "batch" || currentViewer.root.dataset.open !== "true") return;
    const grid = currentViewer.media.querySelector(".cmf-viewer-batch-grid");
    if (grid?.dataset.mediaItemKey !== batch.key) return;
    const item = batch.items.find((member) => member.key === key);
    if (!item) return;
    setViewerBatchSelectionVisible(true, currentViewer);
    if (currentViewer.item?.id === item.id) return;

    // Selection changes the action/metadata target without remounting media.
    currentViewer.item = item;
    currentViewer.mediaReadyItemId = item.id;
    currentViewer.pendingPromptMetadataResult = null;
    syncViewerSelection(currentViewer);
    actions.updateViewerPromptPanel({ batchSelection: true });
  }

  function prepareBatchSelection(grid) {
    let pointer = null;
    let clickCell = null;
    const cellAt = (target) => target?.closest?.(".cmf-viewer-batch-cell");
    const isMediaControl = (target) => Boolean(
      target?.closest?.("video, audio") || target?.closest?.(".cmf-viewer-audio"),
    );
    const moved = (event) => Math.abs(event.clientX - pointer.x) >= VIEWER_IMAGE_DRAG_THRESHOLD
      || Math.abs(event.clientY - pointer.y) >= VIEWER_IMAGE_DRAG_THRESHOLD;
    grid.addEventListener("pointerdown", (event) => {
      pointer = null;
      const cell = cellAt(event.target);
      if (event.button !== 0 || event.isPrimary === false || !cell) return;
      pointer = {
        id: event.pointerId, cell, x: event.clientX, y: event.clientY, moved: false,
        nativeControl: isMediaControl(event.target),
      };
      clickCell = cell;
      // Keep the current selection frame visible until release commits a new
      // selection; cancellation and panning preserve the current selection.
    }, true);
    grid.addEventListener("pointermove", (event) => {
      if (pointer?.id !== event.pointerId) return;
      pointer.moved ||= moved(event);
      if (pointer.moved) clickCell = null;
    }, true);
    grid.addEventListener("pointercancel", () => {
      pointer = null;
      clickCell = null;
    }, true);
    grid.addEventListener("pointerup", (event) => {
      if (pointer?.id !== event.pointerId) return;
      const selected = pointer;
      const dragged = selected.moved || moved(event);
      const panned = runtime.viewer?.imageDrag?.pointerId === event.pointerId
        && runtime.viewer.imageDrag.moved;
      pointer = null;
      if (panned) clickCell = null;
      // Panning changes the grid viewport, not its action/metadata target.
      // Other drags, such as audio seeking and volume adjustment, still select
      // the media whose control was operated.
      if (!panned) selectViewerBatchItem(selected.cell.dataset.mediaItemKey);
      if (!dragged && !selected.nativeControl) selected.cell.focus({ preventScroll: true });
    }, true);
    // Keyboard/assistive clicks have no pointer sequence. Pointer selection is
    // handled above because panning captures the pointer on the whole grid.
    // Pointer capture can retarget the following click from its cell to the
    // grid, so retain the pressed cell as a fallback until that click arrives.
    grid.addEventListener("click", (event) => {
      const targetCell = cellAt(event.target);
      const capturedCell = event.detail > 0 && !targetCell ? clickCell : null;
      const cell = targetCell || capturedCell;
      clickCell = null;
      if (event.detail !== 0 && event.button !== 0) return;
      if (!cell) return;
      if (capturedCell) {
        // Do not let the viewer backdrop mistake a pointer-captured cell click
        // (whose target is now the grid) for a click outside the media.
        event.stopPropagation();
      }
      selectViewerBatchItem(cell.dataset.mediaItemKey);
    });
    // Player controls can consume pointer events. Focus still identifies the
    // media item being tabbed into, but pointer selection is committed on
    // release so native video and custom audio controls behave consistently.
    grid.addEventListener("focusin", (event) => {
      const cell = cellAt(event.target);
      if (!cell) return;
      setViewerBatchSelectionVisible(true);
      if (!pointer && isMediaControl(event.target)) selectViewerBatchItem(cell.dataset.mediaItemKey);
    });
    grid.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const cell = cellAt(event.target);
      if (!cell || event.target !== cell) return;
      event.preventDefault();
      event.stopPropagation();
      selectViewerBatchItem(cell.dataset.mediaItemKey);
    });
  }

  function discardDisplayedBatchMedia(currentViewer) {
    if (!currentViewer.media.querySelector(".cmf-viewer-batch-grid")) return;
    currentViewer.batchObserver?.disconnect();
    currentViewer.batchObserver = null;
    for (const media of currentViewer.media.querySelectorAll("video, audio")) discardStagedMedia(media);
  }

  function updateViewerTitle(currentViewer, entry) {
    const title = currentViewer.title;
    if (entry.kind !== "batch") {
      if (title.dataset) delete title.dataset.batch;
      title.textContent = entry.filename;
      title.title = entry.filename;
      return;
    }

    const filenames = entry.items.map((item) => item.filename);
    title.dataset.batch = "true";
    title.title = filenames.join("\n");
    if (filenames.length === 1) {
      title.textContent = filenames[0];
      return;
    }

    const first = document.createElement("span");
    first.className = "cmf-viewer-title-endpoint";
    first.textContent = filenames[0];
    const separator = document.createElement("span");
    separator.textContent = "\u00a0–\u00a0";
    const last = document.createElement("span");
    last.className = "cmf-viewer-title-endpoint";
    last.textContent = filenames[filenames.length - 1];
    title.replaceChildren(first, separator, last);
  }

  function setBatchMediaAspect(media) {
    const width = media.naturalWidth || media.videoWidth;
    const height = media.naturalHeight || media.videoHeight;
    if (width > 0 && height > 0) {
      media.parentElement.style.setProperty("--cmf-batch-media-aspect", String(width / height));
    }
  }

  async function renderViewerBatch(currentViewer, batch, requestId) {
    const grid = document.createElement("div");
    grid.className = "cmf-viewer-batch-grid";
    const columns = Math.ceil(Math.sqrt(batch.items.length));
    const rows = Math.ceil(batch.items.length / columns);
    grid.style.setProperty("--cmf-batch-columns", String(columns));
    grid.style.setProperty("--cmf-batch-row-count", String(rows));
    grid.dataset.mediaItemKey = batch.key;
    grid.dataset.naturalWidth = String(columns * 96);
    grid.dataset.naturalHeight = String(rows * 96);
    grid.tabIndex = 0;
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", `Batch of ${batch.items.length} media`);
    prepareViewerImage(grid);
    prepareBatchSelection(grid);

    const displayedGrid = currentViewer.media.querySelector(".cmf-viewer-batch-grid");
    const displayedCells = new Map([...(displayedGrid?.children || [])].map((cell) => [cell.dataset.mediaItemKey, cell]));
    const cells = [];
    const videos = [];
    const imageLoads = [];
    for (const [index, item] of batch.items.entries()) {
      const displayedCell = displayedCells.get(item.key);
      if (displayedCell?.dataset.mediaUrl === item.url && displayedCell.dataset.mediaKind === item.kind) {
        cells.push(displayedCell);
        if (item.kind === "video") videos.push([displayedCell.querySelector("video"), item.url]);
        continue;
      }
      const cell = document.createElement("div");
      cell.className = "cmf-viewer-batch-cell";
      cell.dataset.mediaItemKey = item.key;
      cell.dataset.mediaUrl = item.url;
      cell.dataset.mediaKind = item.kind;
      cell.title = `${index + 1} of ${batch.items.length}: ${item.filename}`;
      cell.tabIndex = 0;
      cell.setAttribute("role", "group");

      if (item.kind === "image") {
        const image = document.createElement("img");
        image.alt = item.filename;
        image.dataset.mediaItemKey = item.key;
        image.draggable = false;
        // Detached lazy images do not start loading, so load them before the swap.
        image.loading = "eager";
        image.decoding = "async";
        image.addEventListener("load", () => {
          setBatchMediaAspect(image);
          rememberDecodedImage(item.url, image);
          rememberMediaDimensions(item, image);
          if (currentViewer.item?.key === item.key) refreshViewerPromptPanelDetails();
        }, { once: true });
        image.src = item.url;
        imageLoads.push(decodeImageElement(image));
        cell.append(image);
      } else if (item.kind === "video") {
        const video = document.createElement("video");
        video.controls = true;
        // Chromium recognizes fullscreen from the two click events before the
        // grid's dblclick handler runs. Disable that native batch-only action;
        // the grid handles picture clicks for playback and double-click zoom.
        video.setAttribute("controlslist", "nofullscreen");
        video.playsInline = true;
        video.preload = "metadata";
        video.loop = state.loopVideos;
        video.dataset.mediaItemKey = item.key;
        video.addEventListener("loadedmetadata", () => {
          setBatchMediaAspect(video);
          rememberMediaDimensions(item, video);
          if (currentViewer.item?.key === item.key) refreshViewerPromptPanelDetails();
        }, { once: true });
        video.addEventListener("play", () => {
          selectViewerBatchItem(item.key);
          for (const other of currentViewer.media.querySelectorAll("video, audio")) {
            if (other !== video) other.pause();
          }
        });
        videos.push([video, item.url]);
        cell.append(video);
      } else {
        const audio = document.createElement("audio");
        audio.controls = false;
        audio.preload = "metadata";
        audio.loop = state.loopAudio;
        audio.src = item.url;
        audio.dataset.mediaItemKey = item.key;
        audio.addEventListener("play", () => {
          selectViewerBatchItem(item.key);
          for (const other of currentViewer.media.querySelectorAll("video, audio")) {
            if (other !== audio) other.pause();
          }
        });
        const presentation = createViewerAudioPresentation(audio);
        presentation.classList.add("cmf-viewer-batch-audio");
        cell.append(presentation);
      }
      cells.push(cell);
    }

    await Promise.all(imageLoads);
    if (currentViewer.renderRequestId !== requestId
      || currentViewer.entry !== batch
      || currentViewer.root.dataset.open !== "true") return;
    currentViewer.batchObserver?.disconnect();
    const focused = displayedGrid?.contains(document.activeElement) ? document.activeElement : null;
    for (const [index, cell] of cells.entries()) {
      cell.title = `${index + 1} of ${batch.items.length}: ${batch.items[index].filename}`;
      cell.setAttribute("aria-label", cell.title);
      grid.append(cell);
    }
    for (const media of currentViewer.media.querySelectorAll("video, audio")) discardStagedMedia(media);
    currentViewer.media.replaceChildren(grid);
    for (const cell of cells) {
      const audio = cell.querySelector("audio");
      if (audio) setupViewerAudioWaveform(cell, audio, cell.dataset.mediaUrl);
    }
    syncViewerSelection(currentViewer);
    if (focused && grid.contains(focused)) focused.focus({ preventScroll: true });
    if (typeof IntersectionObserver === "function") {
      currentViewer.batchObserver = new IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const video = entry.target;
          if (!video.hasAttribute("src")) video.src = video.dataset.src;
          observer.unobserve(video);
        }
      }, { root: currentViewer.media, rootMargin: "120px" });
      for (const [video, url] of videos) {
        if (video.hasAttribute("src")) continue;
        video.dataset.src = url;
        currentViewer.batchObserver.observe(video);
      }
    } else {
      currentViewer.batchObserver = null;
      for (const [video, url] of videos) if (!video.hasAttribute("src")) video.src = url;
    }
    currentViewer.media.dataset.pannable = "false";
    currentViewer.media.dataset.dragging = "false";
    currentViewer.mediaReadyItemId = currentViewer.item.id;
    updateViewerImageLayout();
    currentViewer.restoreView?.();
    refreshViewerPromptPanelDetails();
  }

  async function renderViewerItem(item, thumbnail, { autoplay = true } = {}) {
    const currentViewer = ensureViewer();
    const requestId = ++currentViewer.renderRequestId;
    clearViewerAudioWaveform(currentViewer);
    discardStagedMedia(currentViewer.pendingMedia);
    currentViewer.pendingMedia = null;
    const previousBatchPresentation = isBatchPresentation(currentViewer.entry);
    const sameBatch = item.kind === "batch" && currentViewer.entry?.key === item.key;
    const batchPresentation = isBatchPresentation(item);
    if (!sameBatch || previousBatchPresentation !== batchPresentation) {
      currentViewer.batchSelectionVisible = true;
    }
    const selectedKey = sameBatch ? currentViewer.item?.key : null;
    currentViewer.entry = item;
    currentViewer.item = item.kind === "batch"
      ? item.items.find((member) => member.key === selectedKey) || item.items[0]
      : item;
    const mediaItem = currentViewer.item;
    currentViewer.mediaReadyItemId = "";
    if ((!sameBatch || previousBatchPresentation !== batchPresentation)
      && !currentViewer.comparing && !currentViewer.isComparisonPane) {
      resetViewerImageView(batchPresentation || state.scaleViewerMedia ? "fit" : "native");
    }
    updateViewerTitle(currentViewer, batchPresentation ? item : mediaItem);
    currentViewer.openLink.href = mediaItem.url;
    currentViewer.copyImageButton.hidden = mediaItem.kind !== "image";
    syncFavoriteButton(currentViewer.favoriteButton, mediaItem);
    // Reserve the zoom controls' space before decoding, including in the
    // second pane where no previous media is mounted to keep them visible.
    actions.updateViewerImageControls();
    syncViewerNav();
    if (batchPresentation) {
      return renderViewerBatch(currentViewer, item, requestId);
    }
    const layout = () => {
      updateViewerImageLayout();
      currentViewer.restoreView?.();
    };
  
    if (mediaItem.kind === "image") {
      const image = document.createElement("img");
      image.alt = mediaItem.filename;
      image.decoding = "async";
      image.dataset.mediaItemKey = mediaItem.key;
      prepareViewerImage(image);
  
      const cached = runtime.decodedImageCache.get(mediaItem.url);
      if (cached?.complete) {
        image.src = cached.currentSrc || cached.src;
        await decodeImageElement(image);
        if (!isCurrentViewerRender(currentViewer, requestId, mediaItem)) return;
        discardDisplayedBatchMedia(currentViewer);
        currentViewer.media.querySelector("video, audio")?.pause();
        currentViewer.media.replaceChildren(image);
        layout();
        rememberDecodedImage(mediaItem.url, image);
        rememberMediaDimensions(mediaItem, image);
        currentViewer.mediaReadyItemId = mediaItem.id;
        refreshViewerPromptPanelDetails();
        return;
      }
  
      if (thumbnail?.complete) {
        rememberDecodedImage(mediaItem.url, thumbnail);
        image.src = thumbnail.currentSrc || thumbnail.src;
        await decodeImageElement(image);
        if (!isCurrentViewerRender(currentViewer, requestId, mediaItem)) return;
        discardDisplayedBatchMedia(currentViewer);
        currentViewer.media.querySelector("video, audio")?.pause();
        currentViewer.media.replaceChildren(image);
        layout();
        rememberDecodedImage(mediaItem.url, image);
        rememberMediaDimensions(mediaItem, image);
        currentViewer.mediaReadyItemId = mediaItem.id;
        refreshViewerPromptPanelDetails();
        return;
      }
  
      image.src = mediaItem.url;
      await decodeImageElement(image);
      if (!isCurrentViewerRender(currentViewer, requestId, mediaItem)) return;
      discardDisplayedBatchMedia(currentViewer);
      currentViewer.media.querySelector("video, audio")?.pause();
      currentViewer.media.replaceChildren(image);
      layout();
      rememberDecodedImage(mediaItem.url, image);
      rememberMediaDimensions(mediaItem, image);
      currentViewer.mediaReadyItemId = mediaItem.id;
      refreshViewerPromptPanelDetails();
      return;
    }
  
    if (mediaItem.kind === "video") {
      const video = document.createElement("video");
      prepareViewerImage(video);
      video.controls = true;
      // Chromium can enter native fullscreen from the click sequence before
      // the viewer's double-click zoom handler runs.
      video.setAttribute("controlslist", "nofullscreen");
      video.playsInline = true;
      video.preload = "auto";
      video.loop = state.loopVideos;
      video.muted = true;
      video.dataset.mediaItemKey = mediaItem.key;
      video.addEventListener("loadedmetadata", () => {
        rememberMediaDimensions(mediaItem, video);
        if (isCurrentViewerRender(currentViewer, requestId, mediaItem)) {
          layout();
        }
      }, { once: true });
      video.src = mediaItem.url;
      currentViewer.pendingMedia = video;
      if (autoplay) video.play().catch(() => {});
      await waitForMediaReady(video);
      if (!isCurrentViewerRender(currentViewer, requestId, mediaItem)) {
        if (currentViewer.pendingMedia === video) currentViewer.pendingMedia = null;
        discardStagedMedia(video);
        return;
      }
      currentViewer.pendingMedia = null;
      discardDisplayedBatchMedia(currentViewer);
      replaceViewerMedia(currentViewer, video, { autoplay });
      layout();
      currentViewer.mediaReadyItemId = mediaItem.id;
      refreshViewerPromptPanelDetails();
      return;
    }
  
    const displayedAudio = currentViewer.media.querySelector("audio.cmf-zoomable-audio");
    const reusingDisplayedAudio = displayedAudio instanceof HTMLAudioElement;
    const audio = reusingDisplayedAudio ? displayedAudio : document.createElement("audio");
    const presentation = reusingDisplayedAudio
      ? audio.closest?.(".cmf-viewer-audio") || audio.parentElement || audio
      : createViewerAudioPresentation(audio);
    if (!reusingDisplayedAudio) {
      audio.classList.add("cmf-zoomable-audio");
      audio.controls = false;
      audio.preload = "auto";
      audio.muted = true;
    }
    audio.dataset.mediaItemKey = mediaItem.key;
    audio.loop = state.loopAudio;
    if (!autoplay) audio.pause();
    audio.src = mediaItem.url;
    currentViewer.pendingMedia = audio;
    if (autoplay) audio.play().catch(() => {});
    await waitForMediaReady(audio);
    if (!isCurrentViewerRender(currentViewer, requestId, mediaItem)) {
      if (!reusingDisplayedAudio) {
        if (currentViewer.pendingMedia === audio) currentViewer.pendingMedia = null;
        discardStagedMedia(audio);
      }
      return;
    }
    currentViewer.pendingMedia = null;
    if (!reusingDisplayedAudio) {
      discardDisplayedBatchMedia(currentViewer);
      replaceViewerMedia(currentViewer, presentation, { autoplay });
    }
    setupViewerAudioWaveform(currentViewer, audio, mediaItem.url);
    layout();
    currentViewer.mediaReadyItemId = mediaItem.id;
  }
  
  Object.assign(actions, {
    renderViewerItem,
    selectViewerBatchItem,
    setViewerBatchSelectionVisible,
  });
}
