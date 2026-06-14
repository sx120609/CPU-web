<template>
  <div class="weiwall-pane">
    <el-card shadow="never">
      <template #header>
        <div class="pane-header">
          <div>
            <h3>📮 逛逛同步</h3>
            <p>把外部逛逛的帖子和评论同步进本站，并按设定频率持续刷新。</p>
          </div>
          <div class="pane-actions">
            <el-button :loading="loading" :disabled="loading" @click="reload">刷新状态</el-button>
            <el-button type="primary" :loading="running" :disabled="running" @click="runNow">立即同步一次</el-button>
          </div>
        </div>
      </template>

      <div v-if="config" class="status-grid">
        <div class="status-card">
          <span class="label">同步状态</span>
          <el-tag :type="config.enabled ? 'success' : 'info'">{{ config.enabled ? "已启用" : "未启用" }}</el-tag>
        </div>
        <div class="status-card">
          <span class="label">目标板块</span>
          <div class="value">
            <span>{{ boardDisplayName }}</span>
            <span v-if="config.board" class="muted">/{{ config.board.slug }} · {{ config.board.topicCount }} 帖</span>
          </div>
        </div>
        <div class="status-card">
          <span class="label">Token</span>
          <div class="value">
            <span>{{ config.tokenPresent ? config.tokenPreview : "未配置" }}</span>
            <span v-if="config.tokenPresent && config.tokenExpiresKnown" class="muted">
              · {{ config.tokenExpired ? "已过期" : "到期" }} {{ fmtDate(config.tokenExpiresAt) }}
            </span>
            <span v-else-if="config.tokenPresent" class="muted">· 到期时间未知</span>
          </div>
        </div>
        <div class="status-card">
          <span class="label">最近执行</span>
          <div class="value">
            <span>{{ config.lastRunAt ? fmtDate(config.lastRunAt) : "还没跑过" }}</span>
            <span v-if="config.lastRunOk !== null" class="muted">· {{ config.lastRunOk ? "成功" : "失败" }}</span>
          </div>
        </div>
      </div>

      <el-alert
        v-if="config?.lastError"
        class="run-error"
        type="warning"
        :closable="false"
        :title="config.lastError"
        show-icon
      />

      <el-form v-if="config" :model="form" label-position="top" class="config-form">
        <el-form-item label="启用同步">
          <el-switch v-model="form.enabled" />
        </el-form-item>

        <el-form-item label="Base URL">
          <el-input v-model="form.baseUrl" placeholder="https://s.weiwall.com" />
        </el-form-item>

        <el-form-item label="学校代号">
          <el-input v-model="form.schoolEn" placeholder="cpu" />
        </el-form-item>

        <el-form-item label="Tenant ID">
          <el-input-number v-model="form.tenantId" :min="1" :max="999999" />
        </el-form-item>

        <el-form-item label="同步间隔（秒）">
          <el-input-number v-model="form.intervalSeconds" :min="30" :max="3600" />
          <div class="field-tip">当前实现按 30 秒检查一次，默认 120 秒真正执行一轮。建议不要低于 60 秒。</div>
        </el-form-item>

        <el-form-item label="帖子扫描页数">
          <el-input-number v-model="form.topicPages" :min="1" :max="20" />
          <div class="field-tip">每轮会先从“最新发帖”流往后翻这么多页，再额外轮转补扫一小批老帖评论；页数越大越稳，但请求量也越高。</div>
        </el-form-item>

        <el-form-item label="评论页大小">
          <el-input-number v-model="form.commentPageSize" :min="5" :max="20" />
          <div class="field-tip">远端评论接口限制 <code>page_size &lt;= 20</code>，这里按接口上限约束。</div>
        </el-form-item>

        <el-form-item label="单帖最多抓多少页一级评论">
          <el-input-number v-model="form.maxCommentPages" :min="1" :max="50" />
        </el-form-item>

        <el-form-item label="单条一级评论最多补抓多少页楼中楼">
          <el-input-number v-model="form.maxReplyPages" :min="1" :max="50" />
        </el-form-item>

        <el-form-item label="新的 Token（留空则不改）">
          <el-input
            v-model="form.token"
            type="textarea"
            :rows="4"
            placeholder="把 capture-token --show-token 抓到的 Bearer token 粘贴到这里"
          />
          <div class="field-tip">推荐先在命令行执行：<code>npm run weiwall -- capture-token --adb \"D:\platform-tools\adb.exe\" --show-token</code></div>
          <div class="field-tip">如果当前 Token 是 JWT，后台会自动显示到期时间；过期后会给管理员发送站内通知。</div>
        </el-form-item>

        <div class="form-actions">
          <el-button type="primary" :loading="saving" :disabled="saving" @click="save">保存配置</el-button>
          <el-button :loading="authLinkLoading" :disabled="authLinkLoading" @click="startWechatAuth">微信授权更新 Token</el-button>
          <el-button :disabled="clearingToken || !config.tokenPresent" :loading="clearingToken" @click="clearToken">清空已保存 Token</el-button>
          <span class="muted">上次成功同步：{{ config.lastSyncedAt ? fmtDate(config.lastSyncedAt) : "暂无" }}</span>
        </div>
      </el-form>
    </el-card>

    <el-card v-if="runResult" shadow="never">
      <template #header><h3>最近一次手动同步结果</h3></template>
      <div class="result-grid">
        <div class="result-item"><span>状态</span><b>{{ runResult.ok ? "成功" : "失败" }}</b></div>
        <div class="result-item"><span>来源</span><b>{{ runResult.sourceName }}</b></div>
        <div class="result-item"><span>扫描页数</span><b>{{ runResult.pagesScanned }}</b></div>
        <div class="result-item"><span>扫描帖子</span><b>{{ runResult.topicsScanned }}</b></div>
        <div class="result-item"><span>新增帖子</span><b>{{ runResult.topicsCreated }}</b></div>
        <div class="result-item"><span>更新帖子</span><b>{{ runResult.topicsUpdated }}</b></div>
        <div class="result-item"><span>新增回复</span><b>{{ runResult.repliesCreated }}</b></div>
        <div class="result-item"><span>更新回复</span><b>{{ runResult.repliesUpdated }}</b></div>
        <div class="result-item"><span>作者新增</span><b>{{ runResult.authorsCreated }}</b></div>
        <div class="result-item"><span>作者更新</span><b>{{ runResult.authorsUpdated }}</b></div>
        <div class="result-item"><span>评论请求量</span><b>{{ runResult.commentsFetched }}</b></div>
        <div class="result-item"><span>最新外部帖子 ID</span><b>{{ runResult.latestExternalTopicId || "-" }}</b></div>
      </div>
      <div v-if="runResult.topicTraces?.length" class="trace-block">
        <div class="trace-title">本轮评论补抓明细</div>
        <div class="trace-table-scroll">
          <el-table :data="runResult.topicTraces" size="small" stripe class="trace-table">
            <el-table-column label="阶段" min-width="88">
              <template #default="{ row }">{{ row.phase === "latest" ? "最新窗口" : "历史补扫" }}</template>
            </el-table-column>
            <el-table-column label="动作" min-width="88">
              <template #default="{ row }">{{ row.action === "fetched" ? "抓评论" : row.action === "probed" ? "只探测" : "跳过" }}</template>
            </el-table-column>
            <el-table-column prop="title" label="帖子" min-width="220" show-overflow-tooltip />
            <el-table-column label="评论数" min-width="110">
              <template #default="{ row }">{{ row.remoteCommentCount ?? "-" }} / {{ row.localReplyCountBefore ?? "-" }}</template>
            </el-table-column>
            <el-table-column label="抓到" min-width="70">
              <template #default="{ row }">{{ row.commentsFetched }}</template>
            </el-table-column>
            <el-table-column label="新增/更新" min-width="92">
              <template #default="{ row }">{{ row.repliesCreated }}/{{ row.repliesUpdated }}</template>
            </el-table-column>
            <el-table-column label="抓后可见" min-width="92">
              <template #default="{ row }">{{ row.visibleReplyCountAfter ?? "-" }}</template>
            </el-table-column>
            <el-table-column prop="externalTopicId" label="外部 ID" min-width="110" />
            <el-table-column prop="note" label="说明" min-width="260" show-overflow-tooltip />
          </el-table>
        </div>
        <div class="field-tip">“评论数”列表示“远端 commentCount / 本地 replyCount(抓前)”。如果这里只显示别的帖子，说明本轮拉到的新评论并不是你正在看的那条。</div>
      </div>
      <el-alert v-if="runResult.error" class="run-error" type="error" :closable="false" :title="runResult.error" show-icon />
    </el-card>

    <el-dialog v-model="authDialogOpen" title="微信授权更新 Token" width="min(560px, 92dvw)">
      <div v-if="authSession" class="auth-dialog">
        <p class="auth-tip">用微信扫描下方二维码，完成授权后服务器会自动换取并保存新的逛逛 Token。</p>
        <el-alert
          v-if="authOriginHint"
          class="auth-origin-alert"
          :type="authOriginHint.type"
          :closable="false"
          show-icon
          :title="authOriginHint.title"
        />
        <img :src="authSession.qrDataUrl" alt="微信授权二维码" class="auth-qr" />
        <div class="auth-actions">
          <el-button type="primary" @click="openAuthorizeUrl">打开授权链接</el-button>
          <el-button @click="copyAuthorizeUrl">复制授权链接</el-button>
        </div>
        <el-alert
          :type="authStatus?.status === 'success' ? 'success' : authStatus?.status === 'error' || authStatus?.status === 'expired' ? 'error' : 'info'"
          :closable="false"
          show-icon
          :title="authStatusTitle"
        />
        <div v-if="authStatus?.error" class="field-tip">{{ authStatus.error }}</div>
        <div v-if="authSession.callbackUrl" class="field-tip">回调地址：<code>{{ authSession.callbackUrl }}</code></div>
        <div class="field-tip">站点域名：<code>{{ activeSiteOrigin }}</code></div>
        <div class="field-tip">二维码有效期到：{{ fmtDate(authSession.expiresAt) }}</div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { adminApi, type SiteConfig, type WeiwallSyncConfig, type WeiwallSyncRunResult, type WeiwallTokenAuthSession, type WeiwallTokenAuthStatus } from "@/api/admin";
