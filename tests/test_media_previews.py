import asyncio
from concurrent.futures import Future
import importlib.util
from pathlib import Path
import struct
from tempfile import TemporaryDirectory
import threading
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import media_previews as previews
from test_favorites_api import load_extension


class PreviewTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.service = previews.PreviewService(self.root / "cache")
        self.memory = patch.object(previews, "available_memory", return_value=8 * 1024 ** 3)
        self.memory.start()

    def tearDown(self):
        self.service.executor.shutdown(wait=True, cancel_futures=True)
        self.memory.stop()
        self.temporary.cleanup()

    def complete(self, path, size=512):
        result = self.service.request(path, size)
        if result["status"] == "pending":
            self.service.jobs[result["version"]]["future"].result(timeout=10)
        return self.service.request(path, size)

    async def test_quick_previews_finish_in_first_response_without_blocking_the_event_loop(self):
        path = self.root / "quick.png"
        path.write_bytes(b"image")
        entered = asyncio.Event()
        release = threading.Event()
        loop = asyncio.get_running_loop()
        def work(path, key, base, size):
            loop.call_soon_threadsafe(entered.set)
            release.wait(2)
            return dict(base, status="ready")
        with patch.object(self.service, "_generate", side_effect=work) as generate:
            task = asyncio.create_task(self.service.request_preview(path))
            try:
                await asyncio.wait_for(entered.wait(), 1)
                self.assertFalse(task.done())
            finally:
                release.set()
            result = await task
            self.assertEqual(result["status"], "ready")
            self.assertEqual(await self.service.request_preview(path), result)
            self.assertEqual(generate.call_count, 1)

    async def test_preview_response_timeout_keeps_queued_generation_alive(self):
        future = Future()
        pending = {"version": "slow", "status": "pending"}
        self.service.jobs["slow"] = {"future": future}
        with patch.object(self.service, "request", return_value=pending), patch.object(previews, "PREVIEW_RESPONSE_WAIT_SECONDS", 0.001):
            self.assertEqual(await self.service.request_preview(self.root / "slow.png"), pending)
            self.assertFalse(future.cancelled())
            future.set_result({"status": "ready"})
            await asyncio.sleep(0)

    async def test_batch_responses_return_each_thumbnail_when_ready_without_a_polling_gap(self):
        paths = [self.root / f"batch-{index}.png" for index in range(4)]
        for path in paths:
            path.write_bytes(b"image")
        entered = [asyncio.Event() for _ in paths]
        release = [threading.Event() for _ in paths]
        loop = asyncio.get_running_loop()

        def work(path, key, base, size):
            index = paths.index(path)
            loop.call_soon_threadsafe(entered[index].set)
            release[index].wait(2)
            return dict(base, status="ready", thumbnail=True)

        with patch.object(self.service, "_generate", side_effect=work):
            tasks = [asyncio.create_task(self.service.request_preview(path)) for path in paths]
            try:
                for index in range(2):
                    await asyncio.wait_for(entered[index].wait(), 1)
                    release[index].set()
                    self.assertEqual((await tasks[index])["status"], "ready")
                await asyncio.wait_for(entered[2].wait(), 1)
                # Later images in a serialized batch can finish after the old
                # 150 ms response timeout, without needing a client retry.
                await asyncio.sleep(0.2)
                self.assertFalse(tasks[2].done())
                self.assertFalse(tasks[3].done())
                release[2].set()
                self.assertEqual((await tasks[2])["status"], "ready")
                await asyncio.wait_for(entered[3].wait(), 1)
                release[3].set()
                self.assertEqual((await tasks[3])["status"], "ready")
            finally:
                for event in release:
                    event.set()
                await asyncio.gather(*tasks, return_exceptions=True)

    async def test_disconnecting_preview_response_does_not_cancel_queued_generation(self):
        future = Future()
        self.service.jobs["queued"] = {"future": future}
        with patch.object(self.service, "request", return_value={"version": "queued", "status": "pending"}):
            task = asyncio.create_task(self.service.request_preview(self.root / "queued.png"))
            await asyncio.sleep(0)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertFalse(future.cancelled())
            future.set_result({"status": "ready"})
            await asyncio.sleep(0)

    @unittest.skipUnless(importlib.util.find_spec("PIL"), "Pillow is supplied by ComfyUI")
    def test_thumbnail_preserves_original_and_is_reused_across_requests(self):
        from PIL import Image
        path = self.root / "large.png"
        Image.new("RGBA", (2000, 1000), (30, 80, 120, 100)).save(path)
        original = path.read_bytes()
        result = self.complete(path)
        self.assertEqual(result["status"], "ready")
        self.assertEqual((result["width"], result["height"]), (2000, 1000))
        with Image.open(self.service.thumbnail(path)) as small:
            self.assertEqual(small.size, (512, 256))
            self.assertEqual(small.mode, "RGBA")
        with patch.object(self.service.executor, "submit", side_effect=AssertionError("must reuse cache")):
            self.assertEqual(self.service.request(path), result)
        self.assertEqual(path.read_bytes(), original)
        smaller = self.complete(path, 128)
        self.assertNotEqual(smaller["version"], result["version"])
        with Image.open(self.service.thumbnail(path, 128)) as small:
            self.assertEqual(small.size, (128, 64))
        Image.new("RGB", (100, 100)).save(path)
        self.assertNotEqual(self.complete(path)["version"], result["version"])

    @unittest.skipUnless(importlib.util.find_spec("PIL"), "Pillow is supplied by ComfyUI")
    def test_low_memory_defers_and_retries_without_a_fixed_pixel_rejection(self):
        from PIL import Image
        path = self.root / "large.png"
        Image.new("RGB", (2000, 2000)).save(path)
        with patch.object(previews, "available_memory", return_value=160 * 1024 ** 2):
            result = self.complete(path)
        self.assertEqual(result["status"], "deferred")
        self.assertEqual(result["width"], 2000)
        self.assertFalse(list(self.service.directory.glob("*.json")))
        self.service.jobs[result["version"]]["retry"] = 0
        # Our RAM estimate replaces Pillow's fixed PNG pixel rejection without
        # changing its process-wide setting for ComfyUI's other readers.
        with patch.object(Image, "MAX_IMAGE_PIXELS", 100):
            ready = self.complete(path)
            self.assertEqual(Image.MAX_IMAGE_PIXELS, 100)
        self.assertEqual(ready["status"], "ready")

    @unittest.skipUnless(importlib.util.find_spec("PIL"), "Pillow is supplied by ComfyUI")
    def test_image_readers_use_memory_estimates_instead_of_fixed_pixel_limits(self):
        from PIL import Image
        for extension in ["png", "jpg", "gif", "bmp", "webp"]:
            path = self.root / f"image.{extension}"
            Image.new("RGB", (32, 16), (40, 60, 80)).save(path)
            with self.subTest(extension=extension), patch.object(Image, "MAX_IMAGE_PIXELS", 100):
                result = self.complete(path)
                self.assertEqual(result["status"], "ready")
                self.assertEqual((result["width"], result["height"]), (32, 16))
                self.assertEqual(Image.MAX_IMAGE_PIXELS, 100)

    def test_hour_long_wav_reads_bounded_windows_not_the_recording(self):
        if not importlib.util.find_spec("numpy"):
            self.skipTest("NumPy is supplied by ComfyUI")
        path = self.root / "hour.wav"
        frames = 48_000 * 3600
        data_bytes = frames * 4
        with path.open("wb") as output:
            output.write(b"RIFF" + struct.pack("<I", 36 + data_bytes) + b"WAVEfmt ")
            output.write(struct.pack("<IHHIIHH", 16, 1, 2, 48_000, 192_000, 4, 16))
            output.write(b"data" + struct.pack("<I", data_bytes))
            output.seek(44 + data_bytes - 1)
            output.write(b"\0")
        layout = previews.wav_layout(path)
        self.assertEqual(layout["duration"], 3600)
        real_open = Path.open
        reads = []
        class Reader:
            def __init__(self, source): self.source = source
            def __enter__(self): return self
            def __exit__(self, *args): self.source.close()
            def seek(self, *args): return self.source.seek(*args)
            def read(self, amount):
                reads.append(amount)
                return self.source.read(amount)
        def bounded_open(current, *args, **kwargs):
            source = real_open(current, *args, **kwargs)
            return Reader(source) if current == path else source
        with patch.object(Path, "open", bounded_open):
            peaks = previews.wav_waveform(path, layout)
        self.assertEqual(len(peaks), 512)
        self.assertLessEqual(sum(reads), previews.WAVEFORM_SAMPLES * 4)
        self.assertEqual(max(peaks), 0)

    def test_float_and_extensible_wav_metadata_and_levels(self):
        if not importlib.util.find_spec("numpy"):
            self.skipTest("NumPy is supplied by ComfyUI")
        for bits, encoding in [(16, 1), (24, 1), (32, 1), (32, 3), (64, 3)]:
            path = self.root / f"audio-{bits}-{encoding}.wav"
            if encoding == 3:
                sample = struct.pack("<f" if bits == 32 else "<d", 0.5)
            else:
                sample = (2 ** (bits - 2)).to_bytes(bits // 8, "little", signed=True)
            data = sample * 1024
            fmt = struct.pack("<HHIIHH", 0xFFFE, 1, 8000, 8000 * len(sample), len(sample), bits)
            fmt += struct.pack("<HHI", 22, bits, 0) + struct.pack("<I", encoding) + bytes.fromhex("00001000800000aa00389b71")
            body = b"WAVEfmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data
            path.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)
            layout = previews.wav_layout(path)
            self.assertEqual(layout["encoding"], encoding)
            self.assertEqual(previews.wav_waveform(path, layout), [1.0] * 512)

    def test_generation_is_serialized_and_cache_has_a_total_byte_limit(self):
        first = self.root / "one.png"
        second = self.root / "two.png"
        first.write_bytes(b"first")
        second.write_bytes(b"second")
        entered = threading.Event()
        release = threading.Event()
        calls = []
        def work(path, key, base, size):
            calls.append(path.name)
            entered.set()
            release.wait(5)
            return dict(base, status="ready")
        with patch.object(self.service, "_generate", side_effect=work):
            self.service.request(first)
            self.assertTrue(entered.wait(2))
            self.service.request(second)
            self.assertEqual(calls, ["one.png"])
            release.set()
            for job in self.service.jobs.values():
                job["future"].result(timeout=5)
        for index in range(3):
            (self.service.directory / f"{index}.json").write_text("{}")
            (self.service.directory / f"{index}.webp").write_bytes(b"x" * 20)
        with patch.object(previews, "CACHE_BYTES", 30):
            self.service._trim_cache()
        self.assertEqual(len(list(self.service.directory.glob("*.json"))), 1)
        self.assertEqual(len(list(self.service.directory.glob("*.webp"))), 1)

    @unittest.skipUnless(importlib.util.find_spec("av"), "PyAV is supplied by ComfyUI")
    def test_unknown_duration_audio_keeps_earlier_levels_when_bins_expand(self):
        import av
        import numpy as np
        def frames():
            for second in range(70):
                values = np.full((1, 8000), 0 if second < 30 else 0.5, dtype=np.float32)
                frame = av.AudioFrame.from_ndarray(values, format="fltp", layout="mono")
                frame.sample_rate = 8000
                yield frame
        container = SimpleNamespace(decode=lambda stream: frames())
        stream = SimpleNamespace(codec_context=SimpleNamespace(layout=av.AudioLayout("mono")))
        levels, duration = previews.stream_waveform(container, stream, None)
        self.assertAlmostEqual(duration, 70)
        self.assertEqual(max(levels[:200]), 0)
        self.assertGreater(min(levels[240:]), 0.9)

    @unittest.skipUnless(importlib.util.find_spec("av"), "PyAV is supplied by ComfyUI")
    def test_compressed_audio_and_video_use_real_decoders(self):
        import av
        import numpy as np
        audio = self.root / "sound.flac"
        with av.open(str(audio), "w") as container:
            stream = container.add_stream("flac", rate=8000)
            stream.layout = "stereo"
            signal = (np.sin(np.arange(8000) * 2 * np.pi * 220 / 8000) * 16000).astype(np.int16)
            # Opposite phases must not cancel the waveform when combining channels.
            interleaved = np.column_stack((signal, -signal)).reshape(1, -1)
            frame = av.AudioFrame.from_ndarray(interleaved, format="s16", layout="stereo")
            frame.sample_rate = 8000
            for packet in stream.encode(frame): container.mux(packet)
            for packet in stream.encode(None): container.mux(packet)
        result = self.complete(audio)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(len(result["peaks"]), 512)
        self.assertGreater(min(result["peaks"]), 0.5)
        self.assertAlmostEqual(result["duration"], 1, places=2)
        video = self.root / "clip.mp4"
        with av.open(str(video), "w") as container:
            stream = container.add_stream("mpeg4", rate=24)
            stream.width, stream.height, stream.pix_fmt = 640, 360, "yuv420p"
            for _ in range(3):
                frame = av.VideoFrame.from_ndarray(np.full((360, 640, 3), 90, dtype=np.uint8), format="rgb24")
                for packet in stream.encode(frame): container.mux(packet)
            for packet in stream.encode(None): container.mux(packet)
        result = self.complete(video)
        self.assertEqual(result["status"], "ready")
        self.assertEqual((result["thumbnailWidth"], result["thumbnailHeight"]), (512, 288))


class PreviewPathTests(unittest.TestCase):
    def test_preview_paths_reject_traversal_inputs_and_symlink_escapes(self):
        extension = load_extension()
        with TemporaryDirectory() as directory, TemporaryDirectory() as outside:
            root = Path(directory)
            (root / "valid.wav").write_bytes(b"audio")
            (root / "escape").symlink_to(outside, target_is_directory=True)
            with patch.object(extension.folder_paths, "get_directory_by_type", create=True, return_value=directory):
                self.assertEqual(extension._preview_media_path({"filename": "valid.wav"}), root / "valid.wav")
                for query in [
                    {"filename": "../private.wav"}, {"filename": "C:\\private.wav"},
                    {"filename": "/private.wav"}, {"filename": "valid.wav", "type": "input"},
                    {"filename": "private.wav", "subfolder": "escape"},
                ]:
                    with self.subTest(query=query), self.assertRaises(ValueError):
                        extension._preview_media_path(query)


if __name__ == "__main__":
    unittest.main()
