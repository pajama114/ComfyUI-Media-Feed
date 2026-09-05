import {
  uniqueNonEmpty,
  joinPrompts,
  addMetadataField,
  addResourceEntry,
  resourceBasename,
  formatResourceEntries,
  isSeedFieldName,
  collectSeedValues,
  formatSeedEntries,
  isPromptLink,
} from "./format.js";
import {
  collectStringValues,
  collectWidgetStringValues,
  isSystemPromptLabel,
  isConditioningZeroNodeClass,
  preferredUserInputNames,
} from "./graph_shared.js";

export function promptNodeClass(node) {
  return String(node?.class_type || node?.type || "");
}

export function isTextEncodeNode(node) {
  return /text.*encode|clip.*text/i.test(promptNodeClass(node));
}

export function isTextCarrierNode(node) {
  const nodeClass = promptNodeClass(node);
  const title = String(node?.title || node?.properties?.["Node name for S&R"] || "");
  if (isTextEncodeNode(node)) return true;
  if (Object.entries(node?.inputs || {}).some(([name, value]) => promptInputIsText(node, name, value))) return true;
  return /(^|[^a-z])(text|string|prompt)([^a-z]|$)/i.test(`${nodeClass} ${title}`);
}

export function collectPromptInputTexts(node) {
  const inputs = node?.inputs || {};
  const texts = [];

  for (const [name, value] of Object.entries(inputs)) {
    if (!promptInputIsText(node, name, value)) continue;
    if (isPromptLink(value)) continue;
    texts.push(...collectStringValues(value));
  }

  return uniqueNonEmpty(texts);
}

export function collectPromptNodeStrings(node) {
  const texts = [];
  texts.push(...collectPromptInputTexts(node));
  texts.push(...collectWidgetStringValues(node?.widgets_values || []));
  texts.push(...collectWidgetStringValues(node?.widgets || []));
  return uniqueNonEmpty(texts);
}

export function promptNodeHasPolarityInputs(node) {
  const names = new Set(Object.keys(node?.inputs || {}));
  return names.has("positive") && names.has("negative");
}

export function promptNodeLabel(node, nodeId) {
  return String(node?.title || node?.properties?.["Node name for S&R"] || promptNodeClass(node) || `Node ${nodeId}`).trim();
}

export function isPromptSystemNode(node, nodeId = "") {
  return isSystemPromptLabel(promptNodeLabel(node, nodeId));
}

export function isPromptConditioningZeroNode(node) {
  return isConditioningZeroNodeClass(promptNodeClass(node));
}

export function isPromptTextGenerationNode(node) {
  const nodeClass = promptNodeClass(node);
  return /text.*generat|generat.*text|llm|gemini|openai|chat|prompt.*enhance|enhance.*prompt/i.test(nodeClass)
    && !isTextEncodeNode(node);
}

export function promptNodeHasLinkedTextInput(node) {
  const inputs = node?.inputs || {};
  for (const [name, value] of Object.entries(inputs)) {
    if (!promptInputIsText(node, name, value)) continue;
    if (isPromptLink(value)) return true;
  }
  return false;
}

export function promptNodeBooleanValue(prompt, reference, visited = new Set()) {
  if (!prompt || !isPromptLink(reference)) return undefined;

  const nodeId = String(reference[0]);
  if (visited.has(nodeId)) return undefined;
  visited.add(nodeId);

  const node = prompt[nodeId];
  if (!node) return undefined;

  for (const value of Object.values(node.inputs || {})) {
    if (typeof value === "boolean") return value;
    if (isPromptLink(value)) {
      const linkedValue = promptNodeBooleanValue(prompt, value, visited);
      if (typeof linkedValue === "boolean") return linkedValue;
    }
  }

  for (const value of node.widgets_values || []) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) {
      return value.trim().toLowerCase() === "true";
    }
  }

  return undefined;
}

export function promptSwitchSelectedInputName(prompt, node) {
  const inputs = node?.inputs || {};
  if (!("on_true" in inputs) || !("on_false" in inputs)) return "";

  const switchValue = typeof inputs.switch === "boolean"
    ? inputs.switch
    : promptNodeBooleanValue(prompt, inputs.switch);
  if (typeof switchValue !== "boolean") return "";
  return switchValue ? "on_true" : "on_false";
}

export function promptNodeInputValue(node, name) {
  const inputs = node?.inputs || {};
  return Object.prototype.hasOwnProperty.call(inputs, name) ? inputs[name] : undefined;
}

