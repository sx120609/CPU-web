import { computed, inject, onMounted, reactive, ref, watch, type InjectionKey, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  filestoreApi,
  filestoreBlob,
  filestoreUrl,
  type FilestoreField,
  type FilestoreFile,
  type FilestoreSettings,
  type FilestoreSubmission,
  type FilestoreSurveyField,
  type FilestoreTask,
  type FilestoreTemplate,
  type FilestoreViewer,
} from "@/api/filestore";
import { buildZip, uniqueZipPath, zipSafePathSegment } from "@/views/services/fileCollectExport";
import {
  absoluteUrl,
  applyTemplateToDraft,
  buildFilestorePayload,
  builtInFilestoreTemplates,
  cloneFields,
  cloneSurveyFields,
  copyText,
  createFilestoreDraft,
  fileTotal,
  formatDateForInput,
  makeFilestoreField,
  makeFilestoreSurveyField,
  normalizeSurveyFieldId,
  openDirectUrl,
  previewStoredFileName,
  renderFilestoreTemplate,
  requestErrorMessage,
  saveBlob,
  statusPath,
  submissionIdentifier,
  submissionOwner,
  submitPath,
  validateFilestoreDraft,
  type FilestoreDraft,
} from "./shared";

export type FileRow = {
  submission: FilestoreSubmission;
  file: FilestoreFile;
  owner: string;
  identifier: string;
};

type BusyOptions = {
  title?: string;
  message?: string;
  detail?: string;
  current?: number;
  total?: number;
  cancelable?: boolean;
};

class BusyCanceledError extends Error {
  constructor() {
    super("操作已取消");
    this.name = "BusyCanceledError";
  }
}

export const filestoreEditorSteps = [
  { value: 1, label: "基本信息" },
  { value: 2, label: "身份字段" },
  { value: 3, label: "问卷题目" },
  { value: 4, label: "上传规则" },
  { value: 5, label: "核对名单" },
] as const;

export type FilestoreWorkspace = ReturnType<typeof useFilestoreWorkspace>;
export const filestoreWorkspaceKey: InjectionKey<FilestoreWorkspace> = Symbol("filestore-workspace");

export function useInjectedFilestoreWorkspace() {
  const workspace = inject(filestoreWorkspaceKey);
  if (!workspace) throw new Error("filestore workspace is not provided");
  return workspace;
}

