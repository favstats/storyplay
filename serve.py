#!/usr/bin/env python3
"""Static HTTP server with byte-range support for media files."""
import http.server
import mimetypes
import os
import re
import socketserver
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 7878
ROOT = Path(__file__).parent

mimetypes.add_type("application/xhtml+xml", ".xhtml")
mimetypes.add_type("audio/mp4", ".mp4")
mimetypes.add_type("audio/mp4", ".m4a")
mimetypes.add_type("audio/mp4", ".m4b")


class RangeHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        sys.stdout.write(f"{self.address_string()} - {fmt % args}\n")
        sys.stdout.flush()

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        if not os.path.isfile(path):
            self.send_error(404)
            return None

        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404)
            return None

        try:
            fs = os.fstat(f.fileno())
            file_len = fs.st_size
            ctype = self.guess_type(path)

            range_hdr = self.headers.get("Range")
            if range_hdr:
                m = re.match(r"bytes=(\d*)-(\d*)$", range_hdr)
                if m:
                    start_s, end_s = m.group(1), m.group(2)
                    if start_s == "" and end_s == "":
                        self.send_error(416)
                        f.close()
                        return None
                    if start_s == "":
                        # suffix: last N bytes
                        length = int(end_s)
                        start = max(0, file_len - length)
                        end = file_len - 1
                    else:
                        start = int(start_s)
                        end = int(end_s) if end_s else file_len - 1
                    if start >= file_len or end < start:
                        self.send_response(416)
                        self.send_header("Content-Range", f"bytes */{file_len}")
                        self.end_headers()
                        f.close()
                        return None
                    end = min(end, file_len - 1)
                    length = end - start + 1
                    self.send_response(206)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Range", f"bytes {start}-{end}/{file_len}")
                    self.send_header("Content-Length", str(length))
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    f.seek(start)
                    return _BoundedReader(f, length)

            # full response
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(file_len))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return f
        except Exception:
            f.close()
            raise


class _BoundedReader:
    """Wraps a file so copyfile() stops after `length` bytes."""
    def __init__(self, f, length):
        self.f = f
        self.remaining = length

    def read(self, n=-1):
        if self.remaining <= 0:
            return b""
        if n < 0 or n > self.remaining:
            n = self.remaining
        chunk = self.f.read(n)
        self.remaining -= len(chunk)
        return chunk

    def close(self):
        self.f.close()


class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def lan_ip() -> str:
    """Best-effort: return the Mac's primary LAN IP (or 0.0.0.0 if unknown)."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))   # no packets actually sent
        return s.getsockname()[0]
    except OSError:
        return "0.0.0.0"
    finally:
        s.close()


def main():
    with ThreadedServer(("", PORT), RangeHandler) as httpd:
        ip = lan_ip()
        print(f"Storyplay — serving {ROOT}")
        print(f"  On this Mac:    http://localhost:{PORT}/")
        print(f"  On your phone:  http://{ip}:{PORT}/")
        print("(Phone must be on the same Wi-Fi network.)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
