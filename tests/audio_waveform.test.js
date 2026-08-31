import assert from "node:assert/strict";
import test from "node:test";

import {
  audioPlaybackProgress,
  audioWaveformPath,
  calculateAudioWaveformPeaks,
  installAudioWaveforms,
  resampleAudioWaveformPeaks,
} from "../web/js/media_feed/audio_waveform.js";
import { createMediaFeedRuntime } from "../web/js/media_feed/runtime.js";

test("audio waveform levels combine channels and normalize the loudest bar", () => {
  const channels = [
    new Float32Array([0, 0.25, 0.5, 1, 0, 0.1, 0.2, 0.4]),
    new Float32Array([0.5, 0, 0.25, 0, 0.8, 0, 0.1, 0]),
  ];
  const audioBuffer = {
    length: channels[0].length,
    numberOfChannels: channels.length,
    getChannelData: (index) => channels[index],
  };

  const peaks = calculateAudioWaveformPeaks(audioBuffer, 4, 100);
  const expected = [0.48795, 1, 0.70373, 0.4];
  for (let index = 0; index < expected.length; index++) {
    assert.ok(Math.abs(peaks[index] - expected[index]) < 0.0001);
  }
});

test("audio waveform uses average energy so isolated peaks do not form a rectangle", () => {
  const channel = new Float32Array([
    1, 0, 0, 0,
    1, 1, 1, 1,
  ]);
  const peaks = calculateAudioWaveformPeaks({
    length: channel.length,
    numberOfChannels: 1,
    getChannelData: () => channel,
  }, 2, 100);

  assert.deepEqual([...peaks], [0.5, 1]);
});

test("audio waveform peak scanning remains bounded for long audio", () => {
  let reads = 0;
  const channel = new Proxy({ length: 1_000_000 }, {
    get(target, property) {
      if (property === "length") return target.length;
      reads++;
      return Number(property) === 500_000 ? 1 : 0.25;
    },
  });
  const peaks = calculateAudioWaveformPeaks({
    length: channel.length,
    numberOfChannels: 1,
    getChannelData: () => channel,
  }, 64, 1_000);

  assert.equal(peaks.length, 64);
  assert.ok(reads <= 1_100);
});

test("audio waveform path produces one centered vertical segment per bar", () => {
  const path = audioWaveformPath(new Float32Array([0, 0.5, 1]));
  assert.match(path, /^M1 48\.00V52\.00M4 26\.00V74\.00M7 4\.00V96\.00$/);
});

test("audio waveform can derive thumbnail and viewer resolutions from one source", () => {
  const source = new Float32Array([0, 0.5, 1, 0.5, 0.25, 0.25, 0.75, 0.75]);
  const thumbnail = resampleAudioWaveformPeaks(source, 2);
  const viewer = resampleAudioWaveformPeaks(source, 6);

  assert.equal(thumbnail.length, 2);
  assert.equal(viewer.length, 6);
  assert.equal(Math.max(...thumbnail), 1);
  assert.equal(Math.max(...viewer), 1);
});

test("audio playback progress remains within the waveform", () => {
  assert.equal(audioPlaybackProgress(30, 120), 0.25);
  assert.equal(audioPlaybackProgress(-1, 120), 0);
  assert.equal(audioPlaybackProgress(121, 120), 1);
  assert.equal(audioPlaybackProgress(1, Number.NaN), 0);
});

