from __future__ import annotations

import csv
import hashlib
import io
import json
import mimetypes
import os
import re
import secrets
import shutil
import sqlite3
import string
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import SpooledTemporaryFile
from urllib.parse import quote, urlparse


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA_DIR = ROOT / "data"
UPLOAD_DIR = ROOT / "uploads"
DB_PATH = DATA_DIR / "filestore.db"
ADMIN_PASSWORD = os.environ.get("FILESTORE_ADMIN_PASSWORD", "admin123")
MAX_REQUEST_BYTES = 1024 * 1024 * 1024
SESSIONS: set[str] = set()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_filename(value: str) -> str:
    allowed = f"-_.() {string.ascii_letters}{string.digits}"
    cleaned = "".join(ch if ch in allowed or "\u4e00" <= ch <= "\u9fff" else "_" for ch in value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned[:140] or "file"


_BOUNDARY_PARAM_RE = re.compile(r'boundary=("([^"]+)"|([^;\s]+))', re.IGNORECASE)
_CONTENT_DISP_RE = re.compile(
    r'^Content-Disposition:\s*form-data\s*;\s*name="([^"]*)"(?:\s*;\s*filename="([^"]*)")?',
    re.IGNORECASE,
)
_CONTENT_TYPE_RE = re.compile(r'^Content-Type:\s*(.+?)\s*$', re.IGNORECASE)


class UploadPart:
    """\u590d\u523b cgi.FieldStorage \u5bf9\u5916\u66b4\u9732\u7684\u5c5e\u6027\u5b50\u96c6\u3002

    - filename:  \u6587\u4ef6\u540d\uff1b\u666e\u901a\u5b57\u6bb5\u4e3a None
    - type:      MIME \u7c7b\u578b
    - file:      SpooledTemporaryFile\uff0c\u53ef seek/read/tell
    - value:     \u666e\u901a\u5b57\u6bb5\u7684\u5b57\u7b26\u4e32\u5185\u5bb9\uff08\u61d2\u89e3\u7801\uff09
    """

    __slots__ = ("name", "filename", "type", "file", "_value_cache")

    def __init__(self, name: str, filename: str | None, content_type: str, file: SpooledTemporaryFile) -> None:
        self.name = name
        self.filename = filename
        self.type = content_type
        self.file = file
        self._value_cache: str | None = None

    @property
    def value(self) -> str:
        if self._value_cache is None:
            self.file.seek(0)
            self._value_cache = self.file.read().decode("utf-8", errors="replace")
            self.file.seek(0)
        return self._value_cache


class _MultipartReader:
    """\u6eda\u52a8\u7f13\u51b2\u533a\uff0c\u4ece rfile \u6d41\u5f0f\u6309\u9700\u8bfb\u53d6\u5b57\u8282\u3002"""

    def __init__(self, fp, total: int, chunk_size: int = 64 * 1024) -> None:
        self.fp = fp
        self.remaining = total
        self.chunk_size = chunk_size
        self.buf = b""

    def fill(self, target: int) -> None:
        while len(self.buf) < target and self.remaining > 0:
            want = min(self.chunk_size, self.remaining)
            chunk = self.fp.read(want)
            if not chunk:
                self.remaining = 0
                break
            self.buf += chunk
            self.remaining -= len(chunk)

    def readline(self, maxlen: int = 8192) -> bytes:
        """\u8bfb\u53d6\u4e0b\u4e00\u884c\uff08\u4e0d\u542b CRLF\uff09\u3002"""
        while True:
            idx = self.buf.find(b"\r\n")
            if idx >= 0:
                line = self.buf[:idx]
                self.buf = self.buf[idx + 2:]
                return line
            if len(self.buf) > maxlen:
                raise ValueError("multipart \u5934\u90e8\u884c\u8fc7\u957f")
            if self.remaining <= 0:
                raise ValueError("multipart \u63d0\u524d\u7ed3\u675f\uff08\u8bfb\u53d6\u5934\u90e8\u65f6\uff09")
            self.fill(len(self.buf) + self.chunk_size)


def parse_multipart(rfile, content_type: str, content_length: int) -> dict[str, list[UploadPart]]:
    """\u6d41\u5f0f\u89e3\u6790 multipart/form-data \u8bf7\u6c42\u4f53\u3002\u96f6\u4f9d\u8d56\uff0c\u66ff\u4ee3 cgi.FieldStorage\u3002

    \u8fd4\u56de dict[\u5b57\u6bb5\u540d, list[UploadPart]]\u3002\u540c\u540d\u5b57\u6bb5\uff08\u5982\u591a\u6587\u4ef6\u4e0a\u4f20 name="files"\uff09\u4fdd\u7559\u4e3a\u5217\u8868\u3002

    \u629b ValueError \u8868\u793a\u683c\u5f0f\u9519\u8bef\u6216\u4f53\u79ef\u8d85\u9650\u3002
    """
    if content_length <= 0:
        raise ValueError("\u8bf7\u6c42\u4f53\u4e3a\u7a7a")
    if content_length > MAX_REQUEST_BYTES:
        raise ValueError("\u8bf7\u6c42\u4f53\u8fc7\u5927")

    match = _BOUNDARY_PARAM_RE.search(content_type or "")
    if not match:
        raise ValueError("\u7f3a\u5c11 multipart boundary")
    boundary = (match.group(2) or match.group(3)).encode("ascii")
    delimiter = b"--" + boundary
    sep = b"\r\n" + delimiter

    reader = _MultipartReader(rfile, content_length)

    first = reader.readline()
    if first == delimiter + b"--":
        return {}
    if first != delimiter:
        raise ValueError("multipart \u5f00\u5934\u4e0d\u662f\u5206\u9694\u7b26")

    parts: dict[str, list[UploadPart]] = {}

    while True:
        headers: list[str] = []
        while True:
            line = reader.readline()
            if line == b"":
                break
            headers.append(line.decode("utf-8", errors="replace"))

        name: str | None = None
        filename: str | None = None
        ctype = ""
        for h in headers:
            m = _CONTENT_DISP_RE.match(h)
            if m:
                name = m.group(1)
                filename = m.group(2)
                continue
            m = _CONTENT_TYPE_RE.match(h)
            if m:
                ctype = m.group(1)
        if name is None:
            raise ValueError("multipart part \u7f3a\u5c11 name")

        spool: SpooledTemporaryFile = SpooledTemporaryFile(max_size=1024 * 1024)
        while True:
            reader.fill(len(sep) + reader.chunk_size)
            idx = reader.buf.find(sep)
            if idx >= 0:
                spool.write(reader.buf[:idx])
                reader.buf = reader.buf[idx + len(sep):]
                break
            # \u6ca1\u627e\u5230\u5b8c\u6574 sep\uff1a\u4fdd\u7559\u6700\u540e len(sep)-1 \u5b57\u8282\u9632\u6b62 sep \u8de8\u8fb9\u754c\uff0c\u5176\u4f59\u5199\u5165 part
            keep = len(sep) - 1
            if len(reader.buf) > keep:
                spool.write(reader.buf[:-keep])
                reader.buf = reader.buf[-keep:]
            if reader.remaining <= 0:
                raise ValueError("multipart \u63d0\u524d\u7ed3\u675f\uff08\u8bfb\u53d6\u5185\u5bb9\u65f6\uff09")

        spool.seek(0)
        parts.setdefault(name, []).append(UploadPart(name, filename, ctype, spool))

        # \u5206\u9694\u7b26\u540e\u5fc5\u987b\u662f "\r\n"\uff08\u4e0b\u4e00\u6bb5\uff09\u6216 "--"\uff08\u7ed3\u675f\uff0c\u540e\u53ef\u80fd\u8ddf \r\n\uff09
        reader.fill(2)
        if len(reader.buf) < 2:
            raise ValueError("multipart \u672b\u5c3e\u4e0d\u5b8c\u6574")
        suffix = reader.buf[:2]
        reader.buf = reader.buf[2:]
        if suffix == b"--":
            break
        if suffix != b"\r\n":
            raise ValueError("multipart \u5206\u9694\u7b26\u540e\u5b57\u7b26\u975e\u6cd5")

    return parts


def read_json_body(handler: SimpleHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0"))
    if length > MAX_REQUEST_BYTES:
        raise ValueError("请求体过大")
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    UPLOAD_DIR.mkdir(exist_ok=True)
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                deadline TEXT,
                fields_json TEXT NOT NULL,
                file_rules_json TEXT NOT NULL,
                rename_template TEXT NOT NULL DEFAULT '{name}-{student_id}',
                folder_template TEXT NOT NULL DEFAULT '{name}-{student_id}',
                expected_entries TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                data_json TEXT NOT NULL,
                ip TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'submitted',
                created_at TEXT NOT NULL,
                FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id INTEGER NOT NULL,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size INTEGER NOT NULL,
                path TEXT NOT NULL,
                FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        task_columns = {row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()}
        if "folder_template" not in task_columns:
            conn.execute("ALTER TABLE tasks ADD COLUMN folder_template TEXT NOT NULL DEFAULT '{name}-{student_id}'")


def task_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "token": row["token"],
        "title": row["title"],
        "description": row["description"],
        "deadline": row["deadline"],
        "fields": json.loads(row["fields_json"]),
        "fileRules": json.loads(row["file_rules_json"]),
        "renameTemplate": row["rename_template"],
        "folderTemplate": row["folder_template"],
        "expectedEntries": row["expected_entries"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "submitUrl": f"/submit/{row['token']}",
    }


def get_setting(key: str, default: str = "") -> str:
    with connect() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def admin_password() -> str:
    return get_setting("admin_password", ADMIN_PASSWORD)


# scrypt 参数：n=16384, r=8, p=1 是 OWASP 推荐的轻量级配置，
# 单次哈希约 50-100ms，对单管理员密码场景足够。
_SCRYPT_N = 16384
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 64


def hash_password(plaintext: str) -> str:
    """生成 scrypt 哈希，格式：scrypt$n$r$p$<salt_hex>$<hash_hex>。"""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        plaintext.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
    )
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(plaintext: str, stored: str) -> bool:
    """验证密码。兼容两种 stored：
    - "scrypt$..." 格式 → 用 scrypt 验证
    - 其他（明文）→ 直接比较，用于初次安装/旧版本兼容
    """
    if not stored:
        return False
    if not stored.startswith("scrypt$"):
        return secrets.compare_digest(plaintext, stored)
    try:
        _, n_s, r_s, p_s, salt_hex, hash_hex = stored.split("$")
        n = int(n_s)
        r = int(r_s)
        p = int(p_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except (ValueError, AttributeError):
        return False
    actual = hashlib.scrypt(
        plaintext.encode("utf-8"),
        salt=salt,
        n=n,
        r=r,
        p=p,
        dklen=len(expected),
    )
    return secrets.compare_digest(actual, expected)


def set_setting(key: str, value: str) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )


def normalize_site_url(value: str) -> str:
    site_url = str(value or "").strip().rstrip("/")
    if not site_url:
        return ""
    parsed = urlparse(site_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("站点地址必须是完整 URL，例如 https://files.example.com")
    if parsed.path not in {"", "/"}:
        raise ValueError("站点地址只填写域名根地址，不要包含路径")
    return site_url


def app_settings() -> dict:
    raw_template = get_setting("task_template")
    legacy_template = json.loads(raw_template) if raw_template else None
    raw_templates = get_setting("task_templates")
    templates = json.loads(raw_templates) if raw_templates else []
    if legacy_template and not templates:
        legacy_template["id"] = "legacy-template"
        legacy_template["name"] = "已保存模板"
        templates = [legacy_template]
    return {
        "siteUrl": get_setting("site_url"),
        "siteTitle": get_setting("site_title", "Filestore"),
        "taskTemplates": templates,
    }


def validate_task_template(template: dict) -> dict:
    fields = template.get("fields") or []
    if not isinstance(fields, list) or not fields:
        raise ValueError("模板至少需要一个字段")
    normalized = normalize_task_payload(
        {
            "title": "template",
            "fields": fields,
            "fileRules": template.get("fileRules") or {},
            "renameTemplate": template.get("renameTemplate", "{name}-{student_id}"),
            "folderTemplate": template.get("folderTemplate", "{name}-{student_id}"),
            "expectedEntries": "",
        }
    )
    return {
        "id": str(template.get("id") or secrets.token_urlsafe(8)),
        "name": str(template.get("name") or "未命名模板").strip()[:40] or "未命名模板",
        "fields": normalized["fields"],
        "fileRules": normalized["fileRules"],
        "renameTemplate": normalized["renameTemplate"],
        "folderTemplate": normalized["folderTemplate"],
    }


def cookie_value(handler: SimpleHTTPRequestHandler, name: str) -> str:
    cookie = handler.headers.get("Cookie", "")
    for part in cookie.split(";"):
        key, _, value = part.strip().partition("=")
        if key == name:
            return value
    return ""


def current_session(handler: SimpleHTTPRequestHandler) -> str:
    return cookie_value(handler, "filestore_session")


def require_admin(handler: SimpleHTTPRequestHandler) -> bool:
    trusted_token = os.environ.get("FILESTORE_TRUSTED_PROXY_TOKEN", "")
    if trusted_token and secrets.compare_digest(handler.headers.get("X-CPU-Filestore-Admin", ""), trusted_token):
        return True
    session = current_session(handler)
    if not session or session not in SESSIONS:
        send_json(handler, {"error": "请先登录"}, HTTPStatus.UNAUTHORIZED)
        return False
    return True


def send_json(
    handler: SimpleHTTPRequestHandler,
    payload: dict | list,
    status: HTTPStatus = HTTPStatus.OK,
    extra_headers: dict[str, str] | None = None,
) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    try:
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(body)))
        for key, value in (extra_headers or {}).items():
            handler.send_header(key, value)
        handler.end_headers()
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
        return


