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
  function selectBatchItem(currentViewer, item) {
    currentViewer.item = item;
    currentViewer.title.textContent = item.filename;
    currentViewer.title.title = item.filename;
    currentViewer.openLink.href = item.url;
    currentViewer.copyImageButton.hidden = item.kind !== "image";
    syncFavoriteButton(currentViewer.favoriteButton, item);
    currentViewer.mediaReadyItemId = item.id;
    for (const cell of currentViewer.media.querySelectorAll(".cmf-viewer-batch-cell")) {
      cell.dataset.selected = String(cell.dataset.mediaItemKey === item.key);
    }
    actions.updateViewerPromptPanel?.();
    refreshViewerPromptPanelDetails();
  }

  function renderViewerBatch(currentViewer, batch) {
    const viewport = document.createElement("div");
    viewport.className = "cmf-viewer-batch-viewport";
    const grid = document.createElement("div");
    grid.className = "cmf-viewer-batch-grid";
    grid.style.setProperty("--cmf-batch-columns", String(Math.ceil(Math.sqrt(batch.items.length))));
    viewport.append(grid);

    const videos = [];
    for (const [index, item] of batch.items.entries()) {
      const cell = document.createElement("div");
      cell.className = "cmf-viewer-batch-cell";
      cell.dataset.mediaItemKey = item.key;
      cell.dataset.selected = String(item.key === currentViewer.item.key);
      cell.tabIndex = 0;
      cell.setAttribute("role", "button");
      cell.setAttribute("aria-label", `${index + 1} of ${batch.items.length}: ${item.filename}`);

      if (item.kind === "image") {
        const image = document.createElement("img");
        image.alt = item.filename;
        image.dataset.mediaItemKey = item.key;
        image.loading = "lazy";
        image.decoding = "async";
        image.src = item.url;
        image.addEventListener("load", () => {
          rememberDecodedImage(item.url, image);
          rememberMediaDimensions(item, image);
          if (currentViewer.item?.key === item.key) refreshViewerPromptPanelDetails();
        }, { once: true });
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
          for (const other of currentViewer.media.querySelectorAll("video, audio")) {
            if (other !== audio) other.pause();
          }
        });
        const icon = document.createElement("span");
        icon.className = "cmf-viewer-batch-audio-icon";
        icon.innerHTML = ICONS.music;
        cell.append(icon, audio);
      }
      cell.addEventListener("click", () => selectBatchItem(currentViewer, item));
      cell.addEventListener("keydown", (event) => {
        if (event.target !== cell || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        selectBatchItem(currentViewer, item);
      });
      grid.append(cell);
    }

    currentViewer.batchObserver?.disconnect();
    for (const media of currentViewer.media.querySelectorAll("video, audio")) discardStagedMedia(media);
    currentViewer.media.replaceChildren(viewport);
    if (typeof IntersectionObserver === "function") {
      currentViewer.batchObserver = new IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const video = entry.target;
          video.src = video.dataset.src;
          observer.unobserve(video);
        }
      }, { root: viewport, rootMargin: "120px" });
      for (const [video, url] of videos) {
        video.dataset.src = url;
        currentViewer.batchObserver.observe(video);
      }
    } else {
      currentViewer.batchObserver = null;
      for (const [video, url] of videos) video.src = url;
    }
    currentViewer.media.dataset.pannable = "false";
    currentViewer.media.dataset.dragging = "false";
    currentViewer.mediaReadyItemId = currentViewer.item.id;
    updateViewerImageLayout();
    refreshViewerPromptPanelDetails();
  }

  async function renderViewerItem(item, thumbnail) {
    const currentViewer = ensureViewer();
    const requestId = ++currentViewer.renderRequestId;
    const previousSelection = currentViewer.entry?.key === item.key ? currentViewer.item?.key : null;
    if (currentViewer.entry?.kind === "batch") {
      currentViewer.batchObserver?.disconnect();
      for (const media of currentViewer.media.querySelectorAll("video, audio")) discardStagedMedia(media);
    }
    clearViewerAudioWaveform(currentViewer);
    discardStagedMedia(currentViewer.pendingMedia);
    currentViewer.pendingMedia = null;
    currentViewer.entry = item;
    currentViewer.item = item.kind === "batch"
      ? item.items.find((member) => member.key === previousSelection) || item.items[0]
      : item;
    currentViewer.mediaReadyItemId = "";
    if (!currentViewer.comparing && !currentViewer.isComparisonPane) resetViewerImageView();
    currentViewer.title.textContent = currentViewer.item.filename;
    currentViewer.title.title = currentViewer.item.filename;
    currentViewer.openLink.href = currentViewer.item.url;
    currentViewer.copyImageButton.hidden = currentViewer.item.kind !== "image";
    syncFavoriteButton(currentViewer.favoriteButton, currentViewer.item);
    syncViewerNav();
    if (item.kind === "batch") {
      renderViewerBatch(currentViewer, item);
      return;
    }
    currentViewer.batchObserver?.disconnect();
    currentViewer.batchObserver = null;
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
      replaceViewerMedia(currentViewer, presentation);
    }
    setupViewerAudioWaveform(currentViewer, audio, item.url);
    layout();
    currentViewer.mediaReadyItemId = item.id;
  }
  
  Object.assign(actions, {
    renderViewerItem,
  });
}
