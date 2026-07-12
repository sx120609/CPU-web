<template>
  <div class="jwxt-page">
    <div class="page-head" :class="{ centered: !jwxt.isLoggedIn }">
      <h2>🎓 教务数据</h2>
      <p class="hint">
        {{ pageHintText }}
        学号 / 工号仅用于关联站内账号；勾选保持登录后，<b>学校密码会加密保存在当前浏览器</b>，验证码不会保存。
      </p>
    </div>

    <!-- 适用范围提示（未授权时显示，避免对已登录的本科生造成视觉噪音） -->
    <el-alert
      v-if="!jwxt.isLoggedIn"
      type="info"
      :closable="false"
      show-icon
      class="scope-tip"
    >
      <template #title>
        {{ scopeTipText }}
      </template>
    </el-alert>

    <!-- 未登录：显示登录卡片 -->
    <div v-if="!jwxt.isLoggedIn" class="cpu-card login-card">
      <div class="login-head">
        <el-icon class="lock-icon"><Lock /></el-icon>
        <div>
          <h3>授权读取教务数据</h3>
          <p>{{ loginCardHintText }}</p>
        </div>
      </div>

      <el-alert
        type="warning"
        :closable="false"
        title="安全告知"
        show-icon
      >
        <ul class="safety">
          <li>学号 / 工号会用于创建或关联站内账号</li>
          <li>勾选保持登录后，学校密码会加密保存在当前浏览器；验证码不会保存</li>
        </ul>
      </el-alert>

      <el-form
        :model="form"
        :rules="rules"
        ref="formRef"
        label-position="top"
        autocomplete="on"
        @submit.prevent="onSubmit"
        size="large"
        class="form"
      >
        <el-form-item label="学号 / 工号" prop="username">
          <el-input v-model="form.username" name="username" placeholder="学号 / 工号" autocomplete="username" :disabled="jwxt.loading">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" name="password" type="password" show-password placeholder="统一认证密码" autocomplete="current-password" :disabled="jwxt.loading">
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="jwxt.needCaptcha" label="验证码" prop="captcha">
          <div class="vcode-row">
            <el-input v-model="form.captcha" placeholder="看图输入" maxlength="8" class="vcode-input" :disabled="jwxt.loading || captchaLoading" />
            <div class="vcode-side">
              <button v-if="jwxt.captchaImage" type="button" class="vcode-img-button" :disabled="jwxt.loading || captchaLoading" @click="reloadCaptcha">
                <img :src="jwxt.captchaImage" alt="captcha" class="vcode-img" loading="lazy" decoding="async" fetchpriority="low" :title="'点击换一张'" />
              </button>
              <el-button text class="vcode-refresh" :loading="captchaLoading" :disabled="jwxt.loading || captchaLoading" @click="reloadCaptcha"><el-icon><Refresh /></el-icon></el-button>
            </div>
          </div>
        </el-form-item>

        <el-form-item>
          <div class="remember-row">
            <div class="remember-main">
              <el-checkbox v-model="remember">
                保持登录状态并保存到本浏览器
              </el-checkbox>
              <el-tooltip placement="top">
                <template #content>
                  勾选后会在当前浏览器加密保存学校账号密码，<br/>
                  用于会话过期后自动重新登录。<br/>
                  共享电脑请不要勾选。
                </template>
                <el-icon class="hint-icon"><InfoFilled /></el-icon>
              </el-tooltip>
            </div>
            <el-button v-if="jwxt.rememberSaved" text type="danger" size="small" class="forget-saved-btn" :loading="forgetBusy" :disabled="jwxt.loading || forgetBusy" @click="onForget">
              忘记已保存账号
            </el-button>
          </div>
        </el-form-item>

        <el-form-item v-if="jwxt.error">
          <el-alert :title="jwxt.error" type="error" :closable="false" show-icon />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" native-type="submit" :loading="jwxt.loading" :disabled="jwxt.loading || captchaLoading" class="btn-submit">
            登录并查看
          </el-button>
        </el-form-item>
      </el-form>

      <PrivacyPolicyNotice />

      <div class="alt-link">
        暂不授权？也可以 <a :href="schoolSystemLink" target="_blank" rel="noopener noreferrer">{{ schoolSystemLabel }}</a>
      </div>
    </div>

    <!-- 已登录：功能 Tab -->
    <div v-else class="jwxt-shell">
      <div class="cpu-card session-info">
        <div class="session-main">
          <el-icon class="session-ok"><CircleCheckFilled /></el-icon>
          <div class="session-copy">
            <div class="session-title">已连接学校教务系统</div>
            <div class="session-sub">{{ sessionSubText }}</div>
            <el-tag class="session-mode" size="small" effect="plain" type="success">{{ identityBadgeText }}</el-tag>
          </div>
        </div>
        <div class="session-actions">
          <el-tag v-if="jwxt.rememberSaved" size="small" type="warning" class="remember-tag">
            已保存登录信息
          </el-tag>
          <el-button v-if="jwxt.rememberSaved" plain type="warning" size="small" :loading="forgetBusy" :disabled="logoutBusy || forgetBusy" @click="onForget">
            清除已保存信息
          </el-button>
          <el-button plain type="danger" size="small" :loading="logoutBusy" :disabled="logoutBusy || forgetBusy" @click="onLogout">
            <el-icon><CircleClose /></el-icon> 断开连接
          </el-button>
        </div>
      </div>

      <el-tabs v-if="hasJwxtTabs" v-model="tab" class="cpu-card jwxt-tabs" @tab-change="onTabChange">
        <el-tab-pane v-if="showScheduleTab" label="📅 课表" name="schedule">
          <SchedulePane :data="schedule" :loading="tabLoading" :source="isGraduateIdentity ? 'graduate' : 'jwxt'" />
        </el-tab-pane>
        <el-tab-pane v-if="!isGraduateIdentity" label="📊 成绩" name="grades">
          <GradesPane :data="grades" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane v-if="!isGraduateIdentity" label="📝 期中成绩" name="midterm">
          <MidtermGradesPane :data="midtermGrades" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane v-if="!isGraduateIdentity" label="🎓 学业完成情况" name="progress">
          <ProgressPane :data="progress" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane v-if="!isGraduateIdentity" label="📖 培养方案" name="pyfa">
          <PyfaPane :data="pyfa" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane label="🛠 调试" name="debug" v-if="isDev">
          <div class="debug-pane">
            <p class="cpu-muted">开发模式：点击「拉取调试快照」后端会把教务页面 HTML 落到 <code>server/.debug/</code>，供解析器开发用。</p>
            <el-button type="primary" :loading="snapping" :disabled="snapping" @click="onSnapshot">📸 拉取调试快照</el-button>
            <ul v-if="snapResult?.saved?.length" class="snap-list">
              <li v-for="s in snapResult.saved" :key="s">✅ {{ s }}</li>
              <li v-for="e in snapResult.errors" :key="e" style="color:#dc2626">❌ {{ e }}</li>
            </ul>
            <el-divider />
            <p class="cpu-muted">自定义路径探针（仅 dev）：</p>
            <div class="probe-row">
              <el-input v-model="probePath" placeholder="例如 /jsxsd/xskb/xskb_list.do?xnxqid=2024-2025-2-1" :disabled="probing" />
              <el-button @click="onProbe" :loading="probing" :disabled="probing">GET</el-button>
            </div>
            <el-input v-if="probeHtml" v-model="probeHtml" type="textarea" :rows="14" readonly style="margin-top:8px;font-family:monospace" />
          </div>
        </el-tab-pane>
      </el-tabs>
      <div v-else class="cpu-card mobile-schedule-hint">
        <div>
          <h3>移动端课表已放到单独入口</h3>
          <p>当前账号已连接教务系统。请从底部「课表」入口查看课表。</p>
        </div>
        <RouterLink class="mobile-schedule-link" to="/schedule">打开课表</RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, computed, watch } from "vue";
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from "element-plus";
import { Lock, User, Refresh, CircleCheckFilled, CircleClose, InfoFilled } from "@element-plus/icons-vue";
import { useJwxtStore } from "@/stores/jwxt";
import { useAuthStore } from "@/stores/auth";
import { jwxtApi } from "@/api/jwxt";
import {
  isJwxtTabCacheStale,
  normalizeJwxtTabData,
  readJwxtTabCache,
  type JwxtDataTab,
  writeJwxtTabCache,
} from "@/utils/jwxtTabCache";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";
import SchedulePane from "@/components/jwxt/SchedulePane.vue";
import GradesPane from "@/components/jwxt/GradesPane.vue";
import MidtermGradesPane from "@/components/jwxt/MidtermGradesPane.vue";
import ProgressPane from "@/components/jwxt/ProgressPane.vue";
import PyfaPane from "@/components/jwxt/PyfaPane.vue";

