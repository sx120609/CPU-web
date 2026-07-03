<template>
  <div class="filestore-beta-legacy">
    <main class="submit-shell">
      <section class="submit-card">
        <div class="submit-brandbar">
          <div class="submit-brand">
            <span class="brand-mark">药</span>
            <div>
              <strong>{{ task?.siteTitle || "药大拾间文件收集" }}</strong>
              <small>CPU 校园互助服务 · 文件提交入口</small>
            </div>
          </div>
          <span class="submit-brand-tag">校园小工具</span>
        </div>
        <div class="submit-hero">
          <p class="eyebrow">{{ task?.status === "closed" ? "药大拾间 · 已停止提交" : "药大拾间 · 文件提交" }}</p>
          <h1>{{ task?.title || (loading ? "加载任务中" : "无法提交") }}</h1>
          <p>{{ task ? submitDescription : (error || "请稍候。") }}</p>
          <p v-if="task?.deadline" class="hint hero-deadline">截止时间：{{ formatDateTime(task.deadline) }}</p>
        </div>

        <div v-if="task" class="status-shortcut">
          <a :href="statusPath" target="_blank" rel="noopener">
            查看提交成功名单
            <span>只展示已提交记录和文件名，不公开文件内容。</span>
          </a>
        </div>

        <form v-if="task && task.status === 'open'" class="submit-form" @submit.prevent="submit" @reset.prevent="resetForm">
          <div>
            <div class="submit-section-title">
              <strong>身份信息</strong>
              <span>用于匹配提交记录和文件命名</span>
            </div>
            <label v-for="field in task.fields" :key="field.key">
              {{ field.label }}<span v-if="field.required" class="required-star">*</span>
              <input
                v-model="answers[field.key]"
                :placeholder="field.placeholder || ''"
                :required="field.required"
                :pattern="field.pattern || undefined"
                :disabled="submitting"
                @input="renderQueue"
              >
            </label>
          </div>

          <div v-if="visibleSurveyFields.length" class="submit-survey-section">
            <div class="submit-section-title">
              <strong>问卷信息</strong>
              <span>请按实际情况填写</span>
            </div>
            <section v-for="(field, index) in visibleSurveyFields" :key="field.id" class="submit-survey-field">
              <div class="submit-question-title">
                <span>{{ index + 1 }}</span>
                <div>
                  <strong>{{ field.label }}<em v-if="field.required">*</em></strong>
                  <p v-if="field.description">{{ field.description }}</p>
                </div>
              </div>
              <input
                v-if="field.type === 'text'"
                v-model="surveyAnswers[field.id] as string"
                :maxlength="field.maxLength || 300"
                :placeholder="field.placeholder || ''"
                :required="field.required"
                :disabled="submitting"
              >
              <textarea
                v-else-if="field.type === 'textarea'"
                v-model="surveyAnswers[field.id] as string"
                :maxlength="field.maxLength || 2000"
                :placeholder="field.placeholder || ''"
                :required="field.required"
                :disabled="submitting"
              ></textarea>
              <div v-else-if="field.type === 'single'" class="submit-option-list">
                <label v-for="option in field.options || []" :key="option" class="submit-option">
                  <input v-model="surveyAnswers[field.id]" type="radio" :name="field.id" :value="option" :required="field.required" :disabled="submitting">
                  <span>{{ option }}</span>
                </label>
              </div>
              <div v-else-if="field.type === 'multiple'" class="submit-option-list">
                <label v-for="option in field.options || []" :key="option" class="submit-option">
                  <input :checked="multiValue(field.id).includes(option)" type="checkbox" :value="option" :disabled="submitting" @change="toggleMulti(field.id, option, $event)">
                  <span>{{ option }}</span>
                </label>
              </div>
              <input
                v-else-if="field.type === 'number'"
                v-model="surveyAnswers[field.id] as string"
                type="number"
                :min="field.min"
                :max="field.max"
                :step="field.step || 1"
                :placeholder="field.placeholder || '请输入数字'"
                :required="field.required"
                :disabled="submitting"
              >
              <input
                v-else-if="field.type === 'date'"
                v-model="surveyAnswers[field.id] as string"
                type="date"
                :required="field.required"
                :disabled="submitting"
              >
              <div v-else-if="field.type === 'rating'" class="submit-rating-field">
                <button
                  v-for="score in ratingRange(field)"
                  :key="score"
                  type="button"
                  :class="{ active: surveyAnswers[field.id] === String(score) }"
                  :disabled="submitting"
                  @click="surveyAnswers[field.id] = surveyAnswers[field.id] === String(score) ? '' : String(score)"
                >
                  {{ score }}
                </button>
              </div>
            </section>
          </div>

          <label class="upload-zone">
            <strong>上传文件</strong>
            <span class="hint">{{ fileRulesText }}</span>
            <input ref="fileInput" name="files" type="file" multiple :accept="acceptTypes" :disabled="submitting" @change="pickFiles">
          </label>
          <div class="pdf-tool-shortcut">
            <div>
              <strong>PDF 工具</strong>
              <span>上传前可先合并、拆分或压缩 PDF。</span>
            </div>
            <a href="/services/tools/pdf_tools" target="_blank" rel="noopener">打开 PDF 工具</a>
          </div>
          <div v-if="fileEntries.length" class="submit-file-queue">
            <div class="submit-file-head">
              <strong>待上传文件</strong>
              <span>可拖拽或使用按钮调整顺序</span>
            </div>
            <div class="submit-file-grid">
              <article
                v-for="(entry, index) in fileEntries"
                :key="entry.id"
                class="submit-file-card"
                draggable="true"
                @dragstart="draggedFileId = entry.id"
                @dragend="draggedFileId = ''"
                @dragover.prevent
                @drop.prevent="moveDraggedFile(entry.id)"
              >
                <div class="submit-file-preview">
                  <img v-if="entry.previewUrl" :src="entry.previewUrl" alt="">
                  <span v-else class="submit-file-icon">{{ fileIcon(entry.file.name) }}</span>
                </div>
                <div class="submit-file-title">
                  <span class="file-type-badge">{{ fileExt(entry.file.name).toUpperCase() || "FILE" }}</span>
                  <strong>{{ entry.file.name }}</strong>
                </div>
                <button type="button" class="submit-file-remove" :disabled="submitting" @click="removeFile(entry.id)">×</button>
                <dl class="submit-file-meta">
                  <dt>保存为</dt><dd>{{ savedPathPreview(entry.file, index + 1) }}</dd>
                  <dt>大小</dt><dd>{{ formatBytes(entry.file.size) }}</dd>
                </dl>
                <div class="submit-file-actions">
                  <button type="button" :disabled="submitting || index === 0" @click="moveFile(index, index - 1)">上移</button>
                  <button type="button" :disabled="submitting || index === fileEntries.length - 1" @click="moveFile(index, index + 1)">下移</button>
                </div>
              </article>
            </div>
          </div>

          <progress v-if="submitting || progress > 0" :value="progress" max="100"></progress>

          <div class="submit-actions">
            <button class="primary" type="submit" :disabled="submitting">{{ submitting ? "提交中" : "提交文件" }}</button>
            <button type="reset" :disabled="submitting">重填</button>
          </div>
        </form>
        <p :class="['message', messageType, 'submit-form']">{{ submitMessage }}</p>
      </section>
    </main>

    <dialog ref="successDialog" class="success-dialog">
      <div class="success-check" aria-hidden="true">
        <svg viewBox="0 0 64 64" role="img">
          <circle cx="32" cy="32" r="28"></circle>
          <path d="M19 33.5 28 42 46 23"></path>
        </svg>
      </div>
      <h2>提交成功</h2>
      <p>{{ successSummary }}</p>
      <div class="success-files">
        <span v-for="file in successPayload?.files || []" :key="file">{{ file }}</span>
      </div>
      <div class="success-actions">
        <a class="primary success-status-link" :href="statusPath">查看提交成功名单</a>
        <button type="button" @click="successDialog?.close()">关闭</button>
      </div>
    </dialog>

    <dialog ref="overwriteDialog" class="overwrite-dialog">
      <div class="dialog-head">
        <div>
          <h2>发现已有提交</h2>
          <p class="hint">{{ overwriteSummary }}</p>
        </div>
      </div>
      <div class="overwrite-files">
        <span v-for="file in overwriteFiles" :key="file">{{ file }}</span>
      </div>
      <p class="overwrite-warning">继续提交会用本次填写的信息和文件覆盖旧提交。</p>
      <div class="dialog-actions">
        <button type="button" @click="resolveOverwrite(false)">取消</button>
        <button class="primary" type="button" @click="resolveOverwrite(true)">覆盖旧提交</button>
      </div>
    </dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  filestoreBetaApi,
  filestoreBetaUrl,
  type FilestoreBetaDuplicatePayload,
  type FilestoreBetaPreparedLocalFile,
  type FilestoreBetaPreparedRemoteFile,
  type FilestoreBetaPublicTask,
  type FilestoreBetaSurveyAnswer,
  type FilestoreBetaSurveyField,
  type FilestoreBetaSubmitResult,
} from "@/api/filestoreBeta";
import {
  formatDateTime,
  normalizeAllowedTypes,
  previewStoredFileName,
  renderFilestoreBetaTemplate,
  requestErrorMessage,
  useScopedLegacyFilestoreCss,
} from "@/views/services/filestoreBetaShared";
import { formatBytes } from "@/views/services/fileCollectExport";

