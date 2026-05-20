<template>
  <div class="jwxt-page">
    <div class="page-head" :class="{ centered: !jwxt.isLoggedIn }">
      <h2>🎓 教务数据</h2>
      <p class="hint">
        通过学校统一认证查看课表、成绩和培养方案，信息会整理成更方便阅读的样子。
        学号 / 工号仅用于关联站内账号，<b>学校密码和验证码不会保存</b>。
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
        目前主要支持<b>本科生</b>账号。研究生、教职工、留学生等账号，暂时可能无法获取完整教务数据。
      </template>
    </el-alert>

    <!-- 未登录：显示登录卡片 -->
    <div v-if="!jwxt.isLoggedIn" class="cpu-card login-card">
      <div class="login-head">
        <el-icon class="lock-icon"><Lock /></el-icon>
        <div>
          <h3>授权读取教务数据</h3>
          <p>登录后可查看课表、成绩等信息</p>
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
          <li>学校密码和验证码<b>不会保存</b>在本站</li>
        </ul>
      </el-alert>

      <el-form
        :model="form"
        :rules="rules"
        ref="formRef"
        label-position="top"
        @keyup.enter="onSubmit"
        size="large"
        class="form"
      >
        <el-form-item label="学号 / 工号" prop="username">
          <el-input v-model="form.username" placeholder="学号 / 工号" autocomplete="off">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="统一认证密码" autocomplete="off">
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="jwxt.needCaptcha" label="验证码" prop="captcha">
          <div class="vcode-row">
            <el-input v-model="form.captcha" placeholder="看图输入" maxlength="8" class="vcode-input" />
            <div class="vcode-side">
              <img v-if="jwxt.captchaImage" :src="jwxt.captchaImage" alt="captcha" class="vcode-img" @click="reloadCaptcha" :title="'点击换一张'" />
              <el-button text class="vcode-refresh" @click="reloadCaptcha"><el-icon><Refresh /></el-icon></el-button>
            </div>
          </div>
        </el-form-item>

        <el-form-item>
          <div class="remember-row">
            <div class="remember-main">
              <el-checkbox v-model="remember">
                记住账号（仅保存在当前设备）
              </el-checkbox>
              <el-tooltip placement="top">
                <template #content>
                  账号只保存在当前设备浏览器，<br/>
                  <b>不会上传到本站</b>。<br/>
                  下次打开时可更快完成登录。<br/>
                  <b>共享电脑请勿勾选</b>。
                </template>
                <el-icon class="hint-icon"><InfoFilled /></el-icon>
              </el-tooltip>
            </div>
            <el-button v-if="jwxt.rememberSaved" text type="danger" size="small" class="forget-saved-btn" @click="jwxt.forgetSavedCreds()">
              忘记已保存账号
            </el-button>
          </div>
        </el-form-item>

        <el-form-item v-if="jwxt.error">
          <el-alert :title="jwxt.error" type="error" :closable="false" show-icon />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="jwxt.loading" @click="onSubmit" class="btn-submit">
            登录并查看
          </el-button>
        </el-form-item>
      </el-form>

      <div class="alt-link">
        暂不授权？也可以 <a href="http://jsxsd.cpu.edu.cn/zgykdx/tyrz.jsp" target="_blank">前往学校教务系统原站</a>
      </div>
    </div>

    <!-- 已登录：功能 Tab -->
    <div v-else class="jwxt-shell">
      <div class="cpu-card session-info">
        <div class="session-main">
          <el-icon class="session-ok"><CircleCheckFilled /></el-icon>
          <div class="session-copy">
            <div class="session-title">已连接学校教务系统</div>
            <div class="session-sub">如果数据不完整或显示异常，刷新后再试即可。</div>
          </div>
        </div>
        <div class="session-actions">
          <el-tag v-if="jwxt.rememberSaved" size="small" type="warning" class="remember-tag">
            已记住账号
          </el-tag>
          <el-button v-if="jwxt.rememberSaved" plain type="warning" size="small" @click="onForget">
            忘记账号
          </el-button>
          <el-button plain type="danger" size="small" @click="onLogout">
            <el-icon><CircleClose /></el-icon> 断开连接
          </el-button>
        </div>
      </div>

      <el-tabs v-model="tab" class="cpu-card jwxt-tabs" @tab-change="onTabChange">
        <el-tab-pane label="📅 课表" name="schedule">
          <SchedulePane :data="schedule" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane label="📊 成绩" name="grades">
          <GradesPane :data="grades" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane label="📝 期中成绩" name="midterm">
          <MidtermGradesPane :data="midtermGrades" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane label="🎓 学业完成情况" name="progress">
          <ProgressPane :data="progress" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane label="📖 培养方案" name="pyfa">
          <PyfaPane :data="pyfa" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane label="🛠 调试" name="debug" v-if="isDev">
          <div class="debug-pane">
            <p class="cpu-muted">开发模式：点击「拉取调试快照」后端会把教务页面 HTML 落到 <code>server/.debug/</code>，供解析器开发用。</p>
            <el-button type="primary" :loading="snapping" @click="onSnapshot">📸 拉取调试快照</el-button>
            <ul v-if="snapResult?.saved?.length" class="snap-list">
              <li v-for="s in snapResult.saved" :key="s">✅ {{ s }}</li>
              <li v-for="e in snapResult.errors" :key="e" style="color:#dc2626">❌ {{ e }}</li>
            </ul>
            <el-divider />
            <p class="cpu-muted">自定义路径探针（仅 dev）：</p>
            <div class="probe-row">
              <el-input v-model="probePath" placeholder="例如 /jsxsd/xskb/xskb_list.do?xnxqid=2024-2025-2-1" />
              <el-button @click="onProbe" :loading="probing">GET</el-button>
            </div>
            <el-input v-if="probeHtml" v-model="probeHtml" type="textarea" :rows="14" readonly style="margin-top:8px;font-family:monospace" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from "vue";
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from "element-plus";
import { Lock, User, Refresh, CircleCheckFilled, CircleClose, InfoFilled } from "@element-plus/icons-vue";
import { useJwxtStore } from "@/stores/jwxt";
import { jwxtApi } from "@/api/jwxt";
import { jwxtScopedStorageKey } from "@/utils/jwxtCache";
import SchedulePane from "@/components/jwxt/SchedulePane.vue";
import GradesPane from "@/components/jwxt/GradesPane.vue";
import MidtermGradesPane from "@/components/jwxt/MidtermGradesPane.vue";
import ProgressPane from "@/components/jwxt/ProgressPane.vue";
import PyfaPane from "@/components/jwxt/PyfaPane.vue";

