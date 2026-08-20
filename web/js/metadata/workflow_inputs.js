export function workflowInputValue(node, input) {
  if (!node || !input) return undefined;
  if (input.link !== undefined && input.link !== null) return undefined;

  const directValue = input.value ?? input.default ?? input.widget?.value;
  if (directValue !== undefined) return directValue;

  const widgetName = input.widget?.name || input.name;
  const widgetsValues = node.widgets_values;
  if (widgetsValues && typeof widgetsValues === "object" && !Array.isArray(widgetsValues)) {
    if (Object.prototype.hasOwnProperty.call(widgetsValues, widgetName)) return widgetsValues[widgetName];
    if (Object.prototype.hasOwnProperty.call(widgetsValues, input.name)) return widgetsValues[input.name];
  }

  if (!Array.isArray(widgetsValues) || !input.widget) return undefined;

  const nodeType = String(node?.type || node?.class_type || "");
  if (/^KSampler$/i.test(nodeType)) {
    const samplerIndexes = {
      seed: 0,
      steps: 2,
      cfg: 3,
      sampler_name: 4,
      scheduler: 5,
      denoise: 6,
    };
    const index = samplerIndexes[widgetName] ?? samplerIndexes[input.name];
    if (index !== undefined) return widgetsValues[index];
  }

  if (/^RandomNoise$/i.test(nodeType) && (widgetName === "noise_seed" || input.name === "noise_seed")) {
    return widgetsValues[0];
  }

  let widgetIndex = -1;
  for (const current of node.inputs || []) {
    if (current?.widget) widgetIndex++;
    if (current === input) return widgetsValues[widgetIndex];
  }

  return undefined;
}

export function workflowInputWidgetValue(node, input) {
  if (!node || !input) return undefined;

  const directValue = input.value ?? input.default ?? input.widget?.value;
  if (directValue !== undefined) return directValue;

  const widgetName = input.widget?.name || input.name;
  const widgetsValues = node.widgets_values;
  if (widgetsValues && typeof widgetsValues === "object" && !Array.isArray(widgetsValues)) {
    if (Object.prototype.hasOwnProperty.call(widgetsValues, widgetName)) return widgetsValues[widgetName];
    if (Object.prototype.hasOwnProperty.call(widgetsValues, input.name)) return widgetsValues[input.name];
  }

  if (!Array.isArray(widgetsValues) || !input.widget) return undefined;

  let widgetIndex = -1;
  for (const current of node.inputs || []) {
    if (current?.widget) widgetIndex++;
    if (current === input) return widgetsValues[widgetIndex];
  }

  return undefined;
}
