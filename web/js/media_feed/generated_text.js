import {
  GENERATED_TEXT_MAX_LENGTH,
  GENERATED_TEXT_MAX_NODES_PER_PROMPT,
  GENERATED_TEXT_MAX_TOTAL_LENGTH,
  GENERATED_TEXT_MAX_UNREFERENCED_PROMPTS,
  GENERATED_TEXT_STORAGE_KEY,
  GENERATED_TEXT_VERSION,
} from "./constants.js";

const TRUNCATION_SUFFIX = "\n… (truncated)";

// Text that nodes show in the graph (ComfyUI's `ui.text` convention) exists only
// in the executed event, so it is kept per prompt for the viewer's metadata panel.
export function installGeneratedText(context) {
  const { state, runtime, actions } = context;

  function collectGeneratedText(output) {
    const parts = [];
    function walk(value) {
      if (typeof value === "string") {
        if (value.trim()) parts.push(value);
      } else if (Array.isArray(value)) {
        for (const child of value) walk(child);
      }
    }
    walk(output?.text);

    const text = parts.join("\n\n");
    return text.length > GENERATED_TEXT_MAX_LENGTH
      ? text.slice(0, GENERATED_TEXT_MAX_LENGTH) + TRUNCATION_SUFFIX
      : text;
  }

  function pruneGeneratedTexts() {
    const texts = runtime.generatedTexts;
    const referenced = new Set(state.items.map((item) => item.promptId));
    const promptIds = [...texts.keys()];
    // Text usually arrives before the media of the same prompt, so the newest
    // prompts are kept even while no feed item refers to them yet.
    const recent = new Set(promptIds.slice(-GENERATED_TEXT_MAX_UNREFERENCED_PROMPTS));
    for (const promptId of promptIds) {
      if (!referenced.has(promptId) && !recent.has(promptId)) texts.delete(promptId);
    }

    const promptLength = (nodes) => [...nodes.values()].reduce((total, entry) => total + entry.text.length, 0);
    let totalLength = 0;
    for (const nodes of texts.values()) totalLength += promptLength(nodes);
    for (const [promptId, nodes] of texts) {
      if (totalLength <= GENERATED_TEXT_MAX_TOTAL_LENGTH || texts.size <= 1) break;
      totalLength -= promptLength(nodes);
      texts.delete(promptId);
    }
  }

  function saveSessionGeneratedText() {
    try {
      window.sessionStorage?.setItem(GENERATED_TEXT_STORAGE_KEY, JSON.stringify({
        version: GENERATED_TEXT_VERSION,
        prompts: [...runtime.generatedTexts].map(([promptId, nodes]) => [promptId, [...nodes.values()]]),
      }));
    } catch {
      // Ignore storage failures; the text stays available in memory.
    }
  }

  function recordGeneratedText(promptId, nodeId, output) {
    const normalizedPromptId = String(promptId || "");
    const normalizedNodeId = String(nodeId ?? "");
    if (!normalizedPromptId || normalizedPromptId.length > 256) return false;
    if (!normalizedNodeId || normalizedNodeId.length > 256) return false;

    const text = collectGeneratedText(output);
    if (!text) return false;

    const texts = runtime.generatedTexts;
    const nodes = texts.get(normalizedPromptId) || new Map();
    if (!nodes.has(normalizedNodeId) && nodes.size >= GENERATED_TEXT_MAX_NODES_PER_PROMPT) return false;
    nodes.set(normalizedNodeId, { nodeId: normalizedNodeId, text });
    // Re-inserting keeps the map ordered from the oldest to the newest prompt.
    texts.delete(normalizedPromptId);
    texts.set(normalizedPromptId, nodes);
    pruneGeneratedTexts();
    saveSessionGeneratedText();
    return true;
  }

  function generatedTextsForPrompt(promptId) {
    const nodes = runtime.generatedTexts.get(String(promptId || ""));
    return nodes ? [...nodes.values()] : [];
  }

  function clearGeneratedTexts() {
    runtime.generatedTexts.clear();
    try {
      window.sessionStorage?.removeItem(GENERATED_TEXT_STORAGE_KEY);
    } catch {
      // Ignore storage failures; the in-memory text is already cleared.
    }
  }

  function loadSessionGeneratedText() {
    const boundedString = (value, maximumLength) => (
      typeof value === "string" && value && value.length <= maximumLength ? value : ""
    );
    try {
      const savedValue = window.sessionStorage?.getItem(GENERATED_TEXT_STORAGE_KEY);
      if (!savedValue) return;
      const saved = JSON.parse(savedValue);
      if (saved?.version !== GENERATED_TEXT_VERSION || !Array.isArray(saved.prompts)) {
        clearGeneratedTexts();
        return;
      }

      runtime.generatedTexts.clear();
      for (const savedPrompt of saved.prompts) {
        if (!Array.isArray(savedPrompt) || !Array.isArray(savedPrompt[1])) continue;
        const promptId = boundedString(savedPrompt[0], 256);
        if (!promptId) continue;

        const nodes = new Map();
        for (const entry of savedPrompt[1].slice(0, GENERATED_TEXT_MAX_NODES_PER_PROMPT)) {
          const nodeId = boundedString(entry?.nodeId, 256);
          const text = boundedString(entry?.text, GENERATED_TEXT_MAX_LENGTH + TRUNCATION_SUFFIX.length);
          if (!nodeId || !text.trim()) continue;
          nodes.set(nodeId, { nodeId, text });
        }
        if (nodes.size) runtime.generatedTexts.set(promptId, nodes);
      }
      pruneGeneratedTexts();
    } catch {
      clearGeneratedTexts();
    }
  }

  Object.assign(actions, {
    collectGeneratedText,
    recordGeneratedText,
    generatedTextsForPrompt,
    clearGeneratedTexts,
    saveSessionGeneratedText,
    loadSessionGeneratedText,
  });
}
