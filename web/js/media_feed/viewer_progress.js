const PROGRESS_SELECTOR = '[data-testid="queue-progress-overlay"]';

export function installViewerProgress(context) {
  const { state, runtime, actions } = context;
  let resizeObserver = null;
  let mutationObserver = null;
  let frame = 0;
  let progress = null;
  let offset = 0;

  function clearProgressOffset() {
    progress?.style.removeProperty("--cmf-viewer-progress-offset");
    offset = 0;
  }

  function clearProgressSpace() {
    clearProgressOffset();
    const root = runtime.viewer?.root;
    if (root) delete root.dataset.progressSpace;
  }

  function updateProgressSpace() {
    frame = 0;
    const viewer = runtime.viewer;
    const nextProgress = document.querySelector(PROGRESS_SELECTOR);
    if (nextProgress !== progress) {
      clearProgressSpace();
      if (progress) resizeObserver?.unobserve(progress);
      progress = nextProgress;
      if (progress) resizeObserver?.observe(progress);
    }
    if (!progress || viewer.promptPanel.hidden || window.innerWidth <= 860) {
      clearProgressSpace();
      return;
    }

    // Reserve a stable band even while ComfyUI hides the progress panel
    // between generations. This prevents metadata controls from jumping.
    viewer.root.dataset.progressSpace = "true";

    const header = viewer.promptPanel.querySelector(".cmf-prompt-panel-header").getBoundingClientRect();
    const panel = viewer.promptPanel.getBoundingClientRect();
    const rect = progress.getBoundingClientRect();
    const top = rect.top - offset;
    if (!rect.width || !rect.height || rect.right <= panel.left || rect.left >= panel.right
        || rect.bottom <= panel.top || rect.top >= panel.bottom) {
      clearProgressOffset();
      return;
    }

    // Place the visible native panel inside the reserved band even when ComfyUI
    // changes the height of its top bar.
    const nextOffset = Math.ceil(header.bottom + 8 - top);
    if (offset !== nextOffset) {
      offset = nextOffset;
      progress.style.setProperty("--cmf-viewer-progress-offset", `${offset}px`);
    }
  }

  function scheduleProgressSpace() {
    if (!frame) frame = window.requestAnimationFrame(updateProgressSpace);
  }

  function syncViewerProgressSpace() {
    const viewer = runtime.viewer;
    const enabled = viewer?.root.dataset.open === "true" && state.showComfyProgress
      && state.showPrompts && state.metadataPosition === "right";
    if (!enabled) {
      if (!resizeObserver && !mutationObserver && !progress && !frame) return;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      resizeObserver = mutationObserver = null;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      if (typeof window !== "undefined") window.removeEventListener("resize", scheduleProgressSpace);
      clearProgressSpace();
      progress = null;
      return;
    }

    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(scheduleProgressSpace);
      resizeObserver.observe(viewer.promptPanel);
      resizeObserver.observe(viewer.promptPanel.querySelector(".cmf-prompt-panel-header"));
      mutationObserver = new MutationObserver((mutations) => {
        const relevant = mutations.some((mutation) => {
          // ResizeObserver handles changes within the progress panel. Watch its
          // ancestors because ComfyUI uses v-show on the outer wrapper.
          if (mutation.type === "attributes") {
            return progress && mutation.target !== progress && mutation.target.contains(progress);
          }
          if (progress && (mutation.target === progress || progress.contains(mutation.target))) return false;
          return [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
            node instanceof Element && (node.matches(PROGRESS_SELECTOR) || node.querySelector(PROGRESS_SELECTOR)));
        });
        if (relevant) scheduleProgressSpace();
      });
      mutationObserver.observe(document.body, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"],
      });
      window.addEventListener("resize", scheduleProgressSpace);
    }
    if (document.querySelector(PROGRESS_SELECTOR) && !viewer.promptPanel.hidden && window.innerWidth > 860) {
      viewer.root.dataset.progressSpace = "true";
    }
    scheduleProgressSpace();
  }

  Object.assign(actions, { syncViewerProgressSpace });
}
