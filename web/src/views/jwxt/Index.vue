<template>
  <div class="jwxt-page">
    <div class="page-head">
      <h2>🎓 教务数据</h2>
      <p class="hint">
        通过学校统一认证授权读取教务数据，把课表、成绩和培养方案整理成更易查看的视图。
        <b>账号密码仅用于本次认证</b>，不会写入数据库、文件或日志；会话保存在内存中，关闭浏览器即清空。
      </p>
    </div>

    <!-- 未登录：显示登录卡片 -->
    <div v-if="!jwxt.isLoggedIn" class="cpu-card login-card">
      <div class="login-head">
        <el-icon class="lock-icon"><Lock /></el-icon>
        <div>
          <h3>授权读取教务数据</h3>
          <p>使用学校 <b>统一身份认证</b> 账号完成授权</p>
        </div>
      </div>

      <el-alert
        type="warning"
        :closable="false"
        title="安全告知"
        show-icon
      >
        <ul class="safety">
          <li>账号密码 <b>仅用于本次统一认证</b></li>
          <li>授权成功后，仅保留学校颁发的会话 cookie 在服务端内存中（30 分钟不活动自动失效）</li>
          <li>本站<b>不保存</b>账号密码到数据库、文件或日志</li>
          <li>随时可以点击「立即清除会话」一键销毁</li>
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
            <el-input v-model="form.captcha" placeholder="看图输入" maxlength="8" style="flex:1" />
            <img v-if="jwxt.captchaImage" :src="jwxt.captchaImage" alt="captcha" class="vcode-img" @click="reloadCaptcha" :title="'点击换一张'" />
            <el-button text @click="reloadCaptcha"><el-icon><Refresh /></el-icon></el-button>
          </div>
        </el-form-item>

        <el-form-item>
          <el-checkbox v-model="remember">
            记住账号（加密保存到本机浏览器）
          </el-checkbox>
          <el-tooltip placement="top">
            <template #content>
              账号会用 AES-GCM 加密后存到 localStorage，<br/>
              <b>不会上传任何服务器</b>。<br/>
              下次打开此站可自动完成授权。<br/>
              <b>共享电脑请勿勾选</b>。
            </template>
            <el-icon class="hint-icon"><InfoFilled /></el-icon>
          </el-tooltip>
          <el-button v-if="jwxt.rememberSaved" text type="danger" size="small" @click="jwxt.forgetSavedCreds()" style="margin-left:auto">
            忘记已保存账号
          </el-button>
        </el-form-item>

        <el-form-item v-if="jwxt.error">
          <el-alert :title="jwxt.error" type="error" :closable="false" show-icon />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="jwxt.loading" @click="onSubmit" class="btn-submit">
            授权并读取数据
          </el-button>
        </el-form-item>
      </el-form>

      <div class="alt-link">
        暂不授权？也可以 <a href="http://jsxsd.cpu.edu.cn/zgykdx/tyrz.jsp" target="_blank">前往学校教务系统原站</a>
      </div>
    </div>

    <!-- 已登录：功能 Tab -->
    <div v-else>
      <div class="cpu-card session-info">
        <el-icon style="color:#16a34a"><CircleCheckFilled /></el-icon>
        <span>已连接学校教务系统。会话将在 30 分钟无活动后自动失效。</span>
        <el-tag v-if="jwxt.rememberSaved" size="small" type="warning" style="margin-right:8px">
          🔐 已记住账号
        </el-tag>
        <el-button v-if="jwxt.rememberSaved" text type="warning" size="small" @click="onForget">
          忘记保存账号
        </el-button>
        <el-button text type="danger" @click="onLogout">
          <el-icon><CircleClose /></el-icon> 断开连接
        </el-button>
      </div>

      <el-tabs v-model="tab" class="cpu-card" @tab-change="onTabChange">
        <el-tab-pane label="📅 课表" name="schedule">
          <SchedulePane :data="schedule" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane label="📊 成绩" name="grades">
          <GradesPane :data="grades" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane label="🎓 学业完成情况" name="progress">
          <ProgressPane :data="progress" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane label="📖 培养方案" name="pyfa">
          <PyfaPane :data="pyfa" :loading="tabLoading" />
        </el-tab-pane>
        <el-tab-pane label="🛠 调试" name="debug" v-if="isDev">
          <div class="debug-pane">
            <p class="cpu-muted">开发模式：点击「拉取调试快照」后端会把课表/成绩/考试等页面 HTML 落到 <code>server/.debug/</code>，供解析器开发用。</p>
            <el-button type="primary" :loading="snapping" @click="onSnapshot">📸 拉取调试快照</el-button>
            <ul v-if="snapResult?.saved?.length" class="snap-list">
              <li v-for="s in snapResult.saved" :key="s">✅ {{ s }}</li>
              <li v-for="e in snapResult.errors" :key="e" style="color:#dc2626">❌ {{ e }}</li>
            </ul>
            <el-divider />
            <p class="cpu-muted">自定义路径探针（仅 dev）：</p>
            <div style="display:flex;gap:8px">
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
import SchedulePane from "@/components/jwxt/SchedulePane.vue";
import GradesPane from "@/components/jwxt/GradesPane.vue";
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

