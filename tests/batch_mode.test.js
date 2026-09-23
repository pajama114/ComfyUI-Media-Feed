import assert from "node:assert/strict";
import test from "node:test";

import { displayEntries, entrySignature, isBatchPresentation } from "../web/js/media_feed/batch_entries.js";
import { pinnedComparisonEntry } from "../web/js/media_feed/viewer_compare.js";
import { installViewerRender } from "../web/js/media_feed/viewer_render.js";
import { installViewerMetadata } from "../web/js/media_feed/viewer_metadata.js";
import { installViewerShell } from "../web/js/media_feed/viewer_shell.js";
import { installViewerZoom } from "../web/js/media_feed/viewer_zoom.js";
import { installCards } from "../web/js/media_feed/cards.js";
import { VIEWER_METADATA_LOADING_DELAY_MS } from "../web/js/media_feed/constants.js";

function media(id, promptId, kind = "image") {
  return { id, key: `${kind}:${id}`, promptId, kind, filename: `${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "wav"}`, url: `/view?filename=${id}` };
}

test("batch view groups prompt outputs in output order and leaves ungrouped media alone", () => {
  const items = [
    media("a3", "a"),
    media("b2", "b"),
    media("a2", "a"),
    media("orphan", ""),
    media("b1", "b"),
    media("a1", "a"),
  ];
  assert.equal(displayEntries(items, false), items);

  const entries = displayEntries(items, true);
  assert.deepEqual(entries.map((entry) => entry.key), ["batch:a", "batch:b", "image:orphan"]);
  assert.deepEqual(entries[0].items.map((item) => item.id), ["a1", "a2", "a3"]);
  assert.deepEqual(entries[1].items.map((item) => item.id), ["b1", "b2"]);
  assert.equal(entries[2], items[3]);
  assert.equal(isBatchPresentation(entries[0]), true);
  assert.equal(isBatchPresentation(displayEntries([media("only", "only")], true)[0]), false);

  const replaced = displayEntries([{ ...items[0], id: "a3-new" }, ...items.slice(1)], true);
  assert.notEqual(entrySignature(entries[0]), entrySignature(replaced[0]));
});

test("comparison pins a batch snapshot while the browsing batch changes", () => {
  const left = displayEntries([media("two", "p"), media("one", "p")], true)[0];
  const pinned = pinnedComparisonEntry({ entry: left, item: left.items[1] });
  assert.notEqual(pinned, left);
  assert.notEqual(pinned.items, left.items);
  assert.deepEqual(pinned.items.map((item) => item.id), ["one", "two"]);

  left.items.push(media("three", "p"));
  assert.deepEqual(pinned.items.map((item) => item.id), ["one", "two"]);
});

