import assert from "node:assert/strict";
import test from "node:test";

import { createMediaFeedRuntime } from "../web/js/media_feed/runtime.js";
import { installViewerSupport } from "../web/js/media_feed/viewer_support.js";

function createContext(item) {
  const context = {
    app: {},
    api: {},
    ICONS: {},
    state: {},
    runtime: createMediaFeedRuntime(),
    actions: { viewerMediaNaturalSize: () => ({ width: 0, height: 0 }) },
  };
  context.runtime.viewer = { item };
  installViewerSupport(context);
  return context;
}

test("viewer download opens a save picker and streams the original media", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const chunks = [];
  let pickerOptions;
  let fetchedUrl;

  globalThis.window = {
    async showSaveFilePicker(options) {
      pickerOptions = options;
      return {
        async createWritable() {
          return new WritableStream({
            write(chunk) { chunks.push(chunk); },
          });
        },
      };
    },
  };
  globalThis.fetch = async (url) => {
    fetchedUrl = url;
    return new Response("media-bytes");
  };

  try {
    const { actions } = createContext({
      filename: "nested/preview?.png",
      url: "/view?filename=preview.png&type=output",
    });
    const button = { disabled: false, blur() {} };

    await actions.downloadViewerMedia({ currentTarget: button });

    assert.deepEqual(pickerOptions, { suggestedName: "preview_.png" });
    assert.equal(fetchedUrl, "/view?filename=preview.png&type=output");
    assert.equal(new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))), "media-bytes");
    assert.equal(button.disabled, false);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("viewer download falls back to the browser download mechanism", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const link = {
    href: "",
    download: "",
    clicked: false,
    removed: false,
    click() { this.clicked = true; },
    remove() { this.removed = true; },
  };
  let appended;

  globalThis.window = {};
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, "a");
      return link;
    },
    body: {
      appendChild(element) { appended = element; },
    },
  };

  try {
    const { actions } = createContext({ filename: "result.mp4", url: "/view?filename=result.mp4" });
    await actions.downloadViewerMedia({ currentTarget: { blur() {} } });

    assert.equal(appended, link);
    assert.equal(link.href, "/view?filename=result.mp4");
    assert.equal(link.download, "result.mp4");
    assert.equal(link.clicked, true);
    assert.equal(link.removed, true);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("cancelling the save picker does not start a fallback download", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let createdLink = false;

  globalThis.window = {
    async showSaveFilePicker() {
      throw new DOMException("Cancelled", "AbortError");
    },
  };
  globalThis.document = {
    createElement() {
      createdLink = true;
      return {};
    },
  };

  try {
    const { actions } = createContext({ filename: "result.png", url: "/view?filename=result.png" });
    await actions.downloadViewerMedia({ currentTarget: { blur() {} } });
    assert.equal(createdLink, false);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("viewer image copy writes the original PNG to the clipboard", async () => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const originalClipboardItem = globalThis.ClipboardItem;
  const originalFetch = globalThis.fetch;
  const sourceBlob = new Blob(["png-bytes"], { type: "image/png" });
  let clipboardItems;
  let fetchedUrl;

  class TestClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  globalThis.window = {
    setTimeout() { return 1; },
    clearTimeout() {},
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        async write(items) { clipboardItems = items; },
      },
    },
  });
  globalThis.ClipboardItem = TestClipboardItem;
  globalThis.fetch = async (url) => {
    fetchedUrl = url;
    return new Response(sourceBlob);
  };

  try {
    const { actions } = createContext({
      kind: "image",
      filename: "result.png",
      url: "/view?filename=result.png&type=output",
    });
    const classes = new Set();
    const button = {
      disabled: false,
      title: "Copy image",
      offsetWidth: 30,
      blur() {},
      getAttribute(name) { return name === "aria-label" ? "Copy image" : null; },
      setAttribute() {},
      removeAttribute() {},
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
      },
    };

    await actions.copyViewerImage({ currentTarget: button });

    assert.equal(fetchedUrl, "/view?filename=result.png&type=output");
    assert.equal(clipboardItems.length, 1);
    const copiedBlob = await clipboardItems[0].items["image/png"];
    assert.equal(copiedBlob.type, "image/png");
    assert.equal(await copiedBlob.text(), "png-bytes");
    assert.equal(classes.has("cmf-copy-success"), true);
    assert.equal(button.disabled, false);
  } finally {
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
    globalThis.ClipboardItem = originalClipboardItem;
    globalThis.fetch = originalFetch;
  }
});

test("viewer image copy ignores non-image media", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    return new Response();
  };

  try {
    const { actions } = createContext({ kind: "video", filename: "result.mp4", url: "/view?filename=result.mp4" });
    await actions.copyViewerImage({ currentTarget: { blur() {} } });
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
