import assert from "node:assert/strict";
import test from "node:test";

import { installViewerRender } from "../web/js/media_feed/viewer_render.js";

test("viewer reuses its native audio player when moving between audio items", async () => {
  const originalDocument = globalThis.document;
  const originalHTMLAudioElement = globalThis.HTMLAudioElement;
  let createdElements = 0;
  let replacements = 0;

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
  } finally {
    globalThis.document = originalDocument;
    if (originalHTMLAudioElement === undefined) {
      delete globalThis.HTMLAudioElement;
    } else {
      globalThis.HTMLAudioElement = originalHTMLAudioElement;
    }
  }
});
