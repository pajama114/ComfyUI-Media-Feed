export function ensureMediaFeedStyles({
  itemWidth,
  itemHeight,
  panelHeight,
  railHeight,
  viewportHeight,
  cardTopOffset,
}) {
  if (document.getElementById("comfy-media-feed-styles")) return;

  const style = document.createElement("style");
  style.id = "comfy-media-feed-styles";
  style.textContent = `
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
      --cmf-viewer-bg: rgba(0, 0, 0, 0.82);
      --cmf-viewer-bar-bg: var(--comfy-menu-bg, rgba(16, 17, 19, 0.94));
      --cmf-item-width: ${itemWidth}px;
      --cmf-item-height: ${itemHeight}px;
      --cmf-panel-height: ${panelHeight}px;
      --cmf-rail-height: ${railHeight}px;
      --cmf-viewport-height: ${viewportHeight}px;
      --cmf-safe-left: 76px;
      --cmf-safe-right: 300px;
      --cmf-safe-top: 118px;
      --cmf-placement-top: calc(var(--cmf-safe-top) + 13px);
      --cmf-side-outset: 5px;
      --cmf-right-bottom-extension: 20px;
      --cmf-safe-bottom: 12px;
      --cmf-minimap-height: 300px;
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
      max-height: calc(100vh - var(--cmf-placement-top) - 24px);
      min-height: 0;
    }

    .cmf-root.cmf-fallback[data-placement="bottom"] {
      right: calc(var(--cmf-safe-right) - var(--cmf-side-outset));
      bottom: var(--cmf-safe-bottom);
    }

    .cmf-root.cmf-fallback[data-placement="top"] {
      top: var(--cmf-placement-top);
      right: calc(12px - var(--cmf-side-outset));
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] {
      top: var(--cmf-placement-top);
      width: clamp(196px, calc(var(--cmf-item-width) + 58px), 340px);
      height: auto;
      min-height: 0;
    }

    .cmf-root.cmf-fallback[data-placement="left"] {
      bottom: 24px;
      left: calc(var(--cmf-safe-left) - var(--cmf-side-outset));
    }

    .cmf-root.cmf-fallback[data-placement="right"] {
      right: calc(12px - var(--cmf-side-outset));
      bottom: calc(var(--cmf-minimap-height) - var(--cmf-right-bottom-extension));
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-toolbar {
      flex-wrap: wrap;
      align-content: flex-start;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-title {
      flex: 1 1 auto;
      order: 1;
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

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-count {
      flex: 1 1 100%;
      order: 4;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"] .cmf-size-control {
      flex: 1 1 100%;
      order: 5;
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
      right: calc(12px - var(--cmf-side-outset));
    }

    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-viewport,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-feed-frame,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-filter,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-count,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-size-control,
    .cmf-root.cmf-fallback[data-collapsed="true"] .cmf-clear {
      display: none;
    }

    @media (max-width: 980px) {
      .cmf-root.cmf-fallback[data-orientation="horizontal"] {
        right: 12px;
        left: 64px;
      }
    }

    @media (max-width: 720px) {
      .cmf-root.cmf-fallback {
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

    .cmf-root.cmf-fallback[data-feed-style="frameless"][data-collapsed="true"] .cmf-title {
      display: block;
    }

    .cmf-root[data-feed-style="frameless"] .cmf-jump {
      display: none;
    }

    .cmf-root[data-feed-style="frameless"] .cmf-title,
    .cmf-root[data-feed-style="frameless"] .cmf-count {
      display: none;
    }

    .cmf-root[data-feed-style="frameless"] .cmf-filter,
    .cmf-root[data-feed-style="frameless"] .cmf-size-control,
    .cmf-root[data-feed-style="frameless"] .cmf-clear,
    .cmf-root[data-feed-style="frameless"] .cmf-collapse {
      pointer-events: auto;
    }

    .cmf-root.cmf-fallback[data-feed-style="frameless"][data-orientation="vertical"] .cmf-filter {
      flex: 1 1 0;
      order: 1;
      min-width: 0;
    }

    .cmf-root.cmf-fallback[data-feed-style="frameless"][data-orientation="vertical"] .cmf-filter button {
      flex: 1 1 0;
      width: auto;
      min-width: 0;
    }

    .cmf-root[data-feed-style="frameless"] .cmf-viewport {
      background: transparent;
    }

    .cmf-root[data-feed-style="frameless"] .cmf-card {
      pointer-events: auto;
    }

    .cmf-root[data-feed-style="frameless"][data-placement="bottom"] .cmf-toolbar {
      order: 2;
    }

    .cmf-root[data-feed-style="frameless"][data-placement="bottom"] .cmf-feed-frame {
      order: 1;
    }

    .cmf-root.cmf-fallback[data-feed-style="frameless"][data-placement="bottom"] {
      bottom: 0;
      padding-bottom: 0;
    }

    .cmf-root[data-feed-style="frameless"][data-placement="top"],
    .cmf-root[data-feed-style="frameless"][data-placement="bottom"] {
      gap: 0;
    }

    .cmf-root[data-feed-style="frameless"][data-placement="top"] .cmf-card {
      top: 2px;
    }

    .cmf-root[data-feed-style="frameless"][data-placement="bottom"] .cmf-card {
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

    .cmf-title {
      flex: 0 0 auto;
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
    }

    .cmf-count {
      color: var(--cmf-muted);
      white-space: nowrap;
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

    .cmf-button:hover {
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

    .cmf-filter {
      display: inline-flex;
      overflow: hidden;
      border: 1px solid var(--cmf-border);
      border-radius: 6px;
    }

    .cmf-filter button {
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

    .cmf-feed-frame {
      position: relative;
      flex: 1;
      min-width: 0;
      min-height: var(--cmf-viewport-height);
    }

    .cmf-root:not([data-orientation="vertical"]) .cmf-feed-frame {
      flex: 0 0 var(--cmf-viewport-height);
    }

    .cmf-viewport {
      position: relative;
      flex: 1;
      width: 100%;
      height: 100%;
      min-height: var(--cmf-viewport-height);
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-color: #c1c1c1 transparent;
      scrollbar-width: none;
      border-radius: 8px;
      background: var(--cmf-view-bg);
    }

    .cmf-root[data-scrollable="true"] .cmf-viewport {
      scrollbar-width: thin;
    }

    .cmf-root[data-feed-style="frameless"][data-scrollable="true"] .cmf-viewport {
      scrollbar-width: none;
    }

    .cmf-viewport::-webkit-scrollbar {
      width: 0;
      height: 0;
    }

    .cmf-root[data-scrollable="true"] .cmf-viewport::-webkit-scrollbar {
      width: 12px;
      height: 12px;
    }

    .cmf-root[data-feed-style="frameless"][data-scrollable="true"] .cmf-viewport::-webkit-scrollbar {
      width: 0;
      height: 0;
    }

    .cmf-viewport::-webkit-scrollbar-track {
      border-radius: 0 0 8px 8px;
      background: transparent;
    }

    .cmf-viewport::-webkit-scrollbar-thumb {
      min-width: 36px;
      min-height: 36px;
      border: 3px solid transparent;
      border-radius: 999px;
      background: #c1c1c1;
      background-clip: content-box;
    }

    .cmf-viewport::-webkit-scrollbar-thumb:hover {
      background: #a8a8a8;
    }

    .cmf-jump {
      position: absolute;
      z-index: 2;
      top: 50%;
      display: grid;
      place-items: center;
      width: 32px;
      height: 44px;
      padding: 0;
      border: 1px solid var(--cmf-border);
      border-radius: 6px;
      background: rgba(20, 20, 20, 0.70);
      color: #fff;
      opacity: 0;
      pointer-events: none;
      transform: translateY(-50%);
      transition:
        opacity 120ms ease,
        background 120ms ease,
        border-color 120ms ease;
      cursor: pointer;
    }

    .cmf-root[data-scrollable="false"] .cmf-jump,
    .cmf-jump[hidden] {
      display: none;
    }

    .cmf-feed-frame:hover .cmf-jump,
    .cmf-feed-frame:focus-within .cmf-jump {
      opacity: 0.95;
      pointer-events: auto;
    }

    .cmf-jump:hover,
    .cmf-jump:focus-visible {
      border-color: var(--cmf-accent);
      background: rgba(20, 20, 20, 0.9);
      opacity: 1;
      outline: none;
    }

    .cmf-jump svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 2;
    }

    .cmf-jump-latest {
      left: 8px;
    }

    .cmf-jump-oldest {
      right: 8px;
    }

    .cmf-root[data-orientation="vertical"] .cmf-jump {
      top: auto;
      left: 50%;
      width: 44px;
      height: 32px;
      transform: translateX(-50%);
    }

    .cmf-root[data-orientation="vertical"] .cmf-jump-latest {
      top: 8px;
    }

    .cmf-root[data-orientation="vertical"] .cmf-jump-oldest {
      right: auto;
      bottom: 8px;
    }

    .cmf-root[data-orientation="vertical"] .cmf-jump svg {
      transform: rotate(90deg);
    }

    .cmf-rail {
      position: relative;
      height: var(--cmf-rail-height);
      min-width: 100%;
    }

    .cmf-empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--cmf-muted);
      pointer-events: none;
    }

    .cmf-card {
      position: absolute;
      top: ${cardTopOffset}px;
      display: flex;
      flex-direction: column;
      width: var(--cmf-item-width);
      height: var(--cmf-item-height);
      overflow: hidden;
      border: 1px solid var(--cmf-border);
      border-radius: 8px;
      background: var(--cmf-panel);
      color: var(--cmf-text);
      cursor: pointer;
    }

    .cmf-card:hover,
    .cmf-card:focus-visible {
      border-color: var(--cmf-accent);
      outline: none;
    }

    .cmf-preview {
      position: relative;
      display: grid;
      flex: 1 1 auto;
      place-items: center;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--cmf-view-bg);
    }

    .cmf-preview img,
    .cmf-preview video {
      display: block;
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      object-fit: contain !important;
      object-position: center;
    }

    .cmf-card-favorite {
      position: absolute;
      z-index: 2;
      top: 6px;
      right: 6px;
      border-color: rgba(255, 255, 255, 0.28);
      background: rgba(0, 0, 0, 0.42);
      color: rgba(255, 255, 255, 0.92);
      opacity: 0;
      transform: translateY(-2px);
      transition: opacity 120ms ease, transform 120ms ease, background 120ms ease;
    }

    .cmf-card:hover .cmf-card-favorite,
    .cmf-card:focus-within .cmf-card-favorite,
    .cmf-card-favorite:focus-visible {
      opacity: 0.72;
      transform: translateY(0);
    }

    .cmf-card-favorite:hover,
    .cmf-card-favorite:focus-visible {
      opacity: 1;
      background: rgba(0, 0, 0, 0.72);
    }

    .cmf-card-favorite[aria-pressed="true"] {
      color: #ffd24d;
      opacity: 1;
      transform: translateY(0);
    }

    .cmf-viewer-favorite[aria-pressed="true"] {
      color: #ffd24d;
      opacity: 1;
    }

    .cmf-card-favorite[aria-pressed="true"] svg,
    .cmf-viewer-favorite[aria-pressed="true"] svg {
      fill: currentColor;
    }

    .cmf-root[data-show-favorite-button="false"] .cmf-card-favorite {
      display: none;
    }

    .cmf-video-badge,
    .cmf-video-duration {
      position: absolute;
      z-index: 1;
      color: #fff;
      background: rgba(0, 0, 0, 0.72);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.34);
      pointer-events: none;
    }

    .cmf-video-badge {
      top: 6px;
      left: 6px;
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
    }

    .cmf-video-badge svg {
      width: 15px;
      height: 15px;
      fill: currentColor;
      stroke: none;
    }

    .cmf-video-duration {
      right: 6px;
      bottom: 6px;
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
    }

    .cmf-audio-preview {
      display: grid;
      grid-template-rows: 1fr auto;
      gap: 8px;
      width: 100%;
      height: 100%;
      padding: 8px;
    }

    .cmf-audio-main {
      display: grid;
      place-items: center;
      min-height: 0;
    }

    .cmf-audio-controls {
      display: grid;
      grid-template-columns: 30px 1fr;
      align-items: center;
      gap: 8px;
      width: 100%;
    }

    .cmf-audio-seek {
      width: 100%;
      min-width: 0;
      accent-color: var(--cmf-accent);
      cursor: pointer;
    }

    .cmf-audio-preview audio {
      display: none;
    }

    .cmf-kind {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--cmf-panel);
      background: color-mix(in srgb, var(--cmf-accent) 24%, var(--cmf-panel));
      color: var(--cmf-text);
      font-size: 11px;
      text-transform: uppercase;
    }

    .cmf-viewer {
      --cmf-panel: var(--comfy-input-bg, var(--content-bg, var(--bg-color, rgba(255, 255, 255, 0.055))));
      --cmf-border: var(--border-color, rgba(255, 255, 255, 0.12));
      --cmf-text: var(--fg-color, var(--comfy-menu-text, rgba(255, 255, 255, 0.86)));
      --cmf-muted: var(--descrip-text, var(--comfy-menu-secondary-text, rgba(255, 255, 255, 0.58)));
      --cmf-button-bg: var(--comfy-input-bg, rgba(255, 255, 255, 0.06));
      --cmf-button-hover: var(--content-bg, rgba(255, 255, 255, 0.1));
      --cmf-viewer-bg: rgba(0, 0, 0, 0.82);
      --cmf-viewer-bar-bg: var(--comfy-menu-bg, rgba(16, 17, 19, 0.94));
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: none;
      grid-template-rows: auto 1fr;
      background: var(--cmf-viewer-bg);
      color: var(--cmf-text);
    }

    .cmf-viewer[data-open="true"] {
      display: grid;
    }

    .cmf-viewer-bar {
      position: relative;
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 42px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--cmf-border);
      background: var(--cmf-viewer-bar-bg);
    }

    .cmf-viewer-title {
      flex: 0 1 32%;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cmf-viewer-zoom-controls {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .cmf-viewer-zoom-controls[hidden] {
      display: none;
    }

    .cmf-viewer-zoom-controls .cmf-icon-button {
      width: 30px;
      min-width: 30px;
      height: 30px;
    }

    .cmf-viewer-zoom-controls .cmf-icon-button svg {
      width: 17px;
      height: 17px;
    }

    .cmf-viewer-size-toggle {
      --cmf-viewer-toggle-bg: color-mix(in srgb, var(--cmf-viewer-bar-bg) 88%, white);
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--cmf-border);
      border-radius: 6px;
      background: var(--cmf-viewer-toggle-bg);
    }

    .cmf-viewer-zoom-text {
      min-width: 38px;
      height: 30px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: var(--cmf-text);
      padding: 0 8px;
      font-size: 12px;
    }

    .cmf-viewer-zoom-text[aria-pressed="true"] {
      border-color: #2878d4;
      background: #2878d4;
      box-shadow: inset 0 -2px 0 #1d5ca5;
      color: #fff;
      font-weight: 700;
      opacity: 1;
    }

    .cmf-viewer-zoom-text[aria-pressed="false"] {
      opacity: 0.68;
    }

    .cmf-viewer-zoom-level {
      min-width: 43px;
      color: var(--cmf-muted);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      text-align: center;
    }

    .cmf-viewer-body {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      gap: 14px;
      place-items: center;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      padding: 14px;
    }

    .cmf-viewer-body[data-prompts="true"] {
      grid-template-columns: minmax(0, 1fr) clamp(260px, 26vw, 360px);
      align-items: stretch;
      place-items: stretch;
    }

    .cmf-viewer-body[data-prompts="true"] .cmf-viewer-main {
      grid-column: 1;
      grid-row: 1;
    }

    .cmf-viewer-body[data-prompts="true"] .cmf-prompt-panel {
      grid-column: 2;
      grid-row: 1;
    }

    .cmf-viewer-body[data-prompts="true"][data-metadata-position="left"] {
      grid-template-columns: clamp(260px, 26vw, 360px) minmax(0, 1fr);
    }

    .cmf-viewer-body[data-prompts="true"][data-metadata-position="left"] .cmf-viewer-main {
      grid-column: 2;
    }

    .cmf-viewer-body[data-prompts="true"][data-metadata-position="left"] .cmf-prompt-panel {
      grid-column: 1;
    }

    .cmf-viewer-main {
      position: relative;
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .cmf-viewer-media {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .cmf-viewer-media img,
    .cmf-viewer-media video {
      display: block;
      min-width: 0;
      min-height: 0;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    .cmf-viewer[data-scale-media="true"] .cmf-viewer-media video {
      width: 100%;
      height: 100%;
    }

    .cmf-viewer-media img.cmf-zoomable-image {
      max-width: none;
      max-height: none;
      transform: translate(var(--cmf-image-pan-x, 0px), var(--cmf-image-pan-y, 0px)) scale(var(--cmf-image-zoom, 1));
      transform-origin: center;
      user-select: none;
      will-change: transform;
    }

    .cmf-viewer-media video.cmf-zoomable-video,
    .cmf-viewer-media audio.cmf-zoomable-audio {
      max-width: none;
      max-height: none;
    }

    .cmf-viewer-media[data-pannable="true"] img.cmf-zoomable-image {
      cursor: grab;
      touch-action: none;
    }

    .cmf-viewer-media[data-dragging="true"] img.cmf-zoomable-image {
      cursor: grabbing;
    }

    .cmf-viewer-media audio {
      width: min(720px, 90vw);
    }

    .cmf-prompt-panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      min-width: 0;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      scrollbar-gutter: stable;
      padding: 12px;
      border: 1px solid var(--cmf-border);
      border-radius: 8px;
      background: var(--cmf-viewer-bar-bg);
      color: var(--cmf-text);
    }

    .cmf-prompt-panel[hidden] {
      display: none;
    }

    .cmf-prompt-panel-title {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
    }

    .cmf-prompt-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .cmf-viewer-metadata-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      white-space: nowrap;
    }

    .cmf-viewer-metadata-toggle svg {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.8;
    }

    .cmf-show-metadata {
      position: absolute;
      z-index: 2;
      top: 14px;
      right: 14px;
    }

    .cmf-viewer-body[data-metadata-position="left"] .cmf-show-metadata {
      right: auto;
      left: 14px;
    }

    .cmf-show-metadata[hidden],
    .cmf-hide-metadata[hidden] {
      display: none;
    }

    .cmf-prompt-status {
      min-height: 16px;
      color: var(--cmf-muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .cmf-resource-grid,
    .cmf-metadata-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 9px;
      border: 1px solid var(--cmf-border);
      border-radius: 6px;
      background: var(--cmf-panel);
    }

    .cmf-resource-chip,
    .cmf-metadata-chip {
      min-width: 0;
      max-width: 100%;
      padding: 3px 7px;
      border: 1px solid color-mix(in srgb, var(--cmf-accent) 20%, var(--cmf-border));
      border-radius: 5px;
      background: color-mix(in srgb, var(--cmf-accent) 8%, transparent);
      color: var(--cmf-text);
      font-size: 11px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .cmf-resource-chip-label,
    .cmf-metadata-chip-label {
      color: var(--cmf-muted);
      text-transform: uppercase;
    }

    .cmf-prompt-section {
      display: grid;
      gap: 5px;
      min-height: 0;
    }

    .cmf-prompt-section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .cmf-prompt-heading {
      margin: 0;
      flex: 1 1 auto;
      color: var(--cmf-muted);
      font-size: 11px;
      font-weight: 650;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .cmf-prompt-copy {
      width: 26px;
      min-width: 26px;
      height: 24px;
    }

    .cmf-prompt-copy svg {
      width: 14px;
      height: 14px;
    }

    .cmf-prompt-text {
      min-height: 76px;
      max-height: 34vh;
      overflow: auto;
      scrollbar-gutter: stable;
      margin: 0;
      padding: 9px;
      border: 1px solid var(--cmf-border);
      border-radius: 6px;
      background: var(--cmf-panel);
      color: var(--cmf-text);
      font: 13.2px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .cmf-seed-text {
      min-height: 0;
      max-height: 16vh;
    }

    @media (max-width: 860px) {
      .cmf-viewer-body[data-prompts="true"] {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) minmax(180px, 34vh);
      }

      .cmf-viewer-body[data-prompts="true"] .cmf-viewer-main {
        grid-column: 1;
        grid-row: 1;
      }

      .cmf-viewer-body[data-prompts="true"] .cmf-prompt-panel {
        grid-column: 1;
        grid-row: 2;
      }

      .cmf-prompt-panel {
        max-width: none;
      }

      .cmf-show-metadata,
      .cmf-viewer-body[data-metadata-position="left"] .cmf-show-metadata {
        top: auto;
        right: 14px;
        bottom: 14px;
        left: auto;
      }
    }

    .cmf-nav-button {
      position: absolute;
      top: 50%;
      z-index: 1;
      width: 42px;
      min-width: 42px;
      height: 54px;
      transform: translateY(-50%);
      border-radius: 8px;
      background: var(--cmf-panel);
    }

    .cmf-nav-button:disabled {
      opacity: 0.32;
      cursor: default;
    }

    .cmf-nav-button svg {
      width: 24px;
      height: 24px;
    }

    .cmf-nav-prev {
      left: 12px;
    }

    .cmf-nav-next {
      right: 12px;
    }
  `;
  document.head.appendChild(style);
}
