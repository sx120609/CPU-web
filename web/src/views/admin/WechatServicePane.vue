<template>
  <div class="wechat-pane" v-loading="loading">
    <el-alert v-if="loadError" type="warning" :closable="false" show-icon :title="loadError">
      <template #default><el-button size="small" :loading="loading" @click="loadAll">重试</el-button></template>
    </el-alert>

    <template v-if="config">
      <section class="pane-section">
        <div class="section-head">
          <div>
            <h3>服务号接入</h3>
            <p>用于微信授权绑定、站内通知和拾间AI图片问答；QQ群管理仍由 QQBot 负责。</p>
          </div>
          <el-tag :type="config.enabled ? 'success' : 'info'">{{ config.enabled ? "已启用" : "未启用" }}</el-tag>
        </div>

        <el-form label-position="top" class="config-form">
          <div class="form-grid">
            <el-form-item label="服务号名称">
              <el-input v-model="form.accountName" maxlength="80" placeholder="例如：拾小间" />
            </el-form-item>
            <el-form-item label="AppID">
              <el-input v-model="form.appId" maxlength="80" autocomplete="off" />
            </el-form-item>
          </div>
          <el-form-item label="AppSecret">
            <el-input
              v-model="form.appSecret"
              type="password"
              show-password
              autocomplete="new-password"
              :placeholder="config.hasAppSecret ? `已配置：${config.appSecretMasked}` : '尚未配置'"
            />
            <div class="form-tip">留空保存不会覆盖现有 AppSecret。</div>
          </el-form-item>
          <div class="form-grid">
            <el-form-item label="消息加解密方式">
              <el-select v-model="form.messageMode">
                <el-option label="安全模式（推荐）" value="safe" />
                <el-option label="兼容模式" value="compatible" />
                <el-option label="明文模式" value="plaintext" />
              </el-select>
            </el-form-item>
            <el-form-item label="启用服务号">
              <el-switch v-model="form.enabled" />
            </el-form-item>
          </div>
          <el-form-item label="Token">
            <div class="secret-row">
              <el-input v-model="form.token" autocomplete="off" />
              <el-button :loading="generating" @click="generateCredential('token')">重新生成</el-button>
            </div>
          </el-form-item>
          <el-form-item v-if="form.messageMode !== 'plaintext'" label="EncodingAESKey">
            <div class="secret-row">
              <el-input v-model="form.encodingAesKey" autocomplete="off" />
              <el-button :loading="generating" @click="generateCredential('encodingAesKey')">重新生成</el-button>
            </div>
          </el-form-item>
        </el-form>

        <div class="endpoint-grid">
          <button type="button" @click="copyValue(config.callbackUrl)">
            <span>服务器地址 URL</span><b>{{ config.callbackUrl }}</b>
          </button>
          <button type="button" @click="copyValue(config.oauthCallbackUrl)">
            <span>网页授权回调</span><b>{{ config.oauthCallbackUrl }}</b>
          </button>
          <button type="button" @click="copyValue(config.oauthDomain)">
            <span>网页授权域名</span><b>{{ config.oauthDomain || "请先配置站点域名" }}</b>
          </button>
        </div>
      </section>

      <section class="pane-section">
        <div class="section-head">
          <div>
            <h3>消息能力</h3>
            <p>客服消息优先用于最近主动交互的用户；超出窗口后优先使用用户主动同意的一次性订阅通知，再回退到模板消息。</p>
          </div>
        </div>
        <div class="switch-grid">
          <label><span><b>站内通知转发</b><small>按用户订阅偏好发送微信提醒</small></span><el-switch v-model="form.notificationEnabled" /></label>
          <label><span><b>拾间AI客服问答</b><small>通过客服接口把 AI 回答渲染成图片发送</small></span><el-switch v-model="form.assistantEnabled" /></label>
        </div>
        <el-checkbox-group v-model="form.notifyCategories" class="category-grid">
          <el-checkbox v-for="item in categoryOptions" :key="item.value" :value="item.value">{{ item.label }}</el-checkbox>
        </el-checkbox-group>

        <el-divider />
        <h4>模板消息</h4>
        <p class="section-note">先在微信后台选定合规模板，再填写模板 ID 和模板中的字段名；留空时不会尝试模板推送。</p>
        <el-form label-position="top">
          <el-form-item label="模板 ID"><el-input v-model="form.notificationTemplateId" /></el-form-item>
          <div class="template-grid">
            <el-form-item label="标题字段"><el-input v-model="form.templateTitleField" placeholder="例如 thing1" /></el-form-item>
            <el-form-item label="内容字段"><el-input v-model="form.templateContentField" placeholder="例如 thing2" /></el-form-item>
            <el-form-item label="时间字段（可选）"><el-input v-model="form.templateTimeField" placeholder="例如 time3" /></el-form-item>
            <el-form-item label="备注字段（可选）"><el-input v-model="form.templateRemarkField" placeholder="例如 thing4" /></el-form-item>
          </div>
        </el-form>

        <el-divider />
        <div class="section-head compact-head">
          <div>
            <h4>一次性订阅通知</h4>
            <p>需在微信后台配置订阅通知模板与 JS 接口安全域名；用户在微信内主动同意后，每次同意可发送一条通知。</p>
          </div>
          <el-switch v-model="form.subscriptionEnabled" />
        </div>
        <el-form label-position="top">
          <el-form-item label="订阅模板 ID"><el-input v-model="form.subscriptionTemplateId" /></el-form-item>
          <div class="template-grid">
            <el-form-item label="标题字段"><el-input v-model="form.subscriptionTitleField" placeholder="例如 thing1" /></el-form-item>
            <el-form-item label="内容字段"><el-input v-model="form.subscriptionContentField" placeholder="例如 thing2" /></el-form-item>
            <el-form-item label="时间字段（可选）"><el-input v-model="form.subscriptionTimeField" placeholder="例如 time3" /></el-form-item>
            <el-form-item label="备注字段（可选）"><el-input v-model="form.subscriptionRemarkField" placeholder="例如 thing4" /></el-form-item>
          </div>
        </el-form>

        <div class="section-actions">
          <el-button type="primary" :loading="saving" @click="saveConfig">保存配置</el-button>
          <el-button :loading="dispatching" @click="dispatchNotifications">立即检查通知</el-button>
        </div>
      </section>

      <section class="pane-section">
        <div class="section-head">
          <div>
            <h3>自定义菜单</h3>
            <p>发布后会覆盖当前菜单，并为已绑定用户发布带“今日课表”的个性化菜单。</p>
          </div>
        </div>
        <div class="menu-preview-grid">
          <div v-for="group in menuPreview" :key="group.name" class="menu-preview-group">
            <b>{{ group.name }}</b>
            <span v-for="item in group.items" :key="item">{{ item }}</span>
          </div>
        </div>
        <div class="section-actions">
          <el-button type="primary" :loading="publishingMenu" @click="publishMenu">发布到微信</el-button>
        </div>
      </section>

      <section class="pane-section">
        <div class="section-head">
          <div><h3>微信绑定</h3><p>这里只展示脱敏标识；测试消息由服务器直接发送。</p></div>
          <el-button text :loading="bindingsLoading" @click="loadBindings">刷新</el-button>
        </div>
        <el-input v-model="bindingQuery" clearable placeholder="搜索站内用户名或昵称" class="binding-search" @keyup.enter="loadBindings" />
        <el-table :data="bindings" empty-text="暂无微信绑定">
          <el-table-column label="站内账号" min-width="180">
            <template #default="{ row }"><b>{{ row.user?.nickname || row.user?.username }}</b><small class="table-sub">{{ row.user?.username }}</small></template>
          </el-table-column>
          <el-table-column prop="openId" label="OpenID" min-width="180" />
          <el-table-column label="关注状态" width="110">
            <template #default="{ row }"><el-tag :type="row.subscribed ? 'success' : 'info'" size="small">{{ row.subscribed ? "已关注" : "已取消" }}</el-tag></template>
          </el-table-column>
          <el-table-column label="通道" width="90">
            <template #default="{ row }"><el-switch :model-value="row.enabled" @change="toggleBinding(row, $event)" /></template>
          </el-table-column>
          <el-table-column label="最近交互" min-width="150">
            <template #default="{ row }">{{ row.lastInteractionAt ? fmtDate(row.lastInteractionAt) : "—" }}</template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button text type="primary" @click="sendTest(row)">测试</el-button>
              <el-button text type="danger" @click="removeBinding(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi, type WechatServiceConfig } from "@/api/admin";
