<template>
  <div class="services-page">
    <div class="page-head" :class="{ centered: !jwxt.isLoggedIn && !academicDataUnavailable }">
      <div>
        <h2>🎯 校园服务</h2>
        <p v-if="academicDataUnavailable" class="hint">
          当前账号已完成站内登录，但学校暂未开放可读取的教务数据；公共服务仍可正常使用，教务相关入口会在数据可用后自动显示。
        </p>
        <p v-else class="hint">
          整理常用校园入口。登录教务后，还可以查看更完整的应用列表。
        </p>
      </div>
    </div>

    <section class="tool-section" v-loading="toolsLoading">
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
      <div v-if="toolsError" class="tool-error">
        <span>{{ toolsError }}</span>
        <el-button text size="small" :loading="toolsLoading" @click="loadToolMetas">重试</el-button>
      </div>
      <div class="tool-grid">
        <button
          v-for="tool in visibleTools"
          :key="tool.slug"
          type="button"
          class="tool-entry"
          :class="{ planned: tool.status === 'planned' }"
          @click="openTool(tool)"
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

    <!-- 客户端下载对访客也可见；电费查询仍需要教务登录 -->
    <div class="quick-row">
      <button v-if="jwxt.isLoggedIn && site.features.electric" type="button" class="quick-card electric-card" @click="electricOpen = true">
        <span class="quick-icon">💡</span>
        <div class="quick-body">
          <div class="quick-title">宿舍电费查询</div>
          <div class="quick-sub">站内查询本宿舍剩余电量、剩余金额与抄表时间</div>
        </div>
        <el-icon class="quick-arrow"><Right /></el-icon>
      </button>
      <button type="button" class="quick-card network-card" @click="router.push('/download')">
        <span class="quick-icon">🖥️</span>
        <div class="quick-body">
          <div class="quick-title-row">
            <div class="quick-title">药大拾间桌面客户端</div>
            <span class="quick-badge">Windows</span>
            <span class="quick-version">macOS M 芯片</span>
          </div>
          <div class="quick-sub">校园网自动连接、学习通辅助与桌面常驻能力都在客户端中</div>
        </div>
        <span class="quick-action">查看全部客户端</span>
        <el-icon class="quick-arrow"><Right /></el-icon>
      </button>
    </div>

    <!-- 已登录：完整 i 服务面板 -->
    <template v-if="jwxt.isLoggedIn">
      <IServicePane />
    </template>

    <div v-else-if="academicDataUnavailable" class="cpu-card academic-empty">
      <el-empty description="暂无教务数据" :image-size="88" />
      <div class="academic-empty-copy">
        <p>当前账号已经登录站内服务，但学校暂未开放可读取的教务入口。</p>
        <p>等教务数据开通后，这里会自动补全，不需要重新登录。</p>
      </div>
      <el-button type="primary" plain @click="$router.push('/jwxt')">查看教务说明</el-button>
    </div>

    <!-- 未登录 → 引导去 /jwxt 完整登录 -->
    <div v-else class="cpu-card login-hint">
      <el-icon class="big-icon"><Lock /></el-icon>
      <div class="hint-body">
        <h3>登录后可查看更完整的服务列表</h3>
        <p>登录后可查看更多校园应用和常用入口。学号 / 工号仅用于关联站内账号；勾选保持登录后会在当前浏览器加密保存账号密码，验证码不会保存。</p>
        <el-button class="hint-action" type="primary" size="large" @click="$router.push('/jwxt')">前往登录</el-button>
        <PrivacyPolicyNotice align="left" />
      </div>
    </div>

    <!-- 未登录的兜底：少量基础外链 -->
    <div v-if="!jwxt.isLoggedIn" class="fallback">
      <h4 class="fb-title">公开入口</h4>
      <div class="fb-grid">
        <a href="http://lib.cpu.edu.cn" target="_blank" rel="noopener noreferrer" class="fb-card"><span class="fb-icon">📚</span><span>图书馆</span></a>
        <a href="http://opac.cpu.edu.cn" target="_blank" rel="noopener noreferrer" class="fb-card"><span class="fb-icon">🔍</span><span>馆藏检索</span></a>
        <a href="https://i.cpu.edu.cn" target="_blank" rel="noopener noreferrer" class="fb-card"><span class="fb-icon">🏛️</span><span>融合门户</span></a>
        <a href="http://jwc.cpu.edu.cn" target="_blank" rel="noopener noreferrer" class="fb-card"><span class="fb-icon">📋</span><span>教务处</span></a>
        <a href="http://news.cpu.edu.cn" target="_blank" rel="noopener noreferrer" class="fb-card"><span class="fb-icon">📢</span><span>校园新闻</span></a>
        <a href="https://cpu.91job.org.cn/sub-station/home/10316" target="_blank" rel="noopener noreferrer" class="fb-card"><span class="fb-icon">💼</span><span>就业平台</span></a>
      </div>
    </div>

    <DormElectricDialog v-model="electricOpen" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onBeforeUnmount, onMounted, watch } from "vue";
