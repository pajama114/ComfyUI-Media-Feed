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
  function renderViewerBatch(currentViewer, batch) {
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

    const videos = [];
    for (const [index, item] of batch.items.entries()) {
      const cell = document.createElement("div");
      cell.className = "cmf-viewer-batch-cell";
      cell.dataset.mediaItemKey = item.key;
      cell.title = `${index + 1} of ${batch.items.length}: ${item.filename}`;

      if (item.kind === "image") {
        const image = document.createElement("img");
        image.alt = item.filename;
        image.dataset.mediaItemKey = item.key;
        image.draggable = false;
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
      grid.append(cell);
    }

    currentViewer.batchObserver?.disconnect();
    for (const media of currentViewer.media.querySelectorAll("video, audio")) discardStagedMedia(media);
    currentViewer.media.replaceChildren(grid);
    if (typeof IntersectionObserver === "function") {
      currentViewer.batchObserver = new IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const video = entry.target;
          video.src = video.dataset.src;
          observer.unobserve(video);
        }
      }, { root: currentViewer.media, rootMargin: "120px" });
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
    currentViewer.restoreView?.();
    refreshViewerPromptPanelDetails();
  }

  async function renderViewerItem(item, thumbnail) {
    const currentViewer = ensureViewer();
    const requestId = ++currentViewer.renderRequestId;
    if (currentViewer.entry?.kind === "batch") {
      currentViewer.batchObserver?.disconnect();
      for (const media of currentViewer.media.querySelectorAll("video, audio")) discardStagedMedia(media);
    }
    clearViewerAudioWaveform(currentViewer);
    discardStagedMedia(currentViewer.pendingMedia);
    currentViewer.pendingMedia = null;
    currentViewer.entry = item;
    currentViewer.item = item.kind === "batch" ? item.items[0] : item;
    currentViewer.mediaReadyItemId = "";
    if (!currentViewer.comparing && !currentViewer.isComparisonPane) {
      resetViewerImageView(item.kind === "batch" ? "fit" : state.scaleViewerMedia ? "fit" : "native");
    }
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
