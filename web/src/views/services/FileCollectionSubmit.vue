<template>
  <div class="file-submit-page">
    <section class="file-submit-shell" v-loading="loading">
      <button type="button" class="back-link" @click="$router.push('/services/tools/file_collect')">
        <el-icon><ArrowLeft /></el-icon>
        <span>文件收集</span>
      </button>

      <template v-if="task">
        <header class="submit-head">
          <div>
            <div class="kicker">{{ task.status === "open" ? "FILE COLLECTION" : "CLOSED" }}</div>
            <h2>{{ task.title }}</h2>
            <p>{{ task.description || "请按要求填写信息并上传文件。" }}</p>
          </div>
          <el-tag :type="statusTag(task.status)" effect="plain">{{ statusText(task.status) }}</el-tag>
        </header>

        <el-alert
          v-if="task.visibility === 'login'"
          type="info"
          show-icon
          :closable="false"
          title="该任务需要登录后提交。"
        >
          <template #default>
            <PrivacyPolicyNotice align="left" compact />
          </template>
        </el-alert>

        <form class="submit-card" @submit.prevent="submit">
          <label v-for="field in task.fields" :key="field.id" class="submit-field">
            <span>{{ field.label }}<b v-if="field.required">*</b></span>
            <el-input v-model="answers[field.id]" :placeholder="field.placeholder || ''" :disabled="submitting" />
          </label>

          <div class="file-rule-box">
            <b>上传文件</b>
            <span>允许 {{ allowedTypeText }}；单个不超过 {{ task.fileRules.maxSizeMb }} MB；最多 {{ task.fileRules.maxCount }} 个。</span>
            <input ref="fileInput" type="file" multiple :accept="acceptTypes" :disabled="submitting" @change="pickFiles" />
          </div>
          <div class="pdf-tool-shortcut">
            <div>
              <b>PDF 工具</b>
              <span>上传前可先合并、拆分或压缩 PDF。</span>
            </div>
            <a href="/services/tools/pdf_tools" target="_blank" rel="noopener">打开 PDF 工具</a>
          </div>

          <div v-if="files.length" class="file-list">
            <div v-for="(file, index) in files" :key="`${file.name}-${file.size}-${index}`">
              <span>
                <b>{{ file.name }}</b>
                <small>{{ savedPathPreview(file, index + 1, files.length) }}</small>
              </span>
              <small>{{ formatBytes(file.size) }}</small>
              <button type="button" class="file-move-action" :disabled="submitting || index === 0" @click="moveFile(index, index - 1)">上移</button>
              <button type="button" class="file-move-action" :disabled="submitting || index === files.length - 1" @click="moveFile(index, index + 1)">下移</button>
              <button type="button" class="file-delete-action" :disabled="submitting" @click="removeFile(index)">删除</button>
            </div>
          </div>

          <el-button type="primary" native-type="submit" :loading="submitting" :disabled="submitting || task.status !== 'open'">
            提交文件
          </el-button>
        </form>
      </template>

      <el-empty v-else-if="!loading" :description="error || '收集任务不存在'">
        <el-button v-if="error" type="primary" :loading="loading" @click="load">重新加载</el-button>
        <el-button v-else type="primary" @click="$router.push('/services/tools/file_collect')">返回文件收集</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { toolsApi, type FileCollectTask, type FileCollectStatus } from "@/api/tools";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const submitting = ref(false);
