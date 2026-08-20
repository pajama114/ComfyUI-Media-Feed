export function installCards(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const formatMediaDuration = (...args) => actions.formatMediaDuration(...args);
  const rememberDecodedImage = (...args) => actions.rememberDecodedImage(...args);
  const rememberMediaDimensions = (...args) => actions.rememberMediaDimensions(...args);
  const openViewer = (...args) => actions.openViewer(...args);
  const fitThumbnailMedia = (...args) => actions.fitThumbnailMedia(...args);
  const syncFavoriteButton = (...args) => actions.syncFavoriteButton(...args);
  const toggleFavorite = (...args) => actions.toggleFavorite(...args);
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
      preview.appendChild(image);
      if (image.complete) window.requestAnimationFrame(() => fitThumbnailMedia(image, preview));
    } else if (item.kind === "video") {
      const video = document.createElement("video");
      const videoBadge = document.createElement("span");
      const duration = document.createElement("span");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.loop = true;
      videoBadge.className = "cmf-video-badge";
      videoBadge.title = "Video";
      videoBadge.setAttribute("aria-hidden", "true");
      videoBadge.innerHTML = ICONS.play;
      duration.className = "cmf-video-duration";
      duration.hidden = true;
      const thumbnailResizeObserver = new ResizeObserver(() => fitThumbnailMedia(video, preview));
      thumbnailResizeObserver.observe(preview);
      card.thumbnailResizeObserver = thumbnailResizeObserver;
      video.addEventListener("loadedmetadata", () => {
        rememberMediaDimensions(item, video);
        fitThumbnailMedia(video, preview);
        const text = formatMediaDuration(video.duration);
        if (!text) return;
        duration.textContent = text;
        duration.hidden = false;
      }, { once: true });
      video.src = item.url;
      preview.append(video, videoBadge, duration);
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        window.requestAnimationFrame(() => fitThumbnailMedia(video, preview));
      }
    } else {
      const audioPreview = document.createElement("div");
      audioPreview.className = "cmf-audio-preview";
      const audioMain = document.createElement("div");
      audioMain.className = "cmf-audio-main";
      const badge = document.createElement("div");
      badge.className = "cmf-kind";
      badge.textContent = "Audio";
      audioMain.appendChild(badge);
      const controls = document.createElement("div");
      controls.className = "cmf-audio-controls";
      controls.innerHTML = `
        <button class="cmf-button cmf-icon-button cmf-audio-play" type="button" title="Play" aria-label="Play">${ICONS.play}</button>
        <input class="cmf-audio-seek" type="range" min="0" max="1000" value="0" aria-label="Seek">
      `;
      const audio = document.createElement("audio");
      audio.preload = "none";
      audio.src = item.url;
      audioPreview.append(audioMain, controls, audio);
      setupAudioPreview(audioPreview, audio);
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
    const previewVideo = card.querySelector("video");
    if (previewVideo && item.kind === "video") {
      const playPreview = () => {
        previewVideo.play().catch(() => {});
      };
      const pausePreview = () => {
        previewVideo.pause();
        try {
          previewVideo.currentTime = 0;
        } catch {
          // Some browsers reject seeking before metadata is ready.
        }
      };
      card.addEventListener("mouseenter", playPreview);
      card.addEventListener("mouseleave", pausePreview);
      card.addEventListener("focus", playPreview);
      card.addEventListener("blur", pausePreview);
    }
    card.addEventListener("click", (event) => {
      if (event.target.closest(".cmf-audio-controls, .cmf-card-favorite")) return;
      openViewer(item, card.querySelector("img"));
    });
    card.addEventListener("keydown", (event) => {
      if (event.target.closest(".cmf-audio-controls, .cmf-card-favorite")) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openViewer(item, card.querySelector("img"));
    });
  
    return card;
  }
  
  function setupAudioPreview(audioPreview, audio) {
    const playButton = audioPreview.querySelector(".cmf-audio-play");
    const seek = audioPreview.querySelector(".cmf-audio-seek");
  
    const updatePlayButton = () => {
      playButton.innerHTML = audio.paused ? ICONS.play : ICONS.pause;
      playButton.title = audio.paused ? "Play" : "Pause";
      playButton.setAttribute("aria-label", playButton.title);
    };
  
    const updateSeek = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      seek.value = duration ? String(Math.round(audio.currentTime / duration * 1000)) : "0";
    };
  
    playButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (audio.paused) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    });
  
    seek.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    seek.addEventListener("input", (event) => {
      event.stopPropagation();
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      if (!duration) return;
      audio.currentTime = Number(seek.value) / 1000 * duration;
    });
  
    audio.addEventListener("play", updatePlayButton);
    audio.addEventListener("pause", updatePlayButton);
    audio.addEventListener("loadedmetadata", updateSeek);
    audio.addEventListener("timeupdate", updateSeek);
    updatePlayButton();
  }
  
  Object.assign(actions, {
    createCard,
    setupAudioPreview,
  });
}

