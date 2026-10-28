"""Local deterministic test double. Never makes network requests."""
import json
import sys
import time

def emit(**event):
    print(json.dumps(event), flush=True)

emit(type="ready")
for line in sys.stdin:
    cmd = json.loads(line)
    if cmd["action"] in ("login", "courses"):
        emit(type="qr", image="data:image/png;base64,aGVsbG8=")
        time.sleep(0.02)
        emit(type="courses", courses=[{"key": "shared:one", "id": "one", "kind": "shared", "name": "测试课程"}, {"key": "hike:two", "id": "two", "kind": "hike", "name": "持续运行课程"}], warnings=[])
    elif cmd["action"] == "run":
        if cmd.get("speed") == 1.25:
            emit(type="progress", courseKey=cmd["courses"][0]["key"], title="第一章 <视频>", percent=10)
            emit(type="error", code="CAPTCHA_REQUIRED", message="智慧树要求验证码，本次任务已停止", courseName="测试课程", videoTitle="第一章 <视频>")
            break
        if cmd.get("speed") == 0.75:
            emit(type="error", message="验证码接口网络失败，请稍后重试")
            break
        emit(type="notice", kind="skipped", message="已跳过测试练习，未作答、未提交")
        emit(type="activity", message="正在上报视频学习进度，等待智慧树响应")
        emit(type="progress", courseKey=cmd["courses"][0]["key"], title=f'speed={cmd.get("speed")};answer={cmd.get("autoAnswer")};submit={cmd.get("autoSubmit")}', percent=25)
        if cmd["courses"][0]["id"] == "two":
            for tick in range(60):
                time.sleep(1)
                emit(type="progress", courseKey=cmd["courses"][0]["key"], title="后台进度", percent=26 + tick)
        else:
            print("Cookie=DO_NOT_EXPOSE_THIS", file=sys.stderr, flush=True)
            emit(type="courseDone", completed=1)
            emit(type="done")
