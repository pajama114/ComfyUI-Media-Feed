# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Media Feed is a ComfyUI frontend extension that shows generated images, videos,
and audio in a lightweight feed. It is intentionally small and has no runtime
Python dependencies.

## Repository Layout

- `__init__.py` exposes `WEB_DIRECTORY = "./web/js"` and the favorites routes.
- `web/js/media_feed.js` is the small extension composition entrypoint.
- `web/js/media_feed/` contains feed state, settings, cards, virtualization,
  viewer controllers, floating placement, and ComfyUI integration.
- `web/js/icons.js` contains shared inline SVG icons.
- `web/js/metadata.js` is the public embedded metadata API.
- `web/js/metadata/` contains bounded loading, extraction, graph inference, and
  format-specific binary parsers. `web/js/metadata_parsers.js` re-exports the
  parser API for compatibility.
- `web/js/styles.js` installs the styles assembled from `web/js/styles/`.
- `tests/` contains dependency-free Node characterization and unit tests.
- `pyproject.toml` contains Comfy Registry metadata.
- `README.md` is the public user-facing documentation.
- `icon.png` is referenced by `[tool.comfy] Icon`.
- `LICENSE` is MIT.

## Development Rules

- Keep the extension frontend-only unless there is a clear need for backend
  routes or custom nodes.
- Prefer small, focused changes in the existing `web/js/*.js` module that owns
  the behavior being edited.
- Do not add npm, bundler, or Python runtime dependencies without a strong
  reason. ComfyUI loads this file directly as browser JavaScript.
- Preserve compatibility with older ComfyUI frontends: the fallback fixed panel
  matters because some installs do not support bottom-panel tabs.
- Keep UI performance bounded. The feed currently retains 256 items and
  virtualizes visible cards. Do not replace virtualization with a full DOM list.
- Keep media card positions identical between the Default and Frameless feed
  styles for every placement. Hidden chrome and scrollbars must preserve the
  equivalent layout space instead of shifting the media.
- Avoid cache-busting media URLs. Image preview and full-screen view should reuse
  the same `/view` URL where possible.
- Keep embedded metadata scans bounded. Start with Range requests and do not
  automatically download a large file in full; use the viewer's explicit full
  metadata scan only when the initial scan cannot determine the result.
- Preserve the full metadata scan path. Large generated videos may still need a
  complete scan to recover embedded prompt and workflow data.
- Be careful with keyboard handlers. When the viewer is open, arrow keys must not
  leak to the ComfyUI canvas.
- Be careful with focus. Viewer controls should not accidentally trigger ComfyUI
  shortcuts such as Ctrl+Enter.
- Do not commit logs or generated files. `startup.log` is ignored.

## Checks

Run these before committing:

```bash
node --experimental-default-type=module --test tests/*.test.js
node --check web/js/media_feed.js
node --check web/js/icons.js
node --check web/js/metadata.js
node --check web/js/metadata_parsers.js
node --check web/js/styles.js
python -m py_compile __init__.py
python -c "import tomllib; tomllib.load(open('pyproject.toml','rb'))"
git diff --check
```

Remove `__pycache__/` if `py_compile` creates it:

```bash
rm -rf __pycache__
```

## Manual Test Checklist

After browser reload in ComfyUI:

- The console shows `[ComfyUI Media Feed] extension loaded`.
- Generated images appear in the feed.
- Many generated images do not make the UI sluggish.
- Clicking an image opens the full-screen viewer.
- Viewer next/previous works with side buttons, mouse wheel, and arrow keys.
- Arrow keys in the viewer do not move selected nodes on the background canvas.
- Ctrl+Enter still starts generation while the viewer is open and does not move
  to another media item.
- New media generated while the viewer is open becomes reachable without closing
  the viewer.
- Video thumbnails play muted on hover, switch to audible playback from their
  bottom-left play button from the beginning, count down the remaining time,
  and stop and re-mute when hover leaves.
- Large video metadata is read with `/view` Range requests when the server
  supports them.
- When an initial metadata scan is inconclusive, `Read full file metadata`
  appears and completes a full scan when selected.
- Audio thumbnails show a two-row layout with a bottom-left play/pause button
  and bottom-right duration that counts down during playback. Audio stops and
  returns to the beginning when hover leaves the card.
- Thumbnail size changes with the slider and persists after reload.
- Switching between Default and Frameless does not move the media cards in any
  placement.

## Publishing Notes

Comfy Registry metadata lives in `pyproject.toml`.

Current package metadata:

- Project name: `media-feed`
- PublisherId: `pajama114`
- DisplayName: `Media Feed`
- Repository: `https://github.com/pajama114/ComfyUI-Media-Feed`

Before publishing a release:

- Ensure `README.md` is up to date.
- Add or update screenshots/demo media if available.
- Bump `version` in `pyproject.toml` when appropriate.
- Commit with the correct Git identity:

```bash
git config user.name
git config user.email
```

Expected identity:

```text
pajama114
287429623+pajama114@users.noreply.github.com
```