export function isPromptStringCombinerNode(node) {
  return /string.*(function|concat|join|combine|format)|(concat|join|combine|format).*string|text.*(concat|join|combine|format)|(concat|join|combine|format).*text/i
    .test(promptNodeClass(node));
}

export function promptInputIsText(node, name, value) {
  if (
    isPromptStringCombinerNode(node)
    && /^(f_string|format|template|pattern)$/i.test(String(name || ""))
  ) {
    return false;
  }
  if (/text|string|prompt|caption|input|message|^value$/i.test(String(name || ""))) return true;
  if (!isPromptStringCombinerNode(node)) return false;
  if (/action|operation|function|separator|delimiter|tidy|mode/i.test(String(name || ""))) return false;
  return typeof value === "string" || isPromptLink(value) || Array.isArray(value);
}

export function promptNodeTextInputs(node) {
  return Object.entries(node?.inputs || {})
    .filter(([name, value]) => promptInputIsText(node, name, value));
}

export function collectPromptUserInputTexts(prompt, reference, visited = new Set()) {
  if (!prompt || !isPromptLink(reference)) return [];

  const nodeId = String(reference[0]);
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);

  const node = prompt[nodeId];
  if (!node || isPromptSystemNode(node, nodeId)) return [];

  const selectedSwitchInputName = promptSwitchSelectedInputName(prompt, node);
  if (selectedSwitchInputName) {
    const selectedValue = promptNodeInputValue(node, selectedSwitchInputName);
    return isPromptLink(selectedValue)
      ? collectPromptUserInputTexts(prompt, selectedValue, visited)
      : collectStringValues(selectedValue);
  }

  const textInputs = promptNodeTextInputs(node);
  const preferredNames = preferredUserInputNames(textInputs);
  if (preferredNames.length) {
    const texts = [];
    for (const name of preferredNames) {
      const value = promptNodeInputValue(node, name);
      if (isPromptLink(value)) {
        texts.push(...collectPromptUserInputTexts(prompt, value, visited));
      } else {
        texts.push(...collectStringValues(value));
      }
    }
    return uniqueNonEmpty(texts);
  }

  const directTexts = promptNodeHasLinkedTextInput(node) ? [] : collectPromptNodeStrings(node);
  if (directTexts.length) return directTexts;

  const texts = [];
  for (const [, value] of textInputs) {
    if (isPromptLink(value)) {
      texts.push(...collectPromptUserInputTexts(prompt, value, visited));
    } else {
      texts.push(...collectStringValues(value));
    }
  }
  return uniqueNonEmpty(texts);
}

export function collectPromptTextGenerationInputTexts(prompt, node, visited) {
  const inputs = node?.inputs || {};
  const promptReference = inputs.user_prompt || inputs.prompt || inputs.text || inputs.input || inputs.message || inputs.messages;
  return collectPromptUserInputTexts(prompt, promptReference, new Set(visited));
}

export function collectLinkedPromptSeedValues(prompt, reference, visited = new Set()) {
  if (!prompt || !isPromptLink(reference)) return [];

  const nodeId = String(reference[0]);
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);

  const node = prompt[nodeId];
  const inputs = node?.inputs || {};
  if (!node) return [];

  const seeds = [];
  const seedishNode = /seed|primitive|integer|number/i.test(promptNodeClass(node));
  for (const [name, value] of Object.entries(inputs)) {
    const valueName = String(name || "").toLowerCase();
    const valueIsSeed = isSeedFieldName(name) || (seedishNode && /^(value|int|integer|number)$/.test(valueName));
    if (valueIsSeed && !isPromptLink(value)) seeds.push(...collectSeedValues(value));

    if (isPromptLink(value)) {
      seeds.push(...collectLinkedPromptSeedValues(prompt, value, visited));
    } else if (Array.isArray(value)) {
      for (const child of value) {
        if (isPromptLink(child)) seeds.push(...collectLinkedPromptSeedValues(prompt, child, visited));
      }
    }
  }

  if (seedishNode) seeds.push(...collectSeedValues(node.widgets_values || []));
  return uniqueNonEmpty(seeds);
}

