<template>
  <div class="epay-pane" v-loading="loading">
    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="pane-alert"
      :title="loadError"
    >
      <template #default>
        <el-button size="small" :loading="loading" @click="reload">重试</el-button>
      </template>
    </el-alert>

    <section class="settings-panel">
      <div class="panel-head">
        <div>
          <h3 class="section-title">易支付商户配置</h3>
          <p class="section-desc">独立存放在 EpayConfig 表，商户密钥保存后只显示脱敏值。</p>
        </div>
        <el-tag :type="form.enabled ? 'success' : 'info'" effect="plain">
          {{ form.enabled ? "已启用" : "未启用" }}
        </el-tag>
      </div>

      <div class="form-grid">
        <label class="field field--switch">
          <span class="field-label">启用</span>
          <el-switch v-model="form.enabled" inline-prompt active-text="开" inactive-text="关" />
        </label>
        <label class="field">
          <span class="field-label">支付网关</span>
          <el-input v-model="form.gatewayUrl" maxlength="240" placeholder="https://pay.example.com" />
        </label>
        <label class="field">
          <span class="field-label">商户 ID</span>
          <el-input v-model="form.pid" maxlength="80" placeholder="PID" />
        </label>
        <label class="field">
          <span class="field-label">签名方式</span>
          <el-select v-model="form.signType">
            <el-option label="MD5" value="MD5" />
          </el-select>
        </label>
        <label class="field">
          <span class="field-label">默认支付类型</span>
          <el-select v-model="form.defaultType">
            <el-option v-for="item in enabledPayTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </label>
        <label class="field field--wide">
          <span class="field-label">商户密钥</span>
          <el-input v-model="merchantKey" maxlength="240" show-password :placeholder="keyPlaceholder" />
        </label>
        <div class="field field--wide">
          <span class="field-label">启用支付方式</span>
          <el-checkbox-group v-model="form.enabledTypes" class="pay-checks">
            <el-checkbox-button v-for="item in payTypes" :key="item.value" :label="item.value">
              {{ item.label }}
            </el-checkbox-button>
          </el-checkbox-group>
        </div>
      </div>

      <div class="meta-row">
        <span>提交地址：{{ form.submitUrl || "未生成" }}</span>
        <span>异步通知：{{ form.notifyUrl || "请先设置网站域名" }}</span>
        <span>同步跳转：{{ form.returnUrl || "请先设置网站域名" }}</span>
        <span v-if="form.merchantKeyMasked">密钥：{{ form.merchantKeyMasked }}</span>
      </div>

      <div class="actions-row">
        <el-button v-if="form.hasMerchantKey" plain type="danger" :loading="saving" :disabled="saving || Boolean(loadError)" @click="clearKey">清空密钥</el-button>
        <el-button type="primary" :loading="saving" :disabled="saving || Boolean(loadError)" @click="saveConfig">保存配置</el-button>
      </div>
    </section>

    <section class="settings-panel">
      <div class="panel-head">
        <div>
          <h3 class="section-title">签名预览</h3>
          <p class="section-desc">生成一组标准易支付提交参数，用于核对网关、PID、回调和 MD5 签名。</p>
        </div>
      </div>

      <div class="preview-grid">
        <label class="field">
          <span class="field-label">订单号</span>
          <el-input v-model="previewForm.outTradeNo" maxlength="80" />
        </label>
        <label class="field">
          <span class="field-label">商品名称</span>
          <el-input v-model="previewForm.name" maxlength="120" />
        </label>
        <label class="field">
          <span class="field-label">金额</span>
          <el-input v-model="previewForm.money" maxlength="20" />
        </label>
        <label class="field">
          <span class="field-label">支付类型</span>
          <el-select v-model="previewForm.type">
            <el-option v-for="item in enabledPayTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </label>
        <label class="field">
          <span class="field-label">设备</span>
          <el-input v-model="previewForm.device" maxlength="40" placeholder="pc / mobile" />
        </label>
        <label class="field">
          <span class="field-label">附加参数</span>
          <el-input v-model="previewForm.param" maxlength="200" />
        </label>
      </div>

      <div class="actions-row">
        <el-button :icon="Refresh" @click="resetPreviewNo">换订单号</el-button>
        <el-button type="primary" :loading="previewing" :disabled="previewing || Boolean(loadError)" @click="previewPayment">生成签名</el-button>
      </div>

      <div v-if="preview" class="preview-result">
        <div class="result-head">
          <div>
            <div class="result-title">{{ preview.method }} {{ preview.submitUrl }}</div>
            <div class="result-sub">共 {{ previewRows.length }} 个提交字段</div>
          </div>
          <el-button :icon="CopyDocument" plain @click="copyPreview">复制 JSON</el-button>
        </div>
        <div class="preview-table-scroll">
          <el-table :data="previewRows" size="small" border class="preview-table">
            <el-table-column prop="key" label="字段" min-width="150" />
            <el-table-column prop="value" label="值" min-width="260" show-overflow-tooltip />
          </el-table>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { CopyDocument, Refresh } from "@element-plus/icons-vue";
import { adminApi, type EpayConfig, type EpayPreview } from "@/api/admin";

type PayType = EpayConfig["defaultType"];