import { copyText } from "@/utils/userGroup";
import { fmtDate } from "@/utils/format";

const categoryOptions = [
  { value: "reply", label: "回复" },
  { value: "mention", label: "提及" },
  { value: "like", label: "点赞" },
  { value: "system", label: "系统 / 站务" },
  { value: "service-tool", label: "小工具" },
  { value: "lost-found", label: "失物招领" },
  { value: "school-feed", label: "校园公告" },
];

const menuPreview = [
  { name: "未绑定 · 校园", items: ["我的课表", "教务中心", "校园服务"] },
  { name: "已绑定 · 校园", items: ["今日课表", "完整课表", "教务中心"] },
  { name: "社区", items: ["论坛首页", "失物招领", "发布内容"] },
  { name: "我的", items: ["消息中心", "通知订阅", "个人中心"] },
];

const config = ref<WechatServiceConfig | null>(null);
const loading = ref(false);
const saving = ref(false);
const generating = ref(false);
const dispatching = ref(false);
const publishingMenu = ref(false);
const bindingsLoading = ref(false);
const loadError = ref("");
const bindings = ref<any[]>([]);
const bindingQuery = ref("");
const form = reactive({
  enabled: false,
  accountName: "",
  appId: "",
  appSecret: "",
  token: "",
  encodingAesKey: "",
  messageMode: "safe" as "plaintext" | "compatible" | "safe",
  notificationEnabled: true,
  assistantEnabled: true,
  notifyCategories: [] as string[],
  notificationTemplateId: "",
  templateTitleField: "",
  templateContentField: "",
  templateTimeField: "",
  templateRemarkField: "",
  subscriptionEnabled: false,
  subscriptionTemplateId: "",
  subscriptionTitleField: "",
  subscriptionContentField: "",
  subscriptionTimeField: "",
  subscriptionRemarkField: "",
});

