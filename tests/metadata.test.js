import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  clearPromptMetadataCache,
  getCachedPromptMetadata,
  loadPromptMetadata,
} from "../web/js/metadata.js";
import {
  bytes,
  pngText,
  promptGraph,
  rangeResponse,
  workflowGraph,
} from "./helpers/metadata_fixtures.js";

const originalFetch = globalThis.fetch;
const debugAnimaWorkflow = JSON.parse(readFileSync(
  new URL("./fixtures/workflows/DEBUG_anima_base_v1.json", import.meta.url),
  "utf8",
));
const debugMinimaxVideoWorkflow = JSON.parse(readFileSync(
  new URL("./fixtures/workflows/DEBUG_minimax_h3_t2v.json", import.meta.url),
  "utf8",
));
let itemSequence = 0;

function mediaItem(filename = "test.png") {
  const id = `test-item-${++itemSequence}`;
  return { id, key: id, filename, url: `https://example.invalid/${id}/${filename}` };
}

function workflowWithLinkedExternalSubgraphPrompt() {
  const subgraphId = "external-prompt-subgraph";
  const promptInput = {
    name: "text",
    type: "STRING",
    widget: { name: "text" },
    link: 20,
  };
  const parentNodes = [
    {
      id: 99,
      type: "PrimitiveNode",
      inputs: [],
      outputs: [{ name: "STRING", type: "STRING", links: [20] }],
      widgets_values: ["linked subgraph prompt"],
    },
    {
      id: 100,
      type: subgraphId,
      inputs: [promptInput],
      widgets_values: [],
    },
  ];

  return {
    nodes: parentNodes,
    links: [[20, 99, 0, 100, 0, "STRING"]],
    definitions: {
      subgraphs: [{
        id: subgraphId,
        inputs: [{ name: "text", type: "STRING" }],
        nodes: [
          {
            id: 1,
            type: "KSampler",
            inputs: [
              { name: "positive", link: 10 },
              { name: "negative", link: 11 },
              { name: "seed", widget: { name: "seed" }, link: null },
            ],
            widgets_values: [777, "fixed"],
          },
          {
            id: 2,
            type: "CLIPTextEncode",
            inputs: [{ name: "text", type: "STRING", link: 12 }],
            outputs: [{ name: "CONDITIONING", type: "CONDITIONING", links: [10] }],
          },
          {
            id: 3,
            type: "CLIPTextEncode",
            inputs: [{ name: "text", type: "STRING", widget: { name: "text" }, link: null }],
            outputs: [{ name: "CONDITIONING", type: "CONDITIONING", links: [11] }],
            widgets_values: ["negative prompt"],
          },
        ],
        links: [
          [10, 2, 0, 1, 0, "CONDITIONING"],
          [11, 3, 0, 1, 1, "CONDITIONING"],
          [12, -10, 0, 2, 0, "STRING"],
        ],
      }],
    },
  };
}

function formattedTextGenerationPromptGraph() {
  return {
    1: {
      class_type: "BasicGuider",
      inputs: { conditioning: [2, 0] },
    },
    2: {
      class_type: "MiniMaxH3ReferenceToVideo",
      inputs: { prompt: [3, 0] },
    },
    3: {
      class_type: "AdvancedMultimodalTextGenerator",
      inputs: {
        system_prompt: [4, 0],
        user_prompt: [5, 0],
      },
    },
    4: {
      class_type: "PrimitiveStringMultiline",
      inputs: { value: "system instructions" },
    },
    5: {
      class_type: "StringFormat",
      inputs: {
        "values.a": [6, 0],
        "values.b": [7, 0],
        "values.c": [8, 0],
        f_string: "{a}\n{c}\nVideo Duration: {b} seconds",
      },
    },
    6: {
      class_type: "PrimitiveStringMultiline",
      inputs: { value: "actual user prompt" },
    },
    7: {
      class_type: "PrimitiveFloat",
      inputs: { value: 9 },
    },
    8: {
      class_type: "SimplePreset",
      inputs: { selected_presets: "[]" },
    },
  };
}

