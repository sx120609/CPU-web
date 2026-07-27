// 应用外壳：标签栏 + 工具页 + 离线页。
// 站点内容与学习通跑在各自的 WebContentsView 里，永远盖在本页之上，
// 所以工具页不是浮层 —— 切到工具标签时主进程会把视图藏起来，本页才露出来。

const shell = window.cpuShell;

const el = (id) => document.querySelector(`#${id}`);
const tabsBar = el("tabs");
const workspace = el("workspace");
const offline = el("offline");
const statusLine = el("status-line");

let tabState = { tabs: [], activeId: "" };
let scriptConfig = {};
let pendingReload = false;

const AUTOMATION = [
  ["autoVideo", "自动播放视频与音频", "视频任务点自动播放并等待完成"],
  ["autoJump", "自动切换到下一章", "一章做完后自动往下走；关掉就停在原地等你"],
  ["autoSubmit", "自动提交章节测验", "正确率低于下方阈值时仍会暂存不交"],
  ["autoExam", "考试自动翻下一题", "只作用于考试页面"]
];

// 脚本在标签打开时对配置做快照，这些项改了要重开标签
const RELOAD_KEYS = [
  "autoVideo", "autoJump", "autoSubmit", "autoExam",
  "interval", "answerIntervalMin", "answerIntervalMax",
  "submitDelayMin", "submitDelayMax", "minAccuracy"
];

const NUMBER_KEYS = [
  "interval", "minAccuracy",
  "answerIntervalMin", "answerIntervalMax",
  "submitDelayMin", "submitDelayMax"
];

const say = (message, error = false) => {
  statusLine.textContent = message;
  statusLine.dataset.error = String(error);
};

const errorText = (error, fallback) => (error instanceof Error && error.message ? error.message : fallback);
const formatDate = (value) => (typeof value === "number" && Number.isFinite(value)
  ? new Date(value).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })
  : "—");
const formatTime = (at) => new Date(at).toLocaleTimeString("zh-CN", { hour12: false });

/* ------------------------------------------------------------- 标签栏 */

const renderTabs = () => {
  tabsBar.textContent = "";
  for (const tab of tabState.tabs) {
    const button = document.createElement("button");
    button.className = "tab";
    button.type = "button";
    button.dataset.active = String(tab.id === tabState.activeId);
    button.title = tab.title;

    if (tab.loading) {
      const spin = document.createElement("span");
      spin.className = "tab-spin";
      button.append(spin);
    }
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title;
    button.append(title);

    button.addEventListener("click", () => void shell.tabs.activate(tab.id));

    if (tab.closable) {
      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×";
      close.title = "关闭标签";
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        void shell.tabs.close(tab.id);
      });
      button.append(close);
    }
    tabsBar.append(button);
  }

  // 工具标签没有内容视图，激活它就等于显示本页
  const active = tabState.tabs.find((tab) => tab.id === tabState.activeId);
  const onTools = active?.kind === "tools";
  workspace.hidden = !onTools;
  // 离线页只在主站标签且主站没加载成功时显示
  if (!onTools) offline.hidden = !(active?.kind === "site" && offline.dataset.armed === "1");
  else offline.hidden = true;

  const navigable = active?.kind === "learning" || active?.kind === "site";
  el("chip-reload").disabled = !navigable;
  el("chip-back").disabled = !active?.canGoBack;
};

/* --------------------------------------------------------------- 账号 */

let currentAuthStatus = null;
let authRefreshInFlight = null;

const renderAuthSyncing = () => {
  el("auth-pill").textContent = "同步中";
  el("auth-pill").dataset.state = "";
  el("auth-fields").hidden = true;
  el("auth-howto").hidden = true;
  el("auth-login").hidden = true;
  el("auth-logout").hidden = true;
  el("auth-hint").hidden = false;
  el("auth-hint").textContent = "正在同步「首页 · 药大拾间」的登录状态…";
  el("quota-text").textContent = "同步中";
};

