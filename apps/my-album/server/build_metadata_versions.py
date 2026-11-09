"""
Build 3 metadata versions that SHARE ONE canonical field-name scheme.

  album/metadata-min.json      - tiny, for layout/first paint  (subset of fields)
  album/metadata-full.json     - all useful fields, normalized (GPS in decimal)
  album/metadata-archive.json  - full + `raw` (every non-junk ExifTool field)

Source of record identity/thumb/color = SQLite index.db (has all thumbnailed
items). Rich EXIF is joined from album-metadata.json by file path (_album.path).

Run:  py build_metadata_versions.py
"""
import gzip
import json
import os
import re
import sqlite3
from datetime import datetime, timezone

# Paths come from the environment so no machine-specific path lives in the
# repo:  ALBUM_ROOT  = folder with the photos (thumbs/ and album/ go inside)
#        ALBUM_INDEX = folder for index.db and the ExifTool dump
ROOT = os.environ.get("ALBUM_ROOT") or os.getcwd()
INDEX_DIR = os.environ.get("ALBUM_INDEX") or os.path.join(ROOT, ".album-index")
DB = os.path.join(INDEX_DIR, "index.db")
EXIF_JSON = os.path.join(INDEX_DIR, "album-metadata.json")
OUTDIR = os.path.join(ROOT, "album")

# Fields kept in the MINIMAL version (names identical to the other versions).
MIN_FIELDS = ["id", "name", "folder", "kind", "ext", "width", "height",
              "color", "thumb", "duration", "taken_at", "gps_lat", "gps_lng"]

# Junk patterns excluded from the archive `raw` block.
JUNK = re.compile(
    r'(Track\d|:Copy\d|Unknown_|Sample|ChunkOffset|Handler|MatrixStructure|'
    r'HeaderVersion|TimeScale|GraphicsMode|OpColor|VendorID|MediaData|'
    r'MediaLanguage|TimeToSample|CurrentTime|Preferred|Selection|PosterTime|'
    r'NextTrackID|MovieHeader|PreviewTime|PreviewDuration|CompositionTime|'
    r'CompositionToDecode|SyncSample|SampleToChunk|SampleSizes|SampleGroup|'
    r'DisposableSamples|edts|alis|esds|mp4a|tgas|hvcC|vmap)')


def is_binval(v):
    return isinstance(v, str) and v.startswith("(Binary data ")


def first(it, *keys):
    for k in keys:
        v = it.get(k)
        if v is not None and not (isinstance(v, str) and v.strip() == ""):
            return v
    return None


def iso_date(s):
    """ExifTool '2023:05:17 08:51:48[.sss][+07:00]' -> '2023-05-17T08:51:48'."""
    if not s:
        return None
    m = re.match(r'(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})', str(s))
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}T{m.group(4)}:{m.group(5)}:{m.group(6)}"
    return None


_DMS = re.compile(r"(\d+(?:\.\d+)?)\s*deg\s*(\d+(?:\.\d+)?)'?\s*(\d+(?:\.\d+)?)\"?\s*([NSEW])")


def dms_to_dec(s):
    m = _DMS.search(str(s))
    if not m:
        return None
    d, mi, se, ref = m.groups()
    val = float(d) + float(mi) / 60 + float(se) / 3600
    if ref in ("S", "W"):
        val = -val
    return round(val, 6)