function formattedTextGenerationWorkflow() {
  return {
    nodes: [
      {
        id: 1,
        type: "BasicGuider",
        inputs: [{ name: "conditioning", type: "CONDITIONING", link: 10 }],
      },
      {
        id: 2,
        type: "MiniMaxH3ReferenceToVideo",
        inputs: [{ name: "prompt", type: "STRING", link: 11 }],
        outputs: [{ name: "positive", type: "CONDITIONING", links: [10] }],
      },
      {
        id: 3,
        type: "AdvancedMultimodalTextGenerator",
        inputs: [
          { name: "system_prompt", type: "STRING", link: 12 },
          { name: "user_prompt", type: "STRING", link: 13 },
        ],
        outputs: [{ name: "generated_text", type: "STRING", links: [11] }],
      },
      {
        id: 4,
        type: "SimplePreset",
        inputs: [],
        outputs: [{ name: "prompt", type: "STRING", links: [12] }],
        widgets_values: ["[\"system-profile-id\"]"],
      },
      {
        id: 5,
        type: "StringFormat",
        inputs: [
          { name: "values.a", type: "*", link: 14 },
          { name: "values.b", type: "*", link: 15 },
          { name: "values.c", type: "*", link: 16 },
          { name: "f_string", type: "STRING", widget: { name: "f_string" }, link: null },
        ],
        outputs: [{ name: "STRING", type: "STRING", links: [13] }],
        widgets_values: ["{a}\n{c}\nVideo Duration: {b} seconds"],
      },
      {
        id: 6,
        type: "PrimitiveStringMultiline",
        inputs: [],
        outputs: [{ name: "STRING", type: "STRING", links: [14] }],
        widgets_values: ["actual user prompt"],
      },
      {
        id: 7,
        type: "PrimitiveFloat",
        inputs: [],
        outputs: [{ name: "FLOAT", type: "FLOAT", links: [15] }],
        widgets_values: [9],
      },
      {
        id: 8,
        type: "SimplePreset",
        inputs: [],
        outputs: [{ name: "prompt", type: "STRING", links: [16] }],
        properties: { simple_preset_profile_id: "default" },
        widgets_values: ["[]"],
        widgets_values_named: { selected_presets: "[]" },
      },
    ],
    links: [
      [10, 2, 0, 1, 0, "CONDITIONING"],
      [11, 3, 0, 2, 0, "STRING"],
      [12, 4, 0, 3, 0, "STRING"],
      [13, 5, 0, 3, 1, "STRING"],
      [14, 6, 0, 5, 0, "STRING"],
      [15, 7, 0, 5, 1, "FLOAT"],
      [16, 8, 0, 5, 2, "STRING"],
    ],
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  clearPromptMetadataCache();
});

test("loadPromptMetadata extracts prompt graph values through a Range request", async () => {
  const payload = pngText({ prompt: JSON.stringify(promptGraph) });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return rangeResponse(payload);
  };

  const item = mediaItem();
  const result = await loadPromptMetadata(item);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, item.url);
  assert.equal(requests[0].options.headers.Range, "bytes=0-4194303");
  assert.equal(result.seed, "123456");
  assert.equal(result.positive, "a red fox");
  assert.equal(result.negative, "blurry");
  assert.ok(result.resources.some((entry) => entry.value === "example.safetensors"));
  assert.equal(result.requiresFullScan, false);
});

test("loadPromptMetadata extracts workflow graph values", async () => {
  const payload = pngText({ workflow: JSON.stringify(workflowGraph) });
  globalThis.fetch = async () => rangeResponse(payload);

  const result = await loadPromptMetadata(mediaItem());

  assert.equal(result.seed, "654321");
  assert.equal(result.positive, "a blue bird");
  assert.equal(result.negative, "low quality");
  assert.ok(result.resources.some((entry) => entry.value === "workflow.safetensors"));
});

test("loadPromptMetadata follows workflow subgraph definitions", async () => {
  const workflow = {
    nodes: [{ id: 100, type: "media-feed-subgraph", inputs: [], widgets_values: [] }],
    links: [],
    definitions: {
      subgraphs: [{ id: "media-feed-subgraph", ...workflowGraph }],
    },
  };
  const payload = pngText({ workflow: JSON.stringify(workflow) });
  globalThis.fetch = async () => rangeResponse(payload);

  const result = await loadPromptMetadata(mediaItem());

  assert.equal(result.seed, "654321");
  assert.equal(result.positive, "a blue bird");
  assert.equal(result.negative, "low quality");
  assert.ok(result.resources.some((entry) => entry.value === "workflow.safetensors"));
});