const renderAuth = (session) => {
  currentAuthStatus = session;
  const loggedIn = Boolean(session?.loggedIn);
  const user = session?.user || {};
  el("auth-pill").textContent = loggedIn ? "已登录" : session?.expired ? "已过期" : "未登录";
  el("auth-pill").dataset.state = loggedIn ? "ok" : "";
  el("auth-fields").hidden = !loggedIn;
  el("auth-login").hidden = loggedIn;
  el("auth-logout").hidden = !loggedIn;
  el("auth-hint").hidden = loggedIn;
  if (!loggedIn) {
    el("auth-howto").hidden = true;
    // 到期本来会自动续（主站还登着就静默换新的），走到这里说明主站也退了
    el("auth-hint").textContent = session?.expired
      ? "登录状态已失效。在「首页 · 药大拾间」里登录一次即可，这里会自动同步。"
      : "在「首页 · 药大拾间」登录后，这里会自动同步，无需再登录一次。";
    el("quota-text").textContent = "未登录";
    return;
  }
  el("auth-name").textContent = user.user || user.nickname || user.name || user.username || user.sub || "已登录用户";

  // 数值为 0 是有效信息，不能显示成"—"，所以一律判类型而不是判真值
  const num = (value) => (typeof value === "number" ? value : null);
  const show = (id, value, suffix = "") => {
    el(id).textContent = value === null ? "—" : `${value}${suffix}`;
  };

  el("auth-level").textContent = user.levelName
    ? `Lv.${user.level ?? "?"} ${user.levelName}`
    : "—";

  const reputation = num(user.reputation);
  el("auth-reputation").textContent = reputation === null
    ? "—"
    : num(user.nextLevelNeed) !== null && user.nextLevelName
      ? `${reputation} 分 · 再得 ${user.nextLevelNeed} 分升到「${user.nextLevelName}」`
      : `${reputation} 分`;

  // 日额度与点数是两回事：日额度每天重置，点数不过期，日额度用完才动点数
  const quota = num(user.dailyQuota);
  const dailyRemaining = num(user.dailyRemaining);
  el("auth-usage").textContent = quota === null
    ? "—"
    : dailyRemaining === null
      ? `已用 ${user.usedToday || 0} / ${quota}`
      : `剩 ${dailyRemaining} / ${quota} 次`;

  show("auth-points", num(user.assistantPoints), " 点");

  const balance = num(user.aiBalance);
  el("auth-balance").textContent = balance === null ? "—" : `${balance} 次`;
  el("auth-expires").textContent = formatDate(session.expiresAt);
  el("quota-text").textContent = balance === null ? "—" : `剩 ${balance}`;

  renderHowTo(user);
};

/* -------------------------------------------------- 怎么提升免费额度 */
// 档位与系数都能被站点后台改，所以一个数字都不写死在这里 ——
// 全部来自 /api/site/ai-quota-rules 下发的当前配置。

let quotaRules = null;

const renderHowTo = (user) => {
  const box = el("auth-howto");
  if (!quotaRules) { box.hidden = true; return; }
  box.hidden = false;

  const rep = quotaRules.reputation;
  el("howto-intro").textContent =
    "每天的免费次数由等级决定，等级由信誉值决定。信誉值这样累积（括号内是这一项的上限）：";

  const gained = {
    post: typeof user.postPoints === "number" ? user.postPoints : null,
    reply: typeof user.replyPoints === "number" ? user.replyPoints : null,
    age: typeof user.agePoints === "number" ? user.agePoints : null
  };
  const got = (value, cap) => (value === null ? `上限 ${cap}` : `已得 ${value} / ${cap}`);

  const items = [
    `发主题帖：每篇 +${rep.postPointsPerTopic} 分（${got(gained.post, rep.postPointsCap)}）`,
    `发回复：每条 +${rep.replyPointsPerReply} 分（${got(gained.reply, rep.replyPointsCap)}）`,
    `注册时长：每满 ${rep.accountAgeDaysPerStep} 天 +${rep.accountAgePointsPerStep} 分（${got(gained.age, rep.accountAgePointsCap)}）`
  ];
  const list = el("howto-list");
  list.textContent = "";
  for (const text of items) {
    const li = document.createElement("li");
    li.textContent = text;
    list.append(li);
  }

  el("howto-tiers").textContent = `各等级每日免费次数：${
    quotaRules.dailyQuotas.map((t) => `Lv.${t.level} ${t.quota} 次`).join(" · ")
  }。日额度北京时间 00:00 重置，不累积到第二天。`;

  // 点赞和浏览量不加分 —— 这点必须说，否则用户会去刷没用的东西
  el("howto-points").textContent = quotaRules.assistantPointsPerYuan > 0
    ? `注意：点赞与浏览量不计入信誉值，帖子被删除或隐藏会扣回对应分数。日额度用完后可消耗 AI 点数，1 点抵 1 次；点数不过期，赞助每 1 元可得 ${quotaRules.assistantPointsPerYuan} 点。`
    : "注意：点赞与浏览量不计入信誉值，帖子被删除或隐藏会扣回对应分数。日额度用完后可消耗 AI 点数，1 点抵 1 次，点数不过期。";
};

