<template>
  <div class="filestore-settings-pane">
    <el-alert type="info" :closable="false" show-icon class="info-banner">
      <template #title>仅超级管理员可见</template>
      <div class="banner-copy">
        文件收集统一写入 Filestore 的 file-collect 前缀。开启远端后，符合阈值的提交文件会保存到世纪互联文档库，未命中的文件继续留在本地 Filestore。
      </div>
    </el-alert>

    <section class="settings-card" v-loading="loading">
      <div class="section-head">
        <div>
          <h3 class="section-title">文件收集存储</h3>
          <p class="section-desc">提交规则仍由每个文件收集任务控制，包含文件类型、数量和单文件大小限制。</p>
        </div>
        <div class="summary-row" v-if="config">
          <el-tag :type="enabled ? 'success' : 'info'" round>{{ enabled ? "远端已开启" : "本地 Filestore" }}</el-tag>
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
          <div class="toggle-title">Filestore 远端存储</div>
          <p class="section-desc">提交文件先进入文件收集的 Filestore 流程，再按策略保存到本地或世纪互联文档库。</p>
        </div>
        <el-switch
          v-model="enabled"
          size="large"
          active-text="开启"
          inactive-text="关闭"
          :disabled="saving || loading || Boolean(loadError) || (!enabled && !remoteReady)"
        />
      </div>

      <div class="threshold-row">
        <div>
          <div class="toggle-title">远端阈值</div>
          <p class="section-desc">单个文件达到这个大小时保存到世纪互联；填 0 表示开启后全部文件都走远端存储。</p>
        </div>
        <div class="threshold-control">
          <el-input-number
            v-model="minSizeMb"
            :min="0"
            :max="10240"
            :precision="2"
            :step="1"
            controls-position="right"
            :disabled="saving || loading || Boolean(loadError)"
          />
          <span>MB</span>
        </div>
      </div>

      <div v-if="config" class="storage-status">
        <div class="status-item">
          <span>写入前缀</span>
          <b>{{ config.fileCollectPrefix }}</b>
        </div>
        <div class="status-item">
          <span>远端策略</span>
          <b>{{ thresholdLabel }}</b>
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
            <span>文件收集远端存储复用站点的世纪互联授权，不在这里重复配置 Azure 应用。</span>
            <el-button size="small" type="primary" plain @click="goMediaStorage">去远端存储配置</el-button>
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
        <el-button @click="goMediaStorage">远端存储配置</el-button>
      </div>
    </section>

    <section class="settings-card">
      <div class="section-head">
        <div>
          <h3 class="section-title">打包下载</h3>
          <p class="section-desc">当前仍使用站点现有的浏览器端打包下载，文件来源由 Filestore 自动解析。</p>
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
const minSizeMb = ref(0);
let loadSeq = 0;

const remoteReady = computed(() => Boolean(config.value?.remoteReady));
const thresholdLabel = computed(() => {
  if (!config.value?.enabled) return "未开启";
  return Number(config.value.minSizeMb || 0) > 0
    ? `${config.value.minSizeMb} MB 及以上`
    : "全部直传";
});

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
  minSizeMb.value = Number(next.minSizeMb || 0);
}

async function save() {
  if (enabled.value && !remoteReady.value) {
    ElMessage.warning("请先完成世纪互联授权并选择文档库");
    return;
  }
  saving.value = true;
  try {
    const next = await adminApi.updateFilestoreStorageConfig({
      enabled: enabled.value,
      minSizeMb: minSizeMb.value,
    });
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
  border: 1px solid var(--cpu-border-soft);
  border-radius: 16px;
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
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
  color: var(--cpu-text);
}

.section-desc {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--cpu-text-secondary);
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
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-surface);
}

.threshold-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 16px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-surface);
}

.threshold-control {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--cpu-text-secondary);
  font-size: 13px;
}

.toggle-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--cpu-text);
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
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-surface);
}

.status-item span {
  font-size: 12px;
  color: var(--cpu-text-muted);
}

.status-item b {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 14px;
  color: var(--cpu-text);
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
  .threshold-row,
  .alert-action {
    align-items: stretch;
    flex-direction: column;
  }

  .summary-row {
    justify-content: flex-start;
  }
}
</style>
