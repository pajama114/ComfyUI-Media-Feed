export const AUDIO_WAVEFORM_BAR_COUNT = 64;
export const VIEWER_AUDIO_WAVEFORM_BAR_COUNT = 384;

const AUDIO_WAVEFORM_SOURCE_BAR_COUNT = 512;
const AUDIO_WAVEFORM_MAX_SAMPLES = 200_000;
const AUDIO_WAVEFORM_BAR_STEP = 3;
const AUDIO_WAVEFORM_MIN_HALF_HEIGHT = 2;
const AUDIO_WAVEFORM_MAX_HALF_HEIGHT = 46;
const AUDIO_WAVEFORM_CACHE_SIZE = 32;
const MAX_CONCURRENT_AUDIO_WAVEFORM_LOADS = 1;

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

export function resampleAudioWaveformPeaks(peaks, barCount) {
  const sourceCount = Math.max(0, Number(peaks?.length) || 0);
  const count = Math.max(1, Math.floor(Number(barCount) || AUDIO_WAVEFORM_BAR_COUNT));
  const result = new Float32Array(count);
  if (!sourceCount) return result;
  if (sourceCount === count) return new Float32Array(peaks);

  let highestLevel = 0;
  for (let barIndex = 0; barIndex < count; barIndex++) {
    const start = Math.floor(barIndex * sourceCount / count);
    const end = Math.max(start + 1, Math.floor((barIndex + 1) * sourceCount / count));
    let energy = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex++) {
      const level = Math.max(0, Number(peaks[sourceIndex]) || 0);
      energy += level * level;
    }
    result[barIndex] = Math.sqrt(energy / (end - start));
    highestLevel = Math.max(highestLevel, result[barIndex]);
  }

  if (!highestLevel) return result;
  for (let index = 0; index < result.length; index++) result[index] /= highestLevel;
  return result;
}

export function renderAudioWaveform(svg, peaks) {
  const barCount = Math.max(1, peaks.length);
  svg.setAttribute("viewBox", `0 0 ${barCount * AUDIO_WAVEFORM_BAR_STEP - 1} 100`);
  svg.querySelector("path")?.setAttribute("d", audioWaveformPath(peaks));
  svg.dataset.state = "ready";
}

export function audioPlaybackProgress(currentTime, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(1, Math.max(0, (Number(currentTime) || 0) / duration));
}

