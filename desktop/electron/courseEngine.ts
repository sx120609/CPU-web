/**
 * 课程级自动遍历引擎
 *
 * 接收课程的章节列表，按顺序遍历每个章节：
 *   - 视频任务点 → 导航到学习页面 → 注入播放脚本 → 等播完
 *   - 文档/PPT → 导航到页面 → 注入滚动+标记已读
 *   - 其他类型 → 跳过
 *
 * 进度通过回调实时上报给渲染进程。
 */
import type { BrowserWindow } from "electron";
import { buildStudyUrl, type CxChapter, type CxTaskPoint } from "./chaoxing";

// ──────────── 进度事件 ────────────

export interface CourseProgressEvent {
  type: "start" | "chapter" | "task" | "tick" | "done" | "error" | "stopped";
  message: string;
  chapter?: string;
  task?: string;
  /** 0-100 */
  progress?: number;
  data?: unknown;
}

// ──────────── 注入脚本 ────────────

/** 视频自动播放脚本：找到 iframe 内的 video 并播放 */
const VIDEO_INJECT = `
(function () {
  // 学习通的视频通常在 iframe 里，先尝试主页面，再遍历 iframe
  function findVideo(doc) {
    var v = doc.querySelector("video");
    if (v) return v;
    try {
      var iframes = doc.querySelectorAll("iframe");
      for (var i = 0; i < iframes.length; i++) {
        try {
          var iv = iframes[i].contentDocument && iframes[i].contentDocument.querySelector("video");
          if (iv) return iv;
        } catch(e) {}
      }
    } catch(e) {}
    return null;
  }

  var v = findVideo(document);
  if (!v) return { ok: false, status: "no-video" };

  if (v.ended) return { ok: true, status: "ended", currentTime: v.duration, duration: v.duration };

  // 确保播放
  v.muted = true;
  v.playbackRate = 1.0;
  if (v.paused) v.play().catch(function(){});

  // 关闭弹窗（防挂机检测、答题弹窗等）
  document.querySelectorAll(".vjs-modal-dialog, .el-dialog, .popboxes_box, .ans-attach-ct, [id*=popbox]").forEach(function (box) {
    var btn = box.querySelector("button, .closeBtn, [class*=close]")
      || Array.prototype.find.call(box.querySelectorAll("*"), function(e) {
        return /关闭|确认|继续|确定|close/i.test(e.textContent||"");
      });
    if (btn) btn.click();
  });

  return {
    ok: true,
    status: v.paused ? "paused" : "playing",
    currentTime: v.currentTime || 0,
    duration: v.duration || 0,
    progress: v.duration ? Math.floor((v.currentTime / v.duration) * 100) : 0,
  };
})();
`;

/** 文档/PPT 自动阅读脚本 */
const DOC_INJECT = `
(function () {
  // 尝试在 iframe 中找到文档内容并滚动到底部
  function scrollAll(doc) {
    var scrollable = doc.querySelector(".reader_Cnt_Holder, .pdf-viewer, .ans-attach-ct, [class*=reader], [class*=document]");
    if (scrollable) {
      scrollable.scrollTop = scrollable.scrollHeight;
      return true;
    }
    // 通用滚动
    doc.documentElement.scrollTop = doc.documentElement.scrollHeight;
    return true;
  }

  scrollAll(document);

  // 遍历 iframe
  try {
    var iframes = document.querySelectorAll("iframe");
    for (var i = 0; i < iframes.length; i++) {
      try { scrollAll(iframes[i].contentDocument); } catch(e) {}
    }
  } catch(e) {}

  // 点击翻到最后一页（PDF阅读器的翻页按钮）
  var pageButtons = document.querySelectorAll(".next_page, .nextPage, [class*=lastPage], [class*=last-page]");
  pageButtons.forEach(function(btn) { btn.click(); });

  // 检测是否有"任务完成"标记
  var done = document.querySelector(".ans-job-finished, .finishTip, [class*=finish]");

  return { ok: true, status: done ? "finished" : "reading" };
})();
`;

// ──────────── 引擎状态 ────────────

let running = false;
let abortFlag = false;
let currentWin: BrowserWindow | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const base = ms;
    // 随机浮动 ±30%
    const jitter = base * 0.3 * (Math.random() * 2 - 1);
    setTimeout(resolve, Math.max(500, base + jitter));
  });
}

/** 等待页面加载完成 */
function waitForLoad(win: BrowserWindow, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(); // 超时也继续，不阻塞
    }, timeoutMs);

    const handler = () => {
      clearTimeout(timer);
      // 页面 DOMContentLoaded 后再等一会让 AJAX 加载
      setTimeout(resolve, 3000);
    };

    win.webContents.once("did-finish-load", handler);
  });
}

// ──────────── 主入口 ────────────

