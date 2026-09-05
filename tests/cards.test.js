import assert from "node:assert/strict";
import test from "node:test";

import { installCards } from "../web/js/media_feed/cards.js";

function eventTarget(properties = {}) {
  const listeners = new Map();
  return {
    ...properties,
    listeners,
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    dispatch(name, event = {}) {
      listeners.get(name)?.(event);
    },
  };
}

function createCardActions() {
  const context = {
    app: {},
    api: {},
    ICONS: { play: "play", pause: "pause" },
    state: {},
    runtime: {},
    actions: {
      formatMediaDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return "";
        const wholeSeconds = Math.floor(seconds);
        const minutes = Math.floor(wholeSeconds / 60);
        return `${minutes}:${String(wholeSeconds % 60).padStart(2, "0")}`;
      },
    },
  };
  installCards(context);
  return context.actions;
}

test("video thumbnail button promotes the muted hover preview to audible playback", () => {
  const actions = createCardActions();
  const card = eventTarget();
  const playButton = eventTarget({
    innerHTML: "",
    ariaLabel: "",
    setAttribute(name, value) {
      if (name === "aria-label") this.ariaLabel = value;
    },
  });
  const durationLabel = { textContent: "", hidden: true };
  const video = eventTarget({
    paused: true,
    ended: false,
    muted: true,
    currentTime: 0,
    duration: 20,
    playCalls: 0,
    pauseCalls: 0,
    play() {
      this.playCalls++;
      this.paused = false;
      this.dispatch("play");
      return Promise.resolve();
    },
    pause() {
      this.pauseCalls++;
      this.paused = true;
      this.dispatch("pause");
    },
  });

  actions.setupVideoPreview(card, video, playButton, durationLabel);
  assert.equal(playButton.innerHTML, "play");
  assert.equal(playButton.ariaLabel, "Play video preview");
  assert.equal(playButton.title, undefined);

  card.dispatch("mouseenter");
  assert.equal(video.playCalls, 1);
  assert.equal(video.muted, true);
  assert.equal(playButton.innerHTML, "play");
  video.currentTime = 8;
  video.dispatch("timeupdate");
  assert.equal(durationLabel.textContent, "0:12");

  let prevented = 0;
  let stopped = 0;
  playButton.dispatch("click", {
    preventDefault() { prevented++; },
    stopPropagation() { stopped++; },
  });
  assert.equal(video.playCalls, 1);
  assert.equal(video.pauseCalls, 0);
  assert.equal(video.muted, false);
  assert.equal(video.currentTime, 0);
  assert.equal(durationLabel.textContent, "0:20");
  assert.equal(playButton.innerHTML, "pause");
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);

  playButton.dispatch("click", { preventDefault() {}, stopPropagation() {} });
  assert.equal(video.pauseCalls, 1);
  assert.equal(playButton.innerHTML, "play");

  card.dispatch("mouseleave");
  assert.equal(video.pauseCalls, 2);
  assert.equal(video.muted, true);
  assert.equal(video.currentTime, 0);
});

test("audio thumbnail exposes play/pause and total duration without seeking", () => {
  const actions = createCardActions();
  const card = eventTarget();
  const playButton = eventTarget({
    innerHTML: "",
    ariaLabel: "",
    setAttribute(name, value) {
      if (name === "aria-label") this.ariaLabel = value;
    },
  });
  const durationLabel = { textContent: "", hidden: true };
  const audioPreview = {
    querySelector(selector) {
      if (selector === ".cmf-audio-play") return playButton;
      if (selector === ".cmf-audio-duration") return durationLabel;
      return null;
    },
  };
  const audio = eventTarget({
    paused: true,
    ended: false,
    duration: Number.NaN,
    currentTime: 0,
    playCalls: 0,
    pauseCalls: 0,
    play() {
      this.playCalls++;
      this.paused = false;
      this.dispatch("play");
      return Promise.resolve();
    },
    pause() {
      this.pauseCalls++;
      this.paused = true;
      this.dispatch("pause");
    },
  });

  actions.setupAudioPreview(audioPreview, audio, card);
  assert.equal(playButton.innerHTML, "play");
  assert.equal(durationLabel.hidden, true);

  audio.duration = 65.9;
  audio.dispatch("loadedmetadata");
  assert.equal(durationLabel.textContent, "1:05");
  assert.equal(durationLabel.hidden, false);

  audio.currentTime = 5.9;
  audio.dispatch("timeupdate");
  assert.equal(durationLabel.textContent, "1:00");

  playButton.dispatch("click", { preventDefault() {}, stopPropagation() {} });
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.currentTime, 0);
  assert.equal(durationLabel.textContent, "1:05");
  assert.equal(playButton.innerHTML, "pause");
  assert.equal(playButton.title, undefined);

  audio.currentTime = 10;
  audio.dispatch("timeupdate");
  card.dispatch("mouseleave");
  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.currentTime, 0);
  assert.equal(durationLabel.textContent, "1:05");
  assert.equal(playButton.innerHTML, "play");
});
