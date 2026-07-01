/**
 * 课程级自动遍历引擎 v4
 *
 * 支持两种模式：
 *   手动模式：用户在 BrowserWindow 中打开章节页 → 点击开始
 *   自动模式（小工具）：引擎自动导航到课程页面 → 发现章节 → 处理
 */
import type { BrowserWindow } from "electron";

// ──────────── 进度事件 ────────────

export interface CourseProgressEvent {
  type: "start" | "chapter" | "task" | "tick" | "done" | "error" | "stopped";
  message: string;
  chapter?: string;
  task?: string;
  progress?: number;
  total?: number;
  current?: number;
  data?: unknown;
}

// ──────────── 注入脚本 ────────────

/** 在课程列表页面找到指定课程并点击 */
function makeFindCourseScript(courseId: string, clazzId: string): string {
  return `
(function() {
  var links = document.querySelectorAll('a[href]');
  for (var i = 0; i < links.length; i++) {
    var href = links[i].href || '';
    if (href.indexOf('courseid=' + ${JSON.stringify(courseId)}) > -1 ||
        href.indexOf('courseId=' + ${JSON.stringify(courseId)}) > -1 ||
        (href.indexOf(${JSON.stringify(courseId)}) > -1 && href.indexOf(${JSON.stringify(clazzId)}) > -1)) {
      links[i].click();
      return { ok: true, method: 'link-click', href: href };
    }
  }
  var cards = document.querySelectorAll('[onclick]');
  for (var i = 0; i < cards.length; i++) {
    var onclick = cards[i].getAttribute('onclick') || '';
    if (onclick.indexOf(${JSON.stringify(courseId)}) > -1) {
      cards[i].click();
      return { ok: true, method: 'card-click' };
    }
  }
  try {
    var iframes = document.querySelectorAll('iframe');
    for (var f = 0; f < iframes.length; f++) {
      try {
        var doc = iframes[f].contentDocument;
        if (!doc) continue;
        var ilinks = doc.querySelectorAll('a[href]');
        for (var i = 0; i < ilinks.length; i++) {
          var href = ilinks[i].href || '';
          if (href.indexOf(${JSON.stringify(courseId)}) > -1) {
            ilinks[i].click();
            return { ok: true, method: 'iframe-click', href: href };
          }
        }
      } catch(e) {}
    }
  } catch(e) {}
  return { ok: false, linksCount: links.length };
})();
`;
}

/** 从课程学习页面 DOM 提取所有章节 */
const DISCOVER_CHAPTERS = `
(function() {
  try {
    if (typeof mArrange !== 'undefined' && Array.isArray(mArrange) && mArrange.length > 0) {
      return { ok: true, source: 'mArrange', chapters: mArrange.map(function(item) {
        return { id: String(item.id || ''), name: item.name || '', status: item.status };
      })};
    }
  } catch(e) {}
  try {
    var scripts = document.querySelectorAll('script');
    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent || '';
      var match = text.match(/mArrange\\s*=\\s*(\\[[\\s\\S]*?\\])\\s*;/);
      if (match) {
        var arr = JSON.parse(match[1]);
        if (arr.length > 0) {
          return { ok: true, source: 'script', chapters: arr.map(function(item) {
            return { id: String(item.id || ''), name: item.name || '', status: item.status };
          })};
        }
      }
    }
  } catch(e) {}
  var selectors = ['.prev_ul .prev_list', '.chapter_unit', '.posCatalog_level', '.catalogFirst_level'];
  for (var s = 0; s < selectors.length; s++) {
    var nodes = document.querySelectorAll(selectors[s]);
    if (nodes.length > 0) {
      var chapters = [];
      nodes.forEach(function(el, idx) {
        var nameEl = el.querySelector('.chapter_item, .posCatalog_name, .catalog_name, .chaptertitle, span, a');
        var name = (nameEl || el).textContent.trim().replace(/\\s+/g, ' ').substring(0, 100);
        var id = el.getAttribute('id') || el.getAttribute('data-id') || String(idx);
        if (name.length > 0) chapters.push({ id: id, name: name, status: -1 });
      });
      if (chapters.length > 0) return { ok: true, source: selectors[s], chapters: chapters };
    }
  }
  return { ok: false, url: location.href, title: document.title, source: 'none', chapters: [] };
})();
`;

