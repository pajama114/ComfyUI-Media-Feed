import {
  uniqueNonEmpty,
  joinPrompts,
  addMetadataField,
  formatResourceEntries,
  formatSeedEntries,
} from "./format.js";
import {
  collectWidgetStringValues,
} from "./graph_shared.js";
import {
  workflowNodeType,
  workflowNodeId,
  workflowInputIsText,
  isWorkflowTextCarrierNode,
  workflowInputLink,
  buildWorkflowMaps,
  workflowLinkOrigin,
  workflowAncestorNodeIds,
  workflowNodeHasPolarityInputs,
  isWorkflowSystemNode,
  isWorkflowConditioningZeroNode,
  isWorkflowTextGenerationNode,
  workflowNodeHasLinkedTextInput,
  isWorkflowTextPassthroughNode,
  workflowSwitchSelectedInputName,
  workflowTextInputs,
  isWorkflowSubgraphInputOrigin,
  collectWorkflowExternalInputTexts,
  collectWorkflowTextGenerationInputTexts,
  workflowInputNameForOutput,
} from "./workflow_structure.js";
import {
  collectWorkflowSeedEntries,
  workflowInputValue,
  collectWorkflowResourceEntries,
} from "./workflow_values.js";

export function collectWorkflowMetadataEntries(workflow, maps = buildWorkflowMaps(workflow)) {
  const entries = [];
  if (!workflow || typeof workflow !== "object") return entries;

  for (const node of maps.nodes) {
    const nodeType = workflowNodeType(node);
    const samplerNode = /sampler/i.test(nodeType);
    const schedulerNode = /scheduler/i.test(nodeType);
    const guiderNode = /guider|guidance/i.test(nodeType);
    const latentNode = /latent|empty.*image/i.test(nodeType);

    for (const input of node.inputs || []) {
      const name = String(input?.name || "");
      if (!samplerNode && !schedulerNode && !guiderNode && !latentNode) continue;
      addMetadataField(entries, name, workflowInputValue(node, input));
    }
  }

  return entries;
}

function workflowPromptTraversalKey(maps, origin, forceText, polarity) {
  return [
    "prompt",
    String(maps?.scopeKey || "root"),
    String(origin?.originId || ""),
    String(origin?.originSlot ?? ""),
    String(origin?.outputName || "").toLowerCase(),
    polarity,
    forceText ? "forced" : "typed",
  ].join(":");
}

export function collectWorkflowNodeTexts(originOrNodeId, maps, visited = new Set(), forceText = false, polarity = "", context = null) {
  const origin = originOrNodeId && typeof originOrNodeId === "object"
    ? originOrNodeId
    : { originId: originOrNodeId };
  const nodeId = String(origin?.originId || "");
  if (!nodeId) return [];

  const outputPolarity = origin.outputName === "positive" || origin.outputName === "negative"
    ? origin.outputName
    : "";
  const activePolarity = outputPolarity || polarity;
  const visitKey = workflowPromptTraversalKey(maps, origin, forceText, activePolarity);
  if (visited.has(visitKey)) return [];
  visited.add(visitKey);

  const node = maps.nodeMap.get(String(nodeId));
  if (!node) return [];
  if (isWorkflowSystemNode(node) || isWorkflowConditioningZeroNode(node)) return [];
  if (isWorkflowTextGenerationNode(node)) return collectWorkflowTextGenerationInputTexts(node, maps, visited, context);

  const texts = [];
  const textCarrier = isWorkflowTextCarrierNode(node);
  const selectedSwitchInputName = workflowSwitchSelectedInputName(maps, node);
  const outputInputName = workflowInputNameForOutput(node, origin);
  const linkedTextInput = workflowNodeHasLinkedTextInput(node);
  if ((forceText || textCarrier) && !linkedTextInput) {
    const directTextInputs = outputInputName
      ? workflowTextInputs(node).filter((input) => input?.name === outputInputName)
      : workflowTextInputs(node);
    const directTexts = directTextInputs
      .flatMap((input) => collectWidgetStringValues(workflowInputValue(node, input)));
    texts.push(...(directTexts.length ? directTexts : collectWidgetStringValues(node.widgets_values || [])));
  }

  for (const input of node.inputs || []) {
    if (selectedSwitchInputName && input.name !== selectedSwitchInputName) continue;
    if (!selectedSwitchInputName && outputInputName && input.name !== outputInputName) continue;

    const isTextInput = workflowInputIsText(input, node);
    if (input?.link === undefined || input?.link === null) {
      if ((forceText || textCarrier) && isTextInput) {
        texts.push(...collectWidgetStringValues(workflowInputValue(node, input)));
      }
      continue;
    }
    if (textCarrier && !isTextInput && !isWorkflowTextPassthroughNode(node)) continue;

    if (
      activePolarity
      && workflowNodeHasPolarityInputs(node)
      && input.name !== activePolarity
    ) {
      continue;
    }

    const inputOrigin = workflowLinkOrigin(maps, input.link);
    if (!inputOrigin) continue;
    if (isWorkflowSubgraphInputOrigin(inputOrigin)) {
      texts.push(...collectWorkflowExternalInputTexts(inputOrigin, maps, new Set(visited), context));
      continue;
    }

    const nextPolarity = inputOrigin.outputName === "positive" || inputOrigin.outputName === "negative"
      ? inputOrigin.outputName
      : activePolarity;
    const nextForceText = isTextInput || Boolean(selectedSwitchInputName) || (textCarrier && isWorkflowTextPassthroughNode(node));
    texts.push(...collectWorkflowNodeTexts(inputOrigin, maps, visited, nextForceText, nextPolarity, context));
  }

  return uniqueNonEmpty(texts);
}

