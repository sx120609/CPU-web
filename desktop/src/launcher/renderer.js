// 本地启动台。只有在主站加载不出来时才会看到它 —— 校园网未认证正是这种情况，
// 所以这一页不能依赖任何网络资源。
const bridge = window.CPUDesktop;

const el = (id) => document.querySelector(`#${id}`);
const statusDot = el("status-dot");
const heroTitle = el("hero-title");
const heroDetail = el("hero-detail");
const inlineStatus = el("inline-status");
const retryButton = el("retry");
const openLearningButton = el("open-learning");
const loginButton = el("login");
const logoutButton = el("logout");
const authPill = el("auth-pill");
const accountFields = el("account-fields");
const authHint = el("auth-hint");
const authName = el("auth-name");
const authBalance = el("auth-balance");
const authExpires = el("auth-expires");
const appMeta = el("app-meta");

const TOGGLES = [
  ["launch-on-login", "launchOnLogin"],
  ["start-minimized", "startMinimized"],
  ["close-to-tray", "closeToTray"]
];

const setHero = (state, title, detail) => {
  statusDot.dataset.state = state;
  heroTitle.textContent = title;
  if (detail !== undefined) heroDetail.textContent = detail;
};

const setStatus = (message, error = false) => {
  inlineStatus.textContent = message;
  inlineStatus.dataset.error = String(error);
};

const formatDate = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Date(value).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
};

const errorText = (error, fallback) => (error instanceof Error && error.message ? error.message : fallback);

/* ------------------------------------------------------------ 连接状态 */

// 主进程把失败原因放在 query 里，直接告诉用户比让他们猜要好
const failureReason = new URLSearchParams(window.location.search).get("reason") || "";

const showDisconnected = () => {
  setHero(
    "down",
    "暂时连不上药大拾间",
    failureReason
      ? `无法加载主站：${failureReason}。常见原因是校园网尚未认证，或者当前没有网络。`
      : "常见原因是校园网尚未认证，或者当前没有网络。"
  );
};

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  setHero("busy", "正在重新连接…");
  setStatus("");
  try {
    const result = await bridge.reloadSite();
    // 连上了主进程会直接把窗口导航走，这里就不会再执行到
    if (!result?.siteLoaded) {
      showDisconnected();
      setStatus("仍然连不上，请先确认校园网已认证。", true);
    }
  } catch (error) {
    showDisconnected();
    setStatus(errorText(error, "重新连接失败。"), true);
  } finally {
    retryButton.disabled = false;
  }
});

openLearningButton.addEventListener("click", async () => {
  openLearningButton.disabled = true;
  try {
    await bridge.openLearning();
    setStatus("学习平台已在新窗口打开。");
  } catch (error) {
    setStatus(errorText(error, "无法打开学习平台。"), true);
    void refreshAuth();
  } finally {
    openLearningButton.disabled = false;
  }
});

/* ---------------------------------------------------------------- 账号 */

const renderAuth = (session) => {
  const loggedIn = Boolean(session?.loggedIn);
  authPill.textContent = loggedIn ? "已登录" : session?.expired ? "已过期" : "未登录";
  authPill.dataset.state = loggedIn ? "ok" : "off";
  accountFields.hidden = !loggedIn;
  loginButton.hidden = loggedIn;
  logoutButton.hidden = !loggedIn;

  if (!loggedIn) {
    authHint.hidden = false;
    authHint.textContent = session?.expired
      ? "上次的授权已过期（有效期 30 天），请重新登录。"
      : "登录后即可使用学习平台与校园 AI 解答。";
    return;
  }

  const user = session.user || {};
  authHint.hidden = true;
  authName.textContent = user.user || user.nickname || user.name || user.username || user.sub || "已登录用户";
  // 额度为 0 是有效信息，不能显示成"—"
  authBalance.textContent = typeof user.aiBalance === "number" ? String(user.aiBalance) : "—";
  authExpires.textContent = formatDate(session.expiresAt);
};

async function refreshAuth() {
  try {
    renderAuth(await bridge.getAuthStatus());
  } catch {
    renderAuth({ loggedIn: false });
  }
}

