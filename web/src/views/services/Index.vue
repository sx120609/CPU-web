<template>
  <div class="services-page">
    <div class="page-head" :class="{ centered: !jwxt.isLoggedIn }">
      <div>
        <h2>🎯 校园服务</h2>
        <p class="hint">
          整理常用校园入口。登录教务后，还可以查看更完整的应用列表。
        </p>
      </div>
    </div>

    <section class="tool-section">
      <div class="tool-section-head">
        <div>
          <h3>校园小工具</h3>
          <p>反馈、问卷和临时查询这类轻量入口会集中放在这里。</p>
        </div>
        <el-button type="primary" plain @click="$router.push('/services/tools')">
          <el-icon><Tools /></el-icon>
          全部工具
        </el-button>
      </div>
      <div class="tool-grid">
        <button
          v-for="tool in visibleTools"
          :key="tool.slug"
          type="button"
          class="tool-entry"
          :class="{ planned: tool.status === 'planned' }"
          @click="$router.push({ name: tool.routeName, params: { slug: tool.slug } })"
        >
          <span class="tool-entry-icon" :style="{ color: tool.accent }">
            <el-icon><component :is="tool.iconComponent" /></el-icon>
          </span>
          <span class="tool-entry-body">
            <span class="tool-entry-title">
              <span>{{ tool.name }}</span>
              <em :class="{ login: isLoginRequired(tool.slug) }">
                {{ isLoginRequired(tool.slug) ? "需登录" : "免登录" }}
              </em>
            </span>
            <span class="tool-entry-sub">{{ tool.summary }}</span>
          </span>
          <el-icon class="quick-arrow"><Right /></el-icon>
        </button>
      </div>
    </section>

    <!-- 已登录：完整 i 服务面板 -->
    <template v-if="jwxt.isLoggedIn">
      <!-- 快速查询：站内代理，不外跳。按功能开关显示 -->
      <div v-if="site.features.electric" class="quick-row">
        <button type="button" class="quick-card" @click="electricOpen = true">
          <span class="quick-icon">💡</span>
          <div class="quick-body">
            <div class="quick-title">宿舍电费查询</div>
            <div class="quick-sub">站内查询本宿舍剩余电量、剩余金额与抄表时间</div>
          </div>
          <el-icon class="quick-arrow"><Right /></el-icon>
        </button>
      </div>
      <IServicePane />
    </template>

    <!-- 未登录但正在尝试自动登录：显示加载占位 -->
    <div v-else-if="autoLoading" class="cpu-card login-hint">
      <el-icon class="big-icon is-loading"><Loading /></el-icon>
      <div class="hint-body">
        <h3>正在恢复登录状态…</h3>
        <p>正在使用已保存的账号快速登录。</p>
      </div>
    </div>

    <!-- 自动登录撞到验证码：inline 展示验证码框 -->
    <div v-else-if="jwxt.needCaptcha && hasCreds" class="cpu-card login-hint captcha-card">
      <el-icon class="big-icon"><Picture /></el-icon>
      <div class="hint-body">
        <h3>输入验证码后继续</h3>
        <p>账号已经准备好了，只需补一次验证码。</p>
        <div class="captcha-row">
          <el-input v-model="captchaInput" placeholder="看图输入验证码" maxlength="8" style="flex:1; min-width:160px" @keyup.enter="submitCaptcha" />
          <img v-if="jwxt.captchaImage" :src="jwxt.captchaImage" alt="captcha" class="vcode-img" loading="lazy" decoding="async" fetchpriority="low" @click="reloadCaptcha" />
          <el-button text @click="reloadCaptcha"><el-icon><Refresh /></el-icon></el-button>
        </div>
        <div v-if="captchaError" class="captcha-err">{{ captchaError }}</div>
        <el-button class="captcha-submit" type="primary" :loading="captchaSubmitting" size="large" @click="submitCaptcha">完成授权</el-button>
      </div>
    </div>

    <!-- 没保存过学校账号 → 引导去 /jwxt 完整登录 -->
    <div v-else class="cpu-card login-hint">
      <el-icon class="big-icon"><Lock /></el-icon>
      <div class="hint-body">
        <h3>登录后可查看更完整的服务列表</h3>
        <p>登录后可查看更多校园应用和常用入口。学号 / 工号仅用于关联站内账号，<b>学校密码和验证码不会保存</b>。</p>
        <el-button class="hint-action" type="primary" size="large" @click="$router.push('/jwxt')">前往登录</el-button>
        <PrivacyPolicyNotice align="left" />
      </div>
    </div>

    <!-- 未登录的兜底：少量基础外链 -->
    <div v-if="!jwxt.isLoggedIn && !autoLoading" class="fallback">
      <h4 class="fb-title">公开入口</h4>
      <div class="fb-grid">
        <a href="http://lib.cpu.edu.cn" target="_blank" class="fb-card"><span class="fb-icon">📚</span><span>图书馆</span></a>
        <a href="http://opac.cpu.edu.cn" target="_blank" class="fb-card"><span class="fb-icon">🔍</span><span>馆藏检索</span></a>
        <a href="https://i.cpu.edu.cn" target="_blank" class="fb-card"><span class="fb-icon">🏛️</span><span>融合门户</span></a>
        <a href="http://jwc.cpu.edu.cn" target="_blank" class="fb-card"><span class="fb-icon">📋</span><span>教务处</span></a>
        <a href="http://news.cpu.edu.cn" target="_blank" class="fb-card"><span class="fb-icon">📢</span><span>校园新闻</span></a>
        <a href="https://cpu.91job.org.cn/sub-station/home/10316" target="_blank" class="fb-card"><span class="fb-icon">💼</span><span>就业平台</span></a>
      </div>
    </div>

    <DormElectricDialog v-model="electricOpen" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { Lock, Loading, Picture, Refresh, Right, Tools } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { useJwxtStore } from "@/stores/jwxt";
