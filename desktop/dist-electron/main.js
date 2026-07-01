"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// electron/main.ts
var import_electron3 = require("electron");
var import_path2 = require("path");

// electron/store.ts
var import_electron = require("electron");
var import_electron2 = require("electron");
var import_fs = require("fs");
var import_path = require("path");
var TOKEN_FILE = (0, import_path.join)(import_electron2.app.getPath("userData"), "coursebot-token.dat");
function saveToken(token) {
  if (!import_electron.safeStorage.isEncryptionAvailable()) {
    (0, import_fs.writeFileSync)(TOKEN_FILE, Buffer.from(token, "utf8").toString("base64"));
    return;
  }
  const buf = import_electron.safeStorage.encryptString(token);
  (0, import_fs.writeFileSync)(TOKEN_FILE, buf);
}
function loadToken() {
  if (!(0, import_fs.existsSync)(TOKEN_FILE)) return null;
  try {
    const buf = (0, import_fs.readFileSync)(TOKEN_FILE);
    if (!import_electron.safeStorage.isEncryptionAvailable()) {
      return Buffer.from(buf.toString("utf8"), "base64").toString("utf8");
    }
    return import_electron.safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}
function clearToken() {
  if ((0, import_fs.existsSync)(TOKEN_FILE)) (0, import_fs.unlinkSync)(TOKEN_FILE);
}
function dataFile(key) {
  return (0, import_path.join)(import_electron2.app.getPath("userData"), `coursebot-${key}.dat`);
}
function saveData(key, value) {
  const file = dataFile(key);
  if (!import_electron.safeStorage.isEncryptionAvailable()) {
    (0, import_fs.writeFileSync)(file, Buffer.from(value, "utf8").toString("base64"));
    return;
  }
  (0, import_fs.writeFileSync)(file, import_electron.safeStorage.encryptString(value));
}
function loadData(key) {
  const file = dataFile(key);
  if (!(0, import_fs.existsSync)(file)) return null;
  try {
    const buf = (0, import_fs.readFileSync)(file);
    if (!import_electron.safeStorage.isEncryptionAvailable()) {
      return Buffer.from(buf.toString("utf8"), "base64").toString("utf8");
    }
    return import_electron.safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}
function clearData(key) {
  const file = dataFile(key);
  if ((0, import_fs.existsSync)(file)) (0, import_fs.unlinkSync)(file);
}

// electron/api.ts
var import_axios = __toESM(require("axios"));
var API_BASE = process.env.CPU_API_BASE || "https://cpu.lizmt.cn";
var http = import_axios.default.create({ baseURL: `${API_BASE}/api`, timeout: 2e4 });
function setAuthToken(t) {
  http.defaults.headers.common.Authorization = t ? `Bearer ${t}` : void 0;
}
async function ssoBegin() {
  const { data } = await http.post("/auth/sso-begin");
  return data.data;
}
async function ssoLogin(args) {
  const { data } = await http.post("/auth/sso-login", args);
  return data.data;
}
async function getQuota() {
  const { data } = await http.get("/course-bot/quota");
  return data.data;
}
async function heartbeat() {
  const { data } = await http.post("/course-bot/heartbeat");
  return data.data;
}

// electron/chaoxing.ts
var import_axios2 = __toESM(require("axios"));
var cookieStr = "";
var currentUser = null;
function injectCookies(entries) {
  cookieStr = entries.map((e) => `${e.name}=${e.value}`).join("; ");
  const uid = entries.find((e) => e.name === "_uid")?.value || "";
  if (uid && uid !== "0") {
    currentUser = { uid, name: uid, phone: "" };
  }
}
function createHttp(baseURL) {
  const inst = import_axios2.default.create({
    baseURL,
    timeout: 3e4,
    maxRedirects: 5,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    }
  });
  inst.interceptors.request.use((cfg) => {
    if (cookieStr) cfg.headers.Cookie = cookieStr;
    return cfg;
  });
  inst.interceptors.response.use((res) => {
    const sc = res.headers["set-cookie"];
    if (sc) {
      const arr = Array.isArray(sc) ? sc : [sc];
      const existing = {};
      for (const pair of cookieStr.split("; ")) {
        const [k, ...v] = pair.split("=");
        if (k) existing[k.trim()] = v.join("=");
      }
      for (const h of arr) {
        const m = h.match(/^([^=]+)=([^;]*)/);
        if (m) existing[m[1].trim()] = m[2].trim();
      }
      cookieStr = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join("; ");
    }
    return res;
  });
  return inst;
}
var mooc1 = createHttp("https://mooc1.chaoxing.com");
var mooc1Api = createHttp("https://mooc1-api.chaoxing.com");
function chaoxingLogout() {
  cookieStr = "";
  currentUser = null;
}
function getCxUser() {
  return currentUser;
}
function isLoggedIn() {
  return !!cookieStr && cookieStr.includes("_uid=");
}
async function getCourses() {
  const courses = [];
  try {
    const { data } = await mooc1Api.get("/mycourse/backclazzdata", {
      params: { view: "json", rss: 1 }
    });
    if (data?.result === 1 && data.channelList) {
      for (const ch of data.channelList) {
        if (!ch.content?.course) continue;
        const c = ch.content.course;
        const cpi = ch.cpi || ch.content.cpi || "";
        courses.push({
          courseId: String(c.data[0]?.id || ""),
          clazzId: String(ch.content.id || ch.key || ""),
          cpi: String(cpi),
          name: c.data[0]?.name || "\u672A\u77E5\u8BFE\u7A0B",
          teacher: ch.content.teacherfactor || "",
          image: c.data[0]?.imageurl || "",
          progress: null
        });
      }
    }
  } catch {
  }
  return courses;
}
async function getChapters(courseId, clazzId, cpi) {
  try {
    const { data } = await mooc1.get("/gas/clazz", {
      params: {
        id: clazzId,
        courseId,
        fields: "id,bbsid,classscore,isstart,allowdownload,chatid,name,state,isfiled,visiblescore,begindate,coursesetting.fields(id,courseid,hiddencoursecover,closedali498498,hiddenwrongset),course.fields(id,name,infocontent,objectid,app,bulletformat,mappingcourseid,imageurl,teacherfactor,knowledge.fields(id,name,indexOrder,parentnodeid,status,layer,label,begintime,createtime,endtime,attachment.fields(id,type,objectId,extension).type(video)))"
      }
    });
    console.log("[chaoxing] /gas/clazz response keys:", data ? Object.keys(data) : "null");
    let knowledgeNodes = null;
    if (data?.data && Array.isArray(data.data)) {
      const first = data.data[0];
      if (first?.course?.data?.[0]?.knowledge) {
        knowledgeNodes = first.course.data[0].knowledge;
        console.log("[chaoxing] found knowledge at data.data[0].course.data[0].knowledge, count:", knowledgeNodes.length);
      } else if (first?.knowledge) {
        knowledgeNodes = first.knowledge;
        console.log("[chaoxing] found knowledge at data.data[0].knowledge, count:", knowledgeNodes.length);
      } else if (first?.id && first?.name) {
        const result = parseChapterTree(data.data);
        console.log("[chaoxing] data.data is chapter list, count:", result.length);
        if (result.length > 0) return result;
      }
    }
    if (knowledgeNodes && knowledgeNodes.length > 0) {
      return parseKnowledgeNodes(knowledgeNodes);
    }
  } catch (e) {
    console.error("[chaoxing] /gas/clazz failed:", String(e));
  }
  try {
    console.log("[chaoxing] trying studentstudy page fallback...");
    const chapters = await getChaptersFromStudyPage(courseId, clazzId, cpi);
    console.log("[chaoxing] studentstudy fallback got:", chapters.length, "chapters");
    if (chapters.length > 0) return chapters;
  } catch (e) {
    console.error("[chaoxing] studentstudy fallback failed:", String(e));
  }
  try {
    console.log("[chaoxing] trying studentstudyAjax fallback...");
    const { data } = await mooc1.get("/mycourse/studentstudyAjax", {
      params: { courseId, clazzid: clazzId, cpi, verificationcode: "" }
    });
    if (data?.data) {
      const chapters = parseFlatChapterList(data.data);
      console.log("[chaoxing] studentstudyAjax got:", chapters.length, "chapters");
      if (chapters.length > 0) return chapters;
    }
  } catch (e) {
    console.error("[chaoxing] studentstudyAjax failed:", String(e));
  }
  console.error("[chaoxing] all chapter fetch methods failed");
  return [];
}
function parseChapterTree(nodes) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((n) => ({
    id: String(n.id || ""),
    name: n.name || "\u672A\u77E5\u7AE0\u8282",
    layer: n.layer || 0,
    status: n.status === 2 ? "finished" : n.status === 0 ? "locked" : "unfinished",
    children: n.knowledge ? parseKnowledgeNodes(n.knowledge) : [],
    taskPoints: []
  }));
}
function parseKnowledgeNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((k) => {
    const points = [];
    if (k.attachment) {
      for (const att of Array.isArray(k.attachment) ? k.attachment : []) {
        points.push({
          id: String(att.id || ""),
          title: att.name || k.name || "",
          type: detectTaskType(att.type, att.extension),
          status: "unfinished",
          objectId: att.objectId
        });
      }
    }
    return {
      id: String(k.id || ""),
      name: k.name || "",
      layer: k.layer || 1,
      status: k.status === 2 ? "finished" : "unfinished",
      children: [],
      taskPoints: points
    };
  });
}
function detectTaskType(type, ext) {
  const t = String(type).toLowerCase();
  if (t === "video" || ext === "mp4" || ext === "flv") return "video";
  if (t === "document" || ext === "pdf" || ext === "doc" || ext === "docx") return "document";
  if (t === "ppt" || ext === "ppt" || ext === "pptx") return "ppt";
  if (t === "workorexam" || t === "work") return "quiz";
  return "other";
}
async function getChaptersFromStudyPage(courseId, clazzId, cpi) {
  const { data: html } = await mooc1.get("/mycourse/studentstudy", {
    params: { chapterId: "", courseId, clazzid: clazzId, cpi, mooc2: 1 },
    responseType: "text"
  });
  const match = html.match(/try\s*\{\s*mArrange\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[1]);
    return arr.map((item) => ({
      id: String(item.id || ""),
      name: item.name || "",
      layer: item.layer || 0,
      status: item.status === 2 ? "finished" : "unfinished",
      children: [],
      taskPoints: []
    }));
  } catch {
    return [];
  }
}
function parseFlatChapterList(nodes) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((item) => ({
    id: String(item.id || item.chapterId || ""),
    name: item.name || item.title || "",
    layer: item.layer || 0,
    status: item.status === 2 ? "finished" : "unfinished",
    children: [],
    taskPoints: []
  }));
}

