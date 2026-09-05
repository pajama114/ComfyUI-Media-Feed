import {
  AUDIO_WAVEFORM_BAR_COUNT,
  renderAudioWaveform,
} from "./audio_waveform.js";

export function installCards(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const formatMediaDuration = (...args) => actions.formatMediaDuration(...args);
  const rememberDecodedImage = (...args) => actions.rememberDecodedImage(...args);
  const rememberMediaDimensions = (...args) => actions.rememberMediaDimensions(...args);
  const openViewer = (...args) => actions.openViewer(...args);
  const fitThumbnailMedia = (...args) => actions.fitThumbnailMedia(...args);
  const syncFavoriteButton = (...args) => actions.syncFavoriteButton(...args);
  const toggleFavorite = (...args) => actions.toggleFavorite(...args);
  const removeMissingMediaItem = (...args) => actions.removeMissingMediaItem(...args);
  const subscribeAudioWaveform = (...args) => actions.subscribeAudioWaveform(...args);
  const createAudioWaveform = (...args) => actions.createAudioWaveform(...args);

  function updateThumbnailRemainingTime(media, label) {
    const duration = Number(media.duration);
    const currentTime = Number.isFinite(media.currentTime) ? Math.max(0, media.currentTime) : 0;
    const remainingTime = Number.isFinite(duration) && duration >= 0
      ? Math.max(0, duration - currentTime)
      : Number.NaN;
    const text = formatMediaDuration(remainingTime);
    label.textContent = text;
    label.hidden = !text;
  }

  function setupAudioWaveform(card, svg, url) {
    let unsubscribe = null;
    let active = false;
    let activation = 0;

    card.activateAudioWaveform = () => {
      if (active || svg.dataset.state === "ready") return;
      active = true;
      const currentActivation = ++activation;
      svg.dataset.state = "loading";
      const consumer = {
        render(peaks) {
          if (active && activation === currentActivation) renderAudioWaveform(svg, peaks);
        },
        fail() {
          if (active && activation === currentActivation) svg.dataset.state = "unavailable";
        },
      };
      unsubscribe = subscribeAudioWaveform(url, AUDIO_WAVEFORM_BAR_COUNT, consumer);
    };
    card.deactivateAudioWaveform = () => {
      active = false;
      activation++;
      unsubscribe?.();
      unsubscribe = null;
    };
  }

  function createCard(item) {
    const card = document.createElement("div");
    card.className = "cmf-card";
    card.role = "button";
    card.tabIndex = 0;
    card.title = item.filename;
    card.setAttribute("aria-label", item.kind === "video" ? `${item.filename} (video)` : item.filename);
    card.dataset.itemId = item.id;
  
    const preview = document.createElement("div");
    preview.className = "cmf-preview";
  
    if (item.kind === "image") {
      const image = document.createElement("img");
      image.alt = item.filename;
      image.decoding = "async";
      // Cards are already virtualized, so every created thumbnail is in or near the viewport.
      image.loading = "eager";
      image.src = item.url;
      const thumbnailResizeObserver = new ResizeObserver(() => fitThumbnailMedia(image, preview));
      thumbnailResizeObserver.observe(preview);
      card.thumbnailResizeObserver = thumbnailResizeObserver;
      image.addEventListener("load", () => {
        rememberDecodedImage(item.url, image);
        rememberMediaDimensions(item, image);
        fitThumbnailMedia(image, preview);
      }, { once: true });
      image.addEventListener("error", () => removeMissingMediaItem(item), { once: true });
      preview.appendChild(image);
      if (image.complete) window.requestAnimationFrame(() => fitThumbnailMedia(image, preview));
    } else if (item.kind === "video") {
      const video = document.createElement("video");
      const controls = document.createElement("div");
      const playButton = document.createElement("button");
      const duration = document.createElement("span");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.loop = state.loopVideos;
      controls.className = "cmf-media-controls cmf-video-controls";
      playButton.className = "cmf-button cmf-icon-button cmf-media-play cmf-video-play";
      playButton.type = "button";
      playButton.setAttribute("aria-label", "Play video preview");
      playButton.innerHTML = ICONS.play;
      duration.className = "cmf-media-duration cmf-video-duration";
      duration.hidden = true;
      const thumbnailResizeObserver = new ResizeObserver(() => fitThumbnailMedia(video, preview));
      thumbnailResizeObserver.observe(preview);
      card.thumbnailResizeObserver = thumbnailResizeObserver;
      video.addEventListener("loadedmetadata", () => {
        rememberMediaDimensions(item, video);
        fitThumbnailMedia(video, preview);
      }, { once: true });
      video.addEventListener("error", () => removeMissingMediaItem(item), { once: true });
      video.src = item.url;
      controls.append(playButton, duration);
      preview.append(video, controls);
      setupVideoPreview(card, video, playButton, duration);
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        window.requestAnimationFrame(() => fitThumbnailMedia(video, preview));
      }
    } else {
      const audioPreview = document.createElement("div");
      audioPreview.className = "cmf-audio-preview";
      const audioMain = document.createElement("div");
      audioMain.className = "cmf-audio-main";
      const waveform = createAudioWaveform("cmf-audio-waveform", AUDIO_WAVEFORM_BAR_COUNT);
      audioMain.appendChild(waveform);
      const controls = document.createElement("div");
      controls.className = "cmf-media-controls cmf-audio-controls";
      controls.innerHTML = `
        <button class="cmf-button cmf-icon-button cmf-media-play cmf-audio-play" type="button" aria-label="Play audio preview">${ICONS.play}</button>
        <span class="cmf-media-duration cmf-audio-duration" hidden></span>
      `;
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.loop = state.loopAudio;
      audio.src = item.url;
      audio.addEventListener("error", () => removeMissingMediaItem(item), { once: true });
      audioPreview.append(audioMain, controls, audio);
      setupAudioPreview(audioPreview, audio, card);
      setupAudioWaveform(card, waveform, item.url);
      preview.appendChild(audioPreview);
    }
  
    const favoriteButton = document.createElement("button");
    favoriteButton.className = "cmf-button cmf-icon-button cmf-card-favorite";
    favoriteButton.type = "button";
    favoriteButton.innerHTML = ICONS.star;
    favoriteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(item);
    });
    card.favoriteButton = favoriteButton;
    card.thumbnailPreview = preview;
    syncFavoriteButton(favoriteButton, item);
    card.append(preview, favoriteButton);
    card.addEventListener("click", (event) => {
      if (event.target.closest(".cmf-media-controls, .cmf-card-favorite")) return;
      openViewer(item, card.querySelector("img"));
    });
    card.addEventListener("keydown", (event) => {
      if (event.target.closest(".cmf-media-controls, .cmf-card-favorite")) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openViewer(item, card.querySelector("img"));
    });
  
    return card;
  }

  function setupVideoPreview(card, video, playButton, durationLabel) {
    let audiblePlayback = false;

    const updatePlayButton = () => {
      const playingAudibly = audiblePlayback && !video.paused && !video.ended;
      playButton.innerHTML = playingAudibly ? ICONS.pause : ICONS.play;
      const action = playingAudibly ? "Pause" : "Play";
      playButton.setAttribute("aria-label", `${action} video preview`);
    };

    const playMutedPreview = () => {
      if (audiblePlayback) return;
      audiblePlayback = false;
      video.muted = true;
      video.play().catch(() => {});
    };

    const playHoverPreview = () => {
      const canHover = typeof window === "undefined"
        || typeof window.matchMedia !== "function"
        || window.matchMedia("(hover: hover)").matches;
      if (canHover) playMutedPreview();
    };

    const resetPreview = () => {
      audiblePlayback = false;
      video.muted = true;
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        // Some browsers reject seeking before metadata is ready.
      }
      updatePlayButton();
      updateThumbnailRemainingTime(video, durationLabel);
    };

    playButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (audiblePlayback && !video.paused && !video.ended) {
        audiblePlayback = false;
        video.pause();
        return;
      }

      audiblePlayback = true;
      video.muted = false;
      try {
        video.currentTime = 0;
      } catch {
        // Some browsers reject seeking before metadata is ready.
      }
      updateThumbnailRemainingTime(video, durationLabel);
      if (video.paused || video.ended) video.play().catch(() => {});
      updatePlayButton();
    });

    video.addEventListener("play", updatePlayButton);
    video.addEventListener("pause", updatePlayButton);
    video.addEventListener("ended", () => {
      audiblePlayback = false;
      video.muted = true;
      updatePlayButton();
      updateThumbnailRemainingTime(video, durationLabel);
    });
    video.addEventListener("loadedmetadata", () => updateThumbnailRemainingTime(video, durationLabel));
    video.addEventListener("durationchange", () => updateThumbnailRemainingTime(video, durationLabel));
    video.addEventListener("timeupdate", () => updateThumbnailRemainingTime(video, durationLabel));
    card.addEventListener("mouseenter", playHoverPreview);
    card.addEventListener("mouseleave", resetPreview);
    card.addEventListener("focus", playMutedPreview);
    card.addEventListener("blur", resetPreview);
    updatePlayButton();
    updateThumbnailRemainingTime(video, durationLabel);
  }
  
  function setupAudioPreview(audioPreview, audio, card = audioPreview) {
    const playButton = audioPreview.querySelector(".cmf-audio-play");
    const durationLabel = audioPreview.querySelector(".cmf-audio-duration");
  
    const updatePlayButton = () => {
      const paused = audio.paused || audio.ended;
      playButton.innerHTML = paused ? ICONS.play : ICONS.pause;
      const action = paused ? "Play" : "Pause";
      playButton.setAttribute("aria-label", `${action} audio preview`);
    };
  
    const updateDuration = () => {
      updateThumbnailRemainingTime(audio, durationLabel);
    };

    const resetPreview = () => {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // Some browsers reject seeking before metadata is ready.
      }
      updatePlayButton();
      updateDuration();
    };
  
    playButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (audio.paused || audio.ended) {
        try {
          audio.currentTime = 0;
        } catch {
          // Some browsers reject seeking before metadata is ready.
        }
        updateDuration();
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    });
  
    audio.addEventListener("play", updatePlayButton);
    audio.addEventListener("pause", updatePlayButton);
    audio.addEventListener("ended", updatePlayButton);
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("durationchange", updateDuration);
    audio.addEventListener("timeupdate", updateDuration);
    card.addEventListener("mouseleave", resetPreview);
    updatePlayButton();
    updateDuration();
  }
  
  Object.assign(actions, {
    createCard,
    setupAudioPreview,
    setupAudioWaveform,
    setupVideoPreview,
  });
}