const task = ref<FileCollectTask | null>(null);
const error = ref("");
const answers = reactive<Record<string, string>>({});
const files = ref<File[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const normalizedAllowedTypes = computed(() => normalizeAllowedTypes(task.value?.fileRules.allowedTypes ?? []));
const acceptTypes = computed(() => normalizedAllowedTypes.value.map((item) => `.${item}`).join(","));
const allowedTypeText = computed(() => normalizedAllowedTypes.value.join(", ") || "任意类型");
let loadSeq = 0;

watch(() => route.params.slug, () => {
  void load();
}, { immediate: true });

async function load() {
  const seq = ++loadSeq;
  const slug = String(route.params.slug || "").trim();
  loading.value = true;
  error.value = "";
  task.value = null;
  files.value = [];
  Object.keys(answers).forEach((key) => delete answers[key]);
  if (fileInput.value) fileInput.value.value = "";
  if (!slug) {
    error.value = "收集任务地址无效";
    loading.value = false;
    return;
  }
  try {
    const next = await toolsApi.fileCollection(slug, {
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
      suppressErrorMessage: true,
    });
    if (seq !== loadSeq) return;
    task.value = next;
    for (const field of next.fields) answers[field.id] = "";
  } catch (e) {
    if (seq !== loadSeq) return;
    const response = (e as { response?: { status?: number; data?: { message?: string } } }).response;
    const status = response?.status;
    if (status === 401) {
      router.push({ name: "login", query: { redirect: route.fullPath } });
      return;
    }
    if (status === 404) {
      error.value = "收集任务不存在或暂未开放";
    } else if (status && status < 500) {
      error.value = response?.data?.message ?? "收集任务加载失败";
    } else {
      error.value = "收集任务加载失败，请稍后再试";
    }
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function pickFiles(event: Event) {
  if (submitting.value) return;
  const selected = Array.from((event.target as HTMLInputElement).files ?? []);
  if (!selected.length) {
    if (fileInput.value) fileInput.value.value = "";
    return;
  }
  const nextFiles = [...files.value];
  const maxCount = task.value?.fileRules.maxCount ?? selected.length;
  for (const file of selected) {
    const reason = validateFile(file);
    if (reason) {
      ElMessage.warning(reason);
      continue;
    }
    if (nextFiles.length >= maxCount) {
      ElMessage.warning(`最多只能上传 ${maxCount} 个文件`);
      break;
    }
    nextFiles.push(file);
  }
  files.value = nextFiles;
  if (fileInput.value) fileInput.value.value = "";
}

function removeFile(index: number) {
  if (submitting.value) return;
  files.value.splice(index, 1);
  if (fileInput.value) fileInput.value.value = "";
}

function moveFile(from: number, to: number) {
  if (submitting.value) return;
  if (to < 0 || to >= files.value.length) return;
  const [item] = files.value.splice(from, 1);
  files.value.splice(to, 0, item);
}

function validate() {
  if (!task.value) return false;
  for (const field of task.value.fields) {
    const value = answers[field.id]?.trim() || "";
    if (field.required && !value) {
      ElMessage.warning(`请填写：${field.label}`);
      return false;
    }
    const patternMatch = matchesFieldPattern(field.pattern, value);
    if (!patternMatch.valid) {
      ElMessage.warning(`“${field.label}”的校验规则暂不可用，请联系管理员`);
      return false;
    }
    if (!patternMatch.matched) {
      ElMessage.warning(`“${field.label}”格式不正确`);
      return false;
    }
  }
  if (!files.value.length) {
    ElMessage.warning("请选择要上传的文件");
    return false;
  }
  if (files.value.length > task.value.fileRules.maxCount) {
    ElMessage.warning(`最多只能上传 ${task.value.fileRules.maxCount} 个文件`);
    return false;
  }
  for (const file of files.value) {
    const reason = validateFile(file);
    if (reason) {
      ElMessage.warning(reason);
      return false;
    }
  }
  return true;
}

function matchesFieldPattern(pattern: string | undefined, value: string) {
  if (!pattern || !value) return { valid: true, matched: true };
  try {
    return { valid: true, matched: new RegExp(pattern).test(value) };
  } catch {
    return { valid: false, matched: false };
  }
}

function validateFile(file: File) {
  if (!task.value) return "";
  const allowed = new Set(normalizedAllowedTypes.value);
  const ext = fileExtension(file.name);
  if (allowed.size && !allowed.has(ext)) return `${file.name} 类型不允许`;
  const maxBytes = task.value.fileRules.maxSizeMb * 1024 * 1024;
  if (file.size > maxBytes) return `${file.name} 超过大小限制`;
  return "";
}

function fileExtension(name: string) {
  return name.includes(".") ? name.split(".").pop()!.trim().toLowerCase().replace(/^\.+/, "") : "";
}

function normalizeAllowedTypes(types: string[]) {
  return types
    .map((item) => item.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
}

async function submit() {
  if (submitting.value) return;
  if (!task.value || !validate()) return;
  submitting.value = true;
  try {
    const form = new FormData();
    form.append("data", JSON.stringify(answers));
    files.value.forEach((file) => form.append("files", file, file.name));
    const result = await toolsApi.submitFileCollection(task.value.slug, form, {
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
      suppressErrorMessage: true,
      timeout: 120000,
    });
    ElMessage.success(`提交成功：${result.files.join("、")}`);
    files.value = [];
    Object.keys(answers).forEach((key) => { answers[key] = ""; });
    if (fileInput.value) fileInput.value.value = "";
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status;
    if (status === 401) {
      router.push({ name: "login", query: { redirect: route.fullPath } });
      return;
    }
    ElMessage.error((e as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message ?? "提交失败");
  } finally {
    submitting.value = false;
  }
}

function statusText(status: FileCollectStatus) {
  return status === "open" ? "开放中" : status === "closed" ? "已关闭" : "草稿";
}

function statusTag(status: FileCollectStatus) {
  return status === "open" ? "success" : status === "closed" ? "danger" : "info";
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function savedPathPreview(file: File, index: number, total: number) {
  if (!task.value) return file.name;
  const name = renamedFileName(file, index, total);
  if (total <= 1) return name;
  return `${submissionFolderName()}/${name}`;
}

function currentData() {
  return Object.fromEntries((task.value?.fields ?? []).map((field) => [field.id, answers[field.id]?.trim() || field.label]));
}

function submissionFolderName() {
  if (!task.value) return "提交文件";
  return renderTemplate(task.value.folderTemplate || "{name}-{student_id}", currentData());
}

function renamedFileName(file: File, index: number, total: number) {
  if (!task.value) return file.name;
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  let base = renderTemplate(task.value.renameTemplate || "{name}-{student_id}", currentData(), originalStem(file.name), index, total);
  if (total > 1 && !task.value.renameTemplate.includes("{index}")) base = `${base}-${index}`;
  return `${base}${ext}`;
}

function renderTemplate(template: string, data: Record<string, string>, original = "", index = 1, total = 1) {
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, safeFileName(value)])),
    original: safeFileName(original),
    index: total > 1 ? String(index) : "",
  };
  const rendered = String(template || "{name}-{student_id}").replace(/\{([a-zA-Z0-9_\u4e00-\u9fa5]+)(?:\|(last|first):(\d{1,2}))?\}/g, (_match, key, op, rawCount) => {
    const value = values[key] || "";
    const count = Number(rawCount || 0);
    if (op === "last") return count > 0 ? value.slice(-count) : "";
    if (op === "first") return count > 0 ? value.slice(0, count) : "";
    return value;
  });
  return cleanRenderedName(rendered);
}

function originalStem(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function safeFileName(value: string) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 140) || "file";
}

function cleanRenderedName(value: string) {
  return safeFileName(value).replace(/[-_ ]{2,}/g, "-").replace(/^[\s\-_.]+|[\s\-_.]+$/g, "") || "file";
}
</script>

<style scoped>
.file-submit-page {
  min-height: calc(100dvh - 64px);
  background: #f6f8fb;
  padding: 22px;
}
.file-submit-shell {
  max-width: 860px;
  margin: 0 auto;
}
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
  margin-bottom: 16px;
}
.submit-head,
.submit-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
}
.submit-head {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  padding: 22px;
  margin-bottom: 14px;
}
.kicker {
  color: #0f766e;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
}
.submit-head h2 {
  margin: 5px 0 8px;
  color: #111827;
}
.submit-head p {
  margin: 0;
  color: #64748b;
  line-height: 1.7;
  white-space: pre-wrap;
}
.submit-card {
  display: grid;
  gap: 14px;
  padding: 18px;
  margin-top: 14px;
}
.submit-field {
  display: grid;
  gap: 7px;
}
.submit-field span,
.file-rule-box b {
  color: #111827;
  font-weight: 650;
}
.submit-field b {
  color: #dc2626;
  margin-left: 3px;
}
.file-rule-box {
  display: grid;
  gap: 9px;
  padding: 14px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
}
.file-rule-box span {
  color: #64748b;
  font-size: 13px;
}
.pdf-tool-shortcut {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(15, 118, 110, 0.18);
  border-radius: 8px;
  background: #ecfdf5;
}
.pdf-tool-shortcut div {
  min-width: 0;
}
.pdf-tool-shortcut b {
  display: block;
  color: #111827;
  font-size: 14px;
}
.pdf-tool-shortcut span {
  display: block;
  margin-top: 2px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.45;
}
.pdf-tool-shortcut a {
  flex: 0 0 auto;
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  border: 1px solid #0f766e;
  border-radius: 7px;
  color: #0f766e;
  background: #fff;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}
.pdf-tool-shortcut a:hover {
  color: #fff;
  background: #0f766e;
}
.file-list {
  display: grid;
  gap: 8px;
}
.file-list div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto auto;
  gap: 10px;
  align-items: center;
  padding: 9px 10px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  min-width: 0;
  overflow: hidden;
}
.file-list span {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.file-list span b,
.file-list span small {
  min-width: 0;
  overflow-wrap: anywhere;
}
.file-list small {
  color: #64748b;
}
.file-list button {
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
  font: inherit;
  min-width: 0;
}
.file-list .file-delete-action {
  color: #dc2626;
}
.file-list button:disabled {
  border-color: #e5e7eb;
  background: #f8fafc;
  color: #cbd5e1;
  cursor: not-allowed;
}
@media (max-width: 700px) {
  .file-submit-page { padding: 14px; }
  .back-link { min-height: 40px; }
  .submit-head {
    flex-direction: column;
    padding: 16px;
  }
  .submit-card { padding: 14px; }
  .file-rule-box input { width: 100%; }
  .pdf-tool-shortcut {
    align-items: stretch;
    flex-direction: column;
  }
  .pdf-tool-shortcut a {
    width: 100%;
  }
  .file-list div {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .file-list div > span,
  .file-list div > small {
    grid-column: 1 / -1;
  }
  .file-list button {
    min-height: 40px;
    border-color: #dbeafe;
    background: #eff6ff;
  }
  .file-list .file-delete-action {
    border-color: #fee2e2;
    background: #fff7f7;
  }
  .submit-card :deep(.el-button) {
    width: 100%;
    min-height: 42px;
  }
}
</style>
