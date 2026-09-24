import assert from "node:assert/strict";
import test from "node:test";

import { installViewerRender } from "../web/js/media_feed/viewer_render.js";
import { installViewerSupport } from "../web/js/media_feed/viewer_support.js";
import { installViewerZoom } from "../web/js/media_feed/viewer_zoom.js";

test("standalone viewer videos disable native fullscreen for double-click zoom", async () => {
  const originalDocument = globalThis.document;
  const attributes = new Map();
  const video = {
    dataset: {},
    classList: { add() {} },
    addEventListener() {},
    setAttribute(name, value) { attributes.set(name, value); },
    play: () => Promise.resolve(),
  };
  globalThis.document = { createElement: (tagName) => tagName === "video" ? video : {} };

  try {
    const item = { id: "video-id", key: "video-key", kind: "video", filename: "clip.mp4", url: "/view/clip.mp4" };
    const viewer = {
      root: { dataset: { open: "true" } },
      media: { querySelector: () => null },
      title: { dataset: {}, textContent: "", title: "" },
      openLink: {}, copyImageButton: {}, favoriteButton: {},
      renderRequestId: 0, item: null, entry: null, pendingMedia: null,
    };
    const actions = {
      ensureViewer: () => viewer,
      clearViewerAudioWaveform() {}, discardStagedMedia() {}, resetViewerImageView() {},
      syncFavoriteButton() {}, syncViewerNav() {}, prepareViewerImage() {},
      rememberMediaDimensions() {}, updateViewerImageLayout() {}, refreshViewerPromptPanelDetails() {},
      updateViewerImageControls() {},
      waitForMediaReady: async () => {},
      isCurrentViewerRender: (currentViewer, requestId, currentItem) => currentViewer === viewer
        && viewer.renderRequestId === requestId && viewer.item === currentItem,
      replaceViewerMedia() {},
    };
    installViewerRender({
      app: {}, api: {}, ICONS: {}, state: { scaleViewerMedia: true, loopVideos: false },
      runtime: { viewer }, actions,
    });

    await actions.renderViewerItem(item);

    assert.equal(attributes.get("controlslist"), "nofullscreen");
  } finally {
    globalThis.document = originalDocument;
  }
});

test("viewer media replacement starts audio nested below its waveform", () => {
  let paused = 0;
  let played = 0;
  const previousMedia = { pause() { paused++; } };
  const audio = {
    muted: true,
    play() {
      played++;
      return Promise.resolve();
    },
  };
  const presentation = {
    matches: () => false,
    querySelector: (selector) => selector === "video, audio" ? audio : null,
  };
  const viewer = {
    media: {
      querySelector: () => previousMedia,
      replaceChildren(nextMedia) { assert.equal(nextMedia, presentation); },
    },
  };
  const context = { app: {}, api: {}, ICONS: {}, state: {}, runtime: {}, actions: { viewerMediaNaturalSize() {} } };
  installViewerSupport(context);

  context.actions.replaceViewerMedia(viewer, presentation);
  assert.equal(paused, 1);
  assert.equal(played, 1);
  assert.equal(audio.muted, false);
});

