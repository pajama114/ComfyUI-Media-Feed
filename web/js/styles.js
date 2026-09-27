import { mediaFeedBaseStyles } from "./styles/base.js";
import { mediaFeedFeedStyles } from "./styles/feed.js";
import { mediaFeedCompactStyles } from "./styles/compact.js";
import { mediaFeedViewerStyles } from "./styles/viewer.js";

export function ensureMediaFeedStyles(options) {
  if (document.getElementById("comfy-media-feed-styles")) return;

  const style = document.createElement("style");
  style.id = "comfy-media-feed-styles";
  style.textContent = `${mediaFeedBaseStyles(options)}${mediaFeedFeedStyles}${mediaFeedCompactStyles}${mediaFeedViewerStyles}`;
  document.head.appendChild(style);
}
