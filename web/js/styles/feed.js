export const mediaFeedFeedStyles = `    .cmf-feed-frame {
      position: relative;
      flex: 1;
      min-width: 0;
      min-height: var(--cmf-viewport-height);
    }

    .cmf-feed-frame::before {
      content: "";
      position: absolute;
      z-index: 3;
      top: -2px;
      right: 0;
      left: 0;
      height: 1px;
      background: var(--cmf-feed-line);
      pointer-events: none;
    }

    .cmf-root[data-feed-style="frameless"] .cmf-feed-frame::before {
      display: none;
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

    .cmf-root.cmf-fallback[data-orientation="vertical"][data-feed-style="default"] .cmf-viewport {
      scrollbar-gutter: stable;
      scrollbar-width: thin;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"][data-feed-style="default"] .cmf-viewport::-webkit-scrollbar {
      width: 8px;
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

    .cmf-root.cmf-fallback[data-orientation="vertical"][data-feed-style="default"] .cmf-viewport::-webkit-scrollbar-thumb {
      border-width: 1px;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"][data-feed-style="frameless"] .cmf-viewport {
      scrollbar-gutter: stable;
      scrollbar-color: transparent transparent;
      scrollbar-width: thin;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"][data-feed-style="frameless"] .cmf-viewport::-webkit-scrollbar {
      width: 8px;
    }

    .cmf-root.cmf-fallback[data-orientation="vertical"][data-feed-style="frameless"] .cmf-viewport::-webkit-scrollbar-thumb,
    .cmf-root.cmf-fallback[data-orientation="vertical"][data-feed-style="frameless"] .cmf-viewport::-webkit-scrollbar-thumb:hover {
      background: transparent;
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
      top: var(--cmf-card-top-offset);
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

    .cmf-feed-gap {
      position: absolute;
      top: var(--cmf-card-top-offset);
      left: 0;
      pointer-events: none;
    }

    .cmf-root:not([data-batch-dividers="none"]) .cmf-feed-gap[data-batch-boundary="true"]::before {
      content: "";
      position: absolute;
      top: 3%;
      bottom: 3%;
      left: 50%;
      width: 3px;
      border-radius: 999px;
      background: rgba(128, 128, 128, 0.3);
      background: color-mix(in srgb, var(--cmf-text) 60%, transparent);
      transform: translateX(-50%);
    }

    .cmf-root[data-orientation="vertical"]:not([data-batch-dividers="none"]) .cmf-feed-gap[data-batch-boundary="true"]::before {
      top: 50%;
      right: 3%;
      bottom: auto;
      left: 3%;
      width: auto;
      height: 3px;
      transform: translateY(-50%);
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
      color: #e0a000;
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
      width: 100%;
      min-height: 0;
    }

    .cmf-audio-waveform {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 28px;
      max-height: 72px;
      overflow: visible;
      color: var(--cmf-accent);
      opacity: 0.82;
    }

    .cmf-audio-waveform path {
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }

    .cmf-audio-waveform[data-state="loading"],
    .cmf-audio-waveform[data-state="unavailable"] {
      opacity: 0.28;
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

`;
