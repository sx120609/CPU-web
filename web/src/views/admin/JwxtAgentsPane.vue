<template>
  <section class="agent-pane" v-loading="loading">
    <div class="pane-head">
      <div>
        <h2>教务服务节点</h2>
        <p>Agent 主动连接本站，不需要公网端口或 FRP。会话正常粘在创建节点，节点故障时可加密迁移到其他教务节点。</p>
      </div>
      <div class="head-actions cpu-button-row">
        <el-button @click="load">刷新状态</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
      </div>
    </div>

    <el-alert
      v-if="source === 'environment'"
      title="当前显示环境变量中的初始配置；首次保存后将由管理面板配置接管。"
      type="info"
      :closable="false"
      show-icon
    />

    <el-alert
      title="跨节点会话保护已启用"
      description="源 Agent 会为每个目标节点分别加密 CookieJar，主服务与 Redis 只接触密文；身份首次上线固定，会话默认保留 365 天，且只迁移幂等查询。"
      type="success"
      :closable="false"
      show-icon
    />

    <div class="endpoint-card">
      <div>
        <span class="eyebrow">Agent 连接地址</span>
        <code>{{ connectionUrl }}</code>
      </div>
      <el-button text type="primary" @click="copyText(connectionUrl)">复制地址</el-button>
    </div>

    <div class="settings-grid">
      <div class="setting-card local-card">
        <div class="setting-title">
          <div>
            <strong>本机教务服务</strong>
            <span>让当前主服务同时参与登录、教务会话和查询负载均衡</span>
          </div>
          <el-switch v-model="form.localJwxtEnabled" />
        </div>
        <label class="field-row">
          <span>负载权重</span>
          <el-input-number v-model="form.localJwxtWeight" :min="1" :max="100" :disabled="!form.localJwxtEnabled" />
        </label>
        <div v-if="form.localJwxtEnabled && localLoginPool" class="login-health" :class="localLoginPool.available ? 'healthy' : 'unavailable'">
          <strong>{{ localLoginPool.available ? '登录池可用' : loginStatusText(localLoginPool) }}</strong>
          <span v-if="localLoginPool.lastError">{{ localLoginPool.lastError }}</span>
        </div>
      </div>

      <div class="setting-card crawl-card">
        <div class="setting-title">
          <div>
            <strong>公告抓取节点</strong>
            <span>只使用这里指定的一台 Agent，不参与负载均衡</span>
          </div>
        </div>
        <el-select v-model="form.crawlAgentId" clearable placeholder="不指定（回退到旧代理或本机）">
          <el-option
            v-for="agent in crawlCandidates"
            :key="agent.id"
            :label="agent.name"
            :value="agent.id"
          />
        </el-select>
      </div>
    </div>

    <div class="list-head">
      <div>
        <h3>远程 Agent</h3>
        <span>{{ onlineCount }} / {{ form.agents.length }} 在线</span>
        <span v-if="serverCommit" class="version-summary">
          · 主站版本 <code :title="serverCommit">{{ shortCommit(serverCommit) }}</code>
          <template v-if="differingCount"> · {{ differingCount }} 个在线节点版本不同</template>
          <template v-else-if="onlineCount"> · 在线节点都与主站同版本</template>
        </span>
      </div>
      <el-button type="primary" plain @click="openAdd">添加 Agent</el-button>
    </div>

    <el-empty v-if="!form.agents.length" description="还没有远程 Agent，添加后让节点主动连接本站" />

    <div v-else class="agent-list">
      <article v-for="agent in form.agents" :key="agent.id" class="agent-card" :class="{ disabled: !agent.enabled }">
        <div class="agent-card-head">
          <div class="agent-identity">
            <span class="status-dot" :class="agent.connection.ready ? 'online' : 'offline'"></span>
            <div>
              <div class="agent-name-row">
                <strong>{{ agent.name }}</strong>
                <el-tag size="small" :type="agent.connection.ready ? 'success' : 'info'">
                  {{ agent.connection.ready ? '在线' : '离线' }}
                </el-tag>
                <el-tag v-if="!agent.enabled" size="small" type="warning">已停用</el-tag>
                <el-tag
                  v-else-if="agent.jwxtEnabled && agent.connection.ready && agent.loginPool && !agent.loginPool.available"
                  size="small"
                  type="danger"
                >
                  {{ loginStatusText(agent.loginPool) }}
                </el-tag>
              </div>
              <code>{{ agent.id }}</code>
            </div>
          </div>
          <el-switch v-model="agent.enabled" inline-prompt active-text="启用" inactive-text="停用" />
        </div>

        <div class="capability-grid">
          <label class="capability-item">
            <div>
              <strong>教务服务</strong>
              <span>统一认证登录 + 教务查询 + 宿舍电费查询</span>
            </div>
            <el-switch v-model="agent.jwxtEnabled" :disabled="!agent.enabled" />
          </label>
          <label class="capability-item">
            <div>
              <strong>公告抓取</strong>
              <span>允许访问校内公告源；仍需在上方指定</span>
            </div>
            <el-switch v-model="agent.crawlEnabled" :disabled="!agent.enabled" @change="onCrawlCapabilityChange(agent)" />
          </label>
        </div>

        <div
          v-if="agent.jwxtEnabled && agent.loginPool?.lastError"
          class="agent-login-error"
        >
          <strong>最近一次登录节点错误</strong>
          <span>{{ agent.loginPool.lastError }}</span>
        </div>

        <div class="agent-fields">
          <label>
            <span>显示名称</span>
            <el-input v-model="agent.name" maxlength="80" />
          </label>
          <label>
            <span>负载权重</span>
            <el-input-number v-model="agent.weight" :min="1" :max="100" :disabled="!agent.jwxtEnabled" />
          </label>
          <label>
            <span>最大并发</span>
            <el-input-number v-model="agent.maxConcurrent" :min="1" :max="100" />
          </label>
          <div class="runtime-stat">
            <span>当前请求</span>
            <strong>{{ agent.connection.inFlight }} / {{ agent.maxConcurrent }}</strong>
          </div>
        </div>

        <div class="agent-version">
          <div class="version-main">
            <span class="eyebrow">运行版本</span>
            <code v-if="agent.connection.buildCommit" :title="agent.connection.buildCommit">{{ shortCommit(agent.connection.buildCommit) }}</code>
            <span v-else class="version-unknown">{{ agent.connection.ready ? "未知" : "离线，无法得知" }}</span>
            <el-tag v-if="versionTag(agent)" size="small" :type="versionTag(agent)!.type" effect="plain">{{ versionTag(agent)!.label }}</el-tag>
            <span v-if="agent.connection.ready" class="version-meta">
              {{ platformLabel(agent.connection.platform) }}<template v-if="agent.connection.connectedAt"> · {{ formatClock(agent.connection.connectedAt) }} 连上</template>
            </span>
          </div>
          <p v-if="missingFeatures(agent).length" class="version-note is-warning">
            这个版本还不支持：{{ missingFeatures(agent).join("；") }}。更新后才能用。
          </p>
          <p v-if="updateLine(agent)" class="version-note" :class="`is-${updateLine(agent)!.tone}`" role="status">
            <el-icon v-if="updateLine(agent)!.busy" class="is-loading"><Loading /></el-icon>
            <span>{{ updateLine(agent)!.text }}</span>
          </p>
        </div>

        <div class="agent-card-foot">
          <span class="identity-state" :title="agent.replicaKeyFingerprint">
            {{ agent.replicaIdentityPinned ? 'Agent 加密身份已固定' : '首次上线后固定加密身份' }}
          </span>
          <span class="token-state">密钥已配置，服务端不会再次返回明文</span>
          <div class="cpu-button-row">
            <el-button
              text
              type="success"
              :disabled="!agent.connection.ready || agent.update?.status === 'pending'"
              :loading="updatingAgentId === agent.id"
              @click="updateAgent(agent)"
            >{{ agent.update?.status === "pending" ? "更新中" : "远程更新" }}</el-button>
            <el-button
              v-if="agent.replicaIdentityPinned"
              text
              type="warning"
              @click="resetIdentity(agent)"
            >解除身份固定</el-button>
            <el-button text type="primary" @click="rotateToken(agent)">重置密钥</el-button>
            <el-button text @click="removeAgent(agent)">移除</el-button>
          </div>
        </div>
      </article>
    </div>

    <section class="error-card">
      <div class="list-head">
        <div>
          <h3>学生遇到的教务错误</h3>
          <span v-if="errorStats">最近 {{ errorStats.windowHours }} 小时 · {{ errorStats.requests }} 次请求 · {{ errorStats.errors }} 次出错（本进程统计，部署后重新计数）</span>
        </div>
        <el-button size="small" :loading="errorsLoading" @click="loadErrors">刷新</el-button>
      </div>
      <p v-if="errorStats && !errorStats.kinds.length" class="error-empty">这段时间没有出错。</p>
      <ul v-else-if="errorStats" class="error-list">
        <li v-for="kind in errorStats.kinds" :key="`${kind.status}-${kind.code}-${kind.message}`">
          <div class="error-main">
            <b>{{ kind.count }}</b>
            <span class="error-message">{{ kind.message || "（无说明）" }}</span>
            <el-tag size="small" :type="errorTagType(kind)">{{ errorKindLabel(kind) }}</el-tag>
          </div>
          <small>{{ kind.status }} · {{ kind.code || "-" }} · 最近 {{ formatClock(Date.parse(kind.lastAt)) }} · {{ kind.paths.map((item) => `${item.path} ×${item.count}`).join("，") }}</small>
        </li>
      </ul>
    </section>

    <el-dialog v-model="addVisible" title="添加教务 Agent" width="520px" append-to-body>
      <el-form label-position="top">
        <el-form-item label="Agent ID">
          <el-input v-model="draft.id" placeholder="例如 campus-node-01" maxlength="64" />
        </el-form-item>
        <el-form-item label="显示名称">
          <el-input v-model="draft.name" placeholder="例如 校内节点 01" maxlength="80" />
        </el-form-item>
        <div class="dialog-capabilities">
          <el-checkbox v-model="draft.jwxtEnabled">教务服务（含登录）</el-checkbox>
          <el-checkbox v-model="draft.crawlEnabled">公告抓取</el-checkbox>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="generating" @click="addAgent">生成密钥并保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="secretVisible" title="保存 Agent 连接配置" width="660px" append-to-body @closed="clearVisibleSecret">
      <el-alert title="Agent 已保存。密钥只在本次操作中显示，请关闭前复制到 Agent 机器。" type="warning" :closable="false" show-icon />
      <pre class="env-block">{{ visibleEnv }}</pre>
      <template #footer>
        <el-button @click="copyText(visibleEnv)">复制完整配置</el-button>
        <el-button type="primary" @click="secretVisible = false">我已保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type { JwxtErrorStats } from "@/api/admin";
