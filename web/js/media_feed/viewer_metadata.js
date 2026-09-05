import {
  VIEWER_METADATA_LOADING_DELAY_MS,
} from "./constants.js";

const VIEWER_METADATA_KINDS = new Set(["image", "video", "audio"]);

export function installViewerMetadata(context) {
  const { app, api, ICONS, state, runtime, actions } = context;
  const { getCachedPromptMetadata, loadPromptMetadata } = context.services;

  const rememberMediaDimensions = (...args) => actions.rememberMediaDimensions(...args);
  const formatAllViewerMetadata = (...args) => actions.formatAllViewerMetadata(...args);
  const viewerMediaNaturalSize = (...args) => actions.viewerMediaNaturalSize(...args);
  function resetViewerPromptPanel(status = "") {
    if (!runtime.viewer) return;
    clearViewerPromptLoadingTimer();
    runtime.viewer.promptPanel.dataset.loading = "false";
    runtime.viewer.promptPanel.dataset.rendered = "false";
    runtime.viewer.promptPanel.setAttribute("aria-busy", "false");
    runtime.viewer.lastPromptMetadata = null;
    runtime.viewer.lastPromptMetadataItemId = "";
    runtime.viewer.lastMetadataDetails = [];
    runtime.viewer.pendingPromptMetadataResult = null;
    runtime.viewer.promptStatus.textContent = status;
    runtime.viewer.scanFullMetadataButton.hidden = true;
    runtime.viewer.scanFullMetadataButton.disabled = false;
    runtime.viewer.copyAllMetadataButton.disabled = true;
    runtime.viewer.downloadMetadataButton.disabled = true;
    runtime.viewer.resourcesGrid.replaceChildren();
    runtime.viewer.resourcesSection.hidden = true;
    runtime.viewer.metadataGrid.replaceChildren();
    runtime.viewer.metadataSection.hidden = true;
    runtime.viewer.promptSeed.textContent = "";
    runtime.viewer.promptPositive.textContent = "";
    runtime.viewer.promptNegative.textContent = "";
  }
  
  function clearViewerPromptLoadingTimer() {
    if (!runtime.viewer?.promptLoadingTimer) return;
    window.clearTimeout(runtime.viewer.promptLoadingTimer);
    runtime.viewer.promptLoadingTimer = 0;
  }
  
  function beginViewerPromptPanelLoading() {
    if (!runtime.viewer) return;
  
    const hasRenderedMetadata = runtime.viewer.promptPanel.dataset.rendered === "true";
    if (!hasRenderedMetadata) resetViewerPromptPanel();
    clearViewerPromptLoadingTimer();
    runtime.viewer.lastPromptMetadata = null;
    runtime.viewer.lastPromptMetadataItemId = "";
    runtime.viewer.lastMetadataDetails = [];
    runtime.viewer.pendingPromptMetadataResult = null;
    runtime.viewer.promptStatus.textContent = "";
    runtime.viewer.scanFullMetadataButton.hidden = true;
    runtime.viewer.scanFullMetadataButton.disabled = false;
    runtime.viewer.copyAllMetadataButton.disabled = true;
    runtime.viewer.downloadMetadataButton.disabled = true;
    runtime.viewer.promptPanel.setAttribute("aria-busy", "true");
    if (!hasRenderedMetadata) {
      runtime.viewer.promptPanel.dataset.loading = "true";
      return;
    }
  
    // Fast local Range reads usually finish before this delay. Keeping the
    // existing layout until then avoids a blank intermediate frame.
    runtime.viewer.promptPanel.dataset.loading = "false";
    runtime.viewer.promptLoadingTimer = window.setTimeout(() => {
      runtime.viewer.promptLoadingTimer = 0;
      if (runtime.viewer?.promptPanel.getAttribute("aria-busy") === "true") {
        runtime.viewer.promptPanel.dataset.loading = "true";
      }
    }, VIEWER_METADATA_LOADING_DELAY_MS);
  }
  
  function prefetchPromptMetadata(item) {
    if (!item || !VIEWER_METADATA_KINDS.has(item.kind) || getCachedPromptMetadata(item)) return;
    loadPromptMetadata(item).catch(() => {});
  }
  
  function prefetchAdjacentViewerPromptMetadata() {
    if (!runtime.viewer || !state.showPrompts || runtime.viewer.root.dataset.open !== "true") return;
    for (const index of [runtime.viewer.index - 1, runtime.viewer.index + 1]) {
      if (index >= 0 && index < runtime.viewer.items.length) prefetchPromptMetadata(runtime.viewer.items[index]);
    }
  }
  
  function currentViewerMediaDetails() {
    if (!runtime.viewer?.media) return [];
  
    const element = runtime.viewer.media.querySelector("img, video");
    if (element?.dataset.mediaItemKey !== runtime.viewer.item?.key) {
      const cachedSize = runtime.mediaDimensionCache.get(runtime.viewer.item?.key);
      if (!cachedSize?.width || !cachedSize?.height) return [];
      return [
        { label: "Width", value: String(cachedSize.width) },
        { label: "Height", value: String(cachedSize.height) },
      ];
    }
    const naturalSize = viewerMediaNaturalSize(element);
    if (naturalSize.width && naturalSize.height) rememberMediaDimensions(runtime.viewer.item, element);
    const size = naturalSize.width && naturalSize.height
      ? naturalSize
      : runtime.mediaDimensionCache.get(runtime.viewer.item?.key) || { width: 0, height: 0 };
    if (!size.width || !size.height) return [];
  
    return [
      { label: "Width", value: String(size.width) },
      { label: "Height", value: String(size.height) },
    ];
  }
  
  function appendMetadataDetails(details, fallbackDetails, preferredLabels = []) {
    const preferred = new Set(preferredLabels.map((label) => String(label).toLowerCase()));
    const usedLabels = new Set();
    const results = [];
  
    for (const entry of details) {
      const label = String(entry?.label || "").trim();
      const value = String(entry?.value || "").trim();
      if (!label || !value || preferred.has(label.toLowerCase())) continue;
      usedLabels.add(label.toLowerCase());
      results.push({ label, value });
    }
  
    for (const entry of fallbackDetails) {
      const label = String(entry?.label || "").trim();
      const value = String(entry?.value || "").trim();
      if (!label || !value || usedLabels.has(label.toLowerCase())) continue;
      usedLabels.add(label.toLowerCase());
      results.push({ label, value });
    }
  
    return results;
  }
  
  function refreshViewerPromptPanelDetails() {
    const pending = runtime.viewer?.pendingPromptMetadataResult;
    if (pending && pending.itemId === runtime.viewer.item?.id && runtime.viewer.mediaReadyItemId === pending.itemId) {
      runtime.viewer.pendingPromptMetadataResult = null;
      renderPromptMetadata(pending.result, pending.itemId);
      return;
    }
  
    if (!runtime.viewer?.lastPromptMetadata || runtime.viewer.root.dataset.open !== "true") return;
    if (runtime.viewer.lastPromptMetadataItemId !== runtime.viewer.item?.id) return;
    renderPromptMetadata(runtime.viewer.lastPromptMetadata);
  }
  
  function renderPromptMetadataWhenMediaReady(result, item) {
    if (!runtime.viewer || runtime.viewer.item?.id !== item?.id) return;
    const needsMediaDetails = item.kind === "image" || item.kind === "video";
    if (needsMediaDetails && runtime.viewer.mediaReadyItemId !== item.id) {
      runtime.viewer.pendingPromptMetadataResult = { result, itemId: item.id };
      return;
    }
  
    runtime.viewer.pendingPromptMetadataResult = null;
    renderPromptMetadata(result, item.id);
  }
  
  function appendMetadataChips(grid, entries, chipClassName, labelClassName, options = {}) {
    for (const entry of entries) {
      const label = String(entry?.label || "").trim();
      const value = String(entry?.value || "").trim();
      if (options.skipSeed && label.toLowerCase() === "seed") continue;
      if (!label || !value) continue;
  
      const chip = document.createElement("span");
      chip.className = chipClassName;
  
      const labelElement = document.createElement("span");
      labelElement.className = labelClassName;
      labelElement.textContent = label;
      chip.append(labelElement, `: ${value}`);
      grid.appendChild(chip);
    }
  }
  
  function renderPromptMetadata(result, itemId = runtime.viewer?.item?.id || "") {
    if (!runtime.viewer) return;
    clearViewerPromptLoadingTimer();
    runtime.viewer.promptPanel.dataset.loading = "false";
    runtime.viewer.promptPanel.dataset.rendered = "true";
    runtime.viewer.promptPanel.setAttribute("aria-busy", "false");
    runtime.viewer.lastPromptMetadata = result;
    runtime.viewer.lastPromptMetadataItemId = itemId;
    runtime.viewer.promptStatus.textContent = result.status || "";
    runtime.viewer.scanFullMetadataButton.hidden = !result.requiresFullScan;
    runtime.viewer.scanFullMetadataButton.disabled = false;
    runtime.viewer.resourcesGrid.replaceChildren();
    runtime.viewer.metadataGrid.replaceChildren();
  
    appendMetadataChips(
      runtime.viewer.resourcesGrid,
      Array.isArray(result.resources) ? result.resources : [],
      "cmf-resource-chip",
      "cmf-resource-chip-label",
    );
    runtime.viewer.resourcesSection.hidden = !runtime.viewer.resourcesGrid.childElementCount;
  
    const details = appendMetadataDetails(
      Array.isArray(result.details) ? result.details : [],
      currentViewerMediaDetails(),
      // Workflow metadata can describe a pre-upscale latent; the rendered media is authoritative.
      runtime.viewer.item?.kind === "image" || runtime.viewer.item?.kind === "video" ? ["Width", "Height"] : [],
    );
    runtime.viewer.lastMetadataDetails = details;
    appendMetadataChips(
      runtime.viewer.metadataGrid,
      details,
      "cmf-metadata-chip",
      "cmf-metadata-chip-label",
      { skipSeed: true },
    );
  
    runtime.viewer.metadataSection.hidden = !runtime.viewer.metadataGrid.childElementCount;
    runtime.viewer.promptSeed.textContent = result.seed || "(not found)";
    runtime.viewer.promptPositive.textContent = result.positive || "(not found)";
    runtime.viewer.promptNegative.textContent = result.negative || "(not found)";
    runtime.viewer.copyAllMetadataButton.disabled = !formatAllViewerMetadata(result, details);
    runtime.viewer.downloadMetadataButton.disabled = !Object.keys(result.embeddedJson || {}).length;
  }
  
  async function scanFullViewerMetadata(event) {
    event.currentTarget.blur();
    if (!runtime.viewer || runtime.viewer.root.dataset.open !== "true" || !runtime.viewer.item) return;
  
    const currentViewer = runtime.viewer;
    const item = currentViewer.item;
    const requestId = ++currentViewer.promptRequestId;
    currentViewer.scanFullMetadataButton.disabled = true;
    currentViewer.promptStatus.textContent = "Reading the full file for embedded metadata...";
  
    try {
      const result = await loadPromptMetadata(item, { fullScan: true });
      if (!runtime.viewer || runtime.viewer !== currentViewer || requestId !== currentViewer.promptRequestId || currentViewer.item?.id !== item.id) return;
      renderPromptMetadata(result, item.id);
    } catch {
      if (!runtime.viewer || runtime.viewer !== currentViewer || requestId !== currentViewer.promptRequestId || currentViewer.item?.id !== item.id) return;
      renderPromptMetadata({
        seed: "",
        positive: "",
        negative: "",
        resources: [],
        details: [],
        status: "Could not read embedded prompt metadata.",
        requiresFullScan: false,
      }, item.id);
    }
  }
  
  function updateViewerPromptPanel() {
    if (!runtime.viewer || runtime.viewer.root.dataset.open !== "true") return;
  
    const item = runtime.viewer.item;
    const shouldShow = state.showPrompts && (item?.kind === "image" || item?.kind === "video" || item?.kind === "audio");
    runtime.viewer.promptRequestId++;
    runtime.viewer.body.dataset.prompts = String(shouldShow);
    runtime.viewer.promptPanel.hidden = !shouldShow;
  
    if (!shouldShow) {
      resetViewerPromptPanel();
      return;
    }
  
    const requestId = runtime.viewer.promptRequestId;
    const cached = getCachedPromptMetadata(item);
    if (cached) {
      renderPromptMetadataWhenMediaReady(cached, item);
      prefetchAdjacentViewerPromptMetadata();
      return;
    }
  
    beginViewerPromptPanelLoading();
  
    loadPromptMetadata(item)
      .then((result) => {
        if (!runtime.viewer || requestId !== runtime.viewer.promptRequestId || runtime.viewer.item?.id !== item.id) return;
        renderPromptMetadataWhenMediaReady(result, item);
        prefetchAdjacentViewerPromptMetadata();
      })
      .catch(() => {
        if (!runtime.viewer || requestId !== runtime.viewer.promptRequestId || runtime.viewer.item?.id !== item.id) return;
        renderPromptMetadataWhenMediaReady({
          seed: "",
          positive: "",
          negative: "",
          resources: [],
          details: [],
          status: "Could not read embedded prompt metadata.",
        }, item);
      });
  }
  
  Object.assign(actions, {
    resetViewerPromptPanel,
    clearViewerPromptLoadingTimer,
    beginViewerPromptPanelLoading,
    prefetchPromptMetadata,
    prefetchAdjacentViewerPromptMetadata,
    currentViewerMediaDetails,
    appendMetadataDetails,
    refreshViewerPromptPanelDetails,
    renderPromptMetadataWhenMediaReady,
    appendMetadataChips,
    renderPromptMetadata,
    scanFullViewerMetadata,
    updateViewerPromptPanel,
  });
}
