export function mediaFeedBaseStyles({
  itemWidth,
  itemHeight,
  panelHeight,
  railHeight,
  viewportHeight,
  cardTopOffset,
}) {
  return `
    .cmf-root {
      --cmf-bg: var(--comfy-menu-bg, var(--content-bg, var(--bg-color, #131418)));
      --cmf-panel: var(--comfy-input-bg, var(--content-bg, var(--bg-color, rgba(255, 255, 255, 0.055))));
      --cmf-border: var(--border-color, rgba(255, 255, 255, 0.12));
      --cmf-text: var(--fg-color, var(--comfy-menu-text, rgba(255, 255, 255, 0.86)));
      --cmf-muted: var(--descrip-text, var(--comfy-menu-secondary-text, rgba(255, 255, 255, 0.58)));
      --cmf-accent: var(--p-primary-color, var(--comfy-accent, #4db6ac));
      --cmf-button-bg: var(--comfy-input-bg, rgba(255, 255, 255, 0.06));
      --cmf-button-hover: var(--content-bg, rgba(255, 255, 255, 0.1));
      --cmf-view-bg: var(--bg-color, rgba(0, 0, 0, 0.22));
      --cmf-feed-line: rgba(140, 140, 140, 0.384);
      --cmf-viewer-bg: rgba(0, 0, 0, 0.82);
      --cmf-viewer-bar-bg: var(--comfy-menu-bg, rgba(16, 17, 19, 0.94));
      --cmf-item-width: ${itemWidth}px;
      --cmf-item-height: ${itemHeight}px;
      --cmf-panel-height: ${panelHeight}px;
      --cmf-rail-height: ${railHeight}px;
      --cmf-viewport-height: ${viewportHeight}px;
      --cmf-card-top-offset: ${cardTopOffset}px;
      --cmf-safe-left: 76px;
      --cmf-safe-right: 300px;
      --cmf-safe-right-bottom: 280px;
      --cmf-edge-right: 12px;
      --cmf-safe-top: 118px;
      --cmf-placement-top: calc(var(--cmf-safe-top) + 13px);
      --cmf-side-outset: 5px;
      --cmf-safe-bottom: 12px;
      --cmf-top-controls-inset: clamp(160px, 27vw, 480px);
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 8px;
      height: 100%;
      min-height: 170px;
      padding: 10px;
      background: var(--cmf-bg);
      color: var(--cmf-text);
      font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .cmf-root.cmf-fallback {
      position: fixed;
      z-index: 10;
      overflow: hidden;
      border-radius: 8px;
    }

    .cmf-root.cmf-fallback[data-orientation="horizontal"] {
      left: calc(var(--cmf-safe-left) - var(--cmf-side-outset));
      height: auto;
      max-height: calc(100vh - var(--cmf-placement-top) - var(--cmf-safe-bottom) - 12px);
      min-height: 0;
    }

    .cmf-root.cmf-fallback[data-placement="bottom"] {
      right: var(--cmf-safe-right);
      bottom: var(--cmf-safe-bottom);
    }

    .cmf-root.cmf-fallback[data-placement="top"] {
      top: calc(var(--cmf-placement-top) - 30px);
      right: calc(var(--cmf-edge-right) - var(--cmf-side-outset));
    }

    .cmf-root.cmf-fallback[data-placement="top"]:not([data-collapsed="true"]) .cmf-collapse {
      margin-right: var(--cmf-top-controls-inset);
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] {
      top: var(--cmf-placement-top);
      width: clamp(156px, calc(var(--cmf-item-width) + 28px), 260px);
      height: auto;
      min-height: 0;
      padding-right: 6px;
      padding-left: 6px;
    }

    .cmf-root.cmf-fallback[data-placement="left"] {
      top: calc(var(--cmf-placement-top) - 30px);
      bottom: var(--cmf-safe-bottom);
      left: calc(var(--cmf-safe-left) - var(--cmf-side-outset));
    }

    .cmf-root.cmf-fallback[data-placement="right"] {
      right: calc(var(--cmf-edge-right) - var(--cmf-side-outset));
      bottom: var(--cmf-safe-right-bottom);
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-toolbar {
      flex-wrap: wrap;
      align-content: flex-start;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-collapse,
    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-clear {
      order: 2;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-spacer {
      display: none;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-filter {
      flex: 1 1 100%;
      order: 3;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-size-control {
      flex: 1 1 0;
      order: 1;
      min-width: 0;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-size-control span {
      display: none;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-size-control input {
      flex: 1;
      width: auto;
      min-width: 0;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-filter button {
      flex: 1 1 auto;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-viewport {
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-feed-frame {
      min-height: 0;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-rail {
      width: 100%;
      min-width: 0;
      min-height: 100%;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-card {
      top: 0;
      left: calc(50% - var(--cmf-item-width) / 2);
      width: var(--cmf-item-width);
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-feed-gap {
      top: 0;
      left: calc(50% - var(--cmf-item-width) / 2);
    }

    .cmf-root.cmf-fallback[data-collapsed="true"] {
      inset: auto;
      width: 132px;
      height: 44px;
      min-height: 44px;
      overflow: hidden;
      cursor: pointer;
    }

    .cmf-root.cmf-fallback[data-collapsed="true"]:hover {
      background: var(--cmf-panel);
    }

    .cmf-root.cmf-fallback[data-collapsed="true"][data-placement="bottom"] {
      bottom: var(--cmf-safe-bottom);
      left: calc(var(--cmf-safe-left) - var(--cmf-side-outset));
    }

    .cmf-root.cmf-fallback[data-collapsed="true"][data-placement="top"],
    .cmf-root.cmf-fallback[data-collapsed="true"][data-placement="left"] {
      top: var(--cmf-placement-top);
      left: calc(var(--cmf-safe-left) - var(--cmf-side-outset));
    }

    .cmf-root.cmf-fallback[data-collapsed="true"][data-placement="right"] {
      top: var(--cmf-placement-top);
      right: calc(var(--cmf-edge-right) - var(--cmf-side-outset));
    }

    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-viewport,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-feed-frame,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-filter,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-size-control,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-clear {
      display: none;
    }

    @media (max-width: 980px) {
      .cmf-root.cmf-fallback[data-orientation="horizontal"][data-placement="top"] {
        right: max(12px, calc(var(--cmf-edge-right) - var(--cmf-side-outset)));
        left: max(64px, calc(var(--cmf-safe-left) - var(--cmf-side-outset)));
      }
    }

    @media (max-width: 720px) {
      .cmf-root.cmf-fallback {
        --cmf-top-controls-inset: 0px;
        right: 12px;
        left: 12px;
        width: auto;
      }

      .cmf-root.cmf-fallback[data-collapsed="true"] {
        right: auto;
        left: 12px;
        width: 132px;
      }

      .cmf-root.cmf-fallback[data-collapsed="true"][data-placement="right"] {
        right: 12px;
        left: auto;
      }
    }

    .cmf-root *,
    .cmf-root *::before,
    .cmf-root *::after {
      box-sizing: border-box;
    }

    .cmf-root:not([data-orientation="vertical"]) {
      height: auto;
      min-height: 0;
    }

    .cmf-root[data-feed-style="default"] {
      border-radius: 8px;
      box-shadow: inset 0 0 0 1px var(--cmf-feed-line);
    }

    .cmf-root[data-feed-style="default"] .cmf-viewport {
      border-radius: 0;
      background: transparent;
    }

    .cmf-root[data-feed-style="frameless"] {
      background: transparent;
      pointer-events: none;
    }

    .cmf-root.cmf-fallback[data-feed-style="frameless"][data-collapsed="true"] {
      background: var(--cmf-bg);
      pointer-events: auto;
    }

    .cmf-root.cmf-fallback[data-feed-style="frameless"][data-collapsed="true"]:hover {
      background: var(--cmf-panel);
    }

    .cmf-root[data-feed-style="frameless"] .cmf-filter,
    .cmf-root[data-feed-style="frameless"] .cmf-size-control,
    .cmf-root[data-feed-style="frameless"] .cmf-clear,
    .cmf-root[data-feed-style="frameless"] .cmf-collapse {
      pointer-events: auto;
    }

    .cmf-root.cmf-fallback[data-feed-style="frameless"][data-orientation="vertical"] .cmf-clear {
      margin-left: auto;
    }

    .cmf-root[data-feed-style="frameless"] .cmf-viewport {
      background: transparent;
      overscroll-behavior: contain;
    }

    .cmf-root[data-feed-style="frameless"][data-orientation="horizontal"] .cmf-viewport {
      touch-action: pan-x;
    }

    .cmf-root[data-feed-style="frameless"][data-orientation="vertical"] .cmf-viewport {
      touch-action: pan-y;
    }

    .cmf-root[data-feed-style="frameless"] .cmf-card {
      pointer-events: auto;
    }

    .cmf-root[data-feed-style="frameless"] .cmf-feed-gap {
      pointer-events: auto;
    }

    .cmf-root[data-feed-style="frameless"][data-placement="bottom"] .cmf-toolbar {
      order: 2;
    }

    .cmf-root[data-feed-style="frameless"][data-placement="bottom"] .cmf-feed-frame {
      order: 1;
    }

    .cmf-root.cmf-fallback[data-feed-style="frameless"][data-placement="bottom"] {
      bottom: calc(var(--cmf-safe-bottom) - 12px);
      padding-bottom: 0;
    }

    .cmf-root[data-feed-style="frameless"][data-placement="bottom"] {
      gap: 0;
    }

    .cmf-root[data-feed-style="frameless"][data-placement="top"] .cmf-card,
    .cmf-root[data-feed-style="frameless"][data-placement="top"] .cmf-feed-gap {
      top: 2px;
    }

    .cmf-root[data-feed-style="frameless"][data-placement="bottom"] .cmf-card,
    .cmf-root[data-feed-style="frameless"][data-placement="bottom"] .cmf-feed-gap {
      top: 17px;
    }

    .cmf-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 28px;
    }

    .cmf-spacer {
      flex: 1;
    }

    .cmf-size-control {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--cmf-muted);
      white-space: nowrap;
    }

    .cmf-size-control input {
      width: 104px;
      accent-color: var(--cmf-accent);
      cursor: pointer;
    }

    .cmf-button {
      min-width: 0;
      height: 28px;
      padding: 0 10px;
      border: 1px solid var(--cmf-border);
      border-radius: 6px;
      background: var(--cmf-button-bg);
      color: var(--cmf-text);
      cursor: pointer;
      font: inherit;
    }

    .cmf-clear,
    .cmf-collapse {
      border-color: transparent;
      background: transparent;
    }

    .cmf-button:hover {
      background: var(--cmf-button-hover);
    }

    .cmf-clear:focus-visible,
    .cmf-collapse:focus-visible {
      outline: 2px solid var(--cmf-accent);
      outline-offset: 1px;
      background: var(--cmf-button-hover);
    }

    .cmf-button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .cmf-icon-button {
      display: grid;
      place-items: center;
      width: 30px;
      min-width: 30px;
      padding: 0;
    }

    .cmf-icon-button svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 2;
    }

    .cmf-clear svg,
    .cmf-collapse svg {
      width: 18px;
      height: 18px;
    }

    .cmf-filter {
      display: inline-flex;
      overflow: hidden;
      border: 1px solid var(--cmf-border);
      border-radius: 6px;
    }

    .cmf-filter button {
      position: relative;
      display: grid;
      place-items: center;
      width: 34px;
      height: 28px;
      padding: 0;
      border: 0;
      border-right: 1px solid var(--cmf-border);
      background: transparent;
      color: var(--cmf-muted);
      cursor: pointer;
      font: inherit;
    }

    .cmf-filter-count {
      position: absolute;
      right: 2px;
      bottom: 1px;
      color: var(--cmf-text);
      font-size: 8px;
      font-variant-numeric: tabular-nums;
      font-weight: 650;
      line-height: 10px;
      pointer-events: none;
    }

    .cmf-filter svg {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 2;
    }

    .cmf-filter button:last-child {
      border-right: 0;
    }

    .cmf-filter button[aria-pressed="true"] {
      background: var(--cmf-panel);
      background: color-mix(in srgb, var(--cmf-accent) 24%, var(--cmf-panel));
      color: var(--cmf-text);
    }

`;
}
