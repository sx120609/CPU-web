import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from "element-plus";
import { useJwxtStore } from "@/stores/jwxt";
import { useAuthStore } from "@/stores/auth";
import { jwxtApi } from "@/api/jwxt";
import { loadCreds } from "@/utils/credCrypto";
import {
  isJwxtTabCacheStale,
  normalizeJwxtTabData,
  readLatestJwxtTabCache,
  readJwxtTabCache,
  type JwxtDataTab,
  writeJwxtTabCache,
} from "@/utils/jwxtTabCache";

export type DataTab = Exclude<JwxtDataTab, "midterm">; // 期中暂时停用；恢复时移除 Exclude。
export type JwxtTab = DataTab | "debug";

// 桌面端与移动端教务页共用的登录、会话与数据加载；两套页面只负责各自的排版。
// 移动端课表放在独立的课表页，因此由调用方声明当前布局，决定是否提供课表标签。
export function useJwxtPage(layout: "desktop" | "mobile") {
  const jwxt = useJwxtStore();
  const auth = useAuthStore();
  const route = useRoute();
  const router = useRouter();
  const formRef = ref<FormInstance>();
  const form = reactive({ username: "", password: "", captcha: "" });
  const privacyAccepted = ref(false);
  const remember = ref(false);
  const rules: FormRules = {
    username: [{ required: true, message: "请输入学号或工号" }],
    password: [{ required: true, message: "请输入密码" }],
  };
  const isGraduateIdentity = computed(() => auth.academicIdentity === "graduate");
  const showScheduleTab = layout === "desktop";
  const tab = ref<JwxtTab>(showScheduleTab ? "schedule" : "grades");
  const schedule = ref<any>(null);
  const grades = ref<any>(null);
  // const midtermGrades = ref<any>(null);
  const progress = ref<any>(null);
  const pyfa = ref<any>(null);
  const tabLoading = ref(false);
  const activeRequests = new Map<string, Promise<any>>();
  const captchaLoading = ref(false);
  const logoutBusy = ref(false);
  const forgetBusy = ref(false);
  const reauthorizeBusy = ref(false);
  const showLoginOverride = ref(false);
  const manualCredentialOverride = ref(false);
  let tabLoadSeq = 0;
  let pageInitSeq = 0;
  let disposed = false;

  const probePath = ref("/zgykdx/framework/xsMain.jsp");
  const probeHtml = ref("");
  const probing = ref(false);
  const snapping = ref(false);
  const snapResult = ref<{ saved: string[]; errors: string[] } | null>(null);

  const isDev = computed(() => import.meta.env.DEV);
  const availableDataTabs = computed<DataTab[]>(() => {
    if (isGraduateIdentity.value && !auth.academicIdentityUnavailable) {
      return showScheduleTab ? ["schedule"] : [];
    }
    return showScheduleTab
      ? ["schedule", "grades", /* "midterm", */ "progress", "pyfa"]
      : ["grades", /* "midterm", */ "progress", "pyfa"];
  });
  const hasJwxtTabs = computed(() => availableDataTabs.value.length > 0 || isDev.value);
  const hasCachedData = computed(() => availableDataTabs.value.some((item) => Boolean(getTabData(item))));
  const academicDataUnavailable = computed(() => Boolean(
    jwxt.isLoggedIn
    && auth.user?.studentSso
    && auth.academicIdentityUnavailable
    && !hasCachedData.value,
  ));
  const showDataShell = computed(() => !showLoginOverride.value && (jwxt.isLoggedIn || hasCachedData.value || academicDataUnavailable.value));
  const usingSavedCredentialRecovery = computed(() => (
    jwxt.rememberSaved && !manualCredentialOverride.value && !form.password
  ));
  const pageHintText = computed(() => (
    academicDataUnavailable.value
      ? "当前账号已通过学校登录，但教务数据尚未开通。"
      : isGraduateIdentity.value
      ? showScheduleTab
        ? "通过学校统一认证查看研究生课表，信息会整理成更方便阅读的样子。"
        : "通过学校统一认证连接研究生入口，移动端课表请使用单独课表页。"
      : showScheduleTab
        ? "通过学校统一认证查看课表、成绩和培养方案，信息会整理成更方便阅读的样子。"
        : "通过学校统一认证查看成绩和培养方案，移动端课表请使用单独课表页。"
  ));
  const loginCardHintText = computed(() => (
    showScheduleTab
      ? "登录后会自动识别你可用的教务入口。本科生会显示完整教务数据，研究生当前会直接进入课表。"
      : "登录后会自动识别你可用的教务入口。本科生会显示成绩等教务数据，课表请使用移动端单独入口。"
  ));
  const scopeTipText = computed(() => (
    showScheduleTab
      ? "登录后会根据这次实际读取到的数据自动选择可用入口，不需要手动切换。本科生默认显示完整教务，研究生当前显示课表。"
      : "登录后会根据这次实际读取到的数据自动选择可用入口。移动端课表请从单独课表入口查看。"
  ));
  const schoolSystemLink = computed(() => (
    !auth.academicIdentityResolved
      ? "http://jsxsd.cpu.edu.cn/zgykdx/tyrz.jsp"
      : isGraduateIdentity.value
        ? "http://ygl.cpu.edu.cn/gmis5/oauthLogin/zgyk"
        : "http://jsxsd.cpu.edu.cn/zgykdx/tyrz.jsp"
  ));
  const schoolSystemLabel = computed(() => (
    !auth.academicIdentityResolved
      ? "前往学校统一认证原站"
      : isGraduateIdentity.value ? "前往研究生管理系统原站" : "前往学校教务系统原站"
  ));
  const sessionSubText = computed(() => {
    if (!jwxt.isLoggedIn) {
      if (jwxt.needCaptcha) return "上次缓存仍可查看；补充验证码后会继续静默更新。";
      if (jwxt.rememberSaved) return "上次缓存仍可查看，系统正在后台恢复教务连接。";
      return "上次缓存仍可查看；需要时可重新授权更新数据。";
    }
    if (auth.academicIdentityUnavailable && hasCachedData.value) {
      return "学校教务暂时未返回可用数据，已显示上次缓存，系统会在后台自动恢复。";
    }
    if (auth.academicIdentityDetecting && !auth.academicIdentityResolved) {
      return "正在识别当前账号可用的教务入口…";
    }
    if (isGraduateIdentity.value && !showScheduleTab) {
      return "已自动识别到研究生入口，课表请从移动端独立课表页查看。";
    }
    return isGraduateIdentity.value
      ? "已自动识别到研究生课表入口。"
      : "已自动识别到本科教务入口。";
  });
  const sessionTitleText = computed(() => (
    jwxt.isLoggedIn ? "已连接学校教务系统" : "已打开上次教务缓存"
  ));
  const identityBadgeText = computed(() => (
    isGraduateIdentity.value ? "自动识别：研究生课表" : "自动识别：本科教务"
  ));

  onMounted(() => {
    disposed = false;
    jwxt.hydrate();
    ensureVisibleTab();
    restoreAllTabCaches();
    if (jwxt.isLoggedIn || hasCachedData.value) void loadCurrentTab(false);
    window.addEventListener("cpu-native-refresh", onNativeRefresh);
    void initPage();
  });

  onBeforeUnmount(() => {
    disposed = true;
    pageInitSeq += 1;
    tabLoadSeq += 1;
    activeRequests.clear();
    window.removeEventListener("cpu-native-refresh", onNativeRefresh);
  });

  function onNativeRefresh() {
    // The native shell marks the event before dispatching it. Setting the flag
    // here makes the handler self-identifying for older bridge versions too.
    (window as any).__cpuNativeRefreshHandled = true;
    void loadCurrentTab(true);
  }

  async function initPage() {
    const seq = ++pageInitSeq;
    if (!auth.ready) await auth.fetchMe({ probe: true }).catch(() => undefined);
    if (disposed || seq !== pageInitSeq) return;
    jwxt.hydrate();
    ensureVisibleTab();
    restoreAllTabCaches();
    if (route.query.reauthorize === "1") {
      await onManualReauthorize();
      return;
    }
    if (jwxt.isLoggedIn || hasCachedData.value) void loadCurrentTab(false);
    const ready = await jwxt.ensureSession({
      refresh: true,
      silent: true,
      allowAutoLogin: true,
      repairUnavailableSession: true,
    });
    if (disposed || seq !== pageInitSeq || !ready) return;
    ensureVisibleTab();
    showLoginOverride.value = false;
    loadCurrentTab(false);
  }

  watch(() => auth.academicIdentity, async (next, prev) => {
    if (!next || next === prev) return;
    ensureVisibleTab();
    resetTabData();
    restoreAllTabCaches();
    if (jwxt.isLoggedIn) {
      await loadCurrentTab(false);
    }
  });

  function firstVisibleTab(): JwxtTab {
    const firstDataTab = availableDataTabs.value[0];
    if (firstDataTab) return firstDataTab;
    return isDev.value ? "debug" : "schedule";
  }

  function ensureVisibleTab() {
    if (tab.value === "debug") {
      if (!isDev.value) tab.value = firstVisibleTab();
      return;
    }
    if (!availableDataTabs.value.includes(tab.value as DataTab)) {
      tab.value = firstVisibleTab();
    }
  }

  function getTabData(t: DataTab) {
    if (t === "schedule") return schedule.value;
    if (t === "grades") return grades.value;
    // if (t === "midterm") return midtermGrades.value;
    if (t === "progress") return progress.value;
    return pyfa.value;
  }

  function setTabData(t: DataTab, data: any) {
    const normalized = normalizeJwxtTabData(t, data);
    if (t === "schedule") schedule.value = normalized;
    else if (t === "grades") grades.value = normalized;
    // else if (t === "midterm") midtermGrades.value = normalized;
    else if (t === "progress") progress.value = normalized;
    else pyfa.value = normalized;
  }

  function restoreCachedTab(t: DataTab) {
    const direct = readJwxtTabCache(t, auth.academicIdentity);
    const cached = direct ?? readLatestJwxtTabCache(t, [
      auth.academicIdentity,
      "undergraduate",
      "graduate",
    ])?.envelope ?? null;
    if (!cached?.data) return null;
    if (!getTabData(t)) setTabData(t, cached.data);
    return cached;
  }

  function restoreAllTabCaches() {
    availableDataTabs.value.forEach((t) => restoreCachedTab(t));
  }

  function resetTabData() {
    schedule.value = null;
    grades.value = null;
    // midtermGrades.value = null;
    progress.value = null;
    pyfa.value = null;
  }

  function fetchTab(t: DataTab, identity: string = auth.academicIdentity, options?: { silent?: boolean }) {
    const requestId = `${identity}:${t}`;
    if (activeRequests.has(requestId)) return activeRequests.get(requestId)!;
    const request = jwxt.withSessionRetry(async () => {
      const silentOptions = options?.silent ? { silent: true } : undefined;
      if (identity === "graduate") {
        if (t === "schedule") return jwxtApi.graduateSchedule(undefined, silentOptions);
        throw new Error("研究生入口当前先支持课表，请直接查看课表。");
      }
      if (t === "schedule") return jwxtApi.schedule(undefined, silentOptions);
      if (t === "grades") return jwxtApi.grades(undefined, silentOptions);
      // if (t === "midterm") return jwxtApi.midtermGrades(undefined, silentOptions);
      if (t === "progress") return jwxtApi.progress(silentOptions);
      return jwxtApi.pyfa(silentOptions);
    });
    activeRequests.set(requestId, request);
    request.then(
      () => activeRequests.delete(requestId),
      () => activeRequests.delete(requestId)
    );
    return request;
  }

  async function refreshTabInBackground(t: DataTab, identity: string, seq: number) {
    try {
      const data = await fetchTab(t, identity, { silent: true });
      writeJwxtTabCache(t, identity, data);
      if (!disposed && identity === auth.academicIdentity && tab.value === t) {
        setTabData(t, data);
      }
    } catch {
      /* Keep cached data visible when background refresh fails. */
    } finally {
      if (!disposed && seq === tabLoadSeq && identity === auth.academicIdentity && tab.value === t) {
        tabLoading.value = false;
      }
    }
  }

  async function reloadCaptcha() {
    if (captchaLoading.value || jwxt.loading) return;
    captchaLoading.value = true;
    try {
      await jwxt.beginLogin();
      if (disposed) return;
      form.captcha = "";
    } catch {
      if (!disposed) ElMessage.error("验证码刷新失败，请稍后再试");
    } finally {
      if (!disposed) captchaLoading.value = false;
    }
  }

  async function onSubmit() {
    if (!privacyAccepted.value) {
      ElMessage.warning("请先阅读并主动勾选同意隐私政策和用户协议");
      return;
    }
    if (jwxt.loading || captchaLoading.value) return;
    if (!usingSavedCredentialRecovery.value) {
      try { await formRef.value?.validate(); } catch { return; }
    }
    if (jwxt.needCaptcha && !form.captcha) { ElMessage.warning("请输入验证码"); return; }
    if (!jwxt.needCaptcha) {
      // 手动提交前始终换一份新的 execution，避免它被后台自动恢复或长时间停留的表单提前消耗。
      try {
        await jwxt.beginLogin();
      } catch {
        return;
      }
      if (jwxt.needCaptcha) {
        form.captcha = "";
        ElMessage.info("统一认证要求补充验证码，请输入后继续");
        return;
      }
    }
    const saved = usingSavedCredentialRecovery.value ? await loadCreds().catch(() => null) : null;
    if (usingSavedCredentialRecovery.value && !saved) {
      ElMessage.warning("未找到已保存的登录信息，请重新输入账号密码");
      jwxt.forgetSavedCreds();
      manualCredentialOverride.value = true;
      return;
    }
    let ok = false;
    try {
      ok = await jwxt.submitLogin(
        saved?.username || form.username,
        saved?.password || form.password,
        form.captcha || undefined,
        remember.value,
      );
    } catch {
      return;
    } finally {
      form.password = ""; // 立刻清掉密码字段
    }
    if (disposed) return;
    if (ok) {
      ElMessage.success("登录成功");
      showLoginOverride.value = false;
      manualCredentialOverride.value = false;
      const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "";
      if (redirect.startsWith("/") && !redirect.startsWith("//")) {
        await router.replace(redirect);
      } else {
        loadCurrentTab(false);
      }
    } else if (jwxt.needCaptcha) {
      form.captcha = "";
    }
  }

  async function onLogout() {
    if (logoutBusy.value || forgetBusy.value) return;
    const confirmed = await ElMessageBox.confirm("断开当前教务连接？\n如果勾选了“记住登录信息”，下次打开时仍可快速登录。", "确认", { type: "warning" })
      .then(() => true)
      .catch(() => false);
    if (!confirmed) return;
    logoutBusy.value = true;
    try {
      await jwxt.logout();
      ElMessage.success("已断开教务连接");
      resetTabData();
      tab.value = firstVisibleTab();
      try {
        await jwxt.beginLogin();
      } catch {
        if (!disposed) ElMessage.error("登录准备失败，请刷新页面后重试");
      }
    } finally {
      if (!disposed) logoutBusy.value = false;
    }
  }

  async function onForget() {
    if (forgetBusy.value || logoutBusy.value) return;
    const confirmed = await ElMessageBox.confirm("清除已保存的账号？之后将不再自动登录。", "确认", { type: "warning" })
      .then(() => true)
      .catch(() => false);
    if (!confirmed) return;
    forgetBusy.value = true;
    try {
      jwxt.forgetSavedCreds();
      manualCredentialOverride.value = true;
      ElMessage.success("已清除保存的账号");
    } finally {
      forgetBusy.value = false;
    }
  }

  async function loadCurrentTab(force = false) {
    if (disposed) return;
    ensureVisibleTab();
    if (tab.value === "debug") return;
    if (!availableDataTabs.value.includes(tab.value as DataTab)) return;
    const current = tab.value as DataTab;
    const identity = auth.academicIdentity;
    const cached = restoreCachedTab(current);
    if (cached && !force && !isJwxtTabCacheStale(cached.savedAt)) {
      const seq = ++tabLoadSeq;
      tabLoading.value = true;
      void refreshTabInBackground(current, identity, seq);
      return;
    }
    const seq = ++tabLoadSeq;
    tabLoading.value = force || Boolean(cached) || !getTabData(current);
    try {
      const data = await fetchTab(current, identity);
      if (disposed || identity !== auth.academicIdentity || current !== tab.value) return;
      setTabData(current, data);
      writeJwxtTabCache(current, auth.academicIdentity, data);
    } catch {
      // 已有缓存时保留旧数据；错误提示由 API 拦截器统一处理。
    } finally {
      if (!disposed && seq === tabLoadSeq) tabLoading.value = false;
    }
  }

  function onTabChange() { loadCurrentTab(false); }

  async function onSnapshot() {
    if (snapping.value) return;
    snapping.value = true;
    try { snapResult.value = await jwxtApi.debugSnapshot(); }
    finally { snapping.value = false; }
  }

  async function onProbe() {
    if (probing.value) return;
    if (!probePath.value.startsWith("/")) { ElMessage.warning("path 必须以 / 开头"); return; }
    probing.value = true;
    try {
      const r = await jwxtApi.probe(probePath.value);
      probeHtml.value = r.html.length > 30000 ? r.html.slice(0, 30000) + "\n\n...（已截断）" : r.html;
    } finally { probing.value = false; }
  }

  async function onManualReauthorize() {
    if (reauthorizeBusy.value || jwxt.loading) return;
    reauthorizeBusy.value = true;
    showLoginOverride.value = false;
    manualCredentialOverride.value = false;
    try {
      const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "";
      const nextQuery = { ...route.query };
      delete nextQuery.reauthorize;
      await router.replace({ query: nextQuery });
      const result = await jwxt.retryAuthorization({ silent: true });
      if (disposed) return;
      if (result === "restored") {
        ElMessage.success("已使用保存的登录信息恢复教务连接");
        if (redirect.startsWith("/") && !redirect.startsWith("//")) {
          await router.replace(redirect);
        } else {
          loadCurrentTab(true);
        }
        return;
      }
      showLoginOverride.value = true;
      if (!form.username && auth.user?.username) form.username = auth.user.username;
      if (result === "saved-captcha") {
        ElMessage.info("学校要求验证码；保存的账号密码已读取，只需输入验证码");
      } else if (jwxt.rememberSaved) {
        ElMessage.warning("自动恢复未成功，可再次使用已保存信息重试，或改用账号密码");
      } else {
        ElMessage.info("请重新完成学校统一身份认证");
      }
    } catch {
      showLoginOverride.value = true;
      manualCredentialOverride.value = !jwxt.rememberSaved;
      if (!form.username && auth.user?.username) form.username = auth.user.username;
      ElMessage.error("重新授权准备失败，请稍后再试");
    } finally {
      reauthorizeBusy.value = false;
    }
  }

  function useManualCredentials() {
    manualCredentialOverride.value = true;
    if (!form.username && auth.user?.username) form.username = auth.user.username;
    form.password = "";
  }

  return {
    jwxt,
    auth,
    formRef,
    form,
    rules,
    privacyAccepted,
    remember,
    isGraduateIdentity,
    tab,
    schedule,
    grades,
    progress,
    pyfa,
    tabLoading,
    captchaLoading,
    logoutBusy,
    forgetBusy,
    reauthorizeBusy,
    probePath,
    probeHtml,
    probing,
    snapping,
    snapResult,
    isDev,
    availableDataTabs,
    hasJwxtTabs,
    academicDataUnavailable,
    showDataShell,
    usingSavedCredentialRecovery,
    pageHintText,
    loginCardHintText,
    scopeTipText,
    schoolSystemLink,
    schoolSystemLabel,
    sessionSubText,
    sessionTitleText,
    identityBadgeText,
    reloadCaptcha,
    onSubmit,
    onLogout,
    onForget,
    onTabChange,
    onSnapshot,
    onProbe,
    onManualReauthorize,
    useManualCredentials,
  };
}
