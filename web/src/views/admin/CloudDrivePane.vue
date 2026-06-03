<template>
  <div class="cloud-drive-pane">
    <section class="drive-shell">
      <aside class="drive-sidebar">
        <div class="sidebar-card hero-card">
          <div class="hero-kicker">ADMIN CLOUD DRIVE</div>
          <h3>后台云盘</h3>
          <p>
            基于现有世纪互联 OneDrive / SharePoint 存储能力构建的文件管理器。
            当前独立写入 <code>{{ directory?.rootStoragePath || "cloud-drive" }}</code>。
          </p>

          <div class="summary-pills">
            <span class="summary-pill" :class="directory?.backend === 'onedrive-cn' ? 'is-remote' : 'is-local'">
              {{ directory?.backend === "onedrive-cn" ? "世纪互联文档库" : "本地兜底" }}
            </span>
            <span class="summary-pill" v-if="directory?.siteName">{{ directory.siteName }}</span>
            <span class="summary-pill" v-if="directory?.driveName">{{ directory.driveName }}</span>
          </div>

          <div class="sidebar-actions">
            <el-button type="primary" @click="triggerFilePicker">上传文件</el-button>
            <el-button @click="promptCreateFolder">新建文件夹</el-button>
          </div>
          <input ref="fileInputRef" type="file" multiple hidden @change="onFileInputChange" />
        </div>

        <div class="sidebar-card">
          <div class="card-head">
            <div>
              <div class="card-title">存储摘要</div>
              <div class="card-sub">和媒体存储配置共用同一套授权与文档库。</div>
            </div>
            <el-button text @click="reload()">刷新</el-button>
          </div>

          <div class="metric-grid">
            <div class="metric-item">
              <span>当前目录</span>
              <b>{{ currentFolderCount }}</b>
            </div>
            <div class="metric-item">
              <span>文件</span>
              <b>{{ currentFileCount }}</b>
            </div>
            <div class="metric-item">
              <span>文件夹</span>
              <b>{{ currentDirectoryCount }}</b>
            </div>
            <div class="metric-item">
              <span>队列</span>
              <b>{{ uploadTasks.length }}</b>
            </div>
          </div>

          <div class="meta-list">
            <div class="meta-row">
              <span>站点</span>
              <b>{{ directory?.siteName || "未显示" }}</b>
            </div>
            <div class="meta-row">
              <span>文档库</span>
              <b>{{ directory?.driveName || "未显示" }}</b>
            </div>
            <div class="meta-row">
              <span>实际根目录</span>
              <code>{{ directory?.rootStoragePath || "cloud-drive" }}</code>
            </div>
          </div>
        </div>

        <div class="sidebar-card" v-if="uploadTasks.length">
          <div class="card-head">
            <div>
              <div class="card-title">上传队列</div>
              <div class="card-sub">远端模式走 OneDrive 分片直传，本地模式走后端兜底。</div>
            </div>
          </div>

          <div class="upload-task-list">
            <div v-for="task in uploadTasks" :key="task.id" class="upload-task">
              <div class="upload-task-head">
                <strong>{{ task.name }}</strong>
                <span :class="['task-state', `state-${task.status}`]">{{ uploadStatusLabel(task.status) }}</span>
              </div>
              <div class="upload-task-meta">{{ task.detail }}</div>
              <el-progress :percentage="task.percent" :status="task.status === 'error' ? 'exception' : task.status === 'done' ? 'success' : undefined" />
            </div>
          </div>
        </div>
      </aside>

      <section class="drive-main">
        <el-alert
          v-if="directory && directory.backend === 'local' && !directory.remoteReady"
          type="warning"
          :closable="false"
          show-icon
          class="drive-alert"
          title="世纪互联文档库当前不可用，云盘已自动回退到本地目录。"
        />

        <div class="explorer-card">
          <div class="explorer-hero">
            <div>
              <div class="hero-label">Cloud Explorer</div>
              <h2>{{ directory?.rootName || "云盘根目录" }}</h2>
              <p>
                {{ directory?.backend === "onedrive-cn" ? "当前正在操作 SharePoint 文档库中的独立云盘子目录。" : "当前正在使用本地 fallback 目录，可继续上传与整理文件。" }}
              </p>
            </div>
            <div class="hero-controls">
              <el-input v-model="search" clearable placeholder="筛选文件名 / 扩展名" class="search-box" />
              <el-radio-group v-model="viewMode" size="small">
                <el-radio-button label="list">列表</el-radio-button>
                <el-radio-button label="grid">卡片</el-radio-button>
              </el-radio-group>
            </div>
          </div>

          <div class="toolbar">
            <div class="breadcrumbs">
              <button
                v-for="item in directory?.breadcrumbs || []"
                :key="item.path || 'root'"
                type="button"
                class="crumb"
                @click="openFolder(item.path)"
              >
                {{ item.name }}
              </button>
            </div>
            <div class="toolbar-actions">
              <el-button @click="goUp" :disabled="!directory?.currentPath">返回上级</el-button>
              <el-button @click="triggerFilePicker">上传</el-button>
              <el-button @click="promptCreateFolder">新建文件夹</el-button>
              <el-button @click="openSelected" :disabled="!selectedEntry">打开</el-button>
              <el-button @click="downloadSelected" :disabled="!selectedEntry || selectedEntry.kind !== 'file'">下载</el-button>
              <el-button @click="promptRename(selectedEntry || undefined)" :disabled="!selectedEntry">重命名</el-button>
              <el-button type="danger" plain @click="removeEntry(selectedEntry || undefined)" :disabled="!selectedEntry">删除</el-button>
            </div>
          </div>

          <div
            class="explorer-body"
            :class="{ 'is-dragover': dragActive }"
            v-loading="loading"
            @dragenter.prevent="dragActive = true"
            @dragover.prevent="dragActive = true"
            @dragleave.prevent="dragActive = false"
            @drop.prevent="onDropFiles"
          >
            <div v-if="!filteredEntries.length" class="empty-state">
              <div class="empty-title">当前目录还没有文件</div>
              <div class="empty-copy">把文件拖到这里，或者点击左侧“上传文件”开始使用。</div>
            </div>

            <template v-else-if="viewMode === 'list'">
              <div class="entry-table">
                <div class="entry-row entry-head">
                  <span>名称</span>
                  <span>类型</span>
                  <span>大小</span>
                  <span>更新时间</span>
                  <span>操作</span>
                </div>

                <button
                  v-for="entry in filteredEntries"
                  :key="entry.relativePath"
                  type="button"
                  class="entry-row entry-button"
                  :class="{ 'is-selected': selectedPath === entry.relativePath }"
                  @click="selectedPath = entry.relativePath"
                  @dblclick="handleEntryOpen(entry)"
                >
                  <span class="entry-name">
                    <span class="entry-icon" :class="entry.kind === 'folder' ? 'icon-folder' : 'icon-file'"></span>
                    <b>{{ entry.name }}</b>
                    <small v-if="entry.extension">.{{ entry.extension }}</small>
                  </span>
                  <span>{{ entry.kind === "folder" ? "文件夹" : entry.previewable ? "可预览文件" : "文件" }}</span>
                  <span>{{ entry.kind === "folder" ? "—" : formatBytes(entry.sizeBytes) }}</span>
                  <span>{{ fmtDate(entry.updatedAt) }}</span>
                  <span class="entry-row-actions" @click.stop>
                    <el-button text size="small" @click="handleEntryOpen(entry)">打开</el-button>
                    <el-button v-if="entry.kind === 'file'" text size="small" @click="downloadEntry(entry)">下载</el-button>
                    <el-button v-if="entry.webUrl" text size="small" @click="openRemoteUrl(entry)">远端页</el-button>
                  </span>
                </button>
              </div>
            </template>

            <template v-else>
              <div class="entry-grid">
                <button
                  v-for="entry in filteredEntries"
                  :key="entry.relativePath"
                  type="button"
                  class="grid-card"
                  :class="{ 'is-selected': selectedPath === entry.relativePath }"
                  @click="selectedPath = entry.relativePath"
                  @dblclick="handleEntryOpen(entry)"
                >
                  <div class="grid-badge" :class="entry.kind === 'folder' ? 'badge-folder' : 'badge-file'">
                    {{ entry.kind === "folder" ? "DIR" : entry.extension || "FILE" }}
                  </div>
                  <div class="grid-name">{{ entry.name }}</div>
                  <div class="grid-meta">{{ entry.kind === "folder" ? "文件夹" : formatBytes(entry.sizeBytes) }}</div>
                  <div class="grid-meta">{{ fmtDate(entry.updatedAt, "MM-DD HH:mm") }}</div>
                </button>
              </div>
            </template>
          </div>
        </div>
      </section>
    </section>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi, type CloudDriveDirectory, type CloudDriveEntry } from "@/api/admin";