export function extractFromWorkflowGraph(workflow, context = null) {
  if (!workflow || typeof workflow !== "object") return {};

  const maps = buildWorkflowMaps(workflow, context?.scopeKey || "root");
  const positives = [];
  const negatives = [];
  const allowedNodeIds = context?.allowedNodeIds instanceof Set
    ? context.allowedNodeIds
    : workflowAncestorNodeIds(maps, context?.outputNodeId);
  const seedEntries = collectWorkflowSeedEntries(workflow, maps);
  const resources = collectWorkflowResourceEntries(workflow, maps, context);
  const details = collectWorkflowMetadataEntries(workflow, maps);

  for (const node of maps.nodes) {
    if (allowedNodeIds && !allowedNodeIds.has(workflowNodeId(node))) continue;
    const positiveLink = workflowInputLink(node, "positive");
    const negativeLink = workflowInputLink(node, "negative");
    if (positiveLink && negativeLink) {
      const positiveOrigin = workflowLinkOrigin(maps, positiveLink);
      const negativeOrigin = workflowLinkOrigin(maps, negativeLink);
      positives.push(...collectWorkflowNodeTexts(positiveOrigin, maps, new Set(), true, "positive", context));
      negatives.push(...collectWorkflowNodeTexts(negativeOrigin, maps, new Set(), true, "negative", context));
      continue;
    }

    const conditioningLink = workflowInputLink(node, "conditioning");
    if (!conditioningLink || !/guider|guidance/i.test(workflowNodeType(node))) continue;
    const conditioningOrigin = workflowLinkOrigin(maps, conditioningLink);
    positives.push(...collectWorkflowNodeTexts(conditioningOrigin, maps, new Set(), true, "positive", context));
  }

  return {
    seed: formatSeedEntries(seedEntries),
    positive: joinPrompts(positives),
    negative: joinPrompts(negatives),
    resources,
    details,
    source: seedEntries.length || positives.length || negatives.length || resources.length || details.length ? "workflow" : "",
    outputScoped: Boolean(allowedNodeIds),
  };
}

export function workflowSubgraphDefinitions(workflow) {
  return Array.isArray(workflow?.definitions?.subgraphs) ? workflow.definitions.subgraphs : [];
}

export function mergeWorkflowSubgraphDefinitions(primary, fallback) {
  const seen = new Set();
  const results = [];

  for (const subgraph of [...(primary || []), ...(fallback || [])]) {
    const id = String(subgraph?.id || "");
    const key = id || results.length;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(subgraph);
  }

  return results;
}

export function appendWorkflowExtraction(target, result) {
  if (result.seed) target.seeds.push(result.seed);
  if (result.positive) target.positives.push(result.positive);
  if (result.negative) target.negatives.push(result.negative);
  target.resources.push(...(result.resources || []));
  target.details.push(...(result.details || []));
}

function workflowUsedOutputSlots(node, maps, allowedNodeIds) {
  if (!(allowedNodeIds instanceof Set)) return null;

  const slots = new Set();
  (node?.outputs || []).forEach((output, slot) => {
    const linkIds = Array.isArray(output?.links)
      ? output.links
      : output?.links === undefined || output?.links === null
        ? []
        : [output.links];
    const used = linkIds.some((linkId) => (
      (maps.consumerMap.get(String(linkId)) || [])
        .some((consumer) => allowedNodeIds.has(String(consumer.targetId)))
    ));
    if (used) slots.add(slot);
  });

  return slots.size ? slots : null;
}

