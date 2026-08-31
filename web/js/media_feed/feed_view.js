import {
  THUMBNAIL_CARD_CACHE_SIZE,
  WORKFLOW_SCROLL_POSITION_CACHE_SIZE,
  MIN_ITEM_HEIGHT,
  MAX_ITEM_HEIGHT,
  ITEM_GAP,
} from "./constants.js";
import { visibleItemRange } from "./virtualization.js";

export function installFeedView(context) {
  const { app, api, ICONS, state, runtime, actions } = context;
  const { clearPromptMetadataCache } = context.services;

  const itemMatchesMediaScope = (...args) => actions.itemMatchesMediaScope(...args);
  const filteredItems = (...args) => actions.filteredItems(...args);
  const viewPitch = (...args) => actions.viewPitch(...args);
  const feedRailPadding = (...args) => actions.feedRailPadding(...args);
  const feedCardTopOffset = (...args) => actions.feedCardTopOffset(...args);
  const viewportHeight = (...args) => actions.viewportHeight(...args);
  const railHeight = (...args) => actions.railHeight(...args);
  const fallbackPanelHeight = (...args) => actions.fallbackPanelHeight(...args);
  const horizontalContentWidth = (...args) => actions.horizontalContentWidth(...args);
  const isVerticalPlacement = (...args) => actions.isVerticalPlacement(...args);
  const isVerticalView = (...args) => actions.isVerticalView(...args);
  const setThumbnailHeight = (...args) => actions.setThumbnailHeight(...args);
  const ensureStyles = (...args) => actions.ensureStyles(...args);
  const discardStagedMedia = (...args) => actions.discardStagedMedia(...args);
  const syncFavoriteButton = (...args) => actions.syncFavoriteButton(...args);
  const createCard = (...args) => actions.createCard(...args);
  const clearSessionItems = (...args) => actions.clearSessionItems(...args);
  function isBatchBoundary(item, nextItem) {
    const batchId = String(item?.promptId || "");
    const nextBatchId = String(nextItem?.promptId || "");
    return Boolean(batchId && nextBatchId && batchId !== nextBatchId);
  }

  function createView(root, kind = "embedded") {
    ensureStyles();
  
    root.className = kind === "floating" ? "cmf-root cmf-fallback" : "cmf-root";
    root.innerHTML = `
      <div class="cmf-toolbar">
        <div class="cmf-filter" role="group" aria-label="Media filter">
          <button type="button" data-filter="all" data-filter-label="All media" aria-pressed="true" title="All media" aria-label="All media">${ICONS.grid}<span class="cmf-filter-count">0</span></button>
          <button type="button" data-filter="image" data-filter-label="Images" aria-pressed="false" title="Images" aria-label="Images">${ICONS.image}<span class="cmf-filter-count">0</span></button>
          <button type="button" data-filter="video" data-filter-label="Videos" aria-pressed="false" title="Videos" aria-label="Videos">${ICONS.video}<span class="cmf-filter-count">0</span></button>
          <button type="button" data-filter="audio" data-filter-label="Audio" aria-pressed="false" title="Audio" aria-label="Audio">${ICONS.music}<span class="cmf-filter-count">0</span></button>
        </div>
        <div class="cmf-spacer"></div>
        <label class="cmf-size-control" title="Thumbnail size">
          <span>Size</span>
          <input class="cmf-size-slider" type="range" min="${MIN_ITEM_HEIGHT}" max="${MAX_ITEM_HEIGHT}" value="${state.itemHeight}">
        </label>
        <button class="cmf-button cmf-icon-button cmf-clear" type="button" title="Clear" aria-label="Clear">${ICONS.trash}</button>
        <button class="cmf-button cmf-icon-button cmf-collapse" type="button" title="Hide Media Feed" aria-label="Hide Media Feed" hidden>${ICONS.eyeOff}</button>
      </div>
      <div class="cmf-feed-frame">
        <div class="cmf-viewport">
          <div class="cmf-rail"></div>
          <div class="cmf-empty">Generated media will appear here.</div>
        </div>
        <button class="cmf-jump cmf-jump-latest" type="button" data-jump="latest" title="Latest" aria-label="Jump to latest media">${ICONS.chevronLeft}</button>
        <button class="cmf-jump cmf-jump-oldest" type="button" data-jump="oldest" title="Oldest" aria-label="Jump to oldest media">${ICONS.chevronRight}</button>
      </div>
    `;
  
    const view = {
      root,
      viewport: root.querySelector(".cmf-viewport"),
      rail: root.querySelector(".cmf-rail"),
      empty: root.querySelector(".cmf-empty"),
      sizeSlider: root.querySelector(".cmf-size-slider"),
      jumpLatest: root.querySelector(".cmf-jump-latest"),
      jumpOldest: root.querySelector(".cmf-jump-oldest"),
      cards: new Map(),
      cardCache: new Map(),
      workflowScrollPositions: new Map(),
      gaps: new Map(),
      kind,
      lastRange: "",
    };
  
    view.viewport.addEventListener("scroll", () => {
      renderVisibleItems(view);
      updateJumpButtons(view);
    }, { passive: true });
    view.viewport.addEventListener("wheel", (event) => handleFeedWheel(event, view), { passive: false });
    view.resizeObserver = new ResizeObserver(() => updateView(view, false));
    view.resizeObserver.observe(view.viewport);
  
    root.querySelectorAll(".cmf-jump").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        scrollFeedToEdge(view, button.dataset.jump);
      });
    });
  
    root.querySelector(".cmf-filter").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-filter]");
      if (!button) return;
  
      state.filter = button.dataset.filter;
      for (const filterButton of root.querySelectorAll("button[data-filter]")) {
        filterButton.setAttribute("aria-pressed", String(filterButton === button));
      }
      updateViews(false);
    });
  
    root.querySelector(".cmf-clear").addEventListener("click", () => {
      for (const currentView of state.views) {
        clearCachedCards(currentView);
        currentView.workflowScrollPositions.clear();
      }
      state.items = [];
      state.itemKeys.clear();
      runtime.decodedImageCache.clear();
      runtime.mediaDimensionCache.clear();
      runtime.audioWaveformCache.clear();
      clearPromptMetadataCache();
      clearSessionItems();
      updateViews(false);
    });
  
    view.sizeSlider.addEventListener("input", (event) => {
      setThumbnailHeight(event.target.value);
    });
  
    state.views.add(view);
    updateView(view, false);
    return view;
  }
  
  function applyFallbackPlacement(root) {
    if (!root) return;
    root.dataset.placement = state.placement;
    if (!root.classList?.contains("cmf-fallback")) return;
    root.dataset.orientation = isVerticalPlacement() ? "vertical" : "horizontal";
  }
  
  function updateViews(scrollToLatest, prependedCount = 0) {
    for (const view of state.views) updateView(view, scrollToLatest, prependedCount);
  }
  
  function saveWorkflowScrollPositions(tabId) {
    if (!tabId) return;
  
    for (const view of state.views) {
      view.workflowScrollPositions.delete(tabId);
      view.workflowScrollPositions.set(tabId, {
        left: view.viewport.scrollLeft,
        top: view.viewport.scrollTop,
      });
      while (view.workflowScrollPositions.size > WORKFLOW_SCROLL_POSITION_CACHE_SIZE) {
        view.workflowScrollPositions.delete(view.workflowScrollPositions.keys().next().value);
      }
    }
  }
  
  function updateViewsForWorkflowTab(tabId) {
    for (const view of state.views) {
      const savedPosition = tabId ? view.workflowScrollPositions.get(tabId) : null;
      if (savedPosition) {
        view.workflowScrollPositions.delete(tabId);
        view.workflowScrollPositions.set(tabId, savedPosition);
      }
      updateView(view, false, 0, savedPosition || { left: 0, top: 0 });
    }
  }
  
  function applyViewSizing(view) {
    applyFallbackPlacement(view.root);
    view.root.dataset.showFavoriteButton = String(state.showFavoriteButton);
    view.root.dataset.feedStyle = state.feedStyle;
    view.root.dataset.batchDividers = state.batchDividers;
    view.root.style.setProperty("--cmf-item-width", `${state.itemWidth}px`);
    view.root.style.setProperty("--cmf-item-height", `${state.itemHeight}px`);
    view.root.style.setProperty("--cmf-panel-height", `${fallbackPanelHeight()}px`);
    view.root.style.setProperty("--cmf-rail-height", `${railHeight()}px`);
    view.root.style.setProperty("--cmf-viewport-height", `${viewportHeight()}px`);
    view.root.style.setProperty("--cmf-card-top-offset", `${feedCardTopOffset()}px`);
    view.sizeSlider.value = String(state.itemHeight);
  }
  
  function handleFeedWheel(event, view) {
    if (runtime.viewer?.root?.dataset.open === "true") return;
    if (view.root.dataset.feedStyle === "frameless") event.stopPropagation();
    if (isVerticalView(view)) return;
  
    const canScroll = view.viewport.scrollWidth > view.viewport.clientWidth;
    if (!canScroll) return;
  
    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.abs(dominantDelta) < 1) return;
  
    event.preventDefault();
    view.viewport.scrollLeft += dominantDelta;
    renderVisibleItems(view);
    updateJumpButtons(view);
  }
  
  function feedMaxScroll(view) {
    const vertical = isVerticalView(view);
    return vertical
      ? Math.max(0, view.viewport.scrollHeight - view.viewport.clientHeight)
      : Math.max(0, view.viewport.scrollWidth - view.viewport.clientWidth);
  }
  
  function feedScrollOffset(view) {
    return isVerticalView(view) ? view.viewport.scrollTop : view.viewport.scrollLeft;
  }
  
  function updateJumpButtons(view) {
    const maxScroll = feedMaxScroll(view);
    const scrollOffset = feedScrollOffset(view);
    const atLatest = scrollOffset <= 1;
    const atOldest = scrollOffset >= maxScroll - 1;
  
    view.jumpLatest.hidden = maxScroll <= 1 || atLatest;
    view.jumpOldest.hidden = maxScroll <= 1 || atOldest;
  }
  
  function updateFilterCounts(view) {
    const counts = { all: 0, image: 0, video: 0, audio: 0 };
    for (const item of state.items) {
      if (!itemMatchesMediaScope(item)) continue;
      counts.all++;
      if (counts[item.kind] !== undefined) counts[item.kind]++;
    }
  
    for (const button of view.root.querySelectorAll("button[data-filter]")) {
      const count = counts[button.dataset.filter] || 0;
      const label = button.dataset.filterLabel || "Media";
      button.querySelector(".cmf-filter-count").textContent = String(count);
      button.title = `${label}: ${count}`;
      button.setAttribute("aria-label", `${label}: ${count}`);
    }
  }
  
  function scrollFeedToEdge(view, edge) {
    const vertical = isVerticalView(view);
    const maxScroll = feedMaxScroll(view);
    const scrollOffset = edge === "oldest" ? maxScroll : 0;
  
    if (vertical) {
      view.viewport.scrollTop = scrollOffset;
    } else {
      view.viewport.scrollLeft = scrollOffset;
    }
    renderVisibleItems(view);
    updateJumpButtons(view);
  }
  
  function updateView(view, scrollToLatest, prependedCount = 0, scrollPosition = null) {
    applyViewSizing(view);
    const items = filteredItems();
    const pitch = viewPitch(view);
    const vertical = isVerticalView(view);
  
    if (vertical) {
      const totalHeight = Math.max(view.viewport.clientHeight, feedRailPadding() * 2 + items.length * pitch);
      view.rail.style.width = "100%";
      view.rail.style.height = `${totalHeight}px`;
      view.root.dataset.scrollable = String(totalHeight > view.viewport.clientHeight + 1);
    } else {
      const totalWidth = Math.max(view.viewport.clientWidth, horizontalContentWidth(items.length));
      view.rail.style.width = `${totalWidth}px`;
      view.rail.style.height = "";
      view.root.dataset.scrollable = String(totalWidth > view.viewport.clientWidth + 1);
    }
  
    view.empty.style.display = items.length || state.feedStyle === "frameless" ? "none" : "grid";
    updateFilterCounts(view);
  
    if (scrollToLatest) {
      view.viewport.scrollLeft = 0;
      view.viewport.scrollTop = 0;
    } else if (scrollPosition) {
      view.viewport.scrollLeft = Math.max(0, Number(scrollPosition.left) || 0);
      view.viewport.scrollTop = Math.max(0, Number(scrollPosition.top) || 0);
    } else if (prependedCount > 0) {
      const prependedDistance = prependedCount * pitch;
      if (vertical) {
        view.viewport.scrollTop += prependedDistance;
      } else {
        view.viewport.scrollLeft += prependedDistance;
      }
    }
    view.lastRange = "";
    renderVisibleItems(view);
    updateJumpButtons(view);
  }
  
  function destroyCard(card) {
    if (!card) return;
    card.deactivateAudioWaveform?.();
    card.thumbnailResizeObserver?.disconnect();
    for (const media of card.querySelectorAll("video, audio")) discardStagedMedia(media);
    card.remove();
  }
  
  function discardCachedCard(view, id) {
    const card = view?.cardCache?.get(id);
    if (!card) return;
    view.cardCache.delete(id);
    destroyCard(card);
  }
  
  function clearCachedCards(view) {
    if (!view?.cardCache) return;
    for (const card of view.cardCache.values()) destroyCard(card);
    view.cardCache.clear();
  }
  
  function cacheCard(view, id, card) {
    card.deactivateAudioWaveform?.();
    card.thumbnailResizeObserver?.disconnect();
    for (const media of card.querySelectorAll("video, audio")) media.pause();
    card.remove();
    view.cards.delete(id);
  
    if (!state.items.some((item) => item.id === id)) {
      destroyCard(card);
      return;
    }
  
    view.cardCache.delete(id);
    view.cardCache.set(id, card);
    while (view.cardCache.size > THUMBNAIL_CARD_CACHE_SIZE) {
      discardCachedCard(view, view.cardCache.keys().next().value);
    }
  }
  
  function takeCachedCard(view, id) {
    const card = view.cardCache.get(id);
    if (!card) return null;
    view.cardCache.delete(id);
    syncFavoriteButton(card.favoriteButton, state.items.find((item) => item.id === id));
    if (card.thumbnailResizeObserver && card.thumbnailPreview) {
      card.thumbnailResizeObserver.observe(card.thumbnailPreview);
    }
    return card;
  }
  
  function renderVisibleItems(view) {
    const items = filteredItems();
    const vertical = isVerticalView(view);
    const viewportSize = vertical ? view.viewport.clientHeight || 1 : view.viewport.clientWidth || 1;
    const scrollOffset = vertical ? view.viewport.scrollTop : view.viewport.scrollLeft;
    const pitch = viewPitch(view);
    const railPadding = feedRailPadding();
    const { start, end } = visibleItemRange({
      itemCount: items.length,
      viewportSize,
      scrollOffset,
      pitch,
      railPadding,
    });
    const rangeKey = `${state.filter}:${vertical ? "vertical" : "horizontal"}:${items.length}:${start}:${end}`;
  
    if (view.lastRange === rangeKey) return;
    view.lastRange = rangeKey;
  
    const visibleIds = new Set();
    const visibleGapIds = new Set();
    for (let index = start; index < end; index++) {
      const item = items[index];
      visibleIds.add(item.id);
  
      let card = view.cards.get(item.id);
      if (!card) {
        card = takeCachedCard(view, item.id) || createCard(item);
        view.cards.set(item.id, card);
        view.rail.appendChild(card);
        card.activateAudioWaveform?.();
      }
      card.style.transform = vertical
        ? `translateY(${railPadding + index * pitch}px)`
        : `translateX(${railPadding + index * pitch}px)`;
  
      if (index < items.length - 1) {
        visibleGapIds.add(item.id);
        let gap = view.gaps.get(item.id);
        if (!gap) {
          gap = document.createElement("div");
          gap.className = "cmf-feed-gap";
          gap.setAttribute("aria-hidden", "true");
          view.gaps.set(item.id, gap);
          view.rail.appendChild(gap);
        }
        gap.dataset.batchBoundary = String(isBatchBoundary(item, items[index + 1]));
        gap.style.width = `${vertical ? state.itemWidth : ITEM_GAP}px`;
        gap.style.height = `${vertical ? ITEM_GAP : state.itemHeight}px`;
        gap.style.transform = vertical
          ? `translateY(${railPadding + index * pitch + state.itemHeight}px)`
          : `translateX(${railPadding + index * pitch + state.itemWidth}px)`;
      }
    }
  
    for (const [id, card] of view.cards) {
      if (visibleIds.has(id)) continue;
      cacheCard(view, id, card);
    }
  
    for (const [id, gap] of view.gaps) {
      if (visibleGapIds.has(id)) continue;
      gap.remove();
      view.gaps.delete(id);
    }
  }
  
  Object.assign(actions, {
    createView,
    isBatchBoundary,
    applyFallbackPlacement,
    updateViews,
    saveWorkflowScrollPositions,
    updateViewsForWorkflowTab,
    applyViewSizing,
    handleFeedWheel,
    feedMaxScroll,
    feedScrollOffset,
    updateJumpButtons,
    updateFilterCounts,
    scrollFeedToEdge,
    updateView,
    destroyCard,
    discardCachedCard,
    clearCachedCards,
    cacheCard,
    takeCachedCard,
    renderVisibleItems,
  });
}
