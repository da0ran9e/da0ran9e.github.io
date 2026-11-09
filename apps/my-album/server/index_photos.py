"""
Scan the album folder, extract metadata, and generate JPEG thumbnails.

- Thumbnails go to  <ALBUM_ROOT>/thumbs/<id>.jpg  so the album server can serve
  them alongside the originals.
- Metadata is staged in a SQLite DB (<ALBUM_INDEX>/index.db) so the run is
  RESUMABLE: already-processed files are skipped on the next pass.

Configure with environment variables:
    ALBUM_ROOT   folder holding the photos            (default: current folder)
    ALBUM_INDEX  folder for index.db                  (default: <ROOT>/.album-index)

Usage:
    python index_photos.py                # full run (resumable)
    python index_photos.py --sample 8     # process only 8 files per extension
    python index_photos.py --reset        # wipe DB + thumbs and start clean
"""
import argparse
import hashlib
import io
import os
import sqlite3
import sys
import time
from datetime import datetime

from PIL import Image, ImageOps, ExifTags, ImageFile
import pillow_heif
import rawpy
import av
import av.error

pillow_heif.register_heif_opener()
ImageFile.LOAD_TRUNCATED_IMAGES = True  # tolerate slightly-truncated JPEGs
av.logging.set_level(av.logging.PANIC)  # silence noisy ffmpeg warnings

# Paths come from the environment so no machine-specific path lives in the
# repo:  ALBUM_ROOT  = folder with the photos (thumbs/ and album/ go inside)
#        ALBUM_INDEX = folder for index.db and the ExifTool dump
ROOT = os.environ.get("ALBUM_ROOT") or os.getcwd()
INDEX_DIR = os.environ.get("ALBUM_INDEX") or os.path.join(ROOT, ".album-index")
THUMB_DIRNAME = "thumbs"                       # visible folder inside Pictures
THUMBS = os.path.join(ROOT, THUMB_DIRNAME)
DB = os.path.join(INDEX_DIR, "index.db")
THUMB_MAX = 240          # longest side of thumbnail, px (smaller = lighter)
THUMB_QUALITY = 72

IMG_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".heic", ".heif"}
RAW_EXTS = {".cr2", ".nef", ".arw", ".dng"}
VIDEO_EXTS = {".mov", ".mp4", ".m4v", ".avi", ".mkv", ".wmv", ".3gp", ".webm", ".mts", ".m2ts"}
ALL_EXTS = IMG_EXTS | RAW_EXTS | VIDEO_EXTS
JUNK_FILES = {".DS_Store", "Thumbs.db", "desktop.ini"}
# Top-level folders never scanned. "_Thung_rac" is the trash the write service
# (album_write_server.py) moves removed photos into - re-indexing it would
# recreate thumbnails for pictures the user deleted. "album" holds metadata.
SKIP_DIRS = {THUMB_DIRNAME, "_Thung_rac", "album", ".metadata"}

# EXIF tag id lookups
TAG = {v: k for k, v in ExifTags.TAGS.items()}
DTO = TAG.get("DateTimeOriginal")
MAKE = TAG.get("Make")
MODEL = TAG.get("Model")


def make_id(relpath: str) -> str:
    return hashlib.sha1(relpath.encode("utf-8", "surrogatepass")).hexdigest()[:16]


