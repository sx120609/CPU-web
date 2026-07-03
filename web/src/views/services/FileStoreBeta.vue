<template>
  <div class="fs-beta-page">
    <section class="fs-beta-hero">
      <div>
        <div class="fs-beta-kicker">
          <span>Filestore beta</span>
          <el-tag size="small" effect="plain">Vue / TypeScript</el-tag>
        </div>
        <h1>文件收集工作台</h1>
        <p>复刻旧 Filestore 的任务、提交、文件和模板管理能力，数据仍然写入同一套文件收集表。</p>
      </div>
      <div class="fs-beta-hero-actions">
        <el-button plain @click="openLegacyWorkbench">
          <el-icon><Link /></el-icon>
          旧版工作台
        </el-button>
        <el-button v-if="viewer?.isManager" plain @click="openSettings">
          <el-icon><Setting /></el-icon>
          全局设置
        </el-button>
        <el-button type="primary" :disabled="denied" @click="openEditor()">
          <el-icon><Plus /></el-icon>
          新建收集
        </el-button>
      </div>
    </section>

    <el-alert
      v-if="loadError"
      class="fs-beta-alert"
      type="error"
      :closable="false"
      show-icon
      :title="loadError"
    >
      <template #default>
        <el-button size="small" type="primary" :loading="loading" @click="load">重新加载</el-button>
      </template>
    </el-alert>

    <section v-if="denied && !loading" class="fs-beta-denied">
      <b>暂时不能进入 beta 工作台</b>
      <span>当前账号没有文件收集管理权限。旧提交链接和成功名单不受影响。</span>
      <el-button type="primary" @click="$router.push('/services/tools')">返回小工具</el-button>
    </section>

    <section v-else class="fs-beta-workspace" v-loading="loading">
      <aside class="fs-beta-task-pane">
        <div class="fs-beta-pane-head">
          <div>
            <b>收集任务</b>
            <span>{{ tasks.length }} 个任务</span>
          </div>
          <el-button circle plain size="small" @click="load">
            <el-icon><Refresh /></el-icon>
          </el-button>
        </div>
        <el-input v-model="taskQuery" placeholder="搜索标题、说明或链接" clearable>
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <div class="fs-beta-task-list">
          <button
            v-for="task in filteredTasks"
            :key="task.id"
            type="button"
            :class="['fs-beta-task-card', { active: selectedTask?.id === task.id }]"
            @click="selectTask(task.id)"
          >
            <span>
              <b>{{ task.title }}</b>
              <small>{{ task.slug }}</small>
            </span>
            <span class="fs-beta-task-meta">
              <el-tag size="small" :type="statusTagType(task.status)" effect="plain">{{ statusText(task.status) }}</el-tag>
              <em>{{ taskStatsLabel(task) }}</em>
            </span>
          </button>
          <el-empty v-if="!filteredTasks.length" :description="tasks.length ? '没有匹配的任务' : '暂无文件收集任务'" />
        </div>
      </aside>

      <main class="fs-beta-detail" v-loading="detailLoading">
        <template v-if="selectedTask">
          <header class="fs-beta-detail-head">
            <div>
              <div class="fs-beta-detail-title">
                <h2>{{ selectedTask.title }}</h2>
                <el-tag :type="statusTagType(selectedTask.status)" effect="plain">{{ statusText(selectedTask.status) }}</el-tag>
              </div>
              <p>{{ selectedTask.description || "这个任务没有填写说明。" }}</p>
              <div class="fs-beta-detail-meta">
                <span>更新 {{ formatDateTime(selectedTask.updatedAt) }}</span>
                <span v-if="selectedTask.deadline">截止 {{ formatDateTime(selectedTask.deadline) }}</span>
                <span v-if="selectedTask.createdBy">创建者 {{ selectedTask.createdBy.displayName }}</span>
              </div>
            </div>
            <div class="fs-beta-detail-actions">
              <el-button plain @click="copySubmitLink(selectedTask, 'beta')">
                <el-icon><CopyDocument /></el-icon>
                复制 beta 链接
              </el-button>
              <el-dropdown trigger="click" @command="handleTaskCommand">
                <el-button type="primary">
                  操作<el-icon class="el-icon--right"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">编辑任务</el-dropdown-item>
                    <el-dropdown-item command="open" :disabled="selectedTask.status === 'open'">开放提交</el-dropdown-item>
                    <el-dropdown-item command="close" :disabled="selectedTask.status === 'closed'">关闭提交</el-dropdown-item>
                    <el-dropdown-item command="copy-old">复制旧版提交链接</el-dropdown-item>
                    <el-dropdown-item command="copy-status">复制成功名单链接</el-dropdown-item>
                    <el-dropdown-item command="qr">显示二维码</el-dropdown-item>
                    <el-dropdown-item command="csv">导出 CSV</el-dropdown-item>
                    <el-dropdown-item command="zip">浏览器打包 ZIP</el-dropdown-item>
                    <el-dropdown-item command="repair">修复文件名</el-dropdown-item>
                    <el-dropdown-item command="repair-remote">修复云端命名</el-dropdown-item>
                    <el-dropdown-item v-if="viewer?.isSuperAdmin" command="owner" divided>绑定创建者</el-dropdown-item>
                    <el-dropdown-item command="delete" divided>删除任务</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </header>

          <section class="fs-beta-metrics">
            <div>
              <span>已提交</span>
              <b>{{ selectedTask.stats?.submitted ?? selectedTask.submissions?.length ?? 0 }}</b>
              <small>{{ selectedTask.stats?.expected ? "全部成功记录" : "成功记录数" }}</small>
            </div>
            <div>
              <span>名单内</span>
              <b>{{ selectedTask.stats?.expected ? selectedTask.stats.inListSubmitted : "-" }}</b>
              <small>{{ selectedTask.stats?.expected ? `应提交 ${selectedTask.stats.expected}` : "未设置名单" }}</small>
            </div>
            <div>
              <span>缺交</span>
              <b>{{ selectedTask.stats?.missing?.length ?? 0 }}</b>
              <small>{{ selectedTask.stats?.expected ? "名单内未提交" : "未启用统计" }}</small>
            </div>
            <div>
              <span>文件</span>
              <b>{{ totalFileCount }}</b>
              <small>{{ formatBytes(totalFileSize) }}</small>
            </div>
          </section>

          <section class="fs-beta-split">
            <article class="fs-beta-panel">
              <div class="fs-beta-panel-head">
                <div>
                  <b>提交规则</b>
                  <span>{{ selectedTask.fileRules.allowedTypes.join(", ") || "任意类型" }}</span>
                </div>
              </div>
              <dl class="fs-beta-rule-list">
                <dt>单文件大小</dt><dd>{{ selectedTask.fileRules.maxSizeMb }} MB</dd>
                <dt>文件数量</dt><dd>最多 {{ selectedTask.fileRules.maxCount }} 个</dd>
                <dt>文件命名</dt><dd>{{ selectedTask.renameTemplate }}</dd>
                <dt>文件夹命名</dt><dd>{{ selectedTask.folderTemplate }}</dd>
              </dl>
              <div class="fs-beta-field-list">
                <span v-for="field in selectedTask.fields" :key="field.key">
                  {{ field.label }}<small>{{ field.key }}</small>
                </span>
              </div>
            </article>

            <article class="fs-beta-panel">
              <div class="fs-beta-panel-head">
                <div>
                  <b>公开入口</b>
                  <span>beta 和旧版共用提交数据</span>
                </div>
              </div>
              <div class="fs-beta-link-grid">
                <a :href="betaSubmitPath(selectedTask)" target="_blank" rel="noopener">打开 beta 提交页</a>
                <a :href="legacySubmitPath(selectedTask)" target="_blank" rel="noopener">打开旧版提交页</a>
                <a :href="betaStatusPath(selectedTask)" target="_blank" rel="noopener">打开 beta 成功名单</a>
                <a :href="legacyStatusPath(selectedTask)" target="_blank" rel="noopener">打开旧版成功名单</a>
              </div>
            </article>
          </section>

          <section v-if="selectedTask.stats?.missing?.length || selectedTask.stats?.unexpected?.length" class="fs-beta-split">
            <article class="fs-beta-panel">
              <div class="fs-beta-panel-head">
                <div>
                  <b>缺交名单</b>
                  <span>{{ selectedTask.stats?.missing?.length || 0 }} 项</span>
                </div>
                <el-button size="small" plain :disabled="!selectedTask.stats?.missing?.length" @click="copyMissing">
                  复制
                </el-button>
              </div>
              <div class="fs-beta-chip-cloud">
                <span v-for="item in selectedTask.stats?.missing || []" :key="item">{{ item }}</span>
              </div>
            </article>

            <article class="fs-beta-panel">
              <div class="fs-beta-panel-head">
                <div>
                  <b>名单外提交</b>
                  <span>{{ selectedTask.stats?.unexpected?.length || 0 }} 项</span>
                </div>
              </div>
              <div class="fs-beta-chip-cloud">
                <span v-for="item in selectedTask.stats?.unexpected || []" :key="item.id">{{ item.identity || item.name || `#${item.id}` }}</span>
              </div>
            </article>
          </section>

          <section class="fs-beta-panel fs-beta-submissions">
            <div class="fs-beta-panel-head">
              <div>
                <b>提交记录</b>
                <span>{{ filteredSubmissions.length }} / {{ selectedTask.submissions?.length || 0 }}</span>
              </div>
              <el-input v-model="submissionQuery" class="fs-beta-search" placeholder="搜索填写内容或文件名" clearable>
                <template #prefix>
                  <el-icon><Search /></el-icon>
                </template>
              </el-input>
            </div>

            <div class="fs-beta-table-wrap">
              <table class="fs-beta-table">
                <thead>
                  <tr>
                    <th>提交</th>
                    <th v-for="field in selectedTask.fields" :key="field.key">{{ field.label }}</th>
                    <th>文件</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="submission in filteredSubmissions" :key="submission.id">
                    <td>
                      <b>#{{ submission.id }}</b>
                      <span>{{ formatDateTime(submission.createdAt) }}</span>
                      <small v-if="submission.ip">{{ submission.ip }}</small>
                    </td>
                    <td v-for="field in selectedTask.fields" :key="field.key">
                      {{ submission.data[field.key] || "-" }}
                    </td>
                    <td>
                      <div class="fs-beta-file-stack">
                        <span v-for="file in submission.files" :key="file.id">
                          <b>{{ file.storedName }}</b>
                          <small>{{ formatBytes(file.size) }}</small>
                          <button type="button" @click="previewFile(file)">预览</button>
                          <button type="button" @click="downloadFile(file)">下载</button>
                          <button type="button" class="danger" @click="deleteFile(file)">删除</button>
                        </span>
                      </div>
                    </td>
                    <td>
                      <el-button size="small" text type="danger" @click="deleteSubmission(submission.id)">删除提交</el-button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <el-empty v-if="!filteredSubmissions.length" :description="selectedTask.submissions?.length ? '没有匹配记录' : '暂无提交记录'" />
            </div>
          </section>
        </template>

        <el-empty v-else-if="!loading" description="选择左侧任务，或创建一个新的文件收集任务。">
          <el-button type="primary" @click="openEditor()">新建收集</el-button>
        </el-empty>
      </main>
    </section>

    <el-drawer v-model="editorVisible" :title="editorMode === 'edit' ? '编辑收集任务' : '新建收集任务'" size="min(720px, 100%)">
      <div class="fs-beta-editor">
        <div class="fs-beta-template-bar">
          <el-select v-model="templateKey" placeholder="选择模板">
            <el-option
              v-for="option in templateOptions"
              :key="option.key"
              :label="option.label"
              :value="option.key"
            />
          </el-select>
          <el-button plain @click="applySelectedTemplate">套用模板</el-button>
          <el-button v-if="viewer?.isManager" plain @click="saveTemplateFromDraft">保存为全局模板</el-button>
          <el-button v-if="viewer?.isManager" plain type="danger" :disabled="!templateKey.startsWith('custom:')" @click="deleteSelectedTemplate">删除模板</el-button>
        </div>

        <label class="fs-beta-form-field">
          <span>任务标题</span>
          <el-input v-model="draft.title" maxlength="120" show-word-limit />
        </label>
        <label class="fs-beta-form-field">
          <span>任务说明</span>
          <el-input v-model="draft.description" type="textarea" :rows="3" maxlength="1000" show-word-limit />
        </label>
        <div class="fs-beta-form-grid">
          <label class="fs-beta-form-field">
            <span>状态</span>
            <el-segmented v-model="draft.status" :options="statusOptions" />
          </label>
          <label class="fs-beta-form-field">
            <span>截止时间</span>
            <el-date-picker v-model="draft.deadline" type="datetime" value-format="YYYY-MM-DDTHH:mm" placeholder="不限制" />
          </label>
        </div>

        <section class="fs-beta-editor-section">
          <div class="fs-beta-editor-head">
            <b>填写字段</b>
            <el-button size="small" plain @click="addDraftField">
              <el-icon><Plus /></el-icon>
              添加字段
            </el-button>
          </div>
          <div class="fs-beta-field-editor" v-for="(field, index) in draft.fields" :key="index">
            <el-input v-model="field.key" placeholder="变量，例如 student_id" @blur="field.key = normalizeFieldKey(field.key)" />
            <el-input v-model="field.label" placeholder="字段名称" />
            <el-switch v-model="field.required" active-text="必填" inactive-text="选填" />
            <el-input v-model="field.placeholder" placeholder="占位提示" />
            <el-input v-model="field.pattern" placeholder="正则校验，可选" />
            <div class="fs-beta-field-actions">
              <el-button size="small" plain @click="generateRegex(field)">AI 正则</el-button>
              <el-button size="small" plain type="danger" :disabled="draft.fields.length <= 1" @click="draft.fields.splice(index, 1)">删除</el-button>
            </div>
          </div>
        </section>

        <section class="fs-beta-editor-section">
          <div class="fs-beta-editor-head">
            <b>文件规则与命名</b>
          </div>
          <div class="fs-beta-form-grid">
            <label class="fs-beta-form-field">
              <span>允许类型</span>
              <el-input v-model="draft.allowedTypes" placeholder="pdf,docx,jpg,png,zip" />
            </label>
            <label class="fs-beta-form-field">
              <span>单文件大小 MB</span>
              <el-input-number v-model="draft.maxSizeMb" :min="1" :max="100" controls-position="right" />
            </label>
            <label class="fs-beta-form-field">
              <span>最多文件数</span>
              <el-input-number v-model="draft.maxCount" :min="1" :max="20" controls-position="right" />
            </label>
          </div>
          <label class="fs-beta-form-field">
            <span>文件命名规则</span>
            <el-input v-model="draft.renameTemplate" />
          </label>
          <label class="fs-beta-form-field">
            <span>文件夹命名规则</span>
            <el-input v-model="draft.folderTemplate" />
          </label>
          <div class="fs-beta-preview-line">
            <b>预览</b>
            <span>{{ renamePreview }}</span>
          </div>
          <label class="fs-beta-form-field">
            <span>应提交名单</span>
            <el-input v-model="draft.expectedEntries" type="textarea" :rows="4" maxlength="20000" placeholder="一行一个学号、考试号或姓名" />
          </label>
          <el-checkbox v-if="editorMode === 'edit'" v-model="draft.renameExistingFiles">
            同步更新已有文件的显示文件名
          </el-checkbox>
        </section>
      </div>
      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveTask">{{ editorMode === 'edit' ? '保存修改' : '创建任务' }}</el-button>
      </template>
    </el-drawer>

    <el-dialog v-model="settingsVisible" title="Filestore 全局设置" width="520px">
      <div class="fs-beta-settings">
        <label class="fs-beta-form-field">
          <span>站点标题</span>
          <el-input v-model="settingsDraft.siteTitle" placeholder="药大拾间文件收集" />
        </label>
        <label class="fs-beta-form-field">
          <span>站点地址</span>
          <el-input v-model="settingsDraft.siteUrl" placeholder="留空时使用当前域名" />
        </label>
      </div>
      <template #footer>
        <el-button @click="settingsVisible = false">取消</el-button>
        <el-button type="primary" :loading="settingsSaving" @click="saveSettings">保存设置</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="qrVisible" title="提交二维码" width="360px">
      <div class="fs-beta-qr">
        <img v-if="qrData" :src="qrImageUrl" alt="提交二维码" />
        <span>{{ qrData }}</span>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  ArrowDown,
  CopyDocument,
  Link,
  Plus,
  Refresh,
  Search,
  Setting,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  filestoreBetaApi,
  filestoreBetaBlob,
  filestoreBetaUrl,
  type FilestoreBetaField,
  type FilestoreBetaFile,
  type FilestoreBetaSettings,
  type FilestoreBetaSubmission,
  type FilestoreBetaTask,
  type FilestoreBetaTemplate,
  type FilestoreBetaViewer,
} from "@/api/filestoreBeta";
import {
  applyTemplateToDraft,
  builtInFilestoreBetaTemplates,
  buildFilestoreBetaPayload,
  cloneFields,
  copyText,
  createFilestoreBetaDraft,
  formatDateForInput,
  formatDateTime,
  makeFilestoreBetaField,
  normalizeFieldKey,
  openDirectUrl,
  previewStoredFileName,
  renderFilestoreBetaTemplate,
  requestErrorMessage,
  saveBlob,
  statusTagType,
  statusText,
  validateFilestoreBetaDraft,
  type FilestoreBetaDraft,
} from "@/views/services/filestoreBetaShared";
import { buildZip, formatBytes, uniqueZipPath, zipSafePathSegment } from "@/views/services/fileCollectExport";