import { ElMessage, ElMessageBox } from "element-plus";
import { Loading } from "@element-plus/icons-vue";
import {
  agentUpdateLine,
  agentUpdateToast,
  agentVersionTag,
  formatClock,
  missingAgentFeatures,
  shortCommit,
} from "./jwxtAgentVersion";
import {
  adminApi,
  type JwxtAgentAdminItem,
  type JwxtAgentUpdateView,
  type JwxtAgentsAdminConfig,
  type JwxtAgentsAdminPatch,
  type JwxtLoginPoolNode,
} from "@/api/admin";

type EditableAgent = JwxtAgentAdminItem & { pendingToken?: string };

const loading = ref(false);
const saving = ref(false);
const generating = ref(false);
const updatingAgentId = ref("");
const serverCommit = ref("");
const knownFeatures = ref<string[]>([]);
// 每秒走一格，让“已等多久”自己往前跳。
const now = ref(Date.now());
let clockTimer: number | undefined;
let pollTimer: number | undefined;
let polling = false;
const source = ref<"environment" | "database">("environment");
const agentPath = ref("/api/internal/jwxt-agent/connect");
const localLoginPool = ref<JwxtLoginPoolNode | null>(null);
const form = reactive<{ localJwxtEnabled: boolean; localJwxtWeight: number; crawlAgentId: string; agents: EditableAgent[] }>({
  localJwxtEnabled: false,
  localJwxtWeight: 1,
  crawlAgentId: "",
  agents: [],
});
const addVisible = ref(false);
const secretVisible = ref(false);
const visibleSecret = ref("");
const visibleAgentId = ref("");
const draft = reactive({ id: "", name: "", jwxtEnabled: true, crawlEnabled: false });

