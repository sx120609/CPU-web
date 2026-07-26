const loading = document.querySelector("#loading");
const login = document.querySelector("#login");
const account = document.querySelector("#account");
const loginButton = document.querySelector("#login-button");
const loginHint = document.querySelector("#login-hint");
const logoutButton = document.querySelector("#logout-button");
const openLearning = document.querySelector("#open-learning");
const status = document.querySelector("#status");
const userName = document.querySelector("#user-name");
const userLevel = document.querySelector("#user-level");
const userId = document.querySelector("#user-id");
const aiBalance = document.querySelector("#ai-balance");
const dailyUsage = document.querySelector("#daily-usage");
const expiresAt = document.querySelector("#expires-at");
const appMeta = document.querySelector("#app-meta");

const DEFAULT_LOGIN_HINT = "使用默认浏览器完成药大拾间授权登录，授权结果会安全返回本应用。";

const setStatus = (message, error = false) => {
  status.textContent = message;
  status.dataset.error = String(error);
};

const formatDate = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Date(value).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
};

const showLogin = (session = {}) => {
  loading.hidden = true;
  login.hidden = false;
  account.hidden = true;
  // 过期和从未登录是两回事，不说清楚用户会以为应用坏了
  loginHint.textContent = session.expired
    ? "上次的授权已过期（有效期 30 天），请重新登录。"
    : DEFAULT_LOGIN_HINT;
};

const showAccount = (session) => {
  const user = session.user || {};
  loading.hidden = true;
  login.hidden = true;
  account.hidden = false;
  userName.textContent = user.user || user.nickname || user.name || user.username || user.sub || "已登录用户";
  const levelName = user.levelName || "";
  userLevel.textContent = user.level ? `Lv.${user.level}${levelName ? ` ${levelName}` : ""}` : levelName;
  userId.textContent = user.sub || "—";
  // 额度为 0 是有效信息，不能显示成"—"
  aiBalance.textContent = typeof user.aiBalance === "number" ? String(user.aiBalance) : "—";
  dailyUsage.textContent = typeof user.dailyQuota === "number" ? `${user.usedToday || 0} / ${user.dailyQuota}` : "—";
  expiresAt.textContent = formatDate(session.expiresAt);
};

const refresh = async () => {
  try {
    const session = await window.cpuDesktopHome.getOAuthStatus();
    if (session.loggedIn) showAccount(session);
    else showLogin(session);
  } catch (error) {
    showLogin();
    setStatus(error instanceof Error ? error.message : "无法检查登录状态。", true);
  }
};

const showAppInfo = async () => {
  try {
    const info = await window.cpuDesktopHome.getAppInfo();
    appMeta.textContent = `${info.productName} v${info.version} · 账号来自 ${new URL(info.origin).host}`;
  } catch {
    appMeta.textContent = "";
  }
};

loginButton.addEventListener("click", async () => {
  loginButton.disabled = true;
  setStatus("正在打开默认浏览器，请完成授权登录。");
  try {
    showAccount(await window.cpuDesktopHome.login());
    setStatus("登录成功。");
  } catch (error) {
    showLogin();
    setStatus(error instanceof Error ? error.message : "登录失败。", true);
  } finally {
    loginButton.disabled = false;
  }
});

openLearning.addEventListener("click", async () => {
  openLearning.disabled = true;
  try {
    await window.cpuDesktopHome.openLearning();
    setStatus("学习平台已打开。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "无法打开学习平台。", true);
    void refresh();
  } finally {
    openLearning.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  setStatus("正在退出登录…");
  try {
    await window.cpuDesktopHome.logout();
    showLogin();
    setStatus("已退出登录，授权已撤销。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "退出登录失败。", true);
  } finally {
    logoutButton.disabled = false;
  }
});

void refresh();
void showAppInfo();
