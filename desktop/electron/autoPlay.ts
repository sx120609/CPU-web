/**
 * 视频自动播放内核
 *
 * 策略：主进程每 5 秒向学习通窗口注入一段幂等脚本
 *   - 找到 <video> 元素，确保播放 + 静音 + 倍速
 *   - 绑定 ended 事件 → 点击"下一节"
 *   - 页面内 setInterval 防暂停 + 关闭防挂机弹窗
 *   - 用 window.__coursebot_armed 标记避免重复绑定
 *
 * 页面切章节会重新加载，window 标记丢失 → 下次轮询自动重新武装
 *
 * 倍速说明：学习通对倍速有检测，MVP 先用 1.0 倍速确保安全跑通，
 * 后续可配合反检测层逐步提升。跳进度(currentTime hack)激进出招暂不用。
 */
import type { BrowserWindow } from "electron";

const INJECT_SCRIPT = `
(function () {
  if (window.__coursebot_armed) return { ok: true, message: "running", currentTime: (document.querySelector("video")||{}).currentTime||0 };
  var v = document.querySelector("video");
  if (!v) return { ok: false, message: "no-video" };
  window.__coursebot_armed = true;
  v.muted = true;
  v.playbackRate = 1.0;
  v.play().catch(function(){});
  v.addEventListener("ended", function () {
    window.__coursebot_armed = false;
    var next = document.querySelector(".nextBtn, .next, .jbjb") 
      || Array.prototype.find.call(document.querySelectorAll("a,button,div,span"), function(e){ return /下一节|下一章|next/i.test(e.textContent||""); });
    if (next) next.click();
  });
  if (!window.__coursebot_keep) {
    window.__coursebot_keep = setInterval(function () {
      var vv = document.querySelector("video");
      if (!vv) return;
      if (vv.paused && !vv.ended) vv.play().catch(function(){});
      // 关闭防挂机 / 答题弹窗
      document.querySelectorAll(".vjs-modal-dialog, .el-dialog, .popboxes_box").forEach(function (box) {
        var btn = box.querySelector("button") || Array.prototype.find.call(box.querySelectorAll("*"), function(e){ return /关闭|确认|继续|确定/i.test(e.textContent||""); });
        if (btn) btn.click();
      });
    }, 2000);
  }
  return { ok: true, message: "armed", currentTime: v.currentTime, duration: v.duration };
})();
`;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export interface ProgressEvent {
  type: "start" | "tick" | "error" | "stopped";
  message: string;
  data?: unknown;
}

/** 启动自动播放：轮询注入 + 平台心跳（校验登录态） */
export function startAutoPlay(
  chaoxingWin: BrowserWindow,
  onProgress: (e: ProgressEvent) => void,
  onHeartbeat?: () => Promise<void>
) {
  stopAutoPlay();
  onProgress({ type: "start", message: "已开始自动刷课，请保持学习通窗口在前台" });

  // 轮询注入脚本
  pollTimer = setInterval(async () => {
    if (!chaoxingWin || chaoxingWin.isDestroyed()) {
      onProgress({ type: "error", message: "学习通窗口已关闭，自动停止" });
      stopAutoPlay();
      return;
    }
    try {
      const result = await chaoxingWin.webContents.executeJavaScript(INJECT_SCRIPT, true);
      if (result && result.ok) {
        onProgress({
          type: "tick",
          message: result.message === "armed" ? "已接管视频播放" : "播放中",
          data: result,
        });
      } else if (result && !result.ok && result.message === "no-video") {
        onProgress({ type: "tick", message: "当前页面未检测到视频，等待跳转…" });
      }
    } catch (err) {
      onProgress({ type: "error", message: `注入失败：${String(err)}` });
    }
  }, 5000);

  // 平台心跳：校验登录态，失效则停止
  if (onHeartbeat) {
    heartbeatTimer = setInterval(async () => {
      try {
        await onHeartbeat();
      } catch {
        onProgress({ type: "error", message: "平台登录态失效，自动停止" });
        stopAutoPlay();
      }
    }, 75_000);
  }
}

export function stopAutoPlay() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