const payTypes: Array<{ label: string; value: PayType }> = [
  { label: "支付宝", value: "alipay" },
  { label: "微信支付", value: "wxpay" },
  { label: "QQ 钱包", value: "qqpay" },
  { label: "网银", value: "bank" },
  { label: "京东支付", value: "jdpay" },
];

const loading = ref(false);
const loadError = ref("");
const saving = ref(false);
const previewing = ref(false);
const merchantKey = ref("");
const preview = ref<EpayPreview | null>(null);

const form = reactive<EpayConfig>({
  id: 1,
  enabled: false,
  gatewayUrl: "",
  submitUrl: "",
  pid: "",
  hasMerchantKey: false,
  merchantKeyMasked: "",
  signType: "MD5",
  defaultType: "alipay",
  enabledTypes: ["alipay", "wxpay"],
  notifyUrl: "",
  returnUrl: "",
  siteOrigin: "",
  createdAt: "",
  updatedAt: "",
});

const previewForm = reactive({
  outTradeNo: nextPreviewNo(),
  name: "测试订单",
  money: "0.01",
  type: "alipay" as PayType,
  device: "pc",
  param: "",
});

const keyPlaceholder = computed(() => form.hasMerchantKey ? "留空则保持当前密钥" : "请输入商户密钥");
const enabledPayTypeOptions = computed(() => {
  const enabled = new Set(form.enabledTypes.length ? form.enabledTypes : ["alipay"]);
  return payTypes.filter((item) => enabled.has(item.value));
});
const previewRows = computed(() => Object.entries(preview.value?.params ?? {}).map(([key, value]) => ({ key, value })));

onMounted(reload);

function nextPreviewNo() {
  return `TEST${Date.now()}`;
}

function applyConfig(config: EpayConfig) {
  Object.assign(form, config);
  if (!form.enabledTypes.length) form.enabledTypes = ["alipay"];
  previewForm.type = config.defaultType || "alipay";
  merchantKey.value = "";
}

async function reload() {
  loading.value = true;
  loadError.value = "";
  try {
    applyConfig(await adminApi.epayConfig({ suppressErrorMessage: true }));
  } catch (error) {
    loadError.value = requestMessage(error) || "易支付配置加载失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  if (saving.value || loadError.value) return;
  saving.value = true;
  try {
    const config = await adminApi.updateEpayConfig({
      enabled: form.enabled,
      gatewayUrl: form.gatewayUrl,
      pid: form.pid,
      merchantKey: merchantKey.value || undefined,
      signType: form.signType,
      defaultType: form.defaultType,
      enabledTypes: form.enabledTypes,
    });
    applyConfig(config);
    ElMessage.success("易支付配置已保存");
  } finally {
    saving.value = false;
  }
}

async function clearKey() {
  if (saving.value || loadError.value) return;
  saving.value = true;
  try {
    await ElMessageBox.confirm("确认清空当前易支付商户密钥？", "清空密钥", {
      type: "warning",
      confirmButtonText: "清空",
      cancelButtonText: "取消",
    });
  } catch {
    saving.value = false;
    return;
  }
  try {
    applyConfig(await adminApi.updateEpayConfig({ clearMerchantKey: true }));
    ElMessage.success("商户密钥已清空");
  } finally {
    saving.value = false;
  }
}

function resetPreviewNo() {
  previewForm.outTradeNo = nextPreviewNo();
  preview.value = null;
}

async function previewPayment() {
  if (previewing.value || loadError.value) return;
  previewing.value = true;
  try {
    preview.value = await adminApi.previewEpayPayment({
      outTradeNo: previewForm.outTradeNo,
      name: previewForm.name,
      money: previewForm.money,
      type: previewForm.type,
      device: previewForm.device,
      param: previewForm.param,
    });
    ElMessage.success("签名已生成");
  } finally {
    previewing.value = false;
  }
}

async function copyPreview() {
  if (!preview.value) return;
  await navigator.clipboard.writeText(JSON.stringify(preview.value, null, 2));
  ElMessage.success("已复制");
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.epay-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.pane-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border: 1px solid #e7edf5;
  border-radius: 8px;
  background: #fff;
}
.panel-head,
.result-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}
.section-desc {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: #667085;
}
.form-grid,
.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.field--switch {
  justify-content: space-between;
}
.field--wide {
  grid-column: 1 / -1;
}
.field-label {
  font-size: 12px;
  color: #6b7280;
}
.pay-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pay-checks :deep(.el-checkbox-button__inner) {
  border-left: var(--el-border);
  border-radius: 6px !important;
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding: 10px 12px;
  border: 1px solid #edf2f7;
  border-radius: 8px;
  background: #f8fafc;
  color: #4b5563;
  font-size: 12px;
}
.actions-row {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.preview-result {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 2px;
}
.preview-table-scroll {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.preview-table-scroll :deep(.preview-table) {
  min-width: 520px;
}
.result-title {
  font-size: 14px;
  font-weight: 700;
  color: #1f2937;
  word-break: break-all;
}
.result-sub {
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
}
@media (max-width: 768px) {
  .settings-panel {
    padding: 14px;
  }
  .panel-head,
  .result-head,
  .actions-row {
    align-items: stretch;
    flex-direction: column;
  }
  .form-grid,
  .preview-grid {
    grid-template-columns: 1fr;
  }
  .field--wide {
    grid-column: auto;
  }
  .actions-row :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }
}
</style>