test("switching grid cells keeps rendered metadata visible while the next item loads", () => {
  const originalWindow = globalThis.window;
  const timers = new Map();
  let nextTimer = 0;
  globalThis.window = {
    setTimeout(callback, delay) {
      assert.equal(delay, VIEWER_METADATA_LOADING_DELAY_MS);
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  try {
    const attributes = new Map();
    const panel = {
      dataset: { rendered: "true", loading: "false", pending: "false" },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name); },
    };
    const viewer = {
      entry: displayEntries([media("one", "p"), media("two", "p")], true)[0],
      item: media("two", "p", "audio"),
      root: { dataset: { open: "true" } },
      promptPanel: panel,
      promptStatus: { textContent: "previous status" },
      scanFullMetadataButton: { hidden: false, disabled: false },
      copyAllMetadataButton: { disabled: false },
      downloadMetadataButton: { disabled: true },
      resourcesGrid: { replaceChildren() {}, childElementCount: 0 },
      resourcesSection: {},
      metadataGrid: { replaceChildren() {}, childElementCount: 0 },
      metadataSection: {},
      media: { querySelector: () => null },
      promptSeed: {},
      promptPositive: { textContent: "previous prompt" },
      promptNegative: {},
      promptLoadingTimer: 0,
    };
    const context = {
      state: {}, runtime: { viewer, mediaDimensionCache: new Map() },
      services: { getCachedPromptMetadata() {}, loadPromptMetadata() {} },
      actions: { formatAllViewerMetadata: () => "copy text" },
    };
    installViewerMetadata(context);

    context.actions.beginViewerPromptPanelLoading();
    assert.equal(panel.dataset.loading, "false");
    assert.equal(panel.dataset.pending, "false");
    assert.equal(viewer.promptPositive.textContent, "previous prompt");
    assert.equal(viewer.promptStatus.textContent, "previous status");
    assert.equal(viewer.scanFullMetadataButton.hidden, false);
    assert.equal(viewer.scanFullMetadataButton.disabled, false);
    assert.equal(viewer.copyAllMetadataButton.disabled, false);
    assert.equal(viewer.downloadMetadataButton.disabled, true);
    assert.equal(viewer.copyAllMetadataButton.inert, true);
    assert.equal(viewer.downloadMetadataButton.inert, true);
    context.actions.clearViewerPromptLoadingTimer();
    assert.equal(timers.size, 0, "a quick read shows no intermediate loading state");

    context.actions.beginViewerPromptPanelLoading();
    timers.get(viewer.promptLoadingTimer)();
    assert.equal(panel.dataset.pending, "true");
    assert.equal(panel.dataset.loading, "false");
    assert.equal(viewer.promptPositive.textContent, "previous prompt");
    assert.equal(viewer.promptStatus.textContent, "previous status");
    assert.equal(viewer.copyAllMetadataButton.disabled, false);
    assert.equal(viewer.downloadMetadataButton.disabled, true);

    context.actions.renderPromptMetadata({ positive: "new prompt", embeddedJson: { workflow: {} } }, viewer.item.id);
    assert.equal(viewer.promptPositive.textContent, "new prompt");
    assert.equal(viewer.copyAllMetadataButton.inert, false);
    assert.equal(viewer.downloadMetadataButton.inert, false);
    assert.equal(viewer.copyAllMetadataButton.disabled, false);
    assert.equal(viewer.downloadMetadataButton.disabled, false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("batch selection follows clicks, drags, and keyboard and survives updates and stale grids", async () => {
  const originalDocument = globalThis.document;
  const originalObserver = globalThis.IntersectionObserver;

  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.className = "";
      this.listeners = new Map();
      this.attributes = new Map();
      this.styles = new Map();
      this.style = { setProperty: (key, value) => this.styles.set(key, value) };
      this.classList = { add: (name) => { this.className += `${this.className ? " " : ""}${name}`; } };
    }

    append(...children) {
      for (const child of children) {
        if (child.parentElement) {
          child.parentElement.children = child.parentElement.children.filter((current) => current !== child);
        }
        child.parentElement = this;
        this.children.push(child);
      }
    }
    replaceChildren(...children) {
      for (const child of this.children) child.parentElement = null;
      this.children = [];
      this.append(...children);
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name); }
    contains(element) { return element === this || this.children.some((child) => child.contains(element)); }
    closest(selector) {
      if (selector === ".cmf-viewer-batch-cell" && this.className === "cmf-viewer-batch-cell"
        || selector === "video, audio" && ["VIDEO", "AUDIO"].includes(this.tagName)) return this;
      return this.parentElement?.closest(selector) || null;
    }
    focus() { document.activeElement = this; }
    hasAttribute(name) { return name === "src" && Boolean(this.src); }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    dispatch(type, event) { for (const listener of this.listeners.get(type) || []) listener(event); }
    querySelectorAll(selector) {
      const matches = (element) => selector === ".cmf-viewer-batch-cell"
        ? element.className.split(" ").includes("cmf-viewer-batch-cell")
        : selector === ".cmf-viewer-batch-grid" && element.className === "cmf-viewer-batch-grid"
          || selector === "video" && element.tagName === "VIDEO"
          || selector === "audio" && element.tagName === "AUDIO"
          || selector === "video, audio" && ["VIDEO", "AUDIO"].includes(element.tagName);
      const result = [];
      const visit = (element) => {
        for (const child of element.children) {
          if (matches(child)) result.push(child);
          visit(child);
        }
      };
      visit(this);
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }

  globalThis.document = { createElement: (tagName) => new Element(tagName) };
  delete globalThis.IntersectionObserver;
  let finishNewImage;
  const newImageReady = new Promise((resolve) => { finishNewImage = resolve; });
  let finishStaleImage;
  const staleImageReady = new Promise((resolve) => { finishStaleImage = resolve; });

  try {
    const metadataTargets = [];
    const favoriteTargets = [];
    const audioPresentations = [];
    const viewer = {
      root: { dataset: { open: "true" } },
      media: new Element("div"),
      title: new Element("div"),
      openLink: { href: "" },
      copyImageButton: { hidden: true },
      favoriteButton: {},
      renderRequestId: 0,
      item: null,
      entry: null,
    };
    const resetModes = [];
    const actions = {
      ensureViewer: () => viewer,
      clearViewerAudioWaveform() {},
      discardStagedMedia() {},
      resetViewerImageView(mode) { resetModes.push(mode); },
      syncFavoriteButton(button, item) { favoriteTargets.push(item.id); },
      updateViewerPromptPanel() { metadataTargets.push(viewer.item.id); },
      syncViewerNav() {},
      prepareViewerImage() {},
      rememberDecodedImage() {},
      rememberMediaDimensions() {},
      isCurrentViewerRender: (currentViewer, requestId, item) => currentViewer === viewer
        && viewer.renderRequestId === requestId && viewer.item?.key === item.key,
      decodeImageElement: (image) => image.src.includes("five") ? newImageReady
        : image.src.includes("stale") ? staleImageReady : Promise.resolve(),
      updateViewerImageLayout() {},
      refreshViewerPromptPanelDetails() {},
      createViewerAudioPresentation(audio) {
        const presentation = new Element("div");
        presentation.className = "cmf-viewer-audio";
        presentation.append(audio);
        return presentation;
      },
      setupViewerAudioWaveform(owner, audio, url) {
        audioPresentations.push({
          itemKey: audio.dataset.mediaItemKey,
          ownerKey: owner.dataset.mediaItemKey,
          url,
        });
      },
    };
    installViewerRender({
      app: {}, api: {}, ICONS: { music: "<svg></svg>" },
      state: { loopVideos: false, loopAudio: false },
      runtime: { viewer, decodedImageCache: new Map() }, actions,
    });

    const single = displayEntries([media("only", "only")], true)[0];
    await actions.renderViewerItem(single);
    assert.equal(viewer.entry, single, "the grouped entry remains available for navigation");
    assert.equal(viewer.item, single.items[0]);
    assert.equal(viewer.media.children[0].tagName, "IMG");
    assert.equal(viewer.media.querySelector(".cmf-viewer-batch-grid"), null);
    assert.equal(viewer.title.dataset.batch, undefined);
    assert.equal(resetModes.at(-1), "native");

    const items = [media("four", "p", "audio"), media("three", "p", "video"), media("two", "p"), media("one", "p")];
    await actions.renderViewerItem(displayEntries(items, true)[0]);
    let grid = viewer.media.children[0];
    const originalCells = [...grid.children];
    assert.equal(grid.children.length, 4);
    assert.equal(grid.styles.get("--cmf-batch-columns"), "2");
    assert.equal(grid.styles.get("--cmf-batch-row-count"), "2");
    assert.equal(grid.dataset.naturalWidth, "192");
    assert.equal(grid.dataset.naturalHeight, "192");
    assert.equal(viewer.item.id, "one");
    assert.deepEqual(viewer.title.children.map((part) => part.textContent), ["one.png", "\u00a0–\u00a0", "four.wav"]);
    assert.equal(viewer.title.title, "one.png\ntwo.png\nthree.mp4\nfour.wav");
    assert.deepEqual(grid.children.map((cell) => cell.dataset.selected), ["true", "false", "false", "false"]);
    assert.equal(grid.dataset.selectionVisible, "true");
    assert.equal(grid.children[0].getAttribute("aria-current"), "true");
    assert.equal(grid.children[1].tabIndex, 0);
    assert.equal(grid.children[3].children[0].className, "cmf-viewer-audio cmf-viewer-batch-audio");
    assert.deepEqual(audioPresentations, [{
      itemKey: "audio:four",
      ownerKey: "audio:four",
      url: "/view?filename=four",
    }]);

    grid.dispatch("click", { target: grid.children[1], detail: 0 });
    assert.equal(viewer.item.id, "two");
    assert.equal(viewer.openLink.href, "/view?filename=two");
    assert.equal(viewer.mediaReadyItemId, "two");
    assert.equal(viewer.copyImageButton.hidden, false);
    assert.deepEqual(metadataTargets, ["two"]);
    assert.equal(favoriteTargets.at(-1), "two");
    assert.equal(viewer.media.children[0], grid);
    assert.deepEqual(grid.children.map((cell) => cell.dataset.selected), ["false", "true", "false", "false"]);

    actions.setViewerBatchSelectionVisible(false);
    assert.equal(viewer.item.id, "two", "hiding the frame preserves the internal selection");
    assert.equal(grid.children[1].dataset.selected, "true");
    assert.equal(grid.children[1].getAttribute("aria-current"), "true");
    assert.equal(grid.dataset.selectionVisible, "false");
    grid.dispatch("pointerdown", { button: 0, pointerId: 9, clientX: 10, clientY: 10, target: grid.children[1] });
    grid.dispatch("pointerup", { button: 0, pointerId: 9, clientX: 10, clientY: 10, target: grid.children[1] });
    assert.equal(viewer.item.id, "two");
    assert.equal(grid.dataset.selectionVisible, "true", "clicking the selected media restores its frame");

    const zoomPointer = { button: 0, pointerId: 10, clientX: 20, clientY: 20 };
    grid.dispatch("pointerdown", { ...zoomPointer, target: grid.children[0] });
    assert.equal(viewer.item.id, "two", "selection remains committed on release");
    assert.equal(grid.dataset.selectionVisible, "false",
      "the previous frame is hidden while pressing a different cell");
    grid.dispatch("pointerup", { ...zoomPointer, target: grid.children[0] });
    assert.equal(viewer.item.id, "one", "the first click of a double-click selects immediately");
    assert.equal(grid.dataset.selectionVisible, "true");
    grid.dispatch("pointerdown", { ...zoomPointer, target: grid.children[0] });
    grid.dispatch("pointerup", { ...zoomPointer, target: grid.children[0] });
    assert.equal(viewer.item.id, "one", "double-click keeps its target selected");
    assert.equal(grid.children[0].dataset.selected, "true", "the frame stays on the double-click target");
    const metadataTargetsAfterDoubleClick = [...metadataTargets];
    const focusAfterDoubleClick = document.activeElement;

    const pointer = { button: 0, pointerId: 1, clientX: 50, clientY: 50 };
    grid.dispatch("pointerdown", { ...pointer, target: grid.children[0].children[0] });
    grid.dispatch("pointermove", { ...pointer, clientX: 70 });
    viewer.imageDrag = { pointerId: 1, moved: true };
    grid.dispatch("pointerup", { ...pointer, target: grid });
    viewer.imageDrag = null;
    assert.equal(viewer.item.id, "one", "panning must not change the batch selection");
    assert.deepEqual(metadataTargets, metadataTargetsAfterDoubleClick);
    assert.equal(document.activeElement, focusAfterDoubleClick, "panning must not change focus");

    viewer.media.dataset.pannable = "true";
    grid.dispatch("pointerdown", { ...pointer, pointerId: 2, target: grid.children[1] });
    assert.equal(viewer.item.id, "one", "a pannable grid waits until release before selecting");
    viewer.imageDrag = { pointerId: 2, moved: false };
    grid.dispatch("pointerup", { ...pointer, pointerId: 2, target: grid.children[1] });
    viewer.imageDrag = null;
    assert.equal(viewer.item.id, "two", "a click still changes selection while the grid is pannable");
    actions.selectViewerBatchItem("image:one");
    let capturedClickStopped = false;
    grid.dispatch("click", {
      button: 0, detail: 1, target: grid,
      stopPropagation() { capturedClickStopped = true; },
    });
    assert.equal(viewer.item.id, "two",
      "a pointer-captured click retargeted to the grid still selects its pressed cell");
    assert.equal(capturedClickStopped, true,
      "the backdrop must not hide selection after a pointer-captured cell click");
    assert.equal(grid.dataset.selectionVisible, "true");
    viewer.media.dataset.pannable = "false";

    const audioControl = grid.children[3].children[0].children[0];
    grid.dispatch("pointerdown", { ...pointer, target: audioControl });
    grid.dispatch("pointermove", { ...pointer, clientX: 70 });
    grid.dispatch("pointerup", { ...pointer, target: grid });
    assert.equal(viewer.item.id, "four", "a non-pan control drag still selects its media");
    actions.selectViewerBatchItem("image:two");

    const videoCell = grid.children[2];
    assert.equal(videoCell.children[0].getAttribute("controlslist"), "nofullscreen");
    let pauses = 0;
    for (const player of grid.querySelectorAll("video, audio")) player.pause = () => { pauses++; };
    grid.dispatch("pointerdown", { ...pointer, target: videoCell.children[0] });
    grid.dispatch("focusin", { target: videoCell.children[0] });
    assert.equal(viewer.item.id, "two", "pointer focus waits for release before selecting");
    grid.dispatch("pointerup", { ...pointer, target: grid });
    assert.equal(viewer.item.id, "three", "video selection is immediate on pointer release");
    assert.equal(viewer.copyImageButton.hidden, true);
    assert.equal(pauses, 0);

    grid.dispatch("pointerdown", { ...pointer, target: grid.children[0] });
    grid.dispatch("pointercancel", pointer);
    grid.dispatch("pointerup", { ...pointer, target: grid });
    assert.equal(viewer.item.id, "three");

    const enter = { key: "Enter", target: grid.children[3], preventDefault() {}, stopPropagation() {} };
    grid.dispatch("keydown", { ...enter, ctrlKey: true });
    assert.equal(viewer.item.id, "three");
    grid.dispatch("keydown", enter);
    assert.equal(viewer.item.id, "four");
    assert.equal(pauses, 0);
    grid.dispatch("focusin", { target: videoCell.children[0] });
    assert.equal(viewer.item.id, "three");
    assert.equal(pauses, 0, "focusing a native player only changes selection");
    grid.dispatch("focusin", { target: grid.children[1] });
    assert.equal(viewer.item.id, "three", "focusing a cell waits for Enter");
    grid.dispatch("keydown", enter);
    videoCell.children[0].dispatch("play", {});
    assert.equal(viewer.item.id, "three");
    assert.equal(pauses, 1);

    const rendering = actions.renderViewerItem(displayEntries([media("five", "p"), ...items], true)[0]);
    assert.equal(viewer.media.children[0], grid);
    assert.equal(viewer.item.id, "three");
    // Selection can change while a new output is still decoding.
    grid.dispatch("pointerdown", { ...pointer, target: grid.children[1] });
    grid.dispatch("pointerup", { ...pointer, target: grid });
    const focused = document.activeElement;
    finishNewImage();
    await rendering;
    grid = viewer.media.children[0];
    assert.equal(grid.children.length, 5);
    for (let index = 0; index < originalCells.length; index++) {
      assert.equal(grid.children[index], originalCells[index]);
    }
    assert.equal(grid.styles.get("--cmf-batch-columns"), "3");
    assert.equal(grid.styles.get("--cmf-batch-row-count"), "2");
    assert.equal(grid.dataset.naturalWidth, "288");
    assert.equal(grid.dataset.naturalHeight, "192");
    assert.equal(viewer.item.id, "two");
    assert.equal(viewer.mediaReadyItemId, "two");
    assert.equal(document.activeElement, focused);
    assert.equal(grid.children[1].dataset.selected, "true");
    assert.equal(grid.children[4].getAttribute("aria-label"), "5 of 5: five.png");
    assert.deepEqual(viewer.title.children.map((part) => part.textContent), ["one.png", "\u00a0–\u00a0", "five.png"]);
    assert.equal(viewer.title.title, "one.png\ntwo.png\nthree.mp4\nfour.wav\nfive.png");

    const staleRender = actions.renderViewerItem(displayEntries([media("stale", "p"), media("five", "p"), ...items], true)[0]);
    assert.equal(viewer.media.children[0], grid);
    await actions.renderViewerItem(displayEntries([media("q2", "q", "audio"), media("q", "q", "audio")], true)[0]);
    assert.equal(viewer.media.children[0].styles.get("--cmf-batch-row-count"), "1");
    assert.equal(viewer.media.children[0].dataset.naturalWidth, "192");
    assert.equal(viewer.media.children[0].dataset.naturalHeight, "96");
    grid.dispatch("click", { target: grid.children[0], detail: 0 });
    assert.equal(viewer.item.id, "q");
    finishStaleImage();
    await staleRender;
    assert.equal(viewer.media.children[0].dataset.mediaItemKey, "batch:q");
    assert.equal(viewer.media.children[0].children[0].dataset.selected, "true");

    await actions.renderViewerItem(displayEntries(items, true)[0]);
    actions.selectViewerBatchItem("image:two");
    await actions.renderViewerItem(displayEntries(items.filter((item) => item.id !== "two"), true)[0]);
    assert.equal(viewer.item.id, "one");
    assert.equal(viewer.media.children[0].children[0].dataset.selected, "true");
  } finally {
    globalThis.document = originalDocument;
    if (originalObserver === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = originalObserver;
  }
});

test("batch thumbnail preserves decoded images and adds video and audio controls", async () => {
  const originalDocument = globalThis.document;
  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.className = "";
      this.classList = { add: (name) => { this.className += ` ${name}`; } };
      this.listeners = new Map();
      if (this.tagName === "AUDIO") {
        this.paused = true;
        this.ended = false;
        this.currentTime = 0;
        this.duration = Number.NaN;
      }
    }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    pause() { this.paused = true; }
    load() {}
    removeAttribute(name) { delete this[name]; }
    querySelector(selector) {
      const matches = (element) => selector === "img" && element.tagName === "IMG"
        || selector === "audio" && element.tagName === "AUDIO"
        || selector === "video" && element.tagName === "VIDEO"
        || selector === "video, audio" && ["VIDEO", "AUDIO"].includes(element.tagName)
        || selector === ".cmf-batch-thumbnail-grid" && element.className === "cmf-batch-thumbnail-grid"
        || selector === ".cmf-batch-more" && element.className === "cmf-batch-more"
        || selector.startsWith(".") && element.className.split(" ").includes(selector.slice(1));
      const visit = (element) => {
        for (const child of element.children) {
          if (matches(child)) return child;
          const nested = visit(child);
          if (nested) return nested;
        }
        return null;
      };
      return visit(this);
    }
    remove() {}
  }
  globalThis.document = { createElement: (tagName) => new Element(tagName) };
  let finishNewImage;
  const newImageReady = new Promise((resolve) => { finishNewImage = resolve; });

  try {
    const opened = [];
    let waveformSubscriptions = 0;
    const actions = {
      rememberDecodedImage() {},
      decodeImageElement: (image) => image.src.includes("three") ? newImageReady : Promise.resolve(),
      openViewer: (batch) => opened.push(batch.items.length),
      createAudioWaveform(className) {
        const waveform = new Element("svg");
        waveform.className = className;
        waveform.dataset.state = "loading";
        return waveform;
      },
      subscribeAudioWaveform() {
        waveformSubscriptions++;
        return () => {};
      },
      formatMediaDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return "";
        const wholeSeconds = Math.floor(seconds);
        return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
      },
      removeMissingMediaItem() {},
    };
    installCards({ app: {}, api: {}, ICONS: { play: "play", pause: "pause" }, state: { loopAudio: false }, runtime: {}, actions });
    const initial = displayEntries([media("two", "p"), media("one", "p")], true)[0];
    const card = actions.createBatchCard(initial);
    const grid = card.children[0];
    const oldCells = [...grid.children];
    const expanded = displayEntries([media("three", "p"), media("two", "p"), media("one", "p")], true)[0];
    const rendering = actions.updateBatchCard(card, expanded);

    assert.deepEqual(grid.children, oldCells);
    card.listeners.get("click")();
    assert.deepEqual(opened, [3]);
    finishNewImage();
    await rendering;
    assert.equal(grid.children.length, 3);
    assert.equal(grid.children[0], oldCells[0]);
    assert.equal(grid.children[1], oldCells[1]);

    const videoBatch = displayEntries([media("clip", "video-prompt", "video")], true)[0];
    const videoCard = actions.createBatchCard(videoBatch);
    const videoCell = videoCard.children[0].children[0];
    const video = videoCell.querySelector("video");
    const videoControls = videoCell.querySelector(".cmf-video-controls");
    const videoPlay = videoCell.querySelector(".cmf-video-play");
    const videoDuration = videoCell.querySelector(".cmf-video-duration");
    assert.ok(videoControls);
    assert.ok(videoPlay);
    assert.ok(videoDuration);
    assert.equal(videoDuration.hidden, true);
    video.duration = 65;
    video.currentTime = 0;
    video.listeners.get("loadedmetadata")();
    assert.equal(videoDuration.textContent, "1:05");
    assert.equal(videoDuration.hidden, false);
    video.paused = true;
    video.play = () => {
      video.paused = false;
      video.listeners.get("play")();
      return Promise.resolve();
    };
    videoPlay.listeners.get("click")({ preventDefault() {}, stopPropagation() {} });
    assert.equal(video.muted, false);
    assert.equal(videoPlay.innerHTML, "pause");
    assert.deepEqual(opened, [3], "playing a grid thumbnail keeps the viewer closed");
    videoCard.listeners.get("click")({ target: { closest: () => videoControls } });
    videoCard.listeners.get("keydown")({ key: "Enter", target: { closest: () => videoControls } });
    assert.deepEqual(opened, [3], "media controls do not open the batch viewer");

    const audioBatch = displayEntries([media("sound", "audio-prompt", "audio")], true)[0];
    const audioCard = actions.createBatchCard(audioBatch);
    const audioCell = audioCard.children[0].children[0];
    assert.ok(audioCell.querySelector(".cmf-audio-preview"));
    assert.ok(audioCell.querySelector(".cmf-audio-waveform"));
    assert.ok(audioCell.querySelector(".cmf-audio-play"));
    assert.ok(audioCell.querySelector(".cmf-audio-duration"));
    assert.ok(audioCell.querySelector("audio"));
    assert.equal(waveformSubscriptions, 0);
    audioCard.activateAudioWaveform();
    assert.equal(waveformSubscriptions, 1);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("batch grid uses fit, zoom, and drag without presenting an arbitrary 1:1 size", () => {
  const originalHTMLElement = globalThis.HTMLElement;
  const originalHTMLImageElement = globalThis.HTMLImageElement;
  const originalHTMLVideoElement = globalThis.HTMLVideoElement;
  const originalHTMLAudioElement = globalThis.HTMLAudioElement;
  const originalWindow = globalThis.window;

  class MockElement {
    constructor() {
      this.classes = new Set();
      this.classList = {
        add: (name) => this.classes.add(name),
        contains: (name) => this.classes.has(name),
      };
      this.dataset = {};
      this.properties = new Map();
      this.style = { width: "", height: "", setProperty: (key, value) => this.properties.set(key, value) };
      this.listeners = new Map();
    }
    get offsetWidth() { return Number.parseFloat(this.style.width) || 0; }
    get offsetHeight() { return Number.parseFloat(this.style.height) || 0; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    setPointerCapture() {}
    hasPointerCapture() { return false; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 }; }
  }
  class MockImage extends MockElement {}
  class MockVideo extends MockElement {}
  class MockAudio extends MockElement {}
  globalThis.HTMLElement = MockElement;
  globalThis.HTMLImageElement = MockImage;
  globalThis.HTMLVideoElement = MockVideo;
  globalThis.HTMLAudioElement = MockAudio;
  let nextTimerId = 0;
  const timers = new Map();
  const runTimers = () => {
    const callbacks = [...timers.values()];
    timers.clear();
    for (const callback of callbacks) callback();
  };
  globalThis.window = {
    setTimeout(callback) { const id = ++nextTimerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };

  try {
    const grid = new MockElement();
    grid.classList.add("cmf-viewer-batch-grid");
    grid.dataset.mediaItemKey = "batch:p";
    grid.dataset.naturalWidth = "192";
    grid.dataset.naturalHeight = "192";
    const mediaFrame = {
      dataset: {},
      querySelector(selector) {
        return selector.includes("cmf-zoomable-batch") ? grid : null;
      },
      getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 400 }; },
    };
    const button = () => ({ disabled: false, setAttribute() {} });
    const viewer = {
      entry: { kind: "batch", key: "batch:p", items: [media("one", "p"), media("two", "p")] }, item: media("one", "p"),
      media: mediaFrame, root: { dataset: {} },
      imageBaseMode: "fit", imageZoom: 1, imagePanX: 0, imagePanY: 0,
      zoomControls: { hidden: true }, fitButton: button(), nativeButton: button(),
      zoomOutButton: button(), zoomInButton: button(), zoomLevel: { textContent: "—" },
    };
    const state = { viewerFitScale: 100, scaleViewerMedia: false };
    const context = {
      app: {}, api: {}, ICONS: {}, state, runtime: { viewer },
      actions: {
        setScaleViewerMedia() { throw new Error("Batch size must not change the single-media setting"); },
      },
    };
    installViewerZoom(context);
    context.actions.prepareViewerImage(grid);
    context.actions.updateViewerImageLayout();

    const checkRepeatedDoubleClicks = (element, target) => {
      context.actions.resetViewerImageView();
      const dispatch = (type, detail, overrides = {}) => element.listeners.get(type)({
        type, detail, currentTarget: element, target, button: 0,
        clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {}, ...overrides,
      });
      dispatch("click", 1);
      dispatch("click", 2);
      assert.equal(viewer.imageZoom, 1, "the initial pair waits for native dblclick");
      dispatch("dblclick", 2);
      assert.equal(viewer.imageZoom, 2);
      for (const [detail, expected] of [[3, 2], [4, 1], [5, 1], [6, 2]]) {
        dispatch("click", detail);
        assert.equal(viewer.imageZoom, expected, `click ${detail} handles the repeated pair`);
      }
      dispatch("dblclick", 6);
      assert.equal(viewer.imageZoom, 2, "a duplicate native dblclick must not toggle again");
      dispatch("click", 8, { button: 2 });
      assert.equal(viewer.imageZoom, 2, "secondary clicks do not zoom");
      viewer[element === grid ? "suppressBatchClick" : "suppressImageClick"] = true;
      dispatch("click", 8);
      assert.equal(viewer.imageZoom, 2, "a drag-suppressed click must not zoom");
      dispatch("click", 1);
      dispatch("click", 2);
      dispatch("dblclick", 2);
      assert.equal(viewer.imageZoom, 1, "a fresh native double-click still works");
      runTimers();
    };
    checkRepeatedDoubleClicks(grid, { closest: () => null });

    assert.equal(viewer.zoomControls.hidden, false);
    assert.equal(viewer.nativeButton.hidden, true);
    assert.equal(viewer.nativeButton.disabled, true);
    assert.equal(grid.style.width, "400px");
    assert.equal(viewer.zoomLevel.textContent, "100%");
    context.actions.setViewerImageZoom(2);
    assert.equal(grid.properties.get("--cmf-image-zoom"), "2");
    assert.equal(mediaFrame.dataset.pannable, "true");

    context.actions.handleViewerImagePointerDown({
      currentTarget: grid, target: { closest: () => null }, button: 0,
      pointerId: 1, clientX: 100, clientY: 100, preventDefault() {},
    });
    context.actions.handleViewerImagePointerMove({ pointerId: 1, clientX: 150, clientY: 70 });
    assert.equal(viewer.imagePanX, 50);
    assert.equal(viewer.imagePanY, -30);
    context.actions.finishViewerImageDrag({ currentTarget: grid, pointerId: 1 });
    runTimers();

    const video = new MockVideo();
    video.videoWidth = 160;
    video.videoHeight = 90;
    video.paused = true;
    let videoPlayCount = 0;
    let videoPauseCount = 0;
    video.play = () => { videoPlayCount++; video.paused = false; return Promise.resolve(); };
    video.pause = () => { videoPauseCount++; video.paused = true; };
    const videoTarget = { closest: (selector) => selector === "video" ? video : null };
    checkRepeatedDoubleClicks(grid, videoTarget);
    assert.equal(videoPlayCount, 0, "repeated pairs must not toggle video playback");
    context.actions.setViewerImageZoom(2);
    let pointerDefaultPrevented = false;
    context.actions.handleViewerImagePointerDown({
      currentTarget: grid, target: videoTarget, button: 0,
      pointerId: 2, clientX: 100, clientY: 100,
      preventDefault() { pointerDefaultPrevented = true; },
    });
    assert.equal(pointerDefaultPrevented, false, "a video click remains native until it becomes a drag");
    context.actions.finishViewerImageDrag({ currentTarget: grid, pointerId: 2 });
    let clickDefaultPrevented = false;
    let clickPropagationStopped = false;
    grid.listeners.get("click")({
      currentTarget: grid, target: videoTarget, button: 0, detail: 1, clientX: 100, clientY: 100,
      preventDefault() { clickDefaultPrevented = true; },
      stopPropagation() { clickPropagationStopped = true; },
    });
    assert.equal(clickDefaultPrevented, true, "a video-picture click is handled by the batch grid");
    assert.equal(clickPropagationStopped, true);
    assert.equal(video.paused, true, "single-click playback waits for a possible double-click");
    assert.equal(videoPlayCount, 0);
    runTimers();
    assert.equal(video.paused, false, "a video-picture click starts playback after the click delay");
    assert.equal(videoPlayCount, 1);

    clickDefaultPrevented = false;
    grid.listeners.get("click")({
      target: videoTarget, button: 0, detail: 1, clientX: 100, clientY: 100,
      preventDefault() { clickDefaultPrevented = true; },
      stopPropagation() {},
    });
    assert.equal(clickDefaultPrevented, true);
    assert.equal(video.paused, false);
    runTimers();
    assert.equal(video.paused, true, "a second video-picture click pauses playback");
    assert.equal(videoPauseCount, 1);

    clickDefaultPrevented = false;
    clickPropagationStopped = false;
    grid.listeners.get("click")({
      target: videoTarget, button: 0, detail: 1, clientX: 100, clientY: 20,
      preventDefault() { clickDefaultPrevented = true; },
      stopPropagation() { clickPropagationStopped = true; },
    });
    assert.equal(clickDefaultPrevented, true, "letterboxed video space is handled by the batch grid");
    assert.equal(clickPropagationStopped, true);
    runTimers();
    assert.equal(video.paused, true, "letterboxed video space selects without starting playback");
    assert.equal(videoPlayCount, 1);

    grid.listeners.get("click")({
      target: videoTarget, button: 0, detail: 1, clientX: 100, clientY: 100,
      preventDefault() {}, stopPropagation() {},
    });
    grid.listeners.get("click")({
      target: videoTarget, button: 0, detail: 2, clientX: 100, clientY: 100,
      preventDefault() {}, stopPropagation() {},
    });
    runTimers();
    assert.equal(video.paused, true, "a double-click does not change video playback");
    assert.equal(videoPlayCount, 1);
    assert.equal(videoPauseCount, 1);

    clickDefaultPrevented = false;
    grid.listeners.get("click")({
      target: videoTarget, button: 0, clientX: 100, clientY: 180,
      preventDefault() { clickDefaultPrevented = true; },
      stopPropagation() {},
    });
    assert.equal(clickDefaultPrevented, false, "native video controls keep their click behavior");
    assert.equal(video.paused, true);

    context.actions.handleViewerImagePointerDown({
      currentTarget: grid, target: videoTarget, button: 0,
      pointerId: 3, clientX: 100, clientY: 100,
      preventDefault() {},
    });
    context.actions.handleViewerImagePointerMove({
      currentTarget: grid, pointerId: 3, clientX: 125, clientY: 100,
      preventDefault() { pointerDefaultPrevented = true; },
    });
    assert.equal(pointerDefaultPrevented, true, "moving over the video switches to batch panning");
    context.actions.finishViewerImageDrag({ currentTarget: grid, pointerId: 3 });
    clickPropagationStopped = false;
    grid.listeners.get("click")({
      preventDefault() { clickDefaultPrevented = true; },
      stopPropagation() { clickPropagationStopped = true; },
    });
    assert.equal(clickDefaultPrevented, true, "a video drag must not toggle playback");
    assert.equal(clickPropagationStopped, true);

    context.actions.handleViewerImagePointerDown({
      currentTarget: grid, target: videoTarget, button: 0,
      pointerId: 4, clientX: 100, clientY: 180,
      preventDefault() { throw new Error("native video controls must remain interactive"); },
    });
    assert.equal(viewer.imageDrag, null);
    runTimers();

    const audioPresentation = new MockElement();
    const audioBackgroundTarget = {
      closest(selector) {
        if (selector === ".cmf-viewer-audio") return audioPresentation;
        return null;
      },
    };
    pointerDefaultPrevented = false;
    context.actions.handleViewerImagePointerDown({
      currentTarget: grid, target: audioBackgroundTarget, button: 0,
      pointerId: 5, clientX: 100, clientY: 100,
      preventDefault() { pointerDefaultPrevented = true; },
    });
    assert.equal(pointerDefaultPrevented, false, "an audio click remains native until it becomes a drag");
    context.actions.handleViewerImagePointerMove({
      currentTarget: grid, pointerId: 5, clientX: 100, clientY: 125,
      preventDefault() { pointerDefaultPrevented = true; },
    });
    assert.equal(pointerDefaultPrevented, true, "moving over the audio background switches to batch panning");
    context.actions.finishViewerImageDrag({ currentTarget: grid, pointerId: 5 });
    clickDefaultPrevented = false;
    grid.listeners.get("click")({
      preventDefault() { clickDefaultPrevented = true; },
      stopPropagation() {},
    });
    assert.equal(clickDefaultPrevented, true, "an audio drag must not toggle playback");
    runTimers();

    const audioTrackTarget = {
      closest(selector) {
        if (selector === ".cmf-viewer-audio") return audioPresentation;
        if (selector.includes(".cmf-viewer-audio-track")) return new MockElement();
        return null;
      },
    };
    context.actions.handleViewerImagePointerDown({
      currentTarget: grid, target: audioTrackTarget, button: 0,
      pointerId: 6, clientX: 100, clientY: 100,
      preventDefault() { throw new Error("the audio waveform must keep its seek gesture"); },
    });
    assert.equal(viewer.imageDrag, null);

    const audioRangeTarget = {
      closest(selector) {
        if (selector === ".cmf-viewer-audio") return audioPresentation;
        if (selector.includes("input")) return new MockElement();
        return null;
      },
    };
    context.actions.handleViewerImagePointerDown({
      currentTarget: grid, target: audioRangeTarget, button: 0,
      pointerId: 7, clientX: 100, clientY: 100,
      preventDefault() { throw new Error("audio range controls must keep their drag gestures"); },
    });
    assert.equal(viewer.imageDrag, null);

    context.actions.resetViewerImageView();
    let videoDoubleClickPrevented = false;
    let videoDoubleClickStopped = false;
    context.actions.handleViewerImageDoubleClick({
      currentTarget: grid, target: videoTarget, button: 0, clientX: 100, clientY: 100,
      preventDefault() { videoDoubleClickPrevented = true; },
      stopPropagation() { videoDoubleClickStopped = true; },
    });
    assert.equal(videoDoubleClickPrevented, true, "double-clicking a video's picture suppresses native fullscreen");
    assert.equal(videoDoubleClickStopped, true);
    assert.equal(viewer.imageZoom, 2, "double-clicking a video's picture zooms the batch grid");

    videoDoubleClickPrevented = false;
    context.actions.handleViewerImageDoubleClick({
      currentTarget: grid, target: videoTarget, button: 0, clientX: 100, clientY: 180,
      preventDefault() { videoDoubleClickPrevented = true; },
      stopPropagation() {},
    });
    assert.equal(videoDoubleClickPrevented, false, "native video controls remain interactive");
    assert.equal(viewer.imageZoom, 2);

    context.actions.handleViewerImageDoubleClick({
      currentTarget: grid, target: videoTarget, button: 0, clientX: 100, clientY: 100,
      preventDefault() {}, stopPropagation() {},
    });
    assert.equal(viewer.imageZoom, 1);
    assert.equal(viewer.imagePanX, 0);

    let audioDoubleClickPrevented = false;
    let audioDoubleClickStopped = false;
    context.actions.handleViewerImageDoubleClick({
      currentTarget: grid, target: audioBackgroundTarget, button: 0, clientX: 100, clientY: 100,
      preventDefault() { audioDoubleClickPrevented = true; },
      stopPropagation() { audioDoubleClickStopped = true; },
    });
    assert.equal(audioDoubleClickPrevented, true, "double-clicking an audio presentation is handled by the grid");
    assert.equal(audioDoubleClickStopped, true);
    assert.equal(viewer.imageZoom, 2, "double-clicking audio zooms the batch grid");

    audioDoubleClickPrevented = false;
    context.actions.handleViewerImageDoubleClick({
      currentTarget: grid, target: audioRangeTarget, button: 0, clientX: 100, clientY: 100,
      preventDefault() { audioDoubleClickPrevented = true; }, stopPropagation() {},
    });
    assert.equal(audioDoubleClickPrevented, false, "audio range controls remain interactive");
    assert.equal(viewer.imageZoom, 2);

    context.actions.handleViewerImageDoubleClick({
      currentTarget: grid, target: audioBackgroundTarget, button: 0, clientX: 100, clientY: 100,
      preventDefault() {}, stopPropagation() {},
    });
    assert.equal(viewer.imageZoom, 1);
    context.actions.setViewerImageBaseMode("native");
    assert.equal(viewer.imageBaseMode, "fit");
    assert.equal(grid.style.width, "400px");
    assert.equal(state.scaleViewerMedia, false);

    const singleImage = new MockImage();
    singleImage.naturalWidth = 200;
    singleImage.naturalHeight = 100;
    singleImage.dataset.mediaItemKey = "image:only";
    context.actions.prepareViewerImage(singleImage);
    viewer.entry = { kind: "batch", key: "batch:only", items: [media("only", "only")] };
    viewer.item = viewer.entry.items[0];
    mediaFrame.querySelector = (selector) => selector.includes("cmf-zoomable-image") ? singleImage : null;
    context.actions.resetViewerImageView("native");

    assert.equal(viewer.imageBaseMode, "native");
    assert.equal(viewer.nativeButton.hidden, false);
    assert.equal(viewer.nativeButton.disabled, false);
    assert.equal(singleImage.style.width, "200px");
    assert.equal(singleImage.style.height, "100px");
    assert.equal(viewer.zoomLevel.textContent, "100%");
    checkRepeatedDoubleClicks(singleImage, singleImage);

    const standaloneVideo = new MockVideo();
    standaloneVideo.videoWidth = 400;
    standaloneVideo.videoHeight = 200;
    standaloneVideo.dataset.mediaItemKey = "video:standalone";
    standaloneVideo.paused = true;
    let standalonePlayCount = 0;
    let standalonePauseCount = 0;
    standaloneVideo.play = () => {
      standalonePlayCount++;
      standaloneVideo.paused = false;
      return Promise.resolve();
    };
    standaloneVideo.pause = () => {
      standalonePauseCount++;
      standaloneVideo.paused = true;
    };
    viewer.entry = viewer.item = media("standalone", "", "video");
    mediaFrame.querySelector = (selector) => selector.includes("cmf-zoomable-video") ? standaloneVideo : null;
    context.actions.prepareViewerImage(standaloneVideo);
    context.actions.resetViewerImageView("fit");
    checkRepeatedDoubleClicks(standaloneVideo, standaloneVideo);
    assert.equal(standalonePlayCount, 0);
    assert.equal(standalonePauseCount, 0);

    let standaloneClickPrevented = false;
    standaloneVideo.listeners.get("click")({
      currentTarget: standaloneVideo, target: standaloneVideo, button: 0, detail: 1, clientY: 100,
      preventDefault() { standaloneClickPrevented = true; }, stopPropagation() {},
    });
    assert.equal(standaloneClickPrevented, true);
    assert.equal(standalonePlayCount, 0, "standalone playback waits for a possible double-click");
    runTimers();
    assert.equal(standalonePlayCount, 1, "clicking a standalone video's picture starts playback");

    let standalonePrevented = false;
    standaloneVideo.listeners.get("dblclick")({
      currentTarget: standaloneVideo, target: standaloneVideo, button: 0,
      clientX: 100, clientY: 100,
      preventDefault() { standalonePrevented = true; }, stopPropagation() {},
    });
    assert.equal(standalonePrevented, true);
    assert.equal(viewer.imageZoom, 2, "double-clicking a standalone video's picture zooms it");
    assert.equal(standaloneVideo.properties.get("--cmf-image-zoom"), "2");
    assert.equal(mediaFrame.dataset.pannable, "true");

    pointerDefaultPrevented = false;
    context.actions.handleViewerImagePointerDown({
      currentTarget: standaloneVideo, target: standaloneVideo, button: 0,
      pointerId: 8, clientX: 100, clientY: 100,
      preventDefault() { pointerDefaultPrevented = true; },
    });
    assert.equal(pointerDefaultPrevented, false, "standalone video capture waits for drag movement");
    context.actions.handleViewerImagePointerMove({
      currentTarget: standaloneVideo, pointerId: 8, clientX: 130, clientY: 100,
      preventDefault() { pointerDefaultPrevented = true; },
    });
    assert.equal(pointerDefaultPrevented, true);
    assert.equal(viewer.imagePanX, 130);
    context.actions.finishViewerImageDrag({ currentTarget: standaloneVideo, pointerId: 8 });
    standaloneClickPrevented = false;
    standaloneVideo.listeners.get("click")({
      currentTarget: standaloneVideo, target: standaloneVideo, button: 0, detail: 1, clientY: 100,
      preventDefault() { standaloneClickPrevented = true; }, stopPropagation() {},
    });
    assert.equal(standaloneClickPrevented, true, "a standalone video pan must not toggle playback");
    runTimers();
    assert.equal(standalonePauseCount, 0);

    standalonePrevented = false;
    standaloneVideo.listeners.get("dblclick")({
      currentTarget: standaloneVideo, target: standaloneVideo, button: 0,
      clientX: 100, clientY: 180,
      preventDefault() { standalonePrevented = true; }, stopPropagation() {},
    });
    assert.equal(standalonePrevented, false, "standalone video controls remain interactive");
    assert.equal(viewer.imageZoom, 2);

    standaloneVideo.listeners.get("dblclick")({
      currentTarget: standaloneVideo, target: standaloneVideo, button: 0,
      clientX: 100, clientY: 100,
      preventDefault() {}, stopPropagation() {},
    });
    assert.equal(viewer.imageZoom, 1, "a second picture double-click restores the base view");
  } finally {
    if (originalHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = originalHTMLElement;
    if (originalHTMLImageElement === undefined) delete globalThis.HTMLImageElement;
    else globalThis.HTMLImageElement = originalHTMLImageElement;
    if (originalHTMLVideoElement === undefined) delete globalThis.HTMLVideoElement;
    else globalThis.HTMLVideoElement = originalHTMLVideoElement;
    if (originalHTMLAudioElement === undefined) delete globalThis.HTMLAudioElement;
    else globalThis.HTMLAudioElement = originalHTMLAudioElement;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("wheel over a batch grid moves to the next batch", () => {
  const originalElement = globalThis.Element;
  const originalWindow = globalThis.window;
  class MockElement { closest() { return null; } }
  globalThis.Element = MockElement;
  globalThis.window = { setTimeout() {} };

  try {
    const first = media("first", "a");
    const second = media("second", "b");
    const entries = displayEntries([first, second], true);
    const viewer = {
      root: { dataset: { open: "true" } }, entry: entries[0], item: entries[0].items[0],
      items: entries, index: 0,
      prevButton: { dataset: {}, setAttribute() {} },
      nextButton: { dataset: {}, setAttribute() {} },
    };
    const rendered = [];
    const actions = {
      filteredItems: () => [first, second],
      renderViewerItem(entry) { rendered.push(entry.key); viewer.entry = entry; viewer.item = entry.items[0]; },
      updateViewerPromptPanel() {},
      getViewerScalableMedia: () => ({}),
    };
    installViewerShell({ app: {}, api: {}, ICONS: {}, state: { batchMode: true }, runtime: { viewer }, actions });
    let prevented = 0;
    actions.handleViewerWheel({
      target: new MockElement(), deltaX: 0, deltaY: 40,
      preventDefault() { prevented++; }, stopPropagation() {},
    });
    assert.deepEqual(rendered, ["batch:b"]);
    assert.equal(viewer.index, 1);
    assert.equal(prevented, 1);
  } finally {
    if (originalElement === undefined) delete globalThis.Element;
    else globalThis.Element = originalElement;
    globalThis.window = originalWindow;
  }
});

test("batch Space pauses playback or plays the selection in the focused comparison pane", () => {
  const player = (key) => ({
    dataset: { mediaItemKey: key }, paused: true, plays: 0, pauses: 0,
    play() { this.paused = false; this.plays++; return Promise.resolve(); },
    pause() { this.paused = true; this.pauses++; },
  });
  const leftPlayer = player("video:left");
  const rightPlayer = player("audio:right");
  const pane = (media) => ({
    entry: { kind: "batch", items: [{}, {}] }, item: { key: media.dataset.mediaItemKey },
    media: { querySelectorAll: () => [media] },
  });
  const viewer = { ...pane(leftPlayer), comparing: true, reference: pane(rightPlayer) };
  const context = { state: {}, runtime: { viewer }, actions: { isViewerOpen: () => true } };
  installViewerShell(context);
  let prevented = 0;
  let stopped = 0;
  const space = {
    key: " ", code: "Space", target: { closest: () => null },
    preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; },
  };
  context.actions.handleViewerGlobalKeydown(space);
  assert.equal(leftPlayer.plays, 1);
  viewer.item = { key: "image:still" };
  context.actions.handleViewerGlobalKeydown(space);
  assert.equal(leftPlayer.pauses, 1);
  context.actions.handleViewerGlobalKeydown(space);
  assert.equal(leftPlayer.plays, 1);

  context.actions.handleViewerGlobalKeydown({
    ...space,
    target: { closest: (selector) => selector === ".cmf-viewer-reference, .cmf-viewer-reference-bar" ? {} : null },
  });
  assert.equal(rightPlayer.plays, 1);
  assert.equal(leftPlayer.paused, true);
  assert.equal(prevented, 4);
  assert.equal(stopped, 4);

  for (const key of [" ", "ArrowRight"]) {
    const nativeEvent = {
      ...space, key,
      target: { closest: (selector) => selector === "video, audio" ? {} : null },
      stopPropagation() { stopped++; },
    };
    context.actions.handleViewerGlobalKeydown(nativeEvent);
    assert.equal(prevented, 4, "capture must let the native controls handle the key");
    context.actions.handleViewerNativeMediaKeydown(nativeEvent);
  }
  assert.equal(prevented, 4, "native player defaults are not cancelled");
  assert.equal(stopped, 6, "native player keys cannot reach the canvas");
  assert.equal(rightPlayer.pauses, 0);

  context.actions.handleViewerGlobalKeydown({ ...space, key: "Enter", code: "Enter", ctrlKey: true });
  assert.equal(prevented, 4);
  assert.equal(stopped, 6);
});