export function collectPromptSeedEntries(prompt) {
  const entries = [];
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return entries;

  for (const [nodeId, node] of Object.entries(prompt)) {
    const inputs = node?.inputs || {};
    const nodeLabel = promptNodeLabel(node, nodeId);
    const nodeClass = promptNodeClass(node);
    for (const [name, value] of Object.entries(inputs)) {
      if (!isSeedFieldName(name)) continue;

      const seeds = isPromptLink(value)
        ? collectLinkedPromptSeedValues(prompt, value, new Set())
        : collectSeedValues(value);
      for (const seed of seeds) entries.push({
        label: `${nodeLabel}.${name}`,
        value: seed,
        nodeId: String(nodeId),
        nodeClass,
        fieldName: name,
      });
    }
  }

  return selectPromptSeedEntries(prompt, entries);
}

export function promptTerminalNodeIds(prompt) {
  const consumers = new Set();
  const terminals = [];

  for (const node of Object.values(prompt || {})) {
    for (const value of Object.values(node?.inputs || {})) {
      if (isPromptLink(value)) consumers.add(String(value[0]));
    }
  }

  for (const [nodeId, node] of Object.entries(prompt || {})) {
    const nodeClass = promptNodeClass(node);
    if (/save|preview|create.*video|video.*combine/i.test(nodeClass) || !consumers.has(String(nodeId))) {
      terminals.push(String(nodeId));
    }
  }

  return terminals;
}

export function promptAncestorDistances(prompt) {
  const distances = new Map();
  const queue = promptTerminalNodeIds(prompt).map((nodeId) => [nodeId, 0]);

  for (const [nodeId, distance] of queue) distances.set(nodeId, distance);

  for (let index = 0; index < queue.length; index++) {
    const [nodeId, distance] = queue[index];
    const node = prompt?.[nodeId];
    if (!node) continue;

    for (const value of Object.values(node.inputs || {})) {
      const links = [];
      if (isPromptLink(value)) {
        links.push(value);
      } else if (Array.isArray(value)) {
        for (const child of value) {
          if (isPromptLink(child)) links.push(child);
        }
      }

      for (const link of links) {
        const linkedId = String(link[0]);
        if (distances.has(linkedId)) continue;
        distances.set(linkedId, distance + 1);
        queue.push([linkedId, distance + 1]);
      }
    }
  }

  return distances;
}

export function promptSeedPriority(entry) {
  const nodeClass = String(entry?.nodeClass || "");
  const fieldName = String(entry?.fieldName || "");
  if (/^RandomNoise$/i.test(nodeClass) && /^noise_seed$/i.test(fieldName)) return 0;
  if (/noise/i.test(nodeClass) && /seed/i.test(fieldName)) return 1;
  if (/sampler/i.test(nodeClass)) return 2;
  return 3;
}

export function selectPromptSeedEntries(prompt, entries) {
  if (entries.length <= 1) return entries;

  const distances = promptAncestorDistances(prompt);
  const ranked = entries.map((entry) => ({
    ...entry,
    priority: promptSeedPriority(entry),
    distance: distances.get(entry.nodeId) ?? Number.POSITIVE_INFINITY,
  }));
  const bestPriority = Math.min(...ranked.map((entry) => entry.priority));
  const priorityMatches = ranked.filter((entry) => entry.priority === bestPriority);
  if (bestPriority === 0 && priorityMatches.length > 1) {
    return labelPromptNoiseSeedEntries(priorityMatches);
  }

  const bestDistance = Math.min(...priorityMatches.map((entry) => entry.distance));
  const selected = priorityMatches.filter((entry) => entry.distance === bestDistance);

  return selected.map(({ priority, distance, nodeId, nodeClass, fieldName, ...entry }) => entry);
}

export function labelPromptNoiseSeedEntries(entries) {
  const sorted = [...entries].sort((a, b) => {
    const distanceDelta = (b.distance ?? 0) - (a.distance ?? 0);
    if (distanceDelta) return distanceDelta;
    return String(a.nodeId || "").localeCompare(String(b.nodeId || ""));
  });

  return sorted.map(({ priority, distance, nodeId, nodeClass, fieldName, ...entry }, index) => {
    if (sorted.length === 2) {
      return { ...entry, label: index === 0 ? "Low" : "High" };
    }

    return { ...entry, label: `Seed ${index + 1}` };
  });
}