const router = useRouter();
const loading = ref(false);
const detailLoading = ref(false);
const saving = ref(false);
const settingsSaving = ref(false);
const denied = ref(false);
const loadError = ref("");
const viewer = ref<FilestoreBetaViewer | null>(null);
const settings = ref<FilestoreBetaSettings>({ siteUrl: "", siteTitle: "", taskTemplates: [] });
const tasks = ref<FilestoreBetaTask[]>([]);
const selectedTask = ref<FilestoreBetaTask | null>(null);
const taskQuery = ref("");
const submissionQuery = ref("");
const editorVisible = ref(false);
const editorMode = ref<"create" | "edit">("create");
const editingId = ref<number | null>(null);
const templateKey = ref("builtin:0");
const draft = reactive<FilestoreBetaDraft>(createFilestoreBetaDraft());
const settingsVisible = ref(false);
const settingsDraft = reactive({ siteTitle: "", siteUrl: "" });
const qrVisible = ref(false);
const qrData = ref("");

const statusOptions = [
  { label: "开放", value: "open" },
  { label: "关闭", value: "closed" },
];

const filteredTasks = computed(() => {
  const query = taskQuery.value.trim().toLowerCase();
  if (!query) return tasks.value;
  return tasks.value.filter((task) => `${task.title} ${task.description} ${task.slug}`.toLowerCase().includes(query));
});

