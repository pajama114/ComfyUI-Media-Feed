import {
  uniqueNonEmpty,
} from "./format.js";
import {
  collectWidgetStringValues,
  isSystemPromptLabel,
  isConditioningZeroNodeClass,
  preferredUserInputNames,
} from "./graph_shared.js";
import {
  isTextEncodeNode,
} from "./prompt_graph.js";
import {
  workflowInputValue,
} from "./workflow_inputs.js";

export function workflowNodeType(node) {
  return String(node?.type || node?.class_type || "");
}

export function isWorkflowStringCombinerNode(node) {
  return /string.*(function|concat|join|combine|format)|(concat|join|combine|format).*string|text.*(concat|join|combine|format)|(concat|join|combine|format).*text/i
    .test(workflowNodeType(node));
}

export function workflowInputIsText(input, node = null) {
  const inputName = String(input?.name || "");
  if (
    isWorkflowStringCombinerNode(node)
    && /^(f_string|format|template|pattern)$/i.test(inputName)
  ) {
    return false;
  }

  const description = `${input?.name || ""} ${input?.type || ""}`;
  if (/text|string|prompt|caption|input|message/i.test(description)) return true;
  if (!isWorkflowStringCombinerNode(node)) return false;
  return !/action|operation|function|separator|delimiter|tidy|mode/i.test(inputName);
}

export function isWorkflowTextCarrierNode(node) {
  const nodeType = workflowNodeType(node);
  const title = String(node?.title || node?.properties?.["Node name for S&R"] || "");
  const outputTypes = (node?.outputs || []).map((output) => `${output?.name || ""} ${output?.type || ""}`).join(" ");
  if (isTextEncodeNode({ class_type: nodeType })) return true;
  if ((node?.inputs || []).some((input) => workflowInputIsText(input, node))) return true;
  return /(^|[^a-z])(text|string|prompt)([^a-z]|$)/i.test(`${nodeType} ${title} ${outputTypes}`);
}

export function workflowNodeId(node) {
  return node?.id === undefined || node?.id === null ? "" : String(node.id);
}

export function workflowInputLink(node, name) {
  if (!Array.isArray(node?.inputs)) return null;
  const input = node.inputs.find((current) => current?.name === name);
  return input?.link === undefined || input?.link === null ? null : String(input.link);
}

export function workflowOutputName(node, slot) {
  const output = node?.outputs?.[Number(slot)];
  return String(output?.name || "").toLowerCase();
}

export function workflowSubgraphInputName(workflow, slot) {
  const input = workflow?.inputs?.[Number(slot)];
  return String(input?.name || "");
}

export function buildWorkflowMaps(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const nodeMap = new Map(nodes.map((node) => [workflowNodeId(node), node]));
  const linkMap = new Map();
  const consumerMap = new Map();

  for (const link of workflow?.links || []) {
    if (Array.isArray(link) && link.length >= 3) {
      const id = String(link[0]);
      const originId = String(link[1]);
      const originSlot = link[2];
      const targetId = link[3];
      const targetSlot = link[4];
      const originNode = nodeMap.get(originId);
      linkMap.set(id, {
        originId,
        originSlot,
        outputName: originId === "-10" ? workflowSubgraphInputName(workflow, originSlot) : workflowOutputName(originNode, originSlot),
      });
      if (targetId !== undefined) {
        if (!consumerMap.has(id)) consumerMap.set(id, []);
        consumerMap.get(id).push({ targetId: String(targetId), targetSlot });
      }
    } else if (link && typeof link === "object") {
      const id = link.id ?? link.link_id;
      const originId = link.origin_id ?? link.originId ?? link.from_node_id;
      const originSlot = link.origin_slot ?? link.originSlot ?? link.from_slot ?? link.from_socket;
      const targetId = link.target_id ?? link.targetId ?? link.to_node_id;
      const targetSlot = link.target_slot ?? link.targetSlot ?? link.to_slot ?? link.to_socket;
      if (id !== undefined && originId !== undefined) {
        const linkId = String(id);
        const originKey = String(originId);
        const originNode = nodeMap.get(originKey);
        linkMap.set(linkId, {
          originId: originKey,
          originSlot,
          outputName: originKey === "-10" ? workflowSubgraphInputName(workflow, originSlot) : workflowOutputName(originNode, originSlot),
        });
        if (targetId !== undefined) {
          if (!consumerMap.has(linkId)) consumerMap.set(linkId, []);
          consumerMap.get(linkId).push({ targetId: String(targetId), targetSlot });
        }
      }
    }
  }

  return { workflow, nodes, nodeMap, linkMap, consumerMap };
}