import { useSiteStore } from "@/stores/site";
import { loadCreds, hasCreds as hasSavedCreds } from "@/utils/credCrypto";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";
import IServicePane from "@/components/jwxt/IServicePane.vue";
import DormElectricDialog from "@/components/services/DormElectricDialog.vue";
import { serviceTools } from "@/data/serviceTools";
import { toolsApi, type ToolMeta } from "@/api/tools";

const jwxt = useJwxtStore();
const site = useSiteStore();
const autoLoading = ref(false);
const hasCreds = ref(false);
const captchaInput = ref("");
const captchaSubmitting = ref(false);
const captchaError = ref("");
const electricOpen = ref(false);
const toolMetas = ref<ToolMeta[]>([]);
const toolAccessMap = computed(() => Object.fromEntries(toolMetas.value.map((item) => [item.code, item])));
const visibleTools = computed(() => serviceTools.filter((tool) => toolAccessMap.value[tool.slug]?.isVisible !== false));

onMounted(async () => {
  try {
    toolMetas.value = await toolsApi.tools();
  } catch {
    toolMetas.value = [];
  }
  jwxt.hydrate();
  hasCreds.value = hasSavedCreds();
  await jwxt.refreshStatus();
  if (jwxt.isLoggedIn) return;

  // 只要本地存了学校账号就尝试，不再要求"rememberSaved"
  if (hasCreds.value) {
    autoLoading.value = true;
    try { await jwxt.tryAutoLogin({ force: true }); }
    finally { autoLoading.value = false; }
    // 如果 tryAutoLogin 命中 captcha，模板会自动切到 captcha-card；用户输入完点按钮 submitCaptcha
  }
});

function isLoginRequired(slug: string) {
  return Boolean(toolAccessMap.value[slug]?.requireLogin);
}

async function reloadCaptcha() {
  captchaInput.value = "";
  captchaError.value = "";
  try {
    await jwxt.beginLogin();
  } catch { /* store 内部已 set error */ }
}

async function submitCaptcha() {
  if (!captchaInput.value.trim()) {
    captchaError.value = "请输入验证码";
    return;
  }
  const creds = await loadCreds().catch(() => null);
  if (!creds) {
    ElMessage.warning("未找到保存的账号，请前往教务数据授权");
    return;
  }
  captchaSubmitting.value = true;
  captchaError.value = "";
  try {
    const ok = await jwxt.submitLogin(creds.username, creds.password, captchaInput.value.trim(), true);
    if (ok) {
      ElMessage.success("授权成功");
    } else {
      captchaError.value = jwxt.error || "验证码错误，请重试";
      captchaInput.value = "";
    }
  } finally { captchaSubmitting.value = false; }
}
</script>

<style scoped>
.services-page { display: flex; flex-direction: column; gap: 18px; }
.page-head { width: 100%; }
.page-head.centered {
  max-width: 760px;
  margin: 0 auto;
  text-align: center;
}
.page-head h2 { margin: 0; font-size: 22px; }
.page-head .hint { font-size: 13px; color: #6b7280; margin: 4px 0 0; line-height: 1.7; }
.page-head .hint a { color: var(--cpu-primary); }

.cpu-card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

.tool-section {
  background: #fff;
  border-radius: 12px;
  padding: 18px 22px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}
.tool-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
}
.tool-section-head h3 {
  margin: 0;
  font-size: 16px;
  color: #1f2937;
}
.tool-section-head p {
  margin: 5px 0 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}