import { fmtDate } from "@/utils/format";

type UploadTaskStatus = "preparing" | "uploading" | "processing" | "done" | "error";

type UploadTask = {
  id: string;
  name: string;
  status: UploadTaskStatus;
  percent: number;
  detail: string;
};

const ONEDRIVE_UPLOAD_CHUNK_BYTES = 32 * 320 * 1024;

const loading = ref(false);
const search = ref("");
const viewMode = ref<"list" | "grid">("list");
const directory = ref<CloudDriveDirectory | null>(null);
const selectedPath = ref("");
const dragActive = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const uploadTasks = ref<UploadTask[]>([]);

const filteredEntries = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  const list = directory.value?.entries || [];
  if (!keyword) return list;
  return list.filter((entry) => {
    const name = entry.name.toLowerCase();
    const ext = entry.extension.toLowerCase();
    return name.includes(keyword) || ext.includes(keyword);
  });
});

const selectedEntry = computed(() =>
  (directory.value?.entries || []).find((entry) => entry.relativePath === selectedPath.value) || null);

const currentFileCount = computed(() =>
  (directory.value?.entries || []).filter((entry) => entry.kind === "file").length);

const currentDirectoryCount = computed(() =>
  (directory.value?.entries || []).filter((entry) => entry.kind === "folder").length);