def send_text(handler: SimpleHTTPRequestHandler, text: str, status: HTTPStatus = HTTPStatus.OK) -> None:
    body = text.encode("utf-8")
    try:
        handler.send_response(status)
        handler.send_header("Content-Type", "text/plain; charset=utf-8")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
        return


def normalize_task_payload(payload: dict) -> dict:
    title = str(payload.get("title", "")).strip()
    if not title:
        raise ValueError("任务标题不能为空")

    fields = payload.get("fields") or []
    if not isinstance(fields, list) or not fields:
        raise ValueError("至少需要一个表单字段")

    normalized_fields = []
    keys = set()
    for field in fields:
        key = re.sub(r"[^a-zA-Z0-9_]", "_", str(field.get("key", "")).strip())
        label = str(field.get("label", "")).strip()
        if not key or not label:
            raise ValueError("字段 key 和名称不能为空")
        if key in keys:
            raise ValueError(f"字段 key 重复：{key}")
        pattern = str(field.get("pattern", "")).strip()
        if pattern:
            re.compile(pattern)
        keys.add(key)
        normalized_fields.append(
            {
                "key": key,
                "label": label,
                "required": bool(field.get("required", True)),
                "pattern": pattern,
                "placeholder": str(field.get("placeholder", "")).strip(),
            }
        )

    rules = payload.get("fileRules") or {}
    raw_allowed_types = rules.get("allowedTypes", "")
    if isinstance(raw_allowed_types, list):
        allowed_types = [str(item).strip().lower() for item in raw_allowed_types if str(item).strip()]
    else:
        allowed_types = [item.strip().lower() for item in str(raw_allowed_types).split(",") if item.strip()]
    max_size_mb = float(rules.get("maxSizeMb") or 20)
    max_count = int(rules.get("maxCount") or 1)
    if max_size_mb <= 0 or max_count <= 0:
        raise ValueError("文件大小和数量限制必须大于 0")

    return {
        "title": title,
        "description": str(payload.get("description", "")).strip(),
        "deadline": str(payload.get("deadline", "")).strip() or None,
        "fields": normalized_fields,
        "fileRules": {
            "allowedTypes": allowed_types,
            "maxSizeMb": max_size_mb,
            "maxCount": max_count,
        },
        "renameTemplate": str(payload.get("renameTemplate", "{name}-{student_id}")).strip() or "{name}",
        "folderTemplate": str(payload.get("folderTemplate", "{name}-{student_id}")).strip() or "{name}",
        "expectedEntries": str(payload.get("expectedEntries", "")).strip(),
        "status": str(payload.get("status", "open")).strip() or "open",
    }