import { fmtDate } from "@/utils/format";

const loading = ref(false);
const saving = ref(false);
const running = ref(false);
const clearingToken = ref(false);
const authLinkLoading = ref(false);
const authDialogOpen = ref(false);
const config = ref<WeiwallSyncConfig | null>(null);
const runResult = ref<WeiwallSyncRunResult | null>(null);
const authSession = ref<WeiwallTokenAuthSession | null>(null);
const authStatus = ref<WeiwallTokenAuthStatus | null>(null);
const siteOrigin = ref("");
let authPollTimer: number | null = null;
let configSeq = 0;
let reloadSeq = 0;
let authPollSeq = 0;
let runSeq = 0;
let disposed = false;
const form = reactive({
  enabled: false,
  baseUrl: "https://s.weiwall.com",
  schoolEn: "cpu",
  tenantId: 7,
  intervalSeconds: 120,
  topicPages: 3,
  commentPageSize: 20,
  maxCommentPages: 10,
  maxReplyPages: 10,
  token: "",
});

const authStatusTitle = computed(() => {
  const status = authStatus.value?.status;
  if (status === "success") return "授权成功，新的 Token 已保存";
  if (status === "error") return "授权失败，请按提示重试";
  if (status === "expired") return "授权会话已过期，请重新生成二维码";
  return "等待微信完成授权";
});

