<template>
  <div class="filestore-settings-pane">
    <el-alert type="info" :closable="false" show-icon class="info-banner">
      <template #title>仅超级管理员可见</template>
      <div class="banner-copy">
        文件收集可复用媒体存储页的世纪互联 OneDrive / SharePoint 配置。开启后，提交页会走浏览器直传，服务器只负责生成上传会话和确认上传结果。
      </div>
    </el-alert>

    <section class="settings-card" v-loading="loading">
      <div class="section-head">
        <div>
          <h3 class="section-title">文件收集存储</h3>
          <p class="section-desc">提交规则仍由每个文件收集任务控制，包含文件类型、数量和单文件大小限制。</p>
        </div>
        <div class="summary-row" v-if="config">
          <el-tag :type="enabled ? 'success' : 'info'" round>{{ enabled ? "直传已开启" : "使用本地上传" }}</el-tag>
          <el-tag :type="config.remoteReady ? 'success' : 'warning'" round>{{ config.remoteReady ? "世纪互联就绪" : "世纪互联未就绪" }}</el-tag>
        </div>
      </div>

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

      <div class="toggle-row">
        <div>
          <div class="toggle-title">世纪互联直传</div>
          <p class="section-desc">公开提交页会先拿到 Graph 上传会话，再把文件分片直接传到文档库，不占用站点服务器上传带宽。</p>
        </div>
        <el-switch
          v-model="enabled"
          size="large"
          active-text="开启"
          inactive-text="关闭"
          :disabled="saving || loading || Boolean(loadError) || (!enabled && !remoteReady)"
        />
      </div>

      <div v-if="config" class="storage-status">
        <div class="status-item">
          <span>写入前缀</span>
          <b>{{ config.fileCollectPrefix }}</b>
        </div>
        <div class="status-item">
          <span>SharePoint 站点</span>
          <b>{{ config.oneDriveChinaSiteName || "未解析" }}</b>
        </div>
        <div class="status-item">
          <span>文档库</span>
          <b>{{ config.oneDriveChinaDriveName || "未选择" }}</b>
        </div>
        <div class="status-item">
          <span>远端根目录</span>
          <b>{{ config.oneDriveChinaRootPath || "/" }}</b>
        </div>
        <div class="status-item">
          <span>图片后端</span>
          <b>{{ providerName(config.imageProvider) }}</b>
        </div>
        <div class="status-item">
          <span>视频后端</span>
          <b>{{ providerName(config.videoProvider) }}</b>
        </div>
      </div>

      <el-alert
        v-if="config && !config.remoteReady"
        type="warning"
        :closable="false"
        show-icon
        class="pane-alert"
        title="需要先完成世纪互联授权并选择文档库"
      >
        <template #default>
          <div class="alert-action">
            <span>文件收集直传直接复用媒体存储页的数据，不在这里重复配置 Azure 应用。</span>
            <el-button size="small" type="primary" plain @click="goMediaStorage">去媒体存储</el-button>
          </div>
        </template>
      </el-alert>

      <el-alert
        v-if="config?.oneDriveChinaLastError"
        type="error"
        :closable="false"
        show-icon
        class="pane-alert"
        :title="config.oneDriveChinaLastError"
      />

      <div class="form-actions">
        <el-button type="primary" :loading="saving" :disabled="saving || loading || Boolean(loadError)" @click="save">
          保存文件收集设置
        </el-button>
        <el-button @click="goMediaStorage">媒体存储配置</el-button>
      </div>
    </section>

    <section class="settings-card">
      <div class="section-head">
        <div>
          <h3 class="section-title">打包下载</h3>
          <p class="section-desc">当前仍使用站点现有的浏览器端打包下载。</p>
        </div>
        <el-tag type="info" round>暂不开放云端打包</el-tag>
      </div>
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="pane-alert"
        title="世纪互联云端打包暂不作为用户选项"
      >
        <template #default>
          Microsoft Graph v1.0 目前只有文件内容下载接口；文件夹 archive 仍在 beta，等它稳定后再加可控开关更合适。
        </template>
      </el-alert>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { adminApi, type FilestoreStorageConfig } from "@/api/admin";

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const saving = ref(false);
const loadError = ref("");
const config = ref<FilestoreStorageConfig | null>(null);
const enabled = ref(false);
let loadSeq = 0;

const remoteReady = computed(() => Boolean(config.value?.remoteReady));

onMounted(reload);

async function reload() {
  const seq = ++loadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const next = await adminApi.filestoreStorageConfig({ suppressErrorMessage: true });
    if (seq !== loadSeq) return;
    applyConfig(next);
  } catch (error) {
    if (seq === loadSeq) loadError.value = requestMessage(error) || "文件收集存储配置加载失败";
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function applyConfig(next: FilestoreStorageConfig) {
  config.value = next;
  enabled.value = next.enabled;
}

async function save() {
  if (enabled.value && !remoteReady.value) {
    ElMessage.warning("请先在媒体存储页完成世纪互联授权并选择文档库");
    return;
  }
  saving.value = true;
  try {
    const next = await adminApi.updateFilestoreStorageConfig({ enabled: enabled.value });
    applyConfig(next);
    ElMessage.success("文件收集存储设置已保存");
  } catch (error) {
    ElMessage.error(requestMessage(error) || "保存失败");
  } finally {
    saving.value = false;
  }
}

function goMediaStorage() {
  router.push({
    query: {
      ...route.query,
      tab: "media-storage",
    },
  });
}

function providerName(value: string) {
  return value === "onedrive-cn" ? "世纪互联" : "本地";
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown; error?: unknown } } }).response?.data?.message
    ?? (error as { response?: { data?: { error?: unknown } } }).response?.data?.error;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.filestore-settings-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.info-banner :deep(.el-alert__title) {
  font-size: 14px;
}

.banner-copy {
  font-size: 13px;
  line-height: 1.7;
}

.settings-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border: 1px solid #e7edf5;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.04);
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
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
  line-height: 1.7;
  color: #667085;
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.pane-alert {
  margin-top: 2px;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 16px;
  border: 1px solid #edf2f7;
  border-radius: 12px;
  background: #ffffff;
}

.toggle-title {
  font-size: 15px;
  font-weight: 700;
  color: #172033;
}

.storage-status {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  padding: 12px;
  border: 1px solid #edf2f7;
  border-radius: 12px;
  background: #ffffff;
}

.status-item span {
  font-size: 12px;
  color: #7b8794;
}

.status-item b {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 14px;
  color: #172033;
}

.alert-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 720px) {
  .section-head,
  .toggle-row,
  .alert-action {
    align-items: stretch;
    flex-direction: column;
  }

  .summary-row {
    justify-content: flex-start;
  }
}
</style>