def validate_submission(task: dict, data: dict, files: list[UploadPart]) -> list[str]:
    errors = []
    if task["status"] != "open":
        errors.append("任务未开放提交")
    if task["deadline"]:
        try:
            deadline = datetime.fromisoformat(task["deadline"])
            if deadline.tzinfo is None:
                deadline = deadline.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > deadline.astimezone(timezone.utc):
                errors.append("已超过截止时间")
        except ValueError:
            pass

    for field in task["fields"]:
        value = str(data.get(field["key"], "")).strip()
        if field["required"] and not value:
            errors.append(f"{field['label']}不能为空")
        if value and field["pattern"] and not re.fullmatch(field["pattern"], value):
            errors.append(f"{field['label']}格式不正确")

    rules = task["fileRules"]
    if not files:
        errors.append("至少需要上传一个文件")
    if len(files) > int(rules["maxCount"]):
        errors.append(f"最多只能上传 {rules['maxCount']} 个文件")

    allowed = set(rules["allowedTypes"])
    max_bytes = int(float(rules["maxSizeMb"]) * 1024 * 1024)
    for item in files:
        original = item.filename or ""
        ext = Path(original).suffix.lower().lstrip(".")
        item.file.seek(0, os.SEEK_END)
        size = item.file.tell()
        item.file.seek(0)
        if allowed and ext not in allowed:
            errors.append(f"{original} 类型不允许")
        if size > max_bytes:
            errors.append(f"{original} 超过 {rules['maxSizeMb']} MB")
    return errors


