<template>
  <el-dialog
    :model-value="modelValue"
    width="420"
    :close-on-click-modal="true"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div v-if="loading" class="loading">
      <el-icon class="is-loading" :size="32"><Loading /></el-icon>
      <p>正在查询电费…</p>
    </div>

    <div v-else-if="error" class="error">
      <el-icon :size="32" color="#dc2626"><WarningFilled /></el-icon>
      <p class="msg">{{ error }}</p>
      <p class="hint">如果一直查不到，可能是学号未关联宿舍、或校园电费系统临时不可用。</p>
      <el-button @click="refresh">重试</el-button>
    </div>

    <div v-else-if="data" class="result">
      <div class="balance-row">
        <div class="balance-main">
          <span class="lbl">剩余金额</span>
          <span class="num" :class="{ low: (data.balance ?? 0) < 10 }">
            {{ data.balance !== null ? `¥${data.balance.toFixed(2)}` : "—" }}
          </span>
        </div>
        <div class="balance-sub" v-if="data.remainKwh !== null">
          ≈ {{ data.remainKwh.toFixed(2) }} 度
          <span v-if="data.price" class="muted">（{{ data.price.toFixed(4) }} 元/度）</span>
        </div>
      </div>
      <div class="kv">
        <div v-if="data.area || data.building || data.floor || data.room">
          <span>地址</span>
          <span>{{ [data.area, data.building, data.floor, data.room].filter(Boolean).join(" · ") }}</span>
        </div>
        <div v-if="data.usedKwh !== null"><span>累计用电</span><span>{{ data.usedKwh.toFixed(2) }} 度</span></div>
        <div v-if="data.lastUpdate"><span>抄表时间</span><span>{{ data.lastUpdate }}</span></div>
      </div>
      <div v-if="(data.balance ?? 100) < 10 && data.balance !== null" class="warn">
        <el-icon><WarningFilled /></el-icon>
        余额不足，建议按缴费流程尽快购电。
      </div>
      <div class="actions">
        <el-button text @click="refresh">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
        <button type="button" class="link-btn" @click="showPaymentGuide">交电费流程 →</button>
      </div>
    </div>
  </el-dialog>

  <el-dialog
    v-model="paymentGuideOpen"
    title="宿舍电费缴费流程"
    width="420"
    append-to-body
    class="recharge-dialog"
  >
    <template #header><span class="dialog-title"><AppIcon name="electric" /> 宿舍电费</span></template>
    <div class="recharge-confirm">
      <ol class="payment-steps">
        <li>
          <strong>先充值校园卡</strong>
          <span>前往中国建设银行 APP，搜索“校园卡充值”，选择“中国药科大学”，将金额充值到校园卡。</span>
        </li>
        <li>
          <strong>再完成购电</strong>
          <span>前往企业微信 → 工作台 → 校园卡务，进入电费功能并完成缴费。</span>
        </li>
      </ol>
      <div class="system-note">
        <strong>注意</strong>
        <span>“校园卡务”页面加载较慢，请耐心等待；每日 23:30–次日 02:00 为系统盘点时段，无法完成充值、购电操作。</span>
      </div>
      <div class="password-tip">
        <strong>密码提示</strong>
        <span>登录用户名通常为学号，默认密码通常为身份证后六位数字；如果身份证末位是 X，请向前多取一位，输入倒数 6 个数字。</span>
      </div>
    </div>
    <template #footer>
      <el-button type="primary" @click="paymentGuideOpen = false">我知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import AppIcon from "@/components/common/AppIcon.vue";
import { onBeforeUnmount, ref, watch } from "vue";
import { Loading, WarningFilled, Refresh } from "@element-plus/icons-vue";
import { servicesApi, type DormElectricResult } from "@/api/services";

const props = defineProps<{ modelValue: boolean }>();
defineEmits<{ (e: "update:modelValue", v: boolean): void }>();

const loading = ref(false);
const error = ref("");
const data = ref<DormElectricResult | null>(null);
const paymentGuideOpen = ref(false);
let disposed = false;
let refreshSeq = 0;

watch(() => props.modelValue, (v) => {
  if (v) refresh();
  else {
    refreshSeq += 1;
    loading.value = false;
  }
}, { immediate: true });

onBeforeUnmount(() => {
  disposed = true;
  refreshSeq += 1;
  loading.value = false;
});

async function refresh() {
  if (disposed) return;
  const seq = ++refreshSeq;
  loading.value = true;
  error.value = "";
  try {
    const next = await servicesApi.dormElectric();
    if (disposed || seq !== refreshSeq || !props.modelValue) return;
    data.value = next;
  } catch (e: any) {
    if (disposed || seq !== refreshSeq || !props.modelValue) return;
    error.value = e?.message || "查询失败";
    data.value = null;
  } finally {
    if (!disposed && seq === refreshSeq) loading.value = false;
  }
}

function showPaymentGuide() {
  paymentGuideOpen.value = true;
}
</script>

<style scoped>
.loading, .error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px 0;
  text-align: center;
}
.loading p { margin: 0; font-size: 13px; color: var(--cpu-text-secondary); }
.loading .sub-hint { font-size: 11px; color: #9ca3af; }
.is-loading { animation: spin 1.2s linear infinite; color: var(--cpu-primary); }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }

.error .msg { margin: 0; font-size: 14px; color: var(--cpu-text); }
.error .hint { margin: 0; font-size: 12px; color: var(--cpu-text-secondary); line-height: 1.6; max-width: 320px; }

.result { display: flex; flex-direction: column; gap: 14px; }
.balance-row {
  padding: 18px 0;
  border-bottom: 1px dashed var(--cpu-border-soft);
}
.balance-main {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.balance-main .lbl { font-size: 13px; color: var(--cpu-text-secondary); }
.balance-main .num {
  font-size: 32px;
  font-weight: 700;
  color: var(--cpu-primary);
}
.balance-main .num.low { color: #dc2626; }
.balance-sub {
  margin-top: 6px;
  text-align: right;
  font-size: 13px;
  color: var(--cpu-text-secondary);
}
.balance-sub .muted { color: #9ca3af; font-size: 12px; }

.kv { display: flex; flex-direction: column; gap: 6px; }
.kv > div {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.kv > div span:first-child { color: var(--cpu-text-secondary); }
.kv > div span:last-child { color: var(--cpu-text); }

.warn {
  background: rgba(245, 158, 11, 0.14);
  color: #92400e;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid var(--cpu-border-soft);
}
.link-btn {
  border: none;
  background: none;
  padding: 8px 0;
  color: var(--cpu-primary);
  font-size: 13px;
  font: inherit;
  cursor: pointer;
}
.link-btn:hover { text-decoration: underline; }

.recharge-confirm {
  color: var(--cpu-text);
  font-size: 13px;
  line-height: 1.6;
}
.payment-steps {
  margin: 0;
  padding-left: 22px;
}
.payment-steps li {
  padding-left: 4px;
}
.payment-steps li + li {
  margin-top: 12px;
}
.payment-steps strong,
.payment-steps span,
.system-note strong,
.system-note span,
.password-tip strong,
.password-tip span {
  display: block;
}
.payment-steps span,
.system-note span,
.password-tip span {
  margin-top: 3px;
  color: var(--cpu-text-secondary);
}
.system-note,
.password-tip {
  margin-top: 14px;
  padding: 11px 12px;
  border-radius: 8px;
}
.system-note {
  border: 1px solid rgba(245, 158, 11, 0.34);
  background: rgba(245, 158, 11, 0.12);
}
.system-note strong {
  color: var(--cpu-warning, #d97706);
}
.password-tip {
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-subtle);
}
</style>