const jwxt = useJwxtStore();
const auth = useAuthStore();
const formRef = ref<FormInstance>();
const form = reactive({ username: "", password: "", captcha: "" });
const remember = ref(true); // 默认勾选"记住"
const rules: FormRules = {
  username: [{ required: true, message: "请输入学号或工号" }],
  password: [{ required: true, message: "请输入密码" }],
};
const isGraduateIdentity = computed(() => auth.academicIdentity === "graduate");
type DataTab = JwxtDataTab;
type JwxtTab = DataTab | "debug";
const isMobileViewport = ref(typeof window !== "undefined" ? window.matchMedia("(max-width: 768px)").matches : false);
const tab = ref<JwxtTab>(isMobileViewport.value ? "grades" : "schedule");
const schedule = ref<any>(null);
const grades = ref<any>(null);
const midtermGrades = ref<any>(null);
const progress = ref<any>(null);
const pyfa = ref<any>(null);
const tabLoading = ref(false);
const activeRequests = new Map<string, Promise<any>>();
const captchaLoading = ref(false);
const logoutBusy = ref(false);
const forgetBusy = ref(false);
let tabLoadSeq = 0;
let pageInitSeq = 0;
let disposed = false;
let mobileViewportMedia: MediaQueryList | null = null;
let cleanupMobileViewportWatcher: (() => void) | null = null;