def clean_rendered_name(value: str) -> str:
    value = safe_filename(value)
    value = re.sub(r"[-_ ]{2,}", "-", value)
    return value.strip(" -_.") or "file"


def render_template_base(template: str, data: dict, original_name: str = "", index: int = 1, total_count: int = 1) -> str:
    values = {key: safe_filename(str(value)) for key, value in data.items()}
    values.update({
        "index": str(index) if total_count > 1 else "",
        "original": safe_filename(Path(original_name).stem),
    })

    def repl(match: re.Match[str]) -> str:
        key = match.group(1)
        op = match.group(2)
        arg = match.group(3)
        value = values.get(key, "")
        if op == "last":
            count = int(arg or "0")
            return value[-count:] if count > 0 else ""
        if op == "first":
            count = int(arg or "0")
            return value[:count] if count > 0 else ""
        return value

    rendered = re.sub(r"\{([a-zA-Z0-9_]+)(?:\|(last|first):(\d{1,2}))?\}", repl, template)
    return clean_rendered_name(rendered)


def render_name(template: str, data: dict, original_name: str, index: int, total_count: int = 1) -> str:
    ext = Path(original_name).suffix
    rendered = render_template_base(template, data, original_name, index, total_count)
    if total_count > 1 and "{index}" not in template:
        rendered = f"{rendered}-{index}"
    return f"{rendered}{ext.lower()}"


def submission_folder_name(task: dict, submission: dict) -> str:
    data = submission.get("data") or {}
    template = task.get("folderTemplate") or "{name}-{student_id}"
    return render_template_base(template, data) or clean_rendered_name(f"submission-{submission.get('id', '')}")


