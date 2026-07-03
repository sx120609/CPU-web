<template>
  <div class="fs-submit-beta">
    <section class="fs-submit-shell" v-loading="loading">
      <button type="button" class="fs-submit-back" @click="$router.push('/services/tools/file_collect')">
        <el-icon><ArrowLeft /></el-icon>
        文件收集
      </button>

      <template v-if="task">
        <header class="fs-submit-hero">
          <div>
            <div class="fs-submit-kicker">
              <span>{{ task.status === "open" ? "文件提交" : "已停止提交" }}</span>
              <el-tag size="small" effect="plain">Beta</el-tag>
            </div>
            <h1>{{ task.title }}</h1>
            <p>{{ submitDescription }}</p>
            <small v-if="task.deadline">截止时间：{{ formatDateTime(task.deadline) }}</small>
          </div>
          <div class="fs-submit-hero-actions">
            <a :href="statusPath" target="_blank" rel="noopener">成功名单</a>
            <a :href="legacyPath" target="_blank" rel="noopener">旧版提交页</a>
          </div>
        </header>

        <el-alert
          v-if="task.remoteUpload?.enabled"
          class="fs-submit-alert"
          type="info"
          :closable="false"
          show-icon
          :title="task.remoteUpload.minSizeBytes > 0 ? `大于 ${formatBytes(task.remoteUpload.minSizeBytes)} 的文件会直传世纪互联。` : '本任务启用世纪互联直传。'"
        />

        <form v-if="task.status === 'open'" class="fs-submit-form" @submit.prevent="submit">
          <label v-for="field in task.fields" :key="field.key" class="fs-submit-field">
            <span>{{ field.label }}<b v-if="field.required">*</b></span>
            <el-input
              v-model="answers[field.key]"
              :placeholder="field.placeholder || ''"
              :disabled="submitting"
              @input="refreshFilePreview"
            />
          </label>

          <section class="fs-submit-files">
            <div class="fs-submit-files-head">
              <div>
                <b>上传文件</b>
                <span>允许 {{ allowedTypeText }}；单个不超过 {{ task.fileRules.maxSizeMb }} MB；最多 {{ task.fileRules.maxCount }} 个。</span>
              </div>
              <el-button plain @click.prevent="fileInput?.click()">
                <el-icon><Upload /></el-icon>
                选择文件
              </el-button>
            </div>
            <input ref="fileInput" type="file" multiple :accept="acceptTypes" :disabled="submitting" hidden @change="pickFiles" />
            <div
              class="fs-submit-drop"
              @dragover.prevent
              @drop.prevent="dropFiles"
              @click="fileInput?.click()"
            >
              <el-icon><FolderOpened /></el-icon>
              <span>点击选择文件，或拖到这里</span>
            </div>
            <div v-if="fileEntries.length" class="fs-submit-file-list">
              <article
                v-for="(entry, index) in fileEntries"
                :key="entry.id"
                class="fs-submit-file"
                draggable="true"
                @dragstart="draggedFileId = entry.id"
                @dragover.prevent
                @drop.prevent="moveDraggedFile(entry.id)"
              >
                <div class="fs-submit-file-thumb">
                  <img v-if="entry.previewUrl" :src="entry.previewUrl" alt="" />
                  <el-icon v-else><Document /></el-icon>
                </div>
                <div class="fs-submit-file-main">
                  <b>{{ entry.file.name }}</b>
                  <span>{{ savedPathPreview(entry.file, index + 1) }}</span>
                  <small>{{ formatBytes(entry.file.size) }}</small>
                </div>
                <div class="fs-submit-file-actions">
                  <button type="button" :disabled="index === 0 || submitting" @click="moveFile(index, index - 1)">上移</button>
                  <button type="button" :disabled="index === fileEntries.length - 1 || submitting" @click="moveFile(index, index + 1)">下移</button>
                  <button type="button" :disabled="submitting" class="danger" @click="removeFile(entry.id)">删除</button>
                </div>
              </article>
            </div>
          </section>

          <section class="fs-submit-tool-row">
            <div>
              <b>PDF 工具</b>
              <span>上传前可先合并、拆分或压缩 PDF。</span>
            </div>
            <a href="/services/tools/pdf_tools" target="_blank" rel="noopener">打开</a>
          </section>

          <el-progress v-if="submitting || progress > 0" :percentage="progress" :status="progress >= 100 ? 'success' : undefined" />
          <el-button class="fs-submit-button" type="primary" native-type="submit" :loading="submitting" :disabled="submitting">
            提交文件
          </el-button>
        </form>

        <section v-else class="fs-submit-closed">
          <b>该任务已停止提交</b>
          <span>如需补交，请联系任务发起者重新开放。</span>
        </section>
      </template>

      <el-empty v-else-if="!loading" :description="error || '提交任务不存在'">
        <el-button type="primary" :loading="loading" @click="load">重新加载</el-button>
      </el-empty>
    </section>

    <el-dialog v-model="successVisible" title="提交成功" width="420px">
      <div class="fs-submit-success">
        <b>提交编号 #{{ successPayload?.submissionId }}</b>
        <span>系统已保存以下文件：</span>
        <ul>
          <li v-for="file in successPayload?.files || []" :key="file">{{ file }}</li>
        </ul>
      </div>
      <template #footer>
        <el-button @click="successVisible = false">继续留在此页</el-button>
        <el-button type="primary" @click="openStatus">查看成功名单</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ArrowLeft, Document, FolderOpened, Upload } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  filestoreBetaApi,
  filestoreBetaUrl,
  type FilestoreBetaPreparedLocalFile,
  type FilestoreBetaPreparedRemoteFile,
  type FilestoreBetaPublicTask,
  type FilestoreBetaSubmitResult,
} from "@/api/filestoreBeta";
import {
  formatDateTime,
  normalizeAllowedTypes,
  previewStoredFileName,
  renderFilestoreBetaTemplate,
  requestErrorMessage,
  safeFileName,
} from "@/views/services/filestoreBetaShared";
import { formatBytes } from "@/views/services/fileCollectExport";

