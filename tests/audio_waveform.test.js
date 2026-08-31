import assert from "node:assert/strict";
import test from "node:test";

import {
  audioWaveformPath,
  calculateAudioWaveformPeaks,
} from "../web/js/media_feed/audio_waveform.js";

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