def get_task_by_token(token: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE token = ?", (token,)).fetchone()
    return task_to_dict(row) if row else None


def build_task_detail(task_id: int) -> dict | None:
    with connect() as conn:
        task_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task_row:
            return None
        rows = conn.execute(
            """
            SELECT s.*, COALESCE(
                json_group_array(json_object(
                    'id', f.id,
                    'originalName', f.original_name,
                    'storedName', f.stored_name,
                    'mimeType', f.mime_type,
                    'size', f.size
                )) FILTER (WHERE f.id IS NOT NULL),
                '[]'
            ) AS files_json
            FROM submissions s
            LEFT JOIN files f ON f.submission_id = s.id
            WHERE s.task_id = ?
            GROUP BY s.id
            ORDER BY s.created_at DESC
            """,
            (task_id,),
        ).fetchall()
    task = task_to_dict(task_row)
    submissions = []
    for row in rows:
        submissions.append(
            {
                "id": row["id"],
                "data": json.loads(row["data_json"]),
                "ip": row["ip"],
                "status": row["status"],
                "createdAt": row["created_at"],
                "files": json.loads(row["files_json"]),
            }
        )
    task["submissions"] = submissions
    expected = [line.strip() for line in task["expectedEntries"].splitlines() if line.strip()]
    expected_keys = set(expected)
    matched_submitted_keys = set()
    unexpected = []
    for item in submissions:
        identity = (item["data"].get("student_id") or item["data"].get("name") or "").strip()
        if expected_keys and identity in expected_keys:
            matched_submitted_keys.add(identity)
        elif expected_keys:
            unexpected.append(
                {
                    "id": item["id"],
                    "name": item["data"].get("name") or "",
                    "identity": identity,
                    "createdAt": item["createdAt"],
                }
            )
    task["stats"] = {
        "submitted": len(submissions),
        "inListSubmitted": len(matched_submitted_keys) if expected else len(submissions),
        "expected": len(expected),
        "missing": [item for item in expected if item not in matched_submitted_keys],
        "unexpected": unexpected,
    }
    return task


def build_public_status(token: str) -> dict | None:
    task = get_task_by_token(token)
    if not task:
        return None
    detail = build_task_detail(task["id"])
    if not detail:
        return None

    field_keys = [field["key"] for field in detail["fields"]]
    submissions = []
    for item in detail["submissions"]:
        data = item["data"]
        display_name = str(data.get("name") or "").strip()
        identity = str(data.get("student_id") or "").strip()
        if not display_name and field_keys:
            display_name = str(data.get(field_keys[0]) or "").strip()
        if not identity:
            for key in field_keys:
                value = str(data.get(key) or "").strip()
                if value and value != display_name:
                    identity = value
                    break
        submissions.append(
            {
                "id": item["id"],
                "displayName": display_name or f"提交 #{item['id']}",
                "identity": identity,
                "createdAt": item["createdAt"],
                "files": [
                    {
                        "storedName": file["storedName"],
                        "size": file["size"],
                    }
                    for file in item["files"]
                ],
            }
        )

    return {
        "title": detail["title"],
        "deadline": detail["deadline"],
        "status": detail["status"],
        "siteTitle": get_setting("site_title", "Filestore"),
        "stats": {
            "submitted": detail["stats"]["submitted"],
            "expected": detail["stats"]["expected"],
            "missing": len(detail["stats"]["missing"]),
        },
        "submissions": submissions,
    }


def delete_task_files(task_id: int) -> None:
    task_dir = UPLOAD_DIR / str(task_id)
    if task_dir.exists() and task_dir.is_dir():
        shutil.rmtree(task_dir)


def delete_submission_files(conn: sqlite3.Connection, submission_id: int) -> None:
    rows = conn.execute("SELECT path FROM files WHERE submission_id = ?", (submission_id,)).fetchall()
    conn.execute("DELETE FROM files WHERE submission_id = ?", (submission_id,))
    conn.execute("DELETE FROM submissions WHERE id = ?", (submission_id,))
    for row in rows:
        path = ROOT / row["path"]
        if path.exists():
            path.unlink()


def rerename_task_files(conn: sqlite3.Connection, task_id: int, rename_template: str) -> dict:
    rows = conn.execute(
        """
        SELECT
            f.id,
            f.submission_id,
            f.original_name,
            f.stored_name,
            f.path,
            s.data_json
        FROM files f
        JOIN submissions s ON s.id = f.submission_id
        WHERE s.task_id = ?
        ORDER BY f.submission_id ASC, f.id ASC
        """,
        (task_id,),
    ).fetchall()

    by_submission: dict[int, list[sqlite3.Row]] = {}
    for row in rows:
        by_submission.setdefault(row["submission_id"], []).append(row)

    result = {"renamed": 0, "unchanged": 0, "missing": 0}
    for submission_id, files in by_submission.items():
        total_files = len(files)
        data = json.loads(files[0]["data_json"]) if files else {}
        for index, row in enumerate(files, start=1):
            stored_name = render_name(rename_template, data, row["original_name"] or "file", index, total_files)
            relative = Path("uploads") / str(task_id) / f"{submission_id}-{stored_name}"
            source = (ROOT / row["path"]).resolve()
            target = (ROOT / relative).resolve()
            uploads_root = UPLOAD_DIR.resolve()
            if uploads_root not in source.parents or uploads_root not in target.parents:
                raise ValueError("重命名目标路径不安全")
            if source == target and row["stored_name"] == stored_name:
                result["unchanged"] += 1
                continue
            if source == target:
                conn.execute(
                    "UPDATE files SET stored_name = ?, path = ? WHERE id = ?",
                    (stored_name, str(relative), row["id"]),
                )
                result["renamed"] += 1
                continue
            if source.exists():
                if target.exists() and source != target:
                    raise ValueError(f"目标文件已存在：{stored_name}")
                target.parent.mkdir(parents=True, exist_ok=True)
                source.rename(target)
                conn.execute(
                    "UPDATE files SET stored_name = ?, path = ? WHERE id = ?",
                    (stored_name, str(relative), row["id"]),
                )
                result["renamed"] += 1
            else:
                result["missing"] += 1
    return result


def submission_identity(data: dict) -> str:
    return str(data.get("student_id") or data.get("name") or "").strip()


def get_file_row(file_id: int) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute(
            """
            SELECT
                f.*,
                s.task_id,
                s.data_json,
                s.created_at AS submission_created_at,
                t.title AS task_title
            FROM files f
            JOIN submissions s ON s.id = f.submission_id
            JOIN tasks t ON t.id = s.task_id
            WHERE f.id = ?
            """,
            (file_id,),
        ).fetchone()


def file_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "submissionId": row["submission_id"],
        "taskId": row["task_id"],
        "originalName": row["original_name"],
        "storedName": row["stored_name"],
        "mimeType": row["mime_type"],
        "size": row["size"],
        "path": row["path"],
        "taskTitle": row["task_title"],
        "submissionData": json.loads(row["data_json"]),
        "submissionCreatedAt": row["submission_created_at"],
    }


