# My Album — server side

Everything the browser app talks to. Two small Python services plus the indexing
pipeline that builds the metadata the app loads.

Nothing here contains machine-specific paths or site names: every deployment
detail comes from environment variables or the `*.example` files.

## Pieces

| File | Role |
|---|---|
| `album.py` | Read-only file server: thumbnails, originals, `album/*.json`. CORS enabled. Stdlib only. |
| `../album_write_server.py` | Write service on `/api/*`: upload photos, move photos to trash. Binds `127.0.0.1`. |
| `index_photos.py` | Scans the album → thumbnails + `index.db` (resumable). Needs Pillow, pillow-heif, rawpy, PyAV. |
| `exif_update.py` | Adds full EXIF/GPS for new files to the ExifTool dump (incremental). Needs ExifTool. |
| `build_metadata_versions.py` | Builds `album/metadata-{min,full,archive}.json` from `index.db` + the dump. |

## Configuration

| Variable | Meaning | Default |
|---|---|---|
| `ALBUM_ROOT` | folder holding the photos (`thumbs/` and `album/` live inside it) | current folder |
| `ALBUM_INDEX` | folder for `index.db` and `album-metadata.json` | `<ALBUM_ROOT>/.album-index` |
| `ALBUM_PORT` | album server port | `8000` |
| `ALBUM_ALLOW_ORIGIN` | origin allowed to send credentialed requests | none |
| `ALBUM_TUNNEL` | Cloudflare tunnel name | off |
| `ALBUM_EXIFTOOL` | ExifTool path, if not on `PATH` | — |

`album.py` also takes `--dir`, `--port`, `--allow-origin`, `--tunnel`, `--log`.

## Running

```bash
# read-only server, LAN
python album.py --dir /path/to/photos

# + Cloudflare tunnel, and let the web app send credentialed requests
python album.py --dir /path/to/photos --tunnel my-tunnel --allow-origin https://example.com

# write service (uploads / trash), loopback only
python album_write_server.py --root /path/to/photos --port 8010
```

On Windows, copy `start-photo-server.cmd.example` and
`start-album-write-server.cmd.example`, edit the paths at the top, and
double-click. Closing the window stops the service.

## Rebuilding metadata after adding photos

```bash
export ALBUM_ROOT=/path/to/photos ALBUM_INDEX=/path/to/index
python index_photos.py             # 1. thumbnails + index.db for new files
python exif_update.py              # 2. EXIF/GPS for new files (needs ExifTool)
python build_metadata_versions.py  # 3. rebuild the three metadata files
```
All three are resumable and only touch files they have not seen.

## Cloudflare Tunnel

`/api/*` must reach the write service while everything else reaches the album
server. See `cloudflared-config.example.yml`.

Two things that cost real debugging time, both encoded in that example:

- **Use `127.0.0.1`, not `localhost`.** cloudflared on Windows resolves
  `localhost` to the IPv6 loopback `[::1]` first; a server listening only on
  IPv4 refuses it and every request fails with *"Unable to reach the origin
  service"* even though the server is clearly up.
- **Put the `^/api/` rule first.** Ingress rules match in order, so the
  catch-all hostname rule would otherwise swallow `/api/`.

If the site is behind Cloudflare Access and the web app runs on a *different*
origin, also enable CORS in the Access application (allow that origin, methods
GET + POST, and "Allow credentials"). A CORS preflight carries no cookie, so
Access answers it with a login redirect that has no CORS headers, and the
browser blocks the request before it ever reaches these servers.

## Notes

- `album.py` serves the folder it lives in by default, so the album is portable:
  copy the folder anywhere and run it. Stdlib only, no `pip install` — it runs
  under Termux on Android too.
- Thumbnails are `thumbs/<sha1(relative path)[:16]>.jpg`. If a photo library
  mixes Unicode forms (older macOS exports are NFD, newer iPhone ones NFC) a
  client that normalizes paths itself computes a different hash; `album.py`
  accepts both spellings rather than renaming files.
- `_Thung_rac/` (trash) is skipped by the indexer so deleted photos do not come
  back as thumbnails.
