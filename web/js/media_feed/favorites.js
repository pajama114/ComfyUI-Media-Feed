export function installFavorites(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const apiUrl = (...args) => actions.apiUrl(...args);
  const saveFavoriteFiles = (...args) => actions.saveFavoriteFiles(...args);
  function fitThumbnailMedia(media, preview) {
    const width = preview.clientWidth;
    const height = preview.clientHeight;
    const mediaWidth = media.naturalWidth || media.videoWidth;
    const mediaHeight = media.naturalHeight || media.videoHeight;
    if (!width || !height || !mediaWidth || !mediaHeight) return;
  
    const scale = Math.min(width / mediaWidth, height / mediaHeight);
    media.style.width = `${mediaWidth * scale}px`;
    media.style.height = `${mediaHeight * scale}px`;
  }
  
  function canFavorite(item) {
    return item?.type === "output";
  }
  
  function isFavorite(item) {
    return Boolean(item && state.favoriteFiles.has(item.key));
  }
  
  function syncFavoriteButton(button, item) {
    if (!button) return;
  
    const supported = canFavorite(item);
    const favorited = isFavorite(item);
    const pending = Boolean(item && state.favoritingKeys.has(item.key));
    const label = !supported
      ? "Only output media can be favorited"
      : favorited
        ? "Remove from favorites"
        : pending
          ? "Updating favorites"
          : "Add to favorites";
  
    button.disabled = !supported || pending;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(favorited));
  }
  
  function syncFavoriteControls() {
    for (const view of state.views) {
      for (const [id, card] of view.cards) {
        const item = state.items.find((current) => current.id === id);
        syncFavoriteButton(card.favoriteButton, item);
      }
    }
    syncFavoriteButton(runtime.viewer?.favoriteButton, runtime.viewer?.item);
  }
  
  async function toggleFavorite(item) {
    if (!canFavorite(item) || state.favoritingKeys.has(item.key)) return;
  
    state.favoritingKeys.add(item.key);
    syncFavoriteControls();
    try {
      const favoriteFilename = state.favoriteFiles.get(item.key);
      const adding = !favoriteFilename;
      const response = await fetch(apiUrl("/media-feed/favorite"), {
        method: adding ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adding
          ? {
            filename: item.filename,
            subfolder: item.subfolder,
            type: item.type,
          }
          : { filename: favoriteFilename }),
      });
      if (!response.ok) throw new Error("Could not update favorites");
  
      if (adding) {
        const result = await response.json();
        if (typeof result?.filename !== "string" || /[\\\\/]/.test(result.filename)) {
          throw new Error("Invalid favorite response");
        }
        state.favoriteFiles.set(item.key, result.filename);
      } else {
        state.favoriteFiles.delete(item.key);
      }
      saveFavoriteFiles();
    } catch {
      // Keep the action available so the user can retry after resolving a file error.
    } finally {
      state.favoritingKeys.delete(item.key);
      syncFavoriteControls();
    }
  }
  
  Object.assign(actions, {
    fitThumbnailMedia,
    canFavorite,
    isFavorite,
    syncFavoriteButton,
    syncFavoriteControls,
    toggleFavorite,
  });
}