/** 点击侧边栏第 N 个章节 */
function makeClickChapterScript(index: number): string {
  return `
(function() {
  try {
    if (typeof mArrange !== 'undefined' && mArrange[${index}] && typeof getmark === 'function') {
      getmark(mArrange[${index}].id);
      return { ok: true, method: 'getmark' };
    }
  } catch(e) {}
  var selectors = ['.prev_ul .prev_list', '.chapter_unit', '.posCatalog_level', '.catalogFirst_level'];
  for (var s = 0; s < selectors.length; s++) {
    var nodes = document.querySelectorAll(selectors[s]);
    if (nodes.length > ${index}) {
      var el = nodes[${index}];
      var link = el.querySelector('a') || el;
      link.click();
      return { ok: true, method: 'dom-click' };
    }
  }
  return { ok: false };
})();
`;
}

/** 视频自动播放 */
const VIDEO_INJECT = `
(function() {
  function findVideo(doc) {
    var v = doc.querySelector('video');
    if (v) return v;
    try {
      var iframes = doc.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try {
          var iv = iframes[i].contentDocument && iframes[i].contentDocument.querySelector('video');
          if (iv) return iv;
        } catch(e) {}
      }
    } catch(e) {}
    return null;
  }
  var v = findVideo(document);
  if (!v) return { ok: false, status: 'no-video' };
  if (v.ended) return { ok: true, status: 'ended', currentTime: v.duration, duration: v.duration };
  v.muted = true;
  v.playbackRate = 1.0;
  if (v.paused) v.play().catch(function(){});
  document.querySelectorAll('.vjs-modal-dialog, .el-dialog, .popboxes_box, .ans-attach-ct, [id*=popbox]').forEach(function(box) {
    var btn = box.querySelector('button, .closeBtn, [class*=close]')
      || Array.prototype.find.call(box.querySelectorAll('*'), function(e) {
        return /关闭|确认|继续|确定|close/i.test(e.textContent || '');
      });
    if (btn) btn.click();
  });
  return {
    ok: true,
    status: v.paused ? 'paused' : 'playing',
    currentTime: v.currentTime || 0,
    duration: v.duration || 0,
    progress: v.duration ? Math.floor((v.currentTime / v.duration) * 100) : 0,
  };
})();
`;

/** 文档/PPT 自动阅读 */
const DOC_INJECT = `
(function() {
  function scrollAll(doc) {
    var el = doc.querySelector('.reader_Cnt_Holder, .pdf-viewer, .ans-attach-ct, [class*=reader], [class*=document]');
    if (el) { el.scrollTop = el.scrollHeight; return true; }
    doc.documentElement.scrollTop = doc.documentElement.scrollHeight;
    return true;
  }
  scrollAll(document);
  try {
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      try { scrollAll(iframes[i].contentDocument); } catch(e) {}
    }
  } catch(e) {}
  document.querySelectorAll('.next_page, .nextPage, [class*=lastPage]').forEach(function(btn) { btn.click(); });
  var done = document.querySelector('.ans-job-finished, .finishTip, [class*=finish]');
  return { ok: true, status: done ? 'finished' : 'reading' };
})();
`;

// ──────────── 引擎状态 ────────────

let running = false;
let abortFlag = false;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const jitter = ms * 0.3 * (Math.random() * 2 - 1);
    setTimeout(resolve, Math.max(500, ms + jitter));
  });
}

function waitForLoad(win: BrowserWindow, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    win.webContents.once("did-finish-load", () => {
      clearTimeout(timer);
      setTimeout(resolve, 3000);
    });
  });
}

function waitForNavigation(win: BrowserWindow, timeoutMs = 15_000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    win.webContents.once("did-navigate", () => { clearTimeout(timer); resolve(true); });
    win.webContents.once("did-navigate-in-page", () => { clearTimeout(timer); resolve(true); });
  });
}

// ──────────── 自动导航 ────────────