const filteredSubmissions = computed(() => {
  const task = selectedTask.value;
  if (!task?.submissions) return [];
  const query = submissionQuery.value.trim().toLowerCase();
  if (!query) return task.submissions;
  return task.submissions.filter((submission) => {
    const text = `${JSON.stringify(submission.data)} ${submission.files.map((file) => file.storedName).join(" ")}`.toLowerCase();
    return text.includes(query);
  });
});

const totalFileCount = computed(() => selectedTask.value?.submissions?.reduce((sum, item) => sum + item.files.length, 0) ?? 0);
const totalFileSize = computed(() => selectedTask.value?.submissions?.reduce((sum, item) => sum + item.files.reduce((fileSum, file) => fileSum + file.size, 0), 0) ?? 0);

const templateOptions = computed(() => [
  ...builtInFilestoreBetaTemplates.map((template, index) => ({ key: `builtin:${index}`, label: `内置 · ${template.name}`, template })),
  ...settings.value.taskTemplates.map((template) => ({ key: `custom:${template.id}`, label: `全局 · ${template.name}`, template })),
]);

const renamePreview = computed(() => {
  const data = Object.fromEntries(draft.fields.map((field) => [field.key || field.id, field.placeholder || field.label || "示例"]));
  const first = previewStoredFileName(draft.renameTemplate, data, "材料.pdf", 1, 2);
  const second = previewStoredFileName(draft.renameTemplate, data, "材料.pdf", 2, 2);
  const folder = renderFilestoreBetaTemplate(draft.folderTemplate, data);
  return `${folder}/${first}、${second}`;
});