interface FileEntry {
  id: string;
  file: File;
  previewUrl: string;
}

const route = useRoute();
const loading = ref(false);
const submitting = ref(false);
const progress = ref(0);
const task = ref<FilestoreBetaPublicTask | null>(null);
const error = ref("");
const answers = reactive<Record<string, string>>({});
const fileEntries = ref<FileEntry[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const draggedFileId = ref("");
const successVisible = ref(false);
const successPayload = ref<FilestoreBetaSubmitResult | null>(null);
let loadSeq = 0;

const slug = computed(() => String(route.params.slug || "").trim());
const normalizedAllowedTypes = computed(() => normalizeAllowedTypes(task.value?.fileRules.allowedTypes ?? []));
const acceptTypes = computed(() => normalizedAllowedTypes.value.map((item) => `.${item}`).join(","));
const allowedTypeText = computed(() => normalizedAllowedTypes.value.join(", ") || "任意类型");
const statusPath = computed(() => `/services/tools/filestore-beta/status/${slug.value}`);
const legacyPath = computed(() => `/filestore/submit/${slug.value}`);
const submitDescription = computed(() => {
  if (!task.value) return "";
  const fields = task.value.fields.slice(0, 2).map((field) => field.label || field.key);
  const identifier = fields.length ? fields.join("和") : "身份信息";
  const updateTip = `如果提交后发现文件或信息有误，请使用相同的${identifier}重新提交，系统会提示你覆盖旧提交。`;
  return [task.value.description || "请按要求填写信息并上传文件。", updateTip].filter(Boolean).join("\n");
});

watch(slug, load, { immediate: true });

onBeforeUnmount(() => {
  clearFiles();
});

async function load() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  task.value = null;
  resetForm();
  if (!slug.value) {
    error.value = "提交地址无效";
    loading.value = false;
    return;
  }
  try {
    const next = await filestoreBetaApi.publicTask(slug.value);
    if (seq !== loadSeq) return;
    task.value = next;
    for (const field of next.fields) answers[field.key] = "";
  } catch (err) {
    if (seq !== loadSeq) return;
    error.value = requestErrorMessage(err, "提交任务加载失败");
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function resetForm() {
  Object.keys(answers).forEach((key) => delete answers[key]);
  clearFiles();
  progress.value = 0;
  if (fileInput.value) fileInput.value.value = "";
}

function clearFiles() {
  for (const entry of fileEntries.value) {
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  }
  fileEntries.value = [];
}

function refreshFilePreview() {
  fileEntries.value = [...fileEntries.value];
}

function pickFiles(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files || []);
  addFiles(files);
  if (fileInput.value) fileInput.value.value = "";
}

function dropFiles(event: DragEvent) {
  addFiles(Array.from(event.dataTransfer?.files || []));
}

function addFiles(files: File[]) {
  if (!task.value || submitting.value || !files.length) return;
  const known = new Set(fileEntries.value.map((entry) => `${entry.file.name}:${entry.file.size}:${entry.file.lastModified}`));
  const next = [...fileEntries.value];
  for (const file of files) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (known.has(key)) continue;
    const reason = validateOneFile(file);
    if (reason) {
      ElMessage.warning(reason);
      continue;
    }
    if (next.length >= task.value.fileRules.maxCount) {
      ElMessage.warning(`最多只能上传 ${task.value.fileRules.maxCount} 个文件`);
      break;
    }
    known.add(key);
    next.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
    });
  }
  fileEntries.value = next;
}

