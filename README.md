# Media Feed for ComfyUI

Media Feed adds a lightweight media browser to ComfyUI for generated images,
videos, and audio.

It is designed as a focused feed extension: generated media appears in a bottom
panel when the ComfyUI frontend supports bottom-panel tabs, and in a fixed
fallback panel on older frontends or when a floating placement is selected.

## Features

- Shows generated images, videos, and audio in one feed.
- Opens media in a full-screen viewer.
- Supports previous/next navigation with side buttons, arrow keys, and wheel
  scrolling in the viewer.
- Plays video thumbnails on hover, muted and looped.
- Provides compact audio thumbnail controls with a full-width seek bar.
- Lets you resize thumbnails with a toolbar slider.
- Adds a ComfyUI setting for placing the floating feed at the top, right,
  bottom, or left of the canvas.
- Can show embedded positive and negative prompts in the media viewer.
- Uses ComfyUI theme colors when available.
- Saves thumbnail size in browser `localStorage`.
- Keeps the feed responsive by limiting retained items and virtualizing visible
  cards.

## Performance Notes

The feed keeps the latest 256 media entries in memory and only renders visible
cards plus a small overscan buffer.

Images, videos, and audio are loaded through ComfyUI's standard `/view` route.
Image thumbnails and the full-screen image viewer use the same URL so the browser
can reuse cache. Recently decoded images are also kept in a small in-memory LRU
cache.

Video thumbnails use `preload="metadata"`. Audio thumbnails use `preload="none"`
until the user presses play.

## Install

Install through ComfyUI Manager once this extension is published.

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
aac, flac, m4a, mp3, ogg, opus, wav
```

## Current Limitations

- The feed only shows media generated while the page is open. It does not scan
  existing files in the output directory.
- Video and audio support depends on output nodes returning `filename`,
  `subfolder`, and `type` in their execution payload.
- The extension uses ComfyUI's local `/view` route. Remote or hosted setups may
  need additional adapter work.
- Prompt display reads embedded PNG, GIF, MP4, WebM, M4A, MP3, FLAC, OGG, and Opus metadata and may not infer
  prompts from every custom workflow.

## Registry Checklist

Before publishing to ComfyUI Registry or making this available through ComfyUI
Manager, add screenshots or a short demo GIF.

## Development

ComfyUI loads JavaScript files from `WEB_DIRECTORY`, exported in `__init__.py`.
The extension code lives in:

```text
web/js/media_feed.js
```

There are no runtime Python dependencies.