test("viewer audio playhead follows playback and stops updating after cleanup", () => {
  const originalWindow = globalThis.window;
  const animationFrames = new Map();
  let nextAnimationFrame = 1;
  const eventTarget = (properties = {}) => {
    const listeners = new Map();
    return {
      ...properties,
      listeners,
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name, listener) {
        if (listeners.get(name) === listener) listeners.delete(name);
      },
    };
  };
  const path = { setAttribute() {} };
  const waveform = {
    dataset: {},
    setAttribute() {},
    querySelector: () => path,
  };
  const playhead = { style: { left: "" } };
  let capturedPointer = null;
  const graph = eventTarget({
    getBoundingClientRect: () => ({ left: 20, width: 200 }),
    setPointerCapture(pointerId) { capturedPointer = pointerId; },
    hasPointerCapture(pointerId) { return capturedPointer === pointerId; },
    releasePointerCapture(pointerId) {
      if (capturedPointer === pointerId) capturedPointer = null;
    },
  });
  const playButton = eventTarget({
    innerHTML: "",
    title: "",
    setAttribute(name, value) { this[name] = value; },
  });
  const seek = eventTarget({ value: "0", disabled: false });
  const currentTime = { textContent: "" };
  const duration = { textContent: "" };
  const volume = eventTarget({ value: "1" });
  const presentationElements = new Map([
    [".cmf-viewer-audio-graph", graph],
    [".cmf-viewer-audio-track", graph],
    [".cmf-viewer-audio-waveform", waveform],
    [".cmf-viewer-audio-playhead", playhead],
    [".cmf-viewer-audio-play", playButton],
    [".cmf-viewer-audio-seek", seek],
    [".cmf-viewer-audio-current", currentTime],
    [".cmf-viewer-audio-duration", duration],
    [".cmf-viewer-audio-volume input", volume],
  ]);
  const presentation = {
    querySelector: (selector) => presentationElements.get(selector) || null,
  };
  const audio = eventTarget({
    currentTime: 30,
    duration: 120,
    paused: true,
    ended: false,
    muted: false,
    volume: 1,
    closest: () => presentation,
    play() {
      this.paused = false;
      this.listeners.get("play")?.();
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
      this.listeners.get("pause")?.();
    },
  });
  globalThis.window = {
    requestAnimationFrame(callback) {
      const id = nextAnimationFrame++;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { animationFrames.delete(id); },
  };

  try {
    const runtime = createMediaFeedRuntime();
    runtime.audioWaveformCache.set("/track.wav", new Float32Array(512).fill(0.5));
    const context = { ICONS: { play: "play", pause: "pause" }, runtime, actions: {} };
    installAudioWaveforms(context);
    const viewer = {};

    context.actions.setupViewerAudioWaveform(viewer, audio, "/track.wav");
    assert.equal(playhead.style.left, "25%");
    assert.equal(waveform.dataset.state, "ready");
    assert.equal(seek.value, "250");
    assert.equal(currentTime.textContent, "0:30");
    assert.equal(duration.textContent, "2:00");
    assert.equal(animationFrames.size, 0);

    audio.paused = false;
    audio.listeners.get("play")();
    assert.equal(animationFrames.size, 1);
    audio.currentTime = 60;
    const frame = animationFrames.values().next().value;
    animationFrames.clear();
    frame();
    assert.equal(playhead.style.left, "50%");

    let pointerDownPrevented = false;
    graph.listeners.get("pointerdown")({
      button: 0,
      pointerId: 7,
      clientX: 170,
      preventDefault() { pointerDownPrevented = true; },
    });
    assert.equal(audio.currentTime, 90);
    assert.equal(playhead.style.left, "75%");
    assert.equal(pointerDownPrevented, true);
    assert.equal(capturedPointer, 7);

    graph.listeners.get("pointermove")({
      pointerId: 7,
      clientX: 220,
      preventDefault() {},
    });
    assert.equal(audio.currentTime, 120);
    assert.equal(playhead.style.left, "100%");

    graph.listeners.get("pointermove")({
      pointerId: 8,
      clientX: 20,
      preventDefault() {},
    });
    assert.equal(audio.currentTime, 120);

    graph.listeners.get("pointerup")({
      pointerId: 7,
      clientX: 70,
      preventDefault() {},
    });
    assert.equal(audio.currentTime, 30);
    assert.equal(capturedPointer, null);

    seek.value = "100";
    seek.listeners.get("input")();
    assert.equal(audio.currentTime, 12);

    context.actions.clearViewerAudioWaveform(viewer);
    assert.equal(animationFrames.size, 0);
    assert.equal(audio.listeners.size, 0);
    assert.equal(graph.listeners.size, 0);
    assert.equal(playButton.listeners.size, 0);
    assert.equal(seek.listeners.size, 0);
    assert.equal(volume.listeners.size, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});