export function installAudioWaveforms(context) {
  const { ICONS, runtime, actions } = context;

  function formatAudioTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const remainingSeconds = String(totalSeconds % 60).padStart(2, "0");
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${remainingSeconds}`
      : `${minutes}:${remainingSeconds}`;
  }

  function rememberAudioWaveform(url, peaks) {
    runtime.audioWaveformCache.delete(url);
    runtime.audioWaveformCache.set(url, peaks);
    while (runtime.audioWaveformCache.size > AUDIO_WAVEFORM_CACHE_SIZE) {
      runtime.audioWaveformCache.delete(runtime.audioWaveformCache.keys().next().value);
    }
  }

  function getAudioWaveformContext() {
    if (runtime.audioWaveformContext) return runtime.audioWaveformContext;
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) throw new Error("Web Audio is unavailable");
    runtime.audioWaveformContext = new AudioContext();
    return runtime.audioWaveformContext;
  }

  async function decodeAudioWaveform(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load audio waveform (${response.status})`);
    const encodedAudio = await response.arrayBuffer();
    const audioBuffer = await getAudioWaveformContext().decodeAudioData(encodedAudio);
    return calculateAudioWaveformPeaks(audioBuffer, AUDIO_WAVEFORM_SOURCE_BAR_COUNT);
  }

  function runNextAudioWaveformJob() {
    while (
      runtime.activeAudioWaveformLoads < MAX_CONCURRENT_AUDIO_WAVEFORM_LOADS
      && runtime.audioWaveformQueue.length
    ) {
      const job = runtime.audioWaveformQueue.shift();
      if (!job.consumers.size) {
        runtime.audioWaveformJobs.delete(job.url);
        job.reject(new Error("Audio waveform is no longer visible"));
        continue;
      }

      runtime.activeAudioWaveformLoads++;
      decodeAudioWaveform(job.url)
        .then((peaks) => {
          rememberAudioWaveform(job.url, peaks);
          job.resolve(peaks);
        })
        .catch(job.reject)
        .finally(() => {
          runtime.activeAudioWaveformLoads--;
          runtime.audioWaveformJobs.delete(job.url);
          runNextAudioWaveformJob();
        });
    }
  }

  function subscribeAudioWaveform(url, barCount, consumer) {
    const cachedPeaks = runtime.audioWaveformCache.get(url);
    if (cachedPeaks) {
      runtime.audioWaveformCache.delete(url);
      runtime.audioWaveformCache.set(url, cachedPeaks);
      consumer.render(resampleAudioWaveformPeaks(cachedPeaks, barCount));
      return () => {};
    }

    let job = runtime.audioWaveformJobs.get(url);
    if (!job) {
      job = { url, consumers: new Set() };
      job.promise = new Promise((resolve, reject) => {
        job.resolve = resolve;
        job.reject = reject;
      });
      runtime.audioWaveformJobs.set(url, job);
      runtime.audioWaveformQueue.push(job);
    }

    const subscription = { active: true };
    const render = (peaks) => {
      if (subscription.active) consumer.render(resampleAudioWaveformPeaks(peaks, barCount));
    };
    const fail = (error) => {
      if (subscription.active) consumer.fail(error);
    };
    job.consumers.add(subscription);
    job.promise.then(render).catch(fail);
    runNextAudioWaveformJob();
    return () => {
      subscription.active = false;
      job.consumers.delete(subscription);
    };
  }

  function createAudioWaveform(className, barCount) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.classList.add(className);
    svg.dataset.state = "loading";
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("preserveAspectRatio", "none");
    path.setAttribute("d", audioWaveformPath(new Float32Array(barCount)));
    svg.appendChild(path);
    return svg;
  }

  function clearViewerAudioWaveform(currentViewer = runtime.viewer) {
    currentViewer?.audioWaveformCleanup?.();
    if (!currentViewer) return;
    currentViewer.audioWaveformCleanup = null;
    const waveform = currentViewer.media?.querySelector?.(".cmf-viewer-audio-waveform");
    const playhead = currentViewer.media?.querySelector?.(".cmf-viewer-audio-playhead");
    if (waveform) {
      renderAudioWaveform(waveform, new Float32Array(VIEWER_AUDIO_WAVEFORM_BAR_COUNT));
      waveform.dataset.state = "loading";
    }
    if (playhead) playhead.style.left = "0%";
  }

  function createViewerAudioPresentation(audio) {
    const presentation = document.createElement("div");
    const graph = document.createElement("div");
    const track = document.createElement("div");
    const waveform = createAudioWaveform("cmf-viewer-audio-waveform", VIEWER_AUDIO_WAVEFORM_BAR_COUNT);
    const playhead = document.createElement("div");
    const controls = document.createElement("div");
    presentation.className = "cmf-viewer-audio";
    graph.className = "cmf-viewer-audio-graph";
    track.className = "cmf-viewer-audio-track";
    playhead.className = "cmf-viewer-audio-playhead";
    playhead.setAttribute("aria-hidden", "true");
    controls.className = "cmf-viewer-audio-controls";
    controls.innerHTML = `
      <button class="cmf-button cmf-icon-button cmf-viewer-audio-play" type="button" title="Play" aria-label="Play">${ICONS.play}</button>
      <output class="cmf-viewer-audio-current">0:00</output>
      <input class="cmf-viewer-audio-seek" type="range" min="0" max="1000" value="0" aria-label="Seek">
      <output class="cmf-viewer-audio-duration">0:00</output>
      <label class="cmf-viewer-audio-volume" title="Volume">
        <span>Vol</span>
        <input type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume">
      </label>
    `;
    track.append(waveform, playhead);
    graph.appendChild(track);
    audio.controls = false;
    presentation.append(graph, controls, audio);
    return presentation;
  }

  function setupViewerAudioWaveform(currentViewer, audio, url) {
    clearViewerAudioWaveform(currentViewer);
    const presentation = audio.closest?.(".cmf-viewer-audio") || audio.parentElement;
    const graph = presentation?.querySelector?.(".cmf-viewer-audio-graph");
    const track = presentation?.querySelector?.(".cmf-viewer-audio-track");
    const waveform = presentation?.querySelector?.(".cmf-viewer-audio-waveform");
    const playhead = presentation?.querySelector?.(".cmf-viewer-audio-playhead");
    const playButton = presentation?.querySelector?.(".cmf-viewer-audio-play");
    const seek = presentation?.querySelector?.(".cmf-viewer-audio-seek");
    const currentTime = presentation?.querySelector?.(".cmf-viewer-audio-current");
    const duration = presentation?.querySelector?.(".cmf-viewer-audio-duration");
    const volume = presentation?.querySelector?.(".cmf-viewer-audio-volume input");
    if (!graph || !track || !waveform || !playhead || !playButton || !seek || !currentTime || !duration || !volume) return;

    renderAudioWaveform(waveform, new Float32Array(VIEWER_AUDIO_WAVEFORM_BAR_COUNT));
    waveform.dataset.state = "loading";
    const consumer = {
      render: (peaks) => renderAudioWaveform(waveform, peaks),
      fail: () => { waveform.dataset.state = "unavailable"; },
    };
    const unsubscribe = subscribeAudioWaveform(url, VIEWER_AUDIO_WAVEFORM_BAR_COUNT, consumer);
    let animationFrame = 0;

    const updatePlayhead = () => {
      const progress = audioPlaybackProgress(audio.currentTime, audio.duration);
      playhead.style.left = `${progress * 100}%`;
    };
    const updateControls = () => {
      const progress = audioPlaybackProgress(audio.currentTime, audio.duration);
      seek.value = String(Math.round(progress * 1000));
      seek.disabled = !Number.isFinite(audio.duration) || audio.duration <= 0;
      currentTime.textContent = formatAudioTime(audio.currentTime);
      duration.textContent = formatAudioTime(audio.duration);
    };
    const updatePlayButton = () => {
      const paused = audio.paused || audio.ended;
      playButton.innerHTML = paused ? ICONS.play : ICONS.pause;
      playButton.title = paused ? "Play" : "Pause";
      playButton.setAttribute("aria-label", playButton.title);
    };
    const updateVolume = () => {
      volume.value = String(audio.muted ? 0 : audio.volume);
    };
    const stopAnimation = () => {
      if (!animationFrame) return;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };
    const animate = () => {
      animationFrame = 0;
      updatePlayhead();
      if (!audio.paused && !audio.ended) animationFrame = window.requestAnimationFrame(animate);
    };
    const startAnimation = () => {
      stopAnimation();
      updatePlayhead();
      if (!audio.paused && !audio.ended) animationFrame = window.requestAnimationFrame(animate);
    };

    const togglePlayback = (event) => {
      event.preventDefault();
      if (audio.paused || audio.ended) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    };
    const seekToProgress = (progress) => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      audio.currentTime = Math.min(1, Math.max(0, progress)) * audio.duration;
      updatePlayhead();
      updateControls();
    };
    const seekFromGraph = (event) => {
      const bounds = track.getBoundingClientRect();
      if (!bounds.width) return;
      seekToProgress((event.clientX - bounds.left) / bounds.width);
    };
    const seekFromControl = () => {
      seekToProgress(Number(seek.value) / 1000);
    };
    const changeVolume = () => {
      audio.muted = false;
      audio.volume = Math.min(1, Math.max(0, Number(volume.value) || 0));
    };
    const handlePlay = () => {
      updatePlayButton();
      startAnimation();
    };
    const syncPlayback = () => {
      updatePlayhead();
      updateControls();
      updatePlayButton();
    };

    const syncEvents = ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked", "pause", "ended"];
    track.addEventListener("click", seekFromGraph);
    playButton.addEventListener("click", togglePlayback);
    seek.addEventListener("input", seekFromControl);
    volume.addEventListener("input", changeVolume);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("volumechange", updateVolume);
    for (const eventName of syncEvents) audio.addEventListener(eventName, syncPlayback);
    syncPlayback();
    updateVolume();
    startAnimation();

    currentViewer.audioWaveformCleanup = () => {
      stopAnimation();
      unsubscribe();
      track.removeEventListener("click", seekFromGraph);
      playButton.removeEventListener("click", togglePlayback);
      seek.removeEventListener("input", seekFromControl);
      volume.removeEventListener("input", changeVolume);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("volumechange", updateVolume);
      for (const eventName of syncEvents) audio.removeEventListener(eventName, syncPlayback);
    };
  }

  Object.assign(actions, {
    subscribeAudioWaveform,
    createAudioWaveform,
    clearViewerAudioWaveform,
    createViewerAudioPresentation,
    setupViewerAudioWaveform,
  });
}
