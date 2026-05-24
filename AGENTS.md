# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Media Feed is a ComfyUI frontend extension that shows generated images, videos,
and audio in a lightweight feed. It is intentionally small and has no runtime
Python dependencies.

## Repository Layout

- `__init__.py` exposes `WEB_DIRECTORY = "./web/js"` for ComfyUI.
- `web/js/media_feed.js` contains the extension UI and all runtime behavior.
- `pyproject.toml` contains Comfy Registry metadata.
- `README.md` is the public user-facing documentation.
- `icon.png` is referenced by `[tool.comfy] Icon`.
- `LICENSE` is MIT.

## Development Rules

- Keep the extension frontend-only unless there is a clear need for backend
  routes or custom nodes.
- Prefer small, focused changes in `web/js/media_feed.js`.
- Do not add npm, bundler, or Python runtime dependencies without a strong
  reason. ComfyUI loads this file directly as browser JavaScript.
- Preserve compatibility with older ComfyUI frontends: the fallback fixed panel
  matters because some installs do not support bottom-panel tabs.
- Keep UI performance bounded. The feed currently retains 256 items and
  virtualizes visible cards. Do not replace virtualization with a full DOM list.
- Avoid cache-busting media URLs. Image preview and full-screen view should reuse
  the same `/view` URL where possible.
- Be careful with keyboard handlers. When the viewer is open, arrow keys must not
  leak to the ComfyUI canvas.
- Be careful with focus. Viewer controls should not accidentally trigger ComfyUI
  shortcuts such as Ctrl+Enter.
- Do not commit logs or generated files. `startup.log` is ignored.

## Checks

Run these before committing:

```bash
node --check web/js/media_feed.js
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
- Video thumbnails play muted on hover and stop when hover leaves.
- Audio thumbnails show a two-row layout with a full-width seek bar.
- Thumbnail size changes with the slider and persists after reload.

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
