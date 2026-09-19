import assert from "node:assert/strict";
import test from "node:test";

import { displayEntries, entrySignature } from "../web/js/media_feed/batch_entries.js";
import { pinnedComparisonEntry } from "../web/js/media_feed/viewer_compare.js";
import { installViewerRender } from "../web/js/media_feed/viewer_render.js";
import { installViewerShell } from "../web/js/media_feed/viewer_shell.js";
import { installViewerZoom } from "../web/js/media_feed/viewer_zoom.js";
import { installCards } from "../web/js/media_feed/cards.js";

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
    const actions = {
      ensureViewer: () => viewer,
      clearViewerAudioWaveform() {},
      discardStagedMedia() {},
      resetViewerImageView() {},
      syncFavoriteButton(button, item) { favoriteTargets.push(item.id); },
      updateViewerPromptPanel() { metadataTargets.push(viewer.item.id); },
      syncViewerNav() {},
      prepareViewerImage() {},
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
      runtime: { viewer }, actions,
    });

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

    const pointer = { button: 0, pointerId: 1, clientX: 50, clientY: 50 };
    grid.dispatch("pointerdown", { ...pointer, target: grid.children[0].children[0] });
    grid.dispatch("pointermove", { ...pointer, clientX: 70 });
    // A swipe selects its starting cell, but moving back to the starting point
    // must still keep it from receiving focus as a click.
    grid.dispatch("pointerup", { ...pointer, target: grid });
    assert.equal(viewer.item.id, "one");
    assert.deepEqual(metadataTargets, ["two", "one"]);
    assert.notEqual(document.activeElement, grid.children[0]);

    const videoCell = grid.children[2];
    let pauses = 0;
    for (const player of grid.querySelectorAll("video, audio")) player.pause = () => { pauses++; };
    grid.dispatch("pointerdown", { ...pointer, target: videoCell.children[0] });
    grid.dispatch("pointerup", { ...pointer, target: grid });
    assert.equal(viewer.item.id, "three");
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
    await actions.renderViewerItem(displayEntries([media("q", "q", "audio")], true)[0]);
    assert.equal(viewer.media.children[0].styles.get("--cmf-batch-row-count"), "1");
    assert.equal(viewer.media.children[0].dataset.naturalWidth, "96");
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

test("batch thumbnail preserves decoded images and uses compact audio previews", async () => {
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
      formatMediaDuration() { return ""; },
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
  let clearSuppression;
  globalThis.window = { setTimeout(callback) { clearSuppression = callback; } };

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
      entry: { kind: "batch", key: "batch:p" }, item: media("one", "p"),
      media: mediaFrame, root: { dataset: {} },
      imageBaseMode: "fit", imageZoom: 1, imagePanX: 0, imagePanY: 0,
      zoomControls: { hidden: true }, fitButton: button(), nativeButton: button(),
      zoomOutButton: button(), zoomInButton: button(), zoomLevel: { textContent: "—" },
    };
    const state = { viewerFitScale: 100, scaleViewerMedia: false };
    const context = { app: {}, api: {}, ICONS: {}, state, runtime: { viewer }, actions: { setScaleViewerMedia() { throw new Error("Batch size must not change the single-media setting"); } } };
    installViewerZoom(context);
    context.actions.prepareViewerImage(grid);
    context.actions.updateViewerImageLayout();

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
    clearSuppression?.();

    const video = new MockVideo();
    const videoTarget = { closest: (selector) => selector === "video" ? video : null };
    let pointerDefaultPrevented = false;
    context.actions.handleViewerImagePointerDown({
      currentTarget: grid, target: videoTarget, button: 0,
      pointerId: 2, clientX: 100, clientY: 100,
      preventDefault() { pointerDefaultPrevented = true; },
    });
    assert.equal(pointerDefaultPrevented, false, "a video click remains native until it becomes a drag");
    context.actions.finishViewerImageDrag({ currentTarget: grid, pointerId: 2 });
    let clickDefaultPrevented = false;
    grid.listeners.get("click")({
      preventDefault() { clickDefaultPrevented = true; },
      stopPropagation() {},
    });
    assert.equal(clickDefaultPrevented, false, "a video click can toggle playback");

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
    let clickPropagationStopped = false;
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
    clearSuppression?.();

    context.actions.handleViewerImageDoubleClick({
      currentTarget: grid, target: { closest: () => null }, button: 0,
      preventDefault() {}, stopPropagation() {},
    });
    assert.equal(viewer.imageZoom, 1);
    assert.equal(viewer.imagePanX, 0);
    context.actions.setViewerImageBaseMode("native");
    assert.equal(viewer.imageBaseMode, "fit");
    assert.equal(grid.style.width, "400px");
    assert.equal(state.scaleViewerMedia, false);
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
      items: entries, index: 0, prevButton: {}, nextButton: {},
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
    entry: { kind: "batch" }, item: { key: media.dataset.mediaItemKey },
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
