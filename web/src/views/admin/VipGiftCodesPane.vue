<template>
  <div class="gift-codes-pane" v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="礼品码只在生成成功时显示完整内容，请及时复制保存；后台列表仅保留脱敏预览。"
    />

    <el-card shadow="never" class="editor-card">
      <template #header>
        <div class="card-header">
          <div>
            <h3>生成 VIP 礼品码</h3>
            <p>适合活动、社群回馈或定向赠送；默认每个码只能使用一次。</p>
          </div>
          <el-button text :loading="loading" @click="load">刷新</el-button>
        </div>
      </template>
      <el-form label-position="top" class="gift-form">
        <div class="form-grid">
          <el-form-item label="生成数量">
            <el-input-number v-model="form.quantity" :min="1" :max="100" style="width:100%" />
          </el-form-item>
          <el-form-item label="VIP 等级">
            <el-select v-model="form.vipLevel" style="width:100%">
              <el-option :value="1" label="VIP Lv.1" />
              <el-option :value="2" label="VIP Lv.2" />
              <el-option :value="3" label="VIP Lv.3" />
            </el-select>
          </el-form-item>
          <el-form-item label="有效天数" required>
            <el-input-number v-model="form.durationDays" :min="1" :max="3650" style="width:100%" />
          </el-form-item>
          <el-form-item label="每码可用次数">
            <el-input-number v-model="form.maxUses" :min="1" :max="100000" style="width:100%" />
          </el-form-item>
          <el-form-item label="开始时间">
            <el-date-picker v-model="form.startsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="立即生效" style="width:100%" />
          </el-form-item>
          <el-form-item label="结束时间">
            <el-date-picker v-model="form.expiresAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="长期有效" style="width:100%" />
          </el-form-item>
        </div>
        <el-form-item label="备注">
          <el-input v-model="form.note" maxlength="240" show-word-limit placeholder="例如：迎新活动、QQ群回馈" />
        </el-form-item>
        <el-button type="primary" :loading="saving" @click="create">生成礼品码</el-button>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <div>
            <h3>礼品码列表</h3>
            <p>可随时停用；已使用次数不会被重置。</p>
          </div>
        </div>
      </template>
      <el-empty v-if="!list.length && !loading" description="暂未生成礼品码" />
      <div v-else class="code-list">
        <div v-for="item in list" :key="item.id" class="code-row">
          <div class="code-main">
            <div class="code-title">
              <strong>{{ item.codePreview }}</strong>
              <el-tag size="small" :type="item.enabled ? 'success' : 'info'">{{ item.enabled ? "可兑换" : "已停用" }}</el-tag>
            </div>
            <p>Lv.{{ item.vipLevel }} · {{ item.durationDays }} 天 · {{ item.usedCount }} / {{ item.maxUses }} 次</p>
            <small>{{ item.note || "无备注" }} · {{ formatDate(item.createdAt) }}</small>
            <small v-if="item.startsAt || item.expiresAt">有效期：{{ formatDate(item.startsAt) }} 至 {{ formatDate(item.expiresAt) }}</small>
          </div>
          <el-button size="small" :type="item.enabled ? 'warning' : 'success'" plain @click="toggle(item)">
            {{ item.enabled ? "停用" : "启用" }}
          </el-button>
        </div>
      </div>
    </el-card>

    <el-dialog v-model="codesDialogOpen" title="礼品码生成成功" width="520px" append-to-body>
      <el-alert type="warning" :closable="false" show-icon title="完整礼品码只显示这一次，请复制后再关闭窗口。" />
      <div class="generated-codes">
        <code v-for="code in generatedCodes" :key="code">{{ code }}</code>
      </div>
      <template #footer>
        <el-button @click="codesDialogOpen = false">关闭</el-button>
        <el-button type="primary" @click="copyGeneratedCodes">复制全部</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { adminApi, type VipGiftCodeAdmin } from "@/api/admin";

const list = ref<VipGiftCodeAdmin[]>([]);
const loading = ref(false);
const saving = ref(false);
const codesDialogOpen = ref(false);
const generatedCodes = ref<string[]>([]);
const form = reactive({
  quantity: 1,
  vipLevel: 1,
  durationDays: 30,
  maxUses: 1,
  startsAt: "",
  expiresAt: "",
  note: "",
});

onMounted(load);

async function load() {
  loading.value = true;
  try {
    list.value = await adminApi.vipGiftCodes({ suppressErrorMessage: true });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "礼品码列表加载失败");
  } finally {
    loading.value = false;
  }
}

async function create() {
  saving.value = true;
  try {
    const result = await adminApi.createVipGiftCodes({
      quantity: form.quantity,
      vipLevel: form.vipLevel,
      durationDays: form.durationDays,
      maxUses: form.maxUses,
      startsAt: form.startsAt || null,
      expiresAt: form.expiresAt || null,
      note: form.note.trim() || null,
    });
    generatedCodes.value = result.codes;
    codesDialogOpen.value = true;
    ElMessage.success(`已生成 ${result.codes.length} 个礼品码`);
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "礼品码生成失败");
  } finally {
    saving.value = false;
  }
}

async function toggle(item: VipGiftCodeAdmin) {
  try {
    const updated = await adminApi.updateVipGiftCode(item.id, { enabled: !item.enabled });
    const index = list.value.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) list.value[index] = updated;
    ElMessage.success(updated.enabled ? "礼品码已启用" : "礼品码已停用");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "礼品码状态更新失败");
  }
}

async function copyGeneratedCodes() {
  const value = generatedCodes.value.join("\n");
  try {
    await navigator.clipboard.writeText(value);
    ElMessage.success("已复制全部礼品码");
  } catch {
    ElMessage.warning("浏览器未授权剪贴板，请手动复制");
  }
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "不限";
}
</script>

<style scoped>
.gift-codes-pane { display: flex; flex-direction: column; gap: 14px; }
.editor-card { overflow: visible; }
.card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.card-header h3 { margin: 0; color: var(--cpu-text); font-size: 15px; }
.card-header p { margin: 5px 0 0; color: var(--cpu-text-muted); font-size: 12px; }
.gift-form { max-width: 920px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px; }
.code-list { display: flex; flex-direction: column; gap: 10px; }
.code-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 14px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; }
.code-main { min-width: 0; flex: 1; }
.code-title { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.code-title strong { color: var(--cpu-text); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: .04em; }
.code-row p, .code-row small { display: block; margin: 7px 0 0; color: var(--cpu-text-secondary); font-size: 12px; }
.code-row small { color: var(--cpu-text-muted); font-size: 11px; }
.generated-codes { display: flex; flex-direction: column; gap: 8px; max-height: 320px; margin-top: 16px; overflow: auto; padding: 12px; border-radius: 10px; background: var(--cpu-surface-soft); }
.generated-codes code { color: var(--cpu-text); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 14px; letter-spacing: .06em; user-select: all; }
@media (max-width: 650px) { .form-grid { grid-template-columns: 1fr; } .code-row { flex-direction: column; } }
</style>
