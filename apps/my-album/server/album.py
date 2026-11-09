#!/usr/bin/env python3
"""
album.py - single entrypoint for the photo album server. Windows / macOS / Linux.

Serves THE FOLDER THIS FILE LIVES IN over HTTP with CORS enabled, bound to all
interfaces so other devices on the LAN can reach it. Optionally brings up a
Cloudflare tunnel at the same time. Stdlib only - no pip install needed.

    python album.py                  # LAN only
    python album.py --tunnel         # LAN + Cloudflare tunnel "photos"
    python album.py --tunnel my-name # LAN + a specific tunnel
    python album.py --port 8080
    python album.py --dir /srv/other # serve a different folder

Environment variables (used when the matching flag is absent):
    ALBUM_PORT=8080       ALBUM_DIR=/srv/photos      ALBUM_TUNNEL=photos

Windows users can just double-click this file (runs in LAN-only mode; set
ALBUM_TUNNEL to enable the tunnel without typing arguments).

Ctrl+C - or closing the window - stops the server AND the tunnel.
"""
import argparse
import hashlib
import http.server
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import unicodedata
import urllib.parse
from pathlib import Path

DEFAULT_PORT = 8000
DEFAULT_TUNNEL = "photos"
# Origins allowed to send *credentialed* requests. Deliberately empty here:
# set it per deployment with --allow-origin or ALBUM_ALLOW_ORIGIN, so no site
# name is baked into the source. Local/LAN http origins are always allowed.
DEFAULT_ALLOW_ORIGINS = ()

# Where cloudflared usually lives, if it is not on PATH.
CLOUDFLARED_CANDIDATES = [
    r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
    r"C:\Program Files\cloudflared\cloudflared.exe",
    "/usr/local/bin/cloudflared",
    "/usr/bin/cloudflared",
    "/opt/homebrew/bin/cloudflared",
    str(Path.home() / ".local/bin/cloudflared"),
]


# --------------------------------------------------------------------------- #
# config
# --------------------------------------------------------------------------- #
def resolve_dir(cli_dir):
    """Default: the folder containing this script - so the album is portable."""
    raw = cli_dir or os.environ.get("ALBUM_DIR")
    if raw:
        return Path(raw).expanduser().resolve()
    return Path(__file__).resolve().parent


def resolve_port(cli_port):
    return int(cli_port or os.environ.get("ALBUM_PORT", DEFAULT_PORT))


def find_cloudflared():
    exe = shutil.which("cloudflared")
    if exe:
        return exe
    return next((c for c in CLOUDFLARED_CANDIDATES if Path(c).exists()), None)


