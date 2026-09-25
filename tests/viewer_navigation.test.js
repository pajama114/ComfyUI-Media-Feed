import assert from "node:assert/strict";
import test from "node:test";
import { displayEntries } from "../web/js/media_feed/batch_entries.js";
import { installViewerShell } from "../web/js/media_feed/viewer_shell.js";

const image = (key, promptId = "") => ({ id: key, key, kind: "image", promptId });

function navigation(t, media, { batchMode = false } = {}) {
  const originals = { window: globalThis.window, document: globalThis.document, Element: globalThis.Element };
  class Target {
    constructor(side, metadata = false) { this.side = side; this.metadata = metadata; }
    closest(selector) {
      if (selector === ".cmf-viewer-reference, .cmf-viewer-reference-bar") return this.side === "right" ? this : null;
      if (selector === ".cmf-viewer-pane, .cmf-viewer-pane-bar") return this.side ? this : null;
      if (selector === ".cmf-prompt-panel") return this.metadata ? this : null;
      return null;
    }
  }
  globalThis.Element = Target;
  globalThis.window = { setTimeout: () => 1, clearTimeout() {}, matchMedia: () => ({ matches: false }) };
  globalThis.document = { activeElement: null };
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  let items = media;
  const entries = displayEntries(items, batchMode);
  const button = () => ({ dataset: {}, setAttribute() {}, matches: () => false });
  const root = { dataset: { open: "true" }, focus() { document.activeElement = this; } };
  const pane = (side) => ({
    root, entry: entries[0], item: entries[0].items?.[0] || entries[0], items: entries, index: 0,
    prevButton: button(), nextButton: button(), renderRequestId: 0,
    paneElement: { dataset: {}, contains: (target) => target?.side === side },
    paneHeader: { dataset: {}, contains: () => false },
    media: { querySelectorAll: () => [] },
    imageBaseMode: "fit", imageZoom: 1, imagePanX: 0, imagePanY: 0,
  });
  const left = pane("left"), right = pane("right");
  left.comparing = true;
  left.reference = right;
  const rendered = [], metadata = [], zoomed = [];
  const controls = (pane) => ({
    renderViewerItem(entry, thumbnail, options) {
      const selected = pane.entry?.key === entry.key ? pane.item?.key : null;
      pane.entry = entry;
      pane.item = entry.items?.find((item) => item.key === selected) || entry.items?.[0] || entry;
      pane.renderRequestId++;
      rendered.push({ pane, entry, options });
      actions.syncViewerNav(pane);
      return Promise.resolve();
    },
    updateViewerPromptPanel() { metadata.push(pane); },
    getViewerScalableMedia: () => ({}),
    setViewerImageZoom(value) { zoomed.push(pane); pane.imageZoom = value; },
  });
  const actions = {
    ...controls(left), filteredItems: () => items, isViewerOpen: () => root.dataset.open === "true",
    updateViewerImageLayout() {},
  };
  right.controller = controls(right);
  installViewerShell({ state: { batchMode }, runtime: { viewer: left }, actions });
  const event = (side, values = {}) => ({
    target: new Target(side), preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; }, stopPropagation() { this.stopped = true; },
    ...values,
  });
  return { left, right, actions, rendered, metadata, zoomed, event, setItems(value) { items = value; } };
}

test("comparison arrows navigate the active pane independently and respect each boundary", (t) => {
  const { left, right, actions, event, metadata } = navigation(t, [image("a"), image("b"), image("c")]);
  actions.handleViewerPaneInteraction(event("right", { type: "focusin" }));
  const key = event(null, { key: "ArrowRight" });
  actions.handleViewerGlobalKeydown(key);
  assert.equal(right.item.key, "b");
  assert.equal(left.item.key, "a");
  assert.equal(right.prevButton.disabled, false);
  assert.equal(left.prevButton.disabled, true);
  assert.deepEqual(metadata, [right]);
  assert.equal(key.prevented, true);
  assert.equal(key.stopped, true);
  assert.equal(right.paneElement.dataset.active, "true");
  assert.equal(left.paneElement.dataset.active, "false");
  actions.showViewerRelative(1, right);
  actions.showViewerRelative(1, right);
  assert.equal(right.item.key, "c");
  assert.equal(right.nextButton.disabled, true);
  actions.handleViewerGlobalKeydown(event("left", { key: "ArrowRight" }));
  assert.equal(left.item.key, "b");
  assert.equal(right.item.key, "c");
});

test("wheel targets its pane, preserves metadata scrolling and zooms the targeted controller", (t) => {
  const { left, right, actions, event, zoomed } = navigation(t, [image("a"), image("b")]);
  document.activeElement = event("left").target;
  actions.handleViewerWheel(event("right", { type: "wheel", deltaY: 40, deltaX: 0 }));
  assert.equal(document.activeElement, left.root);
  assert.equal(actions.getViewerPane(), right);
  assert.equal(right.item.key, "b");
  assert.equal(left.item.key, "a");
  actions.handleViewerWheel(event("left", { deltaY: 40, deltaX: 0 }));
  assert.equal(left.item.key, "b", "the other pane must not share the wheel lock");
  const scroll = event("right", { deltaY: -40, deltaX: 0 });
  scroll.target.metadata = true;
  actions.handleViewerWheel(scroll);
  assert.equal(scroll.prevented, undefined);
  assert.equal(right.item.key, "b");
  actions.handleViewerWheel(event("right", { deltaY: -40, deltaX: 0, ctrlKey: true }));
  assert.deepEqual(zoomed, [right]);
  assert.ok(right.imageZoom > 1);
  assert.equal(left.imageZoom, 1);
  right.controller.getViewerScalableMedia = () => null;
  right.wheelLock = false;
  actions.handleViewerWheel(event("right", { deltaY: -40, deltaX: 0, ctrlKey: true }));
  assert.equal(right.item.key, "b", "Ctrl+wheel on audio must not navigate");
});