const probePath = ref("/zgykdx/framework/xsMain.jsp");
const probeHtml = ref("");
const probing = ref(false);
const snapping = ref(false);
const snapResult = ref<{ saved: string[]; errors: string[] } | null>(null);

const isDev = computed(() => import.meta.env.DEV);
const showScheduleTab = computed(() => !isMobileViewport.value);
const availableDataTabs = computed<DataTab[]>(() => {
  if (isGraduateIdentity.value) {
    return showScheduleTab.value ? ["schedule"] : [];
  }
  return showScheduleTab.value
    ? ["schedule", "grades", "midterm", "progress", "pyfa"]
    : ["grades", "midterm", "progress", "pyfa"];
});
const hasJwxtTabs = computed(() => availableDataTabs.value.length > 0 || isDev.value);
const pageHintText = computed(() => (
  isGraduateIdentity.value
    ? showScheduleTab.value
      ? "通过学校统一认证查看研究生课表，信息会整理成更方便阅读的样子。"
      : "通过学校统一认证连接研究生入口，移动端课表请使用单独课表页。"
    : showScheduleTab.value
      ? "通过学校统一认证查看课表、成绩和培养方案，信息会整理成更方便阅读的样子。"
      : "通过学校统一认证查看成绩和培养方案，移动端课表请使用单独课表页。"
));
const loginCardHintText = computed(() => (
  showScheduleTab.value
    ? "登录后会自动识别你可用的教务入口。本科生会显示完整教务数据，研究生当前会直接进入课表。"
    : "登录后会自动识别你可用的教务入口。本科生会显示成绩等教务数据，课表请使用移动端单独入口。"
));
const scopeTipText = computed(() => (
  showScheduleTab.value
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
  if (auth.academicIdentityDetecting && !auth.academicIdentityResolved) {
    return "正在识别当前账号可用的教务入口…";
  }
  if (isGraduateIdentity.value && !showScheduleTab.value) {
    return "已自动识别到研究生入口，课表请从移动端独立课表页查看。";
  }
  return isGraduateIdentity.value
    ? "已自动识别到研究生课表入口。"
    : "已自动识别到本科教务入口。";
});
const identityBadgeText = computed(() => (
  isGraduateIdentity.value ? "自动识别：研究生课表" : "自动识别：本科教务"
));

onMounted(() => {
  disposed = false;
  setupMobileViewportWatcher();
  void initPage();
});

onBeforeUnmount(() => {
  disposed = true;
  pageInitSeq += 1;
  tabLoadSeq += 1;
  activeRequests.clear();
  cleanupMobileViewportWatcher?.();
  cleanupMobileViewportWatcher = null;
  mobileViewportMedia = null;
});

