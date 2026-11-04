import { mediaFeedBaseStyles } from "./styles/base.js";
import { mediaFeedFeedStyles } from "./styles/feed.js";
import { mediaFeedCompactStyles } from "./styles/compact.js";
import { mediaFeedViewerStyles } from "./styles/viewer.js";

const THEME_ATTRIBUTE = "data-cmf-theme";

export function ensureMediaFeedStyles(options) {
  if (document.getElementById("comfy-media-feed-styles")) return;

  const style = document.createElement("style");
  style.id = "comfy-media-feed-styles";
  style.textContent = `${mediaFeedBaseStyles(options)}${mediaFeedFeedStyles}${mediaFeedCompactStyles}${mediaFeedViewerStyles}`;
  document.head.appendChild(style);
  watchMediaFeedTheme();
}

// ComfyUI's dark-mode class differs between versions (and custom palettes may
// omit it), so classify the theme from the actual menu background brightness.
export function parseCssColorLuminance(color) {
  const match = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?/i.exec(color || "");
  if (!match) return null;
  const alpha = match[4] === undefined
    ? 1
    : match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
  if (!(alpha > 0)) return null;
  const [r, g, b] = [match[1], match[2], match[3]].map((value) => {
    const channel = Math.min(255, parseFloat(value)) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function detectMediaFeedTheme() {
  if (!document.body) return null;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;width:0;height:0;visibility:hidden;pointer-events:none;" +
    "background-color:var(--comfy-menu-bg, var(--bg-color, #131418))";
  document.body.appendChild(probe);
  const luminance = parseCssColorLuminance(getComputedStyle(probe).backgroundColor);
  probe.remove();
  if (luminance === null) return null;
  return luminance > 0.4 ? "light" : "dark";
}

function syncMediaFeedTheme() {
  const theme = detectMediaFeedTheme() || "dark";
  const root = document.documentElement;
  if (root.getAttribute(THEME_ATTRIBUTE) !== theme) root.setAttribute(THEME_ATTRIBUTE, theme);
}

function watchMediaFeedTheme() {
  syncMediaFeedTheme();
  if (typeof MutationObserver !== "function") return;

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncMediaFeedTheme();
    });
  };
  const observer = new MutationObserver(schedule);
  const attributes = { attributes: true, attributeFilter: ["class", "style", "data-theme"] };
  observer.observe(document.documentElement, attributes);
  if (document.body) observer.observe(document.body, attributes);
  // Palette changes may also arrive as injected or rewritten <style> elements.
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
}