const qrImageUrl = computed(() => filestoreBetaUrl(`/api/qrcode?${new URLSearchParams({ data: qrData.value, size: "260" })}`));

onMounted(load);

async function load() {
  loading.value = true;
  loadError.value = "";
  denied.value = false;
  try {
    const me = await filestoreBetaApi.me();
    viewer.value = me;
    settings.value = me.settings;
    await loadTasks();
  } catch (error) {
    if ((error as { status?: number }).status === 403) {
      denied.value = true;
      return;
    }
    if ((error as { status?: number }).status === 401) {
      router.push({ name: "login", query: { redirect: "/services/tools/filestore-beta" } });
      return;
    }
    loadError.value = requestErrorMessage(error, "Filestore beta 加载失败");
  } finally {
    loading.value = false;
  }
}

async function loadTasks() {
  const rows = await filestoreBetaApi.tasks();
  tasks.value = rows;
  if (!rows.length) {
    selectedTask.value = null;
    return;
  }
  const currentId = selectedTask.value?.id;
  const next = rows.find((item) => item.id === currentId) ?? rows[0];
  await selectTask(next.id);
}

async function selectTask(id: number) {
  detailLoading.value = true;
  submissionQuery.value = "";
  try {
    selectedTask.value = await filestoreBetaApi.task(id);
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, "任务详情加载失败"));
  } finally {
    detailLoading.value = false;
  }
}

function resetDraft() {
  Object.assign(draft, createFilestoreBetaDraft());
}

