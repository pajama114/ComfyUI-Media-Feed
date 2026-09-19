import { VIEWER_IMAGE_DRAG_THRESHOLD } from "./constants.js";

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

  function syncViewerSelection(currentViewer) {
    currentViewer.openLink.href = currentViewer.item.url;
    currentViewer.copyImageButton.hidden = currentViewer.item.kind !== "image";
    syncFavoriteButton(currentViewer.favoriteButton, currentViewer.item);
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
    if (!item || currentViewer.item?.id === item.id) return;

    // Selection changes the action/metadata target without remounting media.
    currentViewer.item = item;
    currentViewer.mediaReadyItemId = item.id;
    currentViewer.pendingPromptMetadataResult = null;
    syncViewerSelection(currentViewer);
    actions.updateViewerPromptPanel();
  }

  function prepareBatchSelection(grid) {
    let pointer = null;
    const cellAt = (target) => target?.closest?.(".cmf-viewer-batch-cell");
    const moved = (event) => Math.abs(event.clientX - pointer.x) >= VIEWER_IMAGE_DRAG_THRESHOLD
      || Math.abs(event.clientY - pointer.y) >= VIEWER_IMAGE_DRAG_THRESHOLD;
    grid.addEventListener("pointerdown", (event) => {
      pointer = null;
      const cell = cellAt(event.target);
      if (event.button !== 0 || event.isPrimary === false || !cell) return;
      pointer = {
        id: event.pointerId, cell, x: event.clientX, y: event.clientY, moved: false,
        nativeControl: Boolean(event.target.closest?.("video, audio")),
      };
    }, true);
    grid.addEventListener("pointermove", (event) => {
      if (pointer?.id === event.pointerId) pointer.moved ||= moved(event);
    }, true);
    grid.addEventListener("pointercancel", () => { pointer = null; }, true);
    grid.addEventListener("pointerup", (event) => {
      if (pointer?.id !== event.pointerId) return;
      const selected = pointer;
      const dragged = selected.moved || moved(event);
      pointer = null;
      if (dragged) return;
      selectViewerBatchItem(selected.cell.dataset.mediaItemKey);
      if (!selected.nativeControl) selected.cell.focus({ preventScroll: true });
    }, true);
    // Keyboard/assistive clicks have no pointer sequence. Pointer selection is
    // handled above because panning captures the pointer on the whole grid.
    grid.addEventListener("click", (event) => {
      if (event.detail !== 0) return;
      const cell = cellAt(event.target);
      if (cell) selectViewerBatchItem(cell.dataset.mediaItemKey);
    });
    // Native player controls can consume pointer events inside their shadow
    // tree. Focus still identifies the player being operated or tabbed into.
    grid.addEventListener("focusin", (event) => {
      if (!event.target.closest?.("video, audio")) return;
      const cell = cellAt(event.target);
      if (cell) selectViewerBatchItem(cell.dataset.mediaItemKey);
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

  async function renderViewerBatch(currentViewer, batch, requestId) {
    const grid = document.createElement("div");
    grid.className = "cmf-viewer-batch-grid";
    const columns = Math.ceil(Math.sqrt(batch.items.length));
    grid.style.setProperty("--cmf-batch-columns", String(columns));
    grid.dataset.mediaItemKey = batch.key;
    grid.dataset.naturalSize = String(columns * 96);
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
        video.playsInline = true;
        video.preload = "metadata";
        video.loop = state.loopVideos;
        video.dataset.mediaItemKey = item.key;
        video.addEventListener("loadedmetadata", () => {
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
        audio.controls = true;
        audio.preload = "none";
        audio.loop = state.loopAudio;
        audio.src = item.url;
        audio.dataset.mediaItemKey = item.key;
        audio.addEventListener("play", () => {
          selectViewerBatchItem(item.key);
          for (const other of currentViewer.media.querySelectorAll("video, audio")) {
            if (other !== audio) other.pause();
          }
        });
        const icon = document.createElement("span");
        icon.className = "cmf-viewer-batch-audio-icon";
        icon.innerHTML = ICONS.music;
        cell.append(icon, audio);
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

  async function renderViewerItem(item, thumbnail) {
    const currentViewer = ensureViewer();
    const requestId = ++currentViewer.renderRequestId;
    clearViewerAudioWaveform(currentViewer);
    discardStagedMedia(currentViewer.pendingMedia);
    currentViewer.pendingMedia = null;
    const sameBatch = item.kind === "batch" && currentViewer.entry?.key === item.key;
    const selectedKey = sameBatch ? currentViewer.item?.key : null;
    currentViewer.entry = item;
    currentViewer.item = item.kind === "batch"
      ? item.items.find((member) => member.key === selectedKey) || item.items[0]
      : item;
    currentViewer.mediaReadyItemId = "";
    if (!sameBatch && !currentViewer.comparing && !currentViewer.isComparisonPane) {
      resetViewerImageView(item.kind === "batch" ? "fit" : state.scaleViewerMedia ? "fit" : "native");
    }
    updateViewerTitle(currentViewer, item);
    currentViewer.openLink.href = currentViewer.item.url;
    currentViewer.copyImageButton.hidden = currentViewer.item.kind !== "image";
    syncFavoriteButton(currentViewer.favoriteButton, currentViewer.item);
    syncViewerNav();
    if (item.kind === "batch") {
      return renderViewerBatch(currentViewer, item, requestId);
    }
    const layout = () => {
      updateViewerImageLayout();
      currentViewer.restoreView?.();
    };
  
    if (item.kind === "image") {
      const image = document.createElement("img");
      image.alt = item.filename;
      image.decoding = "async";
      image.dataset.mediaItemKey = item.key;
      prepareViewerImage(image);
  
      const cached = runtime.decodedImageCache.get(item.url);
      if (cached?.complete) {
        image.src = cached.currentSrc || cached.src;
        await decodeImageElement(image);
        if (!isCurrentViewerRender(currentViewer, requestId, item)) return;
        discardDisplayedBatchMedia(currentViewer);
        currentViewer.media.querySelector("video, audio")?.pause();
        currentViewer.media.replaceChildren(image);
        layout();
        rememberDecodedImage(item.url, image);
        rememberMediaDimensions(item, image);
        currentViewer.mediaReadyItemId = item.id;
        refreshViewerPromptPanelDetails();
        return;
      }
  
      if (thumbnail?.complete) {
        rememberDecodedImage(item.url, thumbnail);
        image.src = thumbnail.currentSrc || thumbnail.src;
        await decodeImageElement(image);
        if (!isCurrentViewerRender(currentViewer, requestId, item)) return;
        discardDisplayedBatchMedia(currentViewer);
        currentViewer.media.querySelector("video, audio")?.pause();
        currentViewer.media.replaceChildren(image);
        layout();
        rememberDecodedImage(item.url, image);
        rememberMediaDimensions(item, image);
        currentViewer.mediaReadyItemId = item.id;
        refreshViewerPromptPanelDetails();
        return;
      }
  
      image.src = item.url;
      await decodeImageElement(image);
      if (!isCurrentViewerRender(currentViewer, requestId, item)) return;
      discardDisplayedBatchMedia(currentViewer);
      currentViewer.media.querySelector("video, audio")?.pause();
      currentViewer.media.replaceChildren(image);
      layout();
      rememberDecodedImage(item.url, image);
      rememberMediaDimensions(item, image);
      currentViewer.mediaReadyItemId = item.id;
      refreshViewerPromptPanelDetails();
      return;
    }
  
    if (item.kind === "video") {
      const video = document.createElement("video");
      prepareViewerImage(video);
      video.controls = true;
      video.playsInline = true;
      video.preload = "auto";
      video.loop = state.loopVideos;
      video.muted = true;
      video.dataset.mediaItemKey = item.key;
      video.addEventListener("loadedmetadata", () => {
        rememberMediaDimensions(item, video);
        if (isCurrentViewerRender(currentViewer, requestId, item)) {
          layout();
        }
      }, { once: true });
      video.src = item.url;
      currentViewer.pendingMedia = video;
      if (!currentViewer.isComparisonPane) video.play().catch(() => {});
      await waitForMediaReady(video);
      if (!isCurrentViewerRender(currentViewer, requestId, item)) {
        if (currentViewer.pendingMedia === video) currentViewer.pendingMedia = null;
        discardStagedMedia(video);
        return;
      }
      currentViewer.pendingMedia = null;
      discardDisplayedBatchMedia(currentViewer);
      replaceViewerMedia(currentViewer, video);
      layout();
      currentViewer.mediaReadyItemId = item.id;
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
    audio.dataset.mediaItemKey = item.key;
    audio.loop = state.loopAudio;
    audio.src = item.url;
    currentViewer.pendingMedia = audio;
    if (!currentViewer.isComparisonPane) audio.play().catch(() => {});
    await waitForMediaReady(audio);
    if (!isCurrentViewerRender(currentViewer, requestId, item)) {
      if (!reusingDisplayedAudio) {
        if (currentViewer.pendingMedia === audio) currentViewer.pendingMedia = null;
        discardStagedMedia(audio);
      }
      return;
    }
    currentViewer.pendingMedia = null;
    if (!reusingDisplayedAudio) {
      discardDisplayedBatchMedia(currentViewer);
      replaceViewerMedia(currentViewer, presentation);
    }
    setupViewerAudioWaveform(currentViewer, audio, item.url);
    layout();
    currentViewer.mediaReadyItemId = item.id;
  }
  
  Object.assign(actions, {
    renderViewerItem,
    selectViewerBatchItem,
  });
}
