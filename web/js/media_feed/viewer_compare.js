import { installViewerZoom } from "./viewer_zoom.js";
import { installViewerSupport } from "./viewer_support.js";
import { installViewerRender } from "./viewer_render.js";
import { installViewerMetadata } from "./viewer_metadata.js";
import { VIEWER_IMAGE_ZOOM_STEP, VIEWER_IMAGE_WHEEL_ZOOM_FACTOR } from "./constants.js";

// Store zoom relative to the fitted size and pan as fractions of the media,
// so different resolutions and aspect ratios can share a viewing position.
export function captureComparisonView(pane, controller, fitPercent) {
  const media = controller.getViewerScalableMedia();
  if (!media) return null;
  const natural = controller.viewerMediaNaturalSize(media);
  const frame = pane.media.getBoundingClientRect();
  const fit = Math.min(frame.width / natural.width, frame.height / natural.height) * fitPercent / 100;
  if (!Number.isFinite(fit) || fit <= 0) return null;
  const scale = (pane.imageBaseMode === "fit" ? fit : 1) * pane.imageZoom;
  return {
    zoom: scale / fit,
    x: pane.imagePanX / (natural.width * scale),
    y: pane.imagePanY / (natural.height * scale),
  };
}

export function applyComparisonView(pane, controller, view, fitPercent) {
  if (!view) return;
  const media = controller.getViewerScalableMedia();
  if (!media) return;
  const natural = controller.viewerMediaNaturalSize(media);
  const frame = pane.media.getBoundingClientRect();
  const fit = Math.min(frame.width / natural.width, frame.height / natural.height) * fitPercent / 100;
  if (!Number.isFinite(fit) || fit <= 0) return;
  pane.imageBaseMode = "fit";
  pane.imageZoom = controller.clampViewerImageZoom(view.zoom);
  pane.imagePanX = view.x * natural.width * fit * pane.imageZoom;
  pane.imagePanY = view.y * natural.height * fit * pane.imageZoom;
  controller.updateViewerImageLayout();
}