async function autoNavigateToCourse(
  win: BrowserWindow,
  courseId: string,
  clazzId: string,
  cpi: string,
  onProgress: (e: CourseProgressEvent) => void,
): Promise<boolean> {
  // 尝试多种课程页面 URL
  const courseUrls = [
    `https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=${courseId}&clazzid=${clazzId}&cpi=${cpi}&ut=s`,
    `https://mooc1.chaoxing.com/mycourse/studentcourse?courseid=${courseId}&clazzid=${clazzId}&cpi=${cpi}`,
  ];

  for (const url of courseUrls) {
    if (abortFlag) return false;
    onProgress({ type: "start", message: "正在尝试进入课程页面..." });
    console.log("[engine-auto] trying:", url);

    win.loadURL(url);
    await waitForLoad(win);
    await delay(2000);

    const pageCheck = await win.webContents.executeJavaScript(`
      (function() {
        var title = document.title || '';
        var bodyText = (document.body.innerText || '').substring(0, 500);
        var hasError = /enc校验|不存在|404|错误|error/i.test(bodyText);
        var isLogin = /登录/.test(title) && !/学习/.test(title);
        var hasChapter = !!(
          typeof mArrange !== 'undefined' ||
          document.querySelector('.prev_ul, .chapter_unit, .posCatalog_level, .catalogFirst_level, [class*=chapter]')
        );
        return { title: title, hasError: hasError, isLogin: isLogin, hasChapter: hasChapter, url: location.href };
      })();
    `, true).catch(() => ({ hasError: true, hasChapter: false }));

    console.log("[engine-auto] page check:", JSON.stringify(pageCheck));

    if (pageCheck.hasChapter && !pageCheck.hasError) return true;

    // 页面没报错但也没章节，多等一会再检查
    if (!pageCheck.hasError && !pageCheck.isLogin) {
      await delay(3000);
      const recheck = await win.webContents.executeJavaScript(`
        !!(typeof mArrange !== 'undefined' ||
           document.querySelector('.prev_ul, .chapter_unit, .posCatalog_level, [class*=chapter]'))
      `, true).catch(() => false);
      if (recheck) return true;
    }
  }

  // URL 直接进入都失败，尝试从课程列表点击
  if (!abortFlag) {
    onProgress({ type: "start", message: "正在从课程列表查找..." });

    const listUrls = [
      "https://mooc2-ans.chaoxing.com/visit/interaction",
      "https://i.chaoxing.com/base",
    ];

    for (const listUrl of listUrls) {
      if (abortFlag) return false;
      win.loadURL(listUrl);
      await waitForLoad(win);
      await delay(3000);

      try {
        const r = await win.webContents.executeJavaScript(makeFindCourseScript(courseId, clazzId), true);
        console.log("[engine-auto] find course:", JSON.stringify(r));
        if (r?.ok) {
          const navigated = await waitForNavigation(win);
          if (navigated) {
            await waitForLoad(win);
            await delay(3000);
            return true;
          }
        }
      } catch (e) {
        console.error("[engine-auto] find course failed:", e);
      }
    }
  }

  return false;
}

// ──────────── 章节发现与处理（共享逻辑） ────────────

async function discoverAndProcess(
  win: BrowserWindow,
  onProgress: (e: CourseProgressEvent) => void,
): Promise<void> {
  onProgress({ type: "start", message: "正在发现章节..." });
  let result: any = null;

  for (let retry = 0; retry < 3; retry++) {
    try {
      result = await win.webContents.executeJavaScript(DISCOVER_CHAPTERS, true);
      console.log("[engine] discover attempt", retry, ":", result?.ok, "source:", result?.source, "count:", result?.chapters?.length);
      if (result?.ok && result.chapters.length > 0) break;
    } catch (e) {
      console.error("[engine] discover failed:", e);
    }
    await delay(3000);
  }

  const chapters = result?.chapters || [];

  if (chapters.length === 0) {
    const pageTitle = await win.webContents.executeJavaScript("document.title", true).catch(() => "");
    const pageUrl = win.webContents.getURL();
    onProgress({
      type: "error",
      message: `未发现章节。页面: ${pageTitle || pageUrl}。请确认当前页面左侧有章节列表。`,
    });
    return;
  }

  const total = chapters.length;
  onProgress({ type: "start", message: `发现 ${total} 个章节，开始刷课`, progress: 0, total });

  for (let i = 0; i < total; i++) {
    if (abortFlag) break;

    const ch = chapters[i];
    onProgress({
      type: "chapter",
      message: `[${i + 1}/${total}] ${ch.name}`,
      chapter: ch.name,
      progress: Math.floor((i / total) * 100),
      current: i + 1,
      total,
    });

    try {
      const clickResult = await win.webContents.executeJavaScript(makeClickChapterScript(i), true);
      console.log("[engine] click chapter", i, ":", JSON.stringify(clickResult));
    } catch (e) {
      console.error("[engine] click chapter failed:", e);
    }

    await delay(3000);
    if (abortFlag) break;

    await processPageTasks(win, ch.name, i, total, onProgress);

    onProgress({
      type: "chapter",
      message: `[${i + 1}/${total}] ${ch.name} ✓`,
      chapter: ch.name,
      progress: Math.floor(((i + 1) / total) * 100),
      current: i + 1,
      total,
    });

    if (!abortFlag && i < total - 1) await delay(5000);
  }
}