def num(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return v


def build_canonical(sq, ex):
    """sq = sqlite Row (authoritative id/thumb/color/dims); ex = exif dict or {}."""
    rec = {}
    def put(k, v):
        if v is not None and not (isinstance(v, str) and v.strip() == ""):
            rec[k] = v

    put("id", sq["id"])
    put("name", sq["filename"])
    put("folder", sq["folder"])
    put("path", sq["relpath"])
    put("kind", sq["kind"])
    put("ext", (sq["ext"] or "").lstrip("."))
    put("mime", ex.get("File:Main:MIMEType"))
    put("bytes", sq["bytes"])
    put("width", sq["width"])
    put("height", sq["height"])
    put("megapixels", ex.get("Composite:Main:Megapixels"))
    put("color", sq["avg_color"])
    put("thumb", sq["thumb"])

    put("taken_at", iso_date(first(ex, "ExifIFD:Main:DateTimeOriginal",
                                   "ExifIFD:Main:CreateDate", "QuickTime:Main:CreateDate",
                                   "XMP-photoshop:Main:DateCreated")) or sq["taken_at"])
    put("tz_offset", first(ex, "ExifIFD:Main:OffsetTimeOriginal"))

    put("camera_make", first(ex, "IFD0:Main:Make", "Keys:Main:Make") or sq["camera_make"])
    put("camera_model", first(ex, "IFD0:Main:Model", "Keys:Main:Model") or sq["camera_model"])
    put("lens", first(ex, "ExifIFD:Main:LensModel", "VideoKeys:Main:LensModel",
                      "Composite:Main:LensID"))
    put("software", first(ex, "IFD0:Main:Software"))

    put("fnumber", num(first(ex, "ExifIFD:Main:FNumber")))
    put("exposure_time", first(ex, "ExifIFD:Main:ExposureTime"))
    put("iso", num(first(ex, "ExifIFD:Main:ISO")))
    put("focal_length", first(ex, "ExifIFD:Main:FocalLength"))
    put("focal_length_35mm", first(ex, "ExifIFD:Main:FocalLengthIn35mmFormat"))
    put("flash", first(ex, "ExifIFD:Main:Flash"))
    put("shutter_speed", first(ex, "Composite:Main:ShutterSpeed"))
    put("exposure_compensation", first(ex, "ExifIFD:Main:ExposureCompensation"))
    put("metering_mode", first(ex, "ExifIFD:Main:MeteringMode"))
    put("exposure_program", first(ex, "ExifIFD:Main:ExposureProgram"))
    put("scene_capture_type", first(ex, "ExifIFD:Main:SceneCaptureType"))
    put("fov", first(ex, "Composite:Main:FOV"))
    put("digital_zoom", first(ex, "ExifIFD:Main:DigitalZoomRatio"))

    # GPS -> decimal
    lat = dms_to_dec(first(ex, "Composite:Main:GPSLatitude"))
    lng = dms_to_dec(first(ex, "Composite:Main:GPSLongitude"))
    if lat is None and ex.get("Keys:Main:GPSCoordinates"):  # video "lat, lng, alt"
        parts = str(ex["Keys:Main:GPSCoordinates"]).split(",")
        if len(parts) >= 2:
            lat = dms_to_dec(parts[0])
            lng = dms_to_dec(parts[1])
    put("gps_lat", lat)
    put("gps_lng", lng)
    alt = first(ex, "Composite:Main:GPSAltitude")
    if alt:
        ma = re.search(r'([\d.]+)', str(alt))
        put("gps_alt", round(float(ma.group(1)), 1) if ma else None)
    put("gps_direction", num(first(ex, "GPS:Main:GPSImgDirection")))

    put("duration", sq["duration"])
    put("avg_bitrate", first(ex, "Composite:Main:AvgBitrate"))
    put("frame_rate", first(ex, "QuickTime:Main:AverageFrameRate"))
    put("rotation", first(ex, "QuickTime:Main:Rotation"))

    put("content_id", first(ex, "Apple:Main:ContentIdentifier", "Keys:Main:ContentIdentifier"))
    put("description", first(ex, "IFD0:Main:ImageDescription", "XMP-dc:Main:Description"))
    put("user_comment", first(ex, "ExifIFD:Main:UserComment"))
    put("artist", first(ex, "IFD0:Main:Artist"))
    put("owner_name", first(ex, "ExifIFD:Main:OwnerName"))
    return rec


def raw_block(ex):
    return {k: v for k, v in ex.items()
            if k != "_album" and not JUNK.search(k) and not is_binval(v)}


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    raw = os.path.getsize(path)
    with open(path, "rb") as f:
        gz = len(gzip.compress(f.read(), 6))
    return raw, gz


def main():
    os.makedirs(INDEX_DIR, exist_ok=True)
    os.makedirs(OUTDIR, exist_ok=True)

    exif_items = json.load(open(EXIF_JSON, encoding="utf-8"))["items"]
    exif_by_path = {it["_album"]["path"]: it for it in exif_items if it.get("_album")}

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM photos ORDER BY taken_at DESC NULLS LAST, filename ASC"
    ).fetchall()

    full_items, archive_items, min_items = [], [], []
    matched = 0
    for sq in rows:
        ex = exif_by_path.get(sq["relpath"], {})
        if ex:
            matched += 1
        rec = build_canonical(sq, ex)
        full_items.append(rec)
        archive_items.append({**rec, "raw": raw_block(ex)} if ex else dict(rec))
        min_items.append({k: rec[k] for k in MIN_FIELDS if k in rec})

    stamp = datetime.now(timezone.utc).isoformat()
    header = lambda kind, fields: {
        "schemaVersion": "1.0", "generatedAt": stamp, "variant": kind,
        "count": len(rows), "fields": fields,
    }
    all_fields = sorted({k for r in full_items for k in r})

    fmin = os.path.join(OUTDIR, "metadata-min.json")
    ffull = os.path.join(OUTDIR, "metadata-full.json")
    farch = os.path.join(OUTDIR, "metadata-archive.json")
    r1 = write_json(fmin, {**header("min", MIN_FIELDS), "items": min_items})
    r2 = write_json(ffull, {**header("full", all_fields), "items": full_items})
    r3 = write_json(farch, {**header("archive", all_fields + ["raw"]), "items": archive_items})

    mb = lambda x: f"{x/1024/1024:.1f} MB"
    kb = lambda x: f"{x/1024:.0f} KB"
    print(f"records: {len(rows)}   (enriched with EXIF: {matched})")
    print(f"{'file':28}{'raw':>12}{'gzip':>12}")
    print("-" * 52)
    for name, (raw, gz) in [("metadata-min.json", r1), ("metadata-full.json", r2),
                            ("metadata-archive.json", r3)]:
        show = kb if raw < 2 * 1024 * 1024 else mb
        print(f"{name:28}{show(raw):>12}{(kb(gz) if gz < 2*1024*1024 else mb(gz)):>12}")


if __name__ == "__main__":
    main()