const boardDisplayName = computed(() => {
  if (!config.value?.board) return "未绑定";
  return config.value.board.slug === "campus-wall" ? "逛逛" : config.value.board.name;
});

const activeSiteOrigin = computed(() => siteOrigin.value.trim() || window.location.origin);

const authOriginHint = computed(() => {
  const callbackUrl = authSession.value?.callbackUrl || "";
  const activeOrigin = activeSiteOrigin.value;
  const callbackHost = safeHostname(callbackUrl);
  const activeHost = safeHostname(activeOrigin);
  if (!siteOrigin.value.trim()) {
    if (isLoopbackHost(activeHost)) {
      return {
        type: "error" as const,
        title: "当前站点域名未配置，回调地址会落到本地地址，手机微信无法完成回调。请先到“基础配置”里保存一个可公网访问的 HTTPS 域名。",
      };
    }
    return {
      type: "warning" as const,
      title: "当前使用的是浏览器所在域名作为回调地址。若扫码后一直 pending，优先检查“基础配置”里的站点域名是否已配置成可公网访问的 HTTPS 域名。",
    };
  }
  if (isLoopbackHost(callbackHost)) {
    return {
      type: "error" as const,
      title: "当前回调地址仍然指向本地地址，请检查“基础配置”里的站点域名设置。",
    };
  }
  return null;
});