const connectionUrl = computed(() => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${agentPath.value}`;
});
const crawlCandidates = computed(() => form.agents.filter((agent) => agent.enabled && agent.crawlEnabled));
const onlineCount = computed(() => form.agents.filter((agent) => agent.connection.ready).length);
const differingCount = computed(() => form.agents.filter((agent) => (
  agentVersionTag(agent.connection, serverCommit.value)?.type === "warning"
)).length);
const pendingAgentIds = computed(() => form.agents.filter((agent) => agent.update?.status === "pending").map((agent) => agent.id));

function versionTag(agent: EditableAgent) {
  return agentVersionTag(agent.connection, serverCommit.value);
}

function missingFeatures(agent: EditableAgent) {
  return missingAgentFeatures(agent.connection, knownFeatures.value);
}

function updateLine(agent: EditableAgent) {
  return agentUpdateLine(agent.update, now.value);
}

function platformLabel(platform?: string) {
  return platform === "win32" ? "Windows" : platform === "linux" ? "Linux" : platform === "darwin" ? "macOS" : "系统未知";
}

function applyUpdateView(agentId: string, update: JwxtAgentUpdateView, connection?: JwxtAgentAdminItem["connection"]) {
  const agent = form.agents.find((item) => item.id === agentId);
  if (!agent) return;
  const wasPending = agent.update?.status === "pending";
  agent.update = update;
  if (connection) agent.connection = connection;
  if (!wasPending || update.status === "pending") return;
  const toast = agentUpdateToast(agent.name, update);
  if (toast) ElMessage({ type: toast.type, message: toast.text, duration: 8000 });
}

// 只在有更新进行中时轮询，并且只替换连接状态和更新结论，不动表单里还没保存的修改。
async function pollPendingUpdates() {
  if (polling) return;
  polling = true;
  try {
    await Promise.all(pendingAgentIds.value.map(async (agentId) => {
      try {
        const status = await adminApi.jwxtAgentUpdateStatus(agentId, { suppressErrorMessage: true, cacheTtlMs: 0 });
        applyUpdateView(agentId, status.update, status.connection);
      } catch { /* 下一轮再问 */ }
    }));
  } finally {
    polling = false;
  }
}

watch(() => pendingAgentIds.value.length > 0, (active) => {
  window.clearInterval(pollTimer);
  window.clearInterval(clockTimer);
  pollTimer = undefined;
  clockTimer = undefined;
  if (!active) return;
  now.value = Date.now();
  clockTimer = window.setInterval(() => { now.value = Date.now(); }, 1000);
  pollTimer = window.setInterval(() => { void pollPendingUpdates(); }, 5000);
}, { immediate: true });

onBeforeUnmount(() => {
  window.clearInterval(pollTimer);
  window.clearInterval(clockTimer);
});
const visibleEnv = computed(() => [
  `JWXT_AGENT_SERVER=${connectionUrl.value}`,
  `JWXT_AGENT_ID=${visibleAgentId.value}`,
  `JWXT_AGENT_TOKEN=${visibleSecret.value}`,
  "NODE_ENV=production",
  "REDIS_ENABLED=false",
].join("\n"));

async function load() {
  loading.value = true;
  try {
    const data = await adminApi.jwxtAgents();
    applySnapshot(data);
  } finally {
    loading.value = false;
  }
  void loadErrors();
}

const errorStats = ref<JwxtErrorStats | null>(null);
const errorsLoading = ref(false);

async function loadErrors() {
  errorsLoading.value = true;
  try {
    errorStats.value = await adminApi.jwxtErrors();
  } catch {
    /* 请求层已提示 */
  } finally {
    errorsLoading.value = false;
  }
}

function errorKindLabel(kind: JwxtErrorStats["kinds"][number]) {
  if (kind.code === 4011) return "授权失效";
  if (kind.code === 4001) return "站内登录";
  if (kind.code === 5021) return "学校拒绝";
  if (kind.status === 504) return "超时";
  if (kind.status === 503) return "暂不可用";
  if (kind.status >= 500) return "服务出错";
  return "请求错误";
}

function errorTagType(kind: JwxtErrorStats["kinds"][number]) {
  if (kind.code === 4011) return "warning";
  if (kind.status >= 500) return "danger";
  return "info";
}

async function save() {
  if (form.crawlAgentId && !crawlCandidates.value.some((agent) => agent.id === form.crawlAgentId)) {
    ElMessage.warning("公告抓取节点必须已启用公告抓取能力");
    return;
  }
  saving.value = true;
  try {
    await persistCurrentForm();
    ElMessage.success("教务 Agent 配置已生效");
  } finally {
    saving.value = false;
  }
}

function openAdd() {
  Object.assign(draft, { id: "", name: "", jwxtEnabled: true, crawlEnabled: false });
  addVisible.value = true;
}

async function addAgent() {
  const id = draft.id.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    ElMessage.warning("Agent ID 只能包含字母、数字、点、下划线和短横线");
    return;
  }
  if (form.agents.some((agent) => agent.id === id)) {
    ElMessage.warning("Agent ID 已存在");
    return;
  }
  generating.value = true;
  try {
    const { token } = await adminApi.generateJwxtAgentToken();
    const newAgent: EditableAgent = {
      id,
      name: draft.name.trim() || id,
      enabled: true,
      jwxtEnabled: draft.jwxtEnabled,
      crawlEnabled: draft.crawlEnabled,
      weight: 1,
      maxConcurrent: 4,
      tokenConfigured: true,
      replicaIdentityPinned: false,
      replicaKeyFingerprint: "",
      pendingToken: token,
      connection: {
        configured: false, online: false, ready: false, inFlight: 0, maxConcurrent: 4,
        connectedAt: null, lastPongAt: null, jwxtEnabled: draft.jwxtEnabled, crawlEnabled: draft.crawlEnabled,
      },
      pool: null,
      loginPool: null,
    };
    form.agents.push(newAgent);
    try {
      await persistCurrentForm();
    } catch (error) {
      form.agents = form.agents.filter((agent) => agent !== newAgent);
      throw error;
    }
    addVisible.value = false;
    showSecret(id, token);
    ElMessage.success("Agent 已添加并保存");
  } finally {
    generating.value = false;
  }
}

async function rotateToken(agent: EditableAgent) {
  await ElMessageBox.confirm(
    `重置后 ${agent.name} 会立即断线，必须更新该机器的 JWXT_AGENT_TOKEN 才能重新连接。`,
    "确认重置密钥",
    { type: "warning", confirmButtonText: "继续重置" },
  );
  const { token } = await adminApi.generateJwxtAgentToken();
  const previousToken = agent.pendingToken;
  agent.pendingToken = token;
  try {
    await persistCurrentForm();
  } catch (error) {
    agent.pendingToken = previousToken;
    throw error;
  }
  showSecret(agent.id, token);
  ElMessage.success("Agent 密钥已重置");
}

async function resetIdentity(agent: EditableAgent) {
  await ElMessageBox.confirm(
    `仅在 ${agent.name} 已停止、并且你准备更换该节点的 JWXT_AGENT_KEY_FILE 时继续。解除后，下一次成功连接的公钥会成为新的固定身份。`,
    "确认解除 Agent 加密身份固定",
    {
      type: "warning",
      confirmButtonText: "我已停止节点，继续",
      cancelButtonText: "取消",
    },
  );
  await adminApi.resetJwxtAgentIdentity(agent.id);
  await load();
  ElMessage.success("已解除身份固定，请立即用新的身份文件启动 Agent");
}

async function updateAgent(agent: EditableAgent) {
  await ElMessageBox.confirm(
    `${agent.name} 将在后台下载并校验 GitHub 构建制品，然后重启。期间会短暂离线，完成后自动重连。`,
    "确认远程更新 Agent",
    {
      type: "warning",
      confirmButtonText: "开始更新",
      cancelButtonText: "取消",
    },
  );
  updatingAgentId.value = agent.id;
  try {
    const result = await adminApi.updateJwxtAgent(agent.id);
    if (result.update) applyUpdateView(agent.id, result.update);
    // “已下发”只说明节点收到了指令；成没成看这张卡片上随后给出的结论。
    ElMessage.info(result.alreadyScheduled ? "该节点已经在更新中，结果会显示在卡片上" : "指令已下发，更新结果会显示在这张卡片上");
  } finally {
    updatingAgentId.value = "";
  }
}

async function removeAgent(agent: EditableAgent) {
  await ElMessageBox.confirm(`确定移除 ${agent.name}？已有会话将要求用户重新登录。`, "移除 Agent", { type: "warning" });
  const previousAgents = form.agents;
  const previousCrawlAgentId = form.crawlAgentId;
  form.agents = form.agents.filter((item) => item.id !== agent.id);
  if (form.crawlAgentId === agent.id) form.crawlAgentId = "";
  try {
    await persistCurrentForm();
    ElMessage.success("Agent 已移除");
  } catch (error) {
    form.agents = previousAgents;
    form.crawlAgentId = previousCrawlAgentId;
    throw error;
  }
}

function buildPayload(): JwxtAgentsAdminPatch {
  return {
    localJwxtEnabled: form.localJwxtEnabled,
    localJwxtWeight: form.localJwxtWeight,
    crawlAgentId: form.crawlAgentId,
    agents: form.agents.map((agent) => ({
      id: agent.id,
      name: agent.name.trim(),
      ...(agent.pendingToken ? { token: agent.pendingToken } : {}),
      enabled: agent.enabled,
      jwxtEnabled: agent.jwxtEnabled,
      crawlEnabled: agent.crawlEnabled,
      weight: agent.weight,
      maxConcurrent: agent.maxConcurrent,
    })),
  };
}

async function persistCurrentForm() {
  const data = await adminApi.updateJwxtAgents(buildPayload());
  applySnapshot(data);
}

function applySnapshot(data: JwxtAgentsAdminConfig) {
  source.value = data.source;
  agentPath.value = data.agentPath;
  serverCommit.value = data.serverCommit ?? "";
  knownFeatures.value = data.knownFeatures ?? [];
  localLoginPool.value = data.localLoginPool;
  form.localJwxtEnabled = data.localJwxtEnabled;
  form.localJwxtWeight = data.localJwxtWeight;
  form.crawlAgentId = data.crawlAgentId;
  form.agents = data.agents.map((agent) => ({ ...agent }));
}

function loginStatusText(pool: JwxtLoginPoolNode) {
  if (pool.available) return "登录池可用";
  return "登录池不可用";
}

function onCrawlCapabilityChange(agent: EditableAgent) {
  if (!agent.crawlEnabled && form.crawlAgentId === agent.id) form.crawlAgentId = "";
}

function showSecret(agentId: string, token: string) {
  visibleAgentId.value = agentId;
  visibleSecret.value = token;
  secretVisible.value = true;
}

function clearVisibleSecret() {
  visibleAgentId.value = "";
  visibleSecret.value = "";
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
  ElMessage.success("已复制");
}

onMounted(load);
</script>

<style scoped>
.error-card { padding: 18px; border: 1px solid var(--cpu-border-soft); border-radius: 14px; background: var(--cpu-surface); }
.error-empty { margin: 12px 0 0; color: var(--cpu-text-secondary); font-size: 13px; }
.error-list { display: grid; gap: 10px; margin: 12px 0 0; padding: 0; list-style: none; }
.error-list li { display: grid; gap: 4px; padding-bottom: 10px; border-bottom: 1px solid var(--cpu-border-soft); }
.error-list li:last-child { padding-bottom: 0; border-bottom: 0; }
.error-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.error-main b { flex: 0 0 auto; min-width: 36px; color: var(--cpu-text); font-variant-numeric: tabular-nums; }
.error-message { flex: 1; min-width: 0; color: var(--cpu-text); overflow-wrap: anywhere; }
.error-list small { color: var(--cpu-text-secondary); font-size: 12px; overflow-wrap: anywhere; }
.agent-pane { display: grid; gap: 18px; }
.pane-head, .list-head, .agent-card-head, .agent-card-foot, .setting-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.pane-head h2, .list-head h3 { margin: 0; color: var(--cpu-text); }
.pane-head p { margin: 6px 0 0; color: var(--cpu-text-secondary); line-height: 1.65; }
.head-actions { display: flex; flex: 0 0 auto; gap: 8px; }
.endpoint-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 18px; border: 1px solid var(--cpu-border-soft); border-radius: 14px; background: linear-gradient(135deg, color-mix(in srgb, var(--cpu-primary) 5%, var(--cpu-surface)), var(--cpu-surface-soft)); }
.endpoint-card > div { min-width: 0; display: grid; gap: 6px; }
.eyebrow { color: var(--cpu-text-secondary); font-size: 12px; }
code { color: var(--cpu-primary); font-family: var(--cpu-font-mono); overflow-wrap: anywhere; }
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.setting-card { padding: 18px; border: 1px solid var(--cpu-border-soft); border-radius: 14px; background: var(--cpu-surface); }
.setting-title strong, .setting-title span { display: block; }
.setting-title strong { color: var(--cpu-text); }
.setting-title span { margin-top: 5px; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.5; }
.field-row { margin-top: 18px; display: flex; align-items: center; justify-content: space-between; color: var(--cpu-text-secondary); }
.crawl-card .el-select { width: 100%; margin-top: 18px; }
.list-head > div { display: flex; align-items: baseline; gap: 10px; }
.list-head span { color: var(--cpu-text-secondary); font-size: 13px; }
.agent-list { display: grid; gap: 14px; }
.agent-card { overflow: hidden; border: 1px solid var(--cpu-border-soft); border-radius: 16px; color: var(--cpu-text); background: var(--cpu-surface); box-shadow: var(--cpu-shadow-sm); transition: opacity .2s, border-color .2s, background-color .2s; }
.agent-card.disabled { opacity: .72; }
.agent-card-head { padding: 18px 20px; border-bottom: 1px solid var(--cpu-border-soft); }
.agent-identity { min-width: 0; display: flex; align-items: center; gap: 12px; }
.status-dot { width: 10px; height: 10px; flex: 0 0 auto; border-radius: 50%; box-shadow: 0 0 0 4px currentColor; }
.status-dot.online { color: rgba(34, 197, 94, .14); background: #22c55e; }
.status-dot.offline { color: rgba(148, 163, 184, .16); background: #94a3b8; }
.agent-name-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 5px; }
.capability-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 16px 20px; background: var(--cpu-surface-soft); }
.capability-item { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 14px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-surface); }
.capability-item strong, .capability-item span { display: block; }
.capability-item span { margin-top: 4px; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.45; }
.login-health { display: grid; gap: 4px; margin-top: 14px; padding: 10px 12px; border-radius: 10px; font-size: 12px; }
.login-health.healthy { background: color-mix(in srgb, var(--cpu-success) 12%, var(--cpu-surface)); color: var(--cpu-success); }
.login-health.unavailable { background: color-mix(in srgb, var(--cpu-danger) 12%, var(--cpu-surface)); color: var(--cpu-danger); }
.login-health span { overflow-wrap: anywhere; opacity: .85; }
.agent-login-error { display: flex; align-items: flex-start; gap: 10px; margin: 0 20px 2px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--cpu-danger) 35%, var(--cpu-border-soft)); border-radius: 10px; background: color-mix(in srgb, var(--cpu-danger) 10%, var(--cpu-surface)); color: var(--cpu-danger); font-size: 12px; line-height: 1.5; }
.agent-login-error strong { flex: 0 0 auto; }
.agent-login-error span { min-width: 0; overflow-wrap: anywhere; }
.agent-fields { display: grid; grid-template-columns: minmax(180px, 1.5fr) repeat(3, minmax(120px, 1fr)); gap: 14px; padding: 18px 20px; }
.agent-fields label { display: grid; gap: 7px; color: var(--cpu-text-secondary); font-size: 13px; }
.agent-fields .el-input-number { width: 100%; }
.runtime-stat { display: grid; align-content: center; justify-items: start; gap: 7px; color: var(--cpu-text-secondary); font-size: 13px; }
.runtime-stat strong { color: var(--cpu-text); font-size: 16px; }
.agent-version { display: grid; gap: 8px; padding: 0 20px 16px; }
.version-main { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.version-main code { font-size: 13px; }
.version-unknown, .version-meta { color: var(--cpu-text-muted); font-size: 12px; }
.version-summary { color: var(--cpu-text-secondary); font-size: 13px; }
.version-note { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 8px 12px; border-radius: 10px; background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.version-note .el-icon { flex: 0 0 auto; margin-top: 3px; }
.version-note.is-success { background: color-mix(in srgb, var(--cpu-success) 10%, var(--cpu-surface)); color: var(--cpu-success); }
.version-note.is-warning { background: color-mix(in srgb, var(--cpu-warn) 12%, var(--cpu-surface)); color: var(--cpu-warn); }
.version-note.is-danger { background: color-mix(in srgb, var(--cpu-danger) 10%, var(--cpu-surface)); color: var(--cpu-danger); }
.agent-card-foot { padding: 10px 14px 10px 20px; border-top: 1px solid var(--cpu-border-soft); }
.identity-state { color: var(--cpu-text-secondary); }
.token-state { color: var(--cpu-text-muted); font-size: 12px; }
.dialog-capabilities { display: flex; gap: 24px; }
.env-block { margin: 16px 0 0; padding: 16px; overflow: auto; border-radius: 12px; background: #111827; color: #d1fae5; font: 13px/1.7 var(--cpu-font-mono); }
html[data-theme="dark"] .agent-card {
  box-shadow: 0 8px 24px rgba(0, 0, 0, .2);
}
html[data-theme="dark"] .capability-grid {
  background: color-mix(in srgb, var(--cpu-bg) 46%, var(--cpu-surface-soft));
}
@media (max-width: 900px) {
  .pane-head { align-items: flex-start; flex-direction: column; }
  .settings-grid, .capability-grid { grid-template-columns: 1fr; }
  .agent-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .head-actions { width: 100%; }
  .head-actions .el-button { flex: 1; }
  .agent-fields { grid-template-columns: 1fr; }
  .agent-card-foot { align-items: flex-start; flex-direction: column; }
}
</style>
