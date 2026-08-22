import {
  FALLBACK_ROOT_ID,
  FALLBACK_EDGE_GAP,
  FALLBACK_MIN_LEFT_INSET,
  FALLBACK_MIN_RIGHT_INSET,
  FALLBACK_MIN_BOTTOM_INSET,
  FALLBACK_BOTTOM_PLACEMENT_GAP,
  FALLBACK_MIN_TOP_INSET,
  FALLBACK_MIN_BOTTOM_RIGHT_INSET,
  FALLBACK_MIN_RIGHT_BOTTOM_INSET,
  FLOATING_CANVAS_CONTROLS_MARGIN,
  FLOATING_TOP_PROGRESS_MARGIN,
  FLOATING_CANVAS_CONTROLS_SELECTOR,
  FLOATING_TOP_PROGRESS_SELECTOR,
} from "./constants.js";

export function installFloatingPanel(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const createView = (...args) => actions.createView(...args);
  const applyFallbackPlacement = (...args) => actions.applyFallbackPlacement(...args);
  const updateView = (...args) => actions.updateView(...args);
  function createFloatingPanel() {
    if (runtime.floatingView) return runtime.floatingView;
    if (document.getElementById(FALLBACK_ROOT_ID)) return runtime.floatingView;
  
    const root = document.createElement("div");
    root.id = FALLBACK_ROOT_ID;
    document.body.appendChild(root);
    const view = createView(root, "floating");
    runtime.floatingView = view;
  
    const collapseButton = root.querySelector(".cmf-collapse");
    collapseButton.hidden = false;
    function syncCollapseButton(collapsed) {
      collapseButton.innerHTML = collapsed
        ? `${ICONS.galleryHorizontal}<span class="cmf-collapse-label">Media Feed</span>`
        : ICONS.eyeOff;
      const label = collapsed ? "Show Media Feed" : "Hide Media Feed";
      collapseButton.title = label;
      collapseButton.setAttribute("aria-label", label);
    }
    collapseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const collapsed = root.dataset.collapsed === "true";
      root.dataset.collapsed = String(!collapsed);
      syncCollapseButton(!collapsed);
    });
    root.addEventListener("click", () => {
      if (root.dataset.collapsed !== "true") return;
      root.dataset.collapsed = "false";
      syncCollapseButton(false);
    });
  
    return view;
  }
  
  function floatingWorkspaceTarget() {
    const graphPanel = document.querySelector(".graph-canvas-panel");
    if (graphPanel instanceof Element) return graphPanel;
  
    const canvas = app.canvas?.canvas;
    return canvas instanceof Element ? canvas : null;
  }
  
  function floatingCanvasControls() {
    const minimap = document.querySelector(".minimap-main-container")
      || document.querySelector("[data-testid='minimap-container']");
    const toolbar = document
      .querySelector("[data-testid='toggle-minimap-button']")
      ?.closest("[role='toolbar']");
  
    return [...new Set([minimap, toolbar].filter((element) => element instanceof Element))];
  }
  
  function floatingCanvasControlsBounds() {
    const rects = floatingCanvasControls()
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rects.length) return null;
  
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
  
  function refreshFloatingCanvasControlsObserver() {
    const elements = floatingCanvasControls();
    const unchanged = elements.length === runtime.floatingCanvasControlsElements.length
      && elements.every((element, index) => element === runtime.floatingCanvasControlsElements[index]);
    if (unchanged) return;
  
    runtime.floatingCanvasControlsResizeObserver?.disconnect();
    runtime.floatingCanvasControlsElements = elements;
    runtime.floatingCanvasControlsResizeObserver = elements.length
      ? new ResizeObserver(scheduleFloatingPanelBoundsUpdate)
      : null;
    for (const element of elements) runtime.floatingCanvasControlsResizeObserver?.observe(element);
  }
  
  function nodeContainsFloatingCanvasControls(node) {
    if (!(node instanceof Element)) return false;
    return node.matches(FLOATING_CANVAS_CONTROLS_SELECTOR)
      || Boolean(node.querySelector(FLOATING_CANVAS_CONTROLS_SELECTOR));
  }
  
  function mutationChangesFloatingCanvasControls(mutation) {
    return [...mutation.addedNodes, ...mutation.removedNodes]
      .some(nodeContainsFloatingCanvasControls);
  }
  
  function floatingTopProgressTargets() {
    return [
      document.querySelector("[data-testid='action-bar-card']"),
      document.querySelector("[data-testid='queue-progress-overlay']"),
    ].filter((element) => element instanceof Element);
  }
  
  function floatingTopProgressLeft() {
    const actionBar = document.querySelector("[data-testid='action-bar-card']");
    const progress = document.querySelector("[data-testid='queue-progress-overlay']");
    const progressRect = progress?.getBoundingClientRect();
    if (progressRect?.width > 0 && progressRect.height > 0) return progressRect.left;
  
    const actionBarRect = actionBar?.getBoundingClientRect();
    if (!actionBarRect?.width || !actionBarRect.height) return null;
  
    const hiddenProgressWidth = Number.parseFloat(progress ? getComputedStyle(progress).width : "");
    return Number.isFinite(hiddenProgressWidth) && hiddenProgressWidth > 0
      ? actionBarRect.right - hiddenProgressWidth
      : actionBarRect.left;
  }
  
  function refreshFloatingTopProgressObserver() {
    const elements = floatingTopProgressTargets();
    const unchanged = elements.length === runtime.floatingTopProgressElements.length
      && elements.every((element, index) => element === runtime.floatingTopProgressElements[index]);
    if (unchanged) return;
  
    runtime.floatingTopProgressResizeObserver?.disconnect();
    runtime.floatingTopProgressElements = elements;
    runtime.floatingTopProgressResizeObserver = elements.length
      ? new ResizeObserver(scheduleFloatingPanelBoundsUpdate)
      : null;
    for (const element of elements) runtime.floatingTopProgressResizeObserver?.observe(element);
  }
  
  function nodeContainsFloatingTopProgress(node) {
    if (!(node instanceof Element)) return false;
    return node.matches(FLOATING_TOP_PROGRESS_SELECTOR)
      || Boolean(node.querySelector(FLOATING_TOP_PROGRESS_SELECTOR));
  }
  
  function mutationChangesFloatingTopProgress(mutation) {
    return [...mutation.addedNodes, ...mutation.removedNodes]
      .some(nodeContainsFloatingTopProgress);
  }
  
  function updateFloatingTopControlsInset(root) {
    if (root.dataset.placement !== "top" || window.matchMedia("(max-width: 720px)").matches) {
      root.style.removeProperty("--cmf-top-controls-inset");
      return;
    }
  
    const progressLeft = floatingTopProgressLeft();
    const toolbarRect = root.querySelector(".cmf-toolbar")?.getBoundingClientRect();
    if (!Number.isFinite(progressLeft) || !toolbarRect?.width) {
      root.style.removeProperty("--cmf-top-controls-inset");
      return;
    }
  
    const reservedInset = Math.max(0, toolbarRect.right - progressLeft + FLOATING_TOP_PROGRESS_MARGIN);
    root.style.setProperty("--cmf-top-controls-inset", `${Math.ceil(reservedInset)}px`);
  }
  
  function updateFloatingPanelBounds() {
    runtime.floatingBoundsAnimationFrame = 0;
    const root = runtime.floatingView?.root;
    const target = floatingWorkspaceTarget();
    if (!root || !target) return;
  
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
  
    const leftInset = Math.max(FALLBACK_MIN_LEFT_INSET, rect.left + FALLBACK_EDGE_GAP);
    const rightInset = Math.max(FALLBACK_MIN_RIGHT_INSET, window.innerWidth - rect.right + FALLBACK_EDGE_GAP);
    const bottomInset = Math.max(FALLBACK_MIN_BOTTOM_INSET, window.innerHeight - rect.bottom + FALLBACK_EDGE_GAP);
    const bottomPlacementInset = Math.max(
      FALLBACK_BOTTOM_PLACEMENT_GAP,
      window.innerHeight - rect.bottom + FALLBACK_BOTTOM_PLACEMENT_GAP,
    );
    const controlsBounds = floatingCanvasControlsBounds();
    const bottomFeedRightInset = controlsBounds
      ? Math.max(rightInset, window.innerWidth - controlsBounds.left + FLOATING_CANVAS_CONTROLS_MARGIN)
      : FALLBACK_MIN_BOTTOM_RIGHT_INSET + rightInset - FALLBACK_MIN_RIGHT_INSET;
    const rightFeedBottomInset = controlsBounds
      ? Math.max(bottomInset, window.innerHeight - controlsBounds.top + FLOATING_CANVAS_CONTROLS_MARGIN)
      : FALLBACK_MIN_RIGHT_BOTTOM_INSET + bottomInset - FALLBACK_MIN_BOTTOM_INSET;
  
    root.style.setProperty("--cmf-safe-left", `${Math.round(leftInset)}px`);
    root.style.setProperty("--cmf-edge-right", `${Math.round(rightInset)}px`);
    root.style.setProperty("--cmf-safe-right", `${Math.ceil(bottomFeedRightInset)}px`);
    root.style.setProperty("--cmf-safe-right-bottom", `${Math.ceil(rightFeedBottomInset)}px`);
    root.style.setProperty("--cmf-placement-bottom", `${Math.round(bottomPlacementInset)}px`);
  
    // The graph bounds keep side placements clear of persistent panels. The bottom
    // feed sits just above the graph edge, while bottom and right placements still
    // use the measured canvas controls to avoid horizontal overlap.
    root.style.setProperty("--cmf-safe-bottom", `${Math.round(bottomInset)}px`);
    root.style.setProperty("--cmf-safe-top", `${FALLBACK_MIN_TOP_INSET}px`);
    updateFloatingTopControlsInset(root);
  }
  
  function scheduleFloatingPanelBoundsUpdate() {
    if (runtime.floatingBoundsAnimationFrame) return;
    runtime.floatingBoundsAnimationFrame = window.requestAnimationFrame(updateFloatingPanelBounds);
  }
  
  function watchFloatingPanelBounds() {
    const target = floatingWorkspaceTarget();
    if (target !== runtime.floatingWorkspaceElement) {
      runtime.floatingWorkspaceResizeObserver?.disconnect();
      runtime.floatingWorkspaceElement = target;
      runtime.floatingWorkspaceResizeObserver = target
        ? new ResizeObserver(scheduleFloatingPanelBoundsUpdate)
        : null;
      runtime.floatingWorkspaceResizeObserver?.observe(target);
    }
    refreshFloatingCanvasControlsObserver();
    refreshFloatingTopProgressObserver();
  
    if (!runtime.floatingBoundsWindowListenerAdded) {
      window.addEventListener("resize", scheduleFloatingPanelBoundsUpdate, { passive: true });
      window.visualViewport?.addEventListener("resize", scheduleFloatingPanelBoundsUpdate, { passive: true });
      runtime.floatingBoundsWindowListenerAdded = true;
    }
    if (!runtime.floatingWorkspaceMutationObserver) {
      runtime.floatingWorkspaceMutationObserver = new MutationObserver((mutations) => {
        if (floatingWorkspaceTarget() !== runtime.floatingWorkspaceElement) {
          watchFloatingPanelBounds();
          return;
        }
        if (mutations.some(mutationChangesFloatingCanvasControls)) {
          refreshFloatingCanvasControlsObserver();
          scheduleFloatingPanelBoundsUpdate();
        }
        if (mutations.some(mutationChangesFloatingTopProgress)) {
          refreshFloatingTopProgressObserver();
          scheduleFloatingPanelBoundsUpdate();
        }
      });
      runtime.floatingWorkspaceMutationObserver.observe(document.body, { childList: true, subtree: true });
    }
    scheduleFloatingPanelBoundsUpdate();
  }
  
  function syncFloatingPanel() {
    const view = createFloatingPanel();
    if (!view) return;
    watchFloatingPanelBounds();
    applyFallbackPlacement(view.root);
    updateView(view, false);
  }
  
  Object.assign(actions, {
    createFloatingPanel,
    floatingWorkspaceTarget,
    floatingCanvasControls,
    floatingCanvasControlsBounds,
    refreshFloatingCanvasControlsObserver,
    nodeContainsFloatingCanvasControls,
    mutationChangesFloatingCanvasControls,
    floatingTopProgressTargets,
    floatingTopProgressLeft,
    refreshFloatingTopProgressObserver,
    nodeContainsFloatingTopProgress,
    mutationChangesFloatingTopProgress,
    updateFloatingTopControlsInset,
    updateFloatingPanelBounds,
    scheduleFloatingPanelBoundsUpdate,
    watchFloatingPanelBounds,
    syncFloatingPanel,
  });
}
