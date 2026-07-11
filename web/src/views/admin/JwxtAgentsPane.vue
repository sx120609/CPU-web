<template>
  <section class="agent-pane" v-loading="loading">
    <div class="pane-head">
      <div>
        <h2>教务服务节点</h2>
        <p>Agent 主动连接本站，不需要公网端口或 FRP。教务登录与查询是同一项能力，会话始终留在创建它的节点。</p>
      </div>
      <div class="head-actions">
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
              <span>统一认证登录 + 教务登录 + 后续查询</span>
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

        <div class="agent-card-foot">
          <span class="token-state">密钥已配置，服务端不会再次返回明文</span>
          <div>
            <el-button text type="primary" @click="rotateToken(agent)">重置密钥</el-button>
            <el-button text @click="removeAgent(agent)">移除</el-button>
          </div>
        </div>
      </article>
    </div>

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
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  adminApi,
  type JwxtAgentAdminItem,
  type JwxtAgentsAdminConfig,
  type JwxtAgentsAdminPatch,
  type JwxtLoginPoolNode,
} from "@/api/admin";

type EditableAgent = JwxtAgentAdminItem & { pendingToken?: string };

const loading = ref(false);
const saving = ref(false);
const generating = ref(false);
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
.agent-pane { display: grid; gap: 18px; }
.pane-head, .list-head, .agent-card-head, .agent-card-foot, .setting-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.pane-head h2, .list-head h3 { margin: 0; color: #172033; }
.pane-head p { margin: 6px 0 0; color: #667085; line-height: 1.65; }
.head-actions { display: flex; flex: 0 0 auto; gap: 8px; }
.endpoint-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 18px; border: 1px solid #dce6f2; border-radius: 14px; background: linear-gradient(135deg, #f7fbff, #f8f7ff); }
.endpoint-card > div { min-width: 0; display: grid; gap: 6px; }
.eyebrow { color: #7b8798; font-size: 12px; }
code { color: #334155; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.setting-card { padding: 18px; border: 1px solid #e1e7ef; border-radius: 14px; background: #fff; }
.setting-title strong, .setting-title span { display: block; }
.setting-title span { margin-top: 5px; color: #87909f; font-size: 13px; line-height: 1.5; }
.field-row { margin-top: 18px; display: flex; align-items: center; justify-content: space-between; color: #5f6b7a; }
.crawl-card .el-select { width: 100%; margin-top: 18px; }
.list-head > div { display: flex; align-items: baseline; gap: 10px; }
.list-head span { color: #87909f; font-size: 13px; }
.agent-list { display: grid; gap: 14px; }
.agent-card { overflow: hidden; border: 1px solid #dfe6ef; border-radius: 16px; background: #fff; box-shadow: 0 5px 20px rgba(15, 23, 42, .04); transition: opacity .2s, border-color .2s; }
.agent-card.disabled { opacity: .72; }
.agent-card-head { padding: 18px 20px; border-bottom: 1px solid #edf1f6; }
.agent-identity { min-width: 0; display: flex; align-items: center; gap: 12px; }
.status-dot { width: 10px; height: 10px; flex: 0 0 auto; border-radius: 50%; box-shadow: 0 0 0 4px currentColor; }
.status-dot.online { color: rgba(34, 197, 94, .14); background: #22c55e; }
.status-dot.offline { color: rgba(148, 163, 184, .16); background: #94a3b8; }
.agent-name-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 5px; }
.capability-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 16px 20px; background: #fbfcfe; }
.capability-item { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 14px; border: 1px solid #e8edf3; border-radius: 12px; background: #fff; }
.capability-item strong, .capability-item span { display: block; }
.capability-item span { margin-top: 4px; color: #8a94a3; font-size: 12px; line-height: 1.45; }
.login-health { display: grid; gap: 4px; margin-top: 14px; padding: 10px 12px; border-radius: 10px; font-size: 12px; }
.login-health.healthy { background: #f0fdf4; color: #15803d; }
.login-health.unavailable { background: #fff1f2; color: #be123c; }
.login-health span { overflow-wrap: anywhere; opacity: .85; }
.agent-login-error { display: flex; align-items: flex-start; gap: 10px; margin: 0 20px 2px; padding: 10px 12px; border: 1px solid #fecdd3; border-radius: 10px; background: #fff1f2; color: #9f1239; font-size: 12px; line-height: 1.5; }
.agent-login-error strong { flex: 0 0 auto; }
.agent-login-error span { min-width: 0; overflow-wrap: anywhere; }
.agent-fields { display: grid; grid-template-columns: minmax(180px, 1.5fr) repeat(3, minmax(120px, 1fr)); gap: 14px; padding: 18px 20px; }
.agent-fields label { display: grid; gap: 7px; color: #687386; font-size: 13px; }
.agent-fields .el-input-number { width: 100%; }
.runtime-stat { display: grid; align-content: center; justify-items: start; gap: 7px; color: #687386; font-size: 13px; }
.runtime-stat strong { color: #263244; font-size: 16px; }
.agent-card-foot { padding: 10px 14px 10px 20px; border-top: 1px solid #edf1f6; }
.token-state { color: #8a94a3; font-size: 12px; }
.dialog-capabilities { display: flex; gap: 24px; }
.env-block { margin: 16px 0 0; padding: 16px; overflow: auto; border-radius: 12px; background: #111827; color: #d1fae5; font: 13px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
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