function safeHostname(input: string) {
  try {
    return new URL(input).hostname.trim().toLowerCase();
  } catch {
    return "";
  }
}

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function hydrate(next: WeiwallSyncConfig) {
  config.value = next;
  form.enabled = next.enabled;
  form.baseUrl = next.baseUrl;
  form.schoolEn = next.schoolEn;
  form.tenantId = next.tenantId;
  form.intervalSeconds = next.intervalSeconds;
  form.topicPages = next.topicPages;
  form.commentPageSize = next.commentPageSize;
  form.maxCommentPages = next.maxCommentPages;
  form.maxReplyPages = next.maxReplyPages;
  form.token = "";
}

async function reload() {
  if (disposed) return;
  const seq = ++configSeq;
  const loadingSeq = ++reloadSeq;
  loading.value = true;
  try {
    const [nextConfig, nextSiteConfig] = await Promise.all([
      adminApi.weiwallSync(),
      adminApi.siteConfig(),
    ]);
    if (disposed || seq !== configSeq) return;
    hydrate(nextConfig);
    siteOrigin.value = readSiteOrigin(nextSiteConfig);
  } finally {
    if (!disposed && loadingSeq === reloadSeq) loading.value = false;
  }
}

function readSiteOrigin(next: SiteConfig) {
  return String(next.siteOrigin || "").trim();
}

async function save() {
  if (disposed || saving.value) return;
  const seq = ++configSeq;
  saving.value = true;
  try {
    const next = await adminApi.updateWeiwallSync({
      enabled: form.enabled,
      baseUrl: form.baseUrl.trim(),
      schoolEn: form.schoolEn.trim(),
      tenantId: Number(form.tenantId),
      intervalSeconds: Number(form.intervalSeconds),
      topicPages: Number(form.topicPages),
      commentPageSize: Number(form.commentPageSize),
      maxCommentPages: Number(form.maxCommentPages),
      maxReplyPages: Number(form.maxReplyPages),
      token: form.token.trim() || undefined,
    });
    if (disposed || seq !== configSeq) return;
    hydrate(next);
    ElMessage.success("逛逛同步配置已保存");
  } finally {
    if (!disposed) saving.value = false;
  }
}

async function clearToken() {
  if (disposed || clearingToken.value) return;
  const seq = ++configSeq;
  clearingToken.value = true;
  try {
    const next = await adminApi.updateWeiwallSync({ clearToken: true });
    if (disposed || seq !== configSeq) return;
    hydrate(next);
    ElMessage.success("已清空保存的 Token");
  } finally {
    if (!disposed) clearingToken.value = false;
  }
}

function stopAuthPolling() {
  if (authPollTimer !== null) {
    window.clearInterval(authPollTimer);
    authPollTimer = null;
  }
}

async function pollAuthStatus() {
  if (disposed) return;
  if (!authSession.value?.flowId) return;
  const seq = authPollSeq;
  const flowId = authSession.value.flowId;
  const next = await adminApi.getWeiwallAuthStatus(flowId);
  if (disposed || seq !== authPollSeq || authSession.value?.flowId !== flowId) return;
  authStatus.value = next;
  if (next.status === "success") {
    stopAuthPolling();
    ElMessage.success("逛逛 Token 已自动更新");
    await reload();
    return;
  }
  if (next.status === "error" || next.status === "expired") {
    stopAuthPolling();
  }
}

