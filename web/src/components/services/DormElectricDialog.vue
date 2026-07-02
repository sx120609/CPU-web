<template>
  <el-dialog
    :model-value="modelValue"
    title="💡 宿舍电费"
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
        余额不足，建议尽快充值。充值将跳转到学校官方页面办理。
      </div>
      <div class="actions">
        <el-button text @click="refresh">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
        <button type="button" class="link-btn" @click="confirmRecharge">前往充值 →</button>
      </div>
    </div>
  </el-dialog>

  <el-dialog
    v-model="rechargeConfirmOpen"
    title="前往官方充值页面"
    width="420"
    append-to-body
    class="recharge-dialog"
  >
    <div class="recharge-confirm">
      <div v-if="inAppBrowser.isInApp" class="in-app-warning">
        检测到当前可能在{{ inAppBrowser.label }}内打开。电费充值页面在内置浏览器中可能无法正常加载，
        请点击右上角菜单，选择“在浏览器打开”后再继续。
      </div>
      <p>即将打开中国药科大学官方校园卡 / 电费充值页面。</p>
      <ul>
        <li>该电费站点受学校系统影响加载较慢，建议使用外部浏览器打开，并耐心等候。</li>
        <li>如果页面加载不出来，请尝试连接校园网后再访问。</li>
        <li>登录用户名通常为学号，默认密码通常为身份证后六位数字。</li>
        <li>如果身份证末位是 X，请向前多取一位，输入倒数 6 个数字。</li>
        <li>充值、支付、交易记录等均发生在学校官方页面，所有交易与本站无关。</li>
        <li>建议不要在该页面修改默认密码，避免后续遗忘影响使用。</li>
      </ul>
    </div>
    <template #footer>
      <el-button @click="rechargeConfirmOpen = false">取消</el-button>
      <el-button type="primary" :disabled="rechargeReadSeconds > 0" @click="openRecharge">
        {{ rechargeReadSeconds > 0 ? `请先阅读 ${rechargeReadSeconds}s` : "继续前往充值" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Loading, WarningFilled, Refresh } from "@element-plus/icons-vue";
import { servicesApi, type DormElectricResult } from "@/api/services";
import { detectInAppBrowser } from "@/utils/inAppBrowser";

const props = defineProps<{ modelValue: boolean }>();
defineEmits<{ (e: "update:modelValue", v: boolean): void }>();

const RECHARGE_URL = "https://vcard.cpu.edu.cn/plat/shouyeUser";

const loading = ref(false);
const error = ref("");
const data = ref<DormElectricResult | null>(null);
const rechargeConfirmOpen = ref(false);
const rechargeReadSeconds = ref(0);
const inAppBrowser = computed(() => detectInAppBrowser());
let rechargeReadTimer: number | null = null;
let disposed = false;
let refreshSeq = 0;

watch(() => props.modelValue, (v) => {
  if (v) refresh();
  else {
    refreshSeq += 1;
    loading.value = false;
  }
});

watch(rechargeConfirmOpen, (open) => {
  if (open) startRechargeReadTimer();
  else clearRechargeReadTimer();
});

onBeforeUnmount(() => {
  disposed = true;
  refreshSeq += 1;
  loading.value = false;
  clearRechargeReadTimer();
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

function confirmRecharge() {
  rechargeConfirmOpen.value = true;
}

function openRecharge() {
  if (rechargeReadSeconds.value > 0) return;
  rechargeConfirmOpen.value = false;
  window.open(RECHARGE_URL, "_blank", "noopener,noreferrer");
}

function startRechargeReadTimer() {
  clearRechargeReadTimer();
  rechargeReadSeconds.value = 5;
  rechargeReadTimer = window.setInterval(() => {
    rechargeReadSeconds.value -= 1;
    if (rechargeReadSeconds.value <= 0) {
      clearRechargeReadTimer();
    }
  }, 1000);
}

function clearRechargeReadTimer() {
  if (rechargeReadTimer) {
    window.clearInterval(rechargeReadTimer);
    rechargeReadTimer = null;
  }
  if (!rechargeConfirmOpen.value) rechargeReadSeconds.value = 0;
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
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.recharge-confirm p {
  margin: 0 0 8px;
}
.recharge-confirm ul {
  margin: 0;
  padding-left: 18px;
}
.recharge-confirm li + li {
  margin-top: 4px;
}
.in-app-warning {
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(245, 158, 11, 0.34);
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.12);
  color: #92400e;
  font-size: 13px;
  line-height: 1.6;
}
</style>