function removeFile(id: string) {
  const entry = fileEntries.value.find((item) => item.id === id);
  if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  fileEntries.value = fileEntries.value.filter((item) => item.id !== id);
}

function moveFile(from: number, to: number) {
  if (submitting.value || to < 0 || to >= fileEntries.value.length) return;
  const next = [...fileEntries.value];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  fileEntries.value = next;
}

function moveDraggedFile(targetId: string) {
  const from = fileEntries.value.findIndex((item) => item.id === draggedFileId.value);
  const to = fileEntries.value.findIndex((item) => item.id === targetId);
  draggedFileId.value = "";
  if (from < 0 || to < 0 || from === to) return;
  moveFile(from, to);
}

function currentData() {
  return Object.fromEntries((task.value?.fields || []).map((field) => [field.key, answers[field.key]?.trim() || ""]));
}

function validateFields() {
  if (!task.value) return "任务未加载";
  const data = currentData();
  for (const field of task.value.fields) {
    const value = data[field.key] || "";
    if (field.required && !value) return `请填写：${field.label}`;
    if (value && field.pattern) {
      try {
        if (!new RegExp(field.pattern).test(value)) return `“${field.label}”格式不正确`;
      } catch {
        return `“${field.label}”的校验规则暂不可用，请联系管理员`;
      }
    }
  }
  return "";
}

function validateFiles() {
  if (!task.value) return "任务未加载";
  if (!fileEntries.value.length) return "请选择要上传的文件";
  if (fileEntries.value.length > task.value.fileRules.maxCount) return `最多只能上传 ${task.value.fileRules.maxCount} 个文件`;
  for (const entry of fileEntries.value) {
    const reason = validateOneFile(entry.file);
    if (reason) return reason;
  }
  return "";
}

function validateOneFile(file: File) {
  if (!task.value) return "";
  const allowed = new Set(normalizedAllowedTypes.value);
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.trim().toLowerCase().replace(/^\.+/, "") : "";
  if (allowed.size && !allowed.has(ext)) return `${file.name} 类型不允许`;
  const maxBytes = task.value.fileRules.maxSizeMb * 1024 * 1024;
  if (file.size > maxBytes) return `${file.name} 超过 ${task.value.fileRules.maxSizeMb} MB`;
  return "";
}

