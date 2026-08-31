export const AUDIO_WAVEFORM_BAR_COUNT = 64;

const AUDIO_WAVEFORM_MAX_SAMPLES = 200_000;
const AUDIO_WAVEFORM_BAR_STEP = 3;
const AUDIO_WAVEFORM_MIN_HALF_HEIGHT = 2;
const AUDIO_WAVEFORM_MAX_HALF_HEIGHT = 46;

export function calculateAudioWaveformPeaks(
  audioBuffer,
  barCount = AUDIO_WAVEFORM_BAR_COUNT,
  maxSamples = AUDIO_WAVEFORM_MAX_SAMPLES,
) {
  const length = Math.max(0, Number(audioBuffer?.length) || 0);
  const channelCount = Math.max(0, Number(audioBuffer?.numberOfChannels) || 0);
  const count = Math.max(1, Math.floor(Number(barCount) || AUDIO_WAVEFORM_BAR_COUNT));
  const peaks = new Float32Array(count);
  if (!length || !channelCount || typeof audioBuffer.getChannelData !== "function") return peaks;

  const channels = [];
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
    channels.push(audioBuffer.getChannelData(channelIndex));
  }

  const sampleStride = Math.max(1, Math.ceil(length / Math.max(1, maxSamples)));
  let highestLevel = 0;
  for (let barIndex = 0; barIndex < count; barIndex++) {
    const start = Math.floor(barIndex * length / count);
    const end = Math.max(start + 1, Math.floor((barIndex + 1) * length / count));
    let energy = 0;
    let sampleCount = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += sampleStride) {
      let sampleEnergy = 0;
      for (const channel of channels) {
        const sample = Number(channel[sampleIndex]) || 0;
        sampleEnergy += sample * sample;
      }
      energy += sampleEnergy / channelCount;
      sampleCount++;
    }
    const level = sampleCount ? Math.sqrt(energy / sampleCount) : 0;
    peaks[barIndex] = level;
    highestLevel = Math.max(highestLevel, level);
  }

  if (!highestLevel) return peaks;
  for (let index = 0; index < peaks.length; index++) peaks[index] /= highestLevel;
  return peaks;
}

export function audioWaveformPath(peaks) {
  const segments = [];
  for (let index = 0; index < peaks.length; index++) {
    const normalizedPeak = Math.min(1, Math.max(0, Number(peaks[index]) || 0));
    const halfHeight = AUDIO_WAVEFORM_MIN_HALF_HEIGHT
      + normalizedPeak * (AUDIO_WAVEFORM_MAX_HALF_HEIGHT - AUDIO_WAVEFORM_MIN_HALF_HEIGHT);
    const x = index * AUDIO_WAVEFORM_BAR_STEP + 1;
    const startY = 50 - halfHeight;
    const endY = 50 + halfHeight;
    segments.push(`M${x} ${startY.toFixed(2)}V${endY.toFixed(2)}`);
  }
  return segments.join("");
}

export function renderAudioWaveform(svg, peaks) {
  const barCount = Math.max(1, peaks.length);
  svg.setAttribute("viewBox", `0 0 ${barCount * AUDIO_WAVEFORM_BAR_STEP - 1} 100`);
  svg.querySelector("path")?.setAttribute("d", audioWaveformPath(peaks));
  svg.dataset.state = "ready";
}
