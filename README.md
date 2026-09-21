# Media Feed for ComfyUI

**A media feed for ComfyUI that shows your generated images, videos, and audio right inside the canvas.**

Browse recent outputs, inspect metadata, compare generations, and save favorites without opening the output folder.

## Preview

<p>
  <img src="sample1.png" alt="Media Feed preview showing generated images" width="60%">
  <img src="sample2.png" alt="Media Feed preview showing generated images" width="60%">
  <img src="sample3.png" alt="Media Feed preview showing metadata" width="60%">
</p>

Generated media appears in a fixed panel on the chosen edge of the canvas.

## Key Features

- **All your generated media in one feed** — Browse images, videos, and audio
  directly inside ComfyUI.
- **Batch view** — Group the outputs of one queued generation into a grid card
  and compare whole batches side by side.
- **Full-screen media viewer** — Inspect images with zoom and pan, play videos
  and audio, and navigate between outputs.
- **Generation metadata at a glance** — View and copy embedded prompts, seeds,
  model details, and other available generation settings.
- **One-click favorites** — Save copies of your favorite outputs to
  `output/favorites` with the star button.
- **A feed that fits your workspace** — Choose its canvas edge, resize
  thumbnails, and automatically follow new generations.

## Detailed Features

- Filters newly generated images, videos, and audio in a canvas-edge feed.
- Groups outputs from the same generation in batch view and lets you select an
  item for viewing or file actions.
- Opens media in a full-screen viewer with navigation, zoom and pan, video and
  audio playback, and audio waveforms.
- Compares individual media or whole batches side by side.
- Displays embedded prompts, seeds, model resources, and other generation
  details, with copy and JSON export actions.
- Saves output media to `output/favorites` from the feed or viewer.
- Provides controls for thumbnail size, feed position, automatic following,
  workflow scope, looping, and other display preferences.
- Follows ComfyUI themes, localizes its settings, and restores recent media
  after a reload in the same browser tab.

## Settings Defaults

- Placement: `Bottom`
- Thumbnail size: `143px` high
- Follow latest media: `On`
- Feed history limit: `256`
- Feed style: `Default`
- Media from: `All workflow tabs`
- Exclude Preview node media: `Off`
- Batch dividers: `Line`
- Show metadata in viewer: `On`
- Metadata position: `Left`
- Fit media to viewer: `Off`
- Fit scale: `100%`
- Loop videos: `On`
- Loop audio: `Off`
- Show ComfyUI progress panel over viewer: `Off`
- Show favorite button on hover: `On`
- Favorite storage folder: `output/favorites` (fixed)

Saved settings are stored in browser `localStorage` and override these defaults
after the first change.

Enable **Show ComfyUI progress panel over viewer** to keep ComfyUI's standard
progress panel visible and usable while viewing media. Its position and
expanded/collapsed state follow ComfyUI. Closing the viewer or disabling the
option restores the usual layering. This option requires a frontend with the
standard progress overlay enabled; it does not create a panel on versions that
do not provide one. With metadata on the right, the viewer keeps a stable space
between the Metadata heading and its action buttons, using a slightly smaller
Negative Prompt area so generation start and completion do not shift controls.

## Performance Notes

The feed keeps the configured number of latest media entries in memory (256 by
default, selectable from 64 to 1024), mirrors only their small file descriptors
to browser `sessionStorage`, and only renders visible cards plus a small overscan
buffer. Media files themselves are never copied into browser storage. The
toolbar trash button clears both the visible feed and its saved session entries.

Images, videos, and audio are loaded through ComfyUI's standard `/view` route.
Image thumbnails and the full-screen image viewer use the same URL so the browser
can reuse cache. Recently decoded images are also kept in a small in-memory LRU
cache.

Video thumbnails use `preload="metadata"`. The native audio element uses
`preload="none"` until playback, while visible audio cards load the same `/view`
URL one at a time to derive a small waveform. Only the reduced waveform levels
are cached after decoding.

## Install

#### ComfyUI Manager

Search for **Media Feed** in ComfyUI Manager and install it.

#### Manual

For manual installation, clone this repository into `ComfyUI/custom_nodes`:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/pajama114/ComfyUI-Media-Feed.git
```

Restart ComfyUI and reload the browser.

If the extension loads correctly, the browser developer console will show:

```text
[ComfyUI Media Feed] extension loaded
```

## Supported Media

The feed listens for ComfyUI `executed` events and recursively searches node
outputs for objects shaped like this:

```json
{
  "filename": "ComfyUI_00001_.png",
  "subfolder": "",
  "type": "output"
}
```

Media type is detected from the filename extension.

When **Exclude Preview node media** is enabled, media emitted by nodes whose
type starts with `Preview` (for example, `Preview Image`) is not added to the
feed.

Images:

```text
avif, bmp, gif, jpeg, jpg, png, webp
```

Videos:

```text
avi, m4v, mkv, mov, mp4, webm
```

Audio:

```text
aac, flShow metadata in viewers, wav
```

## Embedded Metadata

When **Show prompts in viewer** is enabled, Media Feed fetches the selected
file and reads its embedded metadata. It attempts to recover prompts, seeds,
and generation details from ComfyUI prompt/workflow data, including data inside
subgraphs. When available, the viewer also lists the checkpoint and active LoRA
resources used by the workflow.

Embedded metadata reading is supported for:

```text
PNG, GIF, MP4, M4V, MOV, WebM, MKV, M4A, MP3, FLAC, OGG, Opus
```

For larger media, Media Feed first scans small byte ranges instead of loading
the entire file. Video scans include both the beginning and end of the file,
where container metadata is commonly stored. If that initial scan cannot find
the embedded metadata, the viewer offers a **Read full file metadata** action
to complete a full scan on demand.

## Favorites

Selecting the star copies output media (images, video, or audio) to the fixed
`favorites` folder inside ComfyUI's configured output directory. The folder is
created on first use. Source media is never moved, deleted, or overwritten; a
number is appended when a favorite already has the same filename. Selecting a
registered star again removes that specific copied file from `favorites`; it
never removes the source media. Media from `input` or `temp` is not eligible,
so this feature never accepts an arbitrary filesystem path.

The **Favorite storage folder** setting displays the fixed relative path
`output/favorites`; it is informational and cannot be changed.

## Current Limitations

- The feed does not scan existing files in the output directory. It restores
  media seen in the current browser-tab session after a reload, but closing the
  tab starts a new feed session.
- Video and audio support depends on output nodes returning `filename`,
  `subfolder`, and `type` in their execution payload.
- The extension uses ComfyUI's local `/view` route. Remote or hosted setups may
  need additional adapter work.
- Metadata display depends on the output file containing supported embedded
  metadata. Custom nodes and workflows may use formats that cannot be read, or
  may not expose enough information to infer every prompt, seed, resource, or
  generation parameter.

## Development

ComfyUI loads JavaScript files from `WEB_DIRECTORY`, exported in `__init__.py`.
The frontend is split into small browser modules:

```text
web/js/media_feed.js
web/js/metadata.js
web/js/metadata_parsers.js
web/js/styles.js
web/js/icons.js
```

There are no runtime Python dependencies.
