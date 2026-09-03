import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
} from "./constants.js";

export function installMediaItems(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const syncViewerItems = (...args) => actions.syncViewerItems(...args);
  const prefetchPromptMetadata = (...args) => actions.prefetchPromptMetadata(...args);
  const updateViews = (...args) => actions.updateViews(...args);
  const discardCachedCard = (...args) => actions.discardCachedCard(...args);
  const saveSessionItems = (...args) => actions.saveSessionItems(...args);
  function trimItemsToHistoryLimit() {
    let removedCount = 0;
    while (state.items.length > state.historyLimit) {
      const removed = state.items.pop();
      if (!removed) continue;
      removedCount++;
      state.itemKeys.delete(removed.key);
      for (const view of state.views) discardCachedCard(view, removed.id);
    }
    return removedCount;
  }

  function getExtension(filename) {
    const cleanName = String(filename || "").split(/[?#]/, 1)[0];
    const dot = cleanName.lastIndexOf(".");
    return dot === -1 ? "" : cleanName.slice(dot + 1).toLowerCase();
  }
  
  function getMediaKind(filename, parentKey = "") {
    const extension = getExtension(filename);
    if (IMAGE_EXTENSIONS.has(extension)) return "image";
    if (VIDEO_EXTENSIONS.has(extension)) return "video";
    if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  
    const key = parentKey.toLowerCase();
    if (key.includes("image")) return "image";
    if (key.includes("video") || key.includes("gif")) return "video";
    if (key.includes("audio") || key.includes("sound")) return "audio";
  
    return null;
  }
  
  function formatMediaDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "";
  
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const remainingSeconds = totalSeconds % 60;
    const paddedSeconds = String(remainingSeconds).padStart(2, "0");
  
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`
      : `${minutes}:${paddedSeconds}`;
  }
  
  function apiUrl(path) {
    if (api?.apiURL) return api.apiURL(path);
    return path;
  }
  
  function buildViewUrl(file) {
    const params = new URLSearchParams();
    params.set("filename", file.filename);
    params.set("subfolder", file.subfolder || "");
    params.set("type", file.type || "output");
    return apiUrl(`/view?${params.toString()}`);
  }
  
  function mediaKey(file, kind) {
    return [
      kind,
      file.type || "output",
      file.subfolder || "",
      file.filename,
    ].join(":");
  }
  
  function collectMedia(output, promptId, nodeId, workflowTabId = "") {
    const results = [];
    const seen = new Set();
  
    function walk(value, parentKey = "") {
      if (!value) return;
  
      if (Array.isArray(value)) {
        for (const child of value) walk(child, parentKey);
        return;
      }
  
      if (typeof value !== "object") return;
  
      if (typeof value.filename === "string") {
        const kind = getMediaKind(value.filename, parentKey);
        if (kind) {
          const file = {
            filename: value.filename,
            subfolder: value.subfolder || "",
            type: value.type || "output",
          };
          const key = mediaKey(file, kind);
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              id: `${Date.now()}-${state.sequence++}`,
              key,
              kind,
              filename: file.filename,
              subfolder: file.subfolder,
              type: file.type,
              url: buildViewUrl(file),
              promptId: String(promptId || ""),
              nodeId: nodeId || "",
              workflowTabId,
              createdAt: Date.now(),
            });
          }
        }
      }
  
      for (const [key, child] of Object.entries(value)) {
        if (key === "filename" || key === "subfolder" || key === "type") continue;
        walk(child, key);
      }
    }
  
    walk(output);
    return results;
  }
  
  function addItems(items) {
    const freshItems = [];
  
    for (const item of items) {
      if (state.itemKeys.has(item.key)) {
        const existingIndex = state.items.findIndex((current) => current.key === item.key);
        if (existingIndex !== -1) {
          const [replaced] = state.items.splice(existingIndex, 1);
          for (const view of state.views) discardCachedCard(view, replaced.id);
        }
      }
      state.itemKeys.add(item.key);
      freshItems.push(item);
    }
  
    if (!freshItems.length) return;
  
    state.items.unshift(...freshItems.reverse());
    trimItemsToHistoryLimit();
    saveSessionItems();
  
    const visibleFreshCount = freshItems.filter(itemMatchesFilters).length;
    updateViews(
      visibleFreshCount > 0 && state.followLatest && !isViewerOpen(),
      state.followLatest ? 0 : visibleFreshCount,
    );
    if (isViewerOpen() && state.showPrompts) {
      const newestImage = freshItems.find((item) => item.kind === "image");
      if (newestImage) prefetchPromptMetadata(newestImage);
    }
    syncViewerItems();
  }
  
  function currentWorkflow() {
    return app.extensionManager?.workflow?.activeWorkflow || null;
  }

  function persistentWorkflowTabId(workflow) {
    if (!workflow || (typeof workflow !== "object" && typeof workflow !== "function")) return "";

    const workflowId = workflow.activeState?.id ?? workflow.initialState?.id ?? workflow.id;
    if ((typeof workflowId === "string" || typeof workflowId === "number") && String(workflowId)) {
      return `workflow-id:${workflowId}`;
    }
    if (typeof workflow.path === "string" && workflow.path) return `workflow-path:${workflow.path}`;
    return "";
  }
  
  function workflowTabId(workflow) {
    if (!workflow || (typeof workflow !== "object" && typeof workflow !== "function")) return "";

    const persistentId = persistentWorkflowTabId(workflow);
    if (persistentId) return persistentId;
  
    let tabId = runtime.workflowTabIds.get(workflow);
    if (!tabId) {
      tabId = `workflow-tab-${++runtime.workflowTabSequence}`;
      runtime.workflowTabIds.set(workflow, tabId);
    }
    return tabId;
  }
  
  function currentWorkflowTabId() {
    return workflowTabId(currentWorkflow());
  }
  
  function itemMatchesMediaScope(item) {
    if (state.mediaScope !== "current-tab") return true;
  
    const tabId = currentWorkflowTabId();
    return !tabId || item.workflowTabId === tabId;
  }
  
  function itemMatchesFilters(item) {
    return itemMatchesMediaScope(item) && (state.filter === "all" || item.kind === state.filter);
  }
  
  function filteredItems() {
    return state.items.filter(itemMatchesFilters);
  }
  
  function isViewerOpen() {
    return runtime.viewer?.root?.dataset.open === "true";
  }

  function removeItemById(id) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index === -1) return false;

    const [removed] = state.items.splice(index, 1);
    state.itemKeys.delete(removed.key);
    runtime.decodedImageCache.delete(removed.url);
    runtime.mediaDimensionCache.delete(removed.key);
    for (const view of state.views) discardCachedCard(view, removed.id);
    saveSessionItems();
    updateViews(false);
    syncViewerItems();
    return true;
  }

  async function removeMissingMediaItem(item) {
    if (!item?.id || runtime.missingMediaChecks.has(item.id) || typeof fetch !== "function") return;

    runtime.missingMediaChecks.add(item.id);
    try {
      const response = await fetch(item.url, { method: "HEAD" });
      if (response.status === 404 || response.status === 410) removeItemById(item.id);
    } catch {
      // A temporary network failure should not remove an otherwise valid feed item.
    } finally {
      runtime.missingMediaChecks.delete(item.id);
    }
  }
  
  Object.assign(actions, {
    getExtension,
    getMediaKind,
    formatMediaDuration,
    apiUrl,
    buildViewUrl,
    mediaKey,
    collectMedia,
    trimItemsToHistoryLimit,
    addItems,
    currentWorkflow,
    persistentWorkflowTabId,
    workflowTabId,
    currentWorkflowTabId,
    itemMatchesMediaScope,
    itemMatchesFilters,
    filteredItems,
    isViewerOpen,
    removeItemById,
    removeMissingMediaItem,
  });
}
