import {
  AUDIO_WAVEFORM_BAR_COUNT,
  renderAudioWaveform,
} from "./audio_waveform.js";
import { attachThumbnailPreview, previewDescription } from "./media_previews.js";
import { takeThumbnailImage } from "./thumbnail_images.js";

export function installCards(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const formatMediaDuration = (...args) => actions.formatMediaDuration(...args);
  const rememberMediaDimensions = (...args) => actions.rememberMediaDimensions(...args);
  const openViewer = (...args) => actions.openViewer(...args);
  const fitThumbnailMedia = (...args) => actions.fitThumbnailMedia(...args);
  const syncFavoriteButton = (...args) => actions.syncFavoriteButton(...args);
  const toggleFavorite = (...args) => actions.toggleFavorite(...args);
  const removeMissingMediaItem = (...args) => actions.removeMissingMediaItem(...args);
  const subscribeAudioWaveform = (...args) => actions.subscribeAudioWaveform(...args);
  const createAudioWaveform = (...args) => actions.createAudioWaveform(...args);

  function updateThumbnailRemainingTime(media, label) {
    const nativeDuration = Number(media.duration);
    const duration = Number.isFinite(nativeDuration) ? nativeDuration : Number(media.dataset?.previewDuration);
    const currentTime = Number.isFinite(media.currentTime) ? Math.max(0, media.currentTime) : 0;
    const remainingTime = Number.isFinite(duration) && duration >= 0
      ? Math.max(0, duration - currentTime)
      : Number.NaN;
    const text = formatMediaDuration(remainingTime);
    label.textContent = text;
    label.hidden = !text;
  }

  function setupAudioWaveform(card, svg, url, update = null, onMissing = null) {
    let unsubscribe = null;
    let active = false;
    let activation = 0;

    card.activateAudioWaveform = () => {
      if (active || svg.dataset.state === "ready") return;
      active = true;
      const currentActivation = ++activation;
      svg.dataset.state = "loading";
      const consumer = {
        update: (info) => { if (active && activation === currentActivation) update?.(info); },
        render(peaks) {
          if (active && activation === currentActivation) renderAudioWaveform(svg, peaks);
        },
        fail(error) {
          if (!active || activation !== currentActivation) return;
          svg.dataset.state = "unavailable";
          // The audio element has no source until playback, so it cannot report this.
          if (error?.status === 404) onMissing?.();
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

  function createAudioPreview(item, owner) {
    const audioPreview = document.createElement("div");
    audioPreview.className = "cmf-audio-preview";
    const audioMain = document.createElement("div");
    audioMain.className = "cmf-audio-main";
    const waveform = createAudioWaveform("cmf-audio-waveform", AUDIO_WAVEFORM_BAR_COUNT);
    const info = document.createElement("span");
    info.className = "cmf-preview-info";
    info.textContent = item.filename;
    audioMain.append(waveform, info);
    const controls = document.createElement("div");
    const playButton = document.createElement("button");
    const duration = document.createElement("span");
    controls.className = "cmf-media-controls cmf-audio-controls";
    playButton.className = "cmf-button cmf-icon-button cmf-media-play cmf-audio-play";
    playButton.type = "button";
    playButton.setAttribute("aria-label", "Play audio preview");
    playButton.innerHTML = ICONS.play;
    duration.className = "cmf-media-duration cmf-audio-duration";
    duration.hidden = true;
    controls.append(playButton, duration);
    const audio = document.createElement("audio");
    audio.preload = "none";
    audio.loop = state.loopAudio;
    audio.dataset.src = item.url;
    audio.dataset.mediaItemKey = item.key;
    audio.addEventListener("error", () => removeMissingMediaItem(item), { once: true });
    audioPreview.append(audioMain, controls, audio);
    setupAudioPreview(audioPreview, audio, owner);
    setupAudioWaveform(owner, waveform, item.url, (result) => {
      info.textContent = previewDescription(result, item, formatMediaDuration);
      info.hidden = result.status === "ready";
      if (Number.isFinite(result.duration)) {
        audio.dataset.previewDuration = String(result.duration);
        updateThumbnailRemainingTime(audio, duration);
      }
    }, () => removeMissingMediaItem(item));
    return audioPreview;
  }

  function createVideoControls() {
    const controls = document.createElement("div");
    const playButton = document.createElement("button");
    const duration = document.createElement("span");
    controls.className = "cmf-media-controls cmf-video-controls";
    playButton.className = "cmf-button cmf-icon-button cmf-media-play cmf-video-play";
    playButton.type = "button";
    playButton.setAttribute("aria-label", "Play video preview");
    playButton.innerHTML = ICONS.play;
    duration.className = "cmf-media-duration cmf-video-duration";
    duration.hidden = true;
    controls.append(playButton, duration);
    return { controls, playButton, duration };
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
    const info = document.createElement("span");
    info.className = "cmf-preview-info";
  
    if (item.kind === "image") {
      const image = takeThumbnailImage(context, item) || document.createElement("img");
      image.alt = item.filename;
      image.decoding = "async";
      // Cards are already virtualized, so every created thumbnail is in or near the viewport.
      image.loading = "eager";
      const thumbnailResizeObserver = new ResizeObserver(() => fitThumbnailMedia(image, preview));
      thumbnailResizeObserver.observe(preview);
      card.thumbnailResizeObserver = thumbnailResizeObserver;
      const onLoad = () => {
        fitThumbnailMedia(image, preview);
      };
      image.addEventListener("load", onLoad, { once: true });
      card.disposeThumbnailLayout = () => image.removeEventListener?.("load", onLoad);
      preview.append(image, info);
      attachThumbnailPreview(context, card, image, item, info);
      if (image.complete) window.requestAnimationFrame(() => fitThumbnailMedia(image, preview));
    } else if (item.kind === "video") {
      const video = document.createElement("video");
      const { controls, playButton, duration } = createVideoControls();
      video.muted = true;
      video.playsInline = true;
      video.preload = "none";
      video.loop = state.loopVideos;
      const thumbnailResizeObserver = new ResizeObserver(() => fitThumbnailMedia(video, preview));
      thumbnailResizeObserver.observe(preview);
      card.thumbnailResizeObserver = thumbnailResizeObserver;
      video.addEventListener("loadedmetadata", () => {
        rememberMediaDimensions(item, video);
        fitThumbnailMedia(video, preview);
      }, { once: true });
      video.addEventListener("error", () => removeMissingMediaItem(item), { once: true });
      video.dataset.src = item.url;
      preview.append(video, info, controls);
      setupVideoPreview(card, video, playButton, duration);
      attachThumbnailPreview(context, card, video, item, info, duration);
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        window.requestAnimationFrame(() => fitThumbnailMedia(video, preview));
      }
    } else {
      preview.appendChild(createAudioPreview(item, card));
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

  function createBatchThumbnailCell(item) {
    const cell = document.createElement("div");
    cell.className = "cmf-batch-thumbnail-cell";
    cell.dataset.mediaItemKey = item.key;
    cell.dataset.mediaItemId = item.id;
    cell.dataset.mediaUrl = item.url;
    if (item.kind === "image") {
      const image = takeThumbnailImage(context, item) || document.createElement("img");
      // Single cards fit with inline dimensions; grid cells use their CSS box.
      for (const property of ["width", "height", "max-width", "max-height"]) image.style?.removeProperty(property);
      image.alt = "";
      image.decoding = "async";
      image.loading = "eager";
      const info = document.createElement("span");
      info.className = "cmf-preview-info";
      cell.append(image, info);
      attachThumbnailPreview(context, cell, image, item, info);
    } else if (item.kind === "video") {
      const video = document.createElement("video");
      const { controls, playButton, duration } = createVideoControls();
      video.muted = true;
      video.playsInline = true;
      video.preload = "none";
      video.loop = state.loopVideos;
      video.dataset.src = item.url;
      video.addEventListener("error", () => removeMissingMediaItem(item), { once: true });
      const info = document.createElement("span");
      info.className = "cmf-preview-info";
      cell.append(video, info, controls);
      setupVideoPreview(cell, video, playButton, duration);
      attachThumbnailPreview(context, cell, video, item, info, duration);
    } else {
      cell.append(createAudioPreview(item, cell));
    }
    return cell;
  }

  function setBatchThumbnailMore(cells, count) {
    for (const cell of cells) cell.querySelector(".cmf-batch-more")?.remove();
    if (count <= 4 || cells.length < 4) return;
    const more = document.createElement("span");
    more.className = "cmf-batch-more";
    more.textContent = `+${count - 4}`;
    cells[3].append(more);
  }

  async function updateBatchCard(card, batch) {
    const requestId = ++card.batchRenderRequestId;
    card.batch = batch;
    card.setAttribute("aria-label", `Open batch of ${batch.items.length} media`);
    card.title = `${batch.items.length} media in batch`;
    const grid = card.querySelector(".cmf-batch-thumbnail-grid");
    const existingCells = new Map([...grid.children].map((cell) => [cell.dataset.mediaItemKey, cell]));
    const cells = batch.items.slice(0, 4).map((item) => {
      const existing = existingCells.get(item.key);
      if (existing?.dataset.mediaUrl === item.url && existing.dataset.mediaItemId === item.id) return existing;
      const cell = createBatchThumbnailCell(item);
      return cell;
    });
    if (card.batchRenderRequestId !== requestId) return;
    for (const cell of grid.children) {
      if (cells.includes(cell)) continue;
      cell.deactivateAudioWaveform?.();
      cell.disposeMediaPreview?.();
      const media = cell.querySelector("video, audio");
      if (media) {
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
    }
    setBatchThumbnailMore(cells, batch.items.length);
    grid.dataset.count = String(cells.length);
    grid.replaceChildren(...cells);
    if (card.audioWaveformsActive) {
      for (const cell of cells) {
        cell.activateAudioWaveform?.();
        cell.activateMediaPreview?.();
      }
    }
  }

  function createBatchCard(batch) {
    const card = document.createElement("div");
    card.className = "cmf-card cmf-batch-card";
    card.role = "button";
    card.tabIndex = 0;
    card.batch = batch;
    card.batchRenderRequestId = 0;
    card.audioWaveformsActive = false;
    card.setAttribute("aria-label", `Open batch of ${batch.items.length} media`);
    card.title = `${batch.items.length} media in batch`;

    const grid = document.createElement("div");
    grid.className = "cmf-batch-thumbnail-grid";
    grid.dataset.count = String(Math.min(4, batch.items.length));
    const cells = batch.items.slice(0, 4).map(createBatchThumbnailCell);
    setBatchThumbnailMore(cells, batch.items.length);
    grid.append(...cells);
    card.append(grid);
    card.activateAudioWaveform = () => {
      card.audioWaveformsActive = true;
      for (const cell of grid.children) {
        cell.activateAudioWaveform?.();
        cell.activateMediaPreview?.();
      }
    };
    card.deactivateAudioWaveform = () => {
      card.audioWaveformsActive = false;
      for (const cell of grid.children) {
        cell.deactivateAudioWaveform?.();
        cell.deactivateMediaPreview?.();
      }
    };
    card.disposeMediaPreview = () => {
      for (const cell of grid.children) cell.disposeMediaPreview?.();
    };
    card.addEventListener("click", (event) => {
      if (event?.target?.closest?.(".cmf-media-controls")) return;
      openViewer(card.batch);
    });
    card.addEventListener("keydown", (event) => {
      if (event.target?.closest?.(".cmf-media-controls")) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openViewer(card.batch);
    });
    return card;
  }

  function setupVideoPreview(card, video, playButton, durationLabel) {
    let audiblePlayback = false;
    const ensureSource = () => {
      if (video.dataset?.src && !video.getAttribute?.("src")) video.src = video.dataset.src;
    };

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
      ensureSource();
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
      ensureSource();
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
  
  function setupAudioPreview(audioPreview, audio, resetTarget = audioPreview) {
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
        if (audio.dataset?.src && !audio.getAttribute?.("src")) audio.src = audio.dataset.src;
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
    resetTarget?.addEventListener("mouseleave", resetPreview);
    updatePlayButton();
    updateDuration();
  }
  
  Object.assign(actions, {
    createCard,
    createBatchCard,
    updateBatchCard,
    setupAudioPreview,
    setupAudioWaveform,
    setupVideoPreview,
  });
}