const refreshAuth = (options = {}) => {
  if (authRefreshInFlight) return authRefreshInFlight;
  const syncing = options.sync === true;
  if (syncing && !currentAuthStatus?.loggedIn) renderAuthSyncing();
  const request = syncing ? shell.auth.sync(options.force === true) : shell.auth.getStatus();
  const task = request
    .then((status) => {
      renderAuth(status);
      return status;
    })
    .catch(() => {
      const status = { loggedIn: false };
      renderAuth(status);
      return status;
    })
    .finally(() => {
      if (authRefreshInFlight === task) authRefreshInFlight = null;
    });
  authRefreshInFlight = task;
  return task;
};

const renderSiteFooter = async () => {
  try {
    const config = await shell.getSiteConfig();
    const filing = el("site-filing");
    const text = typeof config?.siteFilingNumber === "string" ? config.siteFilingNumber.trim() : "";
    filing.textContent = text;
    filing.hidden = !text;
  } catch {
    el("site-filing").hidden = true;
  }
};

/* ------------------------------------------------------------- 校园网 */

const CAMPUS_DOT = { online: "online", offline: "offline", "off-campus": "", authenticating: "offline", paused: "paused", unknown: "", disabled: "" };
const CAMPUS_PILL = { online: "ok", offline: "warn", paused: "bad", authenticating: "warn" };

const renderCampusState = (state) => {
  if (!state) return;
  el("campus-pill").textContent = state.message || "—";
  el("campus-pill").dataset.state = CAMPUS_PILL[state.status] || "";
  el("campus-dot").dataset.state = CAMPUS_DOT[state.status] ?? "";
  el("campus-text").textContent = state.status === "disabled" ? "校园网" : state.message || "校园网";
  if (!el("campus-student").value) el("campus-student").value = state.studentId || "";
  el("campus-hint").textContent = state.hasCredential
    ? `已保存学号 ${state.studentId}。密码经系统安全存储加密，不会回传到界面。`
    : "密码用系统安全存储加密，只在发起认证时于后台解密。";
  el("campus-login").disabled = !state.hasCredential;
};

const renderCampusSettings = (settings) => {
  if (!settings) return;
  el("campus-enabled").checked = Boolean(settings.enabled);
  el("campus-body").hidden = !settings.enabled;
  el("campus-mode").value = settings.mode || "auto";
  el("campus-carrier").value = settings.carrier || "";
  el("campus-interval").value = String(settings.intervalSec ?? 15);
  // 运营商后缀只在宽带模式下拼进账号
  el("campus-carrier-field").hidden = settings.mode === "campus";
};

const pushCampusSettings = async (patch) => {
  try {
    renderCampusSettings(await shell.campusNet.updateSettings(patch));
    say("校园网设置已保存。");
  } catch (error) {
    say(errorText(error, "校园网设置保存失败。"), true);
  }
};

const renderCampusLogs = (entries) => {
  // 空着不写字的话，一条空灰条看起来就像功能坏了
  el("campus-logs").textContent = entries.length
    ? entries.map((entry) => `${formatTime(entry.at)}  ${entry.message}`).join("\n")
    : "还没有记录。开启后台自动连接后，这里会显示每次检测与认证的结果。";
};