function openEditor(task?: FilestoreBetaTask | null) {
  resetDraft();
  if (task) {
    editorMode.value = "edit";
    editingId.value = task.id;
    draft.title = task.title;
    draft.description = task.description || "";
    draft.deadline = formatDateForInput(task.deadline);
    draft.status = task.status;
    draft.fields = cloneFields(task.fields);
    draft.allowedTypes = task.fileRules.allowedTypes.join(",");
    draft.maxSizeMb = task.fileRules.maxSizeMb;
    draft.maxCount = task.fileRules.maxCount;
    draft.renameTemplate = task.renameTemplate;
    draft.folderTemplate = task.folderTemplate;
    draft.expectedEntries = task.expectedEntries;
  } else {
    editorMode.value = "create";
    editingId.value = null;
  }
  editorVisible.value = true;
}

function selectedTemplate() {
  return templateOptions.value.find((item) => item.key === templateKey.value)?.template;
}

function applySelectedTemplate() {
  const template = selectedTemplate();
  if (!template) return;
  applyTemplateToDraft(draft, template, editorMode.value === "create");
}

function addDraftField() {
  draft.fields.push(makeFilestoreBetaField(draft.fields.length));
}

async function generateRegex(field: FilestoreBetaField) {
  try {
    const { value } = await ElMessageBox.prompt("描述这个字段的校验规则，例如“必须是 10 位数字”", "AI 生成正则", {
      inputPlaceholder: "必须以 20 开头，十位数字",
      confirmButtonText: "生成",
      cancelButtonText: "取消",
    });
    if (!value?.trim()) return;
    const result = await filestoreBetaApi.generateRegex(value.trim());
    field.pattern = result.regex || field.pattern;
    field.placeholder = result.placeholder || field.placeholder;
    ElMessage.success(result.description || "正则已生成");
  } catch (error) {
    if (error !== "cancel") ElMessage.error(requestErrorMessage(error, "正则生成失败"));
  }
}

async function saveTask() {
  const message = validateFilestoreBetaDraft(draft);
  if (message) {
    ElMessage.warning(message);
    return;
  }
  saving.value = true;
  try {
    const payload = buildFilestoreBetaPayload(draft);
    const saved = editorMode.value === "edit" && editingId.value
      ? await filestoreBetaApi.updateTask(editingId.value, payload)
      : await filestoreBetaApi.createTask(payload);
    editorVisible.value = false;
    ElMessage.success(editorMode.value === "edit" ? "任务已更新" : "任务已创建");
    await loadTasks();
    await selectTask(saved.id);
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, "保存失败"));
  } finally {
    saving.value = false;
  }
}

function payloadFromTask(task: FilestoreBetaTask, status = task.status) {
  return {
    title: task.title,
    description: task.description || "",
    deadline: task.deadline || null,
    status,
    fields: task.fields,
    fileRules: task.fileRules,
    renameTemplate: task.renameTemplate,
    folderTemplate: task.folderTemplate,
    expectedEntries: task.expectedEntries || "",
  };
}

async function setTaskStatus(status: "open" | "closed") {
  if (!selectedTask.value) return;
  try {
    const updated = await filestoreBetaApi.updateTask(selectedTask.value.id, payloadFromTask(selectedTask.value, status));
    ElMessage.success(status === "open" ? "已开放提交" : "已关闭提交");
    await loadTasks();
    await selectTask(updated.id);
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, "状态更新失败"));
  }
}

async function handleTaskCommand(command: string | number | object) {
  if (!selectedTask.value || typeof command !== "string") return;
  if (command === "edit") openEditor(selectedTask.value);
  if (command === "open") await setTaskStatus("open");
  if (command === "close") await setTaskStatus("closed");
  if (command === "copy-old") await copySubmitLink(selectedTask.value, "legacy");
  if (command === "copy-status") await copyStatusLink(selectedTask.value);
  if (command === "qr") openQr(selectedTask.value);
  if (command === "csv") await exportCsv(selectedTask.value);
  if (command === "zip") await downloadZip(selectedTask.value);
  if (command === "repair") await repairFilenames(selectedTask.value);
  if (command === "repair-remote") await repairRemoteFilenames(selectedTask.value);
  if (command === "owner") await bindOwner(selectedTask.value);
  if (command === "delete") await deleteTask(selectedTask.value);
}

function taskStatsLabel(task: FilestoreBetaTask) {
  if (task.stats) return `${task.stats.submitted} 份 / ${task.stats.expected || "-"} 应交`;
  return `${task.createdAt ? new Date(task.createdAt).toLocaleDateString() : "新任务"}`;
}

function betaSubmitPath(task: FilestoreBetaTask) {
  return `/services/tools/filestore-beta/submit/${task.slug}`;
}

function betaStatusPath(task: FilestoreBetaTask) {
  return `/services/tools/filestore-beta/status/${task.slug}`;
}

function legacySubmitPath(task: FilestoreBetaTask) {
  return `/filestore/submit/${task.slug}`;
}

function legacyStatusPath(task: FilestoreBetaTask) {
  return `/filestore/status/${task.slug}`;
}

function absolutePath(path: string) {
  return new URL(path, window.location.origin).toString();
}

async function copySubmitLink(task: FilestoreBetaTask, mode: "beta" | "legacy") {
  await copyText(absolutePath(mode === "beta" ? betaSubmitPath(task) : legacySubmitPath(task)));
  ElMessage.success(mode === "beta" ? "beta 提交链接已复制" : "旧版提交链接已复制");
}

async function copyStatusLink(task: FilestoreBetaTask) {
  await copyText(absolutePath(betaStatusPath(task)));
  ElMessage.success("成功名单链接已复制");
}

function openQr(task: FilestoreBetaTask) {
  qrData.value = absolutePath(betaSubmitPath(task));
  qrVisible.value = true;
}

function openLegacyWorkbench() {
  window.open("/filestore/", "_blank", "noopener,noreferrer");
}

async function copyMissing() {
  const missing = selectedTask.value?.stats?.missing || [];
  if (!missing.length) return;
  await copyText(missing.join("\n"));
  ElMessage.success("缺交名单已复制");
}

