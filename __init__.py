from pathlib import Path, PureWindowsPath
from shutil import copyfileobj

from aiohttp import web

import folder_paths
from server import PromptServer


WEB_DIRECTORY = "./web/js"

FAVORITES_FOLDER = "favorites"


def _is_within(path, parent):
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _relative_media_path(subfolder, filename):
    parts = []
    for value in (subfolder, filename):
        if not isinstance(value, str):
            raise ValueError("Invalid media reference")
        windows_path = PureWindowsPath(value)
        if Path(value).is_absolute() or windows_path.is_absolute() or windows_path.drive:
            raise ValueError("Invalid media reference")
        parts.extend(part for part in value.replace("\\", "/").split("/") if part)

    if not parts or any(part in {".", ".."} for part in parts):
        raise ValueError("Invalid media reference")
    return Path(*parts)


def _favorites_directory(create=False):
    output_directory = Path(folder_paths.get_output_directory()).resolve()
    favorites_directory = output_directory / FAVORITES_FOLDER
    if create:
        favorites_directory.mkdir(exist_ok=True)
    favorites_directory = favorites_directory.resolve()
    if not _is_within(favorites_directory, output_directory):
        raise ValueError("Invalid favorites directory")
    return output_directory, favorites_directory


def _copy_to_favorites(subfolder, filename):
    output_directory, favorites_directory = _favorites_directory(create=True)
    source = (output_directory / _relative_media_path(subfolder, filename)).resolve()
    if not _is_within(source, output_directory) or not source.is_file():
        raise FileNotFoundError("Media file was not found")

    stem = source.stem
    suffix = source.suffix
    index = 0
    while True:
        destination_name = f"{stem}{'' if index == 0 else f'_{index}'}{suffix}"
        destination = favorites_directory / destination_name
        try:
            destination_file = destination.open("xb")
        except FileExistsError:
            index += 1
            continue

        try:
            with destination_file, source.open("rb") as source_file:
                copyfileobj(source_file, destination_file)
            return destination.name
        except Exception:
            destination.unlink(missing_ok=True)
            raise


def _remove_favorite(filename):
    if not isinstance(filename, str):
        raise ValueError("Invalid favorite reference")

    windows_path = PureWindowsPath(filename)
    if (
        Path(filename).is_absolute()
        or windows_path.is_absolute()
        or windows_path.drive
        or "/" in filename
        or "\\" in filename
        or filename in {"", ".", ".."}
    ):
        raise ValueError("Invalid favorite reference")

    _, favorites_directory = _favorites_directory()
    favorite = (favorites_directory / filename).resolve()
    if not _is_within(favorite, favorites_directory) or not favorite.is_file():
        raise FileNotFoundError("Favorite media was not found")
    favorite.unlink()


@PromptServer.instance.routes.post("/media-feed/favorite")
async def add_favorite(request):
    try:
        data = await request.json()
        if not isinstance(data, dict) or data.get("type") != "output":
            raise ValueError("Only output media can be favorited")
        filename = _copy_to_favorites(data.get("subfolder", ""), data.get("filename"))
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)
    except FileNotFoundError:
        return web.json_response({"error": "Media file was not found"}, status=404)
    except OSError:
        return web.json_response({"error": "Could not copy media to favorites"}, status=500)

    return web.json_response({"filename": filename, "subfolder": FAVORITES_FOLDER, "type": "output"})


@PromptServer.instance.routes.delete("/media-feed/favorite")
async def remove_favorite(request):
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError("Invalid favorite reference")
        _remove_favorite(data.get("filename"))
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)
    except FileNotFoundError:
        return web.json_response({"error": "Favorite media was not found"}, status=404)
    except OSError:
        return web.json_response({"error": "Could not remove favorite media"}, status=500)

    return web.json_response({"removed": True})

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
