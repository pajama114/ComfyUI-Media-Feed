import {
  uniqueNonEmpty,
  normalizeResourceValue,
  addResourceEntry,
  resourceBasename,
  formatResourceEntries,
  isSeedFieldName,
  collectSeedValues,
} from "./format.js";
import {
  widgetValueHasActivationState,
} from "./graph_shared.js";
import {
  workflowNodeType,
  workflowOutputName,
  workflowSubgraphInputName,
  buildWorkflowMaps,
  workflowLinkOrigin,
  workflowNodeLabel,
  workflowInputByName,
  workflowSwitchSelectedInputName,
  isWorkflowSubgraphInputOrigin,
} from "./workflow_structure.js";
import {
  workflowInputValue,
  workflowInputWidgetValue,
} from "./workflow_inputs.js";

export {
  workflowInputValue,
} from "./workflow_inputs.js";

export function collectWorkflowPropertySeedEntries(object, label) {
  const entries = [];
  if (!object || typeof object !== "object" || Array.isArray(object)) return entries;

  for (const [key, value] of Object.entries(object)) {
    if (!isSeedFieldName(key)) continue;
    for (const seed of collectSeedValues(value)) entries.push({ label: `${label}.${key}`, value: seed });
  }

  return entries;
}

export function collectLinkedWorkflowSeedValues(maps, nodeId, visited = new Set(), forceValue = false) {
  if (!nodeId || visited.has(String(nodeId))) return [];
  visited.add(String(nodeId));

  const node = maps.nodeMap.get(String(nodeId));
  if (!node) return [];

  const seeds = [];
  const seedishNode = /seed|primitive|integer|number/i.test(workflowNodeType(node));
  const singleWidgetValue = forceValue && Array.isArray(node.widgets_values) && node.widgets_values.length === 1;
  if (seedishNode || singleWidgetValue) seeds.push(...collectSeedValues(node.widgets_values || []));

  for (const input of node.inputs || []) {
    const inputName = String(input?.name || "");
    const valueIsSeed = isSeedFieldName(inputName);
    if (valueIsSeed) seeds.push(...collectSeedValues(input?.value ?? input?.default ?? input?.widget?.value));

    if (input?.link !== undefined && input?.link !== null && (forceValue || seedishNode || valueIsSeed)) {
      const origin = workflowLinkOrigin(maps, input.link);
      seeds.push(...collectLinkedWorkflowSeedValues(maps, origin?.originId, visited, forceValue || valueIsSeed));
    }
  }

  return uniqueNonEmpty(seeds);
}

export function collectWorkflowSeedEntries(workflow, maps = buildWorkflowMaps(workflow)) {
  const entries = [];
  if (!workflow || typeof workflow !== "object") return entries;

  for (const node of maps.nodes) {
    const nodeLabel = workflowNodeLabel(node);
    entries.push(...collectWorkflowPropertySeedEntries(node.properties, nodeLabel));

    for (const input of node.inputs || []) {
      const inputName = String(input?.name || "");
      if (!isSeedFieldName(inputName)) continue;

      const directSeeds = collectSeedValues(workflowInputValue(node, input));
      for (const seed of directSeeds) entries.push({ label: `${nodeLabel}.${inputName}`, value: seed });

      if (input?.link === undefined || input?.link === null) continue;
      const origin = workflowLinkOrigin(maps, input.link);
      for (const seed of collectLinkedWorkflowSeedValues(maps, origin?.originId, new Set(), true)) {
        entries.push({ label: `${nodeLabel}.${inputName}`, value: seed });
      }
    }

    if (Array.isArray(node.widgets)) {
      node.widgets.forEach((widget, index) => {
        const widgetName = String(widget?.name || widget?.label || "");
        if (!isSeedFieldName(widgetName)) return;
        const value = widget?.value ?? node.widgets_values?.[index];
        for (const seed of collectSeedValues(value)) entries.push({ label: `${nodeLabel}.${widgetName}`, value: seed });
      });
    }

    if (Array.isArray(node.widgets_values)) {
      for (const value of node.widgets_values) {
        if (!value || typeof value !== "object") continue;
        entries.push(...collectWorkflowPropertySeedEntries(value, nodeLabel));
      }
    }
  }

  return entries;
}