function workflowSubgraphOutputLinkIds(subgraph, outputSlots) {
  const linkIds = new Set();
  const outputs = Array.isArray(subgraph?.outputs) ? subgraph.outputs : [];
  const selectedSlots = outputSlots instanceof Set && outputSlots.size
    ? outputSlots
    : new Set(outputs.map((_, slot) => slot));

  for (const slot of selectedSlots) {
    const output = outputs[Number(slot)];
    const outputLinks = Array.isArray(output?.linkIds)
      ? output.linkIds
      : output?.linkIds === undefined || output?.linkIds === null
        ? []
        : [output.linkIds];
    for (const linkId of outputLinks) linkIds.add(String(linkId));
  }

  if (linkIds.size) return linkIds;

  for (const link of subgraph?.links || []) {
    const id = Array.isArray(link) ? link[0] : link?.id ?? link?.link_id;
    const targetId = Array.isArray(link) ? link[3] : link?.target_id ?? link?.targetId ?? link?.to_node_id;
    const targetSlot = Array.isArray(link) ? link[4] : link?.target_slot ?? link?.targetSlot ?? link?.to_slot ?? link?.to_socket;
    if (id === undefined || String(targetId) !== "-20") continue;
    if (outputSlots instanceof Set && outputSlots.size && !outputSlots.has(Number(targetSlot))) continue;
    linkIds.add(String(id));
  }

  return linkIds;
}

function workflowSubgraphAncestorNodeIds(subgraph, outputSlots, scopeKey) {
  const maps = buildWorkflowMaps(subgraph, scopeKey);
  const ancestors = new Set();

  for (const linkId of workflowSubgraphOutputLinkIds(subgraph, outputSlots)) {
    const origin = workflowLinkOrigin(maps, linkId);
    const branchAncestors = workflowAncestorNodeIds(maps, origin?.originId);
    for (const nodeId of branchAncestors || []) ancestors.add(nodeId);
  }

  return ancestors.size ? ancestors : null;
}

export function extractFromWorkflowDefinitions(workflow, context = null, availableSubgraphs = null, visited = new Set()) {
  const subgraphs = mergeWorkflowSubgraphDefinitions(
    workflowSubgraphDefinitions(workflow),
    availableSubgraphs,
  );
  if (!subgraphs.length) return {};

  const parentMaps = buildWorkflowMaps(workflow, context?.scopeKey || "root");
  const allowedParentNodeIds = context?.allowedNodeIds instanceof Set
    ? context.allowedNodeIds
    : workflowAncestorNodeIds(parentMaps, context?.outputNodeId);
  const collected = {
    seeds: [],
    positives: [],
    negatives: [],
    resources: [],
    details: [],
  };

  for (const subgraph of subgraphs) {
    const subgraphId = String(subgraph?.id || "");
    if (!subgraphId || visited.has(subgraphId)) continue;

    const parentNodes = parentMaps.nodes.filter((node) => (
      workflowNodeType(node) === subgraphId
      && (!allowedParentNodeIds || allowedParentNodeIds.has(workflowNodeId(node)))
    ));
    if (!parentNodes.length) continue;

    for (const parentNode of parentNodes) {
      const childScopeKey = `${parentMaps.scopeKey}/subgraph:${subgraphId}@${workflowNodeId(parentNode)}`;
      const outputSlots = workflowUsedOutputSlots(parentNode, parentMaps, allowedParentNodeIds);
      const childContext = {
        externalNode: parentNode,
        externalMaps: parentMaps,
        parentContext: context,
        scopeKey: childScopeKey,
        allowedNodeIds: workflowSubgraphAncestorNodeIds(subgraph, outputSlots, childScopeKey),
      };
      const nextVisited = new Set(visited);
      nextVisited.add(subgraphId);

      appendWorkflowExtraction(collected, extractFromWorkflowGraph(subgraph, childContext));
      appendWorkflowExtraction(
        collected,
        extractFromWorkflowDefinitions(subgraph, childContext, subgraphs, nextVisited),
      );
    }
  }

  return {
    seed: uniqueNonEmpty(collected.seeds).join("\n"),
    positive: joinPrompts(collected.positives),
    negative: joinPrompts(collected.negatives),
    resources: formatResourceEntries(collected.resources),
    details: collected.details,
    source: collected.seeds.length || collected.positives.length || collected.negatives.length || collected.resources.length || collected.details.length ? "workflow" : "",
    outputScoped: Boolean(allowedParentNodeIds),
  };
}