const currentFolderCount = computed(() => (directory.value?.entries || []).length);

onMounted(() => {
  reload().catch(() => null);
});

async function reload(path = directory.value?.currentPath || "") {
  loading.value = true;
  try {
    const data = await adminApi.cloudDrive(path);
    directory.value = data;
    if (!(data.entries || []).some((entry) => entry.relativePath === selectedPath.value)) {
      selectedPath.value = "";
    }
  } finally {
    loading.value = false;
  }
}

async function openFolder(path: string) {
  await reload(path);
}

async function goUp() {
  const currentPath = directory.value?.currentPath || "";
  if (!currentPath) return;
  const index = currentPath.lastIndexOf("/");
  await reload(index >= 0 ? currentPath.slice(0, index) : "");
}

function triggerFilePicker() {
  fileInputRef.value?.click();
}

async function onFileInputChange(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const files = Array.from(target?.files || []);
  target && (target.value = "");
  await enqueueFiles(files);
}

async function onDropFiles(event: DragEvent) {
  dragActive.value = false;
  const files = Array.from(event.dataTransfer?.files || []);
  await enqueueFiles(files);
}

async function enqueueFiles(files: File[]) {
  if (!files.length) return;
  for (const file of files) {
    const task: UploadTask = {
      id: `${Date.now()}-${Math.random()}`,
      name: file.name,
      status: "preparing",
      percent: 0,
      detail: "正在准备上传",
    };
    uploadTasks.value.unshift(task);
    try {
      await uploadSingleFile(file, task);
      task.status = "done";
      task.percent = 100;
      task.detail = "上传完成";
    } catch (error: any) {
      task.status = "error";
      task.detail = error?.message || "上传失败";
      ElMessage.error(`${file.name} 上传失败`);
    }
  }
  await reload();
}