def init_db(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS photos (
            id            TEXT PRIMARY KEY,
            relpath       TEXT UNIQUE,
            filename      TEXT,
            folder        TEXT,
            ext           TEXT,
            bytes         INTEGER,
            width         INTEGER,
            height        INTEGER,
            taken_at      TEXT,
            camera_make   TEXT,
            camera_model  TEXT,
            avg_color     TEXT,
            mtime         TEXT,
            thumb         TEXT,
            kind          TEXT,
            duration      REAL,
            indexed_at    TEXT
        )
    """)
    # migrate older DBs that predate the kind/duration columns
    cols = {r[1] for r in conn.execute("PRAGMA table_info(photos)")}
    if "kind" not in cols:
        conn.execute("ALTER TABLE photos ADD COLUMN kind TEXT")
        conn.execute("UPDATE photos SET kind='image' WHERE kind IS NULL")
    if "duration" not in cols:
        conn.execute("ALTER TABLE photos ADD COLUMN duration REAL")
    conn.commit()


def parse_exif_dt(s):
    try:
        return datetime.strptime(s, "%Y:%m:%d %H:%M:%S").isoformat()
    except Exception:
        return None


def load_image(path, ext):
    """Return a PIL RGB image (orientation-corrected) + (width, height) + exif dict."""
    exif = {}
    if ext in RAW_EXTS:
        # Use the embedded JPEG preview for RAW files (fast, browser-friendly).
        with rawpy.imread(path) as raw:
            try:
                thumb = raw.extract_thumb()
                if thumb.format == rawpy.ThumbFormat.JPEG:
                    im = Image.open(io.BytesIO(thumb.data))
                else:  # bitmap
                    im = Image.fromarray(thumb.data)
            except Exception:
                rgb = raw.postprocess()
                im = Image.fromarray(rgb)
        im = ImageOps.exif_transpose(im).convert("RGB")
        return im, im.size, exif
    else:
        im = Image.open(path)
        raw_exif = None
        try:
            raw_exif = im.getexif()
        except Exception:
            raw_exif = None
        if raw_exif:
            # DateTimeOriginal lives in the Exif sub-IFD (0x8769); DateTime (306)
            # is the IFD0 fallback.
            try:
                sub = raw_exif.get_ifd(0x8769)
            except Exception:
                sub = {}
            dt = sub.get(DTO) or raw_exif.get(306)
            if dt:
                exif["taken_at"] = parse_exif_dt(str(dt))
            make = raw_exif.get(MAKE)
            model = raw_exif.get(MODEL)
            if make:
                exif["make"] = str(make).strip("\x00 ").strip()
            if model:
                exif["model"] = str(model).strip("\x00 ").strip()
        im = ImageOps.exif_transpose(im).convert("RGB")
        return im, im.size, exif


def load_video(path):
    """Extract a representative frame as a PIL RGB image, plus metadata.
    Returns (img, (w, h), meta) where meta has taken_at + duration."""
    meta = {}
    with av.open(path) as container:
        vs = container.streams.video[0]
        dur = float(container.duration) / av.time_base if container.duration else None
        meta["duration"] = round(dur, 2) if dur else None
        ct = container.metadata.get("creation_time")
        if ct:
            # e.g. 2025-08-26T18:08:16.000000Z -> 2025-08-26T18:08:16
            meta["taken_at"] = ct.replace("Z", "").split(".")[0]

        # seek to ~1s in (or the middle of very short clips) for a nicer frame
        target = 1.0 if (dur is None or dur > 2) else (dur / 2 if dur else 0)
        try:
            container.seek(int(target * av.time_base))
        except Exception:
            pass
        frame = None
        for f in container.decode(video=0):
            frame = f
            break
        if frame is None:  # fallback: first frame from a fresh open
            container.seek(0)
            for f in container.decode(video=0):
                frame = f
                break
        img = frame.to_image().convert("RGB")

        # apply display rotation if present (iPhone portrait clips)
        rot = None
        try:
            rot = vs.metadata.get("rotate")
        except Exception:
            pass
        if rot:
            try:
                a = int(rot) % 360
                if a == 90:
                    img = img.rotate(-90, expand=True)
                elif a == 180:
                    img = img.rotate(180, expand=True)
                elif a == 270:
                    img = img.rotate(90, expand=True)
            except Exception:
                pass
    return img, img.size, meta


def avg_hex(im):
    small = im.resize((1, 1))
    r, g, b = small.getpixel((0, 0))[:3]
    return f"#{r:02x}{g:02x}{b:02x}"


def process(path, conn, force=False):
    relpath = os.path.relpath(path, ROOT).replace("\\", "/")
    pid = make_id(relpath)
    row = conn.execute("SELECT 1 FROM photos WHERE id=?", (pid,)).fetchone()
    thumb_rel = f"{THUMB_DIRNAME}/{pid}.jpg"
    thumb_abs = os.path.join(THUMBS, f"{pid}.jpg")
    if row and os.path.exists(thumb_abs) and not force:
        return "skip"

    ext = os.path.splitext(path)[1].lower()
    st = os.stat(path)
    if ext in VIDEO_EXTS:
        kind = "video"
        im, (w, h), meta = load_video(path)
    else:
        kind = "image"
        im, (w, h), meta = load_image(path, ext)

    thumb = im.copy()
    thumb.thumbnail((THUMB_MAX, THUMB_MAX))
    thumb.save(thumb_abs, "JPEG", quality=THUMB_QUALITY)
    color = avg_hex(thumb)

    conn.execute(
        """INSERT OR REPLACE INTO photos
           (id, relpath, filename, folder, ext, bytes, width, height,
            taken_at, camera_make, camera_model, avg_color, mtime, thumb,
            kind, duration, indexed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            pid, relpath, os.path.basename(path),
            os.path.dirname(relpath), ext, st.st_size, w, h,
            meta.get("taken_at"), meta.get("make"), meta.get("model"),
            color, datetime.fromtimestamp(st.st_mtime).isoformat(),
            thumb_rel, kind, meta.get("duration"), datetime.now().isoformat(),
        ),
    )
    return "done"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0, help="max files per extension (0 = all)")
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()

    if args.reset:
        for p in (DB,):
            if os.path.exists(p):
                os.remove(p)
        if os.path.isdir(THUMBS):
            for f in os.listdir(THUMBS):
                try:
                    os.remove(os.path.join(THUMBS, f))
                except Exception:
                    pass
        print("reset done")

    os.makedirs(INDEX_DIR, exist_ok=True)
    os.makedirs(THUMBS, exist_ok=True)
    conn = sqlite3.connect(DB)
    init_db(conn)

    # gather files
    files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        if SKIP_DIRS & set(dirpath.split(os.sep)):
            continue
        for fn in filenames:
            # Skip macOS AppleDouble stubs ("._IMG_1234.HEIC"): ~4 KB resource-fork
            # companions created when copying from a Mac, not real media. Also skip
            # OS junk files.
            if fn.startswith("._") or fn in JUNK_FILES:
                continue
            if os.path.splitext(fn)[1].lower() in ALL_EXTS:
                files.append(os.path.join(dirpath, fn))

    if args.sample:
        by_ext = {}
        picked = []
        for f in files:
            e = os.path.splitext(f)[1].lower()
            by_ext.setdefault(e, 0)
            if by_ext[e] < args.sample:
                by_ext[e] += 1
                picked.append(f)
        files = picked

    total = len(files)
    print(f"Found {total} images to consider. Thumbs -> {THUMBS}")
    done = skip = err = 0
    t0 = time.time()
    for i, path in enumerate(files, 1):
        try:
            r = process(path, conn)
            if r == "done":
                done += 1
            else:
                skip += 1
        except Exception as e:
            err += 1
            print(f"  ERR {path}: {e}", file=sys.stderr)
        if i % 100 == 0 or i == total:
            conn.commit()
            rate = i / max(time.time() - t0, 0.001)
            print(f"  [{i}/{total}] done={done} skip={skip} err={err}  {rate:.1f}/s", flush=True)
    conn.commit()
    conn.close()
    print(f"FINISHED: done={done} skip={skip} err={err} in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
