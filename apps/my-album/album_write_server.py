#!/usr/bin/env python3
"""My Album write service: upload photos into the album, move unwanted ones to a trash folder.

It runs beside the existing read-only file server and only handles /api/*. Route that path
of photos.vuducan.qzz.io to it through Cloudflare Tunnel (see README_UPLOAD.txt).

Nothing is ever deleted: "delete" moves the file into _Thung_rac/, which the web app hides.
Uploads and removals are recorded in album/changes.json so the web app shows them at once,
before the metadata index is rebuilt.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import sys
import tempfile
import threading
import unicodedata
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = 1
UPLOAD_FOLDER = "Tai_len"
TRASH_FOLDER = "_Thung_rac"
CHANGES_FILE = "album/changes.json"
THUMB_FOLDER = "thumbs"
THUMB_LONG_EDGE = 480
PROTECTED_TOP_FOLDERS = {"album", THUMB_FOLDER, TRASH_FOLDER}
IMAGE_EXTENSIONS = {
    "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp", "tif", "tiff",
    "dng", "cr2", "cr3", "arw", "nef", "raf", "rw2", "orf",
}
VIDEO_EXTENSIONS = {"mov", "mp4", "m4v", "3gp", "avi", "mkv", "webm"}
SIDECAR_EXTENSIONS = {"aae", "xmp"}
DEFAULT_ORIGINS = ["https://vuducan.qzz.io"]

try:  # Optional: richer metadata and real thumbnails for uploads.
    from PIL import Image, ImageOps

    try:
        import pillow_heif  # type: ignore

        pillow_heif.register_heif_opener()
    except Exception:
        pass
    HAVE_PILLOW = True
except Exception:
    HAVE_PILLOW = False

changes_lock = threading.Lock()


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def now_iso() -> str:
    return dt.datetime.now().replace(microsecond=0).isoformat()


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class Store:
    def __init__(self, root: Path):
        self.root = root.resolve()

    # --- paths ---------------------------------------------------------------
    def resolve_existing(self, relative: str) -> Path:
        """Find a file from a forward-slash path, ignoring Unicode form and case.

        Files copied from macOS keep decomposed (NFD) names, while the metadata index and
        the browser use composed (NFC) ones, so a plain join would miss them.
        """
        parts = [part for part in str(relative).replace("\\", "/").split("/") if part not in ("", ".")]
        if not parts or any(part == ".." for part in parts):
            raise ApiError(400, "Đường dẫn không hợp lệ.")
        if nfc(parts[0]).casefold() in {name.casefold() for name in PROTECTED_TOP_FOLDERS}:
            raise ApiError(400, "Không thể thao tác với thư mục hệ thống của album.")
        current = self.root
        for part in parts:
            wanted = nfc(part).casefold()
            try:
                match = next(entry for entry in os.scandir(current) if nfc(entry.name).casefold() == wanted)
            except (StopIteration, FileNotFoundError, NotADirectoryError):
                raise ApiError(404, f"Không tìm thấy {relative}.")
            current = Path(match.path)
        resolved = current.resolve()
        if self.root not in resolved.parents or not resolved.is_file():
            raise ApiError(404, f"Không tìm thấy {relative}.")
        return resolved

    def relative(self, path: Path) -> str:
        return nfc(path.resolve().relative_to(self.root).as_posix())

    @staticmethod
    def unique_path(path: Path) -> Path:
        if not path.exists():
            return path
        for index in range(2, 10_000):
            candidate = path.with_name(f"{path.stem} ({index}){path.suffix}")
            if not candidate.exists():
                return candidate
        raise ApiError(409, "Có quá nhiều tệp trùng tên.")

    # --- changes.json ----------------------------------------------------------
    def changes_path(self) -> Path:
        return self.root / CHANGES_FILE

    def read_changes(self) -> dict:
        try:
            data = json.loads(self.changes_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        return {
            "version": VERSION,
            "updated_at": data.get("updated_at", ""),
            "added": list(data.get("added") or []),
            "removed": list(data.get("removed") or []),
        }

    def write_changes(self, data: dict) -> None:
        data["updated_at"] = now_iso()
        target = self.changes_path()
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=".changes.", suffix=".tmp", dir=target.parent)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=1)
        os.replace(temporary, target)

    # --- upload ----------------------------------------------------------------
    def save_upload(self, name: str, stream, length: int, hints: dict) -> dict:
        name = safe_file_name(name)
        extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if extension in IMAGE_EXTENSIONS:
            kind = "image"
        elif extension in VIDEO_EXTENSIONS:
            kind = "video"
        else:
            raise ApiError(415, f"Không nhận tệp .{extension or '?'} — chỉ ảnh và video.")
        folder = self.root / UPLOAD_FOLDER / dt.date.today().strftime("%Y-%m")
        folder.mkdir(parents=True, exist_ok=True)
        target = self.unique_path(folder / name)

        descriptor, temporary = tempfile.mkstemp(prefix=".upload.", dir=folder)
        received = 0
        try:
            with os.fdopen(descriptor, "wb") as handle:
                while received < length:
                    chunk = stream.read(min(1024 * 1024, length - received))
                    if not chunk:
                        break
                    handle.write(chunk)
                    received += len(chunk)
            if received != length:
                raise ApiError(400, "Tải lên bị ngắt giữa chừng.")
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.remove(temporary)

        relative = self.relative(target)
        item_id = "u" + hashlib.sha1(relative.encode("utf-8")).hexdigest()[:15]
        entry = {
            "id": item_id,
            "name": target.name,
            "folder": self.relative(target.parent),
            "path": relative,
            "kind": kind,
            "ext": extension,
            "bytes": received,
            "uploaded_at": now_iso(),
        }
        details = image_details(target, self.root / THUMB_FOLDER / f"{item_id}.jpg") if kind == "image" else {}
        if details.get("thumb"):
            entry["thumb"] = f"{THUMB_FOLDER}/{item_id}.jpg"
        width = details.get("width") or positive_int(hints.get("w"))
        height = details.get("height") or positive_int(hints.get("h"))
        if width and height:
            entry["width"], entry["height"] = width, height
        if details.get("color"):
            entry["color"] = details["color"]
        taken_at = details.get("taken_at") or taken_from_last_modified(hints.get("lastModified"))
        if taken_at:
            entry["taken_at"] = taken_at

        with changes_lock:
            changes = self.read_changes()
            changes["added"] = [item for item in changes["added"] if item.get("path") != relative]
            changes["added"].append(entry)
            self.write_changes(changes)
        log(f"upload  {relative} ({received:,} bytes)")
        return entry

    # --- trash -----------------------------------------------------------------
    def trash(self, items: list) -> dict:
        moved, failed = [], []
        with changes_lock:
            changes = self.read_changes()
            for item in items[:2000]:
                requested = str((item or {}).get("path") or "")
                try:
                    source = self.resolve_existing(requested)
                    original = self.relative(source)
                    destination = self.unique_path(self.root / TRASH_FOLDER / original)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(source), str(destination))
                    for sidecar in sidecars_of(source):
                        shutil.move(str(sidecar), str(self.unique_path(destination.parent / sidecar.name)))
                    record = {
                        "id": str((item or {}).get("id") or ""),
                        "path": original,
                        "trashed_path": self.relative(destination),
                        "at": now_iso(),
                    }
                    changes["removed"].append(record)
                    changes["added"] = [entry for entry in changes["added"] if entry.get("path") != original]
                    moved.append(record)
                    log(f"trash   {original} -> {record['trashed_path']}")
                except ApiError as error:
                    failed.append({"path": requested, "error": str(error)})
                except OSError as error:
                    failed.append({"path": requested, "error": f"Không di chuyển được: {error.strerror or error}"})
            if moved:
                self.write_changes(changes)
        return {"moved": moved, "failed": failed}


def sidecars_of(source: Path) -> list:
    """Photos edited on an iPhone carry an .AAE file; it belongs with the photo."""
    try:
        return [
            entry for entry in source.parent.iterdir()
            if entry.is_file() and entry.stem.casefold() == source.stem.casefold()
            and entry.suffix[1:].lower() in SIDECAR_EXTENSIONS
        ]
    except OSError:
        return []


def safe_file_name(name: str) -> str:
    base = nfc(os.path.basename(str(name).replace("\\", "/")))
    cleaned = "".join("_" if char in '<>:"/\\|?*' or ord(char) < 32 else char for char in base).strip(" .")
    return cleaned[:180] or "upload"


def positive_int(value) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return 0
    return number if 0 < number < 100_000 else 0


def taken_from_last_modified(value) -> str:
    try:
        milliseconds = int(value)
    except (TypeError, ValueError):
        return ""
    if milliseconds <= 0:
        return ""
    return dt.datetime.fromtimestamp(milliseconds / 1000).replace(microsecond=0).isoformat()


def image_details(source: Path, thumb_target: Path) -> dict:
    if not HAVE_PILLOW:
        return {}
    try:
        with Image.open(source) as opened:
            exif = opened.getexif()
            image = ImageOps.exif_transpose(opened)
            width, height = image.size
            taken = exif.get_ifd(0x8769).get(36867) or exif.get(306)  # DateTimeOriginal, DateTime
            image = image.convert("RGB")
            color = image.resize((1, 1)).getpixel((0, 0))
            image.thumbnail((THUMB_LONG_EDGE, THUMB_LONG_EDGE))
            thumb_target.parent.mkdir(parents=True, exist_ok=True)
            image.save(thumb_target, "JPEG", quality=82)
        details = {"width": width, "height": height, "color": "#%02x%02x%02x" % color, "thumb": True}
        if isinstance(taken, str) and len(taken) >= 19:
            details["taken_at"] = taken[:10].replace(":", "-") + "T" + taken[11:19]
        return details
    except Exception as error:  # Unsupported format (RAW, HEIC without pillow-heif…): keep the hints.
        log(f"note    no thumbnail for {source.name}: {error}")
        return {}


def log(message: str) -> None:
    print(f"[{dt.datetime.now():%H:%M:%S}] {message}", flush=True)


class Handler(BaseHTTPRequestHandler):
    store: Store
    origins: set
    max_bytes: int
    require_access: bool
    server_version = "MyAlbumWrite/1"

    def log_message(self, *_):
        pass

    # --- responses -------------------------------------------------------------
    def cors_headers(self):
        origin = self.headers.get("Origin", "")
        if origin in self.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")

    def send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    # --- guards ----------------------------------------------------------------
    def check_caller(self, for_write: bool):
        if self.require_access and not self.headers.get("Cf-Access-Authenticated-User-Email"):
            raise ApiError(401, "Yêu cầu không đi qua Cloudflare Access.")
        # Browsers always send Origin on cross-site POSTs; requiring a known one blocks
        # other sites from triggering uploads or deletes with the user's cookie (CSRF).
        if for_write and self.headers.get("Origin", "") not in self.origins:
            raise ApiError(403, "Nguồn gửi yêu cầu không được phép.")

    def route(self):
        # http.server decodes the request line as latin-1; recover raw UTF-8 sent unescaped.
        try:
            raw = self.path.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            raw = self.path
        parsed = urllib.parse.urlsplit(raw)
        return parsed.path.rstrip("/"), urllib.parse.parse_qs(parsed.query)

    def do_GET(self):
        path, _ = self.route()
        try:
            if path != "/api/status":
                raise ApiError(404, "Không có đường dẫn này.")
            self.check_caller(for_write=False)
            self.send_json(200, {
                "ok": True,
                "version": VERSION,
                "upload_folder": UPLOAD_FOLDER,
                "trash_folder": TRASH_FOLDER,
                "max_bytes": self.max_bytes,
                "thumbnails": HAVE_PILLOW,
            })
        except ApiError as error:
            self.send_json(error.status, {"ok": False, "error": str(error)})

    def do_POST(self):
        path, query = self.route()
        try:
            self.check_caller(for_write=True)
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                raise ApiError(411, "Thiếu nội dung.")
            if length > self.max_bytes:
                raise ApiError(413, f"Tệp quá lớn (tối đa {self.max_bytes // (1024 * 1024)} MB).")
            if path == "/api/upload":
                hints = {key: values[0] for key, values in query.items() if values}
                entry = self.store.save_upload(hints.get("name", "upload"), self.rfile, length, hints)
                self.send_json(200, {"ok": True, "item": entry})
            elif path == "/api/trash":
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                items = payload.get("items") if isinstance(payload, dict) else None
                if not isinstance(items, list) or not items:
                    raise ApiError(400, "Không có mục nào để xoá.")
                self.send_json(200, {"ok": True, **self.store.trash(items)})
            else:
                raise ApiError(404, "Không có đường dẫn này.")
        except ApiError as error:
            self.send_json(error.status, {"ok": False, "error": str(error)})
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"ok": False, "error": "Dữ liệu gửi lên không hợp lệ."})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", required=True, help=r"Album root served at photos.vuducan.qzz.io, e.g. E:\Pictures")
    parser.add_argument("--host", default="127.0.0.1", help="Keep 127.0.0.1 so only cloudflared can reach it.")
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--origin", action="append", help="Web app origin allowed to write (repeatable).")
    parser.add_argument("--max-mb", type=int, default=95, help="Cloudflare's free plan rejects bodies over 100 MB.")
    parser.add_argument("--no-access-check", action="store_true",
                        help="Accept requests without the Cloudflare Access identity header (local testing only).")
    args = parser.parse_args()

    root = Path(args.root)
    if not (root / "album").is_dir():
        print(f"Không thấy thư mục album trong {root}. --root phải là thư mục gốc đang được chia sẻ.", file=sys.stderr)
        return 2
    Handler.store = Store(root)
    Handler.origins = set(args.origin or DEFAULT_ORIGINS)
    Handler.max_bytes = args.max_mb * 1024 * 1024
    Handler.require_access = not args.no_access_check
    log(f"My Album write service on http://{args.host}:{args.port}  root={Handler.store.root}")
    log(f"origins={sorted(Handler.origins)}  thumbnails={'Pillow' if HAVE_PILLOW else 'off (pip install pillow pillow-heif)'}")
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
