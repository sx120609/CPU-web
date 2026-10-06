<template>
  <div class="fs-s">
    <div v-if="loading" class="fs-s-card fs-s-pad"><el-skeleton :rows="8" animated /></div>

    <section v-else-if="!task" class="fs-s-card fs-s-state">
      <span class="fs-s-state-icon" aria-hidden="true"><el-icon><WarningFilled /></el-icon></span>
      <b>无法打开提交页</b>
      <p>{{ error || "提交地址无效" }}</p>
      <el-button type="primary" plain :loading="loading" @click="load">重新加载</el-button>
    </section>

    <template v-else>
      <header class="fs-s-hero">
        <p class="fs-s-brand"><span aria-hidden="true">药</span>{{ task.siteTitle || "药大拾间文件收集" }} · 文件提交</p>
        <h1>{{ task.title }}</h1>
        <ul class="fs-s-chips">
          <li :class="task.status === 'open' ? 'is-open' : 'is-closed'"><span class="fs-s-dot" aria-hidden="true" />{{ task.status === "open" ? "正在收集" : "已停止提交" }}</li>
          <li v-if="task.deadline"><el-icon aria-hidden="true"><Clock /></el-icon>截止 {{ formatDateTime(task.deadline) }}</li>
          <li><el-icon aria-hidden="true"><Files /></el-icon>最多 {{ task.fileRules.maxCount }} 个文件 · 单个 ≤ {{ task.fileRules.maxSizeMb }} MB</li>
        </ul>
      </header>

      <div class="fs-s-layout">
        <main class="fs-s-main">
          <section class="fs-s-card fs-s-intro">
            <p class="fs-s-desc">{{ task.description || "请按要求填写信息并上传文件。" }}</p>
            <p class="fs-s-tip">
              <el-icon aria-hidden="true"><InfoFilled /></el-icon>
              <span>提交后发现文件或信息有误，用相同的{{ identityLabel }}重新提交即可，新提交会自动覆盖旧提交。</span>
            </p>
          </section>

          <section v-if="task.status !== 'open'" class="fs-s-card fs-s-state">
            <span class="fs-s-state-icon is-muted" aria-hidden="true"><el-icon><Lock /></el-icon></span>
            <b>该任务已停止提交</b>
            <p>如需补交，请联系发布者重新开放提交。已提交的同学可以在成功名单里确认记录。</p>
            <router-link class="fs-s-link-btn" :to="statusRoute">查看提交成功名单</router-link>
          </section>

          <form v-else class="fs-s-form" novalidate @submit.prevent="submit">
            <section class="fs-s-card fs-s-section" aria-labelledby="fs-s-identity">
              <header>
                <span class="fs-s-step" aria-hidden="true">1</span>
                <div>
                  <h2 id="fs-s-identity">身份信息</h2>
                  <p>用于匹配提交记录和文件命名</p>
                </div>
              </header>
              <div class="fs-s-fields">
                <label v-for="field in task.fields" :key="field.key" class="fs-s-field">
                  <span>{{ field.label }}<em v-if="field.required">*</em></span>
                  <el-input
                    v-model="answers[field.key]"
                    size="large"
                    :name="field.key"
                    :placeholder="field.placeholder || `请输入${field.label}`"
                    :disabled="submitting"
                    autocomplete="off"
                  />
                </label>
              </div>
            </section>

            <section v-if="visibleSurveyFields.length" class="fs-s-card fs-s-section" aria-labelledby="fs-s-survey">
              <header>
                <span class="fs-s-step" aria-hidden="true">2</span>
                <div>
                  <h2 id="fs-s-survey">问卷信息</h2>
                  <p>请按实际情况填写</p>
                </div>
              </header>
              <div v-for="(field, index) in visibleSurveyFields" :key="field.id" class="fs-s-question">
                <p class="fs-s-question-title">
                  <span>{{ index + 1 }}.</span>
                  <b>{{ field.label }}<em v-if="field.required">*</em></b>
                </p>
                <p v-if="field.description" class="fs-s-question-desc">{{ field.description }}</p>
                <el-input
                  v-if="field.type === 'text'"
                  v-model="surveyAnswers[field.id] as string"
                  :maxlength="field.maxLength || 300"
                  :placeholder="field.placeholder || ''"
                  :disabled="submitting"
                />
                <el-input
                  v-else-if="field.type === 'textarea'"
                  v-model="surveyAnswers[field.id] as string"
                  type="textarea"
                  :autosize="{ minRows: 3, maxRows: 8 }"
                  :maxlength="field.maxLength || 2000"
                  show-word-limit
                  :placeholder="field.placeholder || ''"
                  :disabled="submitting"
                />
                <div v-else-if="field.type === 'single' || field.type === 'multiple'" class="fs-s-options" :role="field.type === 'single' ? 'radiogroup' : 'group'" :aria-label="field.label">
                  <label v-for="option in field.options || []" :key="option" class="fs-s-option" :class="{ active: isChosen(field, option) }">
                    <input
                      :type="field.type === 'single' ? 'radio' : 'checkbox'"
                      :name="field.id"
                      :value="option"
                      :checked="isChosen(field, option)"
                      :disabled="submitting"
                      @change="choose(field, option, $event)"
                    >
                    <span class="fs-s-option-mark" aria-hidden="true" />
                    <span>{{ option }}</span>
                  </label>
                </div>
                <el-input
                  v-else-if="field.type === 'number'"
                  v-model="surveyAnswers[field.id] as string"
                  type="number"
                  inputmode="decimal"
                  :min="field.min"
                  :max="field.max"
                  :step="field.step || 1"
                  :placeholder="field.placeholder || '请输入数字'"
                  :disabled="submitting"
                />
                <el-date-picker
                  v-else-if="field.type === 'date'"
                  v-model="surveyAnswers[field.id] as string"
                  type="date"
                  value-format="YYYY-MM-DD"
                  placeholder="选择日期"
                  :disabled="submitting"
                />
                <div v-else-if="field.type === 'rating'" class="fs-s-rating" role="radiogroup" :aria-label="field.label">
                  <button
                    v-for="score in ratingRange(field)"
                    :key="score"
                    data-cpu-button="surface"
                    type="button"
                    role="radio"
                    :class="{ active: surveyAnswers[field.id] === String(score) }"
                    :aria-checked="surveyAnswers[field.id] === String(score)"
                    :disabled="submitting"
                    @click="surveyAnswers[field.id] = surveyAnswers[field.id] === String(score) ? '' : String(score)"
                  >{{ score }}</button>
                </div>
              </div>
            </section>

            <section class="fs-s-card fs-s-section" aria-labelledby="fs-s-upload">
              <header>
                <span class="fs-s-step" aria-hidden="true">{{ visibleSurveyFields.length ? 3 : 2 }}</span>
                <div>
                  <h2 id="fs-s-upload">上传文件</h2>
                  <p>{{ fileRulesText }}</p>
                </div>
              </header>

              <label
                class="fs-s-drop"
                :class="{ dragging, disabled: submitting || fileEntries.length >= task.fileRules.maxCount }"
                @dragenter.prevent="dragging = true"
                @dragover.prevent="dragging = true"
                @dragleave.prevent="dragging = false"
                @drop.prevent="onDrop"
              >
                <input
                  ref="fileInput"
                  type="file"
                  multiple
                  :accept="acceptTypes"
                  :disabled="submitting || fileEntries.length >= task.fileRules.maxCount"
                  @change="pickFiles"
                >
                <el-icon aria-hidden="true"><UploadFilled /></el-icon>
                <b>{{ fileEntries.length >= task.fileRules.maxCount ? "已达到文件数量上限" : "点击选择文件" }}<span class="fs-s-drop-desk">，或拖到这里</span></b>
                <small>{{ fileEntries.length }} / {{ task.fileRules.maxCount }} 个文件</small>
              </label>

              <ol v-if="fileEntries.length" class="fs-s-queue">
                <li
                  v-for="(entry, index) in fileEntries"
                  :key="entry.id"
                  :class="{ 'is-dragged': draggedFileId === entry.id }"
                  :draggable="!submitting && fileEntries.length > 1"
                  @dragstart="draggedFileId = entry.id"
                  @dragend="draggedFileId = ''"
                  @dragover.prevent
                  @drop.prevent.stop="moveDraggedFile(entry.id)"
                >
                  <button v-if="entry.previewUrl" data-cpu-button="media" type="button" class="fs-s-thumb" :aria-label="`查看 ${entry.file.name}`" @click="openPendingImage(entry.id)">
                    <img :src="entry.previewUrl" :alt="entry.file.name">
                  </button>
                  <FileBadge v-else :name="entry.file.name" :size="44" />
                  <div class="fs-s-queue-copy">
                    <b :title="entry.file.name">{{ entry.file.name }}</b>
                    <small>{{ formatBytes(entry.file.size) }} · 保存为 <code>{{ savedPathPreview(entry.file, index + 1) }}</code></small>
                  </div>
                  <div class="fs-s-queue-actions">
                    <template v-if="fileEntries.length > 1">
                      <el-button text :icon="ArrowUp" aria-label="上移" :disabled="submitting || index === 0" @click="moveFile(index, index - 1)" />
                      <el-button text :icon="ArrowDown" aria-label="下移" :disabled="submitting || index === fileEntries.length - 1" @click="moveFile(index, index + 1)" />
                    </template>
                    <el-button text type="danger" :icon="Close" aria-label="移除" :disabled="submitting" @click="removeFile(entry.id)" />
                  </div>
                </li>
              </ol>
              <p v-if="fileEntries.length > 1" class="fs-s-queue-note">多个文件会按上面的顺序编号保存。</p>
            </section>

            <div class="fs-s-submit">
              <p v-if="submitMessage" class="fs-s-message" :class="`is-${messageType || 'info'}`" role="status">{{ submitMessage }}</p>
              <el-progress v-if="submitting || progress > 0" :percentage="progress" :stroke-width="8" :status="progress >= 100 ? 'success' : undefined" />
              <div class="fs-s-submit-row">
                <el-button type="primary" size="large" native-type="submit" :loading="submitting" :disabled="submitting">
                  {{ submitting ? "正在提交" : "提交文件" }}
                </el-button>
                <el-button size="large" :disabled="submitting" @click="resetForm">重填</el-button>
              </div>
            </div>
          </form>
        </main>

        <aside class="fs-s-aside">
          <section class="fs-s-card fs-s-rules">
            <h2>提交要求</h2>
            <dl>
              <div><dt>截止时间</dt><dd>{{ task.deadline ? formatDateTime(task.deadline) : "未设置" }}</dd></div>
              <div><dt>文件格式</dt><dd>{{ normalizedAllowedTypes.join("、") || "不限" }}</dd></div>
              <div><dt>单个大小</dt><dd>不超过 {{ task.fileRules.maxSizeMb }} MB</dd></div>
              <div><dt>文件数量</dt><dd>最多 {{ task.fileRules.maxCount }} 个</dd></div>
            </dl>
          </section>
          <router-link class="fs-s-card fs-s-entry" :to="statusRoute">
            <span class="fs-s-entry-tile" style="--tone: #2563eb" aria-hidden="true"><el-icon><List /></el-icon></span>
            <span><b>查看提交成功名单</b><small>只展示已提交记录和文件名，不公开文件内容</small></span>
            <el-icon class="fs-s-entry-arrow" aria-hidden="true"><ArrowRight /></el-icon>
          </router-link>
          <a class="fs-s-card fs-s-entry" href="/services/tools/pdf_tools" target="_blank" rel="noopener">
            <span class="fs-s-entry-tile" style="--tone: #dc2626" aria-hidden="true"><el-icon><Document /></el-icon></span>
            <span><b>PDF 工具</b><small>上传前可先合并、拆分或压缩 PDF</small></span>
            <el-icon class="fs-s-entry-arrow" aria-hidden="true"><TopRight /></el-icon>
          </a>
        </aside>
      </div>
    </template>

    <el-dialog v-model="successOpen" width="420px" class="fs-s-dialog" modal-class="cpu-overlay-above-native-bar" append-to-body align-center :show-close="false">
      <div class="fs-s-success">
        <svg class="fs-s-check" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="28" />
          <path d="M19 33.5 28 42 46 23" />
        </svg>
        <b>提交成功</b>
        <p>{{ successPayload ? `提交编号 ${successPayload.submissionId}，文件已按规则保存。` : "" }}</p>
        <ul>
          <li v-for="file in successPayload?.files || []" :key="file"><FileBadge :name="file" :size="26" /><span>{{ file }}</span></li>
        </ul>
      </div>
      <template #footer>
        <el-button @click="successOpen = false">完成</el-button>
        <el-button type="primary" @click="goStatus">查看成功名单</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="overwriteOpen"
      title="发现已有提交"
      width="440px"
      class="fs-s-dialog"
      modal-class="cpu-overlay-above-native-bar"
      append-to-body
      align-center
      @close="resolveOverwrite(false)"
    >
      <div class="fs-s-overwrite">
        <p>{{ overwriteSummary }}</p>
        <ul v-if="overwriteFiles.length">
          <li v-for="file in overwriteFiles" :key="file"><FileBadge :name="file" :size="26" /><span>{{ file }}</span></li>
        </ul>
        <p class="fs-s-overwrite-warn"><el-icon aria-hidden="true"><WarningFilled /></el-icon>继续提交会用本次填写的信息和文件覆盖旧提交。</p>
      </div>
      <template #footer>
        <el-button @click="resolveOverwrite(false)">取消</el-button>
        <el-button type="primary" @click="resolveOverwrite(true)">覆盖旧提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Clock,
  Close,
  Document,
  Files,
  InfoFilled,
  List,
  Lock,
  TopRight,
  UploadFilled,
  WarningFilled,
} from "@element-plus/icons-vue";
import {
  filestoreApi,
  filestoreUpload,
  type FilestoreDuplicatePayload,
  type FilestorePreparedLocalFile,
  type FilestorePreparedRemoteFile,
  type FilestorePublicTask,
  type FilestoreSubmitResult,
  type FilestoreSurveyAnswer,
  type FilestoreSurveyField,
} from "@/api/filestore";
import { formatBytes } from "@/views/services/fileCollectExport";
import { openImageGallery } from "@/utils/imageViewer";
import FileBadge from "./components/FileBadge.vue";
import {
  fileExt,
  formatDateTime,
  normalizeAllowedTypes,
  previewStoredFileName,
  renderFilestoreTemplate,
  requestErrorMessage,
  statusPath,
} from "./shared";

