"""Filestore 核心纯函数测试。

只测试不带 IO 副作用的函数，不触发 init_db / connect。
运行：python -m unittest discover tests -v
"""
from __future__ import annotations

import io
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

# 让 tests/ 能 import 项目根目录下的 app.py
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app


class TestSafeFilename(unittest.TestCase):
    def test_basic_ascii(self):
        self.assertEqual(app.safe_filename("hello.txt"), "hello.txt")

    def test_keeps_chinese(self):
        self.assertEqual(app.safe_filename("张三.pdf"), "张三.pdf")

    def test_replaces_illegal_chars(self):
        # / \ : * ? " < > | 不在允许集合中
        self.assertEqual(app.safe_filename("a/b\\c:d*e.txt"), "a_b_c_d_e.txt")

    def test_collapses_whitespace(self):
        self.assertEqual(app.safe_filename("a   b  c"), "a b c")

    def test_strips_leading_trailing(self):
        self.assertEqual(app.safe_filename(" . hello.txt . "), "hello.txt")

    def test_length_limit(self):
        # cleaned 长度上限 140
        long = "a" * 300
        self.assertEqual(len(app.safe_filename(long)), 140)

    def test_empty_falls_back(self):
        self.assertEqual(app.safe_filename(""), "file")
        self.assertEqual(app.safe_filename("   "), "file")
        # 注意：'/' 会替换成 '_'，'_' 在白名单内，所以 "///" -> "___"，并不 fallback。
        self.assertEqual(app.safe_filename("///"), "___")


class TestCleanRenderedName(unittest.TestCase):
    def test_collapses_separators(self):
        self.assertEqual(app.clean_rendered_name("a--b__c"), "a-b-c")

    def test_strips_trailing_separators(self):
        self.assertEqual(app.clean_rendered_name("-_a_-"), "a")

    def test_empty_falls_back(self):
        self.assertEqual(app.clean_rendered_name("---"), "file")
        self.assertEqual(app.clean_rendered_name(""), "file")


class TestRenderTemplateBase(unittest.TestCase):
    def test_basic_substitution(self):
        result = app.render_template_base(
            "{name}-{student_id}",
            {"name": "张三", "student_id": "2020240444"},
        )
        self.assertEqual(result, "张三-2020240444")

    def test_last_n(self):
        result = app.render_template_base(
            "{student_id|last:2}",
            {"student_id": "2020240444"},
        )
        self.assertEqual(result, "44")

    def test_first_n(self):
        result = app.render_template_base(
            "{student_id|first:4}",
            {"student_id": "2020240444"},
        )
        self.assertEqual(result, "2020")

    def test_index_blank_when_single(self):
        # totalCount=1 时 {index} 应为空
        result = app.render_template_base(
            "{name}-{index}",
            {"name": "张三"},
            total_count=1,
        )
        # 空 index 会被 clean 掉尾部分隔符
        self.assertEqual(result, "张三")

    def test_index_present_when_multi(self):
        result = app.render_template_base(
            "{name}-{index}",
            {"name": "张三"},
            index=3,
            total_count=5,
        )
        self.assertEqual(result, "张三-3")

    def test_original(self):
        result = app.render_template_base(
            "{original}",
            {},
            original_name="report.pdf",
        )
        self.assertEqual(result, "report")

    def test_missing_field_becomes_empty(self):
        result = app.render_template_base(
            "{name}-{missing}",
            {"name": "张三"},
        )
        # 缺失字段 -> 空 -> 尾部 - 被清理
        self.assertEqual(result, "张三")


class TestRenderName(unittest.TestCase):
    def test_single_file_keeps_extension(self):
        result = app.render_name(
            "{name}-{student_id}",
            {"name": "张三", "student_id": "2020240444"},
            "report.PDF",
            1,
            1,
        )
        self.assertEqual(result, "张三-2020240444.pdf")

    def test_multi_file_auto_index(self):
        # template 不含 {index}，多文件时自动追加 -N
        result = app.render_name(
            "{name}-{student_id}",
            {"name": "张三", "student_id": "2020240444"},
            "a.jpg",
            2,
            3,
        )
        self.assertEqual(result, "张三-2020240444-2.jpg")

    def test_multi_file_explicit_index(self):
        # template 含 {index}，不再追加
        result = app.render_name(
            "{name}-{index}",
            {"name": "张三"},
            "a.jpg",
            2,
            3,
        )
        self.assertEqual(result, "张三-2.jpg")

    def test_lowercases_extension(self):
        result = app.render_name(
            "{name}",
            {"name": "x"},
            "PHOTO.JPG",
            1,
            1,
        )
        self.assertEqual(result, "x.jpg")