/* --------------------------------------------------- 学习通记住密码 */

const renderChaoxing = (state) => {
  if (!state) return;
  el("cx-remember").checked = Boolean(state.remember);
  el("cx-hint").hidden = !state.remember;
  el("cx-actions").hidden = !state.remember || !state.hasCredential;
  if (!state.remember) return;
  el("cx-hint").textContent = state.hasCredential
    ? `已保存账号 ${state.account}。密码经系统安全存储加密，只在打开学习通登录页时自动填充，不会回传到界面。`
    : "还没有保存过。下次在学习通登录页用账号密码登录时会自动记下来。";
};

const bindChaoxing = () => {
  el("cx-remember").addEventListener("change", async () => {
    const input = el("cx-remember");
    const previous = !input.checked;
    try {
      renderChaoxing(await shell.chaoxing.setRemember(input.checked));
      say(input.checked ? "已开启记住学习通账号密码。" : "已关闭，之前存的账号密码已删除。");
    } catch (error) {
      input.checked = previous;
      say(errorText(error, "设置保存失败。"), true);
    }
  });
  el("cx-clear").addEventListener("click", async () => {
    try {
      renderChaoxing(await shell.chaoxing.clearCredential());
      say("已删除保存的学习通账号密码。");
    } catch (error) {
      say(errorText(error, "删除失败。"), true);
    }
  });
};

/* --------------------------------------------------------------- 刷题 */

const renderScriptSwitches = () => {
  const host = el("script-switches");
  host.textContent = "";
  for (const [key, label, hint] of AUTOMATION) {
    const wrap = document.createElement("label");
    wrap.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(scriptConfig[key]);
    input.addEventListener("change", () => void pushScriptConfig(key, input.checked));
    const track = document.createElement("span");
    track.className = "switch-track";
    const thumb = document.createElement("span");
    thumb.className = "switch-thumb";
    track.append(thumb);
    const text = document.createElement("span");
    text.className = "switch-text";
    const strong = document.createElement("strong");
    strong.textContent = label;
    const small = document.createElement("small");
    small.textContent = hint;
    text.append(strong, small);
    wrap.append(input, track, text);
    host.append(wrap);
  }
};

const renderScriptConfig = () => {
  renderScriptSwitches();
  for (const key of NUMBER_KEYS) {
    const input = el(`cfg-${key}`);
    if (input) input.value = String(scriptConfig[key] ?? "");
  }
  el("cfg-aiEnabled").checked = Boolean(scriptConfig.aiEnabled);
  el("reload-hint").hidden = !pendingReload;
};

async function pushScriptConfig(key, value) {
  try {
    scriptConfig = await shell.script.setConfig({ [key]: value });
    if (RELOAD_KEYS.includes(key)) pendingReload = true;
    renderScriptConfig();
    say("已保存。");
  } catch (error) {
    say(errorText(error, "保存失败。"), true);
  }
}

const renderScriptActivity = (activity) => {
  if (!activity) return;
  el("script-pill").hidden = !activity.running;
  if (activity.status) el("script-status").textContent = activity.status;
  const entries = activity.entries || [];
  el("script-logs").textContent = entries.length
    ? entries.slice(-60).map((entry) => `${formatTime(entry.at)}  ${entry.text}`).join("\n")
    : "还没有记录。在学习通标签里开始做任务后，这里会实时显示进度与答题结果。";
};

/* --------------------------------------------------------------- 绑定 */

const bindChrome = () => {
  el("chip-campus").addEventListener("click", () => openTools());
  el("chip-quota").addEventListener("click", () => openTools());
  el("chip-reload").addEventListener("click", () => void shell.tabs.reload(tabState.activeId));
  el("chip-back").addEventListener("click", () => void shell.tabs.goBack(tabState.activeId));
  document.querySelectorAll("[data-external]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void shell.openExternal(link.href);
    });
  });
};