function savedPathPreview(file: File, index: number) {
  if (!task.value) return file.name;
  const data = Object.fromEntries(Object.entries(currentData()).map(([key, value]) => [key, value || key]));
  const name = previewStoredFileName(task.value.renameTemplate, data, file.name, index, fileEntries.value.length);
  if (fileEntries.value.length <= 1) return name;
  return `${renderFilestoreBetaTemplate(task.value.folderTemplate, data)}/${name}`;
}

function shouldDirectUpload(file: File) {
  if (!task.value?.remoteUpload?.enabled) return false;
  const threshold = Math.max(0, Number(task.value.remoteUpload.minSizeBytes || 0));
  return threshold <= 0 || file.size >= threshold;
}

function shouldUseRemoteUpload(files: File[]) {
  return files.some((file) => shouldDirectUpload(file));
}

async function confirmOverwriteIfNeeded() {
  const duplicate = await filestoreBetaApi.checkDuplicate(slug.value, currentData());
  if (!duplicate.exists) return false;
  const files = duplicate.submission?.files?.length ? `\n旧文件：${duplicate.submission.files.join("、")}` : "";
  await ElMessageBox.confirm(
    `${duplicate.identityLabel || "身份信息"}“${duplicate.identity}”已经提交过，是否用本次提交覆盖？${files}`,
    "发现重复提交",
    { type: "warning", confirmButtonText: "覆盖旧提交", cancelButtonText: "取消" },
  );
  return true;
}

async function submit() {
  if (submitting.value || !task.value) return;
  const fieldError = validateFields();
  if (fieldError) {
    ElMessage.warning(fieldError);
    return;
  }
  const fileError = validateFiles();
  if (fileError) {
    ElMessage.warning(fileError);
    return;
  }
  submitting.value = true;
  progress.value = 0;
  try {
    const overwrite = await confirmOverwriteIfNeeded();
    const files = fileEntries.value.map((entry) => entry.file);
    const result = shouldUseRemoteUpload(files)
      ? await submitRemote(files, overwrite)
      : await submitMultipart(files, overwrite);
    applySuccess(result);
  } catch (err) {
    if (err !== "cancel") ElMessage.error(requestErrorMessage(err, "提交失败"));
  } finally {
    submitting.value = false;
  }
}

async function submitRemote(files: File[], overwrite: boolean) {
  const prepared = await filestoreBetaApi.prepareRemote(slug.value, {
    data: currentData(),
    overwrite,
    files: files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
    })),
  });
  const remoteByIndex = new Map(prepared.files.map((file) => [Number(file.index), file]));
  const localByIndex = new Map(prepared.localFiles.map((file) => [Number(file.index), file]));
  const remoteEntries = files
    .map((file, index) => ({ file, preparedFile: remoteByIndex.get(index) }))
    .filter((entry): entry is { file: File; preparedFile: FilestoreBetaPreparedRemoteFile } => Boolean(entry.preparedFile));
  const localEntries = files
    .map((file, index) => ({ file, preparedFile: localByIndex.get(index) }))
    .filter((entry): entry is { file: File; preparedFile: FilestoreBetaPreparedLocalFile } => Boolean(entry.preparedFile));

  if (remoteEntries.length + localEntries.length !== files.length) throw new Error("上传会话缺少部分文件，请刷新后重试");

  let uploadedBytes = 0;
  let localUploadedBytes = 0;
  const remoteBytes = remoteEntries.reduce((sum, entry) => sum + entry.file.size, 0);
  const localBytes = localEntries.reduce((sum, entry) => sum + entry.file.size, 0);
  const totalBytes = remoteBytes + localBytes;

  for (const entry of remoteEntries) {
    await uploadFileToSession(entry.file, entry.preparedFile, (bytes) => {
      uploadedBytes += bytes;
      progress.value = totalBytes ? Math.min(99, Math.round((uploadedBytes / totalBytes) * 100)) : 0;
    });
  }

  if (localEntries.length) {
    const form = new FormData();
    form.append("submissionId", String(prepared.submissionId));
    form.append("remoteFileIds", JSON.stringify(remoteEntries.map((entry) => entry.preparedFile.id)));
    form.append("localFileIds", JSON.stringify(localEntries.map((entry) => entry.preparedFile.id)));
    form.append("overwrite", overwrite ? "true" : "false");
    localEntries.forEach((entry) => form.append("files", entry.file, entry.file.name));
    return xhrJson<FilestoreBetaSubmitResult>(filestoreBetaUrl(`/api/submit/${slug.value}/complete-remote`), form, (loaded) => {
      localUploadedBytes = loaded;
      progress.value = totalBytes ? Math.min(99, Math.round(((uploadedBytes + localUploadedBytes) / totalBytes) * 100)) : 0;
    });
  }

  return filestoreBetaApi.completeRemote(slug.value, {
    submissionId: prepared.submissionId,
    remoteFileIds: remoteEntries.map((entry) => entry.preparedFile.id),
    overwrite,
  });
}