class TestNormalizeTaskPayload(unittest.TestCase):
    def _minimal(self, **overrides):
        payload = {
            "title": "测试任务",
            "fields": [{"key": "name", "label": "姓名"}],
            "fileRules": {"allowedTypes": "pdf,jpg", "maxSizeMb": 20, "maxCount": 1},
            "renameTemplate": "{name}",
            "folderTemplate": "{name}",
        }
        payload.update(overrides)
        return payload

    def test_basic(self):
        result = app.normalize_task_payload(self._minimal())
        self.assertEqual(result["title"], "测试任务")
        self.assertEqual(result["fields"][0]["key"], "name")
        self.assertEqual(result["fileRules"]["allowedTypes"], ["pdf", "jpg"])

    def test_empty_title_rejected(self):
        with self.assertRaises(ValueError):
            app.normalize_task_payload(self._minimal(title=""))

    def test_no_fields_rejected(self):
        with self.assertRaises(ValueError):
            app.normalize_task_payload(self._minimal(fields=[]))

    def test_duplicate_keys_rejected(self):
        with self.assertRaises(ValueError):
            app.normalize_task_payload(
                self._minimal(
                    fields=[
                        {"key": "name", "label": "姓名"},
                        {"key": "name", "label": "重复"},
                    ]
                )
            )

    def test_invalid_pattern_rejected(self):
        with self.assertRaises(Exception):
            # 不闭合的括号会让 re.compile 抛 error
            app.normalize_task_payload(
                self._minimal(
                    fields=[{"key": "name", "label": "姓名", "pattern": "[a-"}],
                )
            )

    def test_zero_max_size_falls_back_to_default(self):
        # 注意：app.py 用 `float(rules.get("maxSizeMb") or 20)`，0 是 falsy 所以 fallback 到 20。
        # 这是 app.py 中的潜在 bug（用户传 0 不会报错而是被替换），但本次范围保持现有行为。
        result = app.normalize_task_payload(
            self._minimal(fileRules={"allowedTypes": "pdf", "maxSizeMb": 0, "maxCount": 1})
        )
        self.assertEqual(result["fileRules"]["maxSizeMb"], 20)

    def test_zero_max_count_falls_back_to_default(self):
        # 同上，maxCount: 0 被 fallback 成 1
        result = app.normalize_task_payload(
            self._minimal(fileRules={"allowedTypes": "pdf", "maxSizeMb": 10, "maxCount": 0})
        )
        self.assertEqual(result["fileRules"]["maxCount"], 1)

    def test_negative_max_size_rejected(self):
        # 负数不是 falsy，会进入 <= 0 检查并报错
        with self.assertRaises(ValueError):
            app.normalize_task_payload(
                self._minimal(fileRules={"allowedTypes": "pdf", "maxSizeMb": -1, "maxCount": 1})
            )

    def test_allowed_types_as_list(self):
        result = app.normalize_task_payload(
            self._minimal(
                fileRules={"allowedTypes": ["PDF", " JPG "], "maxSizeMb": 10, "maxCount": 1}
            )
        )
        self.assertEqual(result["fileRules"]["allowedTypes"], ["pdf", "jpg"])

    def test_key_sanitization(self):
        # key 中非法字符变成 _
        result = app.normalize_task_payload(
            self._minimal(fields=[{"key": "my-key!", "label": "x"}])
        )
        self.assertEqual(result["fields"][0]["key"], "my_key_")


class TestNormalizeSiteUrl(unittest.TestCase):
    def test_empty_returns_empty(self):
        self.assertEqual(app.normalize_site_url(""), "")
        self.assertEqual(app.normalize_site_url("   "), "")

    def test_strips_trailing_slash(self):
        self.assertEqual(
            app.normalize_site_url("https://example.com/"),
            "https://example.com",
        )

    def test_rejects_non_http(self):
        with self.assertRaises(ValueError):
            app.normalize_site_url("ftp://example.com")

    def test_rejects_path(self):
        with self.assertRaises(ValueError):
            app.normalize_site_url("https://example.com/files")

    def test_accepts_https(self):
        self.assertEqual(
            app.normalize_site_url("https://files.example.com"),
            "https://files.example.com",
        )