.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}
.tool-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 86px;
  padding: 13px 14px;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  background: #fff;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.tool-entry:hover {
  border-color: var(--cpu-primary);
  box-shadow: 0 6px 18px rgba(22, 135, 118, 0.1);
  transform: translateY(-1px);
}
.tool-entry.planned {
  background: #fafafa;
}
.tool-entry-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 10px;
  background: #f9fafb;
}
.tool-entry-icon .el-icon {
  font-size: 22px;
}
.tool-entry-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tool-entry-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: #1f2937;
  font-size: 14px;
  font-weight: 600;
}
.tool-entry-title > span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-entry-title em {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid #b7eb8f;
  background: #f6ffed;
  color: #52c41a;
  font-size: 11px;
  font-style: normal;
  font-weight: 500;
}
.tool-entry-title em.login {
  border-color: #ffd591;
  background: #fff7e6;
  color: #d46b08;
}
.tool-entry-sub {
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}

.login-hint {
  display: flex;
  align-items: center;
  gap: 20px;
  width: min(100%, 680px);
  margin: 0 auto;
  background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
}
.captcha-card { background: linear-gradient(135deg, #fef9c3 0%, #fde68a 100%); }
.big-icon {
  font-size: 48px;
  color: var(--cpu-primary);
  background: rgba(255,255,255,0.6);
  padding: 16px;
  border-radius: 16px;
}
.big-icon.is-loading { animation: spin 1.2s linear infinite; }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
.hint-body { flex: 1; min-width: 0; }
.hint-body h3 { margin: 0 0 6px; font-size: 17px; color: #1f2937; }
.hint-body p { margin: 0 0 12px; font-size: 13px; color: #4b5563; line-height: 1.7; }
.hint-body b { color: #b45309; }
.hint-action,
.captcha-submit {
  min-width: 180px;
}
.captcha-submit {
  margin-top: 10px;
}

.captcha-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.vcode-img {
  height: 36px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid #e5e7eb;
  background: #fff;
}
.captcha-err {
  font-size: 12px;
  color: #b91c1c;
  margin-top: 6px;
}

.fallback {
  background: #fff;
  border-radius: 12px;
  padding: 18px 22px;
  width: min(100%, 760px);
  margin: 0 auto;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}
.fb-title { margin: 0 0 12px; font-size: 14px; color: #6b7280; font-weight: 500; }
.fb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.fb-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  text-decoration: none;
  color: #1f2937;
  transition: border-color 0.15s, background 0.15s;
}
.fb-card:hover {
  border-color: var(--cpu-primary);
  background: #f0fdf4;
}
.fb-icon { font-size: 22px; }

.quick-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.quick-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  width: 100%;
  background: linear-gradient(135deg, #fff7ed 0%, #fde68a 100%);
  border: 1px solid #fde68a;
  border-radius: 12px;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}
.quick-card:hover {
  border-color: #f59e0b;
  box-shadow: 0 4px 14px rgba(245, 158, 11, 0.12);
}
.quick-card:active { transform: scale(0.99); }
.quick-icon { font-size: 28px; }
.quick-body { flex: 1; min-width: 0; }
.quick-title { font-size: 15px; font-weight: 600; color: #1f2937; }
.quick-sub { font-size: 12px; color: #6b7280; margin-top: 2px; }
.quick-arrow { color: #92400e; }

@media (max-width: 700px) {
  .services-page {
    gap: 14px;
  }

  .page-head h2 {
    font-size: 20px;
  }

  .cpu-card,
  .tool-section,
  .fallback {
    border-radius: 10px;
    padding: 14px;
  }

  .tool-section-head {
    flex-direction: column;
    align-items: stretch;
  }

  .tool-section-head .el-button {
    width: 100%;
  }

  .tool-grid {
    grid-template-columns: 1fr;
  }

  .login-hint {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }

  .big-icon {
    font-size: 30px;
    padding: 10px;
    border-radius: 12px;
  }

  .hint-body .el-button {
    width: 100%;
  }

  .hint-action,
  .captcha-submit {
    min-width: 0;
  }

  .captcha-row {
    flex-wrap: wrap;
  }

  .fb-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .fb-card {
    min-height: 56px;
    padding: 10px;
  }

  .quick-card {
    align-items: flex-start;
    padding: 13px 14px;
  }

  .quick-icon {
    font-size: 24px;
  }

  .quick-arrow {
    margin-top: 3px;
  }
}
</style>