async function exportCsv(task: FilestoreBetaTask) {
  try {
    const { blob, filename } = await filestoreBetaBlob(`/api/tasks/${task.id}/export.csv`);
    saveBlob(blob, filename || `${task.title}.csv`);
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, "CSV 导出失败"));
  }
}

async function downloadZip(task: FilestoreBetaTask) {
  if (!task.submissions?.length) {
    ElMessage.info("暂无文件可打包");
    return;
  }
  const entries = [];
  const usedPaths = new Set<string>();
  const loadingMessage = ElMessage({ message: "正在读取文件并打包...", type: "info", duration: 0 });
  try {
    for (const submission of task.submissions) {
      for (const file of submission.files) {
        const { blob } = await filestoreBetaBlob(`/api/files/${file.id}/download`);
        const path = uniqueZipPath(zipEntryPath(task, submission, file), usedPaths);
        entries.push({ path, bytes: new Uint8Array(await blob.arrayBuffer()), date: new Date(file.createdAt || submission.createdAt) });
      }
    }
    saveBlob(buildZip(entries), `${zipSafePathSegment(task.title)}.zip`);
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, "ZIP 打包失败"));
  } finally {
    loadingMessage.close();
  }
}

function zipEntryPath(task: FilestoreBetaTask, submission: FilestoreBetaSubmission, file: FilestoreBetaFile) {
  if (submission.files.length <= 1) return zipSafePathSegment(file.storedName);
  const folder = renderFilestoreBetaTemplate(task.folderTemplate || "{name}-{student_id}", submission.data);
  return `${folder}/${zipSafePathSegment(file.storedName)}`;
}

async function repairFilenames(task: FilestoreBetaTask) {
  try {
    await ElMessageBox.confirm("将按当前数据库中的编码信息修复历史文件名，是否继续？", "修复文件名", { type: "warning" });
    const result = await filestoreBetaApi.repairFilenames(task.id);
    await selectTask(task.id);
    ElMessage.success(`已修复 ${result.updated} 个，保持不变 ${result.unchanged} 个`);
  } catch (error) {
    if (error !== "cancel") ElMessage.error(requestErrorMessage(error, "修复失败"));
  }
}

async function repairRemoteFilenames(task: FilestoreBetaTask) {
  try {
    await ElMessageBox.confirm("将检查世纪互联中的文件路径和远端文件名，冲突项会跳过。是否继续？", "修复云端命名", { type: "warning" });
    const result = await filestoreBetaApi.repairRemoteFilenames(task.id);
    await selectTask(task.id);
    ElMessage.success(`修复 ${result.repaired} 个，同步 ${result.synced} 个，冲突 ${result.conflicts} 个，失败 ${result.failed} 个`);
  } catch (error) {
    if (error !== "cancel") ElMessage.error(requestErrorMessage(error, "云端修复失败"));
  }
}

async function bindOwner(task: FilestoreBetaTask) {
  try {
    const { value } = await ElMessageBox.prompt("输入平台用户名或昵称，系统会匹配有文件收集权限的账号。", "绑定创建者", {
      inputPlaceholder: "用户名或昵称",
      confirmButtonText: "查找并绑定",
      cancelButtonText: "取消",
    });
    if (!value?.trim()) return;
    const users = await filestoreBetaApi.searchUsers(value.trim());
    const normalized = value.trim().toLowerCase();
    const target = users.find((item) => item.username.toLowerCase() === normalized)
      || users.find((item) => item.displayName.toLowerCase() === normalized)
      || users[0];
    if (!target) throw new Error("未找到可绑定的文件收集管理员");
    await ElMessageBox.confirm(`确认把「${task.title}」绑定给 ${target.displayName}（${target.username}）？`, "确认绑定", { type: "warning" });
    const updated = await filestoreBetaApi.bindOwner(task.id, target.userId);
    await loadTasks();
    await selectTask(updated.id);
    ElMessage.success("创建者已更新");
  } catch (error) {
    if (error !== "cancel") ElMessage.error(requestErrorMessage(error, "绑定失败"));
  }
}

async function deleteTask(task: FilestoreBetaTask) {
  try {
    await ElMessageBox.confirm(`删除任务「${task.title}」及所有提交文件？此操作不可恢复。`, "删除任务", { type: "error" });
    await filestoreBetaApi.deleteTask(task.id);
    selectedTask.value = null;
    await loadTasks();
    ElMessage.success("任务已删除");
  } catch (error) {
    if (error !== "cancel") ElMessage.error(requestErrorMessage(error, "删除失败"));
  }
}

async function previewFile(file: FilestoreBetaFile) {
  try {
    const access = await filestoreBetaApi.fileAccess(file.id, "preview");
    if (access.url) {
      openDirectUrl(access.url, access.filename, "preview");
      return;
    }
    if (access.previewMessage) {
      ElMessage.info(access.previewMessage);
      return;
    }
    const { blob, type } = await filestoreBetaApi.fileBlob(file.id, "preview");
    const url = URL.createObjectURL(type ? blob.slice(0, blob.size, type) : blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, "预览失败"));
  }
}

async function downloadFile(file: FilestoreBetaFile) {
  try {
    const access = await filestoreBetaApi.fileAccess(file.id, "download");
    if (access.url) {
      openDirectUrl(access.url, access.filename || file.storedName, "download");
      return;
    }
    const { blob, filename } = await filestoreBetaApi.fileBlob(file.id, "download");
    saveBlob(blob, filename || file.storedName);
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, "下载失败"));
  }
}