export async function startCourseEngine(
  win: BrowserWindow,
  courseId: string,
  clazzId: string,
  cpi: string,
  chapters: CxChapter[],
  onProgress: (e: CourseProgressEvent) => void,
  onHeartbeat?: () => Promise<void>
) {
  if (running) {
    onProgress({ type: "error", message: "已有任务在运行中" });
    return;
  }

  running = true;
  abortFlag = false;
  currentWin = win;

  // 扁平化所有叶子节点（含任务点的章节）
  const flatChapters = flattenChapters(chapters);
  const total = flatChapters.length;
  let completed = 0;

  onProgress({
    type: "start",
    message: `开始刷课，共 ${total} 个章节`,
    progress: 0,
  });

  // 心跳定时器
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  if (onHeartbeat) {
    heartbeatTimer = setInterval(async () => {
      try { await onHeartbeat(); } catch { /* 静默 */ }
    }, 75_000);
  }

  try {
    for (const ch of flatChapters) {
      if (abortFlag) break;

      onProgress({
        type: "chapter",
        message: `进入章节：${ch.name}`,
        chapter: ch.name,
        progress: Math.floor((completed / total) * 100),
      });

      if (ch.status === "finished") {
        onProgress({ type: "chapter", message: `章节已完成，跳过：${ch.name}`, chapter: ch.name });
        completed++;
        continue;
      }

      // 导航到章节学习页面
      const url = buildStudyUrl(courseId, clazzId, ch.id, cpi);
      win.loadURL(url);
      await waitForLoad(win);

      if (abortFlag) break;

      // 处理页面上的任务点
      await processPageTasks(win, ch, onProgress);

      completed++;
      onProgress({
        type: "chapter",
        message: `章节完成：${ch.name}`,
        chapter: ch.name,
        progress: Math.floor((completed / total) * 100),
      });

      // 章节间随机等待
      if (!abortFlag && completed < total) {
        await delay(5000);
      }
    }
  } catch (e: any) {
    onProgress({ type: "error", message: `引擎异常：${e.message}` });
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    running = false;
    currentWin = null;

    if (abortFlag) {
      onProgress({ type: "stopped", message: "已手动停止" });
    } else {
      onProgress({ type: "done", message: "全部章节处理完成", progress: 100 });
    }
  }
}

export function stopCourseEngine() {
  abortFlag = true;
  running = false;
}

export function isEngineRunning(): boolean {
  return running;
}

// ──────────── 页面任务处理 ────────────

async function processPageTasks(
  win: BrowserWindow,
  chapter: CxChapter,
  onProgress: (e: CourseProgressEvent) => void
) {
  // 先检测页面上有什么类型的任务
  // 学习通每个章节页面可能有多个任务点（多个视频、文档等）
  // 通过多轮注入处理

  let hasVideo = true;
  let videoAttempts = 0;
  const maxVideoWait = 600; // 最多等10分钟（每轮5秒）

  // 先尝试视频
  while (hasVideo && !abortFlag && videoAttempts < maxVideoWait) {
    try {
      const result = await win.webContents.executeJavaScript(VIDEO_INJECT, true);

      if (!result?.ok && result?.status === "no-video") {
        // 没有视频，尝试文档处理
        hasVideo = false;
        break;
      }

      if (result?.status === "ended") {
        onProgress({
          type: "task",
          message: `视频播放完成`,
          task: chapter.name,
          progress: 100,
        });
        // 视频结束后等一会，看是否有下一个任务点
        await delay(3000);
        // 检查是否还有视频（同一章节可能有多段）
        const check = await win.webContents.executeJavaScript(VIDEO_INJECT, true);
        if (!check?.ok || check?.status === "ended" || check?.status === "no-video") {
          hasVideo = false;
        }
        continue;
      }

      if (result?.status === "playing" || result?.status === "paused") {
        onProgress({
          type: "tick",
          message: `视频播放中 ${result.progress || 0}%`,
          task: chapter.name,
          progress: result.progress || 0,
          data: result,
        });
      }

      videoAttempts++;
      await delay(5000);
    } catch (e: any) {
      onProgress({ type: "error", message: `注入失败：${e.message}` });
      videoAttempts++;
      await delay(5000);
    }
  }

  // 然后处理文档
  if (!abortFlag) {
    try {
      const docResult = await win.webContents.executeJavaScript(DOC_INJECT, true);
      if (docResult?.ok) {
        onProgress({
          type: "task",
          message: `文档/PPT处理完成`,
          task: chapter.name,
        });
      }
    } catch {
      // 文档处理失败不阻塞
    }
  }
}

// ──────────── 工具函数 ────────────

function flattenChapters(chapters: CxChapter[]): CxChapter[] {
  const result: CxChapter[] = [];
  function walk(nodes: CxChapter[]) {
    for (const n of nodes) {
      if (n.children && n.children.length > 0) {
        walk(n.children);
      } else {
        // 叶子节点 = 实际的学习单元
        result.push(n);
      }
    }
  }
  walk(chapters);
  return result;
}