type MessageType = "" | "ok" | "error" | "warn";
type FileEntry = {
  id: string;
  file: File;
  previewUrl: string;
};

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const submitting = ref(false);
const progress = ref(0);
const task = ref<FilestorePublicTask | null>(null);
const error = ref("");
const answers = reactive<Record<string, string>>({});
const surveyAnswers = reactive<Record<string, FilestoreSurveyAnswer>>({});
const fileEntries = ref<FileEntry[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const draggedFileId = ref("");
const dragging = ref(false);
const submitMessage = ref("");
const messageType = ref<MessageType>("");
const successPayload = ref<FilestoreSubmitResult | null>(null);
const successOpen = ref(false);
const overwriteOpen = ref(false);
const overwriteSummary = ref("");
const overwriteFiles = ref<string[]>([]);
let overwriteResolve: ((value: boolean) => void) | null = null;
let loadSeq = 0;

const slug = computed(() => String(route.params.slug || "").trim());
const statusRoute = computed(() => statusPath(slug.value));
const normalizedAllowedTypes = computed(() => normalizeAllowedTypes(task.value?.fileRules.allowedTypes ?? []));
const acceptTypes = computed(() => normalizedAllowedTypes.value.map((item) => `.${item}`).join(","));
const fileRulesText = computed(() => {
  const rules = task.value?.fileRules;
  if (!rules) return "";
  return `支持 ${normalizedAllowedTypes.value.join("、") || "任意格式"}，单个不超过 ${rules.maxSizeMb} MB，最多 ${rules.maxCount} 个`;
});
const identityLabel = computed(() => {
  const labels = (task.value?.fields || []).slice(0, 2).map((field) => field.label || field.key);
  return labels.length ? labels.join("和") : "身份信息";
});
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
    const next = await filestoreApi.publicTask(slug.value);
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
  for (const key of Object.keys(answers)) answers[key] = "";
  for (const field of task.value?.surveyFields || []) surveyAnswers[field.id] = field.type === "multiple" ? [] : "";
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

function openPendingImage(entryId: string) {
  const images = fileEntries.value.filter((entry) => entry.previewUrl);
  const index = images.findIndex((entry) => entry.id === entryId);
  if (index < 0) return;
  openImageGallery(images.map((entry) => ({
    src: entry.previewUrl,
    title: entry.file.name,
    alt: entry.file.name,
    fileName: entry.file.name,
  })), index, { className: "cpu-file-submit-image-viewer" });
}

function pickFiles(event: Event) {
  addFiles(Array.from((event.target as HTMLInputElement).files || []));
  if (fileInput.value) fileInput.value.value = "";
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  if (draggedFileId.value) return;
  addFiles(Array.from(event.dataTransfer?.files || []));
}

function addFiles(files: File[]) {
  if (!task.value || submitting.value) return;
  const known = new Set(fileEntries.value.map((entry) => fileKey(entry.file)));
  const next = [...fileEntries.value];
  message("");
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
  const result: Record<string, FilestoreSurveyAnswer> = {};
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

function isChosen(field: FilestoreSurveyField, option: string) {
  return field.type === "multiple" ? multiValue(field.id).includes(option) : surveyAnswers[field.id] === option;
}

function choose(field: FilestoreSurveyField, option: string, event: Event) {
  if (field.type !== "multiple") {
    surveyAnswers[field.id] = option;
    return;
  }
  const checked = (event.target as HTMLInputElement).checked;
  const values = new Set(multiValue(field.id));
  if (checked) values.add(option);
  else values.delete(option);
  surveyAnswers[field.id] = Array.from(values);
}

function hasSurveyAnswer(value: FilestoreSurveyAnswer | undefined) {
  return Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? "").trim());
}