const renderScriptUpdateState = (state) => {
  if (!state) return;
  const version = state.activeVersion ? `v${state.activeVersion}` : "内置版本";
  const source = state.source === "cloud"
    ? "刚从云端更新"
    : state.source === "cache"
      ? "云端缓存"
      : "安装包内置";
  el("script-version").textContent = state.stage === "checking"
    ? `${version} · 正在检查云端更新…`
    : `${version} · ${source} · ${state.message || "可用"}`;
};

// 点状态芯片就切到工具标签
const openTools = () => {
  const tools = tabState.tabs.find((tab) => tab.kind === "tools");
  if (tools) void shell.tabs.activate(tools.id);
};

const bindAuth = () => {
  el("auth-login").addEventListener("click", async () => {
    const button = el("auth-login");
    button.disabled = true;
    const status = await refreshAuth({ sync: true, force: true });
    if (status.loggedIn) {
      say("已从首页同步登录状态。");
    } else {
      const site = tabState.tabs.find((tab) => tab.kind === "site");
      if (site) void shell.tabs.activate(site.id);
      say("请在首页登录，完成后客户端会自动同步。");
    }
    button.disabled = false;
  });
  el("auth-logout").addEventListener("click", async () => {
    try {
      await shell.auth.logout();
      renderAuth({ loggedIn: false });
      say("已退出登录，授权已撤销。");
    } catch (error) {
      say(errorText(error, "退出登录失败。"), true);
    }
  });
};

const bindCampus = () => {
  el("campus-enabled").addEventListener("change", () => {
    el("campus-body").hidden = !el("campus-enabled").checked;
    void pushCampusSettings({ enabled: el("campus-enabled").checked });
  });
  el("campus-mode").addEventListener("change", () => {
    el("campus-carrier-field").hidden = el("campus-mode").value === "campus";
    void pushCampusSettings({ mode: el("campus-mode").value });
  });
  el("campus-carrier").addEventListener("change", () => void pushCampusSettings({ carrier: el("campus-carrier").value }));
  el("campus-interval").addEventListener("change", () => void pushCampusSettings({ intervalSec: Number(el("campus-interval").value) }));

  el("campus-save").addEventListener("click", async () => {
    try {
      renderCampusState(await shell.campusNet.saveCredential(el("campus-student").value, el("campus-password").value));
      el("campus-password").value = "";
      say("校园网凭据已保存。");
    } catch (error) {
      say(errorText(error, "保存失败。"), true);
    }
  });
  el("campus-login").addEventListener("click", async () => {
    const button = el("campus-login");
    button.disabled = true;
    say("正在认证校园网…");
    try {
      const state = await shell.campusNet.loginNow();
      renderCampusState(state);
      say(state.message, state.status !== "online");
    } catch (error) {
      say(errorText(error, "认证失败。"), true);
    } finally {
      button.disabled = false;
    }
  });
  el("campus-clear").addEventListener("click", async () => {
    try {
      renderCampusState(await shell.campusNet.clearCredential());
      el("campus-student").value = "";
      say("校园网凭据已清除。");
    } catch (error) {
      say(errorText(error, "清除失败。"), true);
    }
  });
};

const bindScript = () => {
  el("script-open").addEventListener("click", async () => {
    try {
      await shell.tabs.openLearning();
      pendingReload = false;
      renderScriptConfig();
    } catch (error) {
      say(errorText(error, "无法打开学习通。"), true);
      void refreshAuth();
    }
  });
  for (const key of NUMBER_KEYS) {
    el(`cfg-${key}`)?.addEventListener("change", (event) => void pushScriptConfig(key, Number(event.target.value)));
  }
  el("cfg-aiEnabled").addEventListener("change", (event) => void pushScriptConfig("aiEnabled", event.target.checked));
};

const bindPreferences = async () => {
  let preferences;
  try {
    preferences = await shell.preferences.get();
  } catch {
    return;
  }
  for (const key of ["launchOnLogin", "startMinimized", "closeToTray"]) {
    const input = el(`pref-${key}`);
    input.checked = Boolean(preferences[key]);
    input.addEventListener("change", async () => {
      const previous = !input.checked;
      try {
        const next = await shell.preferences.set({ [key]: input.checked });
        input.checked = Boolean(next[key]);
        say("设置已保存。");
      } catch (error) {
        input.checked = previous;
        say(errorText(error, "设置保存失败。"), true);
      }
    });
  }
};