test("new arrivals keep both selections and clear each new-media indicator independently", (t) => {
  const a = image("a"), b = image("b"), fresh = image("new");
  const { left, right, actions, setItems, rendered } = navigation(t, [a, b]);
  actions.showViewerRelative(1, right);
  rendered.length = 0;
  setItems([fresh, a, b]);
  actions.syncViewerItems({ newMediaAdded: true });
  assert.equal(left.item, a);
  assert.equal(right.item, b);
  assert.deepEqual([left.index, right.index], [1, 2]);
  assert.deepEqual(rendered, []);
  assert.equal(left.prevButton.dataset.newMedia, "true");
  assert.equal(right.prevButton.dataset.newMedia, "true");
  actions.showViewerRelative(-1, left);
  assert.equal(left.prevButton.dataset.newMedia, "false");
  assert.equal(right.prevButton.dataset.newMedia, "true");
});

test("batch arrivals update both grids while preserving independent cell selections", (t) => {
  const one = image("one", "batch"), two = image("two", "batch"), three = image("three", "batch");
  const { left, right, actions, setItems, rendered } = navigation(t, [two, one], { batchMode: true });
  right.item = two;
  setItems([three, two, one]);
  actions.syncViewerItems({ newMediaAdded: true });
  assert.equal(left.item, one);
  assert.equal(right.item, two);
  assert.deepEqual(rendered.map(({ pane }) => pane), [left, right]);
  for (const pane of [left, right]) assert.deepEqual(pane.entry.items, [one, two, three]);
});

test("removing an entry only replaces the affected pane", (t) => {
  const a = image("a", "p"), b = image("b", "q"), c = image("c", "r");
  const { left, right, actions, setItems, rendered } = navigation(t, [a, b, c]);
  actions.showViewerRelative(1, right);
  rendered.length = 0;
  setItems([a, c]);
  actions.syncViewerItems();
  assert.equal(left.item, a);
  assert.equal(right.item, c);
  assert.deepEqual(rendered.map(({ pane }) => pane), [right]);
});

test("selecting an image clears focus in the other pane and Space remembers the selected side", (t) => {
  const { left, right, actions, event } = navigation(t, [image("a")]);
  document.activeElement = event("left").target;
  actions.handleViewerPaneInteraction(event("right", { type: "pointerdown" }));
  assert.equal(document.activeElement, left.root);
  let played = 0;
  right.media.querySelectorAll = () => [{ dataset: { mediaItemKey: right.item.key }, paused: true, play() { played++; return Promise.resolve(); } }];
  const space = event(null, { key: " " });
  actions.handleViewerGlobalKeydown(space);
  assert.equal(played, 1);
  assert.equal(space.stopped, true);
  const generate = event("right", { key: "Enter", ctrlKey: true });
  actions.handleViewerGlobalKeydown(generate);
  assert.equal(generate.prevented, undefined);
  assert.equal(generate.stopped, undefined);
});

test("leaving comparison adopts the right batch selection, view and playback without autoplaying other media", async (t) => {
  const one = image("one", "p"), two = image("two", "p");
  const { left, right, actions, rendered } = navigation(t, [two, one], { batchMode: true });
  right.item = two;
  right.imageZoom = 2;
  right.imagePanX = 35;
  right.media.querySelectorAll = () => [{ dataset: { mediaItemKey: "two" }, currentTime: 12, paused: false }];
  let plays = 0;
  const mounted = { dataset: { mediaItemKey: "two" }, readyState: 1, play() { plays++; return Promise.resolve(); } };
  left.media.querySelectorAll = () => [mounted];
  left.comparing = false;
  actions.adoptViewerPane(right);
  await Promise.resolve();
  assert.equal(left.item, two);
  assert.equal(left.entry, right.entry);
  assert.equal(left.imageZoom, 2);
  assert.equal(left.imagePanX, 35);
  assert.equal(mounted.currentTime, 12);
  assert.equal(plays, 1);
  assert.deepEqual(rendered[0].options, { autoplay: false });
});

test("late playback restoration cannot affect a subsequently navigated item", async (t) => {
  const { left, right, actions } = navigation(t, [image("a"), image("b")]);
  right.media.querySelectorAll = () => [{ dataset: { mediaItemKey: "a" }, currentTime: 12, paused: false }];
  const mounted = { dataset: { mediaItemKey: "a" }, readyState: 1, play() { assert.fail("stale playback"); } };
  left.media.querySelectorAll = () => [mounted];
  left.comparing = false;
  actions.adoptViewerPane(right);
  actions.showViewerRelative(1, left);
  await Promise.resolve();
  assert.equal(left.item.key, "b");
  assert.equal(mounted.currentTime, undefined);
});