async function uploadSingleFile(file: File, task: UploadTask) {
  const init = await adminApi.initCloudDriveUpload({
    path: directory.value?.currentPath || "",
    fileName: file.name,
    mimeType: file.type || "",
    fileSize: file.size,
  });

  if (init.mode === "direct" && init.uploadUrl && init.uploadToken) {
    await uploadFileToOneDriveSession(init.uploadUrl, file, file.type || "application/octet-stream", (stage, loaded, total) => {
      task.status = stage;
      task.percent = calcPercent(loaded, total);
      task.detail = uploadStageLabel(stage, loaded, total);
    });
    task.status = "processing";
    task.detail = "正在确认远端文件";
    task.percent = 100;
    await adminApi.completeCloudDriveUpload(init.uploadToken);
    return;
  }

  const formData = new FormData();
  formData.append("path", directory.value?.currentPath || "");
  formData.append("file", file, file.name);
  task.status = "uploading";
  task.detail = uploadStageLabel("uploading", 0, file.size);
  await adminApi.uploadCloudDriveFile(formData, {
    timeout: 180000,
    onUploadProgress: (event) => {
      const total = Number(event.total || file.size || 0);
      const loaded = Math.min(Number(event.loaded || 0), total || Number(event.loaded || 0));
      task.status = loaded >= total && total > 0 ? "processing" : "uploading";
      task.percent = calcPercent(loaded, total);
      task.detail = uploadStageLabel(task.status, loaded, total);
    },
  });
}

async function handleEntryOpen(entry: CloudDriveEntry) {
  selectedPath.value = entry.relativePath;
  if (entry.kind === "folder") {
    await openFolder(entry.relativePath);
    return;
  }
  await openAccessUrl(entry, false);
}

async function openSelected() {
  if (!selectedEntry.value) return;
  await handleEntryOpen(selectedEntry.value);
}

async function downloadSelected() {
  if (!selectedEntry.value || selectedEntry.value.kind !== "file") return;
  await downloadEntry(selectedEntry.value);
}

async function downloadEntry(entry: CloudDriveEntry) {
  await openAccessUrl(entry, true);
}

async function openAccessUrl(entry: CloudDriveEntry, download: boolean) {
  const { url } = await adminApi.cloudDriveAccessUrl({
    path: entry.relativePath,
    download,
  });
  window.open(url, "_blank", "noopener");
}

async function openRemoteUrl(entry: CloudDriveEntry) {
  if (!entry.webUrl) return;
  window.open(entry.webUrl, "_blank", "noopener");
}

async function promptCreateFolder() {
  try {
    const { value } = await ElMessageBox.prompt("输入新文件夹名称", "新建文件夹", {
      inputPlaceholder: "例如：素材归档",
      confirmButtonText: "创建",
      cancelButtonText: "取消",
    });
    if (!value) return;
    await adminApi.createCloudDriveFolder({
      path: directory.value?.currentPath || "",
      name: value,
    });
    ElMessage.success("文件夹已创建");
    await reload();
  } catch {
    /* ignore */
  }
}

async function promptRename(entry = selectedEntry.value || undefined) {
  if (!entry) return;
  try {
    const { value } = await ElMessageBox.prompt("输入新的名称", "重命名", {
      inputValue: entry.name,
      confirmButtonText: "保存",
      cancelButtonText: "取消",
    });
    if (!value) return;
    await adminApi.renameCloudDriveEntry({
      path: entry.relativePath,
      name: value,
    });
    ElMessage.success("已重命名");
    await reload(directory.value?.currentPath || "");
  } catch {
    /* ignore */
  }
}

async function removeEntry(entry = selectedEntry.value || undefined) {
  if (!entry) return;
  try {
    await ElMessageBox.confirm(
      `确认删除 ${entry.name}？${entry.kind === "folder" ? "文件夹会连同内部内容一起删除。" : ""}`,
      "删除确认",
      { type: "warning" },
    );
    await adminApi.deleteCloudDriveEntry(entry.relativePath);
    ElMessage.success("已删除");
    selectedPath.value = "";
    await reload(directory.value?.currentPath || "");
  } catch {
    /* ignore */
  }
}

function uploadStatusLabel(status: UploadTaskStatus) {
  if (status === "preparing") return "准备中";
  if (status === "uploading") return "上传中";
  if (status === "processing") return "处理中";
  if (status === "done") return "已完成";
  return "失败";
}

