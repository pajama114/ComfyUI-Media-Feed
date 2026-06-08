import os
import platform
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import web

import folder_paths
from server import PromptServer

WEB_DIRECTORY = "./web/js"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}


def _is_same_origin_request(request):
    origin = request.headers.get("Origin")
    if not origin:
        return True
    return urlsplit(origin).netloc == request.headers.get("Host", "")


def _is_wsl():
    return "microsoft" in platform.release().lower() or "WSL_DISTRO_NAME" in os.environ


def _run_detached(command):
    subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def _wsl_to_windows_path(path):
    if not shutil.which("wslpath"):
        return path

    result = subprocess.run(
        ["wslpath", "-w", path],
        capture_output=True,
        check=True,
        text=True,
    )
    return result.stdout.strip() or path


def _open_windows_folder(path):
    cmd = shutil.which("cmd.exe") or shutil.which("cmd")
    if cmd:
        _run_detached([cmd, "/C", "start", "", "explorer.exe", path])
    else:
        os.startfile(path)


def _open_folder(path):
    system = platform.system()
    if system == "Windows":
        _open_windows_folder(path)
        return

    if _is_wsl() and shutil.which("explorer.exe"):
        _open_windows_folder(_wsl_to_windows_path(path))
        return

    if system == "Darwin":
        opener = shutil.which("open")
        command = [opener, path] if opener else None
    else:
        opener = shutil.which("xdg-open")
        command = [opener, path] if opener else None
        if command is None and shutil.which("gio"):
            command = ["gio", "open", path]

    if command is None:
        raise RuntimeError("No supported file manager opener was found.")

    _run_detached(command)


@PromptServer.instance.routes.post("/comfyui-media-feed/open-output")
async def open_output_folder(request):
    if not _is_same_origin_request(request):
        raise web.HTTPForbidden(text="Origin does not match this ComfyUI server.")

    output_dir = Path(folder_paths.get_output_directory()).expanduser().resolve()
    if not output_dir.exists():
        raise web.HTTPNotFound(text="The ComfyUI output directory does not exist.")
    if not output_dir.is_dir():
        raise web.HTTPBadRequest(text="The ComfyUI output path is not a directory.")

    try:
        _open_folder(str(output_dir))
    except Exception as error:
        return web.json_response(
            {
                "ok": False,
                "error": str(error),
                "path": str(output_dir),
            },
            status=500,
        )

    return web.json_response({"ok": True, "path": str(output_dir)})


__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
