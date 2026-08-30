import {
  VIEWER_IMAGE_ZOOM_STEP,
  VIEWER_IMAGE_WHEEL_ZOOM_FACTOR,
} from "./constants.js";

export function installViewerShell(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const toggleFavorite = (...args) => actions.toggleFavorite(...args);
  const filteredItems = (...args) => actions.filteredItems(...args);
  const isViewerOpen = (...args) => actions.isViewerOpen(...args);
  const setShowPrompts = (...args) => actions.setShowPrompts(...args);
  const ensureStyles = (...args) => actions.ensureStyles(...args);
  const discardStagedMedia = (...args) => actions.discardStagedMedia(...args);
  const copyPromptText = (...args) => actions.copyPromptText(...args);
  const copyAllViewerMetadata = (...args) => actions.copyAllViewerMetadata(...args);
  const copyViewerResources = (...args) => actions.copyViewerResources(...args);
  const copyViewerOtherMetadata = (...args) => actions.copyViewerOtherMetadata(...args);
  const copyViewerImage = (...args) => actions.copyViewerImage(...args);
  const downloadViewerMedia = (...args) => actions.downloadViewerMedia(...args);
  const downloadViewerEmbeddedJson = (...args) => actions.downloadViewerEmbeddedJson(...args);
  const getViewerImage = (...args) => actions.getViewerImage(...args);
  const updateViewerImageLayout = (...args) => actions.updateViewerImageLayout(...args);
  const resetViewerImageView = (...args) => actions.resetViewerImageView(...args);
  const setViewerImageBaseMode = (...args) => actions.setViewerImageBaseMode(...args);
  const setViewerImageZoom = (...args) => actions.setViewerImageZoom(...args);
  const handleViewerBackdropClick = (...args) => actions.handleViewerBackdropClick(...args);
  const renderViewerItem = (...args) => actions.renderViewerItem(...args);
  const clearViewerPromptLoadingTimer = (...args) => actions.clearViewerPromptLoadingTimer(...args);
  const scanFullViewerMetadata = (...args) => actions.scanFullViewerMetadata(...args);
  const updateViewerPromptPanel = (...args) => actions.updateViewerPromptPanel(...args);
  function ensureViewer() {
    if (runtime.viewer) return runtime.viewer;
  
    ensureStyles();
    const metadataOnLeft = state.metadataPosition === "left";
    const hideMetadataIcon = metadataOnLeft ? ICONS.panelLeftClose : ICONS.panelRightClose;
    const showMetadataIcon = metadataOnLeft ? ICONS.panelLeftOpen : ICONS.panelRightOpen;
  
    const root = document.createElement("div");
    root.className = "cmf-viewer";
    root.tabIndex = -1;
    root.dataset.scaleMedia = String(state.scaleViewerMedia);
    root.innerHTML = `
      <div class="cmf-viewer-bar">
        <div class="cmf-viewer-title"></div>
        <div class="cmf-spacer"></div>
        <div class="cmf-viewer-zoom-controls" hidden aria-label="Media zoom controls">
          <div class="cmf-viewer-size-toggle" role="group" aria-label="Media display size">
            <button class="cmf-button cmf-viewer-zoom-text cmf-viewer-fit" type="button" title="Fit to viewer" aria-label="Fit to viewer" aria-pressed="false">Fit</button>
            <button class="cmf-button cmf-viewer-zoom-text cmf-viewer-native" type="button" title="Actual size" aria-label="Actual size" aria-pressed="false">1:1</button>
          </div>
          <button class="cmf-button cmf-icon-button cmf-viewer-zoom-out" type="button" title="Zoom out" aria-label="Zoom out">${ICONS.zoomOut}</button>
          <output class="cmf-viewer-zoom-level" aria-live="polite">Fit</output>
          <button class="cmf-button cmf-icon-button cmf-viewer-zoom-in" type="button" title="Zoom in" aria-label="Zoom in">${ICONS.zoomIn}</button>
        </div>
        <button class="cmf-button cmf-icon-button cmf-viewer-favorite" type="button" title="Add to favorites" aria-label="Add to favorites" aria-pressed="false">${ICONS.star}</button>
        <button class="cmf-button cmf-icon-button cmf-viewer-download" type="button" title="Download media" aria-label="Download media">${ICONS.download}</button>
        <button class="cmf-button cmf-icon-button cmf-viewer-copy-image" type="button" title="Copy image" aria-label="Copy image" hidden>${ICONS.copy}</button>
        <a class="cmf-button cmf-icon-button cmf-open-link" target="_blank" rel="noopener noreferrer" title="Open original" aria-label="Open original">${ICONS.externalLink}</a>
        <button class="cmf-button cmf-icon-button cmf-close" type="button" title="Close" aria-label="Close">${ICONS.close}</button>
      </div>
      <div class="cmf-viewer-body">
        <section class="cmf-viewer-main" aria-label="Media preview">
          <button class="cmf-button cmf-icon-button cmf-nav-button cmf-nav-prev" type="button" title="Previous" aria-label="Previous">${ICONS.chevronLeft}</button>
          <button class="cmf-button cmf-icon-button cmf-nav-button cmf-nav-next" type="button" title="Next" aria-label="Next">${ICONS.chevronRight}</button>
          <div class="cmf-viewer-media"></div>
        </section>
        <aside class="cmf-prompt-panel" hidden aria-label="Metadata">
          <div class="cmf-prompt-panel-header">
            <h2 class="cmf-prompt-panel-title">Metadata</h2>
            <button class="cmf-button cmf-icon-button cmf-viewer-metadata-toggle cmf-hide-metadata" type="button" title="Hide metadata" aria-label="Hide metadata" aria-pressed="true">${hideMetadataIcon}</button>
          </div>
          <div class="cmf-metadata-toolbar" role="group" aria-label="Metadata actions">
            <button class="cmf-button cmf-metadata-action cmf-copy-all" type="button" title="Copy all metadata" aria-label="Copy all metadata" disabled>${ICONS.copy}<span>Copy all</span></button>
            <button class="cmf-button cmf-metadata-action cmf-download-json" type="button" title="Download all embedded JSON" aria-label="Download all embedded JSON" disabled>${ICONS.download}<span>JSON</span></button>
          </div>
          <div class="cmf-prompt-status"></div>
          <button class="cmf-button cmf-scan-full-metadata" type="button" hidden>Read full file metadata</button>
          <section class="cmf-prompt-section cmf-resources-section" hidden>
            <div class="cmf-prompt-section-header">
              <h2 class="cmf-prompt-heading">Resources</h2>
              <button class="cmf-button cmf-icon-button cmf-prompt-copy cmf-copy-resources" type="button" title="Copy all resources" aria-label="Copy all resources">${ICONS.copy}</button>
            </div>
            <div class="cmf-resource-grid"></div>
          </section>
          <section class="cmf-prompt-section cmf-prompt-body-section">
            <div class="cmf-prompt-section-header">
              <h2 class="cmf-prompt-heading">Prompt</h2>
              <button class="cmf-button cmf-icon-button cmf-prompt-copy cmf-copy-positive" type="button" title="Copy prompt" aria-label="Copy prompt">${ICONS.copy}</button>
            </div>
            <pre class="cmf-prompt-text cmf-prompt-positive"></pre>
          </section>
          <section class="cmf-prompt-section cmf-prompt-body-section">
            <div class="cmf-prompt-section-header">
              <h2 class="cmf-prompt-heading">Negative Prompt</h2>
              <button class="cmf-button cmf-icon-button cmf-prompt-copy cmf-copy-negative" type="button" title="Copy negative prompt" aria-label="Copy negative prompt">${ICONS.copy}</button>
            </div>
            <pre class="cmf-prompt-text cmf-prompt-negative"></pre>
          </section>
          <section class="cmf-prompt-section">
            <div class="cmf-prompt-section-header">
              <h2 class="cmf-prompt-heading">Seed</h2>
              <button class="cmf-button cmf-icon-button cmf-prompt-copy cmf-copy-seed" type="button" title="Copy seed" aria-label="Copy seed">${ICONS.copy}</button>
            </div>
            <pre class="cmf-prompt-text cmf-seed-text"></pre>
          </section>
          <section class="cmf-prompt-section cmf-metadata-section" hidden>
            <div class="cmf-prompt-section-header">
              <h2 class="cmf-prompt-heading">Other Metadata</h2>
              <button class="cmf-button cmf-icon-button cmf-prompt-copy cmf-copy-other-metadata" type="button" title="Copy all other metadata" aria-label="Copy all other metadata">${ICONS.copy}</button>
            </div>
            <div class="cmf-metadata-grid"></div>
          </section>
        </aside>
        <button class="cmf-button cmf-icon-button cmf-viewer-metadata-toggle cmf-show-metadata" type="button" title="Show metadata" aria-label="Show metadata" aria-pressed="false">${showMetadataIcon}</button>
      </div>
    `;
  
    root.addEventListener("click", handleViewerBackdropClick);
    root.querySelector(".cmf-close").addEventListener("click", closeViewer);
    for (const button of root.querySelectorAll(".cmf-viewer-metadata-toggle")) {
      button.addEventListener("click", () => setShowPrompts(!state.showPrompts, { syncSettings: true }));
    }
    root.querySelector(".cmf-viewer-favorite").addEventListener("click", () => toggleFavorite(runtime.viewer?.item));
    root.querySelector(".cmf-viewer-download").addEventListener("click", downloadViewerMedia);
    root.querySelector(".cmf-viewer-copy-image").addEventListener("click", copyViewerImage);
    root.querySelector(".cmf-copy-seed").addEventListener("click", (event) => copyPromptText(event, runtime.viewer?.promptSeed));
    root.querySelector(".cmf-copy-positive").addEventListener("click", (event) => copyPromptText(event, runtime.viewer?.promptPositive));
    root.querySelector(".cmf-copy-negative").addEventListener("click", (event) => copyPromptText(event, runtime.viewer?.promptNegative));
    root.querySelector(".cmf-copy-all").addEventListener("click", copyAllViewerMetadata);
    root.querySelector(".cmf-copy-resources").addEventListener("click", copyViewerResources);
    root.querySelector(".cmf-copy-other-metadata").addEventListener("click", copyViewerOtherMetadata);
    root.querySelector(".cmf-download-json").addEventListener("click", downloadViewerEmbeddedJson);
    root.querySelector(".cmf-scan-full-metadata").addEventListener("click", scanFullViewerMetadata);
    root.querySelector(".cmf-viewer-fit").addEventListener("click", () => setViewerImageBaseMode("fit"));
    root.querySelector(".cmf-viewer-native").addEventListener("click", () => setViewerImageBaseMode("native"));
    root.querySelector(".cmf-viewer-zoom-out").addEventListener("click", () => {
      setViewerImageZoom(runtime.viewer?.imageZoom - VIEWER_IMAGE_ZOOM_STEP);
    });
    root.querySelector(".cmf-viewer-zoom-in").addEventListener("click", () => {
      setViewerImageZoom(runtime.viewer?.imageZoom + VIEWER_IMAGE_ZOOM_STEP);
    });
    root.addEventListener("keydown", handleViewerControlKeydown, true);
    for (const button of root.querySelectorAll(".cmf-nav-button")) {
      button.addEventListener("mousedown", (event) => event.preventDefault());
    }
    root.querySelector(".cmf-nav-prev").addEventListener("click", (event) => {
      event.currentTarget.blur();
      showViewerRelative(-1);
    });
    root.querySelector(".cmf-nav-next").addEventListener("click", (event) => {
      event.currentTarget.blur();
      showViewerRelative(1);
    });
    root.addEventListener("wheel", handleViewerWheel, { passive: false });
    document.addEventListener("keydown", handleViewerGlobalKeydown, true);
  
    document.body.appendChild(root);
    runtime.viewer = {
      root,
      title: root.querySelector(".cmf-viewer-title"),
      body: root.querySelector(".cmf-viewer-body"),
      main: root.querySelector(".cmf-viewer-main"),
      media: root.querySelector(".cmf-viewer-media"),
      promptPanel: root.querySelector(".cmf-prompt-panel"),
      promptStatus: root.querySelector(".cmf-prompt-status"),
      scanFullMetadataButton: root.querySelector(".cmf-scan-full-metadata"),
      copyAllMetadataButton: root.querySelector(".cmf-copy-all"),
      downloadMetadataButton: root.querySelector(".cmf-download-json"),
      resourcesSection: root.querySelector(".cmf-resources-section"),
      resourcesGrid: root.querySelector(".cmf-resource-grid"),
      metadataSection: root.querySelector(".cmf-metadata-section"),
      metadataGrid: root.querySelector(".cmf-metadata-grid"),
      promptSeed: root.querySelector(".cmf-seed-text"),
      promptPositive: root.querySelector(".cmf-prompt-positive"),
      promptNegative: root.querySelector(".cmf-prompt-negative"),
      openLink: root.querySelector(".cmf-open-link"),
      hideMetadataButton: root.querySelector(".cmf-hide-metadata"),
      showMetadataButton: root.querySelector(".cmf-show-metadata"),
      favoriteButton: root.querySelector(".cmf-viewer-favorite"),
      downloadButton: root.querySelector(".cmf-viewer-download"),
      copyImageButton: root.querySelector(".cmf-viewer-copy-image"),
      zoomControls: root.querySelector(".cmf-viewer-zoom-controls"),
      fitButton: root.querySelector(".cmf-viewer-fit"),
      nativeButton: root.querySelector(".cmf-viewer-native"),
      zoomOutButton: root.querySelector(".cmf-viewer-zoom-out"),
      zoomInButton: root.querySelector(".cmf-viewer-zoom-in"),
      zoomLevel: root.querySelector(".cmf-viewer-zoom-level"),
      prevButton: root.querySelector(".cmf-nav-prev"),
      nextButton: root.querySelector(".cmf-nav-next"),
      promptRequestId: 0,
      promptLoadingTimer: 0,
      renderRequestId: 0,
      lastPromptMetadataItemId: "",
      lastMetadataDetails: [],
      pendingPromptMetadataResult: null,
      mediaReadyItemId: "",
      pendingMedia: null,
      item: null,
      items: [],
      index: -1,
      imageBaseMode: state.scaleViewerMedia ? "fit" : "native",
      imageZoom: 1,
      imagePanX: 0,
      imagePanY: 0,
      imageDrag: null,
      suppressImageClick: false,
    };
    runtime.viewer.resizeObserver = new ResizeObserver(() => updateViewerImageLayout());
    runtime.viewer.resizeObserver.observe(runtime.viewer.media);
    syncViewerMetadataToggle();
    syncViewerMetadataPosition();
    return runtime.viewer;
  }
  
  function syncViewerScaleMedia() {
    if (!runtime.viewer) return;
    resetViewerImageView(state.scaleViewerMedia ? "fit" : "native");
  }
  
  function syncViewerMetadataPosition() {
    if (!runtime.viewer) return;
    const metadataOnLeft = state.metadataPosition === "left";
    runtime.viewer.body.dataset.metadataPosition = state.metadataPosition;
    runtime.viewer.hideMetadataButton.innerHTML = metadataOnLeft ? ICONS.panelLeftClose : ICONS.panelRightClose;
    runtime.viewer.showMetadataButton.innerHTML = metadataOnLeft ? ICONS.panelLeftOpen : ICONS.panelRightOpen;
  }
  
  function syncViewerMetadataToggle() {
    if (!runtime.viewer) return;
  
    const showing = state.showPrompts;
    runtime.viewer.hideMetadataButton.hidden = !showing;
    runtime.viewer.showMetadataButton.hidden = showing;
    runtime.viewer.hideMetadataButton.setAttribute("aria-pressed", String(showing));
    runtime.viewer.showMetadataButton.setAttribute("aria-pressed", String(showing));
  }
  
  function closeViewer() {
    if (!runtime.viewer) return;
    runtime.viewer.root.dataset.open = "false";
    runtime.viewer.promptRequestId++;
    runtime.viewer.renderRequestId++;
    clearViewerPromptLoadingTimer();
    runtime.viewer.body.dataset.prompts = "false";
    runtime.viewer.promptPanel.hidden = true;
    discardStagedMedia(runtime.viewer.pendingMedia);
    runtime.viewer.pendingMedia = null;
    runtime.viewer.media.querySelector("video, audio")?.pause();
    runtime.viewer.media.replaceChildren();
    runtime.viewer.item = null;
    runtime.viewer.items = [];
    runtime.viewer.index = -1;
    resetViewerImageView(state.scaleViewerMedia ? "fit" : "native");
  }
  
  function openViewer(item, thumbnail) {
    const currentViewer = ensureViewer();
    const items = filteredItems();
    const index = Math.max(0, items.findIndex((current) => current.key === item.key));
    currentViewer.items = items;
    currentViewer.index = index;
    resetViewerImageView(state.scaleViewerMedia ? "fit" : "native");
    currentViewer.title.textContent = item.filename;
    currentViewer.root.dataset.open = "true";
    currentViewer.root.focus({ preventScroll: true });
    renderViewerItem(item, thumbnail);
    updateViewerPromptPanel();
  }
  
  function showViewerRelative(direction) {
    if (!runtime.viewer || runtime.viewer.root.dataset.open !== "true") return;
    syncViewerItems();
  
    const nextIndex = runtime.viewer.index + direction;
    if (nextIndex < 0 || nextIndex >= runtime.viewer.items.length) return;
  
    runtime.viewer.index = nextIndex;
    renderViewerItem(runtime.viewer.items[nextIndex]);
    updateViewerPromptPanel();
  }
  
  function syncViewerNav() {
    if (!runtime.viewer) return;
    runtime.viewer.prevButton.disabled = runtime.viewer.index <= 0;
    runtime.viewer.nextButton.disabled = runtime.viewer.index >= runtime.viewer.items.length - 1;
  }
  
  function syncViewerItems() {
    if (!runtime.viewer || runtime.viewer.root.dataset.open !== "true" || !runtime.viewer.item) return;
  
    const items = filteredItems();
    const index = items.findIndex((current) => current.key === runtime.viewer.item.key);
    let replacedCurrentItem = false;
    runtime.viewer.items = items;
    if (index !== -1) {
      replacedCurrentItem = runtime.viewer.item.id !== items[index].id;
      runtime.viewer.index = index;
      runtime.viewer.item = items[index];
    } else {
      runtime.viewer.index = Math.min(runtime.viewer.index, Math.max(0, items.length - 1));
    }
    syncViewerNav();
  
    if (replacedCurrentItem) {
      renderViewerItem(runtime.viewer.item);
      updateViewerPromptPanel();
    }
  }
  
  function handleViewerControlKeydown(event) {
    if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!event.target.closest?.(".cmf-viewer")) return;
  
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function isViewerPlaybackShortcutControl(target) {
    return Boolean(target?.closest?.("button, a, input, textarea, select, [contenteditable='true'], [role='button']"));
  }

  function toggleViewerMediaPlayback() {
    const media = runtime.viewer?.media?.querySelector("video, audio");
    if (!media) return false;

    if (media.paused) {
      media.play().catch(() => {});
    } else {
      media.pause();
    }
    return true;
  }
  
  function handleViewerGlobalKeydown(event) {
    if (!isViewerOpen()) return;
  
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeViewer();
      return;
    }
  
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === " " || event.key === "Spacebar" || event.code === "Space") {
      if (isViewerPlaybackShortcutControl(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) toggleViewerMediaPlayback();
      return;
    }
  
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopImmediatePropagation();
      showViewerRelative(-1);
      return;
    }
  
    if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopImmediatePropagation();
      showViewerRelative(1);
    }
  }
  
  function handleViewerWheel(event) {
    if (!runtime.viewer || runtime.viewer.root.dataset.open !== "true") return;
    if (event.target instanceof Element && event.target.closest(".cmf-prompt-panel")) return;
  
    const image = getViewerImage();
    if ((event.ctrlKey || event.metaKey) && image) {
      event.preventDefault();
      event.stopPropagation();
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (delta) {
        const factor = delta < 0 ? VIEWER_IMAGE_WHEEL_ZOOM_FACTOR : 1 / VIEWER_IMAGE_WHEEL_ZOOM_FACTOR;
        setViewerImageZoom(runtime.viewer.imageZoom * factor, { x: event.clientX, y: event.clientY });
      }
      return;
    }
  
    if (Math.abs(event.deltaY) < 8 && Math.abs(event.deltaX) < 8) return;
  
    event.preventDefault();
    event.stopPropagation();
    if (runtime.viewerWheelLock) return;
  
    runtime.viewerWheelLock = true;
    window.setTimeout(() => {
      runtime.viewerWheelLock = false;
    }, 70);
  
    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    showViewerRelative(dominantDelta > 0 ? 1 : -1);
  }
  
  Object.assign(actions, {
    ensureViewer,
    syncViewerScaleMedia,
    syncViewerMetadataPosition,
    syncViewerMetadataToggle,
    closeViewer,
    openViewer,
    showViewerRelative,
    syncViewerNav,
    syncViewerItems,
    handleViewerControlKeydown,
    isViewerPlaybackShortcutControl,
    toggleViewerMediaPlayback,
    handleViewerGlobalKeydown,
    handleViewerWheel,
  });
}
