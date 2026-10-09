import errno
import importlib.util
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch


def load_extension():
    # The route tests run without installing ComfyUI or aiohttp.
    routes = SimpleNamespace(
        post=lambda path: lambda handler: handler,
        delete=lambda path: lambda handler: handler,
    )
    web = SimpleNamespace(
        json_response=lambda payload, status=200: SimpleNamespace(payload=payload, status=status),
    )
    modules = {
        "aiohttp": SimpleNamespace(web=web),
        "folder_paths": SimpleNamespace(get_output_directory=lambda: ""),
        "server": SimpleNamespace(PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=routes))),
    }
    spec = importlib.util.spec_from_file_location(
        "media_feed_favorites_test", Path(__file__).resolve().parents[1] / "__init__.py"
    )
    extension = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(extension)
    return extension


class FavoritesApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.extension = load_extension()

    async def test_storage_failures_return_actionable_errors_for_both_routes(self):
        scenarios = [
            (errno.ENOSPC, 507, "Not enough disk space"),
            (errno.EACCES, 403, "Permission denied"),
            (errno.EPERM, 403, "Permission denied"),
            (errno.EROFS, 403, "read-only"),
        ]
        if hasattr(errno, "EDQUOT"):
            scenarios.append((errno.EDQUOT, 507, "storage quota"))
        for handler_name, operation in [
            ("add_favorite", "_copy_to_favorites"),
            ("remove_favorite", "_remove_favorite"),
        ]:
            for error_number, status, message in scenarios:
                with self.subTest(handler=handler_name, errno=error_number):
                    request = SimpleNamespace(json=AsyncMock(return_value={
                        "type": "output", "filename": "image.png", "subfolder": "",
                    }))
                    with patch.object(self.extension, operation, side_effect=OSError(error_number, "failure")):
                        response = await getattr(self.extension, handler_name)(request)
                    self.assertEqual(response.status, status)
                    self.assertIn(message, response.payload["error"])

    async def test_unknown_os_errors_keep_the_generic_response(self):
        request = SimpleNamespace(json=AsyncMock(return_value={"type": "output", "filename": "image.png"}))
        for error in [OSError(errno.EIO, "private server details"), OSError("private server details")]:
            with self.subTest(error=error):
                with patch.object(self.extension, "_copy_to_favorites", side_effect=error):
                    response = await self.extension.add_favorite(request)
                self.assertEqual(response.status, 500)
                self.assertEqual(response.payload, {"error": "Could not copy media to favorites"})

    async def test_disk_full_during_copy_preserves_source_and_cleans_partial_copy(self):
        def fail_copy(source, destination):
            destination.write(source.read(2))
            raise OSError(errno.ENOSPC, "No space left on device")

        with TemporaryDirectory() as directory:
            output = Path(directory)
            source = output / "image.png"
            source.write_bytes(b"source media")
            favorites = output / "favorites"
            favorites.mkdir()
            existing_favorite = favorites / "image.png"
            existing_favorite.write_bytes(b"existing favorite")
            request = SimpleNamespace(json=AsyncMock(return_value={
                "type": "output", "filename": source.name, "subfolder": "",
            }))
            with patch.object(self.extension.folder_paths, "get_output_directory", return_value=directory):
                with patch.object(self.extension, "copyfileobj", side_effect=fail_copy):
                    response = await self.extension.add_favorite(request)

            self.assertEqual(response.status, 507)
            self.assertIn("Not enough disk space", response.payload["error"])
            self.assertEqual(source.read_bytes(), b"source media")
            self.assertEqual(existing_favorite.read_bytes(), b"existing favorite")
            self.assertEqual(list(favorites.iterdir()), [existing_favorite])


if __name__ == "__main__":
    unittest.main()