def resolve_stored_file(row: sqlite3.Row) -> Path | None:
    source = (ROOT / row["path"]).resolve()
    uploads_root = UPLOAD_DIR.resolve()
    if uploads_root not in source.parents:
        return None
    return source if source.exists() and source.is_file() else None


class AppHandler(SimpleHTTPRequestHandler):
    server_version = "Filestore/0.1"

    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        if parsed.path == "/":
            return str(PUBLIC / "admin.html")
        if parsed.path.startswith("/submit/"):
            return str(PUBLIC / "submit.html")
        if parsed.path.startswith("/status/"):
            return str(PUBLIC / "status.html")
        return str(PUBLIC / parsed.path.lstrip("/"))

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/health":
            send_json(self, {"ok": True, "time": now_iso()})
            return
        if path == "/api/admin/me":
            if not require_admin(self):
                return
            send_json(self, {"ok": True, "role": "admin", "settings": app_settings()})
            return
        if path == "/api/settings":
            if not require_admin(self):
                return
            send_json(self, app_settings())
            return
        if path == "/api/tasks":
            if not require_admin(self):
                return
            with connect() as conn:
                rows = conn.execute("SELECT * FROM tasks ORDER BY created_at DESC").fetchall()
            send_json(self, [task_to_dict(row) for row in rows])
            return
        match = re.fullmatch(r"/api/tasks/(\d+)", path)
        if match:
            if not require_admin(self):
                return
            task = build_task_detail(int(match.group(1)))
            if not task:
                send_json(self, {"error": "任务不存在"}, HTTPStatus.NOT_FOUND)
                return
            send_json(self, task)
            return
        match = re.fullmatch(r"/api/public/tasks/([A-Za-z0-9_-]+)", path)
        if match:
            task = get_task_by_token(match.group(1))
            if not task:
                send_json(self, {"error": "提交链接不存在"}, HTTPStatus.NOT_FOUND)
                return
            public_task = {key: task[key] for key in ["title", "description", "deadline", "fields", "fileRules", "renameTemplate", "folderTemplate", "status"]}
            public_task["siteTitle"] = get_setting("site_title", "Filestore")
            send_json(self, public_task)
            return
        match = re.fullmatch(r"/api/public/status/([A-Za-z0-9_-]+)", path)
        if match:
            status = build_public_status(match.group(1))
            if not status:
                send_json(self, {"error": "成功名单不存在"}, HTTPStatus.NOT_FOUND)
                return
            send_json(self, status)
            return
        match = re.fullmatch(r"/api/tasks/(\d+)/export.csv", path)
        if match:
            if not require_admin(self):
                return
            self.export_csv(int(match.group(1)))
            return
        match = re.fullmatch(r"/api/tasks/(\d+)/download.zip", path)
        if match:
            if not require_admin(self):
                return
            send_json(self, {"error": "ZIP 已改为浏览器端打包，请在管理界面点击下载 ZIP"}, HTTPStatus.GONE)
            return
        match = re.fullmatch(r"/api/files/(\d+)", path)
        if match:
            if not require_admin(self):
                return
            row = get_file_row(int(match.group(1)))
            if not row:
                send_json(self, {"error": "文件不存在"}, HTTPStatus.NOT_FOUND)
                return
            send_json(self, file_row_to_dict(row))
            return
        match = re.fullmatch(r"/api/files/(\d+)/(download|preview)", path)
        if match:
            if not require_admin(self):
                return
            self.send_file(int(match.group(1)), inline=match.group(2) == "preview")
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/admin/login":
            payload = read_json_body(self)
            attempt = str(payload.get("password", ""))
            if verify_password(attempt, admin_password()):
                # 自动升级：如果 settings 表里还是明文（旧版本或首次启动用 env 默认），
                # 现在落库为 scrypt 哈希
                current_stored = get_setting("admin_password", "")
                if not current_stored.startswith("scrypt$"):
                    set_setting("admin_password", hash_password(attempt))
                session = secrets.token_urlsafe(32)
                SESSIONS.add(session)
                send_json(
                    self,
                    {"ok": True, "role": "admin", "settings": app_settings()},
                    extra_headers={
                        "Set-Cookie": f"filestore_session={session}; Path=/; HttpOnly; SameSite=Lax"
                    },
                )
            else:
                send_json(self, {"error": "管理员密码错误"}, HTTPStatus.UNAUTHORIZED)
            return
        if path == "/api/admin/password":
            if not require_admin(self):
                return
            payload = read_json_body(self)
            current = str(payload.get("currentPassword", ""))
            new_password = str(payload.get("newPassword", ""))
            if not verify_password(current, admin_password()):
                send_json(self, {"error": "当前密码错误"}, HTTPStatus.BAD_REQUEST)
                return
            if len(new_password) < 6:
                send_json(self, {"error": "新密码至少需要 6 位"}, HTTPStatus.BAD_REQUEST)
                return
            set_setting("admin_password", hash_password(new_password))
            SESSIONS.clear()
            send_json(
                self,
                {"ok": True},
                extra_headers={
                    "Set-Cookie": "filestore_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
                },
            )
            return
        if path == "/api/admin/logout":
            session = current_session(self)
            if session:
                SESSIONS.discard(session)
            send_json(
                self,
                {"ok": True},
                extra_headers={
                    "Set-Cookie": "filestore_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
                },
            )
            return
        if path == "/api/settings":
            if not require_admin(self):
                return
            try:
                payload = read_json_body(self)
                site_url = normalize_site_url(str(payload.get("siteUrl", "")))
                site_title = str(payload.get("siteTitle", "Filestore")).strip()[:60] or "Filestore"
                templates_value = None
                should_update_templates = "taskTemplates" in payload
                if should_update_templates:
                    templates = payload.get("taskTemplates") or []
                    if not isinstance(templates, list):
                        raise ValueError("模板数据格式不正确")
                    templates_value = json.dumps(
                        [validate_task_template(item) for item in templates],
                        ensure_ascii=False,
                    )
            except Exception as exc:
                send_json(self, {"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            set_setting("site_url", site_url)
            set_setting("site_title", site_title)
            if should_update_templates:
                set_setting("task_templates", templates_value or "[]")
                set_setting("task_template", "")
            send_json(self, app_settings())
            return
        if path == "/api/tasks":
            if not require_admin(self):
                return
            try:
                payload = normalize_task_payload(read_json_body(self))
            except Exception as exc:
                send_json(self, {"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            token = secrets.token_urlsafe(12)
            with connect() as conn:
                conn.execute(
                    """
                    INSERT INTO tasks (
                        token, title, description, deadline, fields_json, file_rules_json,
                        rename_template, folder_template, expected_entries, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        token,
                        payload["title"],
                        payload["description"],
                        payload["deadline"],
                        json.dumps(payload["fields"], ensure_ascii=False),
                        json.dumps(payload["fileRules"], ensure_ascii=False),
                        payload["renameTemplate"],
                        payload["folderTemplate"],
                        payload["expectedEntries"],
                        payload["status"],
                        now_iso(),
                    ),
                )
                task_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            send_json(self, build_task_detail(task_id), HTTPStatus.CREATED)
            return
        rerename_match = re.fullmatch(r"/api/tasks/(\d+)/rename-files", path)
        if rerename_match:
            if not require_admin(self):
                return
            task_id = int(rerename_match.group(1))
            try:
                with connect() as conn:
                    row = conn.execute("SELECT rename_template FROM tasks WHERE id = ?", (task_id,)).fetchone()
                    if not row:
                        send_json(self, {"error": "任务不存在"}, HTTPStatus.NOT_FOUND)
                        return
                    result = rerename_task_files(conn, task_id, row["rename_template"])
            except Exception as exc:
                send_json(self, {"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            send_json(self, {"ok": True, "result": result})
            return
        match = re.fullmatch(r"/api/submit/([A-Za-z0-9_-]+)", path)
        if match:
            self.handle_submit(match.group(1))
            return
        send_json(self, {"error": "接口不存在"}, HTTPStatus.NOT_FOUND)

    def do_PATCH(self) -> None:
        if not require_admin(self):
            return
        path = urlparse(self.path).path
        task_match = re.fullmatch(r"/api/tasks/(\d+)", path)
        if task_match:
            try:
                raw_payload = read_json_body(self)
                payload = normalize_task_payload(raw_payload)
            except Exception as exc:
                send_json(self, {"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            task_id = int(task_match.group(1))
            rename_result = None
            try:
                with connect() as conn:
                    cursor = conn.execute(
                        """
                        UPDATE tasks
                        SET title = ?, description = ?, deadline = ?, fields_json = ?,
                            file_rules_json = ?, rename_template = ?, folder_template = ?, expected_entries = ?, status = ?
                        WHERE id = ?
                        """,
                        (
                            payload["title"],
                            payload["description"],
                            payload["deadline"],
                            json.dumps(payload["fields"], ensure_ascii=False),
                            json.dumps(payload["fileRules"], ensure_ascii=False),
                            payload["renameTemplate"],
                            payload["folderTemplate"],
                            payload["expectedEntries"],
                            payload["status"],
                            task_id,
                        ),
                    )
                    if cursor.rowcount and raw_payload.get("renameExistingFiles"):
                        rename_result = rerename_task_files(conn, task_id, payload["renameTemplate"])
            except Exception as exc:
                send_json(self, {"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            if cursor.rowcount == 0:
                send_json(self, {"error": "任务不存在"}, HTTPStatus.NOT_FOUND)
                return
            detail = build_task_detail(task_id)
            if detail and rename_result is not None:
                detail["renameResult"] = rename_result
            send_json(self, detail)
            return

        send_json(self, {"error": "接口不存在"}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        if not require_admin(self):
            return
        path = urlparse(self.path).path
        task_match = re.fullmatch(r"/api/tasks/(\d+)", path)
        if task_match:
            task_id = int(task_match.group(1))
            with connect() as conn:
                # 依赖 schema 中的 ON DELETE CASCADE + PRAGMA foreign_keys=ON
                # 删除任务会自动级联清理 submissions 和 files 两张表
                cursor = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            delete_task_files(task_id)
            if cursor.rowcount == 0:
                send_json(self, {"error": "任务不存在"}, HTTPStatus.NOT_FOUND)
                return
            send_json(self, {"ok": True})
            return

        match = re.fullmatch(r"/api/submissions/(\d+)", path)
        if match:
            submission_id = int(match.group(1))
            with connect() as conn:
                # 先查文件路径用于磁盘清理，再删 submission（CASCADE 自动删 files 表行）
                files = conn.execute("SELECT path FROM files WHERE submission_id = ?", (submission_id,)).fetchall()
                conn.execute("DELETE FROM submissions WHERE id = ?", (submission_id,))
            for row in files:
                path = ROOT / row["path"]
                if path.exists():
                    path.unlink()
            send_json(self, {"ok": True})
            return

        file_match = re.fullmatch(r"/api/files/(\d+)", path)
        if not file_match:
            send_json(self, {"error": "接口不存在"}, HTTPStatus.NOT_FOUND)
            return
        file_id = int(file_match.group(1))
        with connect() as conn:
            row = conn.execute("SELECT path FROM files WHERE id = ?", (file_id,)).fetchone()
            if not row:
                send_json(self, {"error": "文件不存在"}, HTTPStatus.NOT_FOUND)
                return
            conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
        path = ROOT / row["path"]
        if path.exists():
            path.unlink()
        send_json(self, {"ok": True})

    def handle_submit(self, token: str) -> None:
        task = get_task_by_token(token)
        if not task:
            send_json(self, {"error": "提交链接不存在"}, HTTPStatus.NOT_FOUND)
            return

        try:
            parts = parse_multipart(
                self.rfile,
                self.headers.get("Content-Type", ""),
                int(self.headers.get("Content-Length", "0")),
            )
        except ValueError as exc:
            send_json(self, {"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        data: dict[str, str] = {}
        upload_items: list[UploadPart] = []
        for entries in parts.values():
            for entry in entries:
                if entry.filename:
                    upload_items.append(entry)
                else:
                    data[entry.name] = entry.value

        errors = validate_submission(task, data, upload_items)
        if errors:
            send_json(self, {"error": "提交校验失败", "details": errors}, HTTPStatus.BAD_REQUEST)
            return

        task_dir = UPLOAD_DIR / str(task["id"])
        task_dir.mkdir(parents=True, exist_ok=True)
        with connect() as conn:
            identity = submission_identity(data)
            if identity:
                existing = conn.execute(
                    "SELECT id, data_json FROM submissions WHERE task_id = ?",
                    (task["id"],),
                ).fetchall()
                for row in existing:
                    old_data = json.loads(row["data_json"])
                    if submission_identity(old_data) == identity:
                        delete_submission_files(conn, row["id"])
            cursor = conn.execute(
                "INSERT INTO submissions (task_id, data_json, ip, status, created_at) VALUES (?, ?, ?, ?, ?)",
                (task["id"], json.dumps(data, ensure_ascii=False), self.client_address[0], "submitted", now_iso()),
            )
            submission_id = cursor.lastrowid
            saved_files = []
            total_files = len(upload_items)
            for index, item in enumerate(upload_items, start=1):
                stored_name = render_name(task["renameTemplate"], data, item.filename or "file", index, total_files)
                unique_name = f"{submission_id}-{stored_name}"
                relative = Path("uploads") / str(task["id"]) / unique_name
                target = ROOT / relative
                with target.open("wb") as out:
                    shutil.copyfileobj(item.file, out)
                size = target.stat().st_size
                conn.execute(
                    """
                    INSERT INTO files (submission_id, original_name, stored_name, mime_type, size, path)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (submission_id, item.filename or "file", stored_name, item.type or "", size, str(relative)),
                )
                saved_files.append(stored_name)
        send_json(self, {"ok": True, "submissionId": submission_id, "files": saved_files}, HTTPStatus.CREATED)

    def export_csv(self, task_id: int) -> None:
        task = build_task_detail(task_id)
        if not task:
            send_json(self, {"error": "任务不存在"}, HTTPStatus.NOT_FOUND)
            return
        output = io.StringIO()
        writer = csv.writer(output)
        field_labels = [field["label"] for field in task["fields"]]
        field_keys = [field["key"] for field in task["fields"]]
        writer.writerow(["提交ID", *field_labels, "提交时间", "IP", "文件"])
        for item in task["submissions"]:
            writer.writerow(
                [
                    item["id"],
                    *[item["data"].get(key, "") for key in field_keys],
                    item["createdAt"],
                    item["ip"],
                    "; ".join(file["storedName"] for file in item["files"]),
                ]
            )
        body = ("\ufeff" + output.getvalue()).encode("utf-8")
        filename = safe_filename(task["title"]) + ".csv"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(filename)}")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, file_id: int, inline: bool) -> None:
        row = get_file_row(file_id)
        if not row:
            send_json(self, {"error": "文件不存在"}, HTTPStatus.NOT_FOUND)
            return
        source = resolve_stored_file(row)
        if not source:
            send_json(self, {"error": "文件已丢失"}, HTTPStatus.NOT_FOUND)
            return
        stored_name = row["stored_name"]
        mime_type = row["mime_type"] or mimetypes.guess_type(stored_name)[0] or "application/octet-stream"
        disposition = "inline" if inline else "attachment"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Disposition", f"{disposition}; filename*=UTF-8''{quote(stored_name)}")
        self.send_header("Content-Length", str(source.stat().st_size))
        self.end_headers()
        with source.open("rb") as handle:
            shutil.copyfileobj(handle, self.wfile)


def main() -> None:
    init_db()
    port = int(os.environ.get("PORT", "8964"))
    server = ThreadingHTTPServer(("127.0.0.1", port), AppHandler)
    print(f"Filestore running at http://127.0.0.1:{port}")
    print(f"Default admin password: {ADMIN_PASSWORD}")
    server.serve_forever()


if __name__ == "__main__":
    main()