async function uploadFileToSession(file: File, uploadFile: FilestoreBetaPreparedRemoteFile, onProgress: (bytes: number) => void) {
  const chunkSize = 5 * 1024 * 1024;
  let start = 0;
  while (start < file.size) {
    const end = Math.min(start + chunkSize, file.size) - 1;
    const chunk = file.slice(start, end + 1);
    const response = await fetch(uploadFile.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Range": `bytes ${start}-${end}/${file.size}`,
        "Content-Type": uploadFile.mimeType || file.type || "application/octet-stream",
      },
      body: chunk,
    });
    if (![200, 201, 202].includes(response.status)) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail ? `${uploadFile.storedName} 上传失败：${detail.slice(0, 160)}` : `${uploadFile.storedName} 上传失败`);
    }
    onProgress(chunk.size);
    start = end + 1;
  }
}

function submitMultipart(files: File[], overwrite: boolean) {
  const form = new FormData();
  for (const [key, value] of Object.entries(currentData())) form.append(key, value);
  form.append("overwrite", overwrite ? "true" : "false");
  files.forEach((file) => form.append("files", file, file.name));
  return xhrJson<FilestoreBetaSubmitResult>(filestoreBetaUrl(`/api/submit/${slug.value}`), form, (loaded, total) => {
    progress.value = total ? Math.round((loaded / total) * 100) : 0;
  });
}

function xhrJson<T>(url: string, form: FormData, onProgress: (loaded: number, total: number) => void) {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    });
    xhr.addEventListener("load", () => {
      const payload = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload as T);
      else reject(new Error(payload.error || payload.message || "提交失败"));
    });
    xhr.addEventListener("error", () => reject(new Error("网络错误，提交失败")));
    xhr.open("POST", url);
    xhr.send(form);
  });
}

function applySuccess(result: FilestoreBetaSubmitResult) {
  progress.value = 100;
  successPayload.value = result;
  successVisible.value = true;
  resetForm();
  ElMessage.success(`提交成功，编号 #${result.submissionId}`);
}

function openStatus() {
  successVisible.value = false;
  window.open(statusPath.value, "_blank", "noopener,noreferrer");
}
</script>

<style scoped>
.fs-submit-beta {
  min-height: calc(100dvh - 64px);
  padding: 22px;
  background: var(--cpu-bg);
}

.fs-submit-shell {
  width: min(920px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 14px;
}

.fs-submit-back {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  border: 0;
  background: transparent;
  color: var(--cpu-primary);
  cursor: pointer;
}

.fs-submit-hero,
.fs-submit-form,
.fs-submit-closed {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface);
  box-shadow: var(--cpu-shadow-sm);
}

.fs-submit-hero {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 22px;
}

