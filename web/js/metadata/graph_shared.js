export function collectStringValues(value, results = []) {
  if (typeof value === "string" && value.trim()) {
    results.push(value);
  } else if (Array.isArray(value)) {
    for (const child of value) collectStringValues(child, results);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectStringValues(child, results);
  }

  return results;
}

export function widgetValueHasActivationState(value) {
  if (Array.isArray(value)) return value.some((child) => widgetValueHasActivationState(child));
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "active"));
}

export function collectWidgetStringValues(value, results = []) {
  if (typeof value === "string" && value.trim()) {
    results.push(value);
  } else if (Array.isArray(value)) {
    const hasActivationState = widgetValueHasActivationState(value);
    for (const child of value) {
      if (hasActivationState && typeof child === "string") continue;
      collectWidgetStringValues(child, results);
    }
  } else if (value && typeof value === "object") {
    if (value.active === false) return results;

    if (typeof value.text === "string" && value.text.trim()) {
      results.push(value.text);
      return results;
    }

    for (const [key, child] of Object.entries(value)) {
      if (/^(items?|children|values?)$/i.test(key)) collectWidgetStringValues(child, results);
    }
  }

  return results;
}

export function isSystemPromptLabel(label) {
  return /(^|[^a-z])system\s*prompt([^a-z]|$)/i.test(String(label || ""));
}

export function isConditioningZeroNodeClass(nodeClass) {
  return /conditioning.*zero|zero.*conditioning|zeroout/i.test(String(nodeClass || ""));
}

export function preferredUserInputNames(entries) {
  const userNamed = entries
    .filter(([name]) => /(^|[_\s-])user([_\s-]|$)|user.*prompt|prompt.*user/i.test(name))
    .map(([name]) => name);
  if (userNamed.length) return userNamed;

  const secondInputs = entries
    .filter(([name]) => /(^|[_\s-])(string|text|prompt)?_?b$|^b$/i.test(name))
    .map(([name]) => name);
  if (secondInputs.length) return secondInputs;

  return [];
}