onMounted(loadAll);

async function loadAll() {
  loading.value = true;
  loadError.value = "";
  try {
    const [nextConfig, nextBindings] = await Promise.all([
      adminApi.wechatConfig({ suppressErrorMessage: true }),
      adminApi.wechatBindings(undefined, { suppressErrorMessage: true }),
    ]);
    applyConfig(nextConfig);
    bindings.value = nextBindings;
  } catch (error: any) {
    loadError.value = error?.message || "服务号配置加载失败";
  } finally {
    loading.value = false;
  }
}

function applyConfig(value: WechatServiceConfig) {
  config.value = value;
  Object.assign(form, {
    enabled: value.enabled,
    accountName: value.accountName,
    appId: value.appId,
    appSecret: "",
    token: value.token,
    encodingAesKey: value.encodingAesKey,
    messageMode: value.messageMode,
    notificationEnabled: value.notificationEnabled,
    assistantEnabled: value.assistantEnabled,
    notifyCategories: [...value.notifyCategories],
    notificationTemplateId: value.notificationTemplateId,
    templateTitleField: value.templateTitleField,
    templateContentField: value.templateContentField,
    templateTimeField: value.templateTimeField,
    templateRemarkField: value.templateRemarkField,
    subscriptionEnabled: value.subscriptionEnabled,
    subscriptionTemplateId: value.subscriptionTemplateId,
    subscriptionTitleField: value.subscriptionTitleField,
    subscriptionContentField: value.subscriptionContentField,
    subscriptionTimeField: value.subscriptionTimeField,
    subscriptionRemarkField: value.subscriptionRemarkField,
  });
}

async function saveConfig() {
  if (saving.value) return;
  saving.value = true;
  try {
    const payload = { ...form, ...(form.appSecret.trim() ? { appSecret: form.appSecret.trim() } : {}) };
    const next = await adminApi.updateWechatConfig(payload);
    applyConfig(next);
    ElMessage.success("服务号配置已保存");
  } finally {
    saving.value = false;
  }
}

async function generateCredential(target: "token" | "encodingAesKey") {
  if (generating.value) return;
  generating.value = true;
  try {
    const next = await adminApi.generateWechatCredentials(target);
    applyConfig(next);
    ElMessage.success(target === "token" ? "Token 已生成" : "EncodingAESKey 已生成");
  } finally {
    generating.value = false;
  }
}

async function copyValue(value: string) {
  if (!value) return;
  await copyText(value);
  ElMessage.success("已复制");
}

async function dispatchNotifications() {
  if (dispatching.value) return;
  dispatching.value = true;
  try {
    const result = await adminApi.dispatchWechatNotifications();
    ElMessage.success(`已发送 ${result.sent} 条，暂不具备发送条件 ${result.skipped} 条`);
  } finally {
    dispatching.value = false;
  }
}

