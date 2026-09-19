<template>
  <section class="settings-card" v-loading="loading">
    <div class="pane-head">
      <div>
        <h2>APNs 推送</h2>
        <p>配置实时活动的服务端推送凭据和学校广播频道，保存后供推送服务读取。</p>
      </div>
      <el-tag :type="form.configured ? 'success' : 'info'">{{ form.configured ? "已配置" : "未配置" }}</el-tag>
    </div>
    <div class="push-stats" aria-label="iOS 推送统计">
      <div class="push-stat">
        <span>iOS 26+ 可 Channel 推送</span>
        <strong>{{ form.iosPushStats?.channelPushUsers ?? "--" }}</strong>
        <small>按已使用 iOS 客户端的用户去重</small>
      </div>
      <div class="push-stat push-stat--gradual">
        <span>需要逐步推送</span>
        <strong>{{ form.iosPushStats?.gradualPushUsers ?? "--" }}</strong>
        <small>iOS 版本低于 26 或版本未知</small>
      </div>
    </div>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="mb" />
    <el-form label-width="150px" class="config-form">
      <el-form-item label="密钥文件路径"><el-input v-model="form.keyPath" placeholder="服务器上的 AuthKey_XXXX.p8 路径" /></el-form-item>
      <el-form-item label="Key ID"><el-input v-model="form.keyID" /></el-form-item>
      <el-form-item label="Team ID"><el-input v-model="form.teamID" /></el-form-item>
      <el-form-item label="Bundle ID"><el-input v-model="form.bundleID" placeholder="例如 me.example.cputime" /></el-form-item>
      <el-form-item label="调度间隔（秒）"><el-input-number v-model="form.tickSeconds" :min="0.5" :max="3600" :step="0.5" /></el-form-item>
    </el-form>
    <div class="channel-head"><strong>广播频道</strong><el-button size="small" @click="addChannel">添加频道</el-button></div>
    <p class="hint">频道键使用 production:学校ID 或 sandbox:学校ID，频道 ID 由 Apple Broadcast Push API 返回。</p>
    <div v-if="channels.length" class="channels">
      <div v-for="(channel, index) in channels" :key="channel.id" class="channel-row">
        <el-input v-model="channel.key" placeholder="production:nju" />
        <el-input v-model="channel.value" placeholder="apns-channel-id" />
        <el-button text type="danger" @click="channels.splice(index, 1)">删除</el-button>
      </div>
    </div>
    <el-empty v-else description="暂无广播频道" :image-size="50" />
    <div class="actions"><el-button type="primary" :loading="saving" :disabled="loading" @click="save">保存 APNs 配置</el-button></div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { adminApi, type ApnsConfig, type ApnsPushStats } from "@/api/admin";

type Channel = { id: number; key: string; value: string };
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const form = reactive<Omit<ApnsConfig, "iosPushStats"> & { iosPushStats: ApnsPushStats | null }>({ keyPath: "", keyID: "", teamID: "", bundleID: "", tickSeconds: 5, channels: {}, configured: false, updatedAt: null, iosPushStats: null });
const channels = ref<Channel[]>([]);
let nextID = 1;

function apply(value: ApnsConfig) {
  Object.assign(form, value);
  channels.value = Object.entries(value.channels || {}).map(([key, channel]) => ({ id: nextID++, key, value: channel }));
}
function addChannel() { channels.value.push({ id: nextID++, key: "", value: "" }); }
async function load() {
  loading.value = true; error.value = "";
  try { apply(await adminApi.apnsConfig({ cacheTtlMs: 0 })); }
  catch (e) { error.value = e instanceof Error ? e.message : "APNs 配置加载失败"; }
  finally { loading.value = false; }
}
async function save() {
  saving.value = true; error.value = "";
  try {
    const mapped = Object.fromEntries(channels.value.filter((item) => item.key.trim() || item.value.trim()).map((item) => [item.key.trim(), item.value.trim()]));
    apply(await adminApi.updateApnsConfig({ keyPath: form.keyPath.trim(), keyID: form.keyID.trim(), teamID: form.teamID.trim(), bundleID: form.bundleID.trim(), tickSeconds: Number(form.tickSeconds), channels: mapped }));
    ElMessage.success("APNs 配置已保存");
  } catch (e) { error.value = e instanceof Error ? e.message : "APNs 配置保存失败"; }
  finally { saving.value = false; }
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
.hint { margin: 8px 0 12px; } .channels { display: grid; gap: 8px; max-width: 720px; } .channel-row { display: grid; grid-template-columns: 1fr 1.5fr auto; gap: 8px; align-items: center; }
.actions { justify-content: flex-end; margin-top: 18px; } @media (max-width: 620px) { .push-stats { grid-template-columns: 1fr; } .channel-row { grid-template-columns: 1fr; } }
</style>
