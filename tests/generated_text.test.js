import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERATED_TEXT_MAX_LENGTH,
  GENERATED_TEXT_MAX_UNREFERENCED_PROMPTS,
  GENERATED_TEXT_STORAGE_KEY,
} from "../web/js/media_feed/constants.js";
import { installGeneratedText } from "../web/js/media_feed/generated_text.js";
import { installViewerSupport } from "../web/js/media_feed/viewer_support.js";

function createContext({ items = [] } = {}) {
  const context = {
    state: { items },
    runtime: { generatedTexts: new Map() },
    actions: {},
  };
  installGeneratedText(context);
  return context;
}

function withSessionStorage(callback) {
  const originalWindow = globalThis.window;
  const values = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => (values.has(key) ? values.get(key) : null),
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  };
  try {
    return callback(values);
  } finally {
    globalThis.window = originalWindow;
  }
}

test("only node text output is recorded, per prompt and node", () => withSessionStorage(() => {
  const { actions } = createContext();

  assert.equal(actions.recordGeneratedText("p1", 3, { images: [{ filename: "a.png" }] }), false);
  assert.equal(actions.recordGeneratedText("p1", 3, { text: ["  "] }), false);
  assert.equal(actions.recordGeneratedText("", 3, { text: ["x"] }), false);
  assert.equal(actions.recordGeneratedText("p1", 7, { text: ["first", ["second"], 5] }), true);
  assert.equal(actions.recordGeneratedText("p1", 9, { text: "plain" }), true);

  assert.deepEqual(actions.generatedTextsForPrompt("p1"), [
    { nodeId: "7", text: "first\n\nsecond" },
    { nodeId: "9", text: "plain" },
  ]);
  assert.deepEqual(actions.generatedTextsForPrompt("other"), []);

  actions.recordGeneratedText("p1", 7, { text: ["rerun"] });
  assert.equal(actions.generatedTextsForPrompt("p1")[0].text, "rerun");
}));

test("recorded text stays bounded", () => withSessionStorage(() => {
  const items = [{ promptId: "kept" }];
  const { actions, runtime } = createContext({ items });

  actions.recordGeneratedText("kept", 1, { text: ["x".repeat(GENERATED_TEXT_MAX_LENGTH + 500)] });
  const [entry] = actions.generatedTextsForPrompt("kept");
  assert.ok(entry.text.length < GENERATED_TEXT_MAX_LENGTH + 100);
  assert.match(entry.text, /truncated\)$/);

  for (let index = 0; index < GENERATED_TEXT_MAX_UNREFERENCED_PROMPTS + 10; index++) {
    actions.recordGeneratedText(`text-only-${index}`, 1, { text: ["x"] });
  }
  assert.equal(runtime.generatedTexts.size, GENERATED_TEXT_MAX_UNREFERENCED_PROMPTS + 1);
  assert.ok(runtime.generatedTexts.has("kept"), "text of a prompt still in the feed is kept");
  assert.ok(!runtime.generatedTexts.has("text-only-0"));

  for (let index = 0; index < 30; index++) {
    actions.recordGeneratedText(`large-${index}`, 1, { text: ["y".repeat(GENERATED_TEXT_MAX_LENGTH)] });
  }
  const total = [...runtime.generatedTexts.values()]
    .flatMap((nodes) => [...nodes.values()])
    .reduce((sum, value) => sum + value.text.length, 0);
  assert.ok(total <= 400000);
  assert.ok(runtime.generatedTexts.has("large-29"));
}));

test("recorded text survives a reload and is cleared with the feed", () => withSessionStorage((values) => {
  const first = createContext();
  first.actions.recordGeneratedText("p1", 7, { text: ["enhanced prompt"] });

  const second = createContext();
  second.actions.loadSessionGeneratedText();
  assert.deepEqual(second.actions.generatedTextsForPrompt("p1"), [
    { nodeId: "7", text: "enhanced prompt" },
  ]);

  second.actions.clearGeneratedTexts();
  assert.deepEqual(second.actions.generatedTextsForPrompt("p1"), []);
  assert.equal(values.has(GENERATED_TEXT_STORAGE_KEY), false);

  values.set(GENERATED_TEXT_STORAGE_KEY, JSON.stringify({
    version: 1,
    prompts: [["ok", [{ nodeId: "1", text: "fine" }, { nodeId: 2, text: "bad id" }, { nodeId: "3", text: 4 }]], "junk", [5, []]],
  }));
  const third = createContext();
  third.actions.loadSessionGeneratedText();
  assert.deepEqual([...third.runtime.generatedTexts.keys()], ["ok"]);
  assert.deepEqual(third.actions.generatedTextsForPrompt("ok"), [{ nodeId: "1", text: "fine" }]);

  values.set(GENERATED_TEXT_STORAGE_KEY, "{not json");
  third.actions.loadSessionGeneratedText();
  assert.equal(third.runtime.generatedTexts.size, 0);
}));

test("copy all places generated text after the negative prompt", () => {
  const context = { runtime: {}, actions: {} };
  installViewerSupport(context);
  const text = context.actions.formatAllViewerMetadata(
    { positive: "cat", negative: "blurry", seed: "42" },
    [],
    [{ nodeId: "7", text: "a cinematic cat" }, { nodeId: "9", text: "second" }],
  );
  assert.equal(text, "Prompt:\ncat\n\nNegative Prompt:\nblurry\n\nGenerated Text:\na cinematic cat\n\nsecond\n\nSeed:\n42");
  assert.equal(context.actions.formatAllViewerMetadata({ positive: "cat" }, []), "Prompt:\ncat");
});
