# Media Feed: guidance for coding agents

## Project and working approach

Media Feed is a ComfyUI extension that displays newly generated images, videos,
and audio in a floating canvas-edge feed. ComfyUI loads its browser ES modules
directly from `web/js`; there is no build step or JavaScript package manager.
The only Python runtime code is the favorites API in `__init__.py`. Work in WSL.

Read the files relevant to the requested change, then complete the requested
work and verify the affected behavior. Use judgment for routine implementation
choices; ask when a missing product decision would materially change the result.
Keep changes in the module that owns the behavior. Add dependencies or a build
system only when the feature clearly requires them.

## Where to work

- `web/js/media_feed.js` composes the extension. `web/js/media_feed/` owns feed
  state, settings, cards, virtualization, the floating panel, viewer, and
  ComfyUI event integration.
- `web/js/metadata.js` is the public metadata API. `web/js/metadata/` owns
  bounded loading, extraction, graph inference, and format parsers.
  `web/js/metadata_parsers.js` preserves the parser API used elsewhere.
- `web/js/styles.js` assembles CSS from `web/js/styles/`; `web/js/icons.js`
  holds shared SVG icons. `locales/*/` contains translated setting text.
- `__init__.py` registers the favorites routes and exposes `WEB_DIRECTORY`.
  `tests/` contains dependency-free Node tests. `README.md` describes user
  behavior; `pyproject.toml` holds Comfy Registry metadata.

## Behavior to preserve when changing related code

- Keep feed history bounded by the configured limit and render visible cards
  with overscan. Session storage contains media descriptors, not media files.
  Reuse the same ComfyUI `/view` URL for an image thumbnail and its viewer when
  possible so browser caching works.
- Keep the floating feed usable on all four canvas edges. Default and
  Frameless styles must place media cards identically; hidden controls and
  scrollbars still occupy equivalent layout space.
- Start embedded metadata reads with bounded Range requests. A server that
  ignores Range must not trigger an automatic large download. Keep the viewer's
  explicit full-file scan for inconclusive results, including large videos.
- While the viewer is open, its navigation and playback keys must not reach
  the ComfyUI canvas. Viewer controls must not steal ComfyUI's Ctrl+Enter
  generation shortcut.
- Favorites may copy only output media into `output/favorites`. Preserve path
  validation, collision-safe copies, and deletion limited to favorite copies;
  never delete the source output.
- When changing registered settings or their labels, keep persisted values
  compatible and update the corresponding locale entries. Treat `README.md`
  as a stable product overview, not a changelog. Update it only when adding or
  removing a substantial capability, changing installation or compatibility,
  or making an existing documented setting or workflow inaccurate. Do not add
  minor visual refinements, wording changes, implementation details, or
  self-evident UI interactions unless the user explicitly asks for them.

## Verification

Run the Node tests relevant to the change; use the full suite for changes that
cross modules or affect shared behavior. These tests use local fixtures and can
be run and fixed without asking for approval:

```bash
node --experimental-default-type=module --test tests/metadata.test.js
node --experimental-default-type=module --test tests/*.test.js
```

The first command is an example of a focused test; select the test file that
covers your change. For edited JavaScript, run `node --check` on the changed
files. For edits to `__init__.py` or `pyproject.toml`, run the corresponding
check below. Run `git diff --check` on edited work.

```bash
python -c "import ast, pathlib; ast.parse(pathlib.Path('__init__.py').read_text())"
python -c "import tomllib; tomllib.load(open('pyproject.toml', 'rb'))"
```

If a change depends on ComfyUI browser behavior, reload ComfyUI and exercise
the affected flow when available; report any browser checks you could not run.
Avoid repeating broader checks after they pass unless a later change or failure
gives a reason.

When preparing a release, review the public README and Registry metadata in
`pyproject.toml`, including the version. Do not commit transient logs or caches.
