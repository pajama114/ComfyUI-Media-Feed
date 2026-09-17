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

test("batch viewer renders every output as one grid without selectable cells", async () => {
  const originalDocument = globalThis.document;
  const originalObserver = globalThis.IntersectionObserver;

  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.className = "";
      this.listeners = new Map();
      this.styles = new Map();
      this.style = { setProperty: (key, value) => this.styles.set(key, value) };
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
    setAttribute() {}
    hasAttribute(name) { return name === "src" && Boolean(this.src); }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    click() { for (const listener of this.listeners.get("click") || []) listener({ target: this }); }
    querySelectorAll(selector) {
      const matches = (element) => selector === ".cmf-viewer-batch-cell"
        ? element.className.split(" ").includes("cmf-viewer-batch-cell")
        : selector === ".cmf-viewer-batch-grid" && element.className === "cmf-viewer-batch-grid"
          || selector === "video" && element.tagName === "VIDEO"
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
    const viewer = {
      root: { dataset: { open: "true" } },
      media: new Element("div"),
      title: { textContent: "", title: "" },
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
      syncFavoriteButton() {},
      syncViewerNav() {},
      prepareViewerImage() {},
      decodeImageElement: (image) => image.src.includes("five") ? newImageReady
        : image.src.includes("stale") ? staleImageReady : Promise.resolve(),
      updateViewerImageLayout() {},
      refreshViewerPromptPanelDetails() {},
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
    assert.equal(viewer.item.id, "one");
    assert.equal(grid.children[2].listeners.has("click"), false);

    const rendering = actions.renderViewerItem(displayEntries([media("five", "p"), ...items], true)[0]);
    assert.equal(viewer.media.children[0], grid);
    finishNewImage();
    await rendering;
    grid = viewer.media.children[0];
    assert.equal(grid.children.length, 5);
    for (let index = 0; index < originalCells.length; index++) {
      assert.equal(grid.children[index], originalCells[index]);
    }
    assert.equal(grid.styles.get("--cmf-batch-columns"), "3");
    assert.equal(viewer.item.id, "one");

    const staleRender = actions.renderViewerItem(displayEntries([media("stale", "p"), media("five", "p"), ...items], true)[0]);
    assert.equal(viewer.media.children[0], grid);
    await actions.renderViewerItem(displayEntries([media("q", "q", "audio")], true)[0]);
    finishStaleImage();
    await staleRender;
    assert.equal(viewer.media.children[0].dataset.mediaItemKey, "batch:q");
  } finally {
    globalThis.document = originalDocument;
    if (originalObserver === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = originalObserver;
  }
});

test("batch thumbnail keeps displayed images while a new image is decoded", async () => {
  const originalDocument = globalThis.document;
  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.className = "";
      this.classList = { add: (name) => { this.className += ` ${name}`; } };
      this.listeners = new Map();
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    querySelector(selector) {
      const matches = (element) => selector === "img" && element.tagName === "IMG"
        || selector === ".cmf-batch-thumbnail-grid" && element.className === "cmf-batch-thumbnail-grid"
        || selector === ".cmf-batch-more" && element.className === "cmf-batch-more";
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
    const actions = {
      rememberDecodedImage() {},
      decodeImageElement: (image) => image.src.includes("three") ? newImageReady : Promise.resolve(),
      openViewer: (batch) => opened.push(batch.items.length),
    };
    installCards({ app: {}, api: {}, ICONS: {}, state: {}, runtime: {}, actions });
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
  } finally {
    globalThis.document = originalDocument;
  }
});

test("batch grid uses fit, zoom, and drag without presenting an arbitrary 1:1 size", () => {
  const originalHTMLElement = globalThis.HTMLElement;
  const originalHTMLImageElement = globalThis.HTMLImageElement;
  const originalHTMLVideoElement = globalThis.HTMLVideoElement;
  const originalHTMLAudioElement = globalThis.HTMLAudioElement;

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
  }
  class MockImage extends MockElement {}
  class MockVideo extends MockElement {}
  class MockAudio extends MockElement {}
  globalThis.HTMLElement = MockElement;
  globalThis.HTMLImageElement = MockImage;
  globalThis.HTMLVideoElement = MockVideo;
  globalThis.HTMLAudioElement = MockAudio;

  try {
    const grid = new MockElement();
    grid.classList.add("cmf-viewer-batch-grid");
    grid.dataset.mediaItemKey = "batch:p";
    grid.dataset.naturalSize = "192";
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
