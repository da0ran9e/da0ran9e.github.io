"""
Incrementally extend album-metadata.json with ExifTool data for NEW files only.

Matches the original dump's format exactly (recorded in its own header):
    exiftool -json -G1:3:4 -ee        (groups 1:3:4, embedded tags, no binary)

Each new record gets the same `_album` block the existing records carry.

Usage:
    py exif_update.py            # extract for every file missing from the dump
    py exif_update.py --limit 50 # try a small batch first
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

# `-ee` on long .MOV files explodes: ExifTool emits per-frame sub-documents such
# as "Track7:Doc26980:Copy26977:LivePhotoInfo" - tens of thousands per file,
# 17 MB for a single record. None of it is useful for the album, so it is
# dropped on ingest. Same container/binary noise the archive build already filters.
JUNK = re.compile(
    r'(Track\d|:Doc\d|:Copy\d|Unknown_|Sample|ChunkOffset|Handler|MatrixStructure|'
    r'HeaderVersion|TimeScale|GraphicsMode|OpColor|VendorID|MediaData|'
    r'MediaLanguage|TimeToSample|CurrentTime|Preferred|Selection|PosterTime|'
    r'NextTrackID|MovieHeader|PreviewTime|PreviewDuration|CompositionTime|'
    r'CompositionToDecode|SyncSample|SampleToChunk|SampleSizes|SampleGroup|'
    r'DisposableSamples|edts|alis|esds|mp4a|tgas|hvcC|vmap|'
    r'LinearizationTable|OpcodeList|ColorMatrix|CameraCalibration)')
FIELD_CAP = 8 * 1024          # drop any single field larger than this
OVERSIZE_RECORD = 100 * 1024  # existing records above this get slimmed too


def slim(record):
    """Strip container/per-frame noise and oversized fields. Keeps `_album`."""
    out = {}
    for k, v in record.items():
        if k == "_album":
            out[k] = v
            continue
        if JUNK.search(k):
            continue
        if isinstance(v, str) and v.startswith("(Binary data "):
            continue
        if len(json.dumps(v, ensure_ascii=False)) > FIELD_CAP:
            continue
        out[k] = v
    return out

# Paths come from the environment so no machine-specific path lives in the
# repo:  ALBUM_ROOT  = folder with the photos (thumbs/ and album/ go inside)
#        ALBUM_INDEX = folder for index.db and the ExifTool dump
ROOT = os.environ.get("ALBUM_ROOT") or os.getcwd()
INDEX_DIR = os.environ.get("ALBUM_INDEX") or os.path.join(ROOT, ".album-index")
DUMP = os.path.join(INDEX_DIR, "album-metadata.json")
BATCH = 250

IMG_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".heic",
            ".heif", ".cr2", ".nef", ".arw", ".dng"}
VID_EXTS = {".mov", ".mp4", ".m4v", ".avi", ".mkv", ".wmv", ".3gp", ".webm",
            ".mts", ".m2ts"}
ALL_EXTS = IMG_EXTS | VID_EXTS
JUNK_FILES = {".DS_Store", "Thumbs.db", "desktop.ini"}

# Taken from PATH; set ALBUM_EXIFTOOL if ExifTool is installed elsewhere.
EXIFTOOL = shutil.which("exiftool") or os.environ.get("ALBUM_EXIFTOOL", "")


def real_media():
    """All genuine media under ROOT, skipping thumbs, AppleDouble stubs and OS junk."""
    out = []
    for dirpath, _, filenames in os.walk(ROOT):
        parts = dirpath.split(os.sep)
        if "thumbs" in parts or ".metadata" in parts:
            continue
        for fn in filenames:
            if fn.startswith("._") or fn in JUNK_FILES:
                continue
            if os.path.splitext(fn)[1].lower() in ALL_EXTS:
                out.append(os.path.join(dirpath, fn))
    return out


def album_block(abspath):
    relpath = os.path.relpath(abspath, ROOT).replace("\\", "/")
    st = os.stat(abspath)
    ext = os.path.splitext(abspath)[1].lower()
    return {
        "path": relpath,
        "name": os.path.basename(abspath),
        "folder": os.path.dirname(relpath),
        "type": "video" if ext in VID_EXTS else "image",
        "extension": ext.lstrip("."),
        "bytes": st.st_size,
        "modified": int(st.st_mtime),
        "fingerprint": f"{st.st_size}:{st.st_mtime_ns}",
    }


def run_exiftool(paths):
    """Return list of ExifTool JSON records for `paths`."""
    fd, argfile = tempfile.mkstemp(suffix=".txt", text=True)
    os.close(fd)
    try:
        with open(argfile, "w", encoding="utf-8") as f:
            for p in paths:
                f.write(p + "\n")
        cmd = [EXIFTOOL, "-charset", "filename=utf8", "-json",
               "-G1:3:4", "-ee", "-@", argfile]
        res = subprocess.run(cmd, capture_output=True)
        out = res.stdout.decode("utf-8", "replace").strip()
        if not out:
            err = res.stderr.decode("utf-8", "replace")[:500]
            print(f"  [!] no output from exiftool: {err}", file=sys.stderr)
            return []
        return json.loads(out)
    finally:
        os.unlink(argfile)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="only process N new files")
    args = ap.parse_args()

    if not EXIFTOOL or not os.path.exists(EXIFTOOL):
        sys.exit("ERROR: ExifTool not found. Install it and put it on PATH, "
                 "or set ALBUM_EXIFTOOL to its full path.")

    print("loading existing dump...", flush=True)
    with open(DUMP, encoding="utf-8") as f:
        dump = json.load(f)
    items = dump["items"]
    have = {it["_album"]["path"] for it in items if it.get("_album")}
    print(f"  existing records: {len(items)}")

    # Repair any record already bloated by per-frame embedded data.
    slimmed = saved = 0
    for i, it in enumerate(items):
        n = len(json.dumps(it, ensure_ascii=False))
        if n > OVERSIZE_RECORD:
            items[i] = slim(it)
            saved += n - len(json.dumps(items[i], ensure_ascii=False))
            slimmed += 1
    if slimmed:
        print(f"  slimmed {slimmed} oversized record(s), freed {saved/1024/1024:.1f} MB")

    files = real_media()
    missing = [p for p in files
               if os.path.relpath(p, ROOT).replace("\\", "/") not in have]
    print(f"  media on disk   : {len(files)}")
    print(f"  missing from dump: {len(missing)}")
    if args.limit:
        missing = missing[:args.limit]
        print(f"  (limited to {len(missing)})")
    if not missing:
        print("nothing to do.")
        return

    added = 0
    for i in range(0, len(missing), BATCH):
        chunk = missing[i:i + BATCH]
        records = run_exiftool(chunk)
        by_src = {}
        for r in records:
            src = r.get("SourceFile", "")
            by_src[os.path.normcase(os.path.normpath(src))] = r
        for p in chunk:
            r = by_src.get(os.path.normcase(os.path.normpath(p)))
            if r is None:
                continue
            r["_album"] = album_block(p)
            items.append(slim(r))
            added += 1
        print(f"  [{min(i+BATCH, len(missing))}/{len(missing)}] added={added}", flush=True)

    imgs = sum(1 for it in items if it.get("_album", {}).get("type") == "image")
    vids = sum(1 for it in items if it.get("_album", {}).get("type") == "video")
    dump["generatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    dump["summary"] = {"total": len(items), "images": imgs, "videos": vids,
                       "scanned": len(items), "reused": len(items) - added,
                       "removed": 0, "errors": 0}

    tmp = DUMP + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(dump, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, DUMP)
    print(f"\nDONE: +{added} records -> {len(items)} total "
          f"({imgs} images, {vids} videos)")
    print(f"      {DUMP}  ({os.path.getsize(DUMP)/1024/1024:.1f} MB)")


if __name__ == "__main__":
    main()
