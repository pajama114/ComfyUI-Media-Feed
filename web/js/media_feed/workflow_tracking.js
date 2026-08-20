export function installWorkflowTracking(context) {
  const { app, api, ICONS, state, runtime, actions } = context;

  const collectMedia = (...args) => actions.collectMedia(...args);
  const addItems = (...args) => actions.addItems(...args);
  const workflowTabId = (...args) => actions.workflowTabId(...args);
  const currentWorkflowTabId = (...args) => actions.currentWorkflowTabId(...args);
  const itemMatchesFilters = (...args) => actions.itemMatchesFilters(...args);
  const filteredItems = (...args) => actions.filteredItems(...args);
  const isViewerOpen = (...args) => actions.isViewerOpen(...args);
  const closeViewer = (...args) => actions.closeViewer(...args);
  const syncViewerItems = (...args) => actions.syncViewerItems(...args);
  const updateViews = (...args) => actions.updateViews(...args);
  const saveWorkflowScrollPositions = (...args) => actions.saveWorkflowScrollPositions(...args);
  const updateViewsForWorkflowTab = (...args) => actions.updateViewsForWorkflowTab(...args);
  function isPreviewNode(nodeId) {
    const graph = app.graph;
    const node = graph?.getNodeById?.(nodeId) || graph?._nodes_by_id?.[nodeId];
    return /^preview/i.test(String(node?.type || ""));
  }
  
  function rememberPromptWorkflowTab(promptId, tabId) {
    const normalizedPromptId = String(promptId || "");
    if (!normalizedPromptId || !tabId) return;
  
    runtime.promptWorkflowTabs.delete(normalizedPromptId);
    runtime.promptWorkflowTabs.set(normalizedPromptId, tabId);
    while (runtime.promptWorkflowTabs.size > 1024) {
      runtime.promptWorkflowTabs.delete(runtime.promptWorkflowTabs.keys().next().value);
    }
  
    let updatedItems = false;
    let newlyVisibleCount = 0;
    for (const item of state.items) {
      if (item.promptId !== normalizedPromptId || item.workflowTabId === tabId) continue;
      const wasVisible = itemMatchesFilters(item);
      item.workflowTabId = tabId;
      if (!wasVisible && itemMatchesFilters(item)) newlyVisibleCount++;
      updatedItems = true;
    }
    if (updatedItems) {
      // A very fast execution can emit output before the /prompt response arrives.
      // Reveal those items once the response supplies the prompt ID mapping.
      updateViews(
        newlyVisibleCount > 0 && state.followLatest && !isViewerOpen(),
        state.followLatest ? 0 : newlyVisibleCount,
      );
      syncViewerItems();
    }
  }
  
  function handlePromptQueueing(event) {
    const detail = event?.detail || {};
    runtime.pendingQueueRequests.push({
      requestId: detail.requestId,
      workflowTabId: currentWorkflowTabId(),
    });
    while (runtime.pendingQueueRequests.length > 1024) runtime.pendingQueueRequests.shift();
  }
  
  function handlePromptQueued(event) {
    const requestId = event?.detail?.requestId;
    if (runtime.activeQueueRequest && (requestId === undefined || runtime.activeQueueRequest.requestId === requestId)) {
      runtime.activeQueueRequest = null;
    }
  }
  
  function beginPromptSubmission() {
    if (!runtime.activeQueueRequest && runtime.pendingQueueRequests.length) {
      runtime.activeQueueRequest = runtime.pendingQueueRequests.pop();
    }
  
    if (runtime.activeQueueRequest) {
      return {
        workflowTabId: runtime.activeQueueRequest.workflowTabId,
        trackedRequest: runtime.activeQueueRequest,
      };
    }
    return { workflowTabId: currentWorkflowTabId(), trackedRequest: null };
  }
  
  function wrapQueuePrompt() {
    if (typeof api.queuePrompt !== "function" || api.queuePrompt.__mediaFeedWrapped) return;
  
    const originalQueuePrompt = api.queuePrompt;
    async function mediaFeedQueuePrompt(...args) {
      const submission = beginPromptSubmission();
      try {
        const response = await Reflect.apply(originalQueuePrompt, this, args);
        rememberPromptWorkflowTab(response?.prompt_id, submission.workflowTabId);
        return response;
      } catch (error) {
        if (submission.trackedRequest === runtime.activeQueueRequest) runtime.activeQueueRequest = null;
        throw error;
      }
    }
    mediaFeedQueuePrompt.__mediaFeedWrapped = true;
    api.queuePrompt = mediaFeedQueuePrompt;
  }
  
  function handleActiveWorkflowChange() {
    const nextTabId = currentWorkflowTabId();
    if (nextTabId === runtime.activeWorkflowTabId) return;
  
    if (state.mediaScope === "current-tab") saveWorkflowScrollPositions(runtime.activeWorkflowTabId);
    runtime.activeWorkflowTabId = nextTabId;
    if (state.mediaScope !== "current-tab") return;
  
    updateViewsForWorkflowTab(runtime.activeWorkflowTabId);
    if (isViewerOpen() && runtime.viewer?.item && !filteredItems().some((item) => item.key === runtime.viewer.item.key)) {
      closeViewer();
    } else {
      syncViewerItems();
    }
  }
  
  function watchActiveWorkflow() {
    runtime.activeWorkflowTabId = currentWorkflowTabId();
    const workflowStore = app.extensionManager?.workflow;
    workflowStore?.$subscribe?.(handleActiveWorkflowChange, { detached: true, flush: "sync" });
  }
  
  function handleExecuted(event) {
    const detail = event?.detail || {};
    if (state.excludePreviewMedia && isPreviewNode(detail.node)) return;
    const promptId = String(detail.prompt_id || "");
    const tabId = runtime.promptWorkflowTabs.get(promptId) || "";
    const mediaItems = collectMedia(detail.output, promptId, detail.node, tabId);
    addItems(mediaItems);
  }
  
  Object.assign(actions, {
    isPreviewNode,
    rememberPromptWorkflowTab,
    handlePromptQueueing,
    handlePromptQueued,
    beginPromptSubmission,
    wrapQueuePrompt,
    handleActiveWorkflowChange,
    watchActiveWorkflow,
    handleExecuted,
  });
}