function ratingRange(field: FilestoreSurveyField) {
  const min = Math.max(0, Math.round(Number(field.min ?? 1)));
  const max = Math.min(10, Math.round(Number(field.max ?? 5)));
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
}

// 单选题可以按答案跳题或提前结束，只有当前路径上的题目需要填写和提交。
function resolveVisibleSurveyFields(fields: FilestoreSurveyField[]) {
  const result: FilestoreSurveyField[] = [];
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

function savedPathPreview(file: File, index: number) {
  if (!task.value) return file.name;
  const data = Object.fromEntries(Object.entries(currentData()).map(([key, value]) => [key, value || key]));
  const name = previewStoredFileName(task.value.renameTemplate, data, file.name, index, fileEntries.value.length);
  if (fileEntries.value.length <= 1) return name;
  return `${renderFilestoreTemplate(task.value.folderTemplate, data)}/${name}`;
}

function shouldDirectUpload(file: File) {
  if (!task.value?.remoteUpload?.enabled) return false;
  const threshold = Math.max(0, Number(task.value.remoteUpload.minSizeBytes || 0));
  return threshold <= 0 || file.size >= threshold;
}

async function confirmOverwriteIfNeeded() {
  message("正在检查是否已有提交…");
  const duplicate = await filestoreApi.checkDuplicate(slug.value, currentData());
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

function askOverwriteSubmission(payload: FilestoreDuplicatePayload) {
  overwriteSummary.value = `${payload.identityLabel || "身份信息"}“${payload.identity}”已经提交过${payload.submission?.createdAt ? `，提交时间 ${formatDateTime(payload.submission.createdAt)}` : ""}。`;
  overwriteFiles.value = payload.submission?.files || [];
  overwriteOpen.value = true;
  return new Promise<boolean>((resolve) => {
    overwriteResolve = resolve;
  });
}

function resolveOverwrite(value: boolean) {
  overwriteOpen.value = false;
  overwriteResolve?.(value);
  overwriteResolve = null;
}

async function submit() {
  if (submitting.value || !task.value) return;
  const problem = validateFields() || validateSurveyFields() || validateFiles();
  if (problem) {
    message(problem, "error");
    return;
  }
  submitting.value = true;
  progress.value = 0;
  try {
    const overwrite = await confirmOverwriteIfNeeded();
    if (overwrite === null) return;
    const files = fileEntries.value.map((entry) => entry.file);
    const result = files.some((file) => shouldDirectUpload(file))
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
  message("正在创建世纪互联直传会话…");
  const prepared = await filestoreApi.prepareRemote(slug.value, {
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
    .filter((entry): entry is { file: File; preparedFile: FilestorePreparedRemoteFile } => Boolean(entry.preparedFile));
  const localEntries = files
    .map((file, index) => ({ file, preparedFile: localByIndex.get(index) }))
    .filter((entry): entry is { file: File; preparedFile: FilestorePreparedLocalFile } => Boolean(entry.preparedFile));
  if (remoteEntries.length + localEntries.length !== files.length) throw new Error("上传会话缺少部分文件，请刷新后重试");

  let uploadedBytes = 0;
  let localUploadedBytes = 0;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  message("正在直传至世纪互联…");
  for (const entry of remoteEntries) {
    await uploadFileToSession(entry.file, entry.preparedFile, (bytes) => {
      uploadedBytes += bytes;
      progress.value = totalBytes ? Math.min(99, Math.round((uploadedBytes / totalBytes) * 100)) : 0;
    });
  }

  message(localEntries.length ? "正在上传小文件并确认提交…" : "正在确认提交…");
  if (localEntries.length) {
    const form = new FormData();
    form.append("submissionId", String(prepared.submissionId));
    form.append("remoteFileIds", JSON.stringify(remoteEntries.map((entry) => entry.preparedFile.id)));
    form.append("localFileIds", JSON.stringify(localEntries.map((entry) => entry.preparedFile.id)));
    form.append("overwrite", overwrite ? "true" : "false");
    localEntries.forEach((entry) => form.append("files", entry.file, entry.file.name));
    return filestoreUpload<FilestoreSubmitResult>(`/api/submit/${encodeURIComponent(slug.value)}/complete-remote`, form, (loaded) => {
      localUploadedBytes = loaded;
      progress.value = totalBytes ? Math.min(99, Math.round(((uploadedBytes + localUploadedBytes) / totalBytes) * 100)) : 0;
    });
  }
  return filestoreApi.completeRemote(slug.value, {
    submissionId: prepared.submissionId,
    remoteFileIds: remoteEntries.map((entry) => entry.preparedFile.id),
    overwrite,
  });
}

async function uploadFileToSession(file: File, uploadFile: FilestorePreparedRemoteFile, onProgress: (bytes: number) => void) {
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
  message("正在上传…");
  return filestoreUpload<FilestoreSubmitResult>(`/api/submit/${encodeURIComponent(slug.value)}`, form, (loaded, total) => {
    progress.value = total ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
  });
}

function applySuccess(result: FilestoreSubmitResult) {
  successPayload.value = result;
  resetForm();
  message(`提交成功，编号 ${result.submissionId}。文件：${result.files.join("、")}`, "ok");
  successOpen.value = true;
}

function goStatus() {
  successOpen.value = false;
  void router.push(statusRoute.value);
}
</script>

<style scoped>
.fs-s {
  --fs-s-tile-fill: 11%;
  --fs-s-tile-ink: 100%;
  display: flex;
  min-width: 0;
  max-width: 1040px;
  margin: 0 auto;
  flex-direction: column;
  gap: 18px;
  color: var(--cpu-text);
}
.fs-s :is(button, a):focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.fs-s-card { border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-l); background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.fs-s-pad { padding: 20px; }

.fs-s-state { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 40px 20px 32px; text-align: center; }
.fs-s-state-icon { display: grid; width: 52px; height: 52px; margin-bottom: 6px; place-items: center; border-radius: var(--cpu-radius-l); background: var(--cpu-accent-soft); color: var(--cpu-warn); font-size: var(--cpu-fs-xl); }
.fs-s-state-icon.is-muted { background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); }
.fs-s-state b { font-size: var(--cpu-fs-l); font-weight: 700; }
.fs-s-state p { max-width: 440px; margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.7; }
.fs-s-state .el-button,
.fs-s-link-btn { margin-top: 12px; }
.fs-s-link-btn {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  padding: 0 18px;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  text-decoration: none;
}

.fs-s-hero { padding: 6px 4px 0; }
.fs-s-brand { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.fs-s-brand span { display: grid; width: 24px; height: 24px; place-items: center; border-radius: var(--cpu-radius-s); background: var(--cpu-primary); color: #fff; font-size: var(--cpu-fs-s); font-weight: 700; }
.fs-s-hero h1 { margin: 10px 0 0; font-size: 30px; font-weight: 700; line-height: 1.3; letter-spacing: -.01em; overflow-wrap: anywhere; }
.fs-s-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; padding: 0; list-style: none; }
.fs-s-chips li {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 11px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-card);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
}
.fs-s-chips li .el-icon { color: var(--cpu-text-muted); }
.fs-s-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.fs-s-chips li.is-open { border-color: var(--cpu-primary-soft); background: var(--cpu-primary-soft); color: var(--cpu-primary); font-weight: 500; }
.fs-s-chips li.is-closed { background: var(--cpu-surface-subtle); font-weight: 500; }

.fs-s-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; align-items: start; gap: 18px; }
.fs-s-main { display: flex; min-width: 0; flex-direction: column; gap: 14px; }

.fs-s-intro { padding: 16px 18px; }
.fs-s-desc { margin: 0; color: var(--cpu-text); font-size: var(--cpu-fs-m); line-height: 1.75; white-space: pre-line; overflow-wrap: anywhere; }
.fs-s-tip { display: flex; align-items: flex-start; gap: 7px; margin: 12px 0 0; padding: 9px 11px; border-radius: var(--cpu-radius-m); background: var(--cpu-primary-soft); color: var(--cpu-primary); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.fs-s-tip .el-icon { flex: 0 0 auto; margin-top: 2px; }

.fs-s-form { display: flex; flex-direction: column; gap: 14px; }
.fs-s-section { display: flex; flex-direction: column; gap: 16px; padding: 18px; }
.fs-s-section > header { display: flex; align-items: flex-start; gap: 11px; }
.fs-s-step { display: grid; width: 28px; height: 28px; flex: 0 0 auto; place-items: center; border-radius: var(--cpu-radius-m); background: var(--cpu-primary); color: #fff; font-size: var(--cpu-fs-m); font-weight: 700; }
.fs-s-section h2 { margin: 2px 0 0; font-size: var(--cpu-fs-l); font-weight: 700; }
.fs-s-section > header p { margin: 2px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.fs-s-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.fs-s-field { display: flex; min-width: 0; flex-direction: column; gap: 6px; }
.fs-s-field > span { font-size: var(--cpu-fs-s); font-weight: 500; }
.fs-s-field em,
.fs-s-question-title em { margin-left: 2px; color: var(--cpu-danger); font-style: normal; }

.fs-s-question { display: flex; flex-direction: column; gap: 8px; padding-top: 14px; border-top: 1px dashed var(--cpu-border-soft); }
.fs-s-section > header + .fs-s-question { padding-top: 0; border-top: 0; }
.fs-s-question-title { display: flex; gap: 6px; margin: 0; font-size: var(--cpu-fs-m); line-height: 1.5; }
.fs-s-question-title span { color: var(--cpu-text-muted); font-variant-numeric: tabular-nums; }
.fs-s-question-title b { font-weight: 500; }
.fs-s-question-desc { margin: -4px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.fs-s-question :deep(.el-date-editor) { width: 100%; max-width: 280px; }
.fs-s-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.fs-s-option {
  position: relative;
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  font-size: var(--cpu-fs-m);
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.fs-s-option input { position: absolute; opacity: 0; pointer-events: none; }
.fs-s-option-mark { width: 18px; height: 18px; flex: 0 0 auto; border: 1.5px solid var(--cpu-border); border-radius: 50%; background: var(--cpu-card); }
.fs-s-options[role="group"] .fs-s-option-mark { border-radius: var(--cpu-radius-s); }
.fs-s-option.active { border-color: var(--cpu-primary); background: var(--cpu-primary-soft); }
.fs-s-option.active .fs-s-option-mark { border-color: var(--cpu-primary); background: var(--cpu-primary); box-shadow: inset 0 0 0 3px var(--cpu-card); }
.fs-s-options[role="group"] .fs-s-option.active .fs-s-option-mark { box-shadow: none; background: var(--cpu-primary) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5 6.5 11.5 12.5 4.5' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 14px no-repeat; }
.fs-s-option:focus-within { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.fs-s-rating { display: flex; flex-wrap: wrap; gap: 6px; }
.fs-s-rating button {
  width: 42px;
  height: 42px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  color: var(--cpu-text);
  font: inherit;
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  cursor: pointer;
}
.fs-s-rating button.active { border-color: var(--cpu-primary); background: var(--cpu-primary); color: #fff; }

.fs-s-drop {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 26px 16px 22px;
  border: 1.5px dashed var(--cpu-border);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface-soft);
  text-align: center;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.fs-s-drop:hover,
.fs-s-drop.dragging { border-color: var(--cpu-primary); background: var(--cpu-primary-soft); }
.fs-s-drop.disabled { cursor: not-allowed; opacity: .6; }
.fs-s-drop input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.fs-s-drop:focus-within { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.fs-s-drop > .el-icon { color: var(--cpu-primary); font-size: 34px; }
.fs-s-drop b { font-size: var(--cpu-fs-m); font-weight: 500; }
.fs-s-drop small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }

.fs-s-queue { display: flex; flex-direction: column; margin: 0; padding: 0; border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-l); list-style: none; overflow: hidden; }
.fs-s-queue li { display: flex; align-items: center; gap: 11px; padding: 10px 8px 10px 10px; background: var(--cpu-card); }
.fs-s-queue li + li { border-top: 1px solid var(--cpu-border-soft); }
.fs-s-queue li[draggable="true"] { cursor: grab; }
.fs-s-queue li.is-dragged { opacity: .5; }
.fs-s-thumb { width: 44px; height: 44px; flex: 0 0 auto; overflow: hidden; padding: 0; border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); cursor: zoom-in; }
.fs-s-thumb img { width: 100%; height: 100%; object-fit: cover; }
.fs-s-queue-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.fs-s-queue-copy b { overflow: hidden; font-size: var(--cpu-fs-m); font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.fs-s-queue-copy small { overflow: hidden; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); text-overflow: ellipsis; white-space: nowrap; }
.fs-s-queue-copy code { color: var(--cpu-text-secondary); font-family: var(--cpu-font-mono); font-size: var(--cpu-fs-xs); }
.fs-s-queue-actions { display: flex; flex: 0 0 auto; }
.fs-s-queue-actions .el-button { width: 32px; min-width: 32px; margin: 0; padding: 0; }
.fs-s-queue-note { margin: -6px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }

.fs-s-submit { display: flex; flex-direction: column; gap: 10px; padding: 2px 0 8px; }
.fs-s-message {
  --tone: #0284c7;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--tone) 28%, transparent);
  border-radius: var(--cpu-radius-l);
  background: color-mix(in srgb, var(--tone) 9%, var(--cpu-card));
  color: color-mix(in srgb, var(--tone) 80%, var(--cpu-text));
  font-size: var(--cpu-fs-s);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.fs-s-message.is-error { --tone: var(--cpu-danger); }
.fs-s-message.is-warn { --tone: #d97706; }
.fs-s-message.is-ok { --tone: var(--cpu-success); }
.fs-s-submit-row { display: flex; gap: 10px; }
.fs-s-submit-row .el-button { margin: 0; }
.fs-s-submit-row .el-button--primary { min-width: 180px; }

.fs-s-aside { position: sticky; top: 84px; display: flex; flex-direction: column; gap: 12px; }
.fs-s-rules { padding: 16px; }
.fs-s-rules h2 { margin: 0 0 6px; font-size: var(--cpu-fs-m); font-weight: 700; }
.fs-s-rules dl { margin: 0; }
.fs-s-rules dl > div { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px dashed var(--cpu-border-soft); font-size: var(--cpu-fs-s); }
.fs-s-rules dl > div:last-child { border-bottom: 0; }
.fs-s-rules dt { flex: 0 0 auto; color: var(--cpu-text-muted); }
.fs-s-rules dd { min-width: 0; margin: 0; text-align: right; overflow-wrap: anywhere; }
.fs-s-entry { display: flex; align-items: center; gap: 11px; padding: 12px 14px; color: inherit; text-decoration: none; transition: border-color .15s; }
.fs-s-entry:hover { border-color: var(--cpu-primary); }
.fs-s-entry > span:nth-child(2) { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.fs-s-entry b { font-size: var(--cpu-fs-m); font-weight: 500; }
.fs-s-entry small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.5; }
.fs-s-entry-tile {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  background: color-mix(in srgb, var(--tone) var(--fs-s-tile-fill), var(--cpu-card));
  color: color-mix(in srgb, var(--tone) var(--fs-s-tile-ink), var(--cpu-text));
  font-size: var(--cpu-fs-l);
}
.fs-s-entry-arrow { flex: 0 0 auto; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }

.fs-s-success { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
.fs-s-check { width: 64px; height: 64px; margin-bottom: 4px; }
.fs-s-check circle { fill: var(--cpu-primary-soft); stroke: var(--cpu-success); stroke-width: 3; }
.fs-s-check path { fill: none; stroke: var(--cpu-success); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 40; stroke-dashoffset: 40; animation: fs-s-check .45s .1s ease-out forwards; }
.fs-s-success b { font-size: var(--cpu-fs-xl); font-weight: 700; }
.fs-s-success p,
.fs-s-overwrite p { margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.65; }
.fs-s-success ul,
.fs-s-overwrite ul { display: flex; width: 100%; flex-direction: column; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; text-align: left; }
.fs-s-success li,
.fs-s-overwrite li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); font-size: var(--cpu-fs-xs); overflow-wrap: anywhere; }
.fs-s-overwrite { display: flex; flex-direction: column; gap: 6px; }
.fs-s-overwrite .fs-s-overwrite-warn { display: flex; align-items: center; gap: 6px; margin-top: 6px; color: var(--cpu-accent); font-size: var(--cpu-fs-xs); }
@keyframes fs-s-check { to { stroke-dashoffset: 0; } }

:global(html[data-theme="dark"] .fs-s) { --fs-s-tile-fill: 20%; --fs-s-tile-ink: 46%; }
:global(html[data-theme="dark"] .fs-s-overwrite .fs-s-overwrite-warn) { color: #fbbf24; }

@media (max-width: 960px) {
  .fs-s-layout { grid-template-columns: minmax(0, 1fr); }
  .fs-s-aside { position: static; }
}
@media (max-width: 768px) {
  .fs-s { gap: 12px; }
  .fs-s-hero { padding: 0 2px; }
  .fs-s-hero h1 { margin-top: 8px; font-size: var(--cpu-fs-xl); }
  .fs-s-chips { gap: 6px; margin-top: 10px; }
  .fs-s-chips li { min-height: 26px; padding: 0 9px; font-size: var(--cpu-fs-xs); }
  .fs-s-layout { gap: 12px; }
  .fs-s-main,
  .fs-s-form { gap: 12px; }
  .fs-s-intro { padding: 14px; }
  .fs-s-section { gap: 14px; padding: 14px; }
  .fs-s-fields { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .fs-s-options { grid-template-columns: minmax(0, 1fr); }
  .fs-s-question :deep(.el-date-editor) { max-width: none; }
  .fs-s-drop { padding: 20px 14px 18px; }
  .fs-s-drop-desk { display: none; }
  .fs-s-submit-row .el-button--primary { min-width: 0; flex: 1; }
  .fs-s-aside { gap: 10px; }
  /* 16px 以下 iOS 会在聚焦时放大页面 */
  .fs-s-form :deep(.el-input__inner),
  .fs-s-form :deep(.el-textarea__inner) { font-size: var(--cpu-fs-l); }
}
@media (prefers-reduced-motion: reduce) {
  .fs-s-check path { animation: none; stroke-dashoffset: 0; }
  .fs-s-option,
  .fs-s-drop,
  .fs-s-entry { transition: none; }
}
</style>