async function initPage() {
  const seq = ++pageInitSeq;
  jwxt.hydrate();
  ensureVisibleTab();
  restoreAllTabCaches();
  await jwxt.refreshStatus();
  if (disposed || seq !== pageInitSeq) return;
  ensureVisibleTab();
  if (!jwxt.isLoggedIn) {
    // 1. 先尝试自动登录（用本地保存的账号）
    if (jwxt.rememberSaved) {
      ElMessage.info("正在尝试自动登录…");
      const ok = await jwxt.tryAutoLogin();
      if (disposed || seq !== pageInitSeq) return;
      if (ok) {
        ElMessage.success("已完成登录");
        loadCurrentTab(true);
        return;
      }
      // 失败：保留 captcha / error 的状态以便用户手动补
    }
    // 2. 准备登录页（拿 lt/execution + 可能的验证码）
    try { await jwxt.beginLogin(); } catch { /* ignore */ }
    if (disposed || seq !== pageInitSeq) return;
  } else {
    loadCurrentTab(true);
  }
}

watch(() => auth.academicIdentity, async (next, prev) => {
  if (!next || next === prev) return;
  ensureVisibleTab();
  resetTabData();
  restoreAllTabCaches();
  if (jwxt.isLoggedIn) {
    await loadCurrentTab(true);
  }
});

watch(showScheduleTab, async () => {
  ensureVisibleTab();
  restoreAllTabCaches();
  if (jwxt.isLoggedIn) {
    await loadCurrentTab(false);
  }
});

function setupMobileViewportWatcher() {
  if (typeof window === "undefined" || cleanupMobileViewportWatcher) return;
  mobileViewportMedia = window.matchMedia("(max-width: 768px)");
  const syncViewport = (event?: MediaQueryListEvent) => {
    isMobileViewport.value = event?.matches ?? Boolean(mobileViewportMedia?.matches);
  };
  syncViewport();
  mobileViewportMedia.addEventListener("change", syncViewport);
  cleanupMobileViewportWatcher = () => {
    mobileViewportMedia?.removeEventListener("change", syncViewport);
  };
}

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
  if (t === "midterm") return midtermGrades.value;
  if (t === "progress") return progress.value;
  return pyfa.value;
}

function setTabData(t: DataTab, data: any) {
  const normalized = normalizeJwxtTabData(t, data);
  if (t === "schedule") schedule.value = normalized;
  else if (t === "grades") grades.value = normalized;
  else if (t === "midterm") midtermGrades.value = normalized;
  else if (t === "progress") progress.value = normalized;
  else pyfa.value = normalized;
}

function restoreCachedTab(t: DataTab) {
  const cached = readJwxtTabCache(t, auth.academicIdentity);
  if (!cached?.data) return null;
  if (!getTabData(t)) setTabData(t, cached.data);
  return cached;
}

function normalizeTabData(t: DataTab, data: any) {
  if (!["grades", "midterm"].includes(t) || !data?.parsed?.list || !Array.isArray(data.parsed.list)) return data;
  const levelMap: Record<string, number> = {
    优秀: 4.5, 优: 4.5,
    良好: 3.5, 良: 3.5,
    中等: 2.5, 中: 2.5,
    及格: 1.5, 合格: 1.5, 通过: 1.5,
    不及格: 0, 不合格: 0, 不通过: 0, 未通过: 0,
  };
  const scoreToGpa = (score?: string) => {
    const raw = String(score ?? "").trim();
    if (!raw) return undefined;
    const level = raw.replace(/\s+/g, "");
    if (Object.prototype.hasOwnProperty.call(levelMap, level)) return levelMap[level];
    const scoreNum = parseFloat(raw);
    if (!Number.isFinite(scoreNum)) return undefined;
    if (scoreNum < 60) return 0;
    const gpa = (scoreNum - 50) / 10;
    return Math.min(5, Math.max(0, Math.round(gpa * 100) / 100));
  };
  return {
    ...data,
    parsed: {
      ...data.parsed,
      list: data.parsed.list.map((row: any) => {
        const gpa = typeof row.gpa === "number" ? row.gpa : Number(row.gpa);
        return Number.isFinite(gpa) ? { ...row, gpa } : { ...row, gpa: scoreToGpa(row.score) };
      }),
    },
  };
}

function restoreAllTabCaches() {
  availableDataTabs.value.forEach((t) => restoreCachedTab(t));
}