function uploadStageLabel(status: UploadTaskStatus, loaded: number, total: number) {
  if (status === "preparing") return "正在准备上传";
  if (status === "processing") return "正在校验并写入目录";
  return `${formatBytes(loaded)} / ${formatBytes(total)}`;
}

function calcPercent(loaded: number, total: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
}

function formatBytes(value: number | null | undefined) {
  const size = Number(value || 0);
  if (!size) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

async function uploadFileToOneDriveSession(
  uploadUrl: string,
  file: Blob,
  contentType: string,
  reportProgress: (stage: UploadTaskStatus, loaded: number, total: number) => void,
) {
  const total = file.size;
  let uploaded = 0;
  reportProgress("uploading", 0, total);
  while (uploaded < total) {
    const end = Math.min(uploaded + ONEDRIVE_UPLOAD_CHUNK_BYTES, total);
    const chunk = file.slice(uploaded, end);
    await axios.put(uploadUrl, chunk, {
      headers: {
        "Content-Type": contentType || "application/octet-stream",
        "Content-Range": `bytes ${uploaded}-${end - 1}/${total}`,
      },
      timeout: 180000,
      onUploadProgress: (event) => {
        const currentLoaded = uploaded + Math.min(Number(event.loaded || 0), chunk.size);
        reportProgress("uploading", currentLoaded, total);
      },
    });
    uploaded = end;
    reportProgress("uploading", uploaded, total);
  }
}
</script>

<style scoped>
.cloud-drive-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.drive-shell {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 16px;
}

.drive-sidebar,
.drive-main {
  min-width: 0;
}

.drive-sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sidebar-card,
.explorer-card {
  border: 1px solid #e7ebf3;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 14px 40px rgba(22, 37, 67, 0.08);
}

.sidebar-card {
  padding: 18px;
}

.hero-card {
  color: #0f172a;
  background:
    radial-gradient(circle at top right, rgba(34, 197, 94, 0.22), transparent 34%),
    linear-gradient(145deg, #f8fbff 0%, #eef5ff 58%, #f6fbf7 100%);
}

.hero-kicker,
.hero-label {
  font-size: 11px;
  letter-spacing: 0.12em;
  color: #5b6b83;
}

.hero-card h3,
.explorer-hero h2 {
  margin: 8px 0 10px;
  font-size: 28px;
  line-height: 1.1;
  color: #10213d;
}

.hero-card p,
.explorer-hero p,
.card-sub {
  margin: 0;
  color: #5d6b81;
  line-height: 1.7;
  font-size: 13px;
}

.summary-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.summary-pill {
  border-radius: 999px;
  padding: 7px 12px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(122, 141, 170, 0.2);
  font-size: 12px;
  color: #40526c;
}

.summary-pill.is-remote {
  color: #0f766e;
  background: rgba(236, 253, 245, 0.9);
}

.summary-pill.is-local {
  color: #92400e;
  background: rgba(255, 247, 237, 0.92);
}

.sidebar-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 16px;
}

.card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.card-title {
  font-size: 15px;
  font-weight: 700;
  color: #10213d;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}

.metric-item {
  border-radius: 14px;
  padding: 12px;
  background: #f8fbff;
  border: 1px solid #e8eef9;
}

.metric-item span {
  display: block;
  font-size: 12px;
  color: #6a7890;
}

.metric-item b {
  display: block;
  margin-top: 6px;
  font-size: 22px;
  color: #10213d;
}

.meta-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
}

.meta-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-row span {
  font-size: 12px;
  color: #7b8698;
}

.meta-row b,
.meta-row code {
  word-break: break-all;
}

.upload-task-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}

.upload-task {
  border-radius: 14px;
  padding: 12px;
  border: 1px solid #edf1f7;
  background: #fbfcfe;
}

.upload-task-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.upload-task-head strong {
  font-size: 13px;
  color: #12233f;
  word-break: break-all;
}

.upload-task-meta {
  margin: 6px 0 10px;
  color: #6d798c;
  font-size: 12px;
}

.task-state {
  font-size: 12px;
  white-space: nowrap;
}