.fs-submit-kicker,
.fs-submit-hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.fs-submit-kicker span:first-child {
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 800;
}

.fs-submit-hero h1 {
  margin: 8px 0;
  color: var(--cpu-text);
  font-size: 26px;
}

.fs-submit-hero p {
  margin: 0;
  color: var(--cpu-text-secondary);
  line-height: 1.7;
  white-space: pre-wrap;
}

.fs-submit-hero small {
  display: block;
  margin-top: 8px;
  color: var(--cpu-text-secondary);
}

.fs-submit-hero-actions a,
.fs-submit-tool-row a {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  color: var(--cpu-primary);
  background: var(--cpu-surface-soft);
  text-decoration: none;
}

.fs-submit-form {
  display: grid;
  gap: 14px;
  padding: 18px;
}

.fs-submit-field {
  display: grid;
  gap: 7px;
}

.fs-submit-field span,
.fs-submit-files-head b,
.fs-submit-tool-row b {
  color: var(--cpu-text);
  font-weight: 650;
}

.fs-submit-field b {
  color: var(--cpu-danger);
  margin-left: 3px;
}

.fs-submit-files {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px dashed var(--cpu-border);
  border-radius: 8px;
  background: var(--cpu-surface-soft);
}

.fs-submit-files-head,
.fs-submit-tool-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.fs-submit-files-head span,
.fs-submit-tool-row span {
  display: block;
  margin-top: 3px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.fs-submit-drop {
  min-height: 96px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface);
  color: var(--cpu-text-secondary);
  cursor: pointer;
}

.fs-submit-drop .el-icon {
  color: var(--cpu-primary);
  font-size: 26px;
}

.fs-submit-file-list {
  display: grid;
  gap: 10px;
}

.fs-submit-file {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface);
}

.fs-submit-file-thumb {
  width: 58px;
  height: 58px;
  border-radius: 8px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--cpu-surface-soft);
  color: var(--cpu-primary);
}

.fs-submit-file-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fs-submit-file-main {
  min-width: 0;
}

.fs-submit-file-main b,
.fs-submit-file-main span,
.fs-submit-file-main small {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
}

.fs-submit-file-main b {
  color: var(--cpu-text);
}

.fs-submit-file-main span,
.fs-submit-file-main small {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.fs-submit-file-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.fs-submit-file-actions button {
  min-height: 32px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-primary);
  cursor: pointer;
}

.fs-submit-file-actions button.danger {
  color: var(--cpu-danger);
}

.fs-submit-file-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fs-submit-tool-row {
  padding: 12px 14px;
  border: 1px solid rgba(20, 143, 123, 0.18);
  border-radius: 8px;
  background: rgba(20, 143, 123, 0.08);
}

.fs-submit-button {
  justify-self: end;
  min-width: 140px;
}

.fs-submit-closed {
  min-height: 220px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  text-align: center;
}

.fs-submit-closed b {
  color: var(--cpu-text);
  font-size: 18px;
}

.fs-submit-closed span {
  color: var(--cpu-text-secondary);
}

.fs-submit-success {
  display: grid;
  gap: 8px;
}

.fs-submit-success b {
  color: var(--cpu-text);
}

.fs-submit-success span,
.fs-submit-success li {
  color: var(--cpu-text-secondary);
}

@media (max-width: 720px) {
  .fs-submit-beta {
    padding: 14px;
  }

  .fs-submit-hero,
  .fs-submit-files-head,
  .fs-submit-tool-row {
    flex-direction: column;
    align-items: stretch;
  }

  .fs-submit-file {
    grid-template-columns: 48px minmax(0, 1fr);
  }

  .fs-submit-file-actions {
    grid-column: 1 / -1;
    justify-content: stretch;
  }

  .fs-submit-file-actions button {
    flex: 1 1 0;
  }

  .fs-submit-button,
  .fs-submit-form :deep(.el-button) {
    width: 100%;
  }
}
</style>
