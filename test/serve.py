# SPDX-License-Identifier: Apache-2.0
"""Serves src/ like Cockpit does: /pkg/status-board/..., the stand-ins for cockpit.js, po.js and
manifests.js, with Cockpit's CSP. The stand-in for cockpit.js gets the fixtures in front of it
(window.__FIXTURES), the page's own manifest among them. Nothing else: a file the page takes
from elsewhere fails here as it would on a server that lacks it.
Run: python3 test/serve.py [PORT]"""
import http.server
import json
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(here), "src")
FIXTURES = os.path.join(here, "fixtures")
CSP = ("default-src 'self'; connect-src 'self' ws: wss:; form-action 'self'; base-uri 'self'; "
       "object-src 'none'; font-src 'self' data:; img-src 'self' data:; block-all-mixed-content")
TYPES = {".js": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8",
         ".json": "application/json", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8"}


def fixtures():
    out = {}
    for root, _dirs, files in os.walk(FIXTURES):
        for name in files:
            path = os.path.join(root, name)
            with open(path, encoding="utf-8") as f:
                out[os.path.relpath(path, FIXTURES).replace(os.sep, "/")] = f.read()
    with open(os.path.join(SRC, "manifest.json"), encoding="utf-8") as f:
        out["manifests/status-board.json"] = f.read()
    return out


def mock(name):
    with open(os.path.join(here, "web", name), "rb") as f:
        return f.read()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/pkg/base1/cockpit.js":
            data = ("window.__FIXTURES = " + json.dumps(fixtures()) + ";\n").encode() + mock("mock-cockpit.js")
            return self.send(data, ".js")
        if path == "/pkg/base1/po.js":
            return self.send(mock("mock-po.js"), ".js")
        if path == "/pkg/manifests.js":
            return self.send(mock("mock-manifests.js"), ".js")
        fn = None
        if path.startswith("/pkg/status-board/"):
            rel = os.path.normpath(path[len("/pkg/status-board/"):])
            if not rel.startswith("..") and not os.path.isabs(rel):
                fn = os.path.join(SRC, rel)
        if not fn or not os.path.isfile(fn):
            self.send_response(404)
            self.end_headers()
            return None
        with open(fn, "rb") as f:
            return self.send(f.read(), os.path.splitext(fn)[1])

    def send(self, data, ext):
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8773
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
