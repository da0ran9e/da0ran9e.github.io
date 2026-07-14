#!/usr/bin/env python3
"""Export complete album metadata to incremental JSON using ExifTool."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any


SCHEMA_VERSION = 1
DEFAULT_OUTPUT_NAME = "album-metadata.json"
CONFIG_NAME = "album-lan-config.json"
EXIFTOOL_URL = "https://exiftool.org/"

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".bmp",
    ".tif",
    ".tiff",
    ".heic",
    ".heif",
}
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".webm", ".avi", ".mkv"}
MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
SKIPPED_DIRECTORIES = {
    "thumbs",
    "_thumbnails",
    "_my-album",
    ".my-album-cache",
    "__pycache__",
}


@dataclass(frozen=True)
class MediaFile:
    path: Path
    relative: str
    media_type: str
    size: int
    modified: int
    fingerprint: str

    def album_fields(self) -> dict[str, Any]:
        relative_path = PurePosixPath(self.relative)
        folder = relative_path.parent.as_posix()
        if folder == ".":
            folder = ""
        return {
            "path": self.relative,
            "name": relative_path.name,
            "folder": folder,
            "type": self.media_type,
            "extension": self.path.suffix.lower().lstrip("."),
            "bytes": self.size,
            "modified": self.modified,
            "fingerprint": self.fingerprint,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract complete image and video metadata to album-metadata.json."
    )
    parser.add_argument(
        "source",
        nargs="?",
        type=Path,
        help="Album directory. Uses album-lan-config.json or opens a folder picker when omitted.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help=f"Output path relative to SOURCE (default: {DEFAULT_OUTPUT_NAME}).",
    )
    parser.add_argument(
        "--exiftool",
        help="Path or command name for exiftool.exe.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Read metadata from every media file instead of reusing unchanged entries.",
    )
    parser.add_argument(
        "--fast",
        action="store_true",
        help="Skip embedded documents and streaming metadata (ExifTool -ee).",
    )
    parser.add_argument(
        "--include-binary",
        action="store_true",
        help="Include binary metadata as base64. This can make the JSON much larger.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Indent the JSON for manual reading. Compact JSON is the default.",
    )
    parser.add_argument(
        "--no-pause",
        action="store_true",
        help="Do not wait for Enter when SOURCE was omitted.",
    )
    return parser.parse_args()


def load_saved_source() -> Path | None:
    config_path = Path(__file__).with_name(CONFIG_NAME)
    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
        source = Path(payload["source"]).expanduser().resolve()
        return source if source.is_dir() else None
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def choose_source() -> Path | None:
    selected = ""
    try:
        from tkinter import Tk, filedialog

        root = Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(title="Chon thu muc album")
        root.destroy()
    except (ImportError, RuntimeError):
        try:
            selected = input("Album directory: ").strip().strip('"')
        except (EOFError, OSError):
            return None

    if not selected:
        return None
    source = Path(selected).expanduser().resolve()
    return source if source.is_dir() else None


def resolve_source(requested: Path | None) -> Path:
    if requested is not None:
        source = requested.expanduser().resolve()
    else:
        source = load_saved_source() or choose_source()
        if source is None:
            raise ValueError("No album directory was selected.")

    if not source.is_dir():
        raise ValueError(f"Album directory does not exist: {source}")
    return source


def resolve_output(source: Path, requested: Path | None) -> Path:
    if requested is None:
        output = source / DEFAULT_OUTPUT_NAME
    else:
        output = requested.expanduser()
        if not output.is_absolute():
            output = source / output
        output = output.resolve()

    if output.exists() and output.is_dir():
        raise ValueError(f"Output path is a directory: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    return output


def find_exiftool(requested: str | None) -> Path:
    candidates: list[str | Path] = []
    if requested:
        candidates.append(requested)
    candidates.append(Path(__file__).with_name("exiftool.exe"))
    candidates.extend(["exiftool.exe", "exiftool"])

    for candidate in candidates:
        path = Path(candidate).expanduser()
        if path.is_file():
            return path.resolve()
        located = shutil.which(str(candidate))
        if located:
            return Path(located).resolve()

    paused_executable = Path(__file__).with_name("exiftool(-k).exe")
    if paused_executable.is_file():
        raise ValueError(
            "Rename exiftool(-k).exe to exiftool.exe before running this script."
        )
    raise ValueError(
        "ExifTool was not found. Put exiftool.exe next to this script or add it "
        f"to PATH. Download: {EXIFTOOL_URL}"
    )


def exiftool_version(executable: Path) -> str:
    try:
        result = subprocess.run(
            [str(executable), "-ver"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            check=False,
        )
    except OSError as error:
        raise ValueError(f"Cannot start ExifTool: {error}") from error

    version = result.stdout.strip()
    if result.returncode != 0 or not version:
        detail = result.stderr.strip() or f"exit code {result.returncode}"
        raise ValueError(f"ExifTool check failed: {detail}")
    return version


def scan_media(source: Path) -> dict[str, MediaFile]:
    media: dict[str, MediaFile] = {}
    for root, directory_names, file_names in os.walk(source):
        directory_names[:] = [
            name
            for name in directory_names
            if not name.startswith(".") and name.casefold() not in SKIPPED_DIRECTORIES
        ]
        root_path = Path(root)
        for file_name in file_names:
            if file_name.startswith("."):
                continue
            path = root_path / file_name
            suffix = path.suffix.lower()
            if suffix not in MEDIA_EXTENSIONS:
                continue
            try:
                stat = path.stat()
            except OSError as error:
                print(f"SKIP {path}: {error}", file=sys.stderr)
                continue
            if not path.is_file() or stat.st_size <= 0:
                continue

            relative = path.relative_to(source).as_posix()
            media_type = "image" if suffix in IMAGE_EXTENSIONS else "video"
            media[relative] = MediaFile(
                path=path,
                relative=relative,
                media_type=media_type,
                size=stat.st_size,
                modified=int(stat.st_mtime),
                fingerprint=f"{stat.st_size}:{stat.st_mtime_ns}",
            )
    return media


def load_previous(output: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(output.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION:
        return None
    if not isinstance(payload.get("items"), list):
        return None
    return payload


def item_relative_path(item: Any) -> str | None:
    if not isinstance(item, dict):
        return None
    album = item.get("_album")
    if isinstance(album, dict) and isinstance(album.get("path"), str):
        return normalize_relative_path(album["path"])
    for key, value in item.items():
        if isinstance(value, str) and key.rsplit(":", 1)[-1] == "SourceFile":
            return normalize_relative_path(value)
    return None


def normalize_relative_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return PurePosixPath(normalized).as_posix()


def build_previous_index(payload: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if payload is None:
        return {}
    indexed: dict[str, dict[str, Any]] = {}
    for item in payload["items"]:
        relative = item_relative_path(item)
        if relative is not None and isinstance(item, dict):
            indexed[relative] = item
    return indexed


def item_has_error(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    return any(
        key.rsplit(":", 1)[-1] == "Error" and value not in (None, "", [], {})
        for key, value in item.items()
    )


def options_match(payload: dict[str, Any] | None, args: argparse.Namespace) -> bool:
    if payload is None:
        return False
    generator = payload.get("generator")
    if not isinstance(generator, dict):
        return False
    options = generator.get("options")
    return options == {
        "embedded": not args.fast,
        "binary": args.include_binary,
        "groups": "1:3:4",
    }


def changed_media(
    current: dict[str, MediaFile],
    previous: dict[str, dict[str, Any]],
    force: bool,
) -> list[MediaFile]:
    changed: list[MediaFile] = []
    for relative, media_file in current.items():
        old_item = previous.get(relative)
        old_album = old_item.get("_album") if isinstance(old_item, dict) else None
        old_fingerprint = old_album.get("fingerprint") if isinstance(old_album, dict) else None
        if force or item_has_error(old_item) or old_fingerprint != media_file.fingerprint:
            changed.append(media_file)
    return sorted(changed, key=lambda item: item.relative.casefold())


def write_argument_file(media_files: list[MediaFile]) -> Path:
    descriptor, name = tempfile.mkstemp(prefix="my-album-files-", suffix=".txt")
    path = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            for media_file in media_files:
                stream.write(f"./{media_file.relative}\n")
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path


def build_exiftool_command(
    executable: Path,
    argument_file: Path,
    args: argparse.Namespace,
) -> list[str]:
    command = [
        str(executable),
        "-json",
        "-G1:3:4",
        "-s",
        "-struct",
        "-sort",
        "-a",
        "-charset",
        "filename=UTF8",
        "-api",
        "LargeFileSupport=1",
    ]
    command.append("-U" if args.include_binary else "-u")
    if not args.fast:
        command.append("-ee")
    if args.include_binary:
        command.append("-b")
    command.extend(["-@", str(argument_file)])
    return command


def run_exiftool(
    executable: Path,
    source: Path,
    media_files: list[MediaFile],
    args: argparse.Namespace,
) -> tuple[list[dict[str, Any]], int, str]:
    if not media_files:
        return [], 0, ""

    argument_file = write_argument_file(media_files)
    descriptor, json_name = tempfile.mkstemp(prefix="my-album-exiftool-", suffix=".json")
    os.close(descriptor)
    json_path = Path(json_name)
    command = build_exiftool_command(executable, argument_file, args)

    try:
        with json_path.open("wb") as output_stream:
            process = subprocess.Popen(
                command,
                cwd=source,
                stdout=output_stream,
                stderr=subprocess.PIPE,
            )
            try:
                _, stderr_bytes = process.communicate()
            except KeyboardInterrupt:
                process.terminate()
                process.wait(timeout=10)
                raise

        stderr = (stderr_bytes or b"").decode("utf-8", errors="replace").strip()
        try:
            payload = json.loads(json_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise ValueError(f"ExifTool returned invalid JSON: {error}") from error
        if not isinstance(payload, list):
            raise ValueError("ExifTool JSON root is not an array.")
        items = [item for item in payload if isinstance(item, dict)]
        return items, process.returncode, stderr
    finally:
        argument_file.unlink(missing_ok=True)
        json_path.unlink(missing_ok=True)


def merge_items(
    current: dict[str, MediaFile],
    previous: dict[str, dict[str, Any]],
    changed: list[MediaFile],
    extracted: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    merged = {
        relative: item
        for relative, item in previous.items()
        if relative in current
    }
    extracted_by_path: dict[str, dict[str, Any]] = {}
    for item in extracted:
        relative = item_relative_path(item)
        if relative is not None:
            extracted_by_path[relative] = item

    missing = 0
    for media_file in changed:
        item = extracted_by_path.get(media_file.relative)
        if item is None:
            item = {
                "SourceFile": media_file.relative,
                "Error": "ExifTool returned no metadata for this file.",
            }
            missing += 1
        item["_album"] = media_file.album_fields()
        merged[media_file.relative] = item

    for relative, item in list(merged.items()):
        media_file = current[relative]
        item["_album"] = media_file.album_fields()

    return [merged[key] for key in sorted(merged, key=str.casefold)], missing


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def write_output(
    output: Path,
    items: list[dict[str, Any]],
    current: dict[str, MediaFile],
    changed_count: int,
    reused_count: int,
    removed_count: int,
    version: str,
    args: argparse.Namespace,
) -> None:
    error_count = sum(item_has_error(item) for item in items)
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": utc_now(),
        "source": ".",
        "generator": {
            "name": "My Album metadata extractor",
            "exiftoolVersion": version,
            "options": {
                "embedded": not args.fast,
                "binary": args.include_binary,
                "groups": "1:3:4",
            },
        },
        "summary": {
            "total": len(items),
            "images": sum(media.media_type == "image" for media in current.values()),
            "videos": sum(media.media_type == "video" for media in current.values()),
            "scanned": changed_count,
            "reused": reused_count,
            "removed": removed_count,
            "errors": error_count,
        },
        "items": items,
    }

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output.name}.", suffix=".tmp", dir=output.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            if args.pretty:
                json.dump(payload, stream, ensure_ascii=False, indent=2)
            else:
                json.dump(payload, stream, ensure_ascii=False, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


def run(args: argparse.Namespace) -> int:
    source = resolve_source(args.source)
    output = resolve_output(source, args.output)
    executable = find_exiftool(args.exiftool)
    version = exiftool_version(executable)

    print(f"Album:     {source}")
    print(f"Output:    {output}")
    print(f"ExifTool:  {executable} ({version})")
    print("Scanning file list...", flush=True)

    current = scan_media(source)
    previous_payload = load_previous(output)
    previous = build_previous_index(previous_payload)
    force = args.force or not options_match(previous_payload, args)
    changed = changed_media(current, previous, force)
    removed_count = len(set(previous) - set(current))
    reused_count = len(current) - len(changed)

    print(
        f"Media: {len(current)} total, {len(changed)} to read, "
        f"{reused_count} unchanged, {removed_count} removed",
        flush=True,
    )

    extracted, exiftool_code, stderr = run_exiftool(
        executable=executable,
        source=source,
        media_files=changed,
        args=args,
    )
    if stderr:
        print(stderr, file=sys.stderr)

    items, missing_count = merge_items(current, previous, changed, extracted)
    error_count = sum(item_has_error(item) for item in items)
    write_output(
        output=output,
        items=items,
        current=current,
        changed_count=len(changed),
        reused_count=reused_count,
        removed_count=removed_count,
        version=version,
        args=args,
    )

    size_mb = output.stat().st_size / (1024 * 1024)
    print(f"Done: {len(items)} items written to {output} ({size_mb:.1f} MB)")
    if missing_count:
        print(f"Warning: {missing_count} files returned no metadata.", file=sys.stderr)
    if error_count > missing_count:
        print(
            f"Warning: ExifTool reported errors for {error_count - missing_count} files.",
            file=sys.stderr,
        )
    if exiftool_code != 0:
        print(
            f"Warning: ExifTool exited with code {exiftool_code}; JSON was still saved.",
            file=sys.stderr,
        )
    return 1 if error_count or exiftool_code != 0 else 0


def main() -> int:
    args = parse_args()
    should_pause = args.source is None and not args.no_pause
    try:
        return run(args)
    except KeyboardInterrupt:
        print("\nStopped. The previous JSON file was not replaced.", file=sys.stderr)
        return 130
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2
    finally:
        if should_pause and sys.stdin is not None and sys.stdin.isatty():
            try:
                input("Press Enter to close...")
            except (EOFError, OSError):
                pass


if __name__ == "__main__":
    raise SystemExit(main())