const bindOffline = () => {
  el("offline-retry").addEventListener("click", async () => {
    const button = el("offline-retry");
    button.disabled = true;
    say("正在重新连接…");
    try {
      const result = await shell.retrySite();
      if (result?.siteLoaded) {
        offline.dataset.armed = "0";
        renderTabs();
        say("");
      } else {
        say("仍然连不上，请先确认校园网已认证。", true);
      }
    } catch (error) {
      say(errorText(error, "重新连接失败。"), true);
    } finally {
      button.disabled = false;
    }
  });
  el("offline-tools").addEventListener("click", () => openTools());
};

/* ------------------------------------------------------------- 首启引导 */

const OB_STEPS = 3;
let obStep = 0;

const renderOnboarding = () => {
  for (const step of document.querySelectorAll(".ob-step")) {
    if (Number(step.dataset.step) === obStep) step.setAttribute("data-active", "");
    else step.removeAttribute("data-active");
  }
  const pager = el("ob-pager");
  pager.textContent = "";
  for (let index = 0; index < OB_STEPS; index += 1) {
    const dot = document.createElement("i");
    if (index === obStep) dot.setAttribute("data-active", "");
    pager.append(dot);
  }
};

const startOnboarding = () => {
  document.body.dataset.onboarding = "1";
  el("onboard").hidden = false;
  renderOnboarding();

  for (const button of document.querySelectorAll("[data-next]")) {
    button.addEventListener("click", () => {
      obStep = Math.min(obStep + 1, OB_STEPS - 1);
      renderOnboarding();
    });
  }

  el("ob-done").addEventListener("click", async () => {
    const button = el("ob-done");
    button.disabled = true;
    try {
      await shell.completeOnboarding({
        launchOnLogin: el("ob-launch").checked,
        campusNetEnabled: el("ob-campus").checked
      });
      // 主进程这时才创建标签，退场动画放完再撤掉引导层
      el("onboard").style.transition = "opacity .34s ease";
      el("onboard").style.opacity = "0";
      window.setTimeout(() => {
        el("onboard").hidden = true;
        delete document.body.dataset.onboarding;
      }, 340);
      await afterOnboarding();
    } catch (error) {
      button.disabled = false;
      say(errorText(error, "初始化失败，请重试。"), true);
    }
  });
};

// 引导走完才需要拉这些：之前拉了也没地方显示
const afterOnboarding = async () => {
  try {
    tabState = await shell.tabs.getState();
    renderTabs();
  } catch { /* 忽略 */ }
  // 规则先拿：renderAuth 里要用它渲染"怎么提升"，晚了那一段就是空的
  try {
    quotaRules = await shell.auth.getQuotaRules();
  } catch { /* 拿不到就不显示那一段 */ }
  void renderSiteFooter();
  // 不先画一个假的“未登录”：让隐藏授权跑完后直接落到最终状态
  void refreshAuth({ sync: true });
  void bindPreferences();
  try {
    renderCampusSettings(await shell.campusNet.getSettings());
    renderCampusState(await shell.campusNet.getState());
    renderCampusLogs(await shell.campusNet.getLogs(120));
  } catch { /* 忽略 */ }
  try {
    scriptConfig = await shell.script.getConfig();
    renderScriptConfig();
    renderScriptActivity(await shell.script.getActivity(80));
    renderScriptUpdateState(await shell.script.getUpdateState());
  } catch { /* 忽略 */ }
  try {
    renderChaoxing(await shell.chaoxing.getState());
  } catch { /* 忽略 */ }
  try {
    // 先看自动更新走到哪了；它已经在下或已下好，就不必再显示"去下载"
    renderUpdateState(await shell.update.getState());
    if (updateStage === "idle" || updateStage === "error") showUpdate(await shell.update.check());
  } catch { /* 忽略 */ }
};

/* --------------------------------------------------------------- 启动 */

