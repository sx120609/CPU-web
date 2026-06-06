<template>
  <div class="weiwall-pane">
    <el-card shadow="never">
      <template #header>
        <div class="pane-header">
          <div>
            <h3>📮 校园墙同步</h3>
            <p>把外部校园墙的帖子和评论同步进本站，并按设定频率持续刷新。</p>
          </div>
          <div class="pane-actions">
            <el-button :loading="loading" @click="reload">刷新状态</el-button>
            <el-button type="primary" :loading="running" @click="runNow">立即同步一次</el-button>
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
            <span>{{ config.board?.name || "未绑定" }}</span>
            <span v-if="config.board" class="muted">/{{ config.board.slug }} · {{ config.board.topicCount }} 帖</span>
          </div>
        </div>
        <div class="status-card">
          <span class="label">Token</span>
          <div class="value">
            <span>{{ config.tokenPresent ? config.tokenPreview : "未配置" }}</span>
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
        </el-form-item>

        <div class="form-actions">
          <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
          <el-button :loading="authLinkLoading" @click="startWechatAuth">微信授权更新 Token</el-button>
          <el-button :disabled="!config.tokenPresent" :loading="clearingToken" @click="clearToken">清空已保存 Token</el-button>
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
      <el-alert v-if="runResult.error" class="run-error" type="error" :closable="false" :title="runResult.error" show-icon />
    </el-card>

    <el-dialog v-model="authDialogOpen" title="微信授权更新 Token" width="min(560px, 92vw)">
      <div v-if="authSession" class="auth-dialog">
        <p class="auth-tip">用微信扫描下方二维码，完成授权后服务器会自动换取并保存新的校园墙 Token。</p>
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
        <div class="field-tip">二维码有效期到：{{ fmtDate(authSession.expiresAt) }}</div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { adminApi, type WeiwallSyncConfig, type WeiwallSyncRunResult, type WeiwallTokenAuthSession, type WeiwallTokenAuthStatus } from "@/api/admin";
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
let authPollTimer: number | null = null;
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
  loading.value = true;
  try {
    hydrate(await adminApi.weiwallSync());
  } finally {
    loading.value = false;
  }
}

async function save() {
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
    hydrate(next);
    ElMessage.success("校园墙同步配置已保存");
  } finally {
    saving.value = false;
  }
}

async function clearToken() {
  clearingToken.value = true;
  try {
    const next = await adminApi.updateWeiwallSync({ clearToken: true });
    hydrate(next);
    ElMessage.success("已清空保存的 Token");
  } finally {
    clearingToken.value = false;
  }
}

function stopAuthPolling() {
  if (authPollTimer !== null) {
    window.clearInterval(authPollTimer);
    authPollTimer = null;
  }
}

async function pollAuthStatus() {
  if (!authSession.value?.flowId) return;
  const next = await adminApi.getWeiwallAuthStatus(authSession.value.flowId);
  authStatus.value = next;
  if (next.status === "success") {
    stopAuthPolling();
    ElMessage.success("校园墙 Token 已自动更新");
    await reload();
    return;
  }
  if (next.status === "error" || next.status === "expired") {
    stopAuthPolling();
  }
}

async function startWechatAuth() {
  authLinkLoading.value = true;
  try {
    authSession.value = await adminApi.createWeiwallAuthLink();
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
      pollAuthStatus().catch(() => null);
    }, 3000);
    await pollAuthStatus();
  } finally {
    authLinkLoading.value = false;
  }
}

function openAuthorizeUrl() {
  if (!authSession.value?.authorizeUrl) return;
  window.open(authSession.value.authorizeUrl, "_blank", "noopener");
}

async function copyAuthorizeUrl() {
  if (!authSession.value?.authorizeUrl) return;
  await navigator.clipboard.writeText(authSession.value.authorizeUrl);
  ElMessage.success("授权链接已复制");
}

async function runNow() {
  running.value = true;
  try {
    runResult.value = await adminApi.runWeiwallSync();
    if (runResult.value.ok) ElMessage.success("校园墙同步已完成");
    else ElMessage.warning(runResult.value.error || "校园墙同步未完成");
    await reload();
  } finally {
    running.value = false;
  }
}

onMounted(reload);
onBeforeUnmount(stopAuthPolling);
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
  width: min(320px, 78vw);
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