class TestRerenameTaskFiles(unittest.TestCase):
    def test_updates_database_and_disk_file(self):
        old_root = app.ROOT
        old_upload_dir = app.UPLOAD_DIR
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            app.ROOT = root
            app.UPLOAD_DIR = root / "uploads"
            try:
                task_dir = app.UPLOAD_DIR / "1"
                task_dir.mkdir(parents=True)
                source = task_dir / "1-old.pdf"
                source.write_bytes(b"PDF")

                conn = sqlite3.connect(":memory:")
                conn.row_factory = sqlite3.Row
                conn.executescript(
                    """
                    CREATE TABLE submissions (
                        id INTEGER PRIMARY KEY,
                        task_id INTEGER NOT NULL,
                        data_json TEXT NOT NULL
                    );
                    CREATE TABLE files (
                        id INTEGER PRIMARY KEY,
                        submission_id INTEGER NOT NULL,
                        original_name TEXT NOT NULL,
                        stored_name TEXT NOT NULL,
                        path TEXT NOT NULL
                    );
                    """
                )
                conn.execute(
                    "INSERT INTO submissions (id, task_id, data_json) VALUES (?, ?, ?)",
                    (1, 1, json.dumps({"name": "沈礼", "student_id": "2420150508"}, ensure_ascii=False)),
                )
                conn.execute(
                    "INSERT INTO files (id, submission_id, original_name, stored_name, path) VALUES (?, ?, ?, ?, ?)",
                    (1, 1, "中国药科大学实验报告(2).pdf", "08 沈礼.pdf", str(Path("uploads") / "1" / "1-old.pdf")),
                )

                result = app.rerename_task_files(conn, 1, "{name}-{student_id|last:2}")

                row = conn.execute("SELECT stored_name, path FROM files WHERE id = 1").fetchone()
                self.assertEqual(result, {"renamed": 1, "unchanged": 0, "missing": 0})
                self.assertEqual(row["stored_name"], "沈礼-08.pdf")
                self.assertFalse(source.exists())
                self.assertTrue((task_dir / "1-沈礼-08.pdf").exists())
            finally:
                app.ROOT = old_root
                app.UPLOAD_DIR = old_upload_dir


def _build_multipart(boundary: bytes, parts: list[tuple[str, str | None, str, bytes]]) -> bytes:
    """构造 multipart/form-data 请求体。

    parts: [(name, filename_or_None, content_type, body_bytes), ...]
    """
    chunks = []
    for name, filename, ctype, body in parts:
        chunks.append(b"--" + boundary + b"\r\n")
        disp = f'Content-Disposition: form-data; name="{name}"'
        if filename is not None:
            disp += f'; filename="{filename}"'
        chunks.append(disp.encode("utf-8") + b"\r\n")
        if ctype:
            chunks.append(f"Content-Type: {ctype}\r\n".encode("utf-8"))
        chunks.append(b"\r\n")
        chunks.append(body)
        chunks.append(b"\r\n")
    chunks.append(b"--" + boundary + b"--\r\n")
    return b"".join(chunks)


