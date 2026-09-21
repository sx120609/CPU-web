<template>
  <section class="settings-card" v-loading="loading">
    <div class="pane-head">
      <div>
        <h2>APNs 推送</h2>
        <p>按用户设置的提前量远程启动，再按学校作息广播更新；iPhone 从本地课表读取课程详情。</p>
      </div>
      <el-tag :type="form.configured ? 'success' : 'info'">{{ form.configured ? "已配置" : "未配置" }}</el-tag>
    </div>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="mb" />
    <el-form label-width="150px" class="config-form">
      <el-form-item label="密钥文件路径"><el-input v-model="form.keyPath" placeholder="服务器上的 AuthKey_XXXX.p8 路径" /></el-form-item>
      <el-form-item label="Key ID"><el-input v-model="form.keyID" /></el-form-item>
      <el-form-item label="Team ID"><el-input v-model="form.teamID" /></el-form-item>
      <el-form-item label="Bundle ID"><el-input v-model="form.bundleID" placeholder="cn.cputime.mobile" /></el-form-item>
      <el-form-item label="调度间隔（秒）"><el-input-number v-model="form.tickSeconds" :min="0.5" :max="3600" :step="0.5" /></el-form-item>
    </el-form>
    <div class="channel-head"><strong>广播频道</strong><el-button size="small" :loading="syncing" :disabled="saving || loading || !form.configured" @click="syncChannels">创建缺失频道</el-button></div>
    <p class="hint">保存后自动创建上午、下午、晚间的生产和沙盒频道。CPU App ID 需开通广播能力。iOS 18 及以上支持远程启动并订阅频道，无需每天打开 App。启动凭据与最小时间计划由客户端同步，频道缺失的时段暂不启动。</p>
    <div class="channels">
      <template v-for="environment in ['production', 'sandbox']" :key="environment">
        <div v-for="window in windows" :key="`${environment}-${window.id}`" class="channel-row">
          <strong>{{ environment === 'production' ? '生产' : '沙盒' }} · {{ window.label }}</strong>
          <el-input :model-value="form.channels[`${environment}:cpu-${window.id}`] || ''" readonly placeholder="尚未创建" />
        </div>
      </template>
    </div>
    <div class="actions"><el-button type="primary" :loading="saving" :disabled="loading || syncing" @click="save">保存 APNs 配置</el-button></div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { adminApi, type ApnsConfig } from "@/api/admin";

const windows = [{ id: "morning", label: "上午" }, { id: "afternoon", label: "下午" }, { id: "evening", label: "晚间" }];
const loading = ref(false);
const saving = ref(false);
const syncing = ref(false);
const error = ref("");
const form = reactive<ApnsConfig>({ keyPath: "", keyID: "", teamID: "", bundleID: "", tickSeconds: 5, channels: {}, configured: false, updatedAt: null });

function apply(value: ApnsConfig) {
  Object.assign(form, value);
  error.value = (value.channelErrors || []).map((item) => item.message).join("；");
}
async function load() {
  loading.value = true; error.value = "";
  try { apply(await adminApi.apnsConfig({ cacheTtlMs: 0 })); }
  catch (e) { error.value = e instanceof Error ? e.message : "APNs 配置加载失败"; }
  finally { loading.value = false; }
}
async function save() {
  saving.value = true; error.value = "";
  try {
    apply(await adminApi.updateApnsConfig({ keyPath: form.keyPath.trim(), keyID: form.keyID.trim(), teamID: form.teamID.trim(), bundleID: form.bundleID.trim(), tickSeconds: Number(form.tickSeconds) }));
    if (error.value) ElMessage.warning("凭据已保存，部分频道创建失败，可重试");
    else ElMessage.success(form.configured ? "APNs 配置与广播频道已保存" : "APNs 已关闭");
  } catch (e) { error.value = e instanceof Error ? e.message : "APNs 配置保存失败"; }
  finally { saving.value = false; }
}
async function syncChannels() {
  syncing.value = true; error.value = "";
  try {
    apply(await adminApi.ensureApnsChannels());
    if (error.value) ElMessage.warning("部分频道创建失败，可重试");
    else ElMessage.success("广播频道已就绪");
  } catch (e) { error.value = e instanceof Error ? e.message : "频道创建失败"; }
  finally { syncing.value = false; }
}
onMounted(load);
</script>

<style scoped>
.settings-card { background: var(--cpu-card); border: 1px solid var(--cpu-border-soft); border-radius: 8px; padding: 18px; }
.pane-head, .channel-head, .actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pane-head { margin-bottom: 18px; } h2 { margin: 0; font-size: 18px; } p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: 13px; }
.push-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0 0 18px; max-width: 720px; }
.push-stat { display: grid; gap: 5px; padding: 13px 15px; border: 1px solid color-mix(in srgb, var(--cpu-primary) 28%, var(--cpu-border-soft)); border-radius: 7px; background: color-mix(in srgb, var(--cpu-primary) 6%, var(--cpu-card)); }
.push-stat--gradual { border-color: color-mix(in srgb, #e6a23c 42%, var(--cpu-border-soft)); background: color-mix(in srgb, #e6a23c 7%, var(--cpu-card)); }
.push-stat span { color: var(--cpu-text-secondary); font-size: 12px; font-weight: 650; }
.push-stat strong { color: var(--cpu-text); font-size: 24px; line-height: 1.1; }
.push-stat small { color: var(--cpu-text-tertiary, var(--cpu-text-secondary)); font-size: 11px; }
.mb { margin-bottom: 14px; } .config-form { max-width: 720px; } .channel-head { border-top: 1px solid var(--cpu-border-soft); padding-top: 16px; margin-top: 10px; }
.hint { margin: 8px 0 12px; } .channels { display: grid; gap: 8px; max-width: 720px; } .channel-row { display: grid; grid-template-columns: 100px 1fr; gap: 8px; align-items: center; }
.actions { justify-content: flex-end; margin-top: 18px; } @media (max-width: 620px) { .push-stats { grid-template-columns: 1fr; } .channel-row { grid-template-columns: 1fr; } }
</style>
