import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createMediaFeedExtension } from "../web/js/media_feed/extension.js";

const LOCALES = ["en", "ja", "zh", "zh-TW", "ko", "fr", "de"];

function loadLocaleFile(locale, filename) {
  return JSON.parse(fs.readFileSync(new URL(`../locales/${locale}/${filename}`, import.meta.url), "utf8"));
}

function createSettings() {
  const actions = new Proxy({}, {
    get() {
      return () => undefined;
    },
  });
  return createMediaFeedExtension({ api: {}, runtime: {}, actions }).settings;
}

test("every locale covers all registered Media Feed settings", () => {
  const registeredSettings = createSettings();

  for (const locale of LOCALES) {
    const { settingsCategories } = loadLocaleFile(locale, "main.json");
    const translations = loadLocaleFile(locale, "settings.json");

    for (const setting of registeredSettings) {
      const translationKey = setting.id.replaceAll(".", "_");
      const translation = translations[translationKey];
      assert.ok(translation, `${locale} is missing ${translationKey}`);
      assert.ok(translation.name, `${locale} is missing the name for ${translationKey}`);
      if (setting.tooltip) {
        assert.ok(translation.tooltip, `${locale} is missing the tooltip for ${translationKey}`);
      }

      for (const category of setting.category) {
        assert.ok(settingsCategories[category], `${locale} is missing the ${category} category`);
      }

      for (const option of setting.options ?? []) {
        assert.ok(translation.options?.[option.text], `${locale} is missing the ${option.text} option for ${translationKey}`);
        assert.ok(translation.options?.[option.value], `${locale} is missing the legacy ${option.value} option for ${translationKey}`);
      }
    }
  }
});

test("English locale fallbacks stay synchronized with registered setting text", () => {
  const translations = loadLocaleFile("en", "settings.json");

  for (const setting of createSettings()) {
    const translation = translations[setting.id.replaceAll(".", "_")];
    assert.equal(translation.name, setting.name);
    assert.equal(translation.tooltip, setting.tooltip);
    for (const option of setting.options ?? []) {
      assert.equal(translation.options[option.text], option.text);
    }
  }
});