test("loadPromptMetadata infers metadata from the debug Anima subgraph workflow", async () => {
  const payload = pngText({ workflow: JSON.stringify(debugAnimaWorkflow) });
  globalThis.fetch = async () => rangeResponse(payload);

  const result = await loadPromptMetadata(mediaItem());

  assert.equal(result.seed, "755918130909406");
  assert.match(result.positive, /^Anime monochrome cyberpunk front portrait/);
  assert.equal(result.negative, "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia");
  assert.ok(result.resources.some((entry) => entry.value === "anima-base-v1.0.safetensors"));
  assert.equal(result.status, "");
});

test("loadPromptMetadata infers metadata from the debug MiniMax video workflow", async () => {
  const document = JSON.stringify({ workflow: debugMinimaxVideoWorkflow });
  const payload = bytes(`mp4-prefix\0${document}\0mp4-suffix`);
  globalThis.fetch = async () => rangeResponse(payload);

  const result = await loadPromptMetadata(mediaItem("test.mp4"));

  assert.equal(result.seed, "757358688076805");
  assert.match(result.positive, /^Realistic live-action cinematic look/);
  assert.equal(result.negative, "");
  assert.ok(result.resources.some((entry) => entry.value === "minimax_h3_fl2va_pruned_int8_convrot.safetensors"));
  assert.equal(result.status, "");
});

test("loadPromptMetadata follows linked external subgraph prompt inputs", async () => {
  const workflow = workflowWithLinkedExternalSubgraphPrompt();
  const payload = pngText({ workflow: JSON.stringify(workflow) });
  globalThis.fetch = async () => rangeResponse(payload);

  const result = await loadPromptMetadata(mediaItem());

  assert.equal(result.seed, "777");
  assert.equal(result.positive, "linked subgraph prompt");
  assert.equal(result.negative, "negative prompt");
  assert.equal(result.status, "");
});

test("loadPromptMetadata follows formatted user input in a prompt graph", async () => {
  const payload = pngText({ prompt: JSON.stringify(formattedTextGenerationPromptGraph()) });
  globalThis.fetch = async () => rangeResponse(payload);

  const result = await loadPromptMetadata(mediaItem());

  assert.equal(result.positive, "actual user prompt");
  assert.doesNotMatch(result.positive, /\{[abc]\}|system instructions|\[\]/);
});

test("loadPromptMetadata follows formatted user input in a workflow graph", async () => {
  const payload = pngText({ workflow: JSON.stringify(formattedTextGenerationWorkflow()) });
  globalThis.fetch = async () => rangeResponse(payload);

  const result = await loadPromptMetadata(mediaItem());

  assert.equal(result.positive, "actual user prompt");
  assert.doesNotMatch(result.positive, /\{[abc]\}|system-profile-id|\[\]/);
});

test("a server that ignores Range does not automatically consume a large response", async () => {
  const payload = pngText({ prompt: JSON.stringify(promptGraph) });
  const item = mediaItem();
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (options?.headers?.Range) {
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "Content-Length": String(32 * 1024 * 1024) },
      });
    }
    return new Response(payload, {
      status: 200,
      headers: { "Content-Length": String(payload.length) },
    });
  };

  const initial = await loadPromptMetadata(item);
  assert.equal(initial.requiresFullScan, true);
  assert.match(initial.status, /cannot range-scan/i);
  assert.equal(calls, 1);

  const complete = await loadPromptMetadata(item, { fullScan: true });
  assert.equal(calls, 2);
  assert.equal(complete.positive, "a red fox");
  assert.equal(complete.requiresFullScan, false);
});

test("concurrent and repeated metadata requests share the cache", async () => {
  const payload = pngText({ prompt: JSON.stringify(promptGraph) });
  const item = mediaItem();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    calls++;
    await gate;
    return rangeResponse(payload);
  };

  const first = loadPromptMetadata(item);
  const second = loadPromptMetadata(item);
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.equal(firstResult, secondResult);
  assert.equal(getCachedPromptMetadata(item), firstResult);
  assert.equal(await loadPromptMetadata(item), firstResult);
  assert.equal(calls, 1);

  clearPromptMetadataCache();
  await loadPromptMetadata(item);
  assert.equal(calls, 2);
});

test("unsupported media and missing selections return stable empty results", async () => {
  globalThis.fetch = async () => {
    throw new Error("unsupported media must not be fetched");
  };

  const unsupported = await loadPromptMetadata(mediaItem("preview.jpg"));
  assert.equal(unsupported.requiresFullScan, false);
  assert.match(unsupported.status, /supports PNG/i);

  const missing = await loadPromptMetadata(null);
  assert.equal(missing.status, "No media item selected.");
  assert.deepEqual(missing.resources, []);
  assert.deepEqual(missing.details, []);
});
