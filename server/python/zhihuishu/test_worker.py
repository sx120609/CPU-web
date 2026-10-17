"""Adapter regression tests; fake upstream, no external accounts or network."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

FAKE = '''
import base64
from types import SimpleNamespace
from logger import logger
class CaptchaException(Exception): pass
class TimeLimitExceeded(Exception): pass
class Store(dict): pass
class Response:
    def __init__(self, data): self.data = data
    def json(self): return self.data
class Session:
    cookies = {"CASLOGC": "PRIVATE_COOKIE"}
    def get(self, url, **kwargs):
        if "getLoginQrImg" in url:
            return Response({"qrToken":"PRIVATE_TOKEN", "img":base64.b64encode(b"\\x89PNG\\r\\n\\x1a\\nFAKE").decode()})
        if "getLoginQrInfo" in url:
            return Response({"status":1, "oncePassword":"PRIVATE_PASSWORD"})
        return Response({})
class Fucker:
    def __init__(self, **kwargs):
        self.session = Session(); self.courses = Store(); self.context = Store()
    def _sessionReady(self): pass
    def login(self, **kwargs):
        self._qrlogin(kwargs["qr_callback"])
        print("PRIVATE_COOKIE")
    def getZhidaoList(self):
        return [{"secret":key, "courseName":key} for key in ["one", "captcha", "hidden-error", "popup", "direct-answer", "direct-submit", "speed", "ai", "pause", "request"]]
    def getHikeList(self): return [{"courseId":"skip", "courseName":"校内测试课"}]
    def getZhidaoContext(self, course):
        return SimpleNamespace(videos={"video":SimpleNamespace(name="测试视频")})
    def fuckZhidaoCourse(self, course):
        try: self.fuckZhidaoVideo(course, "video")
        except Exception: pass
    def fuckZhidaoVideo(self, course, video):
        if course == "captcha": raise CaptchaException("PRIVATE_COOKIE")
        if course == "hidden-error": logger.error("PRIVATE_COOKIE")
        if course == "popup":
            self.lessonPopoupExam(1, 2, [3])
            self.saveLessonPopupExamSaveAnswer(1, 2, 3, self.answerZhidao({}))
        if course == "direct-answer": self.answerZhidao({})
        if course == "direct-submit": self.saveLessonPopupExamSaveAnswer(1, 2, 3, "a")
        if course == "ai": self.fuckAiCourse(1)
        if course == "pause":
            progressBar(18, 100)
            self.last_progress_at = 0
            progressBar(10, 60, prefix="pause a minute")
            return
        if course == "request": self._apiQuery("https://example.invalid/saveDatabaseIntervalTimeV2?token=PRIVATE_TOKEN")
        if course == "speed":
            progressBar(self.speed * 10, 100)
            return
        progressBar(25, 100)
    def lessonPopoupExam(self, *args): return {}
    def _apiQuery(self, *args, **kwargs): return {}
    def answerZhidao(self, *args): return "answer"
    def saveLessonPopupExamSaveAnswer(self, *args): return True
    def fuckHikeVideo(self, *args): pass
    def fuckFile(self, *args): pass
    def fuckHikeCourse(self, course_id):
        for name, kind in [("第一章练习", None), ("未知资料", None), ("下一节视频", 3)]:
            self._traverse(course_id, SimpleNamespace(childList=None, dataType=kind, name=name))
    def _traverse(self, course_id, node, depth=0):
        if node.dataType is None: raise AssertionError("unsupported node must be skipped")
        progressBar(80, 100)
'''

class WorkerTests(unittest.TestCase):
    def run_commands(self, commands):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            shutil.copyfile(Path(__file__).with_name("worker.py"), root / "worker.py")
            (root / "vendor").mkdir()
            (root / "vendor" / "fucker.py").write_text(FAKE)
            result = subprocess.run([sys.executable, "-I", "-u", str(root / "worker.py")], input="".join(json.dumps(c) + "\n" for c in commands), text=True, capture_output=True, timeout=8)
            self.assertEqual(result.returncode, 0)
            self.assertNotIn("PRIVATE_", result.stdout + result.stderr)
            self.assertEqual(list(root.glob("*.json")), [])
            return [json.loads(line) for line in result.stdout.splitlines()]

    def test_login_and_run(self):
        events = self.run_commands([{"action":"login"}, {"action":"run", "courses":[{"key":"shared:one", "id":"forged", "kind":"hike"}]}])
        self.assertEqual(events[0]["type"], "ready")
        self.assertEqual(events[1]["type"], "qr")
        self.assertEqual(events[2]["type"], "courses")
        self.assertEqual(events[-1]["type"], "done")
        self.assertTrue(any(e.get("percent") == 25 for e in events))

    def test_captcha_cannot_be_swallowed_as_success(self):
        events = self.run_commands([{"action":"login"}, {"action":"run", "courses":[{"key":"shared:captcha"}]}])
        self.assertEqual(events[-1]["type"], "error")
        self.assertIn("验证码", events[-1]["message"])
        self.assertNotIn("done", [e["type"] for e in events])

    def test_internal_error_cannot_be_swallowed_as_success(self):
        events = self.run_commands([{"action":"login"}, {"action":"run", "courses":[{"key":"shared:hidden-error"}]}])
        self.assertEqual(events[-1]["type"], "error")
        self.assertNotIn("courseDone", [e["type"] for e in events])

    def test_unknown_course_rejected(self):
        events = self.run_commands([{"action":"login"}, {"action":"run", "courses":[{"key":"shared:not-mine"}]}])
        self.assertEqual(events[-1]["type"], "error")

    def test_run_requires_login(self):
        events = self.run_commands([{"action":"run", "courses":[{"key":"shared:one"}]}])
        self.assertEqual(events[-1]["type"], "error")

    def test_answer_and_submission_disabled_by_default_at_each_entry(self):
        for key in ["popup", "direct-answer", "direct-submit"]:
            with self.subTest(key=key):
                events = self.run_commands([{"action":"login"}, {"action":"run", "courses":[{"key":"shared:" + key}]}])
                self.assertEqual(events[-1]["type"], "error")
                self.assertIn("关闭", events[-1]["message"])
                self.assertNotIn("courseDone", [e["type"] for e in events])

    def test_submission_requires_separate_opt_in(self):
        for submit in [False, True]:
            events = self.run_commands([{"action":"login"}, {"action":"run", "autoAnswer":True, "autoSubmit":submit, "courses":[{"key":"shared:popup"}]}])
            self.assertEqual(events[-1]["type"], "done" if submit else "error")
            if not submit: self.assertIn("未提交答案", events[-1]["message"])

    def test_ai_course_remains_unavailable(self):
        events = self.run_commands([{"action":"login"}, {"action":"run", "autoAnswer":True, "autoSubmit":True, "courses":[{"key":"shared:ai"}]}])
        self.assertIn("未开放", events[-1]["message"])

    def test_speed_reaches_engine_and_invalid_speed_is_rejected(self):
        for speed in [0.5, 2, 100, True]:
            events = self.run_commands([{"action":"login"}, {"action":"run", "speed":speed, "courses":[{"key":"shared:speed"}]}])
            if type(speed) is not bool and speed in [0.5, 2]:
                self.assertEqual(events[-1]["type"], "done")
                self.assertTrue(any(e.get("percent") == speed * 10 for e in events))
            else:
                self.assertEqual(events[-1]["type"], "error")

    def test_pause_keeps_video_percentage_and_reports_countdown(self):
        events = self.run_commands([{"action":"login"}, {"action":"run", "courses":[{"key":"shared:pause"}]}])
        self.assertEqual([e["percent"] for e in events if e["type"] == "progress" and e["percent"] is not None], [18])
        self.assertTrue(any("50 秒" in e.get("message", "") for e in events))

    def test_request_reports_phase_without_request_data(self):
        events = self.run_commands([{"action":"login"}, {"action":"run", "courses":[{"key":"shared:request"}]}])
        self.assertTrue(any("上报视频学习进度" in e.get("message", "") for e in events))
        self.assertTrue(any("接口已返回" in e.get("message", "") for e in events))

    def test_hike_skip_notices_include_titles_and_continue(self):
        events = self.run_commands([{"action":"login"}, {"action":"run", "courses":[{"key":"hike:skip"}]}])
        notices = [e for e in events if e["type"] == "notice"]
        self.assertEqual(len(notices), 2)
        self.assertTrue(all(e["kind"] == "skipped" and "未作答、未提交" in e["message"] for e in notices))
        self.assertIn("第一章练习", notices[0]["message"])
        self.assertIn("可能为练习", notices[1]["message"])
        self.assertTrue(any(e.get("percent") == 80 for e in events))
        self.assertEqual(events[-1]["type"], "done")

    def test_shared_exercises_are_uninspected_not_fabricated_skips(self):
        events = self.run_commands([{"action":"login"}, {"action":"run", "courses":[{"key":"shared:one"}]}])
        notices = [e for e in events if e["type"] == "notice"]
        self.assertEqual(len(notices), 1)
        self.assertEqual(notices[0]["kind"], "uninspected")
        self.assertIn("未检查", notices[0]["message"])

if __name__ == "__main__":
    unittest.main()
