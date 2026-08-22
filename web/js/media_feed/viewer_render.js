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
  async function renderViewerItem(item, thumbnail) {
    const currentViewer = ensureViewer();
    const requestId = ++currentViewer.renderRequestId;
    discardStagedMedia(currentViewer.pendingMedia);
    currentViewer.pendingMedia = null;
    currentViewer.item = item;
    currentViewer.mediaReadyItemId = "";
    resetViewerImageView();
    currentViewer.title.textContent = item.filename;
    currentViewer.openLink.href = item.url;
    currentViewer.copyImageButton.hidden = item.kind !== "image";
    syncFavoriteButton(currentViewer.favoriteButton, item);
    syncViewerNav();
  
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
        currentViewer.media.replaceChildren(image);
        updateViewerImageLayout();
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
        currentViewer.media.replaceChildren(image);
        updateViewerImageLayout();
        rememberDecodedImage(item.url, image);
        rememberMediaDimensions(item, image);
        currentViewer.mediaReadyItemId = item.id;
        refreshViewerPromptPanelDetails();
        return;
      }
  
      image.src = item.url;
      await decodeImageElement(image);
      if (!isCurrentViewerRender(currentViewer, requestId, item)) return;
      currentViewer.media.replaceChildren(image);
      updateViewerImageLayout();
      rememberDecodedImage(item.url, image);
      rememberMediaDimensions(item, image);
      currentViewer.mediaReadyItemId = item.id;
      refreshViewerPromptPanelDetails();
      return;
    }
  
    if (item.kind === "video") {
      const video = document.createElement("video");
      video.classList.add("cmf-zoomable-video");
      video.controls = true;
      video.playsInline = true;
      video.preload = "auto";
      video.muted = true;
      video.dataset.mediaItemKey = item.key;
      video.addEventListener("loadedmetadata", () => {
        rememberMediaDimensions(item, video);
        if (isCurrentViewerRender(currentViewer, requestId, item)) {
          updateViewerImageLayout();
        }
      }, { once: true });
      video.src = item.url;
      currentViewer.pendingMedia = video;
      video.play().catch(() => {});
      await waitForMediaReady(video);
      if (!isCurrentViewerRender(currentViewer, requestId, item)) {
        if (currentViewer.pendingMedia === video) currentViewer.pendingMedia = null;
        discardStagedMedia(video);
        return;
      }
      currentViewer.pendingMedia = null;
      replaceViewerMedia(currentViewer, video);
      updateViewerImageLayout();
      currentViewer.mediaReadyItemId = item.id;
      refreshViewerPromptPanelDetails();
      return;
    }
  
    const audio = document.createElement("audio");
    audio.classList.add("cmf-zoomable-audio");
    audio.controls = true;
    audio.preload = "auto";
    audio.muted = true;
    audio.dataset.mediaItemKey = item.key;
    audio.src = item.url;
    currentViewer.pendingMedia = audio;
    audio.play().catch(() => {});
    await waitForMediaReady(audio);
    if (!isCurrentViewerRender(currentViewer, requestId, item)) {
      if (currentViewer.pendingMedia === audio) currentViewer.pendingMedia = null;
      discardStagedMedia(audio);
      return;
    }
    currentViewer.pendingMedia = null;
    replaceViewerMedia(currentViewer, audio);
    updateViewerImageLayout();
    currentViewer.mediaReadyItemId = item.id;
  }
  
  Object.assign(actions, {
    renderViewerItem,
  });
}
