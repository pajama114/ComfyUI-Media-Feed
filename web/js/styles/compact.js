// Retain Default's layout measurements so switching styles never moves media.
// The toolbar stays outside the media and appears only during interaction.
// Collapsed feeds use the existing shared styles when media is available.
const compact = '.cmf-root[data-feed-style="compact"]:not([data-collapsed="true"])';

export const mediaFeedCompactStyles = `
    .cmf-root[data-feed-style="compact"][data-has-media="false"] {
      visibility: hidden;
      pointer-events: none;
    }

    ${compact} {
      background: transparent;
      pointer-events: none;
    }

    ${compact}.cmf-fallback[data-placement="bottom"] {
      padding-bottom: 20px;
    }

    ${compact} .cmf-viewport {
      border-radius: 0;
      background: transparent;
      overscroll-behavior: contain;
      pointer-events: none;
    }

    /* Only media and visible controls take pointer input. Transparent padding,
       card gaps, and unused feed space belong to the canvas underneath. */
    ${compact} .cmf-card {
      pointer-events: auto;
    }

    ${compact}[data-orientation="horizontal"] .cmf-viewport {
      touch-action: pan-x;
    }

    ${compact}[data-orientation="vertical"] .cmf-viewport {
      touch-action: pan-y;
    }

    ${compact} .cmf-toolbar {
      opacity: 0;
      pointer-events: none;
      transition: opacity 120ms ease;
    }

    ${compact}:is([data-controls-visible="true"], [data-filter-empty="true"]) .cmf-toolbar {
      opacity: 1;
    }

    ${compact}:is([data-controls-visible="true"], [data-filter-empty="true"]) .cmf-toolbar :is(button, .cmf-size-control) {
      pointer-events: auto;
    }

    ${compact} .cmf-jump {
      opacity: 0;
      pointer-events: none;
    }

    ${compact}[data-controls-visible="true"] .cmf-jump {
      opacity: 0.95;
      pointer-events: auto;
    }

    ${compact} .cmf-card:not(:hover):not(:focus-within) .cmf-card-favorite,
    ${compact} .cmf-card:not(:hover):not(:focus-within) .cmf-media-controls,
    ${compact} .cmf-card:not(:hover):not(:focus-within) .cmf-batch-more {
      opacity: 0;
      pointer-events: none;
    }

    ${compact} .cmf-card:not(:hover):not(:focus-within) .cmf-media-play {
      pointer-events: none;
    }

    ${compact} .cmf-card:focus-within .cmf-card-favorite {
      opacity: 1;
    }

    ${compact}:not([data-controls-visible="true"]) .cmf-feed-gap::before {
      opacity: 0;
    }

    @media (prefers-reduced-motion: reduce) {
      ${compact} .cmf-toolbar {
        transition: none;
      }
    }
`;