function resetTabData() {
  schedule.value = null;
  grades.value = null;
  midtermGrades.value = null;
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
    if (t === "midterm") return jwxtApi.midtermGrades(undefined, silentOptions);
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

async function refreshTabInBackground(t: DataTab, identity: string) {
  try {
    const data = await fetchTab(t, identity, { silent: true });
    writeJwxtTabCache(t, identity, data);
    if (!disposed && identity === auth.academicIdentity && tab.value === t) {
      setTabData(t, data);
    }
  } catch {
    /* Keep cached data visible when background refresh fails. */
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
  if (jwxt.loading || captchaLoading.value) return;
  try { await formRef.value?.validate(); } catch { return; }
  if (jwxt.needCaptcha && !form.captcha) { ElMessage.warning("请输入验证码"); return; }
  let ok = false;
  try {
    ok = await jwxt.submitLogin(
      form.username,
      form.password,
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
    loadCurrentTab();
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
    void refreshTabInBackground(current, identity);
    return;
  }
  const seq = ++tabLoadSeq;
  tabLoading.value = force || !getTabData(current);
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
</script>

<style scoped lang="scss">
.jwxt-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.page-head {
  width: 100%;
}

.page-head.centered {
  max-width: 760px;
  margin: 0 auto;
  text-align: center;
}

.page-head h2 { margin: 0; font-size: 22px; }
.page-head .hint { font-size: 13px; color: var(--cpu-text-secondary); margin: 6px 0 0; line-height: 1.7; }
.page-head .hint b { color: #b45309; }
.scope-tip {
  max-width: 760px;
  margin: 0 auto;
}
.jwxt-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cpu-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 20px 24px;
  box-shadow: var(--cpu-shadow-sm);
}

.login-card {
  width: min(100%, 620px);
  margin: 0 auto;
  padding: 24px 28px;
}

.login-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.lock-icon {
  font-size: 32px;
  background: linear-gradient(135deg, var(--cpu-primary), var(--cpu-primary-dark));
  color: #fff;
  padding: 12px;
  border-radius: 12px;
}
.login-head h3 { margin: 0; font-size: 17px; }
.login-head p { margin: 2px 0 0; font-size: 12px; color: var(--cpu-text-secondary); }
.login-head b { color: var(--cpu-primary); }

.safety { padding-left: 20px; margin: 4px 0 0; line-height: 1.7; font-size: 12px; }
.safety li b { color: #b45309; }

.form { margin-top: 16px; }
.btn-submit { width: 100%; letter-spacing: 4px; }
.remember-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.remember-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.forget-saved-btn {
  margin-left: auto;
}

.vcode-row { display: flex; gap: 8px; align-items: center; }
.vcode-input {
  flex: 1;
  min-width: 0;
}
.vcode-side {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.vcode-img-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.vcode-img-button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}
.vcode-img-button:focus-visible {
  outline: 2px solid rgba(22, 135, 118, 0.35);
  outline-offset: 2px;
}
.vcode-img {
  height: 36px;
  border-radius: 4px;
  border: 1px solid var(--cpu-border-soft);
  display: block;
}
.vcode-refresh {
  flex-shrink: 0;
}

.alt-link {
  margin-top: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--cpu-text-muted);
}
.alt-link a { color: var(--cpu-primary); margin-left: 4px; }

.session-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  font-size: 13px;
  color: #166534;
  background: #ecfdf5 !important;
  border: 1px solid #cdecdc;
}
:global(html[data-theme="dark"]) .session-info {
  color: #bbf7d0;
  background: rgba(20, 83, 45, 0.22) !important;
  border-color: rgba(34, 197, 94, 0.28);
}
.session-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.session-ok {
  color: #16a34a;
  font-size: 20px;
  flex-shrink: 0;
}
.session-copy {
  min-width: 0;
}
.session-title {
  font-weight: 600;
  color: #14532d;
}
:global(html[data-theme="dark"]) .session-title {
  color: #dcfce7;
}
.session-sub {
  margin-top: 2px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}
.session-mode {
  margin-top: 10px;
}
.session-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.remember-tag {
  margin-right: 0;
}
.hint-icon { color: var(--cpu-text-secondary); cursor: help; margin-left: 4px; }

.debug-pane { padding: 8px 0; }
.probe-row {
  display: flex;
  gap: 8px;
}
.snap-list { font-size: 12px; color: var(--cpu-text-secondary); list-style: none; padding: 0; margin: 10px 0; }
.snap-list li { padding: 2px 0; font-family: monospace; }
.cpu-muted { font-size: 12px; color: var(--cpu-text-muted); }
.mobile-schedule-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-color: rgba(20, 184, 166, 0.2);
  background: linear-gradient(180deg, rgba(20, 184, 166, 0.08), var(--cpu-card) 62%);
}
.mobile-schedule-hint h3 {
  margin: 0;
  font-size: 16px;
  color: var(--cpu-text);
}
.mobile-schedule-hint p {
  margin: 6px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}
.mobile-schedule-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  background: var(--cpu-primary);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  box-shadow: 0 8px 18px rgba(0, 150, 136, 0.16);
}
.mobile-schedule-link:focus-visible {
  outline: 2px solid rgba(0, 150, 136, 0.35);
  outline-offset: 3px;
}

@media (max-width: 700px) {
  .jwxt-page {
    gap: 14px;
  }

  .page-head h2 {
    font-size: 20px;
  }

  .cpu-card {
    border-radius: 10px;
    padding: 14px;
  }

  .jwxt-shell {
    gap: 12px;
  }

  .jwxt-tabs {
    margin: 0 -6px;
    padding: 10px 8px 12px;
  }

  .jwxt-tabs :deep(.el-tabs__header) {
    margin-bottom: 10px;
    overflow: visible;
  }

  .jwxt-tabs :deep(.el-tabs__nav-wrap) {
    height: 40px;
    max-height: 40px;
    padding: 0 4px 2px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    overscroll-behavior-y: none;
    touch-action: pan-x;
  }

  .jwxt-tabs :deep(.el-tabs__nav-wrap::after),
  .jwxt-tabs :deep(.el-tabs__active-bar) {
    display: none;
  }

  .jwxt-tabs :deep(.el-tabs__nav-wrap::-webkit-scrollbar) {
    display: none;
  }

  .jwxt-tabs :deep(.el-tabs__nav-scroll) {
    height: 40px;
    max-height: 40px;
    padding: 0 0 2px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    overscroll-behavior-y: none;
    touch-action: pan-x;
  }

  .jwxt-tabs :deep(.el-tabs__nav-scroll::-webkit-scrollbar) {
    display: none;
  }

  .jwxt-tabs :deep(.el-tabs__nav) {
    float: none;
    width: max-content;
    min-width: max-content;
    white-space: nowrap;
    gap: 8px;
    padding-inline: 4px;
  }

  .jwxt-tabs :deep(.el-tabs__item) {
    height: 34px;
    padding: 0 12px;
    font-size: 13px;
    border-radius: 999px;
    border: 1px solid transparent;
    background: var(--cpu-surface-subtle);
    color: var(--cpu-text-secondary);
    transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
  }

  .jwxt-tabs :deep(.el-tabs__item.is-active) {
    background: linear-gradient(135deg, var(--cpu-primary), var(--cpu-primary-dark));
    color: #fff;
    border-color: transparent;
  }

  .jwxt-tabs :deep(.el-tabs__content) {
    overflow: visible;
    padding-top: 2px;
  }

  .mobile-schedule-hint {
    align-items: stretch;
    flex-direction: column;
  }

  .mobile-schedule-link {
    width: 100%;
  }

  .login-card {
    max-width: none;
  }

  .login-head {
    align-items: flex-start;
    gap: 10px;
  }

  .lock-icon {
    font-size: 24px;
    padding: 10px;
    border-radius: 10px;
  }

  .safety {
    padding-left: 18px;
  }

  .vcode-row {
    gap: 6px;
  }

  .vcode-img {
    max-width: 108px;
  }

  .remember-row {
    align-items: stretch;
    flex-direction: column;
  }

  .remember-main {
    width: 100%;
    flex-wrap: wrap;
  }

  .forget-saved-btn {
    margin-left: 0;
    justify-content: flex-start;
    align-self: flex-start;
    padding-left: 0;
  }

  .session-info {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }

  .session-main {
    width: 100%;
  }

  .session-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    gap: 8px;
  }

  .session-actions .remember-tag {
    grid-column: 1 / -1;
    justify-self: start;
  }

  .session-actions :deep(.el-button) {
    width: 100%;
    margin-left: 0;
    min-height: 36px;
  }

  .debug-pane :deep(.el-input__wrapper) {
    min-width: 0;
  }

  .probe-row {
    flex-direction: column;
  }

  .probe-row :deep(.el-button) {
    width: 100%;
  }
}

@media (max-width: 430px) {
  .scope-tip {
    max-width: none;
  }

  .vcode-row {
    align-items: stretch;
    flex-direction: column;
  }

  .vcode-side {
    width: 100%;
  }

  .vcode-img {
    width: 100%;
    max-width: none;
    object-fit: contain;
    background: var(--cpu-card);
  }

  .session-actions {
    grid-template-columns: 1fr;
  }

  .alt-link a {
    display: inline-block;
    margin-top: 4px;
  }
}
</style>