export function workflowLinkOrigin(maps, linkId) {
  return maps.linkMap.get(String(linkId)) || null;
}

export function workflowNodeHasPolarityInputs(node) {
  if (!Array.isArray(node?.inputs)) return false;
  const names = new Set(node.inputs.map((input) => input?.name));
  return names.has("positive") && names.has("negative");
}

export function workflowNodeLabel(node) {
  return String(node?.title || node?.properties?.["Node name for S&R"] || workflowNodeType(node) || `Node ${workflowNodeId(node)}`).trim();
}

export function isWorkflowSystemNode(node) {
  return isSystemPromptLabel(workflowNodeLabel(node));
}

export function isWorkflowConditioningZeroNode(node) {
  return isConditioningZeroNodeClass(workflowNodeType(node));
}

export function isWorkflowTextGenerationNode(node) {
  const nodeType = workflowNodeType(node);
  return /text.*generat|generat.*text|llm|gemini|openai|chat|prompt.*enhance|enhance.*prompt/i.test(nodeType)
    && !isTextEncodeNode({ class_type: nodeType });
}

export function workflowNodeHasOpaquePresetWidgets(node) {
  return /^SimplePreset$/i.test(workflowNodeType(node))
    && (
      node?.properties?.simple_preset_profile_id !== undefined
      || node?.widgets_values_named?.selected_presets !== undefined
    );
}

export function workflowNodeHasLinkedTextInput(node) {
  for (const input of node?.inputs || []) {
    if (!workflowInputIsText(input, node)) continue;
    if (input?.link !== undefined && input?.link !== null) return true;
  }
  return false;
}

export function isWorkflowTextPassthroughNode(node) {
  const nodeType = workflowNodeType(node);
  return /previewany|reroute|switch/i.test(nodeType);
}

export function workflowInputByName(node, name) {
  return (node?.inputs || []).find((input) => input?.name === name) || null;
}

export function workflowNodeBooleanValue(maps, nodeId, visited = new Set()) {
  if (!nodeId || visited.has(String(nodeId))) return undefined;
  visited.add(String(nodeId));

  const node = maps.nodeMap.get(String(nodeId));
  if (!node) return undefined;

  for (const input of node.inputs || []) {
    const directValue = workflowInputValue(node, input);
    if (typeof directValue === "boolean") return directValue;
    if (typeof directValue === "string" && /^(true|false)$/i.test(directValue.trim())) {
      return directValue.trim().toLowerCase() === "true";
    }

    if (input?.link === undefined || input?.link === null) continue;
    const origin = workflowLinkOrigin(maps, input.link);
    const linkedValue = workflowNodeBooleanValue(maps, origin?.originId, visited);
    if (typeof linkedValue === "boolean") return linkedValue;
  }

  for (const value of node.widgets_values || []) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) {
      return value.trim().toLowerCase() === "true";
    }
  }

  return undefined;
}

export function workflowSwitchSelectedInputName(maps, node) {
  if (!workflowInputByName(node, "on_true") || !workflowInputByName(node, "on_false")) return "";

  const switchInput = workflowInputByName(node, "switch");
  let switchValue = workflowInputValue(node, switchInput);
  if (typeof switchValue !== "boolean" && typeof switchValue === "string" && /^(true|false)$/i.test(switchValue.trim())) {
    switchValue = switchValue.trim().toLowerCase() === "true";
  }

  if (typeof switchValue !== "boolean" && switchInput?.link !== undefined && switchInput?.link !== null) {
    const origin = workflowLinkOrigin(maps, switchInput.link);
    switchValue = workflowNodeBooleanValue(maps, origin?.originId);
  }

  if (typeof switchValue !== "boolean") return "";
  return switchValue ? "on_true" : "on_false";
}