const tab = ref<"schedule" | "grades" | "progress" | "pyfa" | "debug">("schedule");
const schedule = ref<any>(null);
const grades = ref<any>(null);
const progress = ref<any>(null);
const pyfa = ref<any>(null);
const tabLoading = ref(false);

const probePath = ref("/zgykdx/framework/xsMain.jsp");
const probeHtml = ref("");
const probing = ref(false);
const snapping = ref(false);
const snapResult = ref<{ saved: string[]; errors: string[] } | null>(null);

const isDev = computed(() => import.meta.env.DEV);

onMounted(async () => {
  jwxt.hydrate();
  await jwxt.refreshStatus();
  if (!jwxt.isLoggedIn) {
    // 1. 先尝试自动登录（用本地保存的账号）
    if (jwxt.rememberSaved) {
      ElMessage.info("正在尝试自动授权…");
      const ok = await jwxt.tryAutoLogin();
      if (ok) {
        ElMessage.success("已完成自动授权");
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
    ElMessage.success("已完成教务数据授权");
    loadCurrentTab();
  } else if (jwxt.needCaptcha) {
    form.captcha = "";
  }
}

async function onLogout() {
  await ElMessageBox.confirm("断开当前教务连接？\n如果勾选了「记住账号」，下次打开仍可自动授权。", "确认", { type: "warning" });
  await jwxt.logout();
  ElMessage.success("已断开教务连接");
  schedule.value = grades.value = progress.value = pyfa.value = null;
  await jwxt.beginLogin();
}

async function onForget() {
  await ElMessageBox.confirm("忘记已保存的账号？后续不再自动授权。", "确认", { type: "warning" });
  jwxt.forgetSavedCreds();
  ElMessage.success("已忘记保存账号");
}

async function loadCurrentTab() {
  tabLoading.value = true;
  try {
    if (tab.value === "schedule" && !schedule.value) schedule.value = await jwxtApi.schedule();
    else if (tab.value === "grades" && !grades.value) grades.value = await jwxtApi.grades();
    else if (tab.value === "progress" && !progress.value) progress.value = await jwxtApi.progress();
    else if (tab.value === "pyfa" && !pyfa.value) pyfa.value = await jwxtApi.pyfa();
  } finally { tabLoading.value = false; }
}

function onTabChange() { loadCurrentTab(); }

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
.jwxt-page { display: flex; flex-direction: column; gap: 16px; }
.page-head h2 { margin: 0; font-size: 22px; }
.page-head .hint { font-size: 13px; color: #6b7280; margin: 4px 0 0; line-height: 1.7; }
.page-head .hint b { color: #b45309; }

.cpu-card { background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

.login-card { max-width: 580px; }

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

.vcode-row { display: flex; gap: 8px; align-items: center; }
.vcode-img {
  height: 36px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid #e5e7eb;
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
  gap: 10px;
  font-size: 13px;
  color: #166534;
  background: #ecfdf5 !important;
  margin-bottom: 16px;
}
.session-info > span:first-of-type { flex: 1; }
.hint-icon { color: #6b7280; cursor: help; margin-left: 4px; }

.debug-pane { padding: 8px 0; }
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

  .session-info {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .session-info > span:first-of-type {
    flex-basis: calc(100% - 28px);
  }

  .session-info .el-button {
    margin-left: 0;
  }

  :deep(.el-tabs__content) {
    overflow: visible;
  }

  .debug-pane :deep(.el-input__wrapper) {
    min-width: 0;
  }
}
</style>