class TestParseMultipart(unittest.TestCase):
    def _parse(self, body: bytes, boundary: bytes = b"BOUND"):
        return app.parse_multipart(
            io.BytesIO(body),
            f'multipart/form-data; boundary={boundary.decode()}',
            len(body),
        )

    def test_single_text_field(self):
        body = _build_multipart(b"BOUND", [("name", None, "", b"\xe5\xbc\xa0\xe4\xb8\x89")])
        parts = self._parse(body)
        self.assertIn("name", parts)
        self.assertEqual(parts["name"][0].filename, None)
        self.assertEqual(parts["name"][0].value, "张三")

    def test_single_file(self):
        body = _build_multipart(
            b"BOUND",
            [("files", "report.pdf", "application/pdf", b"PDFDATA")],
        )
        parts = self._parse(body)
        self.assertEqual(parts["files"][0].filename, "report.pdf")
        self.assertEqual(parts["files"][0].type, "application/pdf")
        parts["files"][0].file.seek(0)
        self.assertEqual(parts["files"][0].file.read(), b"PDFDATA")

    def test_multiple_files_same_name(self):
        body = _build_multipart(
            b"BOUND",
            [
                ("files", "a.jpg", "image/jpeg", b"AAA"),
                ("files", "b.jpg", "image/jpeg", b"BBB"),
                ("files", "c.jpg", "image/jpeg", b"CCC"),
            ],
        )
        parts = self._parse(body)
        self.assertEqual(len(parts["files"]), 3)
        self.assertEqual([p.filename for p in parts["files"]], ["a.jpg", "b.jpg", "c.jpg"])

    def test_mixed_fields_and_files(self):
        body = _build_multipart(
            b"BOUND",
            [
                ("name", None, "", b"\xe5\xbc\xa0\xe4\xb8\x89"),
                ("student_id", None, "", b"2020240444"),
                ("files", "doc.pdf", "application/pdf", b"DOC"),
            ],
        )
        parts = self._parse(body)
        self.assertEqual(parts["name"][0].value, "张三")
        self.assertEqual(parts["student_id"][0].value, "2020240444")
        self.assertEqual(parts["files"][0].filename, "doc.pdf")

    def test_chinese_filename(self):
        body = _build_multipart(
            b"BOUND",
            [("files", "中文文件 名.pdf", "application/pdf", b"X")],
        )
        parts = self._parse(body)
        self.assertEqual(parts["files"][0].filename, "中文文件 名.pdf")

    def test_quoted_boundary(self):
        # boundary 带引号
        body = _build_multipart(b"WEIRD-1", [("x", None, "", b"y")])
        parts = app.parse_multipart(
            io.BytesIO(body),
            'multipart/form-data; boundary="WEIRD-1"',
            len(body),
        )
        self.assertEqual(parts["x"][0].value, "y")

    def test_large_file_spools_to_disk(self):
        # 2MB 数据，应该自动落盘（SpooledTemporaryFile max_size=1MB）
        big = b"A" * (2 * 1024 * 1024)
        body = _build_multipart(b"BOUND", [("files", "big.bin", "application/octet-stream", big)])
        parts = self._parse(body)
        parts["files"][0].file.seek(0)
        self.assertEqual(len(parts["files"][0].file.read()), 2 * 1024 * 1024)

    def test_boundary_at_chunk_edge(self):
        # 构造一个体积刚好让 sep 跨 chunk 边界的场景：让 file 内容长度 ≈ chunk_size (64KB)
        body = _build_multipart(
            b"BOUND",
            [("files", "edge.bin", "application/octet-stream", b"Z" * (64 * 1024 - 5))],
        )
        parts = self._parse(body)
        parts["files"][0].file.seek(0)
        self.assertEqual(len(parts["files"][0].file.read()), 64 * 1024 - 5)

    def test_missing_boundary_param(self):
        with self.assertRaises(ValueError):
            app.parse_multipart(io.BytesIO(b""), "multipart/form-data", 0)

    def test_empty_body(self):
        with self.assertRaises(ValueError):
            app.parse_multipart(io.BytesIO(b""), "multipart/form-data; boundary=BOUND", 0)

    def test_truncated_body(self):
        # 体积报 100，实际 10 字节
        body = b"--BOUND\r\nContent-Disposition: form-data; name=\"x\"\r\n\r\n"
        with self.assertRaises(ValueError):
            app.parse_multipart(io.BytesIO(body), "multipart/form-data; boundary=BOUND", len(body))

    def test_empty_form(self):
        # 仅有结束分隔符
        body = b"--BOUND--\r\n"
        parts = self._parse(body)
        self.assertEqual(parts, {})

    def test_exceeds_max_size(self):
        with self.assertRaises(ValueError):
            app.parse_multipart(
                io.BytesIO(b""),
                "multipart/form-data; boundary=BOUND",
                app.MAX_REQUEST_BYTES + 1,
            )


class TestPasswordHash(unittest.TestCase):
    def test_hash_format(self):
        h = app.hash_password("secret123")
        # 格式：scrypt$n$r$p$salt$hash
        self.assertTrue(h.startswith("scrypt$"))
        parts = h.split("$")
        self.assertEqual(len(parts), 6)
        self.assertEqual(parts[0], "scrypt")

    def test_hash_is_salted(self):
        # 同一密码两次哈希应当不同（随机 salt）
        self.assertNotEqual(app.hash_password("same"), app.hash_password("same"))

    def test_verify_correct(self):
        h = app.hash_password("correct horse battery staple")
        self.assertTrue(app.verify_password("correct horse battery staple", h))

    def test_verify_wrong(self):
        h = app.hash_password("correct")
        self.assertFalse(app.verify_password("wrong", h))

    def test_verify_plaintext_compatibility(self):
        # 兼容路径：stored 不是 scrypt$ 开头 → 视为明文
        self.assertTrue(app.verify_password("admin123", "admin123"))
        self.assertFalse(app.verify_password("wrong", "admin123"))

    def test_verify_empty_stored(self):
        self.assertFalse(app.verify_password("anything", ""))

    def test_verify_malformed_stored(self):
        # 损坏的 scrypt 格式不应抛异常，返回 False
        self.assertFalse(app.verify_password("x", "scrypt$bad"))
        self.assertFalse(app.verify_password("x", "scrypt$1$2$3$nothex$nothex"))
        self.assertFalse(app.verify_password("x", "scrypt$$$$$"))

    def test_verify_unicode_password(self):
        h = app.hash_password("中文密码🔒")
        self.assertTrue(app.verify_password("中文密码🔒", h))
        self.assertFalse(app.verify_password("中文密码", h))


if __name__ == "__main__":
    unittest.main()