export function workflowTextInputs(node) {
  return (node?.inputs || [])
    .filter((input) => workflowInputIsText(input, node));
}

export function isWorkflowSubgraphInputOrigin(origin) {
  return String(origin?.originId || "") === "-10";
}

export function collectWorkflowExternalInputTexts(origin, maps, visited, context, preferUserInputs = false) {
  const externalNode = context?.externalNode;
  const externalMaps = context?.externalMaps;
  const inputName = String(origin?.outputName || workflowSubgraphInputName(maps.workflow, origin?.originSlot));
  if (!externalNode || !externalMaps || !inputName) return [];

  const input = workflowInputByName(externalNode, inputName);
  const texts = workflowInputLinkedTexts(
    input,
    externalMaps,
    new Set(),
    context?.parentContext || null,
    preferUserInputs,
  );
  if (texts.length) return texts;
  return uniqueNonEmpty(collectWidgetStringValues(workflowInputValue(externalNode, input)));
}

export function workflowInputLinkedTexts(input, maps, visited, context = null, preferUserInputs = false) {
  if (!input) return [];
  if (input.link !== undefined && input.link !== null) {
    const origin = workflowLinkOrigin(maps, input.link);
    if (isWorkflowSubgraphInputOrigin(origin)) {
      return collectWorkflowExternalInputTexts(origin, maps, visited, context, preferUserInputs);
    }
    return collectWorkflowUserInputTexts(origin?.originId, maps, visited, context, preferUserInputs);
  }
  return collectWidgetStringValues(input.value ?? input.default ?? input.widget?.value);
}

export function collectWorkflowUserInputTexts(nodeId, maps, visited = new Set(), context = null, preferUserInputs = false) {
  if (!nodeId || visited.has(String(nodeId))) return [];
  visited.add(String(nodeId));

  const node = maps.nodeMap.get(String(nodeId));
  if (!node || isWorkflowSystemNode(node)) return [];

  const selectedSwitchInputName = workflowSwitchSelectedInputName(maps, node);
  if (selectedSwitchInputName) {
    return workflowInputLinkedTexts(
      workflowInputByName(node, selectedSwitchInputName),
      maps,
      visited,
      context,
      preferUserInputs,
    );
  }

  const textInputs = workflowTextInputs(node);
  const preferredNames = preferUserInputs
    ? preferredUserInputNames(textInputs.map((input) => [String(input?.name || ""), input]))
    : [];
  if (preferredNames.length) {
    const texts = [];
    for (const name of preferredNames) {
      texts.push(...workflowInputLinkedTexts(workflowInputByName(node, name), maps, visited, context, true));
    }
    const preferredTexts = uniqueNonEmpty(texts);
    if (preferredTexts.length) return preferredTexts;
  }

  const texts = [];
  for (const input of textInputs) {
    if (input?.link !== undefined && input?.link !== null) {
      texts.push(...workflowInputLinkedTexts(input, maps, visited, context, preferUserInputs));
    } else {
      texts.push(...collectWidgetStringValues(workflowInputValue(node, input)));
    }
  }
  const inputTexts = uniqueNonEmpty(texts);
  if (inputTexts.length) return inputTexts;

  return isWorkflowTextCarrierNode(node) && !workflowNodeHasOpaquePresetWidgets(node)
    ? uniqueNonEmpty(collectWidgetStringValues(node.widgets_values || []))
    : [];
}

export function collectWorkflowTextGenerationInputTexts(node, maps, visited, context) {
  const promptInput = workflowInputByName(node, "user_prompt")
    || workflowInputByName(node, "prompt")
    || workflowInputByName(node, "text")
    || workflowInputByName(node, "input")
    || workflowInputByName(node, "message")
    || workflowInputByName(node, "messages");
  return workflowInputLinkedTexts(promptInput, maps, new Set(visited), context, true);
}