async function startWechatAuth() {
  if (disposed || authLinkLoading.value) return;
  if (!siteOrigin.value.trim() && isLoopbackHost(window.location.hostname.trim().toLowerCase())) {
    ElMessage.error("当前页面是本地地址，请先到“基础配置”里设置可公网访问的站点域名，再生成微信授权二维码");
    return;
  }
  const seq = ++authPollSeq;
  authLinkLoading.value = true;
  try {
    const nextSession = await adminApi.createWeiwallAuthLink(window.location.origin);
    if (disposed || seq !== authPollSeq) return;
    authSession.value = nextSession;
    authStatus.value = {
      flowId: authSession.value.flowId,
      status: "pending",
      expiresAt: authSession.value.expiresAt,
      completedAt: null,
      error: null,
    };
    authDialogOpen.value = true;
    stopAuthPolling();
    authPollTimer = window.setInterval(() => {
      if (disposed || seq !== authPollSeq) return;
      pollAuthStatus().catch(() => null);
    }, 3000);
    await pollAuthStatus();
  } finally {
    if (!disposed && seq === authPollSeq) authLinkLoading.value = false;
  }
}

function openAuthorizeUrl() {
  if (!authSession.value?.authorizeUrl) return;
  window.open(authSession.value.authorizeUrl, "_blank", "noopener,noreferrer");
}

async function copyAuthorizeUrl() {
  if (!authSession.value?.authorizeUrl) return;
  await navigator.clipboard.writeText(authSession.value.authorizeUrl);
  ElMessage.success("授权链接已复制");
}

async function runNow() {
  if (disposed || running.value) return;
  const seq = ++runSeq;
  running.value = true;
  try {
    const nextResult = await adminApi.runWeiwallSync();
    if (disposed || seq !== runSeq) return;
    runResult.value = nextResult;
    if (nextResult.ok) ElMessage.success("逛逛同步已完成");
    else ElMessage.warning(nextResult.error || "逛逛同步未完成");
    await reload();
  } finally {
    if (!disposed && seq === runSeq) running.value = false;
  }
}

onMounted(() => {
  disposed = false;
  void reload();
});
onBeforeUnmount(() => {
  disposed = true;
  configSeq += 1;
  reloadSeq += 1;
  authPollSeq += 1;
  runSeq += 1;
  loading.value = false;
  saving.value = false;
  running.value = false;
  clearingToken.value = false;
  authLinkLoading.value = false;
  stopAuthPolling();
});
</script>

<style scoped>
.weiwall-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pane-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.pane-header h3 {
  margin: 0 0 4px;
  font-size: 16px;
}

.pane-header p {
  margin: 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}

.pane-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.status-card {
  border: 1px solid #eef2f7;
  border-radius: 12px;
  padding: 12px 14px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-card .label,
.result-item span {
  color: #6b7280;
  font-size: 12px;
}

.status-card .value,
.result-item b {
  color: #111827;
  font-size: 14px;
}

.muted {
  color: #9ca3af;
  font-size: 12px;
}

.config-form {
  margin-top: 6px;
}

.field-tip {
  margin-top: 6px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}

.field-tip code {
  font-family: Consolas, monospace;
  word-break: break-all;
}

.form-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.result-item {
  border: 1px solid #eef2f7;
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.trace-block {
  margin-top: 16px;
}

.trace-title {
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 700;
  color: #1f2937;
}

.trace-table-scroll {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.trace-table-scroll :deep(.trace-table) {
  min-width: 1180px;
}

.run-error {
  margin-bottom: 14px;
}

.auth-dialog {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.auth-tip {
  margin: 0;
  color: #4b5563;
  line-height: 1.7;
}

.auth-qr {
  width: min(320px, 78dvw);
  max-width: 100%;
  border-radius: 14px;
  border: 1px solid #e5e7eb;
  background: #fff;
  padding: 10px;
}

.auth-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}

@media (max-width: 900px) {
  .status-grid,
  .result-grid {
    grid-template-columns: 1fr;
  }

  .pane-header {
    flex-direction: column;
  }

  .pane-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