// electron/courseEngine.ts
function makeFindCourseScript(courseId, clazzId) {
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
var DISCOVER_CHAPTERS = `
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
function makeClickChapterScript(index) {
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
var VIDEO_INJECT = `
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
        return /\u5173\u95ED|\u786E\u8BA4|\u7EE7\u7EED|\u786E\u5B9A|close/i.test(e.textContent || '');
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
var DOC_INJECT = `
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
var running = false;
var abortFlag = false;
function delay(ms) {
  return new Promise((resolve) => {
    const jitter = ms * 0.3 * (Math.random() * 2 - 1);
    setTimeout(resolve, Math.max(500, ms + jitter));
  });
}
function waitForLoad(win, timeoutMs = 3e4) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    win.webContents.once("did-finish-load", () => {
      clearTimeout(timer);
      setTimeout(resolve, 3e3);
    });
  });
}
function waitForNavigation(win, timeoutMs = 15e3) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    win.webContents.once("did-navigate", () => {
      clearTimeout(timer);
      resolve(true);
    });
    win.webContents.once("did-navigate-in-page", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
async function autoNavigateToCourse(win, courseId, clazzId, cpi, onProgress) {
  const courseUrls = [
    `https://mooc2-ans.chaoxing.com/mycourse/stu?courseid=${courseId}&clazzid=${clazzId}&cpi=${cpi}&ut=s`,
    `https://mooc1.chaoxing.com/mycourse/studentcourse?courseid=${courseId}&clazzid=${clazzId}&cpi=${cpi}`
  ];
  for (const url of courseUrls) {
    if (abortFlag) return false;
    onProgress({ type: "start", message: "\u6B63\u5728\u5C1D\u8BD5\u8FDB\u5165\u8BFE\u7A0B\u9875\u9762..." });
    console.log("[engine-auto] trying:", url);
    win.loadURL(url);
    await waitForLoad(win);
    await delay(2e3);
    const pageCheck = await win.webContents.executeJavaScript(`
      (function() {
        var title = document.title || '';
        var bodyText = (document.body.innerText || '').substring(0, 500);
        var hasError = /enc\u6821\u9A8C|\u4E0D\u5B58\u5728|404|\u9519\u8BEF|error/i.test(bodyText);
        var isLogin = /\u767B\u5F55/.test(title) && !/\u5B66\u4E60/.test(title);
        var hasChapter = !!(
          typeof mArrange !== 'undefined' ||
          document.querySelector('.prev_ul, .chapter_unit, .posCatalog_level, .catalogFirst_level, [class*=chapter]')
        );
        return { title: title, hasError: hasError, isLogin: isLogin, hasChapter: hasChapter, url: location.href };
      })();
    `, true).catch(() => ({ hasError: true, hasChapter: false }));
    console.log("[engine-auto] page check:", JSON.stringify(pageCheck));
    if (pageCheck.hasChapter && !pageCheck.hasError) return true;
    if (!pageCheck.hasError && !pageCheck.isLogin) {
      await delay(3e3);
      const recheck = await win.webContents.executeJavaScript(`
        !!(typeof mArrange !== 'undefined' ||
           document.querySelector('.prev_ul, .chapter_unit, .posCatalog_level, [class*=chapter]'))
      `, true).catch(() => false);
      if (recheck) return true;
    }
  }
  if (!abortFlag) {
    onProgress({ type: "start", message: "\u6B63\u5728\u4ECE\u8BFE\u7A0B\u5217\u8868\u67E5\u627E..." });
    const listUrls = [
      "https://mooc2-ans.chaoxing.com/visit/interaction",
      "https://i.chaoxing.com/base"
    ];
    for (const listUrl of listUrls) {
      if (abortFlag) return false;
      win.loadURL(listUrl);
      await waitForLoad(win);
      await delay(3e3);
      try {
        const r = await win.webContents.executeJavaScript(makeFindCourseScript(courseId, clazzId), true);
        console.log("[engine-auto] find course:", JSON.stringify(r));
        if (r?.ok) {
          const navigated = await waitForNavigation(win);
          if (navigated) {
            await waitForLoad(win);
            await delay(3e3);
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
async function discoverAndProcess(win, onProgress) {
  onProgress({ type: "start", message: "\u6B63\u5728\u53D1\u73B0\u7AE0\u8282..." });
  let result = null;
  for (let retry = 0; retry < 3; retry++) {
    try {
      result = await win.webContents.executeJavaScript(DISCOVER_CHAPTERS, true);
      console.log("[engine] discover attempt", retry, ":", result?.ok, "source:", result?.source, "count:", result?.chapters?.length);
      if (result?.ok && result.chapters.length > 0) break;
    } catch (e) {
      console.error("[engine] discover failed:", e);
    }
    await delay(3e3);
  }
  const chapters = result?.chapters || [];
  if (chapters.length === 0) {
    const pageTitle = await win.webContents.executeJavaScript("document.title", true).catch(() => "");
    const pageUrl = win.webContents.getURL();
    onProgress({
      type: "error",
      message: `\u672A\u53D1\u73B0\u7AE0\u8282\u3002\u9875\u9762: ${pageTitle || pageUrl}\u3002\u8BF7\u786E\u8BA4\u5F53\u524D\u9875\u9762\u5DE6\u4FA7\u6709\u7AE0\u8282\u5217\u8868\u3002`
    });
    return;
  }
  const total = chapters.length;
  onProgress({ type: "start", message: `\u53D1\u73B0 ${total} \u4E2A\u7AE0\u8282\uFF0C\u5F00\u59CB\u5237\u8BFE`, progress: 0, total });
  for (let i = 0; i < total; i++) {
    if (abortFlag) break;
    const ch = chapters[i];
    onProgress({
      type: "chapter",
      message: `[${i + 1}/${total}] ${ch.name}`,
      chapter: ch.name,
      progress: Math.floor(i / total * 100),
      current: i + 1,
      total
    });
    try {
      const clickResult = await win.webContents.executeJavaScript(makeClickChapterScript(i), true);
      console.log("[engine] click chapter", i, ":", JSON.stringify(clickResult));
    } catch (e) {
      console.error("[engine] click chapter failed:", e);
    }
    await delay(3e3);
    if (abortFlag) break;
    await processPageTasks(win, ch.name, i, total, onProgress);
    onProgress({
      type: "chapter",
      message: `[${i + 1}/${total}] ${ch.name} \u2713`,
      chapter: ch.name,
      progress: Math.floor((i + 1) / total * 100),
      current: i + 1,
      total
    });
    if (!abortFlag && i < total - 1) await delay(5e3);
  }
}
async function startCourseEngine(win, onProgress, onHeartbeat) {
  if (running) {
    onProgress({ type: "error", message: "\u5DF2\u6709\u4EFB\u52A1\u5728\u8FD0\u884C\u4E2D" });
    return;
  }
  running = true;
  abortFlag = false;
  let heartbeatTimer = null;
  if (onHeartbeat) {
    heartbeatTimer = setInterval(async () => {
      try {
        await onHeartbeat();
      } catch {
      }
    }, 75e3);
  }
  try {
    await discoverAndProcess(win, onProgress);
  } catch (e) {
    onProgress({ type: "error", message: `\u5F15\u64CE\u5F02\u5E38\uFF1A${e.message}` });
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    running = false;
    if (abortFlag) {
      onProgress({ type: "stopped", message: "\u5DF2\u624B\u52A8\u505C\u6B62" });
    } else {
      onProgress({ type: "done", message: "\u5168\u90E8\u7AE0\u8282\u5904\u7406\u5B8C\u6210", progress: 100 });
    }
  }
}
async function startCourseEngineAuto(win, courseId, clazzId, cpi, onProgress, onHeartbeat) {
  if (running) {
    onProgress({ type: "error", message: "\u5DF2\u6709\u4EFB\u52A1\u5728\u8FD0\u884C\u4E2D" });
    return;
  }
  running = true;
  abortFlag = false;
  let heartbeatTimer = null;
  if (onHeartbeat) {
    heartbeatTimer = setInterval(async () => {
      try {
        await onHeartbeat();
      } catch {
      }
    }, 75e3);
  }
  try {
    const found = await autoNavigateToCourse(win, courseId, clazzId, cpi, onProgress);
    if (abortFlag) return;
    if (!found) {
      onProgress({
        type: "error",
        message: "\u81EA\u52A8\u8FDB\u5165\u8BFE\u7A0B\u5931\u8D25\uFF0C\u8BF7\u4F7F\u7528\u624B\u52A8\u6A21\u5F0F\uFF08\u4ECE\u8BFE\u7A0B\u5217\u8868\u70B9\u51FB\u5237\u8BFE\uFF09\u3002"
      });
      return;
    }
    await discoverAndProcess(win, onProgress);
  } catch (e) {
    onProgress({ type: "error", message: `\u5F15\u64CE\u5F02\u5E38\uFF1A${e.message}` });
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    running = false;
    if (abortFlag) {
      onProgress({ type: "stopped", message: "\u5DF2\u624B\u52A8\u505C\u6B62" });
    } else {
      onProgress({ type: "done", message: "\u5168\u90E8\u7AE0\u8282\u5904\u7406\u5B8C\u6210", progress: 100 });
    }
  }
}
function stopCourseEngine() {
  abortFlag = true;
  running = false;
}
function isEngineRunning() {
  return running;
}
async function processPageTasks(win, chapterName, chapterIdx, totalChapters, onProgress) {
  let videoAttempts = 0;
  const maxVideoWait = 600;
  while (!abortFlag && videoAttempts < maxVideoWait) {
    try {
      const result = await win.webContents.executeJavaScript(VIDEO_INJECT, true);
      if (!result?.ok && result?.status === "no-video") break;
      if (result?.status === "ended") {
        onProgress({ type: "task", message: "\u89C6\u9891\u64AD\u653E\u5B8C\u6210", task: chapterName, progress: 100 });
        await delay(3e3);
        const check = await win.webContents.executeJavaScript(VIDEO_INJECT, true);
        if (!check?.ok || check?.status === "ended" || check?.status === "no-video") break;
        continue;
      }
      if (result?.status === "playing" || result?.status === "paused") {
        const overallProgress = Math.floor((chapterIdx + (result.progress || 0) / 100) / totalChapters * 100);
        onProgress({
          type: "tick",
          message: `\u89C6\u9891 ${result.progress || 0}%`,
          task: chapterName,
          progress: overallProgress,
          current: chapterIdx + 1,
          total: totalChapters,
          data: result
        });
      }
      videoAttempts++;
      await delay(5e3);
    } catch {
      videoAttempts++;
      await delay(5e3);
    }
  }
  if (!abortFlag) {
    try {
      const docResult = await win.webContents.executeJavaScript(DOC_INJECT, true);
      if (docResult?.ok) {
        onProgress({ type: "task", message: "\u6587\u6863\u5904\u7406\u5B8C\u6210", task: chapterName });
      }
    } catch {
    }
  }
}

// electron/main.ts
var mainWindow = null;
var chaoxingWindow = null;
var loginWindow = null;
var tray = null;
var cachedToken = null;
var isQuitting = false;
function isDev() {
  return process.env.NODE_ENV === "development";
}
function createMainWindow() {
  mainWindow = new import_electron3.BrowserWindow({
    width: 520,
    height: 780,
    minWidth: 420,
    minHeight: 600,
    title: "\u836F\u5927\u5237\u8BFE\u52A9\u624B",
    autoHideMenuBar: true,
    webPreferences: {
      preload: (0, import_path2.join)(__dirname, isDev() ? "preload.cjs" : "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (isDev()) {
    mainWindow.loadURL("http://localhost:5174");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile((0, import_path2.join)(__dirname, "../dist/index.html"));
  }
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    stopCourseEngine();
    if (chaoxingWindow && !chaoxingWindow.isDestroyed()) chaoxingWindow.close();
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
  });
}
var CX_PARTITION = "persist:chaoxing";
async function syncCookiesFromSession() {
  const ses = import_electron3.session.fromPartition(CX_PARTITION);
  const cookies = await ses.cookies.get({ domain: ".chaoxing.com" });
  if (cookies.length === 0) return false;
  const entries = cookies.map((c) => ({ name: c.name, value: c.value }));
  injectCookies(entries);
  const hasUid = cookies.some((c) => c.name === "_uid" && c.value && c.value !== "0");
  return hasUid;
}
async function ensureChaoxingWindow(show = false) {
  if (chaoxingWindow && !chaoxingWindow.isDestroyed()) {
    if (show) chaoxingWindow.show();
    return chaoxingWindow;
  }
  chaoxingWindow = new import_electron3.BrowserWindow({
    width: 1200,
    height: 800,
    show,
    title: "\u5B66\u4E60\u901A",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: CX_PARTITION
    }
  });
  chaoxingWindow.on("closed", () => {
    chaoxingWindow = null;
    stopCourseEngine();
    sendProgress({ type: "stopped", message: "\u5B66\u4E60\u901A\u7A97\u53E3\u5DF2\u5173\u95ED" });
  });
  return chaoxingWindow;
}
function sendProgress(e) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("coursebot:progress", e);
  }
}
import_electron3.app.whenReady().then(async () => {
  const t = loadToken();
  if (t) {
    cachedToken = t;
    setAuthToken(t);
  }
  createMainWindow();
  const iconPath = (0, import_path2.join)(__dirname, isDev() ? "../assets/tray-icon.png" : "../assets/tray-icon.png");
  let trayImage;
  try {
    trayImage = import_electron3.nativeImage.createFromPath(iconPath);
  } catch {
    trayImage = import_electron3.nativeImage.createEmpty();
  }
  tray = new import_electron3.Tray(trayImage.resize({ width: 16, height: 16 }));
  tray.setToolTip("\u836F\u5927\u5237\u8BFE\u52A9\u624B");
  tray.setContextMenu(
    import_electron3.Menu.buildFromTemplate([
      { label: "\u663E\u793A\u7A97\u53E3", click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      } },
      { type: "separator" },
      { label: "\u9000\u51FA", click: () => {
        isQuitting = true;
        import_electron3.app.quit();
      } }
    ])
  );
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
});
import_electron3.app.on("before-quit", () => {
  isQuitting = true;
});
import_electron3.app.on("window-all-closed", () => {
  stopCourseEngine();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  import_electron3.app.quit();
});
import_electron3.ipcMain.handle("coursebot:sso-begin", () => ssoBegin());
import_electron3.ipcMain.handle("coursebot:sso-login", async (_e, args) => {
  const r = await ssoLogin(args);
  if (r.ok && r.siteToken) {
    cachedToken = r.siteToken;
    setAuthToken(r.siteToken);
    saveToken(r.siteToken);
  }
  return r;
});
import_electron3.ipcMain.handle("coursebot:load-token", () => {
  if (cachedToken) return cachedToken;
  const t = loadToken();
  if (t) {
    cachedToken = t;
    setAuthToken(t);
  }
  return t;
});
import_electron3.ipcMain.handle("coursebot:clear-token", () => {
  cachedToken = null;
  setAuthToken(null);
  clearToken();
  stopCourseEngine();
});
import_electron3.ipcMain.handle("coursebot:get-quota", () => getQuota());
import_electron3.ipcMain.handle("coursebot:heartbeat", () => heartbeat());
import_electron3.ipcMain.handle("coursebot:save-credentials", (_e, args) => {
  saveData(args.key, JSON.stringify(args.data));
});
import_electron3.ipcMain.handle("coursebot:load-credentials", (_e, key) => {
  const raw = loadData(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
});
import_electron3.ipcMain.handle("coursebot:clear-credentials", (_e, key) => {
  clearData(key);
});
import_electron3.ipcMain.handle("coursebot:chaoxing-open-login", async () => {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }
  loginWindow = new import_electron3.BrowserWindow({
    width: 800,
    height: 700,
    title: "\u767B\u5F55\u5B66\u4E60\u901A",
    autoHideMenuBar: true,
    parent: mainWindow || void 0,
    modal: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: CX_PARTITION
    }
  });
  loginWindow.loadURL("https://passport2.chaoxing.com/login?fid=&newversion=true&refer=https://i.chaoxing.com");
  const ses = import_electron3.session.fromPartition(CX_PARTITION);
  const onCookieChanged = async (_event, cookie, _cause, removed) => {
    if (removed) return;
    if (cookie.name === "_uid" && cookie.value && cookie.value !== "0") {
      const ok = await syncCookiesFromSession();
      if (ok && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("coursebot:chaoxing-login-success", getCxUser());
      }
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
    }
  };
  ses.cookies.on("changed", onCookieChanged);
  loginWindow.on("closed", () => {
    ses.cookies.removeListener("changed", onCookieChanged);
    loginWindow = null;
  });
});
import_electron3.ipcMain.handle("coursebot:chaoxing-logout", async () => {
  chaoxingLogout();
  const ses = import_electron3.session.fromPartition(CX_PARTITION);
  await ses.clearStorageData({ storages: ["cookies"] });
});
import_electron3.ipcMain.handle("coursebot:chaoxing-status", async () => {
  if (!isLoggedIn()) {
    await syncCookiesFromSession();
  }
  return { loggedIn: isLoggedIn(), user: getCxUser() };
});
import_electron3.ipcMain.handle("coursebot:get-courses", () => getCourses());
import_electron3.ipcMain.handle("coursebot:get-chapters", async (_e, args) => {
  const httpChapters = await getChapters(args.courseId, args.clazzId, args.cpi);
  if (httpChapters.length > 0) return httpChapters;
  console.log("[main] HTTP chapters failed, trying BrowserWindow extraction...");
  const win = await ensureChaoxingWindow(false);
  const url = `https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=&courseId=${args.courseId}&clazzid=${args.clazzId}&cpi=${args.cpi}&mooc2=1`;
  win.loadURL(url);
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2e4);
    win.webContents.once("did-finish-load", () => {
      clearTimeout(timer);
      setTimeout(resolve, 3e3);
    });
  });
  try {
    const chapters = await win.webContents.executeJavaScript(`
      (function() {
        // \u65B9\u5F0F1: \u4ECE mArrange \u5168\u5C40\u53D8\u91CF\u63D0\u53D6
        if (typeof mArrange !== 'undefined' && Array.isArray(mArrange)) {
          return mArrange.map(function(item) {
            return {
              id: String(item.id || ''),
              name: item.name || item.label || '',
              layer: item.layer || 0,
              status: item.status === 2 ? 'finished' : 'unfinished',
              children: [],
              taskPoints: []
            };
          });
        }

        // \u65B9\u5F0F2: \u4ECE\u9875\u9762 DOM \u63D0\u53D6\u7AE0\u8282\u5217\u8868
        var nodes = document.querySelectorAll('.chapter_unit, .catalogFirst_level, .posCatalog_level, [class*=chapter], .prev_ul > li');
        if (nodes.length > 0) {
          var result = [];
          nodes.forEach(function(el, i) {
            var link = el.querySelector('a[href], a[onclick]');
            var title = el.querySelector('.chapter_item, .catalog_name, .posCatalog_name, span, a');
            var id = '';
            if (link) {
              var m = (link.getAttribute('href') || link.getAttribute('onclick') || '').match(/chapterId[=:]\\s*(\\d+)/i);
              if (m) id = m[1];
            }
            if (!id) id = el.getAttribute('data-id') || el.getAttribute('id') || String(i);
            result.push({
              id: id,
              name: (title ? title.textContent : el.textContent || '').trim().substring(0, 100),
              layer: 0,
              status: 'unfinished',
              children: [],
              taskPoints: []
            });
          });
          return result.filter(function(c) { return c.name.length > 0; });
        }

        // \u65B9\u5F0F3: \u4ECE script \u6807\u7B7E\u63D0\u53D6
        var scripts = document.querySelectorAll('script');
        for (var i = 0; i < scripts.length; i++) {
          var text = scripts[i].textContent || '';
          var match = text.match(/mArrange\\s*=\\s*(\\[[\\s\\S]*?\\])\\s*;/);
          if (match) {
            try {
              var arr = JSON.parse(match[1]);
              return arr.map(function(item) {
                return {
                  id: String(item.id || ''),
                  name: item.name || '',
                  layer: item.layer || 0,
                  status: item.status === 2 ? 'finished' : 'unfinished',
                  children: [],
                  taskPoints: []
                };
              });
            } catch(e) {}
          }
        }

        return [];
      })();
    `, true);
    console.log("[main] BrowserWindow extraction got:", chapters?.length || 0, "chapters");
    return chapters || [];
  } catch (e) {
    console.error("[main] BrowserWindow chapter extraction failed:", String(e));
    return [];
  }
});
import_electron3.ipcMain.handle("coursebot:open-course", async (_e, args) => {
  const win = await ensureChaoxingWindow(true);
  win.loadURL("https://mooc2-ans.chaoxing.com/visit/interaction");
  return { ok: true };
});
import_electron3.ipcMain.handle("coursebot:start-course", async () => {
  if (isEngineRunning()) return { ok: false, message: "\u5DF2\u6709\u4EFB\u52A1\u5728\u8FD0\u884C\u4E2D" };
  if (!chaoxingWindow || chaoxingWindow.isDestroyed()) {
    return { ok: false, message: "\u8BF7\u5148\u6253\u5F00\u8BFE\u7A0B\u7A97\u53E3" };
  }
  startCourseEngine(
    chaoxingWindow,
    sendProgress,
    async () => {
      if (cachedToken) await heartbeat();
    }
  );
  return { ok: true, message: "\u5DF2\u5F00\u59CB\u5237\u8BFE" };
});
import_electron3.ipcMain.handle("coursebot:stop-course", () => {
  stopCourseEngine();
  sendProgress({ type: "stopped", message: "\u5DF2\u624B\u52A8\u505C\u6B62" });
});
import_electron3.ipcMain.handle("coursebot:start-course-auto", async (_e, args) => {
  if (isEngineRunning()) return { ok: false, message: "\u5DF2\u6709\u4EFB\u52A1\u5728\u8FD0\u884C\u4E2D" };
  const win = await ensureChaoxingWindow(false);
  startCourseEngineAuto(
    win,
    args.courseId,
    args.clazzId,
    args.cpi,
    sendProgress,
    async () => {
      if (cachedToken) await heartbeat();
    }
  );
  return { ok: true, message: "\u5DF2\u5F00\u59CB\u81EA\u52A8\u5237\u8BFE" };
});
import_electron3.ipcMain.handle("coursebot:show-chaoxing-window", () => ensureChaoxingWindow(true));
