"""One CPU-web user per process. JSONL control channel; credentials stay in memory."""
import base64
import json
import logging
import os
import sys
import time
import types
import threading
from pathlib import Path

# Frozen interpreters ignore PYTHONIOENCODING. Configure both directions before
# any I/O so Windows ANSI code pages cannot corrupt course names or commands.
for stream in (sys.stdin, sys.stdout, sys.stderr):
    if stream is not None and hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="strict")
CHANNEL = sys.stdout


def emit(event_type, **payload):
    # ASCII JSON escapes preserve all Unicode and make framing locale-independent.
    CHANNEL.write(json.dumps({"type": event_type, **payload}, ensure_ascii=True) + "\n")
    CHANNEL.flush()


class OperationFailed(BaseException):
    """Bypass the upstream course loops which otherwise swallow video errors."""


class VerificationRequired(OperationFailed):
    """Carry a verification signal past upstream exception-swallowing loops."""


class RedactedLogger:
    failed = False
    def debug(self, *args, **kwargs): pass
    def info(self, *args, **kwargs): pass
    def warning(self, *args, **kwargs): pass
    def error(self, *args, **kwargs): self.failed = True
    def exception(self, *args, **kwargs): self.failed = True


def main():
    # Also stop on an ungraceful Node crash. A background task must not outlive
    # its controlling server and lose its user-visible stop button.
    parent_pid = os.getppid()
    def watch_parent():
        while os.getppid() == parent_pid:
            time.sleep(2)
        os._exit(0)
    threading.Thread(target=watch_parent, daemon=True).start()
    # Never route upstream prints, HTTP details or one-time login codes to the UI.
    sys.stdout = open(os.devnull, "w")
    sys.stderr = open(os.devnull, "w")
    logging.disable(logging.CRITICAL)
    logger_module = types.ModuleType("logger")
    logger_module.logger = RedactedLogger()
    sys.modules["logger"] = logger_module
    sys.path.insert(0, str(Path(__file__).parent / "vendor"))
    try:
        import fucker as upstream
    except Exception:
        emit("error", message="Python 依赖不完整，请管理员按部署说明安装")
        return

    class WebEngine(upstream.Fucker):
        auto_answer = False
        auto_submit = False
        course_key = ""
        course_name = ""
        title = ""
        last_progress_at = 0

        def activity(self, message):
            emit("activity", message=message)

        def _apiQuery(self, url, *args, **kwargs):
            # Only our labels cross the process boundary, never request data.
            endpoint = str(url).split("?")[0].rstrip("/").rsplit("/", 1)[-1]
            label = {
                "saveDatabaseIntervalTimeV2": "正在上报视频学习进度，等待智慧树响应",
                "saveStuStudyRecord": "正在上报校内课进度，等待智慧树响应",
                "lessonPopupExam": "正在读取视频弹题，等待智慧树响应",
                "saveLessonPopupExamSaveAnswer": "正在提交弹题答案，等待智慧树响应",
            }.get(endpoint, "正在读取课程接口，等待智慧树响应")
            self.activity(label)
            result = super()._apiQuery(url, *args, **kwargs)
            self.activity("智慧树接口已返回，继续处理")
            return result

        def zhidaoQuery(self, *args, **kwargs):
            try:
                return super().zhidaoQuery(*args, **kwargs)
            except upstream.CaptchaException:
                raise VerificationRequired()

        def guarded(self, operation, title, *args):
            self.title = str(title)[:300]
            self.last_progress_at = 0
            self.activity("正在准备当前内容")
            emit("progress", courseKey=self.course_key, title=self.title, percent=None)
            try:
                return operation(*args)
            except upstream.CaptchaException:
                raise VerificationRequired()
            except upstream.TimeLimitExceeded:
                raise OperationFailed("已达到课程运行时限，请核对学习记录后继续")
            except Exception:
                raise OperationFailed("当前课程执行失败，可能是登录失效或平台接口变化；请核对学习记录")

        def fuckZhidaoVideo(self, course_id, video_id):
            try:
                video = self.getZhidaoContext(course_id).videos[video_id]
            except upstream.CaptchaException:
                raise VerificationRequired()
            except Exception:
                raise OperationFailed("视频信息读取失败，请刷新课程后重试")
            return self.guarded(super().fuckZhidaoVideo, video.name or "正在处理视频", course_id, video_id)

        def fuckHikeVideo(self, course_id, file_id, prev_time=0):
            return self.guarded(super().fuckHikeVideo, "校内课视频", course_id, file_id, prev_time)

        def fuckFile(self, course_id, file_id):
            return self.guarded(super().fuckFile, "校内课资料", course_id, file_id)

        def _traverse(self, course_id, node, depth=0):
            if not node.childList and node.dataType is None:
                title = str(node.name or "未命名条目")[:180]
                emit("notice", kind="skipped", message=f"《{self.course_name[:160]}》：已跳过「{title}」（不支持的条目，可能为练习/习题），未作答、未提交；请到智慧树核对。")
                return
            return super()._traverse(course_id, node, depth)

        def lessonPopoupExam(self, *args, **kwargs):
            if not self.auto_answer:
                raise OperationFailed("遇到视频弹题，自动作答已关闭；请到智慧树完成后重新连接")
            return super().lessonPopoupExam(*args, **kwargs)

        def answerZhidao(self, *args, **kwargs):
            if not self.auto_answer:
                raise OperationFailed("自动作答已关闭，请到智慧树手动作答")
            return super().answerZhidao(*args, **kwargs)

        def saveLessonPopupExamSaveAnswer(self, *args, **kwargs):
            if not self.auto_answer or not self.auto_submit:
                raise OperationFailed("遇到视频弹题，自动提交已关闭；未提交答案，请到智慧树处理后重新连接")
            return super().saveLessonPopupExamSaveAnswer(*args, **kwargs)

        def fuckAiCourse(self, *args, **kwargs):
            raise OperationFailed("网页版未开放 AI 测验和自动交卷")

        def _qrlogin(self, qr_callback):
            # Bounded login; upstream recursively renews QR codes indefinitely.
            self._sessionReady()
            data = self.session.get("https://passport.zhihuishu.com/qrCodeLogin/getLoginQrImg", timeout=10).json()
            image = base64.b64decode(data["img"], validate=True)
            if len(image) > 250_000 or not image.startswith(b"\x89PNG\r\n\x1a\n"):
                raise OperationFailed("二维码格式异常，请稍后重新连接")
            qr_callback(image)
            deadline = time.monotonic() + 150
            while time.monotonic() < deadline:
                time.sleep(1)
                reply = self.session.get("https://passport.zhihuishu.com/qrCodeLogin/getLoginQrInfo", params={"qrToken": data["qrToken"]}, timeout=10).json()
                status = reply.get("status")
                if status == 1:
                    self.session.get("https://passport.zhihuishu.com/login", params={"service": "https://onlineservice-api.zhihuishu.com/login/gologin", "pwd": reply["oncePassword"]}, timeout=10)
                    self.cookies = self.session.cookies.copy()
                    if not self.cookies:
                        raise OperationFailed("登录未成功，请重新扫码")
                    return
                if status in (2, 3):
                    raise OperationFailed("二维码已过期或登录已取消，请重新连接")
                if status not in (-1, 0):
                    raise OperationFailed("登录返回异常，请稍后再试")
            raise OperationFailed("二维码已过期，请重新连接")

    engine = WebEngine(speed=1.0, end_thre=1.0, tree_view=False, progressbar_view=False)
    # Disallow accidental proxy and credential inheritance from the host process.
    engine.session.trust_env = False
    engine.proxies = {}

    def progress(iteration, total, *args, **kwargs):
        now = time.monotonic()
        if now - engine.last_progress_at < 2 and iteration < total:
            return
        engine.last_progress_at = now
        # Pause countdowns must not replace the video's actual percentage.
        prefix = str(kwargs.get("prefix", ""))
        if "pause" in prefix:
            engine.activity(f"脚本暂时暂停，约 {max(0, round(total - iteration))} 秒后继续")
            return
        engine.activity("正在处理视频弹题" if "answering" in prefix else "视频进度推进中")
        percent = max(0, min(100, round(100 * iteration / total, 1))) if total else None
        emit("progress", courseKey=engine.course_key, title=engine.title or "正在处理课程", percent=percent)

    upstream.progressBar = progress
    available = {}

    def load_courses():
        courses, warnings = [], []
        for kind, method, field, label in [
            ("shared", engine.getZhidaoList, "secret", "共享课"),
            ("hike", engine.getHikeList, "courseId", "校内课"),
        ]:
            try:
                for item in method():
                    identity = str(item.get(field) or "")
                    if identity:
                        courses.append({"key": kind + ":" + identity, "id": identity, "kind": kind, "name": str(item.get("courseName") or "未命名课程")[:300]})
            except Exception:
                warnings.append(label + "读取失败；请稍后刷新，或到智慧树确认课程类型")
        if len(warnings) == 2:
            raise OperationFailed("课程读取失败，请检查登录状态或平台接口兼容性")
        available.clear()
        available.update({c["key"]: c for c in courses[:500]})
        emit("courses", courses=list(available.values()), warnings=warnings)

    emit("ready")
    logged_in = False
    for line in sys.stdin:
        try:
            command = json.loads(line)
            action = command.get("action")
            if action == "login" and not logged_in:
                engine.login(use_qr=True, interactive=False, qr_callback=lambda image: emit("qr", image="data:image/png;base64," + base64.b64encode(image).decode()))
                logged_in = True
                load_courses()
            elif action == "courses" and logged_in:
                engine.courses.clear()
                load_courses()
            elif action == "run" and logged_in:
                speed = command.get("speed", 1.0)
                if type(speed) not in (int, float) or speed not in (0.5, 0.75, 1, 1.25, 1.5, 1.75, 2):
                    raise OperationFailed("播放倍速无效，请重新选择")
                engine.speed = speed
                engine.auto_answer = command.get("autoAnswer") is True
                engine.auto_submit = engine.auto_answer and command.get("autoSubmit") is True
                selected = command.get("courses", [])
                if not 1 <= len(selected) <= 20 or any(c.get("key") not in available for c in selected):
                    raise OperationFailed("课程选择已失效，请刷新后重试")
                # Use trusted server-side catalogue values, not supplied IDs or kinds.
                engine.context.clear()
                for index, candidate in enumerate(selected):
                    logger_module.logger.failed = False
                    course = available[candidate["key"]]
                    engine.course_key = course["key"]
                    engine.course_name = course["name"]
                    engine.title = course["name"]
                    emit("progress", courseKey=engine.course_key, title=engine.title, percent=None)
                    if course["kind"] == "shared":
                        emit("notice", kind="uninspected", message=f"《{engine.course_name[:160]}》：独立课后习题、章节练习未检查、未处理（当前仅遍历视频）；请到智慧树核对。")
                        engine.fuckZhidaoCourse(course["id"])
                    else:
                        engine.fuckHikeCourse(course["id"])
                    if logger_module.logger.failed:
                        raise OperationFailed("课程处理中有步骤失败，请到智慧树核对学习记录后重试")
                    emit("courseDone", completed=index + 1)
                emit("done")
            else:
                raise OperationFailed("会话操作无效，请重新连接")
        except (VerificationRequired, upstream.CaptchaException):
            emit("error", code="CAPTCHA_REQUIRED", message="智慧树要求验证码，本次任务已停止；请登录智慧树网页版，进入当前课程的视频观看界面完成验证，再返回助手重新扫码并开始运行。",
                 courseName=engine.course_name[:300], videoTitle=engine.title[:300] if engine.title != engine.course_name else "")
            return
        except OperationFailed as error:
            emit("error", message=str(error))
            return
        except Exception:
            emit("error", message="智慧树请求失败，请重新连接；若持续失败，需检查上游接口兼容性")
            return


if __name__ == "__main__":
    if sys.argv[1:] == ["--check-stdio"]:
        # Offline packaging diagnostic through the same input/output protocol.
        probe = json.loads(sys.stdin.readline())
        if not isinstance(probe.get("text"), str) or len(probe["text"]) > 500:
            raise ValueError("Invalid stdio probe")
        emit("stdio-check", text=probe["text"])
    else:
        main()
