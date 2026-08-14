// ==UserScript==
// @name         药大拾间·安全微伴助手
// @namespace    cpu-weban
// @version      1.0.0
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
  const log = (msg) => { report('log', msg); console.log('[WeBan]', msg); };

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

  const fetchCaptchaDataUrl = async () => {
    const ts = Date.now().toString();
    const resp = await fetch(`${BASE}/pharos/login/randLetterImage.do?time=${ts}`, { credentials: 'include' });
    const buf = await resp.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return `data:image/png;base64,${b64}`;
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
    const panel = document.createElement('div');
    panel.id = 'cpu-weban-panel';
    panel.style.cssText = `
      position:fixed;bottom:20px;right:20px;z-index:99999;
      width:320px;background:#1a1a2e;color:#e0e0e0;border-radius:12px;
      box-shadow:0 8px 32px rgba(0,0,0,.5);font-family:system-ui,sans-serif;
      font-size:13px;overflow:hidden;user-select:none;
    `;
    panel.innerHTML = `
      <div id="cpu-wb-header" style="padding:10px 14px;background:#16213e;display:flex;align-items:center;justify-content:space-between;cursor:move;">
        <span style="font-weight:600;color:#4fc3f7;">🛡️ 安全微伴助手</span>
        <span id="cpu-wb-toggle" style="cursor:pointer;opacity:.7;font-size:16px;">▼</span>
      </div>
      <div id="cpu-wb-body" style="padding:12px 14px;">
        <div id="cpu-wb-status" style="margin-bottom:8px;color:#a5d6a7;min-height:18px;"></div>
        <div id="cpu-wb-log" style="max-height:120px;overflow-y:auto;font-size:11px;color:#90a4ae;line-height:1.6;"></div>
        <div id="cpu-wb-setup" style="display:none;margin-top:8px;">
          <div style="margin-bottom:6px;color:#ffcc80;font-size:12px;">首次使用，请填写登录信息：</div>
          <input id="cpu-wb-school" placeholder="学校名（如：中国药科大学）" style="${inputStyle()}">
          <input id="cpu-wb-user" placeholder="学号/用户名" style="${inputStyle()}">
          <input id="cpu-wb-pass" type="password" placeholder="密码" style="${inputStyle()}">
          <div id="cpu-wb-captcha-row" style="display:none;margin-bottom:6px;">
            <img id="cpu-wb-captcha-img" style="height:40px;border-radius:4px;cursor:pointer;" title="点击刷新">
            <input id="cpu-wb-captcha-val" placeholder="验证码" style="${inputStyle('calc(100% - 0px)')}">
          </div>
          <button id="cpu-wb-login-btn" style="${btnStyle()}">登录并开始</button>
        </div>
        <div id="cpu-wb-actions" style="display:none;margin-top:8px;display:flex;gap:8px;">
          <button id="cpu-wb-run-btn" style="${btnStyle()}">▶ 开始刷课</button>
          <button id="cpu-wb-logout-btn" style="${btnStyle('#555')}" title="清除登录信息">退出</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    function inputStyle(w = '100%') {
      return `width:${w};box-sizing:border-box;margin-bottom:6px;padding:6px 8px;background:#0f3460;border:1px solid #1a4a7a;border-radius:6px;color:#e0e0e0;font-size:12px;outline:none;`;
    }
    function btnStyle(bg = '#1565c0') {
      return `flex:1;padding:7px 0;background:${bg};border:none;border-radius:6px;color:#fff;font-size:12px;cursor:pointer;`;
    }

    const logEl = panel.querySelector('#cpu-wb-log');
    const statusEl = panel.querySelector('#cpu-wb-status');
    let collapsed = false;

    panel.querySelector('#cpu-wb-toggle').onclick = () => {
      collapsed = !collapsed;
      panel.querySelector('#cpu-wb-body').style.display = collapsed ? 'none' : '';
      panel.querySelector('#cpu-wb-toggle').textContent = collapsed ? '▲' : '▼';
    };

    // Drag
    const header = panel.querySelector('#cpu-wb-header');
    let drag = null;
    header.addEventListener('mousedown', e => { drag = { x: e.clientX - panel.offsetLeft, y: e.clientY - panel.offsetTop }; });
    document.addEventListener('mousemove', e => { if (drag) { panel.style.left = (e.clientX - drag.x) + 'px'; panel.style.bottom = 'auto'; panel.style.top = (e.clientY - drag.y) + 'px'; } });
    document.addEventListener('mouseup', () => { drag = null; });

    return {
      setStatus(msg) { statusEl.textContent = msg; },
      addLog(msg) {
        const line = document.createElement('div');
        line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
      },
      showSetup() {
        panel.querySelector('#cpu-wb-setup').style.display = '';
        panel.querySelector('#cpu-wb-actions').style.display = 'none';
      },
      showActions() {
        panel.querySelector('#cpu-wb-setup').style.display = 'none';
        panel.querySelector('#cpu-wb-actions').style.display = 'flex';
      },
      showCaptcha(dataUrl) {
        const row = panel.querySelector('#cpu-wb-captcha-row');
        row.style.display = '';
        const img = panel.querySelector('#cpu-wb-captcha-img');
        img.src = dataUrl;
        img.onclick = async () => { img.src = await fetchCaptchaDataUrl(); };
      },
      getCaptchaVal() { return panel.querySelector('#cpu-wb-captcha-val')?.value?.trim() || ''; },
      getCredentials() {
        return {
          school: panel.querySelector('#cpu-wb-school')?.value?.trim() || '',
          username: panel.querySelector('#cpu-wb-user')?.value?.trim() || '',
          password: panel.querySelector('#cpu-wb-pass')?.value?.trim() || '',
        };
      },
      onLoginClick(fn) { panel.querySelector('#cpu-wb-login-btn').onclick = fn; },
      onRunClick(fn) { panel.querySelector('#cpu-wb-run-btn').onclick = fn; },
      onLogoutClick(fn) { panel.querySelector('#cpu-wb-logout-btn').onclick = fn; },
    };
  })();

  // 覆盖 log 以同时输出到 UI
  const _origLog = log;
  const logFn = (msg) => { _origLog(msg); ui.addLog(msg); };
  // re-bind
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
    const captchaTs = Date.now().toString();
    const captchaDataUrl = await fetchCaptchaDataUrl();
    ui.showCaptcha(captchaDataUrl);

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
        const newUrl = await fetchCaptchaDataUrl();
        ui.showCaptcha(newUrl);
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
