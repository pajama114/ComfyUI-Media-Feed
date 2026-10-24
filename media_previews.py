"""Bounded, serialized preview generation; original media is never modified."""

from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import asyncio
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import struct
import threading
import time
import warnings


THUMBNAIL_SIZE = 512
IMAGE_THUMBNAIL_MIN_PIXELS = 8_000_000
WAVEFORM_BARS = 512
WAVEFORM_SAMPLES = 200_000
CACHE_BYTES = 256 * 1024 * 1024
CACHE_ENTRIES = 512
MEMORY_RESERVE = 128 * 1024 * 1024
RETRY_SECONDS = 10
PREVIEW_RESPONSE_WAIT_SECONDS = 1.0
IMAGE_EXTENSIONS = {"avif", "bmp", "gif", "jpeg", "jpg", "png", "webp"}
AUDIO_EXTENSIONS = {"aac", "flac", "m4a", "mp3", "ogg", "opus", "wav"}
VIDEO_EXTENSIONS = {"avi", "m4v", "mkv", "mov", "mp4", "webm"}


def available_memory():
    """Estimate available RAM, including a Linux container's memory limit."""
    available = None
    try:
        import psutil
        available = psutil.virtual_memory().available
    except (ImportError, OSError):
        try:
            fields = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
            available = int(fields["MemAvailable"].split()[0]) * 1024
        except (OSError, KeyError, ValueError):
            pass
    for limit_name, used_name in [
        ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"),
        ("/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.usage_in_bytes"),
    ]:
        try:
            remaining = max(0, int(Path(limit_name).read_text()) - int(Path(used_name).read_text()))
            available = remaining if available is None else min(available, remaining)
        except (OSError, ValueError):
            pass
    return available


class PreviewDeferred(Exception):
    pass


def require_memory(estimate):
    available = available_memory()
    if available is not None and estimate + MEMORY_RESERVE > available:
        raise PreviewDeferred("Waiting for memory")


def open_preview_image(path):
    from PIL import Image

    try:
        return Image.open(path)
    except Image.DecompressionBombError:
        # Registered readers identify headers lazily. Apply our available-memory
        # estimate before decoding, without changing Pillow's global limits
        # (which are also used by ComfyUI on other threads).
        image_format = Image.registered_extensions().get(path.suffix.lower())
        if image_format not in Image.OPEN:
            raise
        return Image.OPEN[image_format][0](path)