loginButton.addEventListener("click", async () => {
  loginButton.disabled = true;
  setStatus("已打开授权窗口，请完成登录。");
  try {
    renderAuth(await bridge.login());
    setStatus("登录成功。");
  } catch (error) {
    await refreshAuth();
    setStatus(errorText(error, "登录失败。"), true);
  } finally {
    loginButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  setStatus("正在退出登录…");
  try {
    await bridge.logout();
    renderAuth({ loggedIn: false });
    setStatus("已退出登录，授权已撤销。");
  } catch (error) {
    setStatus(errorText(error, "退出登录失败。"), true);
  } finally {
    logoutButton.disabled = false;
  }
});

/* ---------------------------------------------------------------- 设置 */

const bindToggles = async () => {
  let preferences;
  try {
    preferences = await bridge.getPreferences();
  } catch {
    return;
  }
  for (const [id, key] of TOGGLES) {
    const input = el(id);
    input.checked = Boolean(preferences[key]);
    input.addEventListener("change", async () => {
      const previous = !input.checked;
      try {
        const next = await bridge.setPreferences({ [key]: input.checked });
        input.checked = Boolean(next[key]);
        setStatus("设置已保存。");
      } catch (error) {
        input.checked = previous;
        setStatus(errorText(error, "设置保存失败。"), true);
      }
    });
  }
};

/* -------------------------------------------------------------- 校园网 */

const campus = bridge?.campusNet;
const campusPill = el("campus-pill");
const campusBody = el("campus-body");
const campusEnabled = el("campus-enabled");
const campusMode = el("campus-mode");
const campusCarrier = el("campus-carrier");
const campusCarrierField = el("campus-carrier-field");
const campusInterval = el("campus-interval");
const campusStudent = el("campus-student");
const campusPassword = el("campus-password");
const campusHint = el("campus-credential-hint");
const campusLogs = el("campus-logs");

const PILL_STATE = {
  online: "online",
  offline: "offline",
  "off-campus": "off",
  authenticating: "busy",
  paused: "paused",
  unknown: "busy",
  disabled: "off"
};

const renderCampusState = (state) => {
  if (!state) return;
  campusPill.textContent = state.message || "—";
  campusPill.dataset.state = PILL_STATE[state.status] || "off";
  campusStudent.value = campusStudent.value || state.studentId || "";
  campusHint.textContent = state.hasCredential
    ? `已保存学号 ${state.studentId} 的凭据。密码经系统安全存储加密，不会回传到界面。`
    : "密码用系统安全存储加密，只在发起认证时于后台解密，不会回传到界面。";
};

const renderCampusSettings = (settings) => {
  if (!settings) return;
  campusEnabled.checked = Boolean(settings.enabled);
  campusBody.hidden = !settings.enabled;
  campusMode.value = settings.mode || "auto";
  campusCarrier.value = settings.carrier || "";
  campusInterval.value = String(settings.intervalSec ?? 15);
  // 运营商后缀只在宽带模式下拼进账号，校园网模式下这个选择框没有意义
  campusCarrierField.hidden = settings.mode === "campus";
};

const pushCampusSettings = async (patch) => {
  try {
    renderCampusSettings(await campus.updateSettings(patch));
    setStatus("校园网设置已保存。");
  } catch (error) {
    setStatus(errorText(error, "校园网设置保存失败。"), true);
  }
};

const renderCampusLogs = (entries) => {
  campusLogs.textContent = entries
    .map((entry) => `${new Date(entry.at).toLocaleTimeString("zh-CN")}  ${entry.message}`)
    .join("\n");
  campusLogs.scrollTop = campusLogs.scrollHeight;
};

const bindCampusNet = async () => {
  if (!campus) return;

  campusEnabled.addEventListener("change", () => {
    campusBody.hidden = !campusEnabled.checked;
    void pushCampusSettings({ enabled: campusEnabled.checked });
  });
  campusMode.addEventListener("change", () => {
    campusCarrierField.hidden = campusMode.value === "campus";
    void pushCampusSettings({ mode: campusMode.value });
  });
  campusCarrier.addEventListener("change", () => void pushCampusSettings({ carrier: campusCarrier.value }));
  campusInterval.addEventListener("change", () => void pushCampusSettings({ intervalSec: Number(campusInterval.value) }));

  el("campus-save").addEventListener("click", async () => {
    const button = el("campus-save");
    button.disabled = true;
    try {
      renderCampusState(await campus.saveCredential(campusStudent.value, campusPassword.value));
      campusPassword.value = "";
      setStatus("校园网凭据已保存。");
    } catch (error) {
      setStatus(errorText(error, "保存失败。"), true);
    } finally {
      button.disabled = false;
    }
  });

  el("campus-login").addEventListener("click", async () => {
    const button = el("campus-login");
    button.disabled = true;
    setStatus("正在认证校园网…");
    try {
      const state = await campus.loginNow();
      renderCampusState(state);
      setStatus(state.message, state.status !== "online");
    } catch (error) {
      setStatus(errorText(error, "认证失败。"), true);
    } finally {
      button.disabled = false;
    }
  });

  el("campus-clear").addEventListener("click", async () => {
    const button = el("campus-clear");
    button.disabled = true;
    try {
      renderCampusState(await campus.clearCredential());
      campusStudent.value = "";
      campusPassword.value = "";
      setStatus("校园网凭据已清除。");
    } catch (error) {
      setStatus(errorText(error, "清除失败。"), true);
    } finally {
      button.disabled = false;
    }
  });

  campus.onState(renderCampusState);
  campus.onLog(() => void campus.getLogs(120).then(renderCampusLogs));

  try {
    renderCampusSettings(await campus.getSettings());
    renderCampusState(await campus.getState());
    renderCampusLogs(await campus.getLogs(120));
  } catch {
    // 拿不到就保持默认展示
  }
};

/* ---------------------------------------------------------------- 启动 */

const showAppMeta = async () => {
  try {
    const info = await bridge.getAppInfo();
    appMeta.textContent = `${info.productName} v${info.version} · ${new URL(info.origin).host}`;
  } catch {
    appMeta.textContent = "";
  }
};

if (!bridge) {
  setHero("down", "原生桥未注入", "请通过药大拾间桌面端打开本页面。");
  for (const button of document.querySelectorAll("button")) button.disabled = true;
} else {
  showDisconnected();
  void refreshAuth();
  void bindToggles();
  void bindCampusNet();
  void showAppMeta();
}
