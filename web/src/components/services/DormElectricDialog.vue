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
      <p>正在向校园侧查询…</p>
      <p class="sub-hint">需要校内网络才能拉到数据，首次查询约 3-6 秒</p>
    </div>

    <div v-else-if="error" class="error">
      <el-icon :size="32" color="#dc2626"><WarningFilled /></el-icon>
      <p class="msg">{{ error }}</p>
      <p class="hint">校园电费接口只在校园网内可达。如果你在校外，可以连校园 VPN 后再试。<br/>
      （站点服务器需要也在校园网或能 VPN 到校园网，本功能才会工作。）</p>
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
        余额不足，建议尽快充值。可通过融合门户「电费充值」办理。
      </div>
      <details v-if="data.raw" class="raw-fold">
        <summary>📦 显示原始响应（调试用）</summary>
        <pre class="raw">{{ JSON.stringify(data.raw, null, 2) }}</pre>
      </details>
      <div class="actions">
        <el-button text @click="refresh">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
        <a href="https://i.cpu.edu.cn" target="_blank" class="link-btn">前往充值 →</a>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Loading, WarningFilled, Refresh } from "@element-plus/icons-vue";
import { servicesApi, type DormElectricResult } from "@/api/services";

const props = defineProps<{ modelValue: boolean }>();
defineEmits<{ (e: "update:modelValue", v: boolean): void }>();

const loading = ref(false);
const error = ref("");
const data = ref<DormElectricResult | null>(null);

watch(() => props.modelValue, (v) => {
  if (v) refresh();
});

async function refresh() {
  loading.value = true;
  error.value = "";
  try {
    data.value = await servicesApi.dormElectric();
  } catch (e: any) {
    error.value = e?.message || "查询失败";
    data.value = null;
  } finally { loading.value = false; }
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
.loading p { margin: 0; font-size: 13px; color: #6b7280; }
.loading .sub-hint { font-size: 11px; color: #9ca3af; }
.is-loading { animation: spin 1.2s linear infinite; color: var(--cpu-primary); }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }

.error .msg { margin: 0; font-size: 14px; color: #1f2937; }
.error .hint { margin: 0; font-size: 12px; color: #6b7280; line-height: 1.6; max-width: 320px; }

.result { display: flex; flex-direction: column; gap: 14px; }
.balance-row {
  padding: 18px 0;
  border-bottom: 1px dashed #f1f5f9;
}
.balance-main {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.balance-main .lbl { font-size: 13px; color: #6b7280; }
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
  color: #4b5563;
}
.balance-sub .muted { color: #9ca3af; font-size: 12px; }

.kv { display: flex; flex-direction: column; gap: 6px; }
.kv > div {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.kv > div span:first-child { color: #6b7280; }
.kv > div span:last-child { color: #1f2937; }

.warn {
  background: #fef3c7;
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
  border-top: 1px solid #f1f5f9;
}
.link-btn {
  color: var(--cpu-primary);
  text-decoration: none;
  font-size: 13px;
}
.link-btn:hover { text-decoration: underline; }

.raw-fold {
  background: #f9fafb;
  border: 1px dashed #e5e7eb;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
}
.raw-fold summary {
  cursor: pointer;
  color: #6b7280;
  user-select: none;
}
.raw {
  font-family: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  background: #fff;
  padding: 8px 10px;
  border-radius: 6px;
  margin: 8px 0 4px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
  color: #1f2937;
}
.raw-hint { font-size: 11px; color: #9ca3af; margin: 0; line-height: 1.5; }
</style>