export function workflowInputEffectiveValue(node, input, maps, context = null, visited = new Set()) {
  if (!node || !input) return undefined;

  const linked = input.link !== undefined && input.link !== null;
  if (linked) {
    const origin = workflowLinkOrigin(maps, input.link);
    if (isWorkflowSubgraphInputOrigin(origin)) {
      const externalNode = context?.externalNode;
      const externalMaps = context?.externalMaps;
      const inputName = String(origin?.outputName || workflowSubgraphInputName(maps.workflow, origin?.originSlot));
      const externalInput = workflowInputByName(externalNode, inputName);
      const externalValue = workflowInputEffectiveValue(externalNode, externalInput, externalMaps, context?.parentContext || null, visited);
      if (externalValue !== undefined && externalValue !== "") return externalValue;
    } else {
      const originId = String(origin?.originId || "");
      const key = `${originId}:${origin?.originSlot ?? ""}`;
      if (originId && !visited.has(key)) {
        visited.add(key);

        const originNode = maps.nodeMap.get(originId);
        const originValue = workflowOutputValue(originNode, origin?.originSlot, maps, context, visited);
        if (originValue !== undefined && originValue !== "") return originValue;
      }
    }

  }

  const localValue = workflowInputWidgetValue(node, input);
  if (localValue !== undefined) return localValue;
  return linked ? undefined : workflowInputValue(node, input);
}

export function workflowOutputValue(node, slot, maps, context, visited) {
  if (!node) return undefined;

  const outputName = workflowOutputName(node, slot);
  if (/^(true|false)$/i.test(outputName)) return outputName.toLowerCase() === "true";

  const nodeType = workflowNodeType(node);
  if (/primitive|boolean|integer|number|string|text|combo/i.test(nodeType) && Array.isArray(node.widgets_values) && node.widgets_values.length) {
    return node.widgets_values[0];
  }

  if (/switch/i.test(nodeType)) {
    const selectedInputName = workflowSwitchSelectedInputName(maps, node);
    const selectedInput = workflowInputByName(node, selectedInputName);
    return workflowInputEffectiveValue(node, selectedInput, maps, context, visited);
  }

  return undefined;
}

export function workflowInputBooleanValue(node, input, maps, context = null) {
  const value = workflowInputEffectiveValue(node, input, maps, context);
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) {
    return value.trim().toLowerCase() === "true";
  }
  return undefined;
}

export function workflowInputNameAtSlot(node, slot) {
  const input = node?.inputs?.[Number(slot)];
  return String(input?.name || "");
}

export function workflowNodeOutputLinks(node) {
  const links = [];
  for (const output of node?.outputs || []) {
    if (Array.isArray(output?.links)) links.push(...output.links);
    else if (output?.links !== undefined && output.links !== null) links.push(output.links);
  }
  return links.map((link) => String(link));
}

export function workflowLoraNodeIsActive(node, maps, context) {
  const outputLinks = workflowNodeOutputLinks(node);
  let sawSwitchConsumer = false;

  for (const linkId of outputLinks) {
    for (const consumer of maps.consumerMap.get(linkId) || []) {
      const target = maps.nodeMap.get(String(consumer.targetId));
      if (!target || !/switch/i.test(workflowNodeType(target))) continue;

      const inputName = workflowInputNameAtSlot(target, consumer.targetSlot);
      if (inputName !== "on_true" && inputName !== "on_false") continue;
      const switchValue = workflowInputBooleanValue(target, workflowInputByName(target, "switch"), maps, context);
      if (typeof switchValue !== "boolean") continue;

      sawSwitchConsumer = true;
      if ((inputName === "on_true" && switchValue) || (inputName === "on_false" && !switchValue)) {
        return true;
      }
    }
  }

  return !sawSwitchConsumer;
}

export function formatLoraNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? `${value}.00` : value.toFixed(2);
  const text = normalizeResourceValue(value);
  if (!text) return "";
  const number = Number(text);
  return Number.isFinite(number) ? formatLoraNumber(number) : text;
}

export function formatLoraResource(name, strength, clipStrength) {
  const cleanName = normalizeResourceValue(name);
  if (!cleanName) return "";

  const parts = [cleanName];
  const cleanStrength = formatLoraNumber(strength);
  const cleanClipStrength = formatLoraNumber(clipStrength);
  if (cleanStrength) parts.push(cleanStrength);
  if (cleanClipStrength && cleanClipStrength !== cleanStrength) parts.push(`clip ${cleanClipStrength}`);
  return parts.join(" · ");
}

