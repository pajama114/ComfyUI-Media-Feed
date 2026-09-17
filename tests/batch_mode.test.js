import assert from "node:assert/strict";
import test from "node:test";

import { displayEntries, entrySignature } from "../web/js/media_feed/batch_entries.js";
import { pinnedComparisonEntry } from "../web/js/media_feed/viewer_compare.js";
import { installViewerRender } from "../web/js/media_feed/viewer_render.js";

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

test("batch viewer renders every output and retains the selected media when a batch grows", async () => {
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

    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    click() { for (const listener of this.listeners.get("click") || []) listener({ target: this }); }
    querySelectorAll(selector) {
      const matches = (element) => selector === ".cmf-viewer-batch-cell"
        ? element.className.split(" ").includes("cmf-viewer-batch-cell")
        : selector === "video, audio" && ["VIDEO", "AUDIO"].includes(element.tagName);
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
  }

  globalThis.document = { createElement: (tagName) => new Element(tagName) };
  delete globalThis.IntersectionObserver;

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
    let metadataUpdates = 0;
    const actions = {
      ensureViewer: () => viewer,
      clearViewerAudioWaveform() {},
      discardStagedMedia() {},
      resetViewerImageView() {},
      syncFavoriteButton() {},
      syncViewerNav() {},
      updateViewerImageLayout() {},
      refreshViewerPromptPanelDetails() {},
      updateViewerPromptPanel() { metadataUpdates++; },
    };
    installViewerRender({
      app: {}, api: {}, ICONS: { music: "<svg></svg>" },
      state: { loopVideos: false, loopAudio: false },
      runtime: { viewer }, actions,
    });

    const items = [media("four", "p", "audio"), media("three", "p", "video"), media("two", "p"), media("one", "p")];
    await actions.renderViewerItem(displayEntries(items, true)[0]);
    let grid = viewer.media.children[0].children[0];
    assert.equal(grid.children.length, 4);
    assert.equal(grid.styles.get("--cmf-batch-columns"), "2");
    assert.equal(viewer.item.id, "one");

    grid.children[2].click();
    assert.equal(viewer.item.id, "three");
    assert.equal(viewer.openLink.href, "/view?filename=three");
    assert.equal(viewer.copyImageButton.hidden, true);
    assert.equal(metadataUpdates, 1);

    await actions.renderViewerItem(displayEntries([media("five", "p"), ...items], true)[0]);
    grid = viewer.media.children[0].children[0];
    assert.equal(grid.children.length, 5);
    assert.equal(grid.styles.get("--cmf-batch-columns"), "3");
    assert.equal(viewer.item.id, "three");
    assert.equal(grid.children[2].dataset.selected, "true");
  } finally {
    globalThis.document = originalDocument;
    if (originalObserver === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = originalObserver;
  }
});