.state-done { color: #15803d; }
.state-error { color: #dc2626; }
.state-uploading,
.state-processing,
.state-preparing { color: #2563eb; }

.drive-alert {
  margin-bottom: 14px;
}

.explorer-card {
  overflow: hidden;
}

.explorer-hero {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  padding: 22px 22px 18px;
  background:
    radial-gradient(circle at top left, rgba(56, 189, 248, 0.18), transparent 28%),
    linear-gradient(135deg, #ffffff 0%, #f6f9ff 48%, #f9fcff 100%);
  border-bottom: 1px solid #edf2fa;
}

.hero-controls {
  display: flex;
  gap: 12px;
  align-items: center;
}

.search-box {
  width: 240px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid #eef3f8;
}

.breadcrumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.crumb {
  border: 0;
  background: #eff5ff;
  color: #24446d;
  border-radius: 999px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 12px;
}

.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.explorer-body {
  min-height: 520px;
  padding: 18px 20px 22px;
  background:
    linear-gradient(180deg, rgba(248, 251, 255, 0.64), rgba(255, 255, 255, 0.96)),
    linear-gradient(90deg, rgba(21, 94, 117, 0.025) 1px, transparent 1px),
    linear-gradient(rgba(21, 94, 117, 0.025) 1px, transparent 1px);
  background-size: auto, 22px 22px, 22px 22px;
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}

.explorer-body.is-dragover {
  box-shadow: inset 0 0 0 2px #22c55e;
}

.empty-state {
  min-height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #73829a;
}

.empty-title {
  font-size: 20px;
  font-weight: 700;
  color: #10213d;
}

.empty-copy {
  margin-top: 8px;
  max-width: 420px;
  line-height: 1.7;
}

.entry-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entry-row {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) 120px 110px 160px 180px;
  gap: 12px;
  align-items: center;
}

.entry-head {
  padding: 0 16px 6px;
  color: #748096;
  font-size: 12px;
}

.entry-button {
  border: 1px solid #ebf0f7;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  padding: 14px 16px;
  text-align: left;
  cursor: pointer;
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.entry-button:hover {
  transform: translateY(-1px);
  border-color: #cfe0ff;
  box-shadow: 0 10px 24px rgba(27, 55, 103, 0.08);
}

.entry-button.is-selected {
  border-color: #7eb6ff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
}

.entry-name {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.entry-name b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #10213d;
}

.entry-name small {
  color: #8a95a6;
}

.entry-icon {
  width: 13px;
  height: 13px;
  border-radius: 4px;
  flex: none;
}

.icon-folder {
  background: linear-gradient(135deg, #f59e0b, #fb7185);
}

.icon-file {
  background: linear-gradient(135deg, #38bdf8, #2563eb);
}

.entry-row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.entry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}

.grid-card {
  border: 1px solid #ebf0f7;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.92);
  padding: 18px;
  min-height: 176px;
  text-align: left;
  cursor: pointer;
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.grid-card:hover {
  transform: translateY(-2px);
  border-color: #d3e3ff;
  box-shadow: 0 14px 30px rgba(18, 35, 63, 0.08);
}

.grid-card.is-selected {
  border-color: #7eb6ff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
}

.grid-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  height: 28px;
  border-radius: 999px;
  font-size: 11px;
  letter-spacing: 0.08em;
}

.badge-folder {
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
}

.badge-file {
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
}

.grid-name {
  margin-top: 16px;
  font-size: 15px;
  font-weight: 700;
  color: #10213d;
  line-height: 1.45;
  word-break: break-word;
}

.grid-meta {
  margin-top: 8px;
  color: #6b778b;
  font-size: 12px;
}

code {
  background: rgba(15, 23, 42, 0.05);
  border-radius: 8px;
  padding: 2px 6px;
}

@media (max-width: 1200px) {
  .drive-shell {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .explorer-hero,
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .hero-controls,
  .toolbar-actions {
    width: 100%;
  }

  .search-box {
    width: 100%;
  }

  .entry-row {
    grid-template-columns: minmax(0, 1.4fr) 90px 90px 130px 110px;
    gap: 10px;
  }
}

@media (max-width: 720px) {
  .sidebar-actions {
    grid-template-columns: 1fr;
  }

  .entry-head {
    display: none;
  }

  .entry-button {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .entry-row-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
</style>
