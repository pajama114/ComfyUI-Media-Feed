export function displayEntries(items, batchMode) {
  if (!batchMode) return items;

  const entries = [];
  const batches = new Map();
  for (const item of items) {
    const promptId = String(item.promptId || "");
    if (!promptId) {
      entries.push(item);
      continue;
    }
    let batch = batches.get(promptId);
    if (!batch) {
      batch = { id: `batch:${promptId}`, key: `batch:${promptId}`, kind: "batch", promptId, items: [] };
      batches.set(promptId, batch);
      entries.push(batch);
    }
    batch.items.unshift(item);
  }
  return entries;
}

export function entrySignature(entry) {
  return entry.kind === "batch" ? entry.items.map((item) => item.id).join("|") : entry.id;
}