export function collectPromptMetadataEntries(prompt) {
  const entries = [];
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return entries;

  for (const node of Object.values(prompt)) {
    const inputs = node?.inputs || {};
    const nodeClass = promptNodeClass(node);
    const samplerNode = /sampler/i.test(nodeClass);
    const schedulerNode = /scheduler/i.test(nodeClass);
    const guiderNode = /guider|guidance/i.test(nodeClass);
    const latentNode = /latent|empty.*image/i.test(nodeClass);

    for (const [name, value] of Object.entries(inputs)) {
      if (isPromptLink(value)) continue;
      if (!samplerNode && !schedulerNode && !guiderNode && !latentNode) continue;
      addMetadataField(entries, name, value);
    }
  }

  return entries;
}

export function collectPromptResourceEntries(prompt) {
  const entries = [];
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return entries;

  for (const node of Object.values(prompt)) {
    const nodeClass = promptNodeClass(node);
    if (!/checkpoint|unetloader|diffusion/i.test(nodeClass)) continue;

    for (const [name, value] of Object.entries(node?.inputs || {})) {
      if (!/^(ckpt|ckpt_name|checkpoint|checkpoint_name|model_name|unet_name|diffusion_model_name)$/i.test(name)) continue;
      if (isPromptLink(value)) continue;

      const checkpoint = resourceBasename(value);
      if (checkpoint) addResourceEntry(entries, "Checkpoint", checkpoint);
    }
  }

  return formatResourceEntries(entries);
}

export function collectPromptNodeTexts(prompt, reference, visited = new Set(), forceText = false, polarity = "") {
  if (!prompt || !isPromptLink(reference)) return [];

  const nodeId = String(reference[0]);
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);

  const node = prompt[nodeId];
  const inputs = node?.inputs || {};
  if (!node) return [];
  if (isPromptSystemNode(node, nodeId) || isPromptConditioningZeroNode(node)) return [];
  if (isPromptTextGenerationNode(node)) return collectPromptTextGenerationInputTexts(prompt, node, visited);

  const texts = [];
  const textCarrier = isTextCarrierNode(node);
  const selectedSwitchInputName = promptSwitchSelectedInputName(prompt, node);
  if ((forceText || textCarrier) && !promptNodeHasLinkedTextInput(node)) {
    texts.push(...collectPromptNodeStrings(node));
  }

  for (const [name, value] of Object.entries(inputs)) {
    if (selectedSwitchInputName && name !== selectedSwitchInputName) continue;

    if (
      polarity
      && promptNodeHasPolarityInputs(node)
      && name !== polarity
    ) {
      continue;
    }

    const isTextInput = promptInputIsText(node, name, value);
    if (textCarrier && !isTextInput) continue;

    if (isPromptLink(value)) {
      texts.push(...collectPromptNodeTexts(prompt, value, visited, isTextInput || Boolean(selectedSwitchInputName), polarity));
    } else if (Array.isArray(value)) {
      for (const child of value) {
        if (isPromptLink(child)) texts.push(...collectPromptNodeTexts(prompt, child, visited, forceText || Boolean(selectedSwitchInputName), polarity));
        else if ((forceText || textCarrier) && isTextInput) texts.push(...collectStringValues(child));
      }
    } else if ((forceText || textCarrier) && isTextInput) {
      texts.push(...collectStringValues(value));
    }
  }

  return uniqueNonEmpty(texts);
}

export function extractFromPromptGraph(prompt) {
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return {};

  const positives = [];
  const negatives = [];
  const seedEntries = collectPromptSeedEntries(prompt);
  const resources = collectPromptResourceEntries(prompt);
  const details = collectPromptMetadataEntries(prompt);

  for (const node of Object.values(prompt)) {
    const inputs = node?.inputs || {};
    if (inputs.positive && inputs.negative) {
      if (!/sampler/i.test(promptNodeClass(node)) && !isPromptLink(inputs.positive)) continue;

      positives.push(...collectPromptNodeTexts(prompt, inputs.positive, new Set(), false, "positive"));
      negatives.push(...collectPromptNodeTexts(prompt, inputs.negative, new Set(), false, "negative"));
      continue;
    }

    if (!/guider|guidance/i.test(promptNodeClass(node)) || !isPromptLink(inputs.conditioning)) continue;
    positives.push(...collectPromptNodeTexts(prompt, inputs.conditioning, new Set(), true, "positive"));
  }

  return {
    seed: formatSeedEntries(seedEntries),
    positive: joinPrompts(positives),
    negative: joinPrompts(negatives),
    resources,
    details,
    source: seedEntries.length || positives.length || negatives.length || resources.length || details.length ? "prompt" : "",
  };
}
