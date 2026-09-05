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
  workflowInputIsText,
  isWorkflowTextCarrierNode,
  workflowInputLink,
  buildWorkflowMaps,
  workflowLinkOrigin,
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

export function collectWorkflowNodeTexts(nodeId, maps, visited = new Set(), forceText = false, polarity = "", context = null) {
  if (!nodeId || visited.has(nodeId)) return [];
  visited.add(nodeId);

  const node = maps.nodeMap.get(String(nodeId));
  if (!node) return [];
  if (isWorkflowSystemNode(node) || isWorkflowConditioningZeroNode(node)) return [];
  if (isWorkflowTextGenerationNode(node)) return collectWorkflowTextGenerationInputTexts(node, maps, visited, context);

  const texts = [];
  const textCarrier = isWorkflowTextCarrierNode(node);
  const selectedSwitchInputName = workflowSwitchSelectedInputName(maps, node);
  const linkedTextInput = workflowNodeHasLinkedTextInput(node);
  if ((forceText || textCarrier) && !linkedTextInput) {
    const directTexts = workflowTextInputs(node)
      .flatMap((input) => collectWidgetStringValues(workflowInputValue(node, input)));
    texts.push(...(directTexts.length ? directTexts : collectWidgetStringValues(node.widgets_values || [])));
  }

  for (const input of node.inputs || []) {
    if (selectedSwitchInputName && input.name !== selectedSwitchInputName) continue;

    const isTextInput = workflowInputIsText(input, node);
    if (input?.link === undefined || input?.link === null) {
      if ((forceText || textCarrier) && isTextInput) {
        texts.push(...collectWidgetStringValues(workflowInputValue(node, input)));
      }
      continue;
    }
    if (textCarrier && !isTextInput && !isWorkflowTextPassthroughNode(node)) continue;

    if (
      polarity
      && workflowNodeHasPolarityInputs(node)
      && input.name !== polarity
    ) {
      continue;
    }

    const origin = workflowLinkOrigin(maps, input.link);
    if (!origin) continue;
    if (isWorkflowSubgraphInputOrigin(origin)) {
      texts.push(...collectWorkflowExternalInputTexts(origin, maps, new Set(visited), context));
      continue;
    }

    const nextPolarity = origin.outputName === "positive" || origin.outputName === "negative"
      ? origin.outputName
      : polarity;
    const nextForceText = isTextInput || Boolean(selectedSwitchInputName) || (textCarrier && isWorkflowTextPassthroughNode(node));
    texts.push(...collectWorkflowNodeTexts(origin.originId, maps, visited, nextForceText, nextPolarity, context));
  }

  return uniqueNonEmpty(texts);
}

export function extractFromWorkflowGraph(workflow, context = null) {
  if (!workflow || typeof workflow !== "object") return {};

  const maps = buildWorkflowMaps(workflow);
  const positives = [];
  const negatives = [];
  const seedEntries = collectWorkflowSeedEntries(workflow, maps);
  const resources = collectWorkflowResourceEntries(workflow, maps, context);
  const details = collectWorkflowMetadataEntries(workflow, maps);

  for (const node of maps.nodes) {
    const positiveLink = workflowInputLink(node, "positive");
    const negativeLink = workflowInputLink(node, "negative");
    if (positiveLink && negativeLink) {
      const positiveOrigin = workflowLinkOrigin(maps, positiveLink);
      const negativeOrigin = workflowLinkOrigin(maps, negativeLink);
      positives.push(...collectWorkflowNodeTexts(positiveOrigin?.originId, maps, new Set(), true, "positive", context));
      negatives.push(...collectWorkflowNodeTexts(negativeOrigin?.originId, maps, new Set(), true, "negative", context));
      continue;
    }

    const conditioningLink = workflowInputLink(node, "conditioning");
    if (!conditioningLink || !/guider|guidance/i.test(workflowNodeType(node))) continue;
    const conditioningOrigin = workflowLinkOrigin(maps, conditioningLink);
    positives.push(...collectWorkflowNodeTexts(conditioningOrigin?.originId, maps, new Set(), true, "positive", context));
  }

  return {
    seed: formatSeedEntries(seedEntries),
    positive: joinPrompts(positives),
    negative: joinPrompts(negatives),
    resources,
    details,
    source: seedEntries.length || positives.length || negatives.length || resources.length || details.length ? "workflow" : "",
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

export function extractFromWorkflowDefinitions(workflow, context = null, availableSubgraphs = null, visited = new Set()) {
  const subgraphs = mergeWorkflowSubgraphDefinitions(
    workflowSubgraphDefinitions(workflow),
    availableSubgraphs,
  );
  if (!subgraphs.length) return {};

  const parentMaps = buildWorkflowMaps(workflow);
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

    const parentNodes = parentMaps.nodes.filter((node) => workflowNodeType(node) === subgraphId);
    if (!parentNodes.length) continue;

    for (const parentNode of parentNodes) {
      const childContext = {
        externalNode: parentNode,
        externalMaps: parentMaps,
        parentContext: context,
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
  };
}
