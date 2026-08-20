import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAudioTextMetadata,
  parseGifTextMetadata,
  parseJsonMetadata,
  parseMp4TextMetadata,
  parsePngTextChunks,
  parseWebmTextMetadata,
} from "../web/js/metadata_parsers.js";
import {
  bytes,
  flacComments,
  gifComment,
  mp3Text,
  opusComments,
  pngText,
  promptGraph,
} from "./helpers/metadata_fixtures.js";

test("parseJsonMetadata accepts objects and valid JSON only", () => {
  const object = { prompt: "kept" };
  assert.equal(parseJsonMetadata(object), object);
  assert.deepEqual(parseJsonMetadata('{"seed":42}'), { seed: 42 });
  assert.equal(parseJsonMetadata("not json"), null);
  assert.equal(parseJsonMetadata(""), null);
});

test("PNG tEXt chunks preserve prompt and workflow strings", async () => {
  const prompt = JSON.stringify(promptGraph);
  const workflow = JSON.stringify({ nodes: [] });
  assert.deepEqual(await parsePngTextChunks(pngText({ prompt, workflow })), { prompt, workflow });
  assert.deepEqual(await parsePngTextChunks(bytes("not a png")), {});
});

test("GIF comments recover embedded prompt objects", () => {
  const document = { prompt: promptGraph, workflow: { nodes: [] } };
  const result = parseGifTextMetadata(gifComment(JSON.stringify(document)));
  assert.deepEqual(result.prompt, promptGraph);
  assert.deepEqual(result.workflow, { nodes: [] });
  assert.equal(result.gif_comment_1, JSON.stringify(document));
});

test("MP4 and WebM scans recover JSON surrounded by binary data", () => {
  const document = { prompt: promptGraph, workflow: { nodes: [] } };
  const payload = bytes(`binary-prefix\0${JSON.stringify(document)}\0binary-suffix`);

  const mp4 = parseMp4TextMetadata(payload);
  const webm = parseWebmTextMetadata(payload);
  assert.deepEqual(mp4.prompt, promptGraph);
  assert.deepEqual(mp4.workflow, { nodes: [] });
  assert.deepEqual(webm.prompt, promptGraph);
  assert.deepEqual(webm.workflow, { nodes: [] });
});

test("MP3 TXXX metadata maps descriptions to prompt fields", () => {
  const prompt = JSON.stringify(promptGraph);
  const result = parseAudioTextMetadata(mp3Text("prompt", prompt), "mp3");
  assert.equal(result.prompt, prompt);
});

test("FLAC Vorbis comments map case-insensitive prompt fields", () => {
  const prompt = JSON.stringify(promptGraph);
  const result = parseAudioTextMetadata(flacComments({ PROMPT: prompt }), "flac");
  assert.equal(result.PROMPT, prompt);
  assert.equal(result.prompt, prompt);
});

test("Opus tags recover workflow metadata", () => {
  const workflow = JSON.stringify({ nodes: [{ id: 1, type: "Test" }] });
  const result = parseAudioTextMetadata(opusComments({ workflow }), "opus");
  assert.equal(result.workflow, workflow);
});

test("unsupported audio extensions and malformed inputs return empty metadata", () => {
  assert.deepEqual(parseAudioTextMetadata(new Uint8Array(), "wav"), {});
  assert.deepEqual(parseAudioTextMetadata(bytes("not id3"), "mp3"), {});
  assert.deepEqual(parseGifTextMetadata(bytes("not gif")), {});
  assert.deepEqual(parseMp4TextMetadata(new Uint8Array()), {});
  assert.deepEqual(parseWebmTextMetadata(bytes("no embedded json")), {});
});