const jwxt = useJwxtStore();
const formRef = ref<FormInstance>();
const form = reactive({ username: "", password: "", captcha: "" });
const remember = ref(true); // 默认勾选"记住"
const rules: FormRules = {
  username: [{ required: true, message: "请输入学号或工号" }],
  password: [{ required: true, message: "请输入密码" }],
};

const tab = ref<"schedule" | "grades" | "midterm" | "progress" | "pyfa" | "debug">("schedule");
type DataTab = "schedule" | "grades" | "midterm" | "progress" | "pyfa";
const schedule = ref<any>(null);
const grades = ref<any>(null);
const midtermGrades = ref<any>(null);
const progress = ref<any>(null);
const pyfa = ref<any>(null);
const tabLoading = ref(false);
const CACHE_TTL = 12 * 60 * 60 * 1000;
const CACHE_PREFIX = "cpu-jwxt-tab-cache-v4";
const activeRequests = new Map<DataTab, Promise<any>>();

const probePath = ref("/zgykdx/framework/xsMain.jsp");
const probeHtml = ref("");
const probing = ref(false);
const snapping = ref(false);
const snapResult = ref<{ saved: string[]; errors: string[] } | null>(null);

const isDev = computed(() => import.meta.env.DEV);

onMounted(async () => {
  jwxt.hydrate();
  restoreAllTabCaches();
  await jwxt.refreshStatus();
  if (!jwxt.isLoggedIn) {
    // 1. 先尝试自动登录（用本地保存的账号）
    if (jwxt.rememberSaved) {
      ElMessage.info("正在尝试自动登录…");
      const ok = await jwxt.tryAutoLogin();
      if (ok) {
        ElMessage.success("已完成登录");
        loadCurrentTab();
        return;
      }
      // 失败：保留 captcha / error 的状态以便用户手动补
    }
    // 2. 准备登录页（拿 lt/execution + 可能的验证码）
    try { await jwxt.beginLogin(); } catch { /* ignore */ }
  } else {
    loadCurrentTab();
  }
});

function cacheKey(t: DataTab) {
  return jwxtScopedStorageKey(CACHE_PREFIX, t);
}

function readCache(t: DataTab): { savedAt: number; data: any } | null {
  try {
    const key = cacheKey(t);
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(t: DataTab, data: any) {
  try {
    const key = cacheKey(t);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: normalizeTabData(t, data) }));
  } catch {
    /* ignore */
  }
}

function isStale(savedAt: number) {
  return !savedAt || Date.now() - savedAt > CACHE_TTL;
}