// 文件收集工作台的数据与操作。桌面端与移动端只负责排版，选中的任务记录在 ?task= 里，
// 移动端从列表进入详情后可以用系统返回回到列表；桌面端没有选中任务时自动打开第一个。
export function useFilestoreWorkspace(options: { autoSelectFirst: Ref<boolean> }) {
  const route = useRoute();
  const router = useRouter();
  const loading = ref(false);
  const denied = ref(false);
  const loadError = ref("");
  const detailLoading = ref(false);
  const saving = ref(false);
  const repairing = ref(false);
  const zipDownloading = ref(false);
  const viewer = ref<FilestoreViewer | null>(null);
  const settings = ref<FilestoreSettings>({ siteUrl: "", siteTitle: "", taskTemplates: [] });
  const tasks = ref<FilestoreTask[]>([]);
  const detail = ref<FilestoreTask | null>(null);
  const taskQuery = ref("");
  const submissionQuery = ref("");
  const fileQuery = ref("");
  const fileManagerVisible = ref(false);
  const qrVisible = ref(false);
  const busy = reactive({
    visible: false,
    title: "正在处理",
    message: "",
    detail: "",
    current: 0,
    total: 0,
    cancelable: false,
    cancelRequested: false,
  });
  let detailSeq = 0;

  const editorVisible = ref(false);
  const editorMode = ref<"create" | "edit">("create");
  const editingId = ref<number | null>(null);
  const currentStep = ref(1);
  const templateKey = ref("builtin:0");
  const draft = reactive<FilestoreDraft>(createFilestoreDraft());

  const selectedTaskId = computed(() => {
    const id = Number(Array.isArray(route.query.task) ? route.query.task[0] : route.query.task);
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  const filteredTasks = computed(() => {
    const query = taskQuery.value.trim().toLowerCase();
    if (!query) return tasks.value;
    return tasks.value.filter((task) => `${task.title} ${task.description} ${task.slug}`.toLowerCase().includes(query));
  });
  const filteredSubmissions = computed(() => {
    const rows = detail.value?.submissions || [];
    const query = submissionQuery.value.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((submission) => `${JSON.stringify(submission.data)} ${JSON.stringify(submission.answers || {})} ${submission.files.map((file) => `${file.storedName} ${file.originalName}`).join(" ")}`.toLowerCase().includes(query));
  });
  const completionRate = computed(() => {
    const stats = detail.value?.stats;
    if (!stats?.expected) return 0;
    const submitted = stats.inListSubmitted ?? stats.submitted ?? 0;
    return Math.min(100, Math.round((submitted / stats.expected) * 100));
  });
  const allFiles = computed<FileRow[]>(() => {
    const task = detail.value;
    if (!task) return [];
    return (task.submissions || []).flatMap((submission) => {
      const owner = submissionOwner(task, submission);
      const identifier = submissionIdentifier(task, submission);
      return submission.files.map((file) => ({ submission, file, owner, identifier }));
    });
  });
  const filteredFiles = computed(() => {
    const query = fileQuery.value.trim().toLowerCase();
    if (!query) return allFiles.value;
    return allFiles.value.filter((item) => `${item.owner} ${item.identifier} ${item.file.storedName} ${item.file.originalName}`.toLowerCase().includes(query));
  });
  const submitUrl = computed(() => (detail.value ? absoluteUrl(submitPath(detail.value.slug)) : ""));
  const statusUrl = computed(() => (detail.value ? absoluteUrl(statusPath(detail.value.slug)) : ""));
  const qrImageUrl = computed(() => (submitUrl.value
    ? filestoreUrl(`/api/qrcode?${new URLSearchParams({ data: submitUrl.value, size: "260" })}`)
    : ""));
  const templateOptions = computed(() => [
    ...builtInFilestoreTemplates.map((template, index) => ({ key: `builtin:${index}`, label: template.name, template, custom: false })),
    ...settings.value.taskTemplates.map((template) => ({ key: `custom:${template.id}`, label: template.name, template, custom: true })),
  ]);
  const renamePreview = computed(() => {
    const data = sampleData();
    const first = previewStoredFileName(draft.renameTemplate, data, "材料.jpg", 1, 3);
    const second = previewStoredFileName(draft.renameTemplate, data, "材料.jpg", 2, 3);
    return `${first} / ${second}`;
  });
  const folderPreview = computed(() => renderFilestoreTemplate(draft.folderTemplate, sampleData()));

  onMounted(() => {
    void load();
  });

  watch(selectedTaskId, (id) => {
    if (id) {
      if (id !== detail.value?.id) void loadDetail(id);
      return;
    }
    if (options.autoSelectFirst.value && tasks.value.length) openTask(tasks.value[0].id, { replace: true });
    else detail.value = null;
  });

  watch(options.autoSelectFirst, (auto) => {
    if (auto && !selectedTaskId.value && tasks.value.length) openTask(tasks.value[0].id, { replace: true });
  });

  async function load() {
    loading.value = true;
    denied.value = false;
    loadError.value = "";
    try {
      const me = await filestoreApi.me();
      viewer.value = me;
      settings.value = me.settings;
      await loadTasks();
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401) {
        void router.push({ name: "login", query: { redirect: route.fullPath } });
        return;
      }
      if (status === 403) {
        denied.value = true;
        return;
      }
      loadError.value = requestErrorMessage(error, "任务加载失败");
    } finally {
      loading.value = false;
    }
  }

  async function loadTasks() {
    tasks.value = await filestoreApi.tasks();
    const selected = tasks.value.find((task) => task.id === selectedTaskId.value);
    if (selected) {
      await loadDetail(selected.id);
      return;
    }
    detail.value = null;
    if (selectedTaskId.value || options.autoSelectFirst.value) {
      const first = options.autoSelectFirst.value ? tasks.value[0] : undefined;
      if (first) openTask(first.id, { replace: true });
      else clearTaskQuery();
    }
  }

  async function loadDetail(id: number) {
    const seq = ++detailSeq;
    detailLoading.value = !detail.value || detail.value.id !== id;
    try {
      const next = await filestoreApi.task(id);
      if (seq !== detailSeq) return;
      detail.value = next;
    } catch (error) {
      if (seq === detailSeq) ElMessage.error(requestErrorMessage(error, "任务详情加载失败"));
    } finally {
      if (seq === detailSeq) detailLoading.value = false;
    }
  }

  function refreshDetail() {
    return detail.value ? loadDetail(detail.value.id) : Promise.resolve();
  }

  function openTask(id: number, opts: { replace?: boolean } = {}) {
    if (id !== detail.value?.id) submissionQuery.value = "";
    const location = { query: { ...route.query, task: String(id) } };
    if (selectedTaskId.value === id) {
      if (detail.value?.id !== id) void loadDetail(id);
      return;
    }
    void (opts.replace ? router.replace(location) : router.push(location));
  }

  function clearTaskQuery() {
    if (!route.query.task) return;
    const query = { ...route.query };
    delete query.task;
    void router.replace({ query });
  }

  function setBusy(options: BusyOptions = {}) {
    busy.title = options.title || "正在处理";
    busy.message = options.message || "系统正在读取数据，请不要关闭页面。";
    busy.detail = options.detail || "";
    busy.current = Math.max(0, Number(options.current || 0));
    busy.total = Math.max(0, Number(options.total || 0));
    busy.cancelable = Boolean(options.cancelable);
    busy.cancelRequested = false;
  }

  function updateBusy(options: BusyOptions) {
    if (options.title !== undefined) busy.title = options.title;
    if (options.message !== undefined) busy.message = options.message;
    if (options.detail !== undefined) busy.detail = options.detail;
    if (options.current !== undefined) busy.current = Math.max(0, Number(options.current));
    if (options.total !== undefined) busy.total = Math.max(0, Number(options.total));
    if (options.cancelable !== undefined) busy.cancelable = Boolean(options.cancelable);
  }

  async function withBusy<T>(options: BusyOptions, work: () => Promise<T>) {
    setBusy(options);
    busy.visible = true;
    try {
      return await work();
    } finally {
      busy.visible = false;
    }
  }

  function cancelBusy() {
    if (!busy.cancelable || busy.cancelRequested) return;
    busy.cancelRequested = true;
    busy.message = "正在取消当前操作，已读取的临时数据会被丢弃。";
  }

  function throwIfBusyCanceled() {
    if (busy.cancelRequested) throw new BusyCanceledError();
  }

  function confirmAction(title: string, body: string, okText: string, danger = true) {
    return ElMessageBox.confirm(body, title, {
      confirmButtonText: okText,
      cancelButtonText: "取消",
      type: danger ? "warning" : "info",
      confirmButtonClass: danger ? "el-button--danger" : undefined,
    }).then(() => true).catch(() => false);
  }

  function promptValue(title: string, body: string, value = "", okText = "确定") {
    return ElMessageBox.prompt(body, title, {
      confirmButtonText: okText,
      cancelButtonText: "取消",
      inputValue: value,
    }).then(({ value: input }) => String(input || "").trim()).catch(() => null);
  }

  function sampleData() {
    return Object.fromEntries(draft.fields.map((field) => [field.key || field.id, field.placeholder || field.label || "示例"]));
  }

  function openEditor(task?: FilestoreTask | null) {
    Object.assign(draft, createFilestoreDraft());
    currentStep.value = 1;
    if (task) {
      editorMode.value = "edit";
      editingId.value = task.id;
      draft.title = task.title;
      draft.description = task.description || "";
      draft.deadline = formatDateForInput(task.deadline);
      draft.status = task.status;
      draft.fields = cloneFields(task.fields);
      draft.surveyFields = cloneSurveyFields(task.surveyFields || []);
      draft.allowedTypes = task.fileRules.allowedTypes.join(",");
      draft.maxSizeMb = task.fileRules.maxSizeMb;
      draft.maxCount = task.fileRules.maxCount;
      draft.renameTemplate = task.renameTemplate;
      draft.folderTemplate = task.folderTemplate;
      draft.expectedEntries = task.expectedEntries || "";
    } else {
      editorMode.value = "create";
      editingId.value = null;
    }
    editorVisible.value = true;
  }

  function applySelectedTemplate() {
    const template = templateOptions.value.find((item) => item.key === templateKey.value)?.template;
    if (!template) return;
    applyTemplateToDraft(draft, template, editorMode.value === "create");
    ElMessage.success("模板已应用");
  }

  function addDraftField() {
    draft.fields.push(makeFilestoreField(draft.fields.length));
  }

  function addSurveyField() {
    draft.surveyFields.push(makeFilestoreSurveyField(draft.surveyFields.length));
  }

  function duplicateSurveyField(index: number) {
    const source = draft.surveyFields[index];
    if (!source) return;
    draft.surveyFields.splice(index + 1, 0, {
      ...source,
      id: normalizeSurveyFieldId(`${source.id || "q"}_copy_${Date.now().toString(36).slice(-4)}`),
      label: source.label ? `${source.label} 副本` : "",
      options: [...(source.options || [])],
      branching: source.branching ? { ...source.branching } : undefined,
    });
  }

  function normalizeSurveyField(field: FilestoreSurveyField) {
    if (field.type === "single" || field.type === "multiple") {
      if (!field.options?.length) field.options = ["选项1", "选项2"];
    } else {
      field.options = undefined;
      field.branching = undefined;
    }
    if (field.type === "rating") {
      field.min = field.min ?? 1;
      field.max = field.max ?? 5;
      field.step = undefined;
    } else if (field.type === "number") {
      field.step = field.step || 1;
    } else if (field.type === "text") {
      field.maxLength = field.maxLength || 300;
    } else if (field.type === "textarea") {
      field.maxLength = field.maxLength || 2000;
    }
  }

  function setSurveyOptions(field: FilestoreSurveyField, value: string) {
    field.options = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }

  function insertToken(target: "renameTemplate" | "folderTemplate", token: string) {
    draft[target] = `${draft[target] || ""}${token}`;
  }

  async function saveTask() {
    const message = validateFilestoreDraft(draft);
    if (message) {
      ElMessage.error(message);
      return;
    }
    saving.value = true;
    try {
      const payload = buildFilestorePayload(draft);
      const saved = editorMode.value === "edit" && editingId.value
        ? await filestoreApi.updateTask(editingId.value, payload)
        : await filestoreApi.createTask(payload);
      editorVisible.value = false;
      ElMessage.success(editorMode.value === "edit" ? "任务已更新" : "任务已创建");
      tasks.value = await filestoreApi.tasks();
      if (selectedTaskId.value === saved.id) await loadDetail(saved.id);
      else openTask(saved.id, { replace: options.autoSelectFirst.value });
    } catch (error) {
      ElMessage.error(requestErrorMessage(error, "保存失败"));
    } finally {
      saving.value = false;
    }
  }

  async function deleteTask() {
    if (!editingId.value) return;
    if (!await confirmAction("删除任务", `删除任务「${draft.title}」及所有提交文件？此操作不可恢复。`, "删除")) return;
    try {
      await filestoreApi.deleteTask(editingId.value);
      editorVisible.value = false;
      detail.value = null;
      await loadTasks();
      ElMessage.success("任务已删除");
    } catch (error) {
      ElMessage.error(requestErrorMessage(error, "删除失败"));
    }
  }

  async function generateRegex(field: FilestoreField) {
    const prompt = await promptValue("AI 生成正则", "描述这个字段的校验规则，例如：必须是 10 位数字", "", "生成");
    if (!prompt) return;
    try {
      const result = await filestoreApi.generateRegex(prompt);
      field.pattern = result.regex || field.pattern;
      field.placeholder = result.placeholder || field.placeholder;
      ElMessage.success(result.description || "正则已生成");
    } catch (error) {
      ElMessage.error(requestErrorMessage(error, "正则生成失败"));
    }
  }

  async function saveTemplateFromDraft() {
    if (!viewer.value?.isManager) return;
    const name = await promptValue("保存当前模板", "输入模板名称，之后可在新任务中复用。", draft.title.trim() || "文件收集模板", "保存");
    if (!name) return;
    try {
      const payload = buildFilestorePayload({ ...draft, title: name });
      const existing = settings.value.taskTemplates.find((item) => item.name === name);
      const next: FilestoreTemplate[] = [
        ...settings.value.taskTemplates.filter((item) => item.name !== name),
        {
          id: existing?.id,
          name,
          description: draft.description.trim(),
          fields: payload.fields,
          surveyFields: payload.surveyFields,
          fileRules: payload.fileRules,
          renameTemplate: payload.renameTemplate,
          folderTemplate: payload.folderTemplate,
          expectedEntries: payload.expectedEntries,
        },
      ];
      settings.value = await filestoreApi.saveSettings({ taskTemplates: next });
      ElMessage.success("模板已保存");
    } catch (error) {
      ElMessage.error(requestErrorMessage(error, "模板保存失败"));
    }
  }

  async function deleteSelectedTemplate() {
    if (!viewer.value?.isManager || !templateKey.value.startsWith("custom:")) return;
    const id = Number(templateKey.value.slice("custom:".length));
    const target = settings.value.taskTemplates.find((item) => item.id === id);
    if (!target || !await confirmAction("删除模板", `删除全局模板「${target.name}」？`, "删除")) return;
    try {
      settings.value = await filestoreApi.saveSettings({
        taskTemplates: settings.value.taskTemplates.filter((item) => item.id !== id),
      });
      templateKey.value = "builtin:0";
      ElMessage.success("模板已删除");
    } catch (error) {
      ElMessage.error(requestErrorMessage(error, "模板删除失败"));
    }
  }

  async function copyLink(kind: "submit" | "status") {
    const url = kind === "submit" ? submitUrl.value : statusUrl.value;
    if (!url) return;
    try {
      await copyText(url);
      ElMessage.success(kind === "submit" ? "提交链接已复制" : "成功名单链接已复制");
    } catch {
      ElMessage.warning("复制失败，请长按链接手动复制");
    }
  }

  async function copyMissing() {
    const missing = detail.value?.stats?.missing || [];
    if (!missing.length) return;
    try {
      await copyText(missing.join("\n"));
      ElMessage.success("缺交名单已复制");
    } catch {
      ElMessage.warning("复制失败，请稍后重试");
    }
  }

  function openFileManager() {
    fileQuery.value = "";
    fileManagerVisible.value = true;
  }

  async function exportCsv() {
    const task = detail.value;
    if (!task) return;
    try {
      const { blob, filename } = await withBusy(
        { title: "正在导出 CSV", message: "正在读取提交记录并生成表格文件。" },
        () => filestoreBlob(`/api/tasks/${task.id}/export.csv`),
      );
      saveBlob(blob, filename || `${task.title}.csv`);
      ElMessage.success("CSV 已生成");
    } catch (error) {
      ElMessage.error(requestErrorMessage(error, "CSV 导出失败"));
    }
  }

  function zipEntryPath(task: FilestoreTask, submission: FilestoreSubmission, file: FilestoreFile) {
    if (submission.files.length <= 1) return zipSafePathSegment(file.storedName);
    const folder = renderFilestoreTemplate(task.folderTemplate || "{name}-{student_id}", submission.data);
    return `${folder}/${zipSafePathSegment(file.storedName)}`;
  }

  async function downloadZip() {
    const task = detail.value;
    if (!task || !fileTotal(task)) {
      ElMessage.info("暂无文件可打包");
      return;
    }
    const fileCount = fileTotal(task);
    zipDownloading.value = true;
    try {
      const zipBlob = await withBusy(
        { title: "正在下载 ZIP", message: `正在读取文件 0/${fileCount}`, current: 0, total: fileCount, cancelable: true },
        async () => {
          const entries = [];
          const usedPaths = new Set<string>();
          let current = 0;
          for (const submission of task.submissions || []) {
            for (const file of submission.files) {
              throwIfBusyCanceled();
              current += 1;
              updateBusy({ message: `正在读取文件 ${current}/${fileCount}`, detail: file.storedName, current, total: fileCount });
              const { blob } = await filestoreBlob(`/api/files/${file.id}/download`);
              throwIfBusyCanceled();
              entries.push({
                path: uniqueZipPath(zipEntryPath(task, submission, file), usedPaths),
                bytes: new Uint8Array(await blob.arrayBuffer()),
                date: new Date(file.createdAt || submission.createdAt),
              });
              throwIfBusyCanceled();
            }
          }
          updateBusy({ title: "正在生成 ZIP", message: "浏览器正在打包文件，请稍候。", detail: "", current: fileCount, total: fileCount });
          throwIfBusyCanceled();
          return buildZip(entries);
        },
      );
      saveBlob(zipBlob, `${zipSafePathSegment(task.title)}.zip`);
      ElMessage.success("ZIP 已生成");
    } catch (error) {
      if (error instanceof BusyCanceledError) ElMessage.info("已取消 ZIP 下载");
      else ElMessage.error(requestErrorMessage(error, "ZIP 打包失败"));
    } finally {
      zipDownloading.value = false;
    }
  }

  async function repairFilenames() {
    const taskId = detail.value?.id;
    if (!taskId || repairing.value) return;
    if (!await confirmAction("修复乱码文件名", "将按当前数据库中的编码信息修复历史文件名，是否继续？", "开始修复", false)) return;
    repairing.value = true;
    try {
      const result = await withBusy(
        { title: "正在修复乱码文件名", message: "系统正在扫描历史文件名并更新可恢复项。" },
        () => filestoreApi.repairFilenames(taskId),
      );
      await withBusy({ title: "正在刷新任务", message: "正在读取修复后的提交记录。" }, () => loadDetail(taskId));
      ElMessage.success(`已修复 ${result.updated} 个，保持不变 ${result.unchanged} 个`);
    } catch (error) {
      ElMessage.error(requestErrorMessage(error, "修复失败"));
    } finally {
      repairing.value = false;
    }
  }

  async function repairRemoteFilenames() {
    const taskId = detail.value?.id;
    if (!taskId || repairing.value) return;
    if (!await confirmAction("修复云端文件名", "将检查世纪互联中的文件路径和远端文件名，冲突项会跳过。是否继续？", "开始修复", false)) return;
    repairing.value = true;
    try {
      const result = await withBusy(
        { title: "正在修复云端文件名", message: "正在检查世纪互联文件路径和远端文件名。" },
        () => filestoreApi.repairRemoteFilenames(taskId),
      );
      await withBusy({ title: "正在刷新任务", message: "正在读取修复后的提交记录。" }, () => loadDetail(taskId));
      ElMessage.success(`修复 ${result.repaired} 个，同步 ${result.synced} 个，冲突 ${result.conflicts} 个，失败 ${result.failed} 个`);
    } catch (error) {
      ElMessage.error(requestErrorMessage(error, "云端修复失败"));
    } finally {
      repairing.value = false;
    }
  }

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // 先同步打开窗口再异步取地址，避免浏览器把异步打开的预览窗口当成弹窗拦截。
  function openPreviewLoadingWindow(file: FilestoreFile) {
    const previewWindow = window.open("about:blank", "_blank");
    if (!previewWindow) return null;
    previewWindow.opener = null;
    previewWindow.document.write(`
      <title>正在加载文件...</title>
      <body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a;">
        <div style="padding:24px;">
          <h1 style="font-size:18px;margin:0 0 8px;">正在加载文件...</h1>
          <p style="margin:0;color:#64748b;font-size:14px;">${escapeHtml(file.storedName)}</p>
        </div>
      </body>
    `);
    previewWindow.document.close();
    return previewWindow;
  }

  async function previewFile(file: FilestoreFile) {
    const previewWindow = openPreviewLoadingWindow(file);
    setBusy({ title: "正在查看文件", message: "正在获取文件预览地址。", detail: file.storedName });
    busy.visible = true;
    try {
      const access = await filestoreApi.fileAccess(file.id, "preview");
      if (access.url) {
        if (previewWindow && !previewWindow.closed) previewWindow.location.replace(access.url);
        else openDirectUrl(access.url, access.filename || file.storedName, "preview");
        return;
      }
      if (access.previewMessage) {
        if (previewWindow && !previewWindow.closed) previewWindow.close();
        ElMessage.info(access.previewMessage);
        return;
      }
      updateBusy({ message: "正在读取文件内容。" });
      const { blob, type } = await filestoreApi.fileBlob(file.id, "preview");
      const url = URL.createObjectURL(type ? blob.slice(0, blob.size, type) : blob);
      if (previewWindow && !previewWindow.closed) previewWindow.location.replace(url);
      else window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      if (previewWindow && !previewWindow.closed) previewWindow.close();
      ElMessage.error(requestErrorMessage(error, "预览失败"));
    } finally {
      busy.visible = false;
    }
  }

  async function downloadFile(file: FilestoreFile) {
    setBusy({ title: "正在下载文件", message: "正在获取下载链接。", detail: file.storedName });
    busy.visible = true;
    try {
      const access = await filestoreApi.fileAccess(file.id, "download");
      if (access.url) {
        openDirectUrl(access.url, access.filename || file.storedName, "download");
      } else {
        updateBusy({ message: "正在读取文件内容。" });
        const { blob, filename } = await filestoreApi.fileBlob(file.id, "download");
        saveBlob(blob, filename || file.storedName);
      }
      ElMessage.success("已向浏览器发起下载，请查看下载列表");
    } catch (error) {
      ElMessage.error(requestErrorMessage(error, "下载失败"));
    } finally {
      busy.visible = false;
    }
  }

  async function deleteFile(file: FilestoreFile) {
    const taskId = detail.value?.id;
    if (!taskId || !await confirmAction("删除文件", `删除文件「${file.storedName}」？`, "删除")) return;
    try {
      await withBusy({ title: "正在删除文件", message: "正在从服务器移除文件。", detail: file.storedName }, () => filestoreApi.deleteFile(file.id));
      await withBusy({ title: "正在刷新任务", message: "正在读取最新提交记录。" }, () => loadDetail(taskId));
      ElMessage.success("文件已删除");
    } catch (error) {
      ElMessage.error(requestErrorMessage(error, "删除失败"));
    }
  }

  async function deleteSubmission(submission: FilestoreSubmission) {
    const taskId = detail.value?.id;
    const label = detail.value ? submissionOwner(detail.value, submission) : `#${submission.id}`;
    if (!taskId || !await confirmAction("删除提交", `删除「${label}」的提交 #${submission.id} 及其文件？`, "删除")) return;
    try {
      await withBusy({ title: "正在删除提交", message: "正在删除该提交记录及其文件。", detail: `#${submission.id}` }, () => filestoreApi.deleteSubmission(submission.id));
      await withBusy({ title: "正在刷新任务", message: "正在读取最新提交记录。" }, () => loadDetail(taskId));
      ElMessage.success("提交已删除");
    } catch (error) {
      ElMessage.error(requestErrorMessage(error, "删除失败"));
    }
  }

  async function bindTaskOwner() {
    const task = detail.value;
    if (!task) return;
    const keyword = await promptValue("绑定创建者", "输入平台用户名，或输入能唯一匹配的昵称。系统只会匹配有文件收集管理权限的账号。", "", "查找");
    if (!keyword) return;
    try {
      const users = await filestoreApi.searchUsers(keyword);
      const normalized = keyword.toLowerCase();
      const target = users.find((item) => item.username.toLowerCase() === normalized)
        || users.find((item) => item.displayName.toLowerCase() === normalized)
        || users[0];
      if (!target) throw new Error("未找到可绑定的文件收集管理员");
      if (!await confirmAction("确认绑定", `确认绑定给 ${target.displayName}（${target.username}）？`, "绑定", false)) return;
      detail.value = await filestoreApi.bindOwner(task.id, target.userId);
      tasks.value = await filestoreApi.tasks();
      ElMessage.success("创建者已更新");
    } catch (error) {
      ElMessage.error(requestErrorMessage(error, "绑定失败"));
    }
  }

  return {
    loading,
    denied,
    loadError,
    detailLoading,
    saving,
    repairing,
    zipDownloading,
    viewer,
    settings,
    tasks,
    detail,
    selectedTaskId,
    taskQuery,
    submissionQuery,
    fileQuery,
    filteredTasks,
    filteredSubmissions,
    completionRate,
    allFiles,
    filteredFiles,
    submitUrl,
    statusUrl,
    qrImageUrl,
    fileManagerVisible,
    qrVisible,
    busy,
    editorVisible,
    editorMode,
    currentStep,
    templateKey,
    templateOptions,
    draft,
    renamePreview,
    folderPreview,
    load,
    refreshDetail,
    openTask,
    clearTaskQuery,
    cancelBusy,
    openEditor,
    applySelectedTemplate,
    addDraftField,
    addSurveyField,
    duplicateSurveyField,
    normalizeSurveyField,
    setSurveyOptions,
    insertToken,
    saveTask,
    deleteTask,
    generateRegex,
    saveTemplateFromDraft,
    deleteSelectedTemplate,
    copyLink,
    copyMissing,
    openFileManager,
    exportCsv,
    downloadZip,
    repairFilenames,
    repairRemoteFilenames,
    previewFile,
    downloadFile,
    deleteFile,
    deleteSubmission,
    bindTaskOwner,
  };
}
