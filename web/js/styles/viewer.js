export const mediaFeedViewerStyles = `    .cmf-viewer {
      --cmf-panel: var(--comfy-input-bg, var(--content-bg, var(--bg-color, rgba(255, 255, 255, 0.055))));
      --cmf-border: var(--border-color, rgba(255, 255, 255, 0.12));
      --cmf-text: var(--fg-color, var(--comfy-menu-text, rgba(255, 255, 255, 0.86)));
      --cmf-muted: var(--descrip-text, var(--comfy-menu-secondary-text, rgba(255, 255, 255, 0.58)));
      --cmf-accent: var(--p-primary-color, var(--comfy-accent, #4db6ac));
      --cmf-button-bg: var(--comfy-input-bg, rgba(255, 255, 255, 0.06));
      --cmf-button-hover: var(--content-bg, rgba(255, 255, 255, 0.1));
      --cmf-viewer-bg: rgba(0, 0, 0, 0.82);
      --cmf-viewer-bar-bg: var(--comfy-menu-bg, rgba(16, 17, 19, 0.94));
      --cmf-metadata-box-bg: var(--cmf-panel);
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: none;
      grid-template-rows: auto 1fr;
      background: var(--cmf-viewer-bg);
      color: var(--cmf-text);
    }

    :root:not(.dark-theme) .cmf-viewer {
      --cmf-metadata-box-bg: #f5f5f5;
    }

    .cmf-viewer[data-open="true"] {
      display: grid;
    }

    /* The native panel lives inside ComfyUI's z-indexed canvas overlay.
       Release only its ancestors' z-index/isolation while this option is active,
       so the rest of ComfyUI stays behind the viewer. No DOM reparenting or
       inline style changes: closing the viewer restores the original layers.
       :has also covers panels mounted after the viewer opens. */
    body:has(> .cmf-viewer[data-open="true"][data-show-comfy-progress="true"])
      :has([data-testid="queue-progress-overlay"]) {
      z-index: auto !important;
      isolation: auto !important;
    }

    body:has(> .cmf-viewer[data-open="true"][data-show-comfy-progress="true"])
      [data-testid="queue-progress-overlay"] {
      position: relative;
      top: var(--cmf-viewer-progress-offset, 0px);
      z-index: 10000 !important;
    }

    .cmf-viewer-bar {
      position: relative;
      display: flex;
      align-items: center;
      gap: 10px;
      height: 35px;
      min-height: 35px;
      max-height: 35px;
      box-sizing: border-box;
      padding: 0 12px;
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

    .cmf-viewer-title[data-batch="true"] {
      display: flex;
      align-items: center;
    }

    .cmf-viewer-title-endpoint {
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .cmf-viewer-title[data-batch="true"] > span:not(.cmf-viewer-title-endpoint) {
      flex: none;
    }

    .cmf-viewer-favorite,
    .cmf-viewer-download,
    .cmf-viewer-copy-image,
    .cmf-open-link,
    .cmf-viewer-compare,
    .cmf-close {
      border-color: transparent;
      background: transparent;
    }

    .cmf-viewer-favorite svg,
    .cmf-viewer-download svg,
    .cmf-viewer-copy-image svg,
    .cmf-open-link svg,
    .cmf-viewer-compare svg,
    .cmf-close svg {
      width: 18px;
      height: 18px;
    }

    .cmf-viewer-favorite[aria-pressed="true"] svg {
      stroke: currentColor;
    }

    .cmf-viewer-copy-image[hidden] {
      display: none;
    }

    .cmf-viewer-favorite:focus-visible,
    .cmf-viewer-download:focus-visible,
    .cmf-viewer-copy-image:focus-visible,
    .cmf-open-link:focus-visible,
    .cmf-viewer-compare:focus-visible,
    .cmf-close:focus-visible,
    .cmf-metadata-action:focus-visible,
    .cmf-prompt-copy:focus-visible,
    .cmf-hide-metadata:focus-visible,
    .cmf-show-metadata:focus-visible,
    .cmf-viewer-zoom-out:focus-visible,
    .cmf-viewer-zoom-in:focus-visible {
      outline: 2px solid var(--cmf-accent);
      outline-offset: 1px;
    }

    .cmf-close:hover,
    .cmf-close:focus-visible {
      background: color-mix(in srgb, #ef5350 18%, transparent);
      color: #ff7b78;
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

    .cmf-viewer-zoom-out,
    .cmf-viewer-zoom-in {
      border-color: transparent;
      background: transparent;
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
      box-sizing: border-box;
      flex: 0 0 42px;
      width: 42px;
      height: 30px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: var(--cmf-text);
      padding: 0 8px;
      font-size: 12px;
    }

    .cmf-viewer-native[hidden] {
      display: none;
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
      flex: 0 0 72px;
      width: 72px;
      color: var(--cmf-muted);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      text-align: center;
      white-space: nowrap;
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

    .cmf-viewer-batch-grid {
      display: grid;
      grid-template-columns: repeat(var(--cmf-batch-columns), minmax(0, 1fr));
      grid-template-rows: repeat(var(--cmf-batch-row-count), minmax(0, 1fr));
      gap: 0;
      background: var(--cmf-border);
      transform: translate(var(--cmf-image-pan-x, 0px), var(--cmf-image-pan-y, 0px)) scale(var(--cmf-image-zoom, 1));
      transform-origin: center;
      user-select: none;
      -webkit-user-select: none;
      will-change: transform;
    }

    .cmf-viewer-batch-cell {
      position: relative;
      box-sizing: border-box;
      display: grid;
      place-items: center;
      min-width: 0;
      min-height: 0;
      border: 1.5px solid var(--cmf-border);
      /* Reserve the stroke's space even when unselected; media never shifts
         or sits beneath the selection indicator. */
      padding: calc(2px / var(--cmf-image-zoom, 1));
      overflow: hidden;
      background: var(--cmf-viewer-bg);
      cursor: inherit;
      outline: none;
    }

    .cmf-viewer-batch-cell::after {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: calc(100% * var(--cmf-image-zoom, 1));
      height: calc(100% * var(--cmf-image-zoom, 1));
      box-sizing: border-box;
      border: 2px solid transparent;
      /* Cancel grid magnification so the frame stays two screen pixels wide. */
      transform: scale(calc(1 / var(--cmf-image-zoom, 1)));
      transform-origin: top left;
      pointer-events: none;
    }

    .cmf-viewer-batch-grid[data-selection-visible="true"] .cmf-viewer-batch-cell[data-selected="true"]::after {
      border-color: var(--cmf-accent);
    }

    .cmf-viewer-batch-grid[data-selection-visible="true"] .cmf-viewer-batch-cell:focus-visible::after {
      border-color: var(--cmf-accent);
      border-style: dashed;
    }

    .cmf-viewer-batch-cell img,
    .cmf-viewer-batch-cell video {
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      object-fit: contain;
      user-select: none;
      -webkit-user-drag: none;
    }

    .cmf-viewer-batch-cell[data-media-kind="audio"] {
      container-type: size;
    }

    .cmf-viewer-media[data-pannable="true"] .cmf-viewer-batch-grid {
      cursor: grab;
      touch-action: none;
    }

    .cmf-viewer-media[data-dragging="true"] .cmf-viewer-batch-grid {
      cursor: grabbing;
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

    .cmf-viewer-media img.cmf-zoomable-image,
    .cmf-viewer-media video.cmf-zoomable-video {
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

    .cmf-viewer-media[data-pannable="true"] img.cmf-zoomable-image,
    .cmf-viewer-media[data-pannable="true"] video.cmf-zoomable-video {
      cursor: grab;
      touch-action: none;
    }

    .cmf-viewer-media[data-dragging="true"] img.cmf-zoomable-image,
    .cmf-viewer-media[data-dragging="true"] video.cmf-zoomable-video {
      cursor: grabbing;
    }

    .cmf-viewer-audio {
      --cmf-audio-accent: var(--p-primary-color, var(--comfy-accent, #4db6ac));
      display: grid;
      gap: 14px;
      width: min(960px, 90vw);
      max-width: none;
      color: var(--cmf-text);
    }

    .cmf-viewer-audio-graph {
      box-sizing: border-box;
      width: 100%;
      height: clamp(120px, 24vh, 240px);
      overflow: hidden;
      padding: 14px;
      border: 1px solid var(--cmf-border);
      border-radius: 8px;
      background: var(--cmf-viewer-bar-bg);
      cursor: pointer;
      user-select: none;
    }

    .cmf-viewer-audio-track {
      position: relative;
      width: 100%;
      height: 100%;
      touch-action: none;
    }

    .cmf-viewer-audio-waveform {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
      color: var(--cmf-muted);
      opacity: 0.9;
    }

    .cmf-viewer-audio-waveform path {
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }

    .cmf-viewer-audio-waveform[data-state="loading"],
    .cmf-viewer-audio-waveform[data-state="unavailable"] {
      opacity: 0.28;
    }

    .cmf-viewer-audio-playhead {
      position: absolute;
      z-index: 1;
      top: 8px;
      bottom: 8px;
      left: 0;
      width: 2px;
      border-radius: 999px;
      background: var(--cmf-audio-accent);
      box-shadow: 0 0 6px color-mix(in srgb, var(--cmf-audio-accent) 70%, transparent);
      pointer-events: none;
      transform: translateX(-50%);
      will-change: left;
    }

    .cmf-viewer-audio-controls {
      display: grid;
      grid-template-columns: 32px auto minmax(80px, 1fr) auto auto;
      align-items: center;
      gap: 8px;
      width: 100%;
    }

    .cmf-viewer-audio-play {
      width: 32px;
      height: 32px;
      border-color: var(--cmf-border);
    }

    .cmf-viewer-audio-play svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 2;
    }

    .cmf-viewer-audio-current,
    .cmf-viewer-audio-duration {
      min-width: 42px;
      color: rgba(255, 255, 255, 0.82);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      text-align: center;
    }

    .cmf-viewer-audio-seek,
    .cmf-viewer-audio-volume input {
      min-width: 0;
      accent-color: var(--cmf-audio-accent);
      cursor: pointer;
    }

    .cmf-viewer-audio-seek {
      width: 100%;
    }

    .cmf-viewer-audio-volume {
      display: grid;
      grid-template-columns: auto 80px;
      align-items: center;
      gap: 6px;
      color: rgba(255, 255, 255, 0.82);
      font-size: 11px;
    }

    .cmf-viewer-audio-volume input {
      width: 80px;
    }

    .cmf-viewer-audio > audio {
      display: none;
    }

    .cmf-viewer-batch-cell .cmf-viewer-batch-audio {
      grid-template-rows: minmax(0, 1fr) auto;
      gap: min(14px, 6%);
      width: 90%;
      height: min(90%, 286px);
      min-width: 0;
      min-height: 0;
    }

    .cmf-viewer-batch-cell .cmf-viewer-audio-graph {
      height: auto;
      min-height: 0;
      padding: min(14px, 4%);
    }

    @container (max-width: 480px) {
      .cmf-viewer-batch-cell .cmf-viewer-audio-controls {
        grid-template-columns: 32px auto minmax(20px, 1fr) auto;
        gap: 5px;
      }

      .cmf-viewer-batch-cell .cmf-viewer-audio-volume {
        grid-column: 1 / -1;
        grid-template-columns: auto minmax(0, 80px);
        justify-self: end;
      }
    }

    .cmf-prompt-panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      padding: 12px;
      border: 1px solid var(--cmf-border);
      border-radius: 8px;
      background: var(--cmf-viewer-bar-bg);
      color: var(--cmf-text);
    }

    .cmf-prompt-panel[hidden] {
      display: none;
    }

    .cmf-prompt-panel > * {
      flex-shrink: 0;
    }

    .cmf-prompt-panel[data-loading="true"] .cmf-prompt-status,
    .cmf-prompt-panel[data-loading="true"] .cmf-scan-full-metadata,
    .cmf-prompt-panel[data-loading="true"] .cmf-prompt-section {
      visibility: hidden;
      pointer-events: none;
    }

    .cmf-prompt-panel[data-pending="true"] .cmf-prompt-section {
      opacity: 0.45;
      pointer-events: none;
    }

    .cmf-prompt-panel[data-pending="true"] .cmf-prompt-panel-title::after {
      content: " · Loading…";
      color: var(--cmf-muted);
      font-weight: 400;
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

    .cmf-metadata-toolbar {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .cmf-metadata-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: transparent;
      white-space: nowrap;
    }

    .cmf-metadata-action svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 2;
    }

    .cmf-viewer-metadata-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .cmf-hide-metadata {
      border-color: transparent;
      background: transparent;
    }

    .cmf-viewer-metadata-toggle svg {
      width: 17px;
      height: 17px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.8;
    }

    .cmf-show-metadata {
      position: absolute;
      z-index: 2;
      top: 27px;
      right: 14px;
      border-color: rgba(255, 255, 255, 0.32);
      background: rgba(124, 127, 134, 0.94);
      color: #fff;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.38);
    }

    .cmf-show-metadata:hover,
    .cmf-show-metadata:focus-visible {
      border-color: rgba(255, 255, 255, 0.48);
      background: rgba(150, 153, 160, 0.98);
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

    .cmf-prompt-status:empty {
      display: none;
    }

    .cmf-resource-grid,
    .cmf-metadata-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 9px;
      border: 1px solid var(--cmf-border);
      border-radius: 6px;
      background: var(--cmf-metadata-box-bg);
    }

    .cmf-resource-chip,
    .cmf-metadata-chip {
      min-width: 0;
      max-width: 100%;
      color: var(--cmf-text);
      font-size: 11px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .cmf-copy-success {
      position: relative;
      border-color: #43b66f !important;
      background: color-mix(in srgb, #43b66f 30%, var(--cmf-button-bg)) !important;
      color: color-mix(in srgb, #43b66f 35%, var(--cmf-text)) !important;
      animation: cmf-copy-confirm 260ms ease-out;
    }

    .cmf-copy-success::after {
      content: "✓";
      position: absolute;
      top: -6px;
      right: -6px;
      display: grid;
      place-items: center;
      width: 16px;
      height: 16px;
      border: 1px solid color-mix(in srgb, #43b66f 75%, white);
      border-radius: 50%;
      background: #278f50;
      color: #fff;
      font: 700 11px/1 sans-serif;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
      pointer-events: none;
    }

    @keyframes cmf-copy-confirm {
      from { transform: scale(0.94); }
      to { transform: scale(1); }
    }

    @media (prefers-reduced-motion: reduce) {
      .cmf-copy-success {
        animation: none;
      }
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

    .cmf-prompt-body-section {
      grid-template-rows: auto minmax(0, 1fr);
      flex: 1 1 0;
      max-height: 30vh;
      overflow: hidden;
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
      border-color: transparent;
      background: transparent;
    }

    .cmf-prompt-copy svg {
      width: 16px;
      height: 16px;
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
      background: var(--cmf-metadata-box-bg);
      color: var(--cmf-text);
      font: 13.2px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .cmf-seed-text {
      min-height: 0;
      max-height: none;
      overflow: visible;
      scrollbar-gutter: auto;
    }

    .cmf-prompt-body-section .cmf-prompt-text {
      height: 100%;
      min-height: 0;
      max-height: none;
    }

    @media (min-width: 861px) {
      .cmf-viewer[data-show-comfy-progress="true"][data-progress-space="true"]
        .cmf-viewer-body[data-metadata-position="right"] .cmf-metadata-toolbar {
        margin-top: 80px;
      }

      .cmf-viewer[data-show-comfy-progress="true"][data-progress-space="true"]
        .cmf-viewer-body[data-metadata-position="right"] .cmf-prompt-body-section:has(.cmf-prompt-negative) {
        flex-grow: 0.65;
        max-height: 24vh;
      }
    }

    @media (max-width: 860px) {
      .cmf-viewer-body[data-prompts="true"],
      .cmf-viewer-body[data-prompts="true"][data-metadata-position="left"] {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) minmax(180px, 34vh);
      }

      .cmf-viewer-body[data-prompts="true"] .cmf-viewer-main,
      .cmf-viewer-body[data-prompts="true"][data-metadata-position="left"] .cmf-viewer-main {
        grid-column: 1;
        grid-row: 1;
      }

      .cmf-viewer-body[data-prompts="true"] .cmf-prompt-panel,
      .cmf-viewer-body[data-prompts="true"][data-metadata-position="left"] .cmf-prompt-panel {
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
      opacity: 0.75;
      transition: opacity 120ms ease;
    }

    .cmf-nav-button:hover,
    .cmf-nav-button:focus-visible {
      opacity: 0.9;
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

    .cmf-viewer-bar .cmf-viewer-size-toggle { padding: 1px; }
    .cmf-viewer-bar .cmf-viewer-size-toggle .cmf-viewer-zoom-text { height: 26px; }

    .cmf-viewer-pane-bar {
      position: absolute;
      top: 0;
      height: 100%;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      min-width: 0;
      padding: 0 6px;
    }

    .cmf-viewer-pane-identity {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .cmf-viewer-pane-identity .cmf-viewer-title { flex: 1 1 auto; }
    .cmf-viewer-pane-actions { display: flex; justify-content: flex-end; gap: 2px; }
    .cmf-viewer-pane-bar .cmf-viewer-zoom-controls {
      position: static;
      transform: none;
      grid-column: 2;
      grid-row: 1;
    }
    .cmf-viewer-pane-actions { grid-column: 3; grid-row: 1; }
    .cmf-viewer-pane-identity { grid-column: 1; grid-row: 1; }
    .cmf-viewer-more { position: relative; }
    .cmf-viewer-more[hidden], .cmf-viewer-overflow-label { display: none; }
    .cmf-viewer-more > summary { list-style: none; cursor: pointer; font-size: 22px; }
    .cmf-viewer-more > summary::-webkit-details-marker { display: none; }
    .cmf-viewer-more-menu {
      position: absolute;
      right: 0;
      top: calc(100% + 8px);
      z-index: 10;
      display: grid;
      gap: 4px;
      min-width: 160px;
      padding: 6px;
      border: 1px solid var(--cmf-border);
      border-radius: 6px;
      background: var(--cmf-viewer-bar-bg);
      box-shadow: 0 4px 16px #0008;
    }
    .cmf-viewer-more-menu .cmf-button {
      width: 100%;
      justify-content: flex-start;
      gap: 8px;
      height: 32px;
      white-space: nowrap;
    }
    .cmf-viewer-more-menu .cmf-viewer-overflow-label { display: inline; font-size: 12px; }
    .cmf-viewer-pane-bar:has(.cmf-viewer-zoom-controls[hidden]) .cmf-viewer-more-menu
      :is(.cmf-viewer-native, .cmf-viewer-zoom-in, .cmf-viewer-zoom-out) { display: none; }
    .cmf-viewer-pane-bar[data-compact="true"] { gap: 4px; }
    .cmf-viewer-pane-bar[data-compact="true"] .cmf-viewer-zoom-controls { gap: 3px; }
    .cmf-viewer-pane-bar[data-compact="true"] .cmf-viewer-pane-actions > .cmf-icon-button,
    .cmf-viewer-pane-bar[data-compact="true"] summary { width: 28px; min-width: 28px; }

    .cmf-viewer-global-controls {
      position: absolute;
      right: 12px;
      top: 0;
      height: 100%;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      padding-left: 8px;
      border-left: 1px solid var(--cmf-border);
    }

    .cmf-viewer-global-controls svg { width: 18px; height: 18px; }
    .cmf-viewer-compare[aria-pressed="true"] {
      border-color: #000;
      background: #aad7ff;
      color: #000;
    }

    .cmf-viewer-pane {
      position: relative;
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .cmf-viewer-media-stage {
      position: relative;
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .cmf-viewer-reference-bar[hidden],
    .cmf-viewer-reference[hidden] { display: none; }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-main {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-main::after {
      content: "";
      position: absolute;
      z-index: 2;
      top: 0;
      bottom: 0;
      left: 50%;
      border-left: 1px solid var(--cmf-border);
      pointer-events: none;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-body,
    .cmf-viewer[data-comparing="true"] .cmf-viewer-body[data-prompts="true"],
    .cmf-viewer[data-comparing="true"] .cmf-viewer-body[data-prompts="true"][data-metadata-position="left"] {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-body .cmf-viewer-main {
      grid-column: 1;
      grid-row: 1;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-pane[data-prompts="true"] {
      grid-template-columns: minmax(0, min(300px, 42%)) minmax(0, 1fr);
      gap: 8px;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-pane[data-prompts="true"] .cmf-viewer-media-stage {
      grid-column: 2;
      grid-row: 1;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-pane[data-prompts="true"] .cmf-prompt-panel {
      grid-column: 1;
      grid-row: 1;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-body[data-metadata-position="right"] .cmf-viewer-pane[data-prompts="true"] {
      grid-template-columns: minmax(0, 1fr) minmax(0, min(300px, 42%));
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-body[data-metadata-position="right"] .cmf-viewer-pane[data-prompts="true"] .cmf-viewer-media-stage {
      grid-column: 1;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-body[data-metadata-position="right"] .cmf-viewer-pane[data-prompts="true"] .cmf-prompt-panel {
      grid-column: 2;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-pane .cmf-prompt-panel {
      box-sizing: border-box;
      height: 100%;
      max-width: none;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-pane .cmf-show-metadata,
    .cmf-viewer[data-comparing="true"] .cmf-viewer-body[data-metadata-position="left"] .cmf-show-metadata {
      top: 12px;
      bottom: auto;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-pane:not(.cmf-viewer-reference) .cmf-show-metadata {
      left: 12px;
      right: auto;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-reference .cmf-show-metadata {
      left: 12px;
      right: auto;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-body[data-metadata-position="right"] .cmf-viewer-pane .cmf-show-metadata {
      left: auto;
      right: 12px;
    }

    .cmf-viewer-reference-bar {
      border-left: 1px solid var(--cmf-border);
      padding-left: 6px;
    }

    .cmf-viewer-reference {
      border-left: 0;
    }

    .cmf-viewer-pin { display: flex; flex-shrink: 0; }
    .cmf-viewer-pin svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-media video.cmf-zoomable-video {
      transform: translate(var(--cmf-image-pan-x, 0px), var(--cmf-image-pan-y, 0px)) scale(var(--cmf-image-zoom, 1));
      transform-origin: center;
    }

    .cmf-viewer[data-comparing="true"] .cmf-viewer-media[data-pannable="true"] video.cmf-zoomable-video {
      cursor: grab;
      touch-action: none;
    }

    @media (max-width: 1000px) {
      .cmf-viewer[data-comparing="true"] .cmf-viewer-audio-volume {
        grid-template-columns: auto 45px;
      }
      .cmf-viewer[data-comparing="true"] .cmf-viewer-audio-volume input { width: 45px; }
      .cmf-viewer[data-comparing="true"] .cmf-viewer-audio-controls {
        grid-template-columns: 32px auto minmax(20px, 1fr) auto;
      }
      .cmf-viewer[data-comparing="true"] .cmf-viewer-audio-volume { grid-column: 1 / -1; }
    }
  `;