async function deleteFile(file: FilestoreBetaFile) {
  if (!selectedTask.value) return;
  try {
    await ElMessageBox.confirm(`删除文件「${file.storedName}」？`, "删除文件", { type: "warning" });
    await filestoreBetaApi.deleteFile(file.id);
    await selectTask(selectedTask.value.id);
    ElMessage.success("文件已删除");
  } catch (error) {
    if (error !== "cancel") ElMessage.error(requestErrorMessage(error, "删除失败"));
  }
}

async function deleteSubmission(id: number) {
  if (!selectedTask.value) return;
  try {
    await ElMessageBox.confirm(`删除提交 #${id} 及其文件？`, "删除提交", { type: "warning" });
    await filestoreBetaApi.deleteSubmission(id);
    await selectTask(selectedTask.value.id);
    ElMessage.success("提交已删除");
  } catch (error) {
    if (error !== "cancel") ElMessage.error(requestErrorMessage(error, "删除失败"));
  }
}

function openSettings() {
  settingsDraft.siteTitle = settings.value.siteTitle || "";
  settingsDraft.siteUrl = settings.value.siteUrl || "";
  settingsVisible.value = true;
}

async function saveSettings() {
  settingsSaving.value = true;
  try {
    settings.value = await filestoreBetaApi.saveSettings({
      siteTitle: settingsDraft.siteTitle,
      siteUrl: settingsDraft.siteUrl,
      taskTemplates: settings.value.taskTemplates,
    });
    settingsVisible.value = false;
    ElMessage.success("全局设置已保存");
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, "设置保存失败"));
  } finally {
    settingsSaving.value = false;
  }
}

async function saveTemplateFromDraft() {
  try {
    const validation = validateFilestoreBetaDraft({ ...draft, title: draft.title || "模板" });
    if (validation && validation !== "请填写任务标题") {
      ElMessage.warning(validation);
      return;
    }
    const { value } = await ElMessageBox.prompt("模板名称", "保存全局模板", {
      inputValue: draft.title.trim() || selectedTemplate()?.name || "文件收集模板",
      confirmButtonText: "保存",
      cancelButtonText: "取消",
    });
    const name = value?.trim();
    if (!name) return;
    const payload = buildFilestoreBetaPayload({ ...draft, title: name });
    const existing = settings.value.taskTemplates.find((item) => item.name === name);
    const next: FilestoreBetaTemplate[] = [
      ...settings.value.taskTemplates.filter((item) => item.name !== name),
      {
        id: existing?.id,
        name,
        description: draft.description.trim(),
        fields: payload.fields,
        fileRules: payload.fileRules,
        renameTemplate: payload.renameTemplate,
        folderTemplate: payload.folderTemplate,
        expectedEntries: payload.expectedEntries,
      },
    ];
    settings.value = await filestoreBetaApi.saveSettings({ taskTemplates: next });
    ElMessage.success("模板已保存");
  } catch (error) {
    if (error !== "cancel") ElMessage.error(requestErrorMessage(error, "模板保存失败"));
  }
}

async function deleteSelectedTemplate() {
  if (!templateKey.value.startsWith("custom:")) return;
  const id = Number(templateKey.value.slice("custom:".length));
  const target = settings.value.taskTemplates.find((item) => item.id === id);
  if (!target) return;
  try {
    await ElMessageBox.confirm(`删除全局模板「${target.name}」？`, "删除模板", { type: "warning" });
    settings.value = await filestoreBetaApi.saveSettings({
      taskTemplates: settings.value.taskTemplates.filter((item) => item.id !== id),
    });
    templateKey.value = "builtin:0";
    ElMessage.success("模板已删除");
  } catch (error) {
    if (error !== "cancel") ElMessage.error(requestErrorMessage(error, "模板删除失败"));
  }
}
</script>

<style scoped>
.fs-beta-page {
  display: grid;
  gap: 18px;
}

.fs-beta-hero {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  padding: 22px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(20, 143, 123, 0.10), rgba(245, 158, 11, 0.08)),
    var(--cpu-surface);
  box-shadow: var(--cpu-shadow-sm);
}

.fs-beta-kicker,
.fs-beta-detail-meta,
.fs-beta-task-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.fs-beta-kicker span:first-child {
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.fs-beta-hero h1 {
  margin: 8px 0 8px;
  color: var(--cpu-text);
  font-size: 26px;
}

.fs-beta-hero p {
  max-width: 720px;
  margin: 0;
  color: var(--cpu-text-secondary);
  line-height: 1.7;
}

.fs-beta-hero-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.fs-beta-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.fs-beta-denied {
  min-height: 300px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface);
  text-align: center;
}

.fs-beta-denied b {
  color: var(--cpu-text);
  font-size: 18px;
}

.fs-beta-denied span {
  color: var(--cpu-text-secondary);
}

.fs-beta-workspace {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.fs-beta-task-pane,
.fs-beta-detail,
.fs-beta-panel {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface);
  box-shadow: var(--cpu-shadow-sm);
}

.fs-beta-task-pane {
  position: sticky;
  top: 82px;
  display: grid;
  gap: 12px;
  padding: 14px;
}

.fs-beta-pane-head,
.fs-beta-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.fs-beta-pane-head div,
.fs-beta-panel-head div {
  display: grid;
  gap: 2px;
}

.fs-beta-pane-head b,
.fs-beta-panel-head b {
  color: var(--cpu-text);
}

.fs-beta-pane-head span,
.fs-beta-panel-head span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.fs-beta-task-list {
  display: grid;
  gap: 8px;
  max-height: calc(100dvh - 250px);
  overflow: auto;
}

.fs-beta-task-card {
  width: 100%;
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-soft);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.fs-beta-task-card.active {
  border-color: var(--cpu-primary);
  background: rgba(20, 143, 123, 0.08);
}