type MessageType = "" | "ok" | "error" | "warn";
type FileEntry = {
  id: string;
  file: File;
  previewUrl: string;
};

const route = useRoute();
const loading = ref(false);
const submitting = ref(false);
const progress = ref(0);
const task = ref<FilestoreBetaPublicTask | null>(null);
const error = ref("");
const answers = reactive<Record<string, string>>({});
const surveyAnswers = reactive<Record<string, FilestoreBetaSurveyAnswer>>({});
const fileEntries = ref<FileEntry[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const draggedFileId = ref("");
const submitMessage = ref("");
const messageType = ref<MessageType>("");
const successPayload = ref<FilestoreBetaSubmitResult | null>(null);
const successDialog = ref<HTMLDialogElement | null>(null);
const overwriteDialog = ref<HTMLDialogElement | null>(null);
const overwriteSummary = ref("");
const overwriteFiles = ref<string[]>([]);
let overwriteResolve: ((value: boolean | null) => void) | null = null;
let loadSeq = 0;

useScopedLegacyFilestoreCss();

const slug = computed(() => String(route.params.slug || "").trim());
const statusPath = computed(() => `/services/tools/filestore-beta/status/${slug.value}`);
const normalizedAllowedTypes = computed(() => normalizeAllowedTypes(task.value?.fileRules.allowedTypes ?? []));
const acceptTypes = computed(() => normalizedAllowedTypes.value.map((item) => `.${item}`).join(","));
const fileRulesText = computed(() => {
  const rules = task.value?.fileRules;
  if (!rules) return "";
  return `允许 ${normalizedAllowedTypes.value.join(", ") || "任意类型"}；单文件不超过 ${rules.maxSizeMb} MB；最多 ${rules.maxCount} 个。`;
});
const submitDescription = computed(() => {
  if (!task.value) return "";
  const fields = task.value.fields.slice(0, 2).map((field) => field.label || field.key);
  const identifier = fields.length > 0 ? fields.join("和") : "身份信息";
  const updateTip = `如果提交后发现文件或信息有误，请使用相同的${identifier}重新提交，系统会自动用新提交覆盖旧提交。`;
  return [task.value.description || "请按要求填写信息并上传文件。", updateTip].filter(Boolean).join("\n");
});
const successSummary = computed(() => successPayload.value ? `提交成功，编号 ${successPayload.value.submissionId}。` : "");
const visibleSurveyFields = computed(() => resolveVisibleSurveyFields(task.value?.surveyFields || []));

watch(slug, load, { immediate: true });

onBeforeUnmount(clearFiles);

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
    document.title = `${next.siteTitle || "药大拾间文件收集"} - ${next.title}`;
    for (const field of next.fields) answers[field.key] = "";
    for (const field of next.surveyFields || []) surveyAnswers[field.id] = field.type === "multiple" ? [] : "";
  } catch (err) {
    if (seq !== loadSeq) return;
    error.value = requestErrorMessage(err, "任务加载失败");
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function message(text: string, type: MessageType = "") {
  submitMessage.value = text;
  messageType.value = type;
}

function resetForm() {
  Object.keys(answers).forEach((key) => delete answers[key]);
  Object.keys(surveyAnswers).forEach((key) => delete surveyAnswers[key]);
  clearFiles();
  progress.value = 0;
  message("");
  if (fileInput.value) fileInput.value.value = "";
}

function clearFiles() {
  for (const entry of fileEntries.value) {
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  }
  fileEntries.value = [];
}

function renderQueue() {
  fileEntries.value = [...fileEntries.value];
}

function pickFiles(event: Event) {
  addFiles(Array.from((event.target as HTMLInputElement).files || []));
  if (fileInput.value) fileInput.value.value = "";
}

function addFiles(files: File[]) {
  if (!task.value || submitting.value) return;
  const known = new Set(fileEntries.value.map((entry) => fileKey(entry.file)));
  const next = [...fileEntries.value];
  for (const file of files) {
    const key = fileKey(file);
    if (known.has(key)) continue;
    const reason = validateOneFile(file);
    if (reason) {
      message(reason, "error");
      continue;
    }
    if (next.length >= task.value.fileRules.maxCount) {
      message(`最多只能上传 ${task.value.fileRules.maxCount} 个文件`, "error");
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

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
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
  if (from >= 0 && to >= 0 && from !== to) moveFile(from, to);
  draggedFileId.value = "";
}

function currentData() {
  return Object.fromEntries((task.value?.fields || []).map((field) => [field.key, answers[field.key]?.trim() || ""]));
}

function currentSurveyAnswers() {
  const result: Record<string, FilestoreBetaSurveyAnswer> = {};
  for (const field of visibleSurveyFields.value) {
    const value = surveyAnswers[field.id];
    result[field.id] = Array.isArray(value) ? value.map(String).filter(Boolean) : String(value ?? "").trim();
  }
  return result;
}

function multiValue(fieldId: string) {
  const value = surveyAnswers[fieldId];
  return Array.isArray(value) ? value : [];
}

function toggleMulti(fieldId: string, option: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  const values = new Set(multiValue(fieldId));
  if (checked) values.add(option);
  else values.delete(option);
  surveyAnswers[fieldId] = Array.from(values);
}

function hasSurveyAnswer(value: FilestoreBetaSurveyAnswer | undefined) {
  return Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? "").trim());
}

function ratingRange(field: FilestoreBetaSurveyField) {
  const min = Math.max(0, Math.round(Number(field.min ?? 1)));
  const max = Math.min(10, Math.round(Number(field.max ?? 5)));
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
}

function resolveVisibleSurveyFields(fields: FilestoreBetaSurveyField[]) {
  const result: FilestoreBetaSurveyField[] = [];
  const indexById = new Map(fields.map((field, index) => [field.id, index]));
  for (let index = 0; index < fields.length;) {
    const field = fields[index];
    result.push(field);
    if (field.type === "single") {
      const value = String(surveyAnswers[field.id] ?? "").trim();
      const rule = value ? field.branching?.[value] : undefined;
      if (rule?.action === "end") break;
      if (rule?.action === "jump" && rule.targetId) {
        const targetIndex = indexById.get(rule.targetId);
        if (targetIndex !== undefined && targetIndex > index) {
          index = targetIndex;
          continue;
        }
      }
    }
    index += 1;
  }
  return result;
}

function validateFields() {
  if (!task.value) return "任务未加载";
  const data = currentData();
  for (const field of task.value.fields) {
    const value = data[field.key] || "";
    if (field.required && !value) return `${field.label}不能为空`;
    if (value && field.pattern) {
      try {
        if (!new RegExp(field.pattern).test(value)) return `${field.label}格式不正确`;
      } catch {
        return `${field.label}校验规则暂不可用`;
      }
    }
  }
  return "";
}

function validateSurveyFields() {
  for (const field of visibleSurveyFields.value) {
    const value = surveyAnswers[field.id];
    if (field.required && !hasSurveyAnswer(value)) return `请填写：${field.label}`;
    if (field.type === "single" && value) {
      if (!(field.options || []).includes(String(value))) return `“${field.label}”包含无效选项`;
    }
    if (field.type === "multiple") {
      const invalid = multiValue(field.id).find((item) => !(field.options || []).includes(item));
      if (invalid) return `“${field.label}”包含无效选项`;
    }
    if ((field.type === "number" || field.type === "rating") && value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return `“${field.label}”需要填写数字`;
      if (field.min !== undefined && numeric < Number(field.min)) return `“${field.label}”不能小于 ${field.min}`;
      if (field.max !== undefined && numeric > Number(field.max)) return `“${field.label}”不能大于 ${field.max}`;
    }
  }
  return "";
}

function validateFiles() {
  if (!task.value) return "任务未加载";
  if (!fileEntries.value.length) return "请上传文件";
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
  const ext = fileExt(file.name);
  if (allowed.size && !allowed.has(ext)) return `${file.name} 类型不允许`;
  const maxBytes = task.value.fileRules.maxSizeMb * 1024 * 1024;
  if (file.size > maxBytes) return `${file.name} 超过大小限制`;
  return "";
}

function fileExt(fileName: string) {
  return fileName.includes(".") ? fileName.split(".").pop()!.trim().toLowerCase().replace(/^\.+/, "") : "";
}

function fileIcon(fileName: string) {
  const ext = fileExt(fileName);
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "IMG";
  if (ext === "pdf") return "PDF";
  if (["doc", "docx"].includes(ext)) return "DOC";
  if (["zip", "rar", "7z"].includes(ext)) return "ZIP";
  return ext.slice(0, 3).toUpperCase() || "FILE";
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
  message("正在检查是否已有提交...");
  const duplicate = await filestoreBetaApi.checkDuplicate(slug.value, currentData());
  if (!duplicate.exists) {
    message("");
    return false;
  }
  const confirmed = await askOverwriteSubmission(duplicate);
  if (!confirmed) {
    message("已取消提交。", "warn");
    return null;
  }
  return true;
}

function askOverwriteSubmission(payload: FilestoreBetaDuplicatePayload) {
  overwriteSummary.value = `${payload.identityLabel || "身份信息"}“${payload.identity}”已经提交过${payload.submission?.createdAt ? `，提交时间 ${formatDateTime(payload.submission.createdAt)}` : ""}。`;
  overwriteFiles.value = payload.submission?.files || [];
  overwriteDialog.value?.showModal();
  return new Promise<boolean | null>((resolve) => {
    overwriteResolve = resolve;
  });
}

function resolveOverwrite(value: boolean) {
  overwriteDialog.value?.close();
  overwriteResolve?.(value);
  overwriteResolve = null;
}

async function submit() {
  if (submitting.value || !task.value) return;
  const fieldError = validateFields();
  if (fieldError) {
    message(fieldError, "error");
    return;
  }
  const surveyError = validateSurveyFields();
  if (surveyError) {
    message(surveyError, "error");
    return;
  }
  const fileError = validateFiles();
  if (fileError) {
    message(fileError, "error");
    return;
  }
  submitting.value = true;
  progress.value = 0;
  try {
    const overwrite = await confirmOverwriteIfNeeded();
    if (overwrite === null) return;
    const files = fileEntries.value.map((entry) => entry.file);
    const result = shouldUseRemoteUpload(files)
      ? await submitRemote(files, overwrite)
      : await submitMultipart(files, overwrite);
    applySuccess(result);
  } catch (err) {
    message(requestErrorMessage(err, "提交失败"), "error");
  } finally {
    submitting.value = false;
  }
}

async function submitRemote(files: File[], overwrite: boolean) {
  progress.value = 0;
  message("正在创建世纪互联直传会话...");
  const prepared = await filestoreBetaApi.prepareRemote(slug.value, {
    data: currentData(),
    answers: currentSurveyAnswers(),
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
  message("正在直传至世纪互联...");
  for (const entry of remoteEntries) {
    await uploadFileToSession(entry.file, entry.preparedFile, (bytes) => {
      uploadedBytes += bytes;
      progress.value = totalBytes ? Math.min(99, Math.round((uploadedBytes / totalBytes) * 100)) : 0;
    });
  }

  message(localEntries.length ? "正在上传小文件并确认提交..." : "正在确认提交...");
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
  form.append("answers", JSON.stringify(currentSurveyAnswers()));
  form.append("overwrite", overwrite ? "true" : "false");
  files.forEach((file) => form.append("files", file, file.name));
  message("正在上传...");
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
  message(`提交成功，编号 ${result.submissionId}。文件：${result.files.join("、")}`, "ok");
  successDialog.value?.showModal();
  resetForm();
}
</script>