export function installViewerCompare(context) {
  const { actions, runtime, state, ICONS } = context;

  function setupViewerComparison(viewer) {
    const bar = viewer.root.querySelector(".cmf-viewer-bar");
    const close = bar.querySelector(".cmf-close");
    const leftHeader = document.createElement("div");
    leftHeader.className = "cmf-viewer-pane-bar";
    for (const child of [...bar.children]) {
      if (child !== close) leftHeader.append(child);
    }
    const rightHeader = leftHeader.cloneNode(true);
    rightHeader.classList.add("cmf-viewer-reference-bar");
    rightHeader.hidden = true;
    const pin = document.createElement("span");
    pin.className = "cmf-viewer-pin";
    pin.innerHTML = ICONS.pin;
    pin.title = "Pinned comparison media";
    pin.setAttribute("aria-label", pin.title);
    rightHeader.prepend(pin);
    const globalControls = document.createElement("div");
    globalControls.className = "cmf-viewer-global-controls";
    const compare = document.createElement("button");
    compare.className = "cmf-button cmf-icon-button cmf-viewer-compare";
    compare.type = "button";
    compare.innerHTML = ICONS.compare;
    compare.title = "Compare media";
    compare.setAttribute("aria-label", compare.title);
    compare.setAttribute("aria-pressed", "false");
    globalControls.append(compare, close);
    bar.append(leftHeader, rightHeader, globalControls);

    const leftPane = document.createElement("section");
    leftPane.className = "cmf-viewer-pane";
    leftPane.setAttribute("aria-label", "Browsing media");
    const leftStage = document.createElement("div");
    leftStage.className = "cmf-viewer-media-stage";
    leftStage.append(...viewer.main.children);
    leftPane.append(leftStage);
    const rightPane = document.createElement("section");
    rightPane.className = "cmf-viewer-pane cmf-viewer-reference";
    rightPane.setAttribute("aria-label", "Pinned comparison media");
    rightPane.hidden = true;
    const rightStage = document.createElement("div");
    rightStage.className = "cmf-viewer-media-stage";
    const media = document.createElement("div");
    media.className = "cmf-viewer-media";
    rightStage.append(media);
    const rightPanel = viewer.promptPanel.cloneNode(true);
    rightPanel.setAttribute("aria-label", "Pinned media metadata");
    const rightShowMetadataButton = viewer.showMetadataButton.cloneNode(true);
    rightPane.append(rightStage, rightPanel, rightShowMetadataButton);
    viewer.main.append(leftPane, rightPane);

    // Header geometry follows the actual media panes, including metadata placement.
    // The global controls keep their own fixed space at the right edge.
    function arrangeHeader(header) {
      const identity = document.createElement("div");
      identity.className = "cmf-viewer-pane-identity";
      const pin = header.querySelector(".cmf-viewer-pin");
      if (pin) identity.append(pin);
      identity.append(header.querySelector(".cmf-viewer-title"));
      const controls = document.createElement("div");
      controls.className = "cmf-viewer-pane-actions";
      controls.append(...header.querySelectorAll(".cmf-viewer-favorite, .cmf-viewer-download, .cmf-viewer-copy-image, .cmf-open-link"));
      const more = document.createElement("details");
      more.className = "cmf-viewer-more";
      const summary = document.createElement("summary");
      summary.className = "cmf-button cmf-icon-button";
      summary.textContent = "⋯";
      summary.title = "More media controls";
      summary.setAttribute("aria-label", summary.title);
      summary.setAttribute("role", "button");
      const menu = document.createElement("div");
      menu.className = "cmf-viewer-more-menu";
      more.append(summary, menu);
      controls.append(more);
      header.querySelector(".cmf-spacer")?.remove();
      header.prepend(identity);
      header.append(controls);
      const movable = [...header.querySelectorAll(".cmf-viewer-native, .cmf-viewer-zoom-out, .cmf-viewer-zoom-in, .cmf-viewer-download, .cmf-viewer-copy-image, .cmf-open-link")].map(button => {
        const marker = document.createComment("media control position");
        button.after(marker);
        const label = document.createElement("span");
        label.className = "cmf-viewer-overflow-label";
        label.textContent = button.title;
        button.append(label);
        return { button, marker };
      });
      let compact;
      return (width) => {
        const next = width < 620;
        if (next === compact) return;
        compact = next;
        header.dataset.compact = String(compact);
        more.hidden = !compact;
        more.open = false;
        for (const { button, marker } of movable) {
          if (compact) menu.append(button);
          else marker.before(button);
        }
      };
    }
    const layoutLeft = arrangeHeader(leftHeader);
    const layoutRight = arrangeHeader(rightHeader);
    function layoutHeaders() {
      if (viewer.root.dataset.open !== "true") return;
      const barRect = bar.getBoundingClientRect();
      const globalRect = globalControls.getBoundingClientRect();
      const mainRect = viewer.main.getBoundingClientRect();
      // Match the divider drawn at 50% of the media area, not the right pane's
      // edge, which sits half the grid gap away from that divider.
      const divider = mainRect.left - barRect.left + mainRect.width / 2;
      const panes = viewer.comparing
        ? [[leftHeader, leftPane, layoutLeft], [rightHeader, rightPane, layoutRight]]
        : [[leftHeader, null, layoutLeft]];
      for (const [header, pane, layout] of panes) {
        const rect = pane?.getBoundingClientRect();
        const paneLeft = rect ? rect.left - barRect.left : 12;
        const paneRight = rect ? rect.right - barRect.left : barRect.width;
        const left = viewer.comparing && header === rightHeader ? divider : paneLeft;
        const right = Math.min(viewer.comparing && header === leftHeader ? divider : paneRight, globalRect.left - barRect.left - 8);
        const width = Math.max(0, right - left);
        header.style.left = `${left}px`;
        header.style.width = `${width}px`;
        layout(width);
      }
    }
    const headerObserver = new ResizeObserver(layoutHeaders);
    for (const element of [bar, viewer.main, leftPane, rightPane, globalControls]) headerObserver.observe(element);
    // Moving metadata from right to left can move a pane without resizing it.
    const headerPositionObserver = new MutationObserver(layoutHeaders);
    headerPositionObserver.observe(viewer.body, { attributes: true });
    viewer.root.addEventListener("click", (event) => {
      for (const menu of bar.querySelectorAll(".cmf-viewer-more[open]")) {
        if (!menu.contains(event.target)) menu.open = false;
      }
    });

    const reference = {
      root: viewer.root, media, item: null, isComparisonPane: true,
      imageBaseMode: "fit", imageZoom: 1, imagePanX: 0, imagePanY: 0,
      renderRequestId: 0, pendingMedia: null,
      body: rightPane,
      promptPanel: rightPanel,
      promptStatus: rightPanel.querySelector(".cmf-prompt-status"),
      scanFullMetadataButton: rightPanel.querySelector(".cmf-scan-full-metadata"),
      copyAllMetadataButton: rightPanel.querySelector(".cmf-copy-all"),
      downloadMetadataButton: rightPanel.querySelector(".cmf-download-json"),
      resourcesSection: rightPanel.querySelector(".cmf-resources-section"),
      resourcesGrid: rightPanel.querySelector(".cmf-resource-grid"),
      metadataSection: rightPanel.querySelector(".cmf-metadata-section"),
      metadataGrid: rightPanel.querySelector(".cmf-metadata-grid"),
      promptSeed: rightPanel.querySelector(".cmf-seed-text"),
      promptPositive: rightPanel.querySelector(".cmf-prompt-positive"),
      promptNegative: rightPanel.querySelector(".cmf-prompt-negative"),
      hideMetadataButton: rightPanel.querySelector(".cmf-hide-metadata"),
      showMetadataButton: rightShowMetadataButton,
      promptRequestId: 0,
      promptLoadingTimer: 0,
      mediaReadyItemId: "",
      lastPromptMetadataItemId: "",
      lastMetadataDetails: [],
      items: [], index: -1,
    };
    for (const [key, selector] of Object.entries({
      title: ".cmf-viewer-title", openLink: ".cmf-open-link",
      favoriteButton: ".cmf-viewer-favorite", copyImageButton: ".cmf-viewer-copy-image",
      downloadButton: ".cmf-viewer-download", zoomControls: ".cmf-viewer-zoom-controls",
      fitButton: ".cmf-viewer-fit", nativeButton: ".cmf-viewer-native",
      zoomOutButton: ".cmf-viewer-zoom-out", zoomInButton: ".cmf-viewer-zoom-in",
      zoomLevel: ".cmf-viewer-zoom-level",
    })) reference[key] = rightHeader.querySelector(selector);

    // Each pane owns its controller state; async renders never swap the main viewer.
    const controller = { ...actions };
    const referenceContext = { ...context, runtime: { ...runtime, viewer: reference }, actions: controller };
    installViewerSupport(referenceContext);
    installViewerZoom(referenceContext);
    installViewerRender(referenceContext);
    installViewerMetadata(referenceContext);
    controller.ensureViewer = () => reference;
    controller.syncViewerNav = () => {};
    reference.favoriteButton.addEventListener("click", () => actions.toggleFavorite(reference.item));
    reference.downloadButton.addEventListener("click", controller.downloadViewerMedia);
    reference.copyImageButton.addEventListener("click", controller.copyViewerImage);
    reference.fitButton.addEventListener("click", () => controller.setViewerImageBaseMode("fit"));
    reference.nativeButton.addEventListener("click", () => controller.setViewerImageBaseMode("native"));
    reference.zoomOutButton.addEventListener("click", () => controller.setViewerImageZoom(reference.imageZoom - VIEWER_IMAGE_ZOOM_STEP));
    reference.zoomInButton.addEventListener("click", () => controller.setViewerImageZoom(reference.imageZoom + VIEWER_IMAGE_ZOOM_STEP));
    for (const button of [reference.hideMetadataButton, reference.showMetadataButton]) {
      button.addEventListener("click", () => setComparisonMetadataVisible("right", !reference.showPrompts));
    }
    for (const [selector, callback] of [
      [".cmf-copy-seed", (event) => controller.copyPromptText(event, reference.promptSeed)],
      [".cmf-copy-positive", (event) => controller.copyPromptText(event, reference.promptPositive)],
      [".cmf-copy-negative", (event) => controller.copyPromptText(event, reference.promptNegative)],
      [".cmf-copy-all", controller.copyAllViewerMetadata],
      [".cmf-copy-resources", controller.copyViewerResources],
      [".cmf-copy-other-metadata", controller.copyViewerOtherMetadata],
      [".cmf-download-json", controller.downloadViewerEmbeddedJson],
      [".cmf-scan-full-metadata", controller.scanFullViewerMetadata],
    ]) rightPanel.querySelector(selector).addEventListener("click", callback);

    function setComparisonMetadataVisible(side, visible) {
      const pane = side === "left" ? viewer : reference;
      const container = side === "left" ? leftPane : rightPane;
      pane.showPrompts = visible;
      container.dataset.prompts = String(visible);
      pane.hideMetadataButton.hidden = !visible;
      pane.showMetadataButton.hidden = visible;
      pane.hideMetadataButton.setAttribute("aria-pressed", String(visible));
      pane.showMetadataButton.setAttribute("aria-pressed", String(visible));
      (side === "left" ? actions : controller).updateViewerPromptPanel();
    }
    viewer.setComparisonMetadataVisible = setComparisonMetadataVisible;
    rightPane.addEventListener("wheel", (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (delta) controller.setViewerImageZoom(reference.imageZoom * (delta < 0 ? VIEWER_IMAGE_WHEEL_ZOOM_FACTOR : 1 / VIEWER_IMAGE_WHEEL_ZOOM_FACTOR), { x: event.clientX, y: event.clientY });
    }, { passive: false });

    let sharedView = null;
    const capture = (pane, owner) => captureComparisonView(pane, owner, state.viewerFitScale);
    const apply = (pane, owner, view) => applyComparisonView(pane, owner, view, state.viewerFitScale);
    function changed(pane, owner, other, otherOwner) {
      if (!viewer.comparing) return;
      sharedView = capture(pane, owner) || sharedView;
      apply(other, otherOwner, sharedView);
    }
    viewer.onViewChange = () => changed(viewer, actions, reference, controller);
    reference.onViewChange = () => changed(reference, controller, viewer, actions);
    viewer.restoreView = () => {
      if (viewer.comparing) apply(viewer, actions, sharedView);
    };
    reference.restoreView = () => {
      if (viewer.comparing) apply(reference, controller, sharedView);
    };
    const observer = new ResizeObserver(() => {
      controller.updateViewerImageLayout();
      if (viewer.comparing) {
        apply(viewer, actions, sharedView);
        apply(reference, controller, sharedView);
      }
    });
    observer.observe(media);
    viewer.reference = reference;
    viewer.stopComparison = ({ closing = false } = {}) => {
      viewer.comparing = false;
      viewer.root.dataset.comparing = "false";
      reference.promptRequestId++;
      controller.clearViewerPromptLoadingTimer();
      reference.renderRequestId++;
      actions.clearViewerAudioWaveform(reference);
      actions.discardStagedMedia(reference.pendingMedia);
      actions.discardStagedMedia(reference.media.querySelector("video, audio"));
      reference.pendingMedia = null;
      reference.media.replaceChildren();
      reference.item = null;
      reference.imageDrag = null;
      if (viewer.item?.kind === "video") {
        viewer.imagePanX = 0;
        viewer.imagePanY = 0;
        viewer.imageDrag = null;
      }
      rightPanel.hidden = true;
      viewer.body.append(viewer.promptPanel, viewer.showMetadataButton);
      rightPane.hidden = rightHeader.hidden = true;
      compare.setAttribute("aria-pressed", "false");
      actions.syncViewerMetadataPosition();
      actions.syncViewerMetadataToggle();
      if (!closing && viewer.root.dataset.open === "true") actions.updateViewerPromptPanel();
      actions.updateViewerImageLayout();
      layoutHeaders();
    };
    compare.addEventListener("click", () => {
      compare.blur();
      if (viewer.comparing) return viewer.stopComparison();
      if (!viewer.item) return;
      sharedView = capture(viewer, actions) || { zoom: 1, x: 0, y: 0 };
      viewer.comparing = true;
      viewer.root.dataset.comparing = "true";
      compare.setAttribute("aria-pressed", "true");
      rightPane.hidden = rightHeader.hidden = false;
      leftPane.append(viewer.promptPanel, viewer.showMetadataButton);
      viewer.hideMetadataButton.innerHTML = ICONS.panelLeftClose;
      viewer.showMetadataButton.innerHTML = ICONS.panelLeftOpen;
      reference.hideMetadataButton.innerHTML = ICONS.panelLeftClose;
      reference.showMetadataButton.innerHTML = ICONS.panelLeftOpen;
      setComparisonMetadataVisible("left", state.showPrompts);
      layoutHeaders();
      reference.imageBaseMode = "fit";
      reference.imageZoom = 1;
      reference.imagePanX = reference.imagePanY = 0;
      apply(viewer, actions, sharedView);
      const playback = viewer.media.querySelector("video, audio");
      const playbackTime = playback?.currentTime || 0;
      const rendering = controller.renderViewerItem({ ...viewer.item });
      setComparisonMetadataVisible("right", state.showPrompts);
      const requestId = reference.renderRequestId;
      rendering.then(() => {
        if (!viewer.comparing || reference.renderRequestId !== requestId) return;
        const pinnedPlayback = reference.media.querySelector("video, audio");
        if (pinnedPlayback && playbackTime && pinnedPlayback.readyState >= 1) {
          pinnedPlayback.currentTime = playbackTime;
        }
      });
    });

  }

  Object.assign(actions, {
    setupViewerComparison,
    setComparisonMetadataVisible: (...args) => runtime.viewer?.setComparisonMetadataVisible(...args),
  });
}