// ──────────── 主入口 ────────────

/** 手动模式：从当前页面开始 */
export async function startCourseEngine(
  win: BrowserWindow,
  onProgress: (e: CourseProgressEvent) => void,
  onHeartbeat?: () => Promise<void>
) {
  if (running) {
    onProgress({ type: "error", message: "已有任务在运行中" });
    return;
  }

  running = true;
  abortFlag = false;

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  if (onHeartbeat) {
    heartbeatTimer = setInterval(async () => {
      try { await onHeartbeat(); } catch {}
    }, 75_000);
  }

  try {
    await discoverAndProcess(win, onProgress);
  } catch (e: any) {
    onProgress({ type: "error", message: `引擎异常：${e.message}` });
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    running = false;
    if (abortFlag) {
      onProgress({ type: "stopped", message: "已手动停止" });
    } else {
      onProgress({ type: "done", message: "全部章节处理完成", progress: 100 });
    }
  }
}

/** 自动模式：自动导航到课程页面再开始 */
export async function startCourseEngineAuto(
  win: BrowserWindow,
  courseId: string,
  clazzId: string,
  cpi: string,
  onProgress: (e: CourseProgressEvent) => void,
  onHeartbeat?: () => Promise<void>
) {
  if (running) {
    onProgress({ type: "error", message: "已有任务在运行中" });
    return;
  }

  running = true;
  abortFlag = false;

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  if (onHeartbeat) {
    heartbeatTimer = setInterval(async () => {
      try { await onHeartbeat(); } catch {}
    }, 75_000);
  }

  try {
    const found = await autoNavigateToCourse(win, courseId, clazzId, cpi, onProgress);
    if (abortFlag) return;

    if (!found) {
      onProgress({
        type: "error",
        message: "自动进入课程失败，请使用手动模式（从课程列表点击刷课）。",
      });
      return;
    }

    await discoverAndProcess(win, onProgress);
  } catch (e: any) {
    onProgress({ type: "error", message: `引擎异常：${e.message}` });
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    running = false;
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
  chapterName: string,
  chapterIdx: number,
  totalChapters: number,
  onProgress: (e: CourseProgressEvent) => void
) {
  let videoAttempts = 0;
  const maxVideoWait = 600;

  while (!abortFlag && videoAttempts < maxVideoWait) {
    try {
      const result = await win.webContents.executeJavaScript(VIDEO_INJECT, true);

      if (!result?.ok && result?.status === "no-video") break;

      if (result?.status === "ended") {
        onProgress({ type: "task", message: "视频播放完成", task: chapterName, progress: 100 });
        await delay(3000);
        const check = await win.webContents.executeJavaScript(VIDEO_INJECT, true);
        if (!check?.ok || check?.status === "ended" || check?.status === "no-video") break;
        continue;
      }

      if (result?.status === "playing" || result?.status === "paused") {
        const overallProgress = Math.floor(((chapterIdx + (result.progress || 0) / 100) / totalChapters) * 100);
        onProgress({
          type: "tick",
          message: `视频 ${result.progress || 0}%`,
          task: chapterName,
          progress: overallProgress,
          current: chapterIdx + 1,
          total: totalChapters,
          data: result,
        });
      }

      videoAttempts++;
      await delay(5000);
    } catch {
      videoAttempts++;
      await delay(5000);
    }
  }

  if (!abortFlag) {
    try {
      const docResult = await win.webContents.executeJavaScript(DOC_INJECT, true);
      if (docResult?.ok) {
        onProgress({ type: "task", message: "文档处理完成", task: chapterName });
      }
    } catch {}
  }
}
