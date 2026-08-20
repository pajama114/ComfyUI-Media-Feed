import { decodeUtf8, findJsonMetadataObject } from "./shared.js";

export function parseWebmTextMetadata(bytes) {
  const chunks = {};
  const text = decodeUtf8(bytes);
  const parsed = findJsonMetadataObject(text);
  if (!parsed) return chunks;

  chunks.embedded_json = parsed;
  if (parsed.prompt !== undefined) chunks.prompt = parsed.prompt;
  if (parsed.workflow !== undefined) chunks.workflow = parsed.workflow;
  if (parsed.Prompt !== undefined) chunks.Prompt = parsed.Prompt;
  if (parsed.Workflow !== undefined) chunks.Workflow = parsed.Workflow;
  return chunks;
}
