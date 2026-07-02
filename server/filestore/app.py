from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def send_json(
    handler: SimpleHTTPRequestHandler,
    payload: dict | list,
    status: HTTPStatus = HTTPStatus.OK,
) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    try:
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
        return


class AppHandler(SimpleHTTPRequestHandler):
    server_version = "FilestoreStatic/1.0"

    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        if parsed.path == "/":
            return str(PUBLIC / "admin.html")
        if parsed.path.startswith("/submit/"):
            return str(PUBLIC / "submit.html")
        if parsed.path.startswith("/status/"):
            return str(PUBLIC / "status.html")
        requested = (PUBLIC / unquote(parsed.path.lstrip("/"))).resolve()
        public_root = PUBLIC.resolve()
        if requested != public_root and public_root not in requested.parents:
            return str(PUBLIC / "__missing__")
        return str(requested)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            send_json(self, {"ok": True, "time": now_iso()})
            return
        if path.startswith("/api/"):
            send_json(self, {"error": "Filestore API 已迁移到主站 PostgreSQL 服务"}, HTTPStatus.GONE)
            return
        super().do_GET()

    def do_POST(self) -> None:
        send_json(self, {"error": "Filestore API 已迁移到主站 PostgreSQL 服务"}, HTTPStatus.GONE)

    def do_PATCH(self) -> None:
        send_json(self, {"error": "Filestore API 已迁移到主站 PostgreSQL 服务"}, HTTPStatus.GONE)

    def do_DELETE(self) -> None:
        send_json(self, {"error": "Filestore API 已迁移到主站 PostgreSQL 服务"}, HTTPStatus.GONE)


def main() -> None:
    port = int(os.environ.get("PORT", "8974"))
    server = ThreadingHTTPServer(("127.0.0.1", port), AppHandler)
    print(f"Filestore static assets running at http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