export function collectLoraResourcesFromValue(value, entries = []) {
  if (typeof value === "string") {
    const pattern = /<lora:([^:>]+):([^:>]+)(?::([^>]+))?>/gi;
    for (const match of value.matchAll(pattern)) {
      const formatted = formatLoraResource(match[1], match[2], match[3]);
      addResourceEntry(entries, "LoRA", formatted);
    }
  } else if (Array.isArray(value)) {
    const hasActivationState = widgetValueHasActivationState(value);
    for (const child of value) {
      if (hasActivationState && typeof child === "string") continue;
      collectLoraResourcesFromValue(child, entries);
    }
  } else if (value && typeof value === "object") {
    if (value.active === false) return entries;

    if (Object.prototype.hasOwnProperty.call(value, "name")) {
      const formatted = formatLoraResource(value.name, value.strength ?? value.modelStrength, value.clipStrength);
      addResourceEntry(entries, "LoRA", formatted);
    }

    for (const [key, child] of Object.entries(value)) {
      if (/lora/i.test(key) || /^(items?|children|values?)$/i.test(key)) collectLoraResourcesFromValue(child, entries);
    }
  }

  return entries;
}

export function modelResourceFromProperties(node, directoryPattern) {
  const models = Array.isArray(node?.properties?.models) ? node.properties.models : [];
  const model = models.find((current) => directoryPattern.test(String(current?.directory || "")))
    || models.find((current) => normalizeResourceValue(current?.name));
  return resourceBasename(model?.name);
}

export function resourceFilenameLike(value) {
  return /\.(safetensors|ckpt|pt|pth|bin)$/i.test(normalizeResourceValue(value));
}

export function collectWorkflowResourceEntries(workflow, maps = buildWorkflowMaps(workflow), context = null) {
  const entries = [];
  if (!workflow || typeof workflow !== "object") return entries;

  for (const node of maps.nodes) {
    const nodeType = workflowNodeType(node);
    const checkpointNode = /checkpoint|unetloader|diffusion/i.test(nodeType)
      || Array.isArray(node?.properties?.models)
        && node.properties.models.some((model) => /diffusion|checkpoint|unet/i.test(String(model?.directory || "")));
    const loraNode = /lora/i.test(nodeType);
    let hasSelectedCheckpoint = false;

    for (const input of node.inputs || []) {
      const inputName = String(input?.name || "");
      if (checkpointNode && /^(ckpt|ckpt_name|checkpoint|checkpoint_name|model_name|unet_name|diffusion_model_name)$/i.test(inputName)) {
        const checkpoint = resourceBasename(workflowInputEffectiveValue(node, input, maps, context));
        if (checkpoint) {
          addResourceEntry(entries, "Checkpoint", checkpoint);
          hasSelectedCheckpoint = true;
        }
      }

      if (loraNode || /lora/i.test(inputName)) {
        collectLoraResourcesFromValue(workflowInputEffectiveValue(node, input, maps, context), entries);
      }
    }

    // `properties.models` is often a workflow template's download hint, not the
    // model selected for this execution. Prefer the resolved loader input and
    // only use that metadata when no selection can be recovered.
    if (checkpointNode && !hasSelectedCheckpoint && Array.isArray(node.widgets_values)) {
      const propertyModel = modelResourceFromProperties(node, /diffusion|checkpoint|unet/i);
      if (propertyModel) {
        addResourceEntry(entries, "Checkpoint", propertyModel);
      } else {
        for (const value of node.widgets_values) {
          if (resourceFilenameLike(value)) addResourceEntry(entries, "Checkpoint", resourceBasename(value));
        }
      }
    }

    if (loraNode || /lora/i.test(JSON.stringify(node.properties || {}))) {
      if (loraNode && !workflowLoraNodeIsActive(node, maps, context)) continue;

      const loraNameInput = workflowInputByName(node, "lora_name");
      const strengthInput = workflowInputByName(node, "strength_model")
        || workflowInputByName(node, "strength")
        || workflowInputByName(node, "model_strength");
      const loraName = workflowInputEffectiveValue(node, loraNameInput, maps, context);
      const loraStrength = workflowInputEffectiveValue(node, strengthInput, maps, context);
      const formatted = formatLoraResource(resourceBasename(loraName), loraStrength);
      addResourceEntry(entries, "LoRA", formatted);

      collectLoraResourcesFromValue(node.widgets_values || [], entries);
      collectLoraResourcesFromValue(node.widgets || [], entries);
    }
  }

  return formatResourceEntries(entries);
}