test("viewer reuses its native audio player when moving between audio items", async () => {
  const originalDocument = globalThis.document;
  const originalHTMLAudioElement = globalThis.HTMLAudioElement;
  let createdElements = 0;
  let replacements = 0;
  let clearedWaveforms = 0;
  let setupWaveforms = 0;

  class MockAudioElement {
    constructor() {
      this.dataset = { mediaItemKey: "audio-old" };
      this.pauseCalls = 0;
      this.playCalls = 0;
      this.src = "/view?filename=old.wav";
    }

    pause() { this.pauseCalls++; }
    play() {
      this.playCalls++;
      return Promise.resolve();
    }
  }

  const audio = new MockAudioElement();
  globalThis.HTMLAudioElement = MockAudioElement;
  globalThis.document = {
    createElement() {
      createdElements++;
      return new MockAudioElement();
    },
  };

  try {
    const viewer = {
      root: { dataset: { open: "true" } },
      media: {
        querySelector(selector) {
          return selector === "audio.cmf-zoomable-audio" ? audio : null;
        },
      },
      pendingMedia: null,
      item: { key: "audio-old" },
      renderRequestId: 0,
      title: { textContent: "" },
      openLink: { href: "" },
      copyImageButton: { hidden: false },
      favoriteButton: {},
      mediaReadyItemId: "",
    };
    const runtime = { viewer };
    const actions = {
      ensureViewer: () => viewer,
      discardStagedMedia() {},
      resetViewerImageView() {},
      syncFavoriteButton() {},
      syncViewerNav() {},
      waitForMediaReady: async () => {},
      isCurrentViewerRender: (currentViewer, requestId, item) => (
        currentViewer === viewer
        && viewer.renderRequestId === requestId
        && viewer.item?.key === item.key
      ),
      replaceViewerMedia() { replacements++; },
      updateViewerImageLayout() {},
      updateViewerImageControls() {},
      clearViewerAudioWaveform() { clearedWaveforms++; },
      createViewerAudioPresentation: (element) => element,
      setupViewerAudioWaveform(currentViewer, element, url) {
        assert.equal(currentViewer, viewer);
        assert.equal(element, audio);
        assert.equal(url, "/view?filename=new.wav");
        setupWaveforms++;
      },
    };
    const context = { app: {}, api: {}, ICONS: {}, state: { loopAudio: true }, runtime, actions };
    installViewerRender(context);

    const nextItem = {
      id: "audio-new-id",
      key: "audio-new",
      kind: "audio",
      filename: "new.wav",
      url: "/view?filename=new.wav",
    };
    await actions.renderViewerItem(nextItem);

    assert.equal(createdElements, 0);
    assert.equal(replacements, 0);
    assert.equal(audio.pauseCalls, 0);
    assert.equal(audio.playCalls, 1);
    assert.equal(audio.dataset.mediaItemKey, nextItem.key);
    assert.equal(audio.src, nextItem.url);
    assert.equal(audio.loop, true);
    assert.equal(viewer.mediaReadyItemId, nextItem.id);
    assert.equal(clearedWaveforms, 1);
    assert.equal(setupWaveforms, 1);
  } finally {
    globalThis.document = originalDocument;
    if (originalHTMLAudioElement === undefined) {
      delete globalThis.HTMLAudioElement;
    } else {
      globalThis.HTMLAudioElement = originalHTMLAudioElement;
    }
  }
});

test("pinned headers reserve zoom controls while images and batches are decoding", async () => {
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  class Element {
    constructor() {
      this.dataset = {};
      this.style = { setProperty() {} };
      this.classList = { contains: () => false };
    }
    addEventListener() {}
    setAttribute() {}
    append() {}
    replaceChildren() {}
    querySelector() { return null; }
  }
  globalThis.HTMLElement = Element;
  globalThis.document = { createElement: () => new Element() };

  try {
    const image = { id: "one", key: "one", kind: "image", filename: "one.png", url: "/one.png" };
    const batch = { kind: "batch", key: "batch", items: [image, { ...image, id: "two", key: "two", filename: "two.png" }] };
    for (const entry of [image, batch]) {
      let finishDecode;
      const decoding = new Promise((resolve) => { finishDecode = resolve; });
      const viewer = {
        root: { dataset: { open: "true" } }, media: new Element(), title: new Element(),
        openLink: {}, copyImageButton: {}, favoriteButton: {},
        zoomControls: { hidden: true }, nativeButton: new Element(), fitButton: new Element(),
        zoomOutButton: {}, zoomInButton: {}, zoomLevel: { textContent: "—" },
        isComparisonPane: true, imageBaseMode: "fit", imageZoom: 1,
        renderRequestId: 0, item: null, entry: null,
      };
      const context = { state: {}, runtime: { viewer, decodedImageCache: new Map() }, actions: {} };
      installViewerZoom(context);
      Object.assign(context.actions, {
        ensureViewer: () => viewer,
        clearViewerAudioWaveform() {}, discardStagedMedia() {}, syncFavoriteButton() {},
        syncViewerNav() {}, prepareViewerImage() {},
        decodeImageElement: () => decoding,
        isCurrentViewerRender: (_, requestId) => viewer.renderRequestId === requestId,
      });
      installViewerRender(context);
      const rendering = context.actions.renderViewerItem(entry);
      try {
        assert.equal(viewer.zoomControls.hidden, false, "controls must occupy space before decoding finishes");
        assert.equal(viewer.nativeButton.hidden, entry.kind === "batch");
        assert.equal(viewer.fitButton.disabled, true, "controls stay disabled until media is mounted");
        assert.equal(viewer.zoomInButton.disabled, true);
      } finally {
        // Closing during decoding cancels the pending mount.
        viewer.renderRequestId++;
        finishDecode();
        await rendering;
      }
    }
  } finally {
    globalThis.document = originalDocument;
    if (originalHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = originalHTMLElement;
  }
});