async function publishMenu() {
  if (publishingMenu.value) return;
  const confirmed = await ElMessageBox.confirm(
    "发布后将覆盖服务号当前自定义菜单，确认继续？",
    "发布自定义菜单",
    { type: "warning", confirmButtonText: "确认发布" },
  ).then(() => true).catch(() => false);
  if (!confirmed) return;
  publishingMenu.value = true;
  try {
    const result = await adminApi.publishWechatMenu();
    ElMessage.success(`菜单已发布，已同步 ${result.taggedCount} 个绑定账号`);
  } finally {
    publishingMenu.value = false;
  }
}

async function loadBindings() {
  bindingsLoading.value = true;
  try {
    bindings.value = await adminApi.wechatBindings(bindingQuery.value.trim() ? { q: bindingQuery.value.trim() } : undefined);
  } finally {
    bindingsLoading.value = false;
  }
}

async function toggleBinding(row: any, value: string | number | boolean) {
  row.enabled = Boolean(value);
  try {
    await adminApi.updateWechatBinding(row.id, { enabled: row.enabled });
  } catch {
    row.enabled = !row.enabled;
  }
}

async function sendTest(row: any) {
  const result = await ElMessageBox.prompt("这条消息会通过服务号客服接口发送给该用户。", "发送测试消息", {
    inputValue: "这是一条来自药大拾间的服务号接入测试消息。",
    inputValidator: (value) => value.trim().length > 0 || "请输入消息内容",
  }).catch(() => null);
  if (!result) return;
  await adminApi.sendWechatTestMessage(row.id, result.value.trim());
  ElMessage.success("测试消息已提交");
}

async function removeBinding(row: any) {
  const confirmed = await ElMessageBox.confirm(`确认删除 ${row.user?.nickname || row.user?.username} 的微信绑定？`, "删除微信绑定", { type: "warning" })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await adminApi.deleteWechatBinding(row.id);
  bindings.value = bindings.value.filter((item) => item.id !== row.id);
  ElMessage.success("微信绑定已删除");
}
</script>

<style scoped>
.wechat-pane { display: grid; gap: 16px; }
.pane-section { padding: 18px; border: 1px solid var(--cpu-border); border-radius: 14px; background: var(--cpu-surface); }
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.compact-head { margin-bottom: 12px; }
.section-head h3, .pane-section h4 { margin: 0 0 6px; }
.section-head p, .section-note, .form-tip { margin: 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.6; }
.form-grid, .template-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.secret-row { display: flex; width: 100%; gap: 10px; }
.endpoint-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.endpoint-grid button { min-width: 0; padding: 12px; text-align: left; color: inherit; border: 1px solid var(--cpu-border); border-radius: 10px; background: var(--cpu-bg-soft); cursor: pointer; }
.endpoint-grid span, .endpoint-grid b { display: block; }
.endpoint-grid span { margin-bottom: 5px; color: var(--cpu-text-secondary); font-size: 12px; }
.endpoint-grid b { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.switch-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
.switch-grid label { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px; border: 1px solid var(--cpu-border); border-radius: 10px; }
.switch-grid span, .switch-grid b, .switch-grid small { display: block; }
.switch-grid small { margin-top: 4px; color: var(--cpu-text-secondary); }
.category-grid { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.menu-preview-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
.menu-preview-group { display: grid; gap: 7px; padding: 13px; border: 1px solid var(--cpu-border); border-radius: 10px; background: var(--cpu-bg-soft); }
.menu-preview-group b { color: var(--cpu-text); }
.menu-preview-group span { color: var(--cpu-text-secondary); font-size: 13px; }
.section-note { margin-bottom: 12px; }
.section-actions { display: flex; gap: 10px; margin-top: 8px; }
.binding-search { max-width: 360px; margin-bottom: 14px; }
.table-sub { display: block; margin-top: 3px; color: var(--cpu-text-secondary); }
@media (max-width: 760px) {
  .pane-section { padding: 14px; }
  .section-head { align-items: stretch; flex-direction: column; }
  .form-grid, .template-grid, .endpoint-grid, .switch-grid, .menu-preview-grid { grid-template-columns: 1fr; }
  .secret-row, .section-actions { align-items: stretch; flex-direction: column; }
}
</style>
