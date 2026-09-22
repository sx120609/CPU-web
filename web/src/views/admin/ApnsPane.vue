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
    <div class="actions"><el-button type="primary" :loading="saving" :disabled="loading" @click="save">保存 APNs 配置</el-button></div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { adminApi, type ApnsConfig } from "@/api/admin";

const loading = ref(false);
const saving = ref(false);
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
    if (error.value) ElMessage.warning("凭据已保存，推送初始化未完成，后台将自动重试");
    else ElMessage.success(form.configured ? "APNs 配置已保存" : "APNs 已关闭");
  } catch (e) { error.value = e instanceof Error ? e.message : "APNs 配置保存失败"; }
  finally { saving.value = false; }
}
onMounted(load);
</script>

<style scoped>
.settings-card { background: var(--cpu-card); border: 1px solid var(--cpu-border-soft); border-radius: 8px; padding: 18px; }
.pane-head, .actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pane-head { margin-bottom: 18px; } h2 { margin: 0; font-size: 18px; } p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: 13px; }
.mb { margin-bottom: 14px; } .config-form { max-width: 720px; }
.actions { justify-content: flex-end; margin-top: 18px; }
</style>
