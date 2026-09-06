import { parseJsonMetadata } from "../metadata_parsers.js";
import {
  formatMetadataEntries,
  formatResourceEntries,
  mergeResourceEntriesByLabel,
  mergeMetadataDetailsByLabel,
  extractFromLooseMetadata,
} from "./format.js";
import {
  extractFromPromptGraph,
} from "./prompt_graph.js";
import {
  extractFromWorkflowGraph,
  extractFromWorkflowDefinitions,
} from "./workflow_graph.js";

export function extractPromptMetadata(chunks, context = null) {
  const workflow = parseJsonMetadata(chunks.workflow || chunks.Workflow);
  const prompt = parseJsonMetadata(chunks.prompt || chunks.Prompt) || parseJsonMetadata(workflow?.extra?.prompt);
  const fromChunks = extractFromLooseMetadata(chunks);
  const fromPrompt = extractFromPromptGraph(prompt, context);
  const fromWorkflow = extractFromWorkflowGraph(workflow, context);
  const fromDefinitions = extractFromWorkflowDefinitions(workflow, context);
  const graphSources = [fromPrompt, fromWorkflow, fromDefinitions];
  const scopedGraphSources = graphSources.filter((source) => source.outputScoped);
  const promptSources = scopedGraphSources.length ? scopedGraphSources : graphSources;
  const seed = fromPrompt.seed || fromWorkflow.seed || fromDefinitions.seed || fromChunks.seed || "";
  const positive = promptSources.find((source) => source.positive)?.positive || "";
  const negative = promptSources.find((source) => source.negative)?.negative || "";
  const workflowResources = formatResourceEntries([
    ...(fromWorkflow.resources || []),
    ...(fromDefinitions.resources || []),
  ]);
  const resources = mergeResourceEntriesByLabel(fromPrompt.resources || [], workflowResources);
  const graphDetails = mergeMetadataDetailsByLabel(
    mergeMetadataDetailsByLabel(fromPrompt.details || [], fromWorkflow.details || []),
    fromDefinitions.details || [],
  );
  const details = formatMetadataEntries([
    ...graphDetails,
    ...(fromChunks.details || []),
  ]);
  const embeddedJson = collectEmbeddedJson(chunks);
  const found = seed
    || positive
    || negative
    || resources.length
    || details.length
    || Object.keys(embeddedJson).length;

  return {
    seed,
    positive,
    negative,
    resources,
    details,
    embeddedJson,
    status: found ? "" : "No prompt or seed metadata found in embedded metadata.",
    requiresFullScan: false,
  };
}

function collectEmbeddedJson(chunks) {
  const entries = Object.create(null);
  const seenValues = new Set();

  for (const [key, value] of Object.entries(chunks || {})) {
    const parsed = parseJsonMetadata(value);
    if (!parsed || typeof parsed !== "object") continue;

    let serialized;
    try {
      serialized = JSON.stringify(parsed);
    } catch {
      continue;
    }
    if (!serialized || seenValues.has(serialized)) continue;

    seenValues.add(serialized);
    entries[String(key)] = parsed;

    for (const child of Object.values(parsed)) {
      if (!child || typeof child !== "object") continue;
      try {
        seenValues.add(JSON.stringify(child));
      } catch {
        // The parent value is still safe to include if an unusual child cannot be serialized alone.
      }
    }
  }

  return entries;
}