import { Lock, Right, Tools } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useJwxtStore } from "@/stores/jwxt";
import { useSiteStore } from "@/stores/site";
import { readViewCache, writeViewCache } from "@/utils/viewCache";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";
import IServicePane from "@/components/jwxt/IServicePane.vue";
import DormElectricDialog from "@/components/services/DormElectricDialog.vue";
import { serviceTools, type ServiceTool } from "@/data/serviceTools";
import { toolsApi, type ToolMeta } from "@/api/tools";

const jwxt = useJwxtStore();
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const site = useSiteStore();
const electricOpen = ref(false);
const toolMetas = ref<ToolMeta[]>([]);
const toolsLoading = ref(false);
const toolsError = ref("");
let toolsLoadSeq = 0;
let disposed = false;
const toolsCacheKey = computed(() => `cpu-services-tools-v1:${auth.user?.id ? `user-${auth.user.id}` : "guest"}`);
const academicDataUnavailable = computed(() => Boolean(auth.user?.studentSso && auth.academicIdentityUnavailable));
const toolAccessMap = computed(() => Object.fromEntries(toolMetas.value.map((item) => [item.code, item])));
const visibleTools = computed(() => serviceTools.filter((tool) => toolAccessMap.value[tool.slug]?.isVisible !== false));

watch(
  [() => route.query.open, () => site.features.electric],
  ([quickOpen, electricEnabled]) => {
    if (quickOpen === "electric" && electricEnabled) electricOpen.value = true;
    if (quickOpen === "network" || quickOpen === "desktop") void router.push("/download");
  },
  { immediate: true },
);

onMounted(async () => {
  disposed = false;
  restoreToolMetasCache();
  void loadToolMetas();
  jwxt.hydrate();
  try {
    await jwxt.refreshStatus();
  } catch {
    if (!disposed) ElMessage.warning("教务登录状态暂时无法刷新，基础服务仍可继续使用");
  }
  if (disposed) return;
  // 服务页只探测现有教务会话，不自动提交已保存的学校凭据。
});

onBeforeUnmount(() => {
  disposed = true;
  toolsLoadSeq += 1;
});

watch(toolsCacheKey, (next, previous) => {
  if (disposed || next === previous) return;
  toolsLoadSeq += 1;
  toolMetas.value = [];
  restoreToolMetasCache();
  void loadToolMetas();
});

async function loadToolMetas() {
  const seq = ++toolsLoadSeq;
  toolsLoading.value = !toolMetas.value.length;
  toolsError.value = "";
  try {
    const next = await toolsApi.tools({ suppressErrorMessage: true });
    if (seq !== toolsLoadSeq) return;
    toolMetas.value = next;
    writeViewCache(toolsCacheKey.value, next);
  } catch (error) {
    if (seq !== toolsLoadSeq) return;
    if (!toolMetas.value.length) toolsError.value = normalizeToolsError(error);
  } finally {
    if (seq === toolsLoadSeq) toolsLoading.value = false;
  }
}

function restoreToolMetasCache() {
  const cached = readViewCache<ToolMeta[]>(
    toolsCacheKey.value,
    (value): value is ToolMeta[] => Array.isArray(value)
      && value.every((item) => Boolean(item) && typeof item === "object" && typeof (item as ToolMeta).code === "string"),
  );
  if (cached) toolMetas.value = cached;
  return cached;
}

function isLoginRequired(slug: string) {
  return Boolean(toolAccessMap.value[slug]?.requireLogin);
}

function openTool(tool: ServiceTool) {
  router.push(tool.routeName === "service-tool-detail"
    ? { name: tool.routeName, params: { slug: tool.slug } }
    : { name: tool.routeName });
}

function normalizeToolsError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "工具配置加载失败，已显示默认入口";
  }
  return "工具配置加载失败，已显示默认入口";
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
.page-head .hint { font-size: 13px; color: var(--cpu-text-secondary); margin: 4px 0 0; line-height: 1.7; }
.page-head .hint a { color: var(--cpu-primary); }

.academic-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}

.academic-empty-copy {
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.academic-empty-copy p {
  margin: 0;
}

.cpu-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}