# --------------------------------------------------------------------------- #
# networking
# --------------------------------------------------------------------------- #
def primary_ip():
    """The address the OS would use to reach the internet - i.e. the one other
    devices on the LAN should use. Opens a UDP socket; sends nothing. Avoids
    accidentally picking a virtual adapter (VMware / Hyper-V / WSL)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def lan_ips():
    ips = []
    p = primary_ip()
    if p:
        ips.append(p)
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith(("127.", "169.254.")) and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return ips


# --------------------------------------------------------------------------- #
# server
# --------------------------------------------------------------------------- #
def origin_allowed(origin, extra):
    """Is this browser Origin allowed to make *credentialed* requests?

    Kept to an allow-list on purpose: echoing any origin together with
    Access-Control-Allow-Credentials would let any website read this album
    using the visitor's Cloudflare Access session.
    """
    if not origin:
        return False
    if origin in extra:
        return True
    try:
        u = urllib.parse.urlparse(origin)
    except ValueError:
        return False
    host = u.hostname or ""
    # local development / LAN origins
    return u.scheme == "http" and (
        host in ("localhost", "127.0.0.1", "::1")
        or host.startswith(("192.168.", "10.", "172.16.", "172.17."))
    )



def build_thumb_aliases(directory):
    """Map an alternately-normalized thumbnail hash -> the real one.

    Thumbnails are named sha1(<relative path as stored on disk>)[:16]. This album
    mixes Unicode forms (older exports are NFD, newer iPhone ones NFC), and the
    web app derives the name by hashing a path it normalized itself - so for the
    items whose stored form differs it asks for a hash that does not exist. Rather
    than rename 1,600 files, accept both spellings.
    """
    aliases = {}
    meta = Path(directory) / "album" / "metadata-min.json"
    try:
        items = json.loads(meta.read_text(encoding="utf-8"))["items"]
    except (OSError, ValueError, KeyError):
        return aliases
    for it in items:
        rid, name = it.get("id"), it.get("name")
        if not rid or not name:
            continue
        folder = it.get("folder") or ""
        rel = f"{folder}/{name}" if folder else name
        for form in ("NFC", "NFD"):
            alt = hashlib.sha1(
                unicodedata.normalize(form, rel).encode("utf-8")
            ).hexdigest()[:16]
            if alt != rid:
                aliases.setdefault(alt, rid)
    return aliases


def make_handler(directory, allow_origins, log_path=None, thumb_aliases=None):
    aliases = thumb_aliases or {}

    class CORSHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(directory), **kwargs)

        def end_headers(self):
            origin = self.headers.get("Origin")
            if origin_allowed(origin, allow_origins):
                # A fetch() with credentials:"include" REQUIRES the exact origin
                # here - browsers reject the "*" wildcard for such requests -
                # plus an explicit allow-credentials header. The web app uses
                # credentials:"include" so its Cloudflare Access cookie is sent.
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Credentials", "true")
                self.send_header("Vary", "Origin")
            else:
                self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.send_header("Cache-Control", "public, max-age=86400")
            super().end_headers()

        def translate_path(self, path):
            local = super().translate_path(path)
            if os.path.exists(local):
                return local
            # This album holds BOTH Unicode forms: older macOS-style exports are
            # NFD ("Bac" + combining marks) while newer iPhone exports are NFC
            # ("Bắc" precomposed). A client that normalizes one way then 404s on
            # the other, so try the alternate form before giving up.
            for form in ("NFC", "NFD"):
                alt = unicodedata.normalize(form, local)
                if alt != local and os.path.exists(alt):
                    return alt
            # thumbs/<hash>.jpg asked for with the other normalization's hash
            head, tail = os.path.split(local)
            if os.path.basename(head).lower() == "thumbs" and tail.lower().endswith(".jpg"):
                real = aliases.get(tail[:-4])
                if real:
                    cand = os.path.join(head, real + ".jpg")
                    if os.path.exists(cand):
                        return cand
            return local

        def do_OPTIONS(self):           # CORS preflight
            self.send_response(204)
            self.end_headers()

        def log_message(self, fmt, *args):
            # Quiet by default; with --log, append every request to a file so a
            # failing page load can be diagnosed from the actual URLs requested.
            if log_path:
                try:
                    with open(log_path, "a", encoding="utf-8") as f:
                        f.write("%s %s\n" % (self.log_date_time_string(), fmt % args))
                except OSError:
                    pass

    return CORSHandler


class DualStackServer(http.server.ThreadingHTTPServer):
    """Listens on IPv6 *and* IPv4.

    Binding only 0.0.0.0 (IPv4) is not enough: some clients resolve "localhost"
    to the IPv6 loopback [::1] first - cloudflared on Windows does - and then get
    "connection refused" even though the server is up. Clearing IPV6_V6ONLY makes
    one socket serve both families.
    """
    address_family = socket.AF_INET6

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except OSError:
            pass
        super().server_bind()


def create_server(directory, port, allow_origins=DEFAULT_ALLOW_ORIGINS, log_path=None):
    handler = make_handler(directory, set(allow_origins), log_path,
                           build_thumb_aliases(directory))
    try:
        httpd = DualStackServer(("::", port), handler)
    except OSError:
        # No usable IPv6 stack (possible on minimal Android/Termux setups).
        httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), handler)
    httpd.daemon_threads = True
    return httpd


def banner(directory, port, tunnel):
    out = [
        "=" * 62,
        "  PHOTO ALBUM SERVER (CORS enabled)",
        "-" * 62,
        f"  Folder     : {directory}",
        f"  On THIS PC : http://localhost:{port}",
        "  On ANOTHER DEVICE (first address is the one to use):",
    ]
    for i, ip in enumerate(lan_ips()):
        out.append(f"     http://{ip}:{port}" + ("   <- recommended" if i == 0 else ""))
    if tunnel:
        out += ["-" * 62, f"  Tunnel     : {tunnel}  (public URL is gated by Cloudflare Access)"]
    out += ["-" * 62, "  TO STOP: press Ctrl+C (or close this window).", "=" * 62]
    return "\n".join(out)


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(
        description="Serve this photo album over LAN, optionally via Cloudflare tunnel.")
    ap.add_argument("--dir", help="folder to serve (default: this file's folder)")
    ap.add_argument("--port", type=int, help=f"port (default: {DEFAULT_PORT})")
    ap.add_argument("--tunnel", nargs="?", const=DEFAULT_TUNNEL, default=None,
                    help=f"also run a Cloudflare tunnel (default name: {DEFAULT_TUNNEL})")
    ap.add_argument("--log", default=None,
                    help="append every request to this file (for debugging)")
    ap.add_argument("--allow-origin", action="append", default=None,
                    help="origin allowed to send credentialed requests "
                         "(repeatable; or set ALBUM_ALLOW_ORIGIN, comma-separated)")
    args = ap.parse_args()

    directory = resolve_dir(args.dir)
    port = resolve_port(args.port)
    tunnel = args.tunnel or os.environ.get("ALBUM_TUNNEL") or None
    if not directory.is_dir():
        sys.exit(f"ERROR: folder not found: {directory}")

    allow = args.allow_origin or [
        o.strip() for o in os.environ.get("ALBUM_ALLOW_ORIGIN", "").split(",") if o.strip()
    ] or list(DEFAULT_ALLOW_ORIGINS)
    httpd = create_server(directory, port, allow, args.log)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print(banner(directory, port, tunnel), flush=True)

    proc = None
    if tunnel:
        exe = find_cloudflared()
        if not exe:
            print("\n[!] cloudflared not found on PATH - continuing LAN-only.\n", flush=True)
        else:
            proc = subprocess.Popen([exe, "tunnel", "run", tunnel])

    stopping = threading.Event()

    def shutdown(*_):
        if stopping.is_set():
            return
        stopping.set()
        print("\nstopping...")
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        httpd.shutdown()
        httpd.server_close()

    signal.signal(signal.SIGINT, lambda *a: (shutdown(), sys.exit(0)))
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, lambda *a: (shutdown(), sys.exit(0)))

    try:
        proc.wait() if proc else stopping.wait()
    except KeyboardInterrupt:
        pass
    finally:
        shutdown()


if __name__ == "__main__":
    main()
