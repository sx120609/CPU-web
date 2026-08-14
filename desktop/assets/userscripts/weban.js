// ==UserScript==
// @name         药大拾间·安全微伴助手
// @namespace    cpu-weban
// @version      1.0.4
// @author       CPU-web
// @description  自动完成安全微伴课程与考试，支持中国药科大学等高校
// @match        https://weiban.mycourse.cn/*
// @match        https://*.mycourse.cn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_cpuReport
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  // ─────────────────────────────────────────────
  // 0. 常量
  // ─────────────────────────────────────────────
  const BASE = 'https://weiban.mycourse.cn';
  const MERCURY = 'https://resource.mycourse.cn';
  const ANSWER_BANK_URL = 'https://gh-proxy.com/https://github.com/hangone/WeBan/raw/refs/heads/main/answer/answer.json';
  const MERCURY_SECRET = '75uet0kwvnc90xo';
  const MERCURY_APP_KEY = '00000001';
  // AES-ECB login key: base64url decode of "d2JzNTEyAAAAAAAAAAAAAA=="
  const LOGIN_KEY_B64 = 'd2JzNTEyAAAAAAAAAAAAAA==';
  // Jupiter AES-256-CBC key
  const JUPITER_KEY = 'KkGv9d8E5jYb2xHwL3ZqRpXoNt6MmSge';
  const STORE_PREFIX = 'cpu-weban:';

  // ─────────────────────────────────────────────
  // 1. 持久化存储
  // ─────────────────────────────────────────────
  const store = {
    get: (key, def = null) => { try { const v = GM_getValue(STORE_PREFIX + key); return v !== undefined ? v : def; } catch { return def; } },
    set: (key, val) => { try { GM_setValue(STORE_PREFIX + key, val); } catch {} },
  };

  // ─────────────────────────────────────────────
  // 2. 状态上报
  // ─────────────────────────────────────────────
  const report = (kind, text) => {
    try { if (typeof GM_cpuReport !== 'undefined') GM_cpuReport(kind, text); } catch {}
  };
  const status = (msg) => { report('status', msg); ui.setStatus(msg); };
  const log = (msg) => {
    report('log', msg);
    console.log('[WeBan]', msg);
    try { ui.addLog(msg); } catch {}
  };

  // ─────────────────────────────────────────────
  // 3. 工具函数
  // ─────────────────────────────────────────────
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const uuid4 = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });

  // base64url encode (no padding, url-safe)
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  // ─────────────────────────────────────────────
  // 4. 加密工具
  // ─────────────────────────────────────────────

  // PKCS7 pad to block multiple
  const pkcs7Pad = (data, blockSize = 16) => {
    const padLen = blockSize - (data.length % blockSize);
    const out = new Uint8Array(data.length + padLen);
    out.set(data);
    out.fill(padLen, data.length);
    return out;
  };

  // AES-ECB encrypt: emulate per-block via AES-CBC with zero IV
  const aesEcbEncrypt = async (keyBytes, plaintext) => {
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt']);
    const padded = pkcs7Pad(new TextEncoder().encode(plaintext));
    const zeroIV = new Uint8Array(16);
    const result = new Uint8Array(padded.length);
    for (let i = 0; i < padded.length; i += 16) {
      const block = padded.slice(i, i + 16);
      const enc = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: zeroIV }, key, block);
      result.set(new Uint8Array(enc).slice(0, 16), i);
    }
    return result;
  };

  // AES-256-CBC encrypt, returns double-base64 (CryptoJS quirk)
  const aes256CbcDoubleB64 = async (keyStr, payload) => {
    const keyBytes = new TextEncoder().encode(keyStr);
    const iv = keyBytes.slice(0, 16);
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt']);
    const padded = pkcs7Pad(new TextEncoder().encode(JSON.stringify(payload)));
    const enc = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, padded);
    const first = btoa(String.fromCharCode(...new Uint8Array(enc)));
    return btoa(first); // double base64
  };

  // SHA1 hex
  const sha1hex = async (str) => {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  };

  // Mercury sign
  const mercurySign = async (params) => {
    const sorted = Object.keys(params).sort().map(k => k + params[k]).join('');
    return sha1hex(MERCURY_SECRET + sorted + MERCURY_SECRET);
  };

  // ─────────────────────────────────────────────
  // 5. API 客户端
  // ─────────────────────────────────────────────
  let session = { userId: '', token: '', tenantCode: '' };

  // 标准 POST：自动注入 timestamp / tenantCode / userId / X-Token
  const post = async (path, body = {}) => {
    const ts = Date.now().toString();
    const payload = { tenantCode: session.tenantCode, userId: session.userId, ...body };
    const url = `${BASE}${path}?timestamp=${ts}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Token': session.token,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0',
      },
      body: new URLSearchParams(payload),
      credentials: 'include',
    });
    if (!resp.ok) { log(`HTTP ${resp.status} ${path}`); return {}; }
    try { return await resp.json(); } catch { return {}; }
  };

  // GET（用于 JSONP 完成请求等）
  const get = async (url, headers = {}) => {
    const resp = await fetch(url, { headers: { 'X-Token': session.token, ...headers }, credentials: 'include' });
    return resp.text();
  };

  // 跨域请求（GitHub answer bank）
  const xhrGet = (url) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET', url,
      onload: (r) => resolve(r.responseText),
      onerror: reject,
      timeout: 15000,
    });
  });

  // Mercury 路由
  const mercury = async (service, params) => {
    const ts = Date.now().toString();
    const base = { appKey: MERCURY_APP_KEY, format: 'json', v: '1.0', timestamp: ts, clientId: 'pharos', service, ...params };
    base.sign = await mercurySign(base);
    const resp = await fetch(`${MERCURY}/mercuryprovider/router`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Token': session.token },
      body: new URLSearchParams(base),
      credentials: 'include',
    });
    try { return await resp.json(); } catch { return {}; }
  };

  // Jupiter 导航追踪
  const jupiterNext = async (step, finished, uniqueNo, apinextNo, courseId, userCourseId, userProjectId) => {
    const payload = { step: String(step), finished: String(finished), uniqueNo, apinextNo, userCourseId, courseId, userProjectId };
    const data = await aes256CbcDoubleB64(JUPITER_KEY, payload);
    const ts = Date.now().toString();
    await fetch(`${BASE}/jupiterapi/api/statusercourse/v1/next?timestamp=${ts}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': session.token },
      body: JSON.stringify({ data }),
      credentials: 'include',
    });
  };

  // ─────────────────────────────────────────────
  // 6. 登录
  // ─────────────────────────────────────────────
  const getTenantCode = async (schoolName) => {
    const resp = await fetch(`${BASE}/pharos/login/getTenantListWithLetter.do`, { method: 'POST', credentials: 'include' });
    const data = await resp.json();
    const list = Array.isArray(data?.data) ? data.data : [];
    for (const group of list) {
      for (const item of (group?.list || [])) {
        if (item.name && item.name.includes(schoolName)) return item.tenantCode;
      }
    }
    return null;
  };

  const fetchCaptchaBitmap = async (captchaTs) => {
    const ts = captchaTs || Date.now().toString();
    const base64 = await new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('当前环境不支持验证码请求'));
        return;
      }
      GM_xmlhttpRequest({
        method: 'GET',
        url: `${BASE}/pharos/login/randLetterImage.do?time=${encodeURIComponent(ts)}&refresh=1`,
        responseType: 'arraybuffer',
        timeout: 15000,
        onload: (res) => {
          const text = String(res?.responseText || res?.response || '').trim();
          if (!text) {
            reject(new Error('验证码响应为空'));
            return;
          }
          resolve(text);
        },
        onerror: (res) => reject(new Error(res?.error || res?.statusText || '验证码加载失败')),
        ontimeout: () => reject(new Error('验证码加载超时')),
      });
    });
    const binary = atob(base64.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    if (typeof createImageBitmap !== 'function') throw new Error('当前环境不支持验证码渲染');
    return { bitmap: await createImageBitmap(blob), ts };
  };

  const doLogin = async (tenantCode, username, password, verifyCode, verifyTime) => {
    const keyBytes = Uint8Array.from(atob(LOGIN_KEY_B64), c => c.charCodeAt(0));
    const payload = JSON.stringify({ keyNumber: username, password, tenantCode, time: verifyTime, verifyCode });
    const encrypted = await aesEcbEncrypt(keyBytes, payload);
    const data = b64url(encrypted);
    const ts = Date.now().toString();
    const resp = await fetch(`${BASE}/pharos/login/login.do?timestamp=${ts}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data }),
      credentials: 'include',
    });
    return resp.json();
  };

  // ─────────────────────────────────────────────
  // 7. 题库
  // ─────────────────────────────────────────────
  let answerBank = {};

  const syncAnswerBank = async () => {
    try {
      const raw = await xhrGet(ANSWER_BANK_URL);
      answerBank = JSON.parse(raw);
      log(`题库加载完成，共 ${Object.keys(answerBank).length} 题`);
    } catch (e) {
      log('题库加载失败: ' + e.message);
    }
  };

  const cleanText = (t) => (t || '').replace(/[^\w一-龥]/g, '');

  const findAnswer = (question) => {
    const cleanQ = cleanText(question);
    for (const [k, v] of Object.entries(answerBank)) {
      if (cleanText(k) === cleanQ) return v;
    }
    return null;
  };

  const matchOptions = (examOptions, bankEntry) => {
    if (!bankEntry) return [];
    return examOptions
      .filter(opt => bankEntry.optionList?.some(b => b.isCorrect && cleanText(b.content) === cleanText(opt.content)))
      .map(opt => opt.id);
  };

  // ─────────────────────────────────────────────
  // 8. 模拟首页（降低风控触发率）
  // ─────────────────────────────────────────────
  const simulateHome = async () => {
    const paths = [
      '/pharos/ebook/getEbook.do',
      '/pharos/ebook/ebookRecordList.do',
      '/pharos/index/carouselList.do',
      '/pharos/user/myGetInfo.do',
      '/pharos/index/getProjectStat.do',
      '/pharos/notice/index.do',
      '/pharos/notice/list.do',
      '/pharos/index/listValve.do',
      '/pharos/index/getSimpleConfig.do',
      '/pharos/help/getHelp.do',
      '/pharos/index/listStudyTask.do',
    ];
    for (const p of paths) {
      await post(p);
      await sleep(rand(200, 500));
    }
  };

  // ─────────────────────────────────────────────
  // 9. 课程完成
  // ─────────────────────────────────────────────
  const finishCourse = async (userCourseId, courseId, userProjectId, finishType, token) => {
    if (finishType === 'open') {
      await post('/pharos/usercourse/finish.do', { userCourseId, courseId, userProjectId });
    } else if (finishType === 'lyra') {
      const ts = Date.now().toString();
      await fetch(`https://lyra.mycourse.cn/lyraapi/study/course/finish.api?timestamp=${ts}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Token': session.token },
        body: JSON.stringify({ userActivityId: userCourseId }),
        credentials: 'include',
      });
    } else {
      // weiban JSONP 方式
      const cb = `jQuery341${Date.now()}`;
      const ts = Date.now().toString();
      const url = `${BASE}/pharos/usercourse/v2/${token}.do?userCourseId=${userCourseId}&tenantCode=${session.tenantCode}&callback=${cb}&_=${ts}`;
      const text = await get(url, { Accept: '*/*', Referer: `https://mcwk.mycourse.cn/` });
      // JSONP 取括号内容
      try {
        const json = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
        return JSON.parse(json);
      } catch { return {}; }
    }
  };

  const studyCourse = async (userProjectId, courseId, userCourseId) => {
    // mark started
    await post('/pharos/usercourse/study.do', { courseId, userProjectId });
    const urlRes = await post('/pharos/usercourse/getCourseUrl.do', { courseId, userProjectId });
    const courseUrl = urlRes?.data;
    if (!courseUrl) { log(`课程 ${courseId} 无法获取URL`); return; }

    // 获取课程页面，检测是否需要 apicenext
    let needJupiter = false;
    let pageCount = 1;
    let finishToken = '';
    let finishType = 'weiban';
    try {
      const html = await get(courseUrl);
      needJupiter = html.includes('apicenext.js');
      const pageMatch = html.match(/pageCount\s*[=:]\s*(\d+)/);
      if (pageMatch) pageCount = parseInt(pageMatch[1], 10);
      const tokenMatch = html.match(/v2\/([a-zA-Z0-9]+)\.do/);
      if (tokenMatch) finishToken = tokenMatch[1];
      if (html.includes('open.mycourse.cn')) finishType = 'open';
      if (html.includes('lyra.mycourse.cn')) finishType = 'lyra';
    } catch (e) { log(`课程页面解析失败: ${e.message}`); }

    if (needJupiter) {
      const uniqueNo = uuid4();
      for (let step = 1; step <= pageCount; step++) {
        const apinextNo = uuid4();
        const finished = step === pageCount ? '1' : '2';
        await jupiterNext(step, finished, uniqueNo, apinextNo, courseId, userCourseId, userProjectId);
        await sleep(rand(1500, 3000));
      }
    } else {
      // 无 Jupiter，直接等待模拟学习时间
      await sleep(rand(3000, 6000));
    }

    await finishCourse(userCourseId, courseId, userProjectId, finishType, finishToken);
    await sleep(rand(500, 1000));
  };

  const runStudy = async (userProjectId) => {
    const catRes = await post('/pharos/project/listCategory.do', { userProjectId, chooseType: 1 });
    const categories = catRes?.data || [];
    for (const cat of categories) {
      const courseRes = await post('/pharos/project/listCourse.do', { userProjectId, categoryCode: cat.categoryCode, chooseType: 1 });
      const courses = courseRes?.data || [];
      const pending = courses.filter(c => c.isFinished !== 1 && c.isFinished !== '1');
      log(`分类「${cat.categoryName}」：${pending.length}/${courses.length} 待完成`);
      for (const course of pending) {
        status(`学习：${course.resourceName || course.courseId}`);
        await studyCourse(userProjectId, course.courseId, course.userCourseId);
        log(`✓ ${course.resourceName || course.courseId}`);
      }
    }
  };

  // ─────────────────────────────────────────────
  // 10. 考试
  // ─────────────────────────────────────────────
  const runExam = async (userProjectId) => {
    const planRes = await post('/pharos/exam/listPlan.do', { userProjectId });
    const plans = planRes?.data || [];
    for (const plan of plans) {
      if (plan.isFinished === 1 || plan.isFinished === '1') continue;
      status(`准备考试：${plan.examName || plan.userExamPlanId}`);
      await post('/pharos/exam/beforePaper.do', { userExamPlanId: plan.userExamPlanId });
      await post('/pharos/exam/preparePaper.do', { userExamPlanId: plan.userExamPlanId });

      // Tencent 验证码：页面里已有 SDK，等待它自动触发；如未触发则跳过检查直接答题
      await sleep(2000);

      const startRes = await post('/pharos/exam/startPaper.do', { userExamPlanId: plan.userExamPlanId });
      const questions = startRes?.data?.questionList || [];
      log(`考题 ${questions.length} 道`);

      for (const q of questions) {
        const bank = findAnswer(q.title);
        const ids = matchOptions(q.optionList || [], bank);
        const answerIds = ids.length ? ids.join(',') : (q.optionList?.[0]?.id || '');
        await post('/pharos/exam/recordQuestion.do', {
          questionId: q.id,
          answerIds,
          useTime: rand(8, 25),
          examPlanId: plan.userExamPlanId,
        });
        await sleep(rand(500, 1500));
      }

      const submitRes = await post('/pharos/exam/submitPaper.do', { userExamPlanId: plan.userExamPlanId });
      const score = submitRes?.data?.score ?? '?';
      log(`考试得分：${score}`);
      status(`考试完成，得分 ${score}`);
    }
  };

  // ─────────────────────────────────────────────
  // 11. 主流程
  // ─────────────────────────────────────────────
  const runAll = async () => {
    status('正在同步题库…');
    await syncAnswerBank();

    status('正在模拟首页…');
    await simulateHome();

    const projRes = await post('/pharos/project/listMyProject.do', { ended: 0 });
    const projects = projRes?.data || [];
    log(`共 ${projects.length} 个学习项目`);

    for (const proj of projects) {
      if (proj.studyState === 2) { log(`项目「${proj.projectName}」已完成，跳过`); continue; }
      log(`▶ 项目：${proj.projectName}`);
      await post('/pharos/usercourse/initIndex.do', { userProjectId: proj.userProjectId });
      await runStudy(proj.userProjectId);
      await runExam(proj.userProjectId);
    }

    status('✅ 全部任务完成！');
    log('所有项目已完成');
  };

  // ─────────────────────────────────────────────
  // 12. 浮动 UI 面板
  // ─────────────────────────────────────────────
  const ui = (() => {
    const panel = document.createElement('aside');
    const launcher = document.createElement('button');
    const style = document.createElement('style');
    const panelId = 'cpu-weban-panel';
    const launcherId = 'cpu-weban-launcher';
    panel.id = panelId;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '安全微伴助手');
    launcher.id = launcherId;
    launcher.type = 'button';
    launcher.textContent = '打开安全微伴';
    launcher.hidden = true;
    style.id = 'cpu-weban-workspace-style';
    style.textContent = `
      #${panelId}, #${panelId} *, #${launcherId}, #${launcherId} * { box-sizing: border-box; }
      #${panelId}[hidden], #${launcherId}[hidden] { display: none !important; }
      #${panelId} {
        --cpu-wb-primary: #4f74e6; --cpu-wb-primary-strong: #315fd0; --cpu-wb-primary-soft: #e6efff;
        --cpu-wb-surface: rgba(255, 255, 255, .98); --cpu-wb-card: #ffffff; --cpu-wb-subtle: #f5f8ff;
        --cpu-wb-answer: #eff5ff; --cpu-wb-text: #1e2940; --cpu-wb-muted: #6f7fa0; --cpu-wb-muted-strong: #42526e;
        --cpu-wb-border: #d8e1f2; --cpu-wb-border-soft: #e6edf8; --cpu-wb-danger: #c85a5a; --cpu-wb-warning: #a66a00;
        --cpu-wb-on-primary: #fff; --cpu-wb-shadow: 0 22px 60px rgba(77, 101, 157, .18);
        position: fixed; right: 22px; top: 78px; z-index: 2147482998;
        width: min(470px, calc(100vw - 32px)); max-height: calc(100vh - 116px);
        display: flex; flex-direction: column; overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--cpu-wb-primary) 18%, var(--cpu-wb-border)); border-radius: 20px;
        background: linear-gradient(180deg, rgba(255, 255, 255, .99), rgba(246, 249, 255, .99)); color: var(--cpu-wb-text); color-scheme: light;
        box-shadow: var(--cpu-wb-shadow);
        font: 14px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${panelId} button, #${panelId} input { font: inherit; }
      #${panelId} button { cursor: pointer; }
      #${panelId} .cpu-wb-header {
        display: flex; align-items: center; gap: 10px; padding: 14px 16px;
        border-bottom: 1px solid var(--cpu-wb-border); cursor: move; touch-action: none; user-select: none;
        background: linear-gradient(180deg, #edf4ff, #e4edff);
      }
      #${panelId} .cpu-wb-mark {
        display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 auto; border-radius: 13px;
        background: linear-gradient(180deg, #6c8af0, #466ad7); color: #fff; font-size: 18px; font-weight: 800;
      }
      #${panelId} .cpu-wb-heading { min-width: 0; flex: 1; }
      #${panelId} .cpu-wb-heading strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; }
      #${panelId} .cpu-wb-heading span { display: block; color: #6b7fa8; font-size: 12px; }
      #${panelId} .cpu-wb-header-actions { display: flex; align-items: center; gap: 8px; }
      #${panelId} .cpu-wb-icon {
        display: grid; place-items: center; width: 38px; height: 38px; padding: 0;
        border: 1px solid var(--cpu-wb-border); border-radius: 11px; background: #fff;
        color: var(--cpu-wb-muted-strong); transition: background .16s ease, border-color .16s ease, color .16s ease;
      }
      #${panelId} .cpu-wb-icon:hover { border-color: color-mix(in srgb, var(--cpu-wb-primary) 55%, var(--cpu-wb-border)); background: var(--cpu-wb-subtle); }
      #${panelId} .cpu-wb-body { min-height: 0; overflow: auto; padding: 14px 16px; display: grid; gap: 10px; }
      #${panelId} .cpu-wb-card { padding: 14px; border: 1px solid var(--cpu-wb-border-soft); border-radius: 14px; background: var(--cpu-wb-card); }
      #${panelId} .cpu-wb-kicker { color: var(--cpu-wb-primary); font-size: 12px; font-weight: 800; letter-spacing: 0; }
      #${panelId} .cpu-wb-title { margin: 4px 0 4px; font-size: 17px; line-height: 1.35; word-break: break-word; }
      #${panelId} .cpu-wb-muted { color: var(--cpu-wb-muted); }
      #${panelId} .cpu-wb-lead { margin: 10px 0 0; color: var(--cpu-wb-warning); font-size: 13px; line-height: 1.55; }
      #${panelId} .cpu-wb-process-note {
        margin: 10px 0 0; padding: 9px 10px; border: 1px solid color-mix(in srgb, var(--cpu-wb-primary) 18%, var(--cpu-wb-border));
        border-radius: 10px; background: var(--cpu-wb-primary-soft); color: var(--cpu-wb-primary-strong); font-size: 12px; line-height: 1.55;
      }
      #${panelId} .cpu-wb-form { display: grid; gap: 8px; margin-top: 12px; }
      #${panelId} .cpu-wb-field { display: grid; gap: 6px; }
      #${panelId} .cpu-wb-field span { color: var(--cpu-wb-muted-strong); font-size: 12px; }
      #${panelId} .cpu-wb-field input {
        width: 100%; min-width: 0; padding: 11px 12px; border: 1px solid var(--cpu-wb-border); border-radius: 12px;
        background: #fff; color: var(--cpu-wb-text); outline: none;
        transition: border-color .16s ease, background .16s ease, box-shadow .16s ease;
      }
      #${panelId} .cpu-wb-field input::placeholder { color: color-mix(in srgb, var(--cpu-wb-muted) 82%, white); }
      #${panelId} .cpu-wb-field input:focus {
        border-color: color-mix(in srgb, var(--cpu-wb-primary) 64%, var(--cpu-wb-border));
        background: color-mix(in srgb, #fff 88%, var(--cpu-wb-primary-soft));
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--cpu-wb-primary) 18%, transparent);
      }
      #${panelId} .cpu-wb-captcha { display: grid; grid-template-columns: 118px minmax(0, 1fr); gap: 10px; align-items: start; margin-top: 10px; }
      #${panelId} .cpu-wb-captcha-shot {
        display: grid; place-items: center; width: 100%; min-width: 0; min-height: 56px; padding: 0; border: 1px solid var(--cpu-wb-border);
        border-radius: 12px; background: #fff; overflow: hidden;
      }
      #${panelId} .cpu-wb-captcha-shot canvas { display: block; width: 100%; height: 100%; min-height: 54px; background: #fff; pointer-events: none; }
      #${panelId} .cpu-wb-captcha-fallback {
        display: grid; place-items: center; width: 100%; min-height: 54px; padding: 8px; color: var(--cpu-wb-muted);
        font-size: 12px; line-height: 1.35; text-align: center; background: #fff;
      }
      #${panelId} .cpu-wb-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      #${panelId} .cpu-wb-actions button {
        min-width: 120px; min-height: 36px; flex: 1; border: 1px solid var(--cpu-wb-border); border-radius: 10px;
        background: #fff; color: var(--cpu-wb-primary);
      }
      #${panelId} .cpu-wb-actions button:hover { border-color: color-mix(in srgb, var(--cpu-wb-primary) 50%, var(--cpu-wb-border)); background: var(--cpu-wb-subtle); }
      #${panelId} .cpu-wb-primary {
        background: linear-gradient(180deg, #547ce0, #3f65cc) !important; border-color: transparent !important;
        color: #fff !important; font-weight: 700;
      }
      #${panelId} .cpu-wb-primary:hover { background: linear-gradient(180deg, #5b85e9, #476dd5) !important; }
      #${panelId} .cpu-wb-secondary { color: var(--cpu-wb-muted-strong) !important; }
      #${panelId} .cpu-wb-note { margin-top: 10px; color: var(--cpu-wb-muted); font-size: 12px; line-height: 1.55; }
      #${panelId} .cpu-wb-log { display: grid; gap: 8px; margin-top: 12px; }
      #${panelId} .cpu-wb-log-row {
        display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--cpu-wb-border-soft);
      }
      #${panelId} .cpu-wb-log-row:last-child { border-bottom: 0; padding-bottom: 0; }
      #${panelId} .cpu-wb-log-row time { color: var(--cpu-wb-muted); font-variant-numeric: tabular-nums; }
      #${panelId} .cpu-wb-log-row span { word-break: break-word; }
      #${panelId} .cpu-wb-log-row[data-type="error"] span { color: var(--cpu-wb-danger); }
      #${launcherId} {
        position: fixed; right: 22px; bottom: 28px; z-index: 2147482998; min-height: 44px; padding: 0 16px; border: 0;
        border-radius: 999px; background: linear-gradient(180deg, #ffffff, #eef4ff); color: var(--cpu-wb-primary-strong);
        border: 1px solid color-mix(in srgb, var(--cpu-wb-primary) 22%, var(--cpu-wb-border));
        box-shadow: 0 12px 30px rgba(77, 101, 157, .16); font: 700 14px system-ui, sans-serif; cursor: pointer;
      }
      @media (prefers-color-scheme: dark) {
        #${panelId} { box-shadow: 0 24px 70px rgba(77, 101, 157, .18); }
        #${launcherId} { box-shadow: 0 12px 30px rgba(77, 101, 157, .16); }
      }
      @media (max-width: 700px) {
        #${panelId} {
          top: 64px; right: 10px; left: 10px; width: auto; max-height: calc(100vh - 78px); border-radius: 16px;
        }
        #${panelId} .cpu-wb-header { gap: 8px; padding: 12px; cursor: default; touch-action: auto; }
        #${panelId} .cpu-wb-mark { width: 34px; height: 34px; border-radius: 11px; font-size: 16px; }
        #${panelId} .cpu-wb-heading strong { font-size: 15px; }
        #${panelId} .cpu-wb-heading span { display: none; }
        #${panelId} .cpu-wb-icon { width: 34px; height: 34px; }
        #${panelId} .cpu-wb-body { padding: 13px; }
        #${panelId} .cpu-wb-captcha { grid-template-columns: 1fr; }
        #${panelId} .cpu-wb-actions button { min-width: 0; }
        #${launcherId} { right: 14px; bottom: 76px; }
      }
    `;
    panel.innerHTML = `
      <header class="cpu-wb-header" title="拖动调整窗口位置">
        <div class="cpu-wb-mark" aria-hidden="true">🛡</div>
        <div class="cpu-wb-heading"><strong>安全微伴助手</strong><span>登录、刷课与任务控制</span></div>
        <div class="cpu-wb-header-actions">
          <button class="cpu-wb-icon" type="button" data-action="close" title="隐藏面板" aria-label="隐藏面板">×</button>
        </div>
      </header>
      <main class="cpu-wb-body">
        <section class="cpu-wb-card">
          <span class="cpu-wb-kicker">当前状态</span>
          <h3 class="cpu-wb-title" id="cpu-wb-status">请先登录</h3>
          <p class="cpu-wb-muted" id="cpu-wb-summary">请在本助手内登录；外侧官方页面登录不等于刷课进程登录。</p>
        </section>

        <section class="cpu-wb-card" id="cpu-wb-setup">
          <span class="cpu-wb-kicker">登录信息</span>
          <h3 class="cpu-wb-title">首次使用，请填写登录信息</h3>
          <p class="cpu-wb-lead">学校名和账号会保存在本机，密码只用于本次登录。</p>
          <p class="cpu-wb-process-note">请在本助手内完成登录。外侧官方页面只负责显示课程页面，不会让助手刷课进程自动登录。</p>
          <div class="cpu-wb-form">
            <label class="cpu-wb-field">
              <span>学校名</span>
              <input id="cpu-wb-school" placeholder="学校名（如：中国药科大学）" autocomplete="off" spellcheck="false">
            </label>
            <label class="cpu-wb-field">
              <span>学号 / 用户名</span>
              <input id="cpu-wb-user" placeholder="学号/用户名" autocomplete="off" spellcheck="false">
            </label>
            <label class="cpu-wb-field">
              <span>密码</span>
              <input id="cpu-wb-pass" type="password" placeholder="密码" autocomplete="off">
            </label>
          </div>
          <div class="cpu-wb-captcha" id="cpu-wb-captcha-row" hidden>
            <button class="cpu-wb-captcha-shot" type="button" id="cpu-wb-captcha-img" title="点击刷新验证码图片" aria-label="刷新验证码图片">
              <canvas id="cpu-wb-captcha-preview" width="118" height="54" aria-label="验证码"></canvas>
              <span class="cpu-wb-captcha-fallback" id="cpu-wb-captcha-fallback" hidden>验证码加载失败，点击重试</span>
            </button>
            <label class="cpu-wb-field">
              <span>验证码</span>
              <input id="cpu-wb-captcha-val" placeholder="验证码" autocomplete="off" spellcheck="false">
            </label>
          </div>
          <div class="cpu-wb-actions">
            <button class="cpu-wb-primary" id="cpu-wb-login-btn" type="button">登录并开始</button>
          </div>
          <p class="cpu-wb-note">验证码由助手独立获取，点左侧图片可刷新；外面官网登录状态与这里无关。</p>
        </section>

        <section class="cpu-wb-card" id="cpu-wb-session-card" hidden>
          <span class="cpu-wb-kicker">运行控制</span>
          <h3 class="cpu-wb-title">已登录，准备开始刷课</h3>
          <p class="cpu-wb-muted" id="cpu-wb-session-text">点击开始刷课即可进入自动流程，也可以退出后重新登录。</p>
          <div class="cpu-wb-actions">
            <button class="cpu-wb-primary" id="cpu-wb-run-btn" type="button">开始刷课</button>
            <button class="cpu-wb-secondary" id="cpu-wb-logout-btn" type="button" title="清除登录信息">退出登录</button>
          </div>
        </section>

        <section class="cpu-wb-card">
          <span class="cpu-wb-kicker">运行日志</span>
          <div class="cpu-wb-log" id="cpu-wb-log"></div>
        </section>
      </main>
    `;
    document.body.append(style, panel, launcher);

    const logEl = panel.querySelector('#cpu-wb-log');
    const statusEl = panel.querySelector('#cpu-wb-status');
    const summaryEl = panel.querySelector('#cpu-wb-summary');
    const setupCard = panel.querySelector('#cpu-wb-setup');
    const sessionCard = panel.querySelector('#cpu-wb-session-card');
    const captchaRow = panel.querySelector('#cpu-wb-captcha-row');
    const captchaShot = panel.querySelector('#cpu-wb-captcha-img');
    const captchaPreview = panel.querySelector('#cpu-wb-captcha-preview');
    const captchaFallback = panel.querySelector('#cpu-wb-captcha-fallback');
    const captchaInput = panel.querySelector('#cpu-wb-captcha-val');
    const schoolInput = panel.querySelector('#cpu-wb-school');
    const userInput = panel.querySelector('#cpu-wb-user');
    const passInput = panel.querySelector('#cpu-wb-pass');
    const loginBtn = panel.querySelector('#cpu-wb-login-btn');
    const runBtn = panel.querySelector('#cpu-wb-run-btn');
    const logoutBtn = panel.querySelector('#cpu-wb-logout-btn');
    let drag = null;
    const positionKey = 'cpu-weban-position-v1';

    const clampPanelPosition = (left, topValue) => {
      const width = panel.offsetWidth || 470;
      const height = panel.offsetHeight || 420;
      return {
        left: Math.max(8, Math.min(left, Math.max(8, host.innerWidth - width - 8))),
        top: Math.max(8, Math.min(topValue, Math.max(8, host.innerHeight - height - 8))),
      };
    };

    const setPanelPosition = (left, topValue, persist = false) => {
      if (host.innerWidth <= 700) {
        panel.style.removeProperty('left');
        panel.style.removeProperty('right');
        panel.style.removeProperty('top');
        return;
      }
      const next = clampPanelPosition(Number(left) || 0, Number(topValue) || 0);
      panel.style.left = `${next.left}px`;
      panel.style.top = `${next.top}px`;
      panel.style.right = 'auto';
      if (persist) {
        try { host.sessionStorage.setItem(positionKey, JSON.stringify(next)); } catch {}
      }
    };

    const restorePanelPosition = () => {
      if (host.innerWidth <= 700) return setPanelPosition(0, 0);
      try {
        const saved = JSON.parse(host.sessionStorage.getItem(positionKey) || 'null');
        if (saved && Number.isFinite(Number(saved.left)) && Number.isFinite(Number(saved.top))) {
          return setPanelPosition(saved.left, saved.top);
        }
      } catch {}
      panel.style.removeProperty('left');
      panel.style.removeProperty('right');
      panel.style.removeProperty('top');
    };

    const showPanel = () => {
      panel.hidden = false;
      launcher.hidden = true;
      restorePanelPosition();
    };

    const hidePanel = () => {
      panel.hidden = true;
      launcher.hidden = false;
    };

    panel.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('[data-action="close"]')) {
        hidePanel();
      }
    });

    launcher.addEventListener('click', showPanel);

    panel.querySelector('.cpu-wb-header').addEventListener('pointerdown', (event) => {
      if (host.innerWidth <= 700 || event.button !== 0 || event.target.closest('button, input, a, textarea')) return;
      const rect = panel.getBoundingClientRect();
      drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, left: rect.left, top: rect.top };
      event.preventDefault();
    });
    doc.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      setPanelPosition(drag.left + event.clientX - drag.clientX, drag.top + event.clientY - drag.clientY);
    });
    doc.addEventListener('pointerup', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const rect = panel.getBoundingClientRect();
      drag = null;
      setPanelPosition(rect.left, rect.top, true);
    });
    host.addEventListener('resize', restorePanelPosition);
    restorePanelPosition();

    return {
      setStatus(msg) { statusEl.textContent = msg; },
      addLog(msg) {
        const line = document.createElement('div');
        line.className = 'cpu-wb-log-row';
        line.innerHTML = `<time>${new Date().toLocaleTimeString('zh-CN', { hour12: false })}</time><span></span>`;
        line.querySelector('span').textContent = msg;
        logEl.appendChild(line);
        while (logEl.childElementCount > 80) logEl.removeChild(logEl.firstElementChild);
        logEl.scrollTop = logEl.scrollHeight;
      },
      showSetup() {
        setupCard.hidden = false;
        sessionCard.hidden = true;
        summaryEl.textContent = '请在本助手内登录；外侧官方页面登录不等于刷课进程登录。';
      },
      showActions() {
        setupCard.hidden = true;
        sessionCard.hidden = false;
        summaryEl.textContent = '登录成功后可以直接开始刷课，也可以退出后重新登录。';
      },
      showCaptcha(bitmap, refresh) {
        captchaRow.hidden = false;
        captchaFallback.hidden = true;
        captchaPreview.hidden = false;
        const ctx = captchaPreview.getContext('2d', { alpha: false });
        if (!ctx) {
          captchaPreview.hidden = true;
          captchaFallback.textContent = '验证码画布不可用，点击重试';
          captchaFallback.hidden = false;
        } else {
          const width = 118;
          const height = 54;
          const ratio = host.devicePixelRatio || 1;
          captchaPreview.width = Math.max(1, Math.round(width * ratio));
          captchaPreview.height = Math.max(1, Math.round(height * ratio));
          captchaPreview.style.width = '100%';
          captchaPreview.style.height = '100%';
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          ctx.clearRect(0, 0, width, height);
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(bitmap, 0, 0, width, height);
          if (typeof bitmap.close === 'function') bitmap.close();
        }
        captchaShot.onclick = async () => {
          if (typeof refresh !== 'function') return;
          try {
            await refresh();
          } catch (error) {
            status(`验证码刷新失败：${error?.message || error}`);
          }
        };
        captchaInput.value = '';
        captchaInput.focus();
      },
      showCaptchaError(message, refresh) {
        captchaRow.hidden = false;
        captchaPreview.hidden = true;
        captchaFallback.textContent = message || '验证码加载失败，点击重试';
        captchaFallback.hidden = false;
        captchaShot.onclick = async () => {
          if (typeof refresh !== 'function') return;
          try {
            await refresh();
          } catch (error) {
            status(`验证码刷新失败：${error?.message || error}`);
          }
        };
      },
      getCaptchaVal() { return captchaInput?.value?.trim() || ''; },
      getCredentials() {
        return {
          school: schoolInput?.value?.trim() || '',
          username: userInput?.value?.trim() || '',
          password: passInput?.value?.trim() || '',
        };
      },
      onLoginClick(fn) { loginBtn.onclick = fn; },
      onRunClick(fn) { runBtn.onclick = fn; },
      onLogoutClick(fn) { logoutBtn.onclick = fn; },
    };
  })();

  const logFn = log;
  Object.assign(globalThis, { __webanLog: logFn });

  // ─────────────────────────────────────────────
  // 13. 启动入口
  // ─────────────────────────────────────────────
  const savedCreds = store.get('creds');
  const savedSession = store.get('session');

  if (savedSession?.token) {
    Object.assign(session, savedSession);
    ui.showActions();
    ui.setStatus('已登录，点击开始刷课');
    ui.onRunClick(async () => {
      try { await runAll(); } catch (e) { status('出错: ' + e.message); logFn(e.stack || e.message); }
    });
    ui.onLogoutClick(() => {
      store.set('session', null);
      store.set('creds', null);
      session = { userId: '', token: '', tenantCode: '' };
      ui.showSetup();
      ui.setStatus('已退出登录');
    });
    // 自动启动
    try { await runAll(); } catch (e) { status('出错: ' + e.message); logFn(e.stack || e.message); }
  } else {
    ui.showSetup();
    ui.setStatus('请先登录');
    if (savedCreds) {
      const schoolEl = document.querySelector('#cpu-wb-school');
      const userEl = document.querySelector('#cpu-wb-user');
      if (schoolEl) schoolEl.value = savedCreds.school || '';
      if (userEl) userEl.value = savedCreds.username || '';
    }

    // 显示验证码
    let captchaTs = '';
    const loadCaptcha = async () => {
      const nextTs = Date.now().toString();
      try {
        const captchaBitmap = await fetchCaptchaBitmap(nextTs);
        captchaTs = nextTs;
        ui.showCaptcha(captchaBitmap, loadCaptcha);
      } catch (error) {
        ui.showCaptchaError(`验证码加载失败：${error?.message || error}`, loadCaptcha);
      }
    };
    await loadCaptcha();

    ui.onLoginClick(async () => {
      const { school, username, password } = ui.getCredentials();
      const verifyCode = ui.getCaptchaVal();
      if (!school || !username || !password || !verifyCode) {
        ui.setStatus('请填写所有字段'); return;
      }
      ui.setStatus('正在查找学校…');
      const tenantCode = await getTenantCode(school);
      if (!tenantCode) { ui.setStatus('未找到该学校，请检查名称'); return; }
      ui.setStatus('正在登录…');
      const res = await doLogin(tenantCode, username, password, verifyCode, captchaTs);
      if (!res?.data?.token) {
        ui.setStatus('登录失败：' + (res?.msg || '验证码或密码错误'));
        await loadCaptcha();
        return;
      }
      session = { userId: res.data.userId, token: res.data.token, tenantCode };
      store.set('session', session);
      store.set('creds', { school, username });
      ui.showActions();
      ui.setStatus('登录成功，开始刷课…');
      try { await runAll(); } catch (e) { status('出错: ' + e.message); logFn(e.stack || e.message); }
    });

    ui.onRunClick(async () => {
      try { await runAll(); } catch (e) { status('出错: ' + e.message); logFn(e.stack || e.message); }
    });
    ui.onLogoutClick(() => {
      store.set('session', null);
      session = { userId: '', token: '', tenantCode: '' };
      ui.showSetup();
    });
  }

})();