def wav_layout(path):
    """Read only chunk headers, including float/extensible WAV and RF64."""
    file_size = path.stat().st_size
    with path.open("rb") as source:
        header = source.read(12)
        if len(header) != 12 or header[:4] not in {b"RIFF", b"RF64"} or header[8:] != b"WAVE":
            return None
        fmt = None
        rf64_size = None
        for _ in range(4096):
            chunk = source.read(8)
            if len(chunk) != 8:
                break
            tag, size = struct.unpack("<4sI", chunk)
            start = source.tell()
            if tag == b"ds64" and size >= 28:
                rf64_size = struct.unpack("<Q", source.read(16)[8:16])[0]
            elif tag == b"fmt " and size >= 16:
                fmt = source.read(min(size, 64))
            elif tag == b"data" and fmt:
                encoding, channels, rate, _, block, bits = struct.unpack("<HHIIHH", fmt[:16])
                if encoding == 0xFFFE and len(fmt) >= 40:
                    if fmt[26:40] != bytes.fromhex("000000001000800000aa00389b71"):
                        return None
                    encoding = struct.unpack("<H", fmt[24:26])[0]
                if encoding not in {1, 3} or channels < 1 or rate < 1:
                    return None
                if (encoding == 1 and bits not in {8, 16, 24, 32}) or (encoding == 3 and bits not in {32, 64}):
                    return None
                if block != channels * (bits // 8):
                    return None
                data_size = rf64_size if size == 0xFFFFFFFF and rf64_size is not None else size
                frames = max(0, min(data_size, file_size - start)) // block
                return dict(offset=start, frames=frames, channels=channels, sampleRate=rate,
                            block=block, bits=bits, encoding=encoding, duration=frames / rate)
            end = start + size + (size & 1)
            if end > file_size or end <= start:
                break
            source.seek(end)
    return None


def wav_waveform(path, layout):
    import numpy as np

    require_memory(16 * 1024 * 1024)
    levels = []
    # A bounded, centered window in each bar, rather than the whole recording.
    window = max(1, min(WAVEFORM_SAMPLES // WAVEFORM_BARS, 1024 * 1024 // layout["block"]))
    with path.open("rb") as source:
        for index in range(WAVEFORM_BARS):
            start = index * layout["frames"] // WAVEFORM_BARS
            end = (index + 1) * layout["frames"] // WAVEFORM_BARS
            count = min(window, end - start)
            source.seek(layout["offset"] + (start + max(0, end - start - count) // 2) * layout["block"])
            raw = source.read(count * layout["block"])
            if not raw:
                levels.append(0.0)
                continue
            bits = layout["bits"]
            if layout["encoding"] == 3:
                samples = np.frombuffer(raw, dtype="<f4" if bits == 32 else "<f8").astype(np.float64)
            elif bits == 24:
                octets = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
                samples = (octets[:, 0] | (octets[:, 1] << 8) | (octets[:, 2] << 16))
                samples = ((samples ^ 0x800000) - 0x800000).astype(np.float64) / 8388608
            else:
                samples = np.frombuffer(raw, dtype={8: "u1", 16: "<i2", 32: "<i4"}[bits]).astype(np.float64)
                samples = (samples - 128) / 128 if bits == 8 else samples / (2 ** (bits - 1))
            samples = np.clip(np.nan_to_num(samples), -1, 1)
            levels.append(float(np.sqrt(np.mean(samples * samples))))
    highest = max(levels, default=0)
    return [level / highest if highest else 0 for level in levels]


def stream_waveform(container, stream, duration):
    """Aggregate compressed audio frame by frame; never retain a recording."""
    import av
    import numpy as np

    require_memory(32 * 1024 * 1024)
    sums = np.zeros(WAVEFORM_BARS, dtype=np.float64)
    counts = np.zeros(WAVEFORM_BARS, dtype=np.int64)
    resampler = av.AudioResampler(format="fltp", layout=stream.codec_context.layout, rate=8000)
    elapsed = 0.0
    # Unknown-duration streams use expanding bins, keeping the same bounded size.
    span = duration if duration and duration > 0 else 60.0
    def accumulate(frame):
        nonlocal elapsed, span, sums, counts
        values = np.clip(np.nan_to_num(frame.to_ndarray()), -1, 1).astype(np.float64)
        energy = np.mean(values * values, axis=0)
        while elapsed + len(energy) / 8000 > span and not duration:
            sums = np.concatenate((sums.reshape(-1, 2).sum(axis=1), np.zeros(WAVEFORM_BARS // 2)))
            counts = np.concatenate((counts.reshape(-1, 2).sum(axis=1), np.zeros(WAVEFORM_BARS // 2, dtype=np.int64)))
            span *= 2
        indices = np.minimum(WAVEFORM_BARS - 1, ((elapsed + np.arange(len(energy)) / 8000) / span * WAVEFORM_BARS).astype(np.int64))
        sums += np.bincount(indices, weights=energy, minlength=WAVEFORM_BARS)
        counts += np.bincount(indices, minlength=WAVEFORM_BARS)
        elapsed += len(energy) / 8000
    for frame in container.decode(stream):
        for converted in resampler.resample(frame):
            accumulate(converted)
    for converted in resampler.resample(None):
        accumulate(converted)
    levels = np.sqrt(sums / np.maximum(1, counts))
    if not duration and elapsed:
        used = max(1, min(WAVEFORM_BARS, math.ceil(elapsed / span * WAVEFORM_BARS)))
        levels = np.interp(np.linspace(0, used - 1, WAVEFORM_BARS), np.arange(used), levels[:used])
    highest = float(levels.max())
    return (levels / highest if highest else levels).tolist(), duration or elapsed


class PreviewService:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="media-feed-preview")
        self.header_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="media-feed-header")
        self.lock = threading.Lock()
        self.jobs = OrderedDict()

    def key(self, path, size=THUMBNAIL_SIZE):
        stat = path.stat()
        return sha256(f"v2:{size}:{path}:{stat.st_size}:{stat.st_mtime_ns}".encode()).hexdigest()

    def request(self, path, size=THUMBNAIL_SIZE):
        path = Path(path)
        key = self.key(path, size)
        base = dict(version=key, bytes=path.stat().st_size, format=path.suffix[1:].upper())
        metadata = self.directory / f"{key}.json"
        with self.lock:
            if metadata.is_file():
                try:
                    result = json.loads(metadata.read_text())
                    os.utime(metadata, None)
                    return result
                except (OSError, ValueError):
                    pass
            job = self.jobs.get(key)
            now = time.monotonic()
            if job and job["future"].done():
                result = job["future"].result()
                if result["status"] != "deferred" or now < job["retry"]:
                    return result
                self.jobs.pop(key)
                job = None
            if not job:
                # Drop abandoned waiting jobs before admitting a new one.
                for old_key, old in list(self.jobs.items()):
                    if old["future"].done() or now - old["requested"] > 30:
                        if old["future"].done() or old["future"].cancel():
                            self.jobs.pop(old_key, None)
                if len(self.jobs) >= CACHE_ENTRIES:
                    return dict(base, status="deferred", retryAfter=RETRY_SECONDS)
                job = dict(requested=now, retry=now + RETRY_SECONDS, info=base)
                if path.suffix[1:].lower() in IMAGE_EXTENSIONS:
                    job["future"] = self.header_executor.submit(self._inspect_image, path, key, base, size)
                else:
                    job["future"] = self.executor.submit(self._generate, path, key, base, size)
                self.jobs[key] = job
            job["requested"] = now
            return dict(job.get("info", base), status="pending", retryAfter=2)

    def thumbnail(self, path, size=THUMBNAIL_SIZE):
        result = self.request(path, size)
        candidate = self.directory / f"{result['version']}.webp"
        return candidate if result.get("thumbnail") and candidate.is_file() else None

    async def request_preview(self, path, size=THUMBNAIL_SIZE):
        result = self.request(path, size)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + PREVIEW_RESPONSE_WAIT_SECONDS
        while result["status"] == "pending":
            with self.lock:
                job = self.jobs.get(result["version"])
                future = job["future"] if job else None
            remaining = deadline - loop.time()
            if future is None or remaining <= 0:
                return result
            # An image can move from header inspection to serialized decoding.
            # Both stages share one response deadline, without polling between
            # them or cancelling either stage when the response times out.
            try:
                await asyncio.wait_for(asyncio.shield(asyncio.wrap_future(future)), remaining)
            except asyncio.TimeoutError:
                return self.request(path, size)
            result = self.request(path, size)
        return result

    def _inspect_image(self, path, key, base, size):
        result = dict(base)
        try:
            from PIL import Image

            with warnings.catch_warnings():
                warnings.simplefilter("ignore", Image.DecompressionBombWarning)
                with open_preview_image(path) as image:
                    result.update(width=image.width, height=image.height)
                    result["thumbnail"] = image.width * image.height >= IMAGE_THUMBNAIL_MIN_PIXELS
                    # Do not ask PNG readers to search beyond the header for
                    # EXIF: that can decode the entire image.
                    if "exif" in image.info and image.getexif().get(274) in {5, 6, 7, 8}:
                        result.update(width=image.height, height=image.width)
            if self.key(path, size) != key:
                raise PreviewDeferred("Media changed")
            if result["thumbnail"]:
                # Enqueue the decoder and release the header worker immediately;
                # later ordinary images must not wait for this thumbnail.
                with self.lock:
                    job = self.jobs[key]
                    job["info"] = result
                    job["future"] = self.executor.submit(self._generate, path, key, base, size)
                return dict(result, status="pending", retryAfter=2)
            result["status"] = "ready"
        except (PreviewDeferred, MemoryError):
            result.pop("thumbnail", None)
            result.update(status="deferred", retryAfter=RETRY_SECONDS)
        except Exception:
            result.pop("thumbnail", None)
            result.update(status="unavailable")
        self._cache_result(key, result)
        return result

    def _generate(self, path, key, base, size=THUMBNAIL_SIZE):
        result = dict(base)
        temporary = self.directory / f"{key}.tmp"
        thumbnail = self.directory / f"{key}.webp"
        try:
            extension = path.suffix[1:].lower()
            if extension in IMAGE_EXTENSIONS:
                from PIL import Image, ImageOps
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", Image.DecompressionBombWarning)
                    with open_preview_image(path) as image:
                        result.update(width=image.width, height=image.height)
                        result["thumbnail"] = image.width * image.height >= IMAGE_THUMBNAIL_MIN_PIXELS
                        if result["thumbnail"]:
                            require_memory(path.stat().st_size * 2 + 16 * 1024 * 1024)
                            image.draft(image.mode, (size, size))
                            require_memory(image.width * image.height * 12 + 16 * 1024 * 1024)
                            if image.getexif().get(274) in {5, 6, 7, 8}:
                                result.update(width=result["height"], height=result["width"])
                            image.thumbnail((size, size))
                            small = ImageOps.exif_transpose(image)
                            if small.mode not in {"RGB", "RGBA"}:
                                small = small.convert("RGBA")
                            small.save(temporary, format="WEBP", quality=82)
                            result.update(thumbnailWidth=small.width, thumbnailHeight=small.height)
                        # PNG getexif() can load pixels when EXIF was not found
                        # in the header. Ordinary images only need their header.
                        elif "exif" in image.info and image.getexif().get(274) in {5, 6, 7, 8}:
                            result.update(width=image.height, height=image.width)
            elif extension in AUDIO_EXTENSIONS:
                layout = wav_layout(path) if extension == "wav" else None
                if layout:
                    result.update(duration=layout["duration"], channels=layout["channels"], sampleRate=layout["sampleRate"])
                    result["peaks"] = wav_waveform(path, layout)
                    result["sampled"] = layout["frames"] > WAVEFORM_SAMPLES
                else:
                    import av
                    with av.open(str(path)) as container:
                        stream = next(iter(container.streams.audio), None)
                        if stream is None:
                            raise ValueError("No audio stream")
                        stream.codec_context.thread_count = 1
                        duration = float(stream.duration * stream.time_base) if stream.duration is not None else None
                        if not duration or not math.isfinite(duration) or duration < 0:
                            duration = container.duration / av.time_base if container.duration else None
                        if duration is not None and (not math.isfinite(duration) or duration <= 0):
                            duration = None
                        result.update(duration=duration, channels=stream.codec_context.channels,
                                      sampleRate=stream.codec_context.sample_rate)
                        result["peaks"], result["duration"] = stream_waveform(container, stream, duration)
                        result["sampled"] = False
            elif extension in VIDEO_EXTENSIONS:
                import av
                with av.open(str(path)) as container:
                    stream = next(iter(container.streams.video), None)
                    if stream is None:
                        raise ValueError("No video stream")
                    stream.codec_context.thread_count = 1
                    width, height = stream.codec_context.width, stream.codec_context.height
                    result.update(width=width, height=height)
                    if stream.duration is not None:
                        result["duration"] = float(stream.duration * stream.time_base)
                    elif container.duration is not None:
                        result["duration"] = container.duration / av.time_base
                    if "duration" in result and (not math.isfinite(result["duration"]) or result["duration"] < 0):
                        result.pop("duration")
                    require_memory(width * height * 32 + 32 * 1024 * 1024)
                    frame = next(container.decode(stream))
                    scale = min(1, size / max(frame.width, frame.height))
                    small = frame.reformat(width=max(1, round(frame.width * scale)),
                                           height=max(1, round(frame.height * scale)), format="rgb24").to_image()
                    small.save(temporary, format="WEBP", quality=82)
                    result.update(thumbnailWidth=small.width, thumbnailHeight=small.height)
                    result["thumbnail"] = True
            else:
                raise ValueError("Unsupported media format")
            # A file overwritten during processing must not be cached as its old version.
            if self.key(path, size) != key:
                raise PreviewDeferred("Media changed")
            if temporary.is_file():
                temporary.replace(thumbnail)
            result["status"] = "ready"
        except (PreviewDeferred, MemoryError):
            result.pop("thumbnail", None)
            result.update(status="deferred", retryAfter=RETRY_SECONDS)
        except Exception:
            # Keep descriptors available even when an optional decoder is absent.
            result.pop("thumbnail", None)
            result.update(status="unavailable")
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
        self._cache_result(key, result)
        return result

    def _cache_result(self, key, result):
        if result["status"] in {"ready", "unavailable"}:
            temporary = self.directory / f"{key}.tmp"
            try:
                temporary.write_text(json.dumps(result, allow_nan=False))
                temporary.replace(self.directory / f"{key}.json")
                self._trim_cache()
            except OSError:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass

    def _trim_cache(self):
        entries = []
        for metadata in self.directory.glob("*.json"):
            try:
                image = metadata.with_suffix(".webp")
                size = metadata.stat().st_size + (image.stat().st_size if image.is_file() else 0)
                entries.append((metadata.stat().st_mtime_ns, metadata, size))
            except OSError:
                continue
        total = sum(entry[2] for entry in entries)
        count = len(entries)
        for _, metadata, size in sorted(entries):
            if total <= CACHE_BYTES and count <= CACHE_ENTRIES:
                break
            metadata.unlink(missing_ok=True)
            metadata.with_suffix(".webp").unlink(missing_ok=True)
            total -= size
            count -= 1