function getTabData(t: DataTab) {
  if (t === "schedule") return schedule.value;
  if (t === "grades") return grades.value;
  if (t === "midterm") return midtermGrades.value;
  if (t === "progress") return progress.value;
  return pyfa.value;
}

function setTabData(t: DataTab, data: any) {
  const normalized = normalizeTabData(t, data);
  if (t === "schedule") schedule.value = normalized;
  else if (t === "grades") grades.value = normalized;
  else if (t === "midterm") midtermGrades.value = normalized;
  else if (t === "progress") progress.value = normalized;
  else pyfa.value = normalized;
}

function restoreCachedTab(t: DataTab) {
  const cached = readCache(t);
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
  (["schedule", "grades", "midterm", "progress", "pyfa"] as DataTab[]).forEach((t) => restoreCachedTab(t));
}

function fetchTab(t: DataTab) {
  if (activeRequests.has(t)) return activeRequests.get(t)!;
  const request = (async () => {
    if (t === "schedule") return jwxtApi.schedule();
    if (t === "grades") return jwxtApi.grades();
    if (t === "midterm") return jwxtApi.midtermGrades();
    if (t === "progress") return jwxtApi.progress();
    return jwxtApi.pyfa();
  })();
  activeRequests.set(t, request);
  request.then(
    () => activeRequests.delete(t),
    () => activeRequests.delete(t)
  );
  return request;
}

async function reloadCaptcha() {
  await jwxt.beginLogin();
  form.captcha = "";
}

async function onSubmit() {
  try { await formRef.value?.validate(); } catch { return; }
  if (jwxt.needCaptcha && !form.captcha) { ElMessage.warning("请输入验证码"); return; }
  const ok = await jwxt.submitLogin(form.username, form.password, form.captcha || undefined, remember.value);
  form.password = ""; // 立刻清掉密码字段
  if (ok) {
    ElMessage.success("登录成功");
    loadCurrentTab();
  } else if (jwxt.needCaptcha) {
    form.captcha = "";
  }
}

async function onLogout() {
  await ElMessageBox.confirm("断开当前教务连接？\n如果勾选了“记住账号”，下次打开时仍可快速登录。", "确认", { type: "warning" });
  await jwxt.logout();
  ElMessage.success("已断开教务连接");
  schedule.value = grades.value = midtermGrades.value = progress.value = pyfa.value = null;
  await jwxt.beginLogin();
}

async function onForget() {
  await ElMessageBox.confirm("清除已保存的账号？之后将不再自动登录。", "确认", { type: "warning" });
  jwxt.forgetSavedCreds();
  ElMessage.success("已清除保存的账号");
}

async function loadCurrentTab(force = false) {
  if (tab.value === "debug") return;
  const current = tab.value as DataTab;
  const cached = restoreCachedTab(current);
  if (cached && !force && !isStale(cached.savedAt)) return;
  tabLoading.value = force || !getTabData(current);
  try {
    const data = await fetchTab(current);
    setTabData(current, data);
    writeCache(current, data);
  } catch {
    // 已有缓存时保留旧数据；错误提示由 API 拦截器统一处理。
  } finally { tabLoading.value = false; }
}

function onTabChange() { loadCurrentTab(false); }

async function onSnapshot() {
  snapping.value = true;
  try { snapResult.value = await jwxtApi.debugSnapshot(); }
  finally { snapping.value = false; }
}

async function onProbe() {
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
.page-head .hint { font-size: 13px; color: #6b7280; margin: 6px 0 0; line-height: 1.7; }
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

.cpu-card { background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

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
.login-head p { margin: 2px 0 0; font-size: 12px; color: #6b7280; }
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
.vcode-img {
  height: 36px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid #e5e7eb;
}
.vcode-refresh {
  flex-shrink: 0;
}

.alt-link {
  margin-top: 12px;
  text-align: center;
  font-size: 12px;
  color: #9ca3af;
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
.session-sub {
  margin-top: 2px;
  color: #4b5563;
  font-size: 12px;
  line-height: 1.6;
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
.hint-icon { color: #6b7280; cursor: help; margin-left: 4px; }

.debug-pane { padding: 8px 0; }
.probe-row {
  display: flex;
  gap: 8px;
}
.snap-list { font-size: 12px; color: #4b5563; list-style: none; padding: 0; margin: 10px 0; }
.snap-list li { padding: 2px 0; font-family: monospace; }
.cpu-muted { font-size: 12px; color: #9ca3af; }

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
    background: #f3f4f6;
    color: #4b5563;
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
    background: #fff;
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