.tool-section {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
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
  color: var(--cpu-text);
}
.tool-section-head p {
  margin: 5px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.tool-error {
  margin-bottom: 12px;
  padding: 9px 12px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.34);
  color: #92400e;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}
.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 10px;
}
.tool-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 86px;
  padding: 13px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  background: var(--cpu-card);
  color: var(--cpu-text);
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
  background: var(--cpu-surface-subtle);
}
.tool-entry-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 10px;
  background: var(--cpu-surface-subtle);
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
  color: var(--cpu-text);
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
  border: 1px solid rgba(82, 196, 26, 0.38);
  background: rgba(82, 196, 26, 0.12);
  color: #52c41a;
  font-size: 11px;
  font-style: normal;
  font-weight: 500;
}
.tool-entry-title em.login {
  border-color: rgba(245, 158, 11, 0.38);
  background: rgba(245, 158, 11, 0.12);
  color: #d46b08;
}
.tool-entry-sub {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.login-hint {
  display: flex;
  align-items: center;
  gap: 20px;
  width: min(100%, 680px);
  margin: 0 auto;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.14) 0%, rgba(45, 212, 191, 0.1) 100%);
}
.captcha-card { background: linear-gradient(135deg, rgba(245, 158, 11, 0.16) 0%, rgba(251, 191, 36, 0.12) 100%); }
.big-icon {
  font-size: 48px;
  color: var(--cpu-primary);
  background: var(--cpu-surface-subtle);
  padding: 16px;
  border-radius: 16px;
}
.big-icon.is-loading { animation: spin 1.2s linear infinite; }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
.hint-body { flex: 1; min-width: 0; }
.hint-body h3 { margin: 0 0 6px; font-size: 17px; color: var(--cpu-text); }
.hint-body p { margin: 0 0 12px; font-size: 13px; color: var(--cpu-text-secondary); line-height: 1.7; }
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
.vcode-img-button {
  height: 38px;
  min-width: 112px;
  border: 1px solid var(--cpu-border);
  border-radius: 5px;
  background: var(--cpu-card);
  display: grid;
  place-items: center;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
}
.vcode-img {
  height: 36px;
  max-width: 112px;
  object-fit: contain;
  display: block;
}
.vcode-img-button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}
.vcode-img-button:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}
.captcha-err {
  font-size: 12px;
  color: #b91c1c;
  margin-top: 6px;
}

.fallback {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 18px 22px;
  width: min(100%, 760px);
  margin: 0 auto;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}
.fb-title { margin: 0 0 12px; font-size: 14px; color: var(--cpu-text-secondary); font-weight: 500; }
.fb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr));
  gap: 10px;
}
.fb-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  text-decoration: none;
  color: var(--cpu-text);
  transition: border-color 0.15s, background 0.15s;
  min-width: 0;
}
.fb-card:hover {
  border-color: var(--cpu-primary);
  background: rgba(16, 185, 129, 0.08);
}
.fb-icon { font-size: 22px; }
.fb-card span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.quick-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  width: 100%;
  min-height: 84px;
  border: 1px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  touch-action: manipulation;
  font: inherit;
  text-align: left;
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}
.quick-card:only-child { grid-column: 1 / -1; }
.electric-card {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.14) 0%, rgba(251, 191, 36, 0.1) 100%);
  border-color: rgba(245, 158, 11, 0.32);
}
.network-card {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.13) 0%, rgba(20, 184, 166, 0.09) 100%);
  border-color: rgba(59, 130, 246, 0.28);
}

@media (hover: hover) and (pointer: fine) {
  .electric-card:hover {
    border-color: #f59e0b;
    box-shadow: 0 4px 14px rgba(245, 158, 11, 0.12);
  }

  .network-card:hover {
    border-color: #3b82f6;
    box-shadow: 0 4px 14px rgba(59, 130, 246, 0.12);
  }

  .quick-card:active { transform: scale(0.99); }
}
.quick-icon { font-size: 28px; }
.quick-body { flex: 1; min-width: 0; }
.quick-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.quick-title { font-size: 15px; font-weight: 600; color: var(--cpu-text); }
.quick-sub { font-size: 12px; color: var(--cpu-text-secondary); margin-top: 2px; }
.quick-badge,
.quick-version {
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.45;
}
.quick-badge {
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
}
.quick-version {
  background: rgba(20, 184, 166, 0.12);
  color: #0f766e;
}
.quick-action {
  flex: 0 0 auto;
  color: #2563eb;
  font-size: 12px;
  font-weight: 600;
}
.quick-arrow { color: #92400e; }
.network-card .quick-arrow { color: #2563eb; }

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

  .tool-error {
    align-items: stretch;
    flex-direction: column;
  }

  .tool-error .el-button {
    align-self: flex-start;
    margin-left: 0;
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

  .quick-row {
    grid-template-columns: 1fr;
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

  .quick-action {
    display: none;
  }
}
</style>