const boot = async () => {
  bindChrome();
  bindAuth();
  bindCampus();
  bindChaoxing();
  bindScript();
  bindOffline();

  shell.tabs.onChange((state) => {
    const previousActive = tabState.activeId;
    tabState = state;
    renderTabs();
    const active = tabState.tabs.find((tab) => tab.id === tabState.activeId);
    if (active?.kind === "tools" && previousActive !== tabState.activeId) {
      void refreshAuth({ sync: true });
    }
  });
  shell.campusNet.onState(renderCampusState);
  // 主站登录后会静默换到新 token，这里不用轮询，等推送即可
  shell.auth.onChange?.(renderAuth);
  shell.chaoxing.onState(renderChaoxing);
  shell.campusNet.onLog(() => void shell.campusNet.getLogs(120).then(renderCampusLogs));
  shell.script.onActivity(() => void shell.script.getActivity(80).then(renderScriptActivity));
  shell.script.onUpdateState?.(renderScriptUpdateState);
  shell.update.onAvailable(showUpdate);
  shell.update.onState?.(renderUpdateState);

  let info;
  try {
    info = await shell.getBootInfo();
    if (info?.version) el("about-version").textContent = `v${info.version}`;
    el("about-product").textContent = info?.platform === "darwin"
      ? "药大拾间 macOS 客户端"
      : "药大拾间 Windows 客户端";
    offline.dataset.armed = info.siteLoaded ? "0" : "1";
    if (!info.siteLoaded && info.siteError) el("offline-reason").textContent = `无法加载主站：${info.siteError}`;
  } catch { /* 主进程还没就绪 */ }

  // 首次运行先走引导。主进程在引导完成前不会创建任何内容视图，
  // 所以引导页不会被压住；剩下的初始化留到引导结束后再做。
  if (info && !info.onboarded) {
    startOnboarding();
    return;
  }
  await afterOnboarding();
};

function showUpdate(info) {
  if (!info?.hasUpdate) return;
  // 自动更新接管后这条只在"没能自动下载"时才有意义，所以给手动下载的入口
  if (updateStage === "downloading" || updateStage === "ready") return;
  el("update-card").hidden = false;
  el("update-title").textContent = `有新版本 v${info.latest}`;
  el("update-note").textContent = "超星改版后旧版脚本可能失效，建议更新。";
  el("update-go").hidden = false;
  el("update-go").onclick = () => void shell.update.open(info.url);
}

// 自动更新：下载全程静默，界面只在这里如实反映它到哪一步了
let updateStage = "idle";

const formatMB = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

function renderUpdateState(state) {
  if (!state) return;
  updateStage = state.stage;
  const card = el("update-card");
  const track = el("update-track");

  if (state.stage === "downloading") {
    card.hidden = false;
    el("update-title").textContent = `正在下载 v${state.latest}`;
    el("update-note").textContent = state.totalBytes
      ? `${formatMB(state.receivedBytes)} / ${formatMB(state.totalBytes)}，下好后重启即可更新`
      : "下好后重启即可更新";
    el("update-go").hidden = true;
    el("update-restart").hidden = true;
    track.hidden = false;
    el("update-fill").style.width = `${state.percent}%`;
    return;
  }

  if (state.stage === "ready") {
    card.hidden = false;
    el("update-title").textContent = `v${state.latest} 已下载完成`;
    el("update-note").textContent = "退出应用时会自动装上，也可以现在就重启更新。";
    el("update-go").hidden = true;
    el("update-restart").hidden = false;
    track.hidden = true;
    el("update-restart").onclick = async () => {
      el("update-restart").disabled = true;
      say("正在重启并更新…");
      try {
        await shell.update.installNow();
      } catch (error) {
        el("update-restart").disabled = false;
        say(errorText(error, "更新启动失败。"), true);
      }
    };
    return;
  }

  if (state.stage === "error") {
    // 更新失败不该把卡片一直挂在那里吓人，下一轮会自己重试
    track.hidden = true;
    return;
  }

  track.hidden = true;
}

if (!shell) {
  document.body.textContent = "外壳桥未注入，请通过药大拾间桌面端打开。";
} else {
  void boot();
}