.fs-beta-task-card b,
.fs-beta-task-card small {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
}

.fs-beta-task-card b {
  color: var(--cpu-text);
}

.fs-beta-task-card small,
.fs-beta-task-meta em {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  font-style: normal;
}

.fs-beta-detail {
  display: grid;
  gap: 16px;
  padding: 16px;
  min-width: 0;
}

.fs-beta-detail-head {
  display: flex;
  justify-content: space-between;
  gap: 14px;
}

.fs-beta-detail-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.fs-beta-detail-title h2 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 22px;
}

.fs-beta-detail-head p {
  margin: 8px 0;
  color: var(--cpu-text-secondary);
  line-height: 1.7;
  white-space: pre-wrap;
}

.fs-beta-detail-meta span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.fs-beta-detail-actions {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.fs-beta-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.fs-beta-metrics div {
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-soft);
}

.fs-beta-metrics span,
.fs-beta-metrics small {
  display: block;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.fs-beta-metrics b {
  display: block;
  margin: 6px 0 4px;
  color: var(--cpu-text);
  font-size: 24px;
}

.fs-beta-split {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.fs-beta-panel {
  padding: 14px;
  min-width: 0;
}

.fs-beta-rule-list {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 8px 12px;
  margin: 12px 0 0;
}

.fs-beta-rule-list dt {
  color: var(--cpu-text-secondary);
}

.fs-beta-rule-list dd {
  margin: 0;
  color: var(--cpu-text);
  overflow-wrap: anywhere;
}

.fs-beta-field-list,
.fs-beta-chip-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.fs-beta-field-list span,
.fs-beta-chip-cloud span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text);
  font-size: 12px;
}

.fs-beta-field-list small {
  color: var(--cpu-text-secondary);
}

.fs-beta-link-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.fs-beta-link-grid a {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  color: var(--cpu-primary);
  text-decoration: none;
  background: var(--cpu-surface-soft);
}

.fs-beta-search {
  max-width: 300px;
}

.fs-beta-table-wrap {
  margin-top: 12px;
  overflow: auto;
}

.fs-beta-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 860px;
}

.fs-beta-table th,
.fs-beta-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--cpu-border-soft);
  text-align: left;
  vertical-align: top;
}

.fs-beta-table th {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  font-weight: 700;
  background: var(--cpu-surface-soft);
}

.fs-beta-table td {
  color: var(--cpu-text);
}

.fs-beta-table td > span,
.fs-beta-table td > small {
  display: block;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.fs-beta-file-stack {
  display: grid;
  gap: 7px;
}

.fs-beta-file-stack span {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto auto auto auto;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.fs-beta-file-stack b {
  min-width: 0;
  overflow-wrap: anywhere;
}

.fs-beta-file-stack small {
  color: var(--cpu-text-secondary);
}

.fs-beta-file-stack button {
  min-height: 30px;
  border: 0;
  background: transparent;
  color: var(--cpu-primary);
  cursor: pointer;
}

.fs-beta-file-stack button.danger {
  color: var(--cpu-danger);
}

.fs-beta-editor {
  display: grid;
  gap: 16px;
}

.fs-beta-template-bar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto auto auto;
  gap: 8px;
  align-items: center;
}

.fs-beta-form-field {
  display: grid;
  gap: 7px;
}

.fs-beta-form-field > span {
  color: var(--cpu-text);
  font-weight: 650;
}

.fs-beta-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.fs-beta-editor-section {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-soft);
}

.fs-beta-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.fs-beta-field-editor {
  display: grid;
  grid-template-columns: minmax(120px, 0.9fr) minmax(120px, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface);
}

.fs-beta-field-editor > .el-input:nth-of-type(3),
.fs-beta-field-editor > .el-input:nth-of-type(4),
.fs-beta-field-actions {
  grid-column: span 3;
}

.fs-beta-field-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.fs-beta-preview-line {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border: 1px dashed var(--cpu-border);
  border-radius: 8px;
  color: var(--cpu-text-secondary);
  background: var(--cpu-surface);
  overflow-wrap: anywhere;
}

.fs-beta-preview-line b {
  color: var(--cpu-text);
}

.fs-beta-settings {
  display: grid;
  gap: 14px;
}

.fs-beta-qr {
  display: grid;
  place-items: center;
  gap: 12px;
  text-align: center;
}

.fs-beta-qr img {
  width: 260px;
  height: 260px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
}

.fs-beta-qr span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}

@media (max-width: 980px) {
  .fs-beta-hero,
  .fs-beta-detail-head {
    flex-direction: column;
  }

  .fs-beta-workspace,
  .fs-beta-split {
    grid-template-columns: 1fr;
  }

  .fs-beta-task-pane {
    position: static;
  }

  .fs-beta-task-list {
    max-height: none;
  }

  .fs-beta-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .fs-beta-hero {
    padding: 16px;
  }

  .fs-beta-hero-actions,
  .fs-beta-detail-actions {
    width: 100%;
    justify-content: stretch;
  }

  .fs-beta-hero-actions .el-button,
  .fs-beta-detail-actions .el-button,
  .fs-beta-detail-actions .el-dropdown {
    flex: 1 1 auto;
  }

  .fs-beta-metrics,
  .fs-beta-link-grid,
  .fs-beta-form-grid,
  .fs-beta-template-bar {
    grid-template-columns: 1fr;
  }

  .fs-beta-rule-list {
    grid-template-columns: 1fr;
  }

  .fs-beta-field-editor {
    grid-template-columns: 1fr;
  }

  .fs-beta-field-editor > .el-input:nth-of-type(3),
  .fs-beta-field-editor > .el-input:nth-of-type(4),
  .fs-beta-field-actions {
    grid-column: auto;
  }
}
</style>
