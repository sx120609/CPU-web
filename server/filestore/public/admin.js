const SITE_TITLE_DEFAULT = "药大拾间文件收集";

const state = {
  tasks: [],
  current: null,
  detail: null,
  mode: "create",
  templateKey: "builtin:student",
  settings: { siteUrl: "", siteTitle: SITE_TITLE_DEFAULT, taskTemplates: [] },
  viewer: { role: "", isSuperAdmin: false, isManager: false, user: null },
  authed: false,
  softRefreshTimer: null,
  softRefreshing: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const builtInTemplates = {
  "builtin:student": {
    name: "学号模板",
    fields: [
      { label: "姓名", key: "name", required: true, pattern: "^[\\u4e00-\\u9fa5·]{2,20}$", placeholder: "请输入中文姓名" },
      { label: "学号", key: "student_id", required: true, pattern: "^2020\\d{6}$", placeholder: "例如 2020240444" },
    ],
    fileRules: { allowedTypes: ["pdf", "doc", "docx", "jpg", "png", "zip"], maxSizeMb: 20, maxCount: 1 },
    renameTemplate: "{name}-{student_id}",
    folderTemplate: "{name}-{student_id}",
  },
  "builtin:exam": {
    name: "考试号模板",
    fields: [
      { label: "姓名", key: "name", required: true, pattern: "^[\\u4e00-\\u9fa5·]{2,20}$", placeholder: "请输入中文姓名" },
      { label: "考试号", key: "student_id", required: true, pattern: "^24201505\\d{2}$", placeholder: "例如 2420150508" },
    ],
    fileRules: { allowedTypes: ["pdf", "doc", "docx", "jpg", "png", "zip"], maxSizeMb: 20, maxCount: 1 },
    renameTemplate: "{name}-{student_id}",
    folderTemplate: "{name}-{student_id}",
  },
};

window.addEventListener("error", (event) => {
  reportError(event.error || new Error(event.message));
});

window.addEventListener("unhandledrejection", (event) => {
  reportError(event.reason || new Error("操作失败"));
});

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeSiteTitle(value) {
  const title = String(value || "").trim();
  if (!title || /^filestore(?:\s|$)/i.test(title)) return SITE_TITLE_DEFAULT;
  return title;
}

function headers() {
  const token = localStorage.getItem("cpu-web-token") || "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function authHeaders() {
  const token = localStorage.getItem("cpu-web-token") || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) setAuthed(false);
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function setAuthed(isAuthed) {
  state.authed = isAuthed;
  if (!isAuthed) state.viewer = { role: "", isSuperAdmin: false, isManager: false, user: null };
  document.body.classList.toggle("auth-pending", !isAuthed);
  $("#loginScreen").hidden = isAuthed;
  if (isAuthed) {
    startSoftRefresh();
  } else {
    stopSoftRefresh();
  }
  syncOwnerBindButton(state.current);
  syncTemplateActions();
}

function applyBranding() {
  const title = normalizeSiteTitle(state.settings.siteTitle);
  document.title = `${title} · 工作台`;
  $$("[data-site-title]").forEach((node) => {
    node.textContent = title;
  });
}

function applySiteFooter(config = {}) {
  const filingNumber = String(config.siteFilingNumber || "").trim();
  $$("[data-filing-link]").forEach((node) => {
    node.hidden = !filingNumber;
    node.textContent = filingNumber;
  });
}

async function loadSiteFooter() {
  try {
    const response = await fetch("/api/platform/site-config", { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "备案信息加载失败");
    applySiteFooter(payload);
  } catch {
    applySiteFooter({});
  }
}

function formatCreator(task) {
  const createdBy = task?.createdBy;
  if (!createdBy?.userId) return "未绑定";
  const displayName = createdBy.displayName || createdBy.username || "未绑定";
  return createdBy.username && createdBy.username !== displayName
    ? `${displayName}（${createdBy.username}）`
    : displayName;
}

function syncOwnerBindButton(task = state.current) {
  const button = $("#bindTaskOwner");
  if (!button) return;
  const visible = Boolean(state.viewer.isSuperAdmin);
  button.hidden = !visible;
  if (!visible) return;
  button.disabled = !task;
  button.textContent = task?.createdBy?.userId ? "更改创建者" : "绑定创建者";
}

function syncTemplateActions() {
  const canManageTemplates = Boolean(state.viewer.isManager);
  const saveButton = $("#saveTemplate");
  const deleteButton = $("#deleteTemplate");
  if (saveButton) {
    saveButton.hidden = !canManageTemplates;
    saveButton.disabled = !canManageTemplates;
  }
  if (deleteButton) {
    deleteButton.hidden = !canManageTemplates;
    deleteButton.disabled = !canManageTemplates || state.templateKey.startsWith("builtin:");
  }
}

async function checkSession() {
  try {
    const session = await api("/api/admin/me");
    state.settings = normalizeSettings(session.settings);
    state.viewer = {
      role: session.role || "",
      isSuperAdmin: Boolean(session.isSuperAdmin),
      isManager: Boolean(session.isManager),
      user: session.user || null,
    };
    applyBranding();
    renderTemplateSelect(state.templateKey);
    setAuthed(true);
    await loadTasks();
  } catch {
    setAuthed(false);
  }
}

async function login(password) {
  void password;
  location.href = `/login?redirect=${encodeURIComponent("/services/tools/filestore")}`;
}

function toast(text, type = "") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = text;
  $("#toastHost").appendChild(item);
  setTimeout(() => item.remove(), type === "error" ? 5200 : 2800);
}

function reportError(error, fallback = "操作失败") {
  toast(error?.message || fallback, "error");
}

function safe(handler) {
  return async (event) => {
    try {
      await handler(event);
    } catch (error) {
      reportError(error);
    }
  };
}

function confirmInApp({ title = "确认操作", body = "", okText = "确认", danger = true } = {}) {
  return new Promise((resolve) => {
    const dialog = $("#confirmDialog");
    $("#confirmTitle").textContent = title;
    $("#confirmBody").textContent = body;
    $("#confirmOk").textContent = okText;
    $("#confirmOk").className = danger ? "danger" : "primary";

    const cleanup = (value) => {
      $("#confirmOk").onclick = null;
      $("#confirmCancel").onclick = null;
      dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };

    $("#confirmOk").onclick = () => cleanup(true);
    $("#confirmCancel").onclick = () => cleanup(false);
    dialog.onclose = () => cleanup(false);
    dialog.showModal();
  });
}

function promptInApp({ title = "输入名称", body = "", label = "名称", value = "", okText = "保存" } = {}) {
  return new Promise((resolve) => {
    const dialog = $("#promptDialog");
    $("#promptTitle").textContent = title;
    $("#promptBody").textContent = body;
    $("#promptLabel").firstChild.textContent = label;
    $("#promptInput").value = value;
    $("#promptOk").textContent = okText;

    const cleanup = (result) => {
      $("#promptOk").onclick = null;
      $("#promptCancel").onclick = null;
      dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(result);
    };

    $("#promptOk").onclick = () => cleanup($("#promptInput").value.trim());
    $("#promptCancel").onclick = () => cleanup(null);
    dialog.onclose = () => cleanup(null);
    dialog.showModal();
    $("#promptInput").focus();
  });
}

function normalizeSettings(settings = {}) {
  return {
    siteUrl: settings.siteUrl || "",
    siteTitle: normalizeSiteTitle(settings.siteTitle),
    taskTemplates: Array.isArray(settings.taskTemplates) ? settings.taskTemplates : [],
  };
}

function normalizeAllowedTypes(value) {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function localDateTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function absoluteSubmitUrl(task) {
  if (!task) return "";
  const base = location.origin.replace(/\/+$/, "");
  return `${base}${task.submitUrl}`;
}

function absoluteStatusUrl(task) {
  if (!task) return "";
  const base = location.origin.replace(/\/+$/, "");
  return `${base}/status/${task.token}`;
}

function qrCodeImageUrl(data, size = 260) {
  const params = new URLSearchParams({
    data,
    size: String(size),
  });
  return `/api/qrcode?${params.toString()}`;
}

function defaultTemplate() {
  return builtInTemplates["builtin:student"];
}

function defaultFields() {
  return defaultTemplate().fields;
}

function currentTemplateOptions() {
  return [
    ...Object.entries(builtInTemplates).map(([key, template]) => ({ key, template, builtin: true })),
    ...state.settings.taskTemplates.map((template) => ({ key: `custom:${template.id}`, template, builtin: false })),
  ];
}

function selectedTemplate() {
  const key = $("#templateSelect").value || state.templateKey;
  return currentTemplateOptions().find((item) => item.key === key);
}

function renderTemplateSelect(selectedKey = state.templateKey) {
  const options = currentTemplateOptions();
  $("#templateSelect").innerHTML = options.map((item) => `
    <option value="${escapeHtml(item.key)}">${item.builtin ? "内置：" : "自定义："}${escapeHtml(item.template.name)}</option>
  `).join("");
  const hasSelected = options.some((item) => item.key === selectedKey);
  state.templateKey = hasSelected ? selectedKey : "builtin:student";
  $("#templateSelect").value = state.templateKey;
  syncTemplateActions();
}

function addField(field = {}) {
  const row = document.createElement("div");
  row.className = "field-card";
  
  const hasValidation = Boolean(field.pattern || field.placeholder);
  
  row.innerHTML = `
    <div class="field-top">
      <input class="field-label" value="${escapeHtml(field.label || "")}" placeholder="字段名">
      <input class="field-key" value="${escapeHtml(field.key || "")}" placeholder="key">
      <button class="icon-button remove-field" type="button" title="删除">×</button>
    </div>
    
    <div class="field-validation-toggle-row">
      <button class="text-button toggle-validation" type="button">
        ${hasValidation ? "收起校验与提示 ▲" : "✨ 智能校验与提示 ▼"}
      </button>
    </div>
    
    <div class="field-validation-box" style="${hasValidation ? "" : "display: none;"}">
      <div class="field-ai-row">
        <input class="field-ai-prompt" placeholder="用自然语言描述规则，例如：学号必须以20开头，十位数字">
        <button class="btn-ai-generate" type="button">AI 生成</button>
      </div>
      <div class="field-validation-outputs">
        <div class="field-output-col">
          <span class="field-sublabel">正则规则</span>
          <input class="field-pattern" value="${escapeHtml(field.pattern || "")}" placeholder="正则规则，例如 \\d{11}">
        </div>
        <div class="field-output-col">
          <span class="field-sublabel">输入提示</span>
          <input class="field-placeholder" value="${escapeHtml(field.placeholder || "")}" placeholder="输入提示，例如 例如 2020240444">
        </div>
      </div>
    </div>
    
    <div class="field-bottom">
      <label class="checkline"><input class="field-required" type="checkbox" ${field.required === false ? "" : "checked"}> 必填字段</label>
    </div>
  `;

  row.querySelector(".remove-field").addEventListener("click", () => {
    row.remove();
    renderRenameFieldOptions();
    updateRenamePreview();
  });

  const toggleBtn = row.querySelector(".toggle-validation");
  const valBox = row.querySelector(".field-validation-box");
  toggleBtn.addEventListener("click", () => {
    const isHidden = valBox.style.display === "none";
    valBox.style.display = isHidden ? "" : "none";
    toggleBtn.textContent = isHidden ? "收起校验与提示 ▲" : "✨ 智能校验与提示 ▼";
  });

  const aiBtn = row.querySelector(".btn-ai-generate");
  const aiPromptInput = row.querySelector(".field-ai-prompt");
  const patternInput = row.querySelector(".field-pattern");
  const placeholderInput = row.querySelector(".field-placeholder");

  aiBtn.addEventListener("click", safe(async () => {
    const prompt = aiPromptInput.value.trim();
    if (!prompt) {
      toast("请输入规则描述", "error");
      return;
    }
    aiBtn.disabled = true;
    aiBtn.textContent = "生成中...";
    try {
      const res = await api("/api/platform/ai/regex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (res.regex) {
        patternInput.value = res.regex;
      }
      let hint = "";
      if (res.placeholder) {
        hint = res.placeholder.startsWith("例如") ? res.placeholder : `例如 ${res.placeholder}`;
      } else {
        hint = res.description || "";
      }
      placeholderInput.value = hint;
      updateRenamePreview();
      toast("AI 生成成功", "ok");
    } catch (err) {
      toast(err.message || "AI 生成失败", "error");
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = "AI 生成";
    }
  }));

  $("#fields").appendChild(row);
}

function setFields(fields) {
  $("#fields").innerHTML = "";
  fields.forEach(addField);
  renderRenameFieldOptions();
  updateRenamePreview();
}

function applyTemplate(template = selectedTemplate()?.template) {
  if (!template) throw new Error("请选择模板");
  setFields(template.fields || defaultFields());
  $("#allowedTypes").value = normalizeAllowedTypes(template.fileRules?.allowedTypes).join(",") || "pdf,doc,docx,jpg,png,zip";
  $("#maxSizeMb").value = template.fileRules?.maxSizeMb || 20;
  $("#maxCount").value = template.fileRules?.maxCount || 1;
  $("#renameTemplate").value = template.renameTemplate || "{name}-{student_id}";
  $("#folderTemplate").value = template.folderTemplate || "{name}-{student_id}";
  updateRenamePreview();
  toast("模板已应用", "ok");
}

function collectFields() {
  return $$(".field-card").map((row) => ({
    label: row.querySelector(".field-label").value.trim(),
    key: row.querySelector(".field-key").value.trim(),
    pattern: row.querySelector(".field-pattern").value.trim(),
    placeholder: row.querySelector(".field-placeholder").value.trim(),
    required: row.querySelector(".field-required").checked,
  }));
}

function fieldSampleValue(field) {
  const key = field.key || "";
  if (key === "name") return "张三";
  if (key === "student_id") {
    return field.label?.includes("考试") ? "2420150508" : "2020240444";
  }
  return field.placeholder || field.label || key || "内容";
}

function renderRenameFieldOptions() {
  const fields = collectFields().filter((field) => field.key);
  const options = [
    ...fields.map((field) => `<option value="${escapeHtml(field.key)}">${escapeHtml(field.label || field.key)}</option>`),
    "<option value=\"original\">原文件名</option>",
    "<option value=\"index\">序号</option>",
  ];
  $$(".rename-field-select").forEach((select) => {
    select.innerHTML = options.join("");
  });
}

function cleanRenderedName(value) {
  return String(value || "file").replace(/[-_ ]{2,}/g, "-").replace(/^[\s\-_.]+|[\s\-_.]+$/g, "") || "file";
}

function renderRenameTemplate(template, sampleData, originalName = "材料.pdf", index = 1, totalCount = 1) {
  const values = { ...sampleData, original: "材料", index: totalCount > 1 ? String(index) : "" };
  const rendered = template.replace(/\{([a-zA-Z0-9_]+)(?:\|(last|first):(\d{1,2}))?\}/g, (_, key, op, rawCount) => {
    const value = String(values[key] || "");
    const count = Number(rawCount || 0);
    if (op === "last") return count > 0 ? value.slice(-count) : "";
    if (op === "first") return count > 0 ? value.slice(0, count) : "";
    return value;
  }).trim();
  const ext = originalName.includes(".") ? originalName.slice(originalName.lastIndexOf(".")) : "";
  return `${cleanRenderedName(rendered)}${ext}`;
}

function updateRenamePreview() {
  const preview = $("#renamePreview");
  const folderPreview = $("#folderPreview");
  if (!preview || !folderPreview) return;
  const fields = collectFields();
  const sampleData = Object.fromEntries(fields.map((field) => [field.key, fieldSampleValue(field)]));
  const template = $("#renameTemplate").value.trim() || "{name}-{student_id}";
  const folderTemplate = $("#folderTemplate").value.trim() || "{name}-{student_id}";
  const firstName = renderRenameTemplate(template, sampleData, "材料.jpg", 1, 3);
  const secondName = renderRenameTemplate(template, sampleData, "材料.jpg", 2, 3);
  const folderName = renderRenameTemplate(folderTemplate, sampleData, "", 1, 1);
  preview.textContent = `文件预览：单文件 ${renderRenameTemplate(template, sampleData)}；多文件 ${firstName}、${secondName}`;
  folderPreview.textContent = `文件夹预览：${folderName}/`;
}

function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  input.focus();
  input.setSelectionRange(start + text.length, start + text.length);
  updateRenamePreview();
}

function renameFieldToken(targetId) {
  const select = document.querySelector(`.rename-field-select[data-target="${targetId}"]`);
  const modeSelect = document.querySelector(`.rename-slice-mode[data-target="${targetId}"]`);
  const countInput = document.querySelector(`.rename-slice-count[data-target="${targetId}"]`);
  const key = select?.value || "";
  const mode = modeSelect?.value || "";
  const count = Math.min(20, Math.max(1, Number(countInput?.value || 2)));
  if (!key) throw new Error("请选择要插入的字段");
  if (mode && key === "index") throw new Error("序号不需要截取位数");
  return mode ? `{${key}|${mode}:${count}}` : `{${key}}`;
}

function editorPayload() {
  const deadlineValue = $("#deadline").value;
  return {
    title: $("#title").value.trim(),
    description: $("#description").value.trim(),
    deadline: deadlineValue ? new Date(deadlineValue).toISOString() : "",
    status: $("#taskStatus").value,
    fields: collectFields(),
    fileRules: {
      allowedTypes: $("#allowedTypes").value.trim(),
      maxSizeMb: $("#maxSizeMb").value,
      maxCount: $("#maxCount").value,
    },
    renameTemplate: $("#renameTemplate").value.trim(),
    folderTemplate: $("#folderTemplate").value.trim(),
    expectedEntries: $("#expectedEntries").value,
    renameExistingFiles: state.mode === "edit" && $("#renameExistingFiles").checked,
  };
}

function templatePayload() {
  const payload = editorPayload();
  return {
    fields: payload.fields,
    fileRules: {
      allowedTypes: normalizeAllowedTypes(payload.fileRules.allowedTypes),
      maxSizeMb: Math.min(100, Number(payload.fileRules.maxSizeMb || 20)),
      maxCount: Number(payload.fileRules.maxCount || 1),
    },
    renameTemplate: payload.renameTemplate,
    folderTemplate: payload.folderTemplate,
  };
}

let currentStep = 1;

function renderRenameTools() {
  const fields = collectFields().filter(f => f.key);
  $$(".dynamic-rename-tokens").forEach(container => {
    container.innerHTML = "";
    const target = container.dataset.target;
    fields.forEach(f => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip rename-token";
      btn.dataset.target = target;
      btn.dataset.token = `{${f.key}}`;
      btn.textContent = f.label || f.key;
      btn.addEventListener("click", () => insertAtCursor($(`#${target}`), `{${f.key}}`));
      container.appendChild(btn);
    });
  });
}

function updateStepNavigation() {
  $$(".step-dot").forEach((dot) => {
    const step = Number(dot.dataset.step);
    dot.classList.toggle("active", step === currentStep);
    dot.classList.toggle("completed", step < currentStep);
  });

  $$(".step-content").forEach((content) => {
    const step = Number(content.dataset.stepContent);
    content.hidden = step !== currentStep;
  });

  $("#prevStep").disabled = currentStep === 1;
  
  if (currentStep === 3) {
    renderRenameTools();
  }
  
  if (currentStep === 4) {
    $("#nextStep").hidden = true;
    $("#saveTask").hidden = false;
    $("#saveTemplate").hidden = false;
  } else {
    $("#nextStep").hidden = false;
    $("#saveTask").hidden = true;
    $("#saveTemplate").hidden = true;
  }
}

function fillEditor(task) {
  currentStep = 1;
  updateStepNavigation();
  $("#editorTitle").textContent = task ? "编辑任务" : "新建任务";
  renderTemplateSelect(state.templateKey);
  $("#title").value = task?.title || "";
  $("#description").value = task?.description || "";
  $("#deadline").value = localDateTime(task?.deadline);
  $("#taskStatus").value = task?.status || "open";
  $("#allowedTypes").value = normalizeAllowedTypes(task?.fileRules?.allowedTypes || defaultTemplate().fileRules.allowedTypes).join(",");
  $("#maxSizeMb").value = task?.fileRules?.maxSizeMb || 20;
  $("#maxCount").value = task?.fileRules?.maxCount || 1;
  $("#renameTemplate").value = task?.renameTemplate || "{name}-{student_id}";
  $("#folderTemplate").value = task?.folderTemplate || "{name}-{student_id}";
  $("#renameExistingFiles").checked = Boolean(task);
  $("#renameExistingFiles").disabled = !task;
  $("#expectedEntries").value = task?.expectedEntries || "";
  setFields(task?.fields?.length ? task.fields : defaultFields());
  updateRenamePreview();
  $("#deleteTask").disabled = !task;
  state.mode = task ? "edit" : "create";
}

function openEditor(task = null) {
  fillEditor(task);
  $("#editorDrawer").classList.add("open");
  $("#editorDrawer").setAttribute("aria-hidden", "false");
  $("#drawerScrim").classList.add("open");
}

function closeEditor() {
  $("#editorDrawer").classList.remove("open");
  $("#editorDrawer").setAttribute("aria-hidden", "true");
  $("#drawerScrim").classList.remove("open");
}

async function saveTask() {
  toast("正在保存...");
  try {
    const payload = editorPayload();
    const path = state.mode === "edit" && state.current ? `/api/tasks/${state.current.id}` : "/api/tasks";
    const method = state.mode === "edit" ? "PATCH" : "POST";
    const task = await api(path, { method, body: JSON.stringify(payload) });
    const renamed = task.renameResult?.renamed || 0;
    const missing = task.renameResult?.missing || 0;
    const renameNote = renamed ? `，已重命名 ${renamed} 个文件` : "";
    const missingNote = missing ? `，${missing} 个文件缺失未处理` : "";
    toast(`${state.mode === "edit" ? "任务已更新" : "任务已创建"}${renameNote}${missingNote}`, "ok");
    await loadTasks();
    await selectTask(task.id);
    closeEditor();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function loadTasks({ silent = false } = {}) {
  if (!silent) $("#taskList").innerHTML = "<p class='muted-pad'>加载任务...</p>";
  try {
    state.tasks = await api("/api/tasks");
    renderTaskList();
  } catch (error) {
    if (!silent) $("#taskList").innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`;
    throw error;
  }
}

async function saveTemplate() {
  if (!state.viewer.isManager) throw new Error("仅文件收集管理器可保存全局模板");
  const name = await promptInApp({
    title: "保存当前模板",
    body: "输入模板名称，保存后会出现在模板下拉列表中。",
    label: "模板名称",
    okText: "保存模板",
  });
  if (!name) return;
  const existing = state.settings.taskTemplates.find((item) => item.name === name);
  let templates = state.settings.taskTemplates;
  if (existing) {
    const ok = await confirmInApp({
      title: "覆盖模板",
      body: `已存在名为「${name}」的模板，是否覆盖？`,
      okText: "覆盖",
      danger: false,
    });
    if (!ok) return;
    templates = templates.filter((item) => item.id !== existing.id);
  }
  const template = {
    id: existing?.id || `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    ...templatePayload(),
  };
  const settings = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({
      taskTemplates: [...templates, template],
    }),
  });
  state.settings = normalizeSettings(settings);
  const savedTemplate = state.settings.taskTemplates.find((item) => item.name === name) || template;
  renderTemplateSelect(`custom:${savedTemplate.id}`);
  toast(`模板「${name}」已保存`, "ok");
}

async function deleteSelectedTemplate() {
  if (!state.viewer.isManager) throw new Error("仅文件收集管理器可删除全局模板");
  const selected = selectedTemplate();
  if (!selected) throw new Error("请选择模板");
  if (selected.builtin) {
    toast("内置模板不能删除", "error");
    return;
  }
  const ok = await confirmInApp({
    title: "删除模板",
    body: `删除自定义模板「${selected.template.name}」？`,
    okText: "删除模板",
  });
  if (!ok) return;
  const templates = state.settings.taskTemplates.filter((item) => item.id !== selected.template.id);
  const settings = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({
      taskTemplates: templates,
    }),
  });
  state.settings = normalizeSettings(settings);
  renderTemplateSelect("builtin:student");
  toast("模板已删除", "ok");
}

function renderTaskList() {
  const query = $("#taskSearch").value.trim().toLowerCase();
  const tasks = state.tasks.filter((task) => `${task.title} ${task.description}`.toLowerCase().includes(query));
  if (!tasks.length) {
    $("#taskList").innerHTML = "<p class='muted-pad'>没有匹配任务。</p>";
    return;
  }
  $("#taskList").innerHTML = tasks.map((task) => {
    const active = state.current?.id === task.id ? " active" : "";
    const creator = state.viewer.isSuperAdmin ? `<small>${escapeHtml(formatCreator(task))}</small>` : "";
    return `
      <button type="button" class="task-card${active}" data-task="${task.id}">
        <span class="status-dot ${task.status}"></span>
        <strong>${escapeHtml(task.title)}</strong>
        <small>${task.status === "open" ? "开放提交" : "停止提交"} · ${task.deadline ? new Date(task.deadline).toLocaleDateString() : "无截止时间"}</small>
        ${creator}
      </button>
    `;
  }).join("");
  $$("[data-task]").forEach((button) => button.addEventListener("click", () => selectTask(Number(button.dataset.task))));
}

async function selectTask(id) {
  try {
    const task = await api(`/api/tasks/${id}`);
    state.current = task;
    state.detail = task;
    renderTaskList();
    renderDetail(task);
    $(".app-sidebar")?.classList.remove("open");
    $("#sidebarScrim")?.classList.remove("open");
  } catch (error) {
    toast(error.message, "error");
  }
}

function clearDashboardSelection() {
  state.current = null;
  state.detail = null;
  $("#activeTitle").textContent = "请选择或新建任务";
  $("#activeMeta").textContent = "任务链接、统计、提交记录和缺交名单会集中显示在这里。";
  $("#dashboard").hidden = true;
  $("#emptyDashboard").hidden = false;
  ["editTask", "copyLink", "showQr", "openFileManager", "exportCsv", "downloadZip"].forEach((id) => $(`#${id}`).disabled = true);
  syncOwnerBindButton(null);
}

async function softRefresh() {
  if (!state.authed || state.softRefreshing) return;
  state.softRefreshing = true;
  try {
    const currentId = state.current?.id;
    await loadTasks({ silent: true });
    if (!currentId) return;
    const latest = await api(`/api/tasks/${currentId}`);
    state.current = latest;
    state.detail = latest;
    renderTaskList();
    renderDetail(latest);
    if ($("#fileDialog").open) renderFileManager();
  } catch (error) {
    if (error.message === "任务不存在") {
      clearDashboardSelection();
      renderTaskList();
      return;
    }
    console.warn("soft refresh failed", error);
  } finally {
    state.softRefreshing = false;
  }
}

function startSoftRefresh() {
  if (state.softRefreshTimer) return;
  state.softRefreshTimer = window.setInterval(softRefresh, 8000);
}

function stopSoftRefresh() {
  if (!state.softRefreshTimer) return;
  window.clearInterval(state.softRefreshTimer);
  state.softRefreshTimer = null;
  state.softRefreshing = false;
}

function fileTotal(task) {
  return task.submissions.reduce((sum, item) => sum + item.files.length, 0);
}

function formatBytes(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function allTaskFiles(task = state.detail) {
  if (!task) return [];
  return task.submissions.flatMap((submission) => {
    const owner = submission.data.name || `#${submission.id}`;
    const identifier = submission.data.student_id || "";
    return submission.files.map((file) => ({
      ...file,
      submissionId: submission.id,
      owner,
      identifier,
      submittedAt: submission.createdAt,
      data: submission.data,
    }));
  });
}

function fileSearchText(file) {
  return `${file.storedName} ${file.originalName} ${file.owner} ${file.identifier} ${JSON.stringify(file.data)}`.toLowerCase();
}

function fileActions(file) {
  return `
    <div class="file-actions">
      <button type="button" data-file-preview="${file.id}">查看</button>
      <button type="button" data-file-download="${file.id}">下载</button>
      <button type="button" class="danger" data-file-delete="${file.id}">删除</button>
    </div>
  `;
}

function renderMetrics(task) {
  const stats = task.stats;
  const inListSubmitted = stats.inListSubmitted ?? stats.submitted;
  const unexpected = stats.unexpected || [];
  const rate = stats.expected ? Math.round((inListSubmitted / stats.expected) * 100) : 0;
  const submittedLabel = stats.expected ? "名单内已提交" : "已提交";
  $("#metrics").innerHTML = `
    <div class="metric"><span>${submittedLabel}</span><b>${inListSubmitted}</b><small>${stats.expected ? `完成率 ${rate}%` : "未设置名单"}</small></div>
    <div class="metric"><span>应提交</span><b>${stats.expected || "-"}</b><small>来自名单行数</small></div>
    <div class="metric"><span>未提交</span><b>${stats.missing.length}</b><small>${stats.missing.length ? "可复制催交通知" : "暂无缺交"}</small></div>
    <div class="metric"><span>名单外</span><b>${unexpected.length}</b><small>${unexpected.length ? unexpected.map(unexpectedLabel).join("、") : "暂无名单外提交"}</small></div>
    <div class="metric"><span>文件数</span><b>${fileTotal(task)}</b><small>已上传文件总数</small></div>
  `;
}

function unexpectedLabel(item) {
  const identity = item.identity || item.name || `#${item.id}`;
  return escapeHtml(identity);
}

function renderRules(task) {
  const rules = task.fileRules;
  const creator = state.viewer.isSuperAdmin ? `<dt>创建者</dt><dd>${escapeHtml(formatCreator(task))}</dd>` : "";
  $("#ruleList").innerHTML = `
    <dt>字段</dt><dd>${task.fields.map((field) => escapeHtml(field.label)).join("、")}</dd>
    <dt>文件类型</dt><dd>${normalizeAllowedTypes(rules.allowedTypes).join(", ") || "不限"}</dd>
    <dt>大小/数量</dt><dd>${rules.maxSizeMb} MB · 最多 ${rules.maxCount} 个</dd>
    <dt>文件命名</dt><dd>${escapeHtml(task.renameTemplate)}</dd>
    <dt>文件夹</dt><dd>${escapeHtml(task.folderTemplate || "{name}-{student_id}")}</dd>
    <dt>截止</dt><dd>${task.deadline ? new Date(task.deadline).toLocaleString() : "未设置"}</dd>
    ${creator}
  `;
}

function renderMissing(task) {
  const missing = task.stats.missing;
  $("#copyMissing").disabled = !missing.length;
  $("#missingList").innerHTML = missing.length
    ? missing.map((item) => `<span>${escapeHtml(item)}</span>`).join("")
    : "<p class='muted-pad compact'>没有缺交记录。</p>";
}

function renderUnexpected(task) {
  const unexpected = task.stats.unexpected || [];
  $("#unexpectedList").innerHTML = unexpected.length
    ? unexpected.map((item) => `<span>${unexpectedLabel(item)}</span>`).join("")
    : "<p class='muted-pad compact'>没有名单外提交。</p>";
}

function renderDetail(task) {
  $("#emptyDashboard").hidden = true;
  $("#dashboard").hidden = false;
  $("#activeTitle").textContent = task.title;
  const metaParts = [
    task.status === "open" ? "开放提交" : "停止提交",
    task.deadline ? `截止 ${new Date(task.deadline).toLocaleString()}` : "未设置截止时间",
  ];
  if (state.viewer.isSuperAdmin) metaParts.push(`创建者 ${formatCreator(task)}`);
  $("#activeMeta").textContent = metaParts.join(" · ");
  $("#shareLink").value = absoluteSubmitUrl(task);
  $("#statusLink").value = absoluteStatusUrl(task);
  ["editTask", "copyLink", "showQr", "openFileManager", "exportCsv", "downloadZip"].forEach((id) => $(`#${id}`).disabled = false);
  syncOwnerBindButton(task);
  renderMetrics(task);
  renderRules(task);
  renderMissing(task);
  renderUnexpected(task);
  renderSubmissionTable();
}

async function searchAssignableUsers(query) {
  const params = new URLSearchParams({ q: query, size: "8" });
  return api(`/api/platform/users?${params.toString()}`);
}

function formatAssignableUser(user) {
  const displayName = user.displayName || user.username || "未命名用户";
  return user.username && user.username !== displayName
    ? `${displayName}（${user.username}）`
    : displayName;
}

async function bindTaskOwner() {
  if (!state.viewer.isSuperAdmin) throw new Error("仅超级管理员可绑定创建者");
  const task = state.current;
  if (!task) throw new Error("请先选择任务");
  const keyword = await promptInApp({
    title: task.createdBy?.userId ? "更改创建者" : "绑定旧任务创建者",
    body: "输入平台用户名，或输入能唯一匹配的昵称。系统只会匹配有文件收集管理权限的账号。",
    label: "平台用户名",
    value: task.createdBy?.username || "",
    okText: "继续",
  });
  if (!keyword) return;
  const users = await searchAssignableUsers(keyword);
  const normalized = keyword.trim().toLowerCase();
  const exactUsername = users.find((item) => item.username.toLowerCase() === normalized);
  const exactDisplay = users.filter((item) => (item.displayName || "").trim().toLowerCase() === normalized);
  const target = exactUsername || (exactDisplay.length === 1 ? exactDisplay[0] : null) || (users.length === 1 ? users[0] : null);
  if (!target) {
    if (!users.length) throw new Error("未找到可绑定的文件收集管理员");
    throw new Error(`匹配到多个账号：${users.slice(0, 5).map(formatAssignableUser).join("、")}。请输入更精确的用户名。`);
  }
  const ok = await confirmInApp({
    title: task.createdBy?.userId ? "确认更改创建者" : "确认绑定创建者",
    body: `将任务「${task.title}」${task.createdBy?.userId ? "改绑" : "绑定"}给「${formatAssignableUser(target)}」？`,
    okText: task.createdBy?.userId ? "确认改绑" : "确认绑定",
    danger: false,
  });
  if (!ok) return;
  const updated = await api(`/api/tasks/${task.id}/owner`, {
    method: "PATCH",
    body: JSON.stringify({
      userId: target.userId,
      username: target.username,
      displayName: target.displayName,
    }),
  });
  state.current = updated;
  state.detail = updated;
  await loadTasks({ silent: true });
  renderTaskList();
  renderDetail(updated);
  toast(task.createdBy?.userId ? "创建者已更新" : "创建者已绑定", "ok");
}

function filteredSubmissions() {
  if (!state.detail) return [];
  const query = $("#submissionSearch").value.trim().toLowerCase();
  return state.detail.submissions.filter((item) => {
    const blob = `${JSON.stringify(item.data)} ${item.files.map((file) => file.storedName).join(" ")}`.toLowerCase();
    return !query || blob.includes(query);
  });
}

function renderSubmissionTable() {
  const task = state.detail;
  if (!task) return;
  const rows = filteredSubmissions();
  const fields = task.fields;
  if (!rows.length) {
    $("#submissionTable").innerHTML = `
      <div class="table-empty">
        <strong>${task.submissions.length ? "没有匹配结果" : "暂无提交"}</strong>
        <span>${task.submissions.length ? "换个关键词再试。" : "提交者上传后会自动出现在这里。"}</span>
      </div>
    `;
    return;
  }
  $("#submissionTable").innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>提交人</th>
            ${fields.filter((field) => field.key !== "name").map((field) => `<th>${escapeHtml(field.label)}</th>`).join("")}
            <th>文件</th>
            <th>提交时间</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((item) => `
            <tr>
              <td><strong>${escapeHtml(item.data.name || `#${item.id}`)}</strong><span class="cell-sub">IP ${escapeHtml(item.ip)}</span></td>
              ${fields.filter((field) => field.key !== "name").map((field) => `<td>${escapeHtml(item.data[field.key] || "")}</td>`).join("")}
              <td class="file-cell">${item.files.map((file) => `
                <div class="file-row">
                  <div>
                    <strong>${escapeHtml(file.storedName)}</strong>
                    <span class="cell-sub">${escapeHtml(file.originalName)} · ${formatBytes(file.size)}</span>
                  </div>
                  ${fileActions(file)}
                </div>
              `).join("")}</td>
              <td>${new Date(item.createdAt).toLocaleString()}</td>
              <td><button type="button" class="icon-button danger" data-delete="${item.id}" title="删除">×</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
  $$("[data-delete]").forEach((button) => {
    button.addEventListener("click", safe(() => deleteSubmission(button.dataset.delete)));
  });
  bindFileActionButtons();
}

function bindFileActionButtons() {
  $$("[data-file-preview]").forEach((button) => {
    button.onclick = safe(() => previewFile(button.dataset.filePreview));
  });
  $$("[data-file-download]").forEach((button) => {
    button.onclick = safe(() => downloadFile(button.dataset.fileDownload));
  });
  $$("[data-file-delete]").forEach((button) => {
    button.onclick = safe(() => deleteFile(button.dataset.fileDelete));
  });
}

function filenameFromDisposition(disposition = "") {
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const basicMatch = disposition.match(/filename="([^"]+)"/i);
  return basicMatch ? basicMatch[1] : "";
}

async function fetchProtectedBlob(path) {
  const response = await fetch(path, { credentials: "same-origin", headers: authHeaders() });
  if (response.status === 401) {
    setAuthed(false);
    throw new Error("登录已过期，请重新登录");
  }
  if (!response.ok) {
    let message = "文件读取失败";
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      // ignore non-json errors
    }
    throw new Error(message);
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("Content-Disposition") || ""),
    type: response.headers.get("Content-Type") || "",
  };
}

async function fetchFileAccess(id, action) {
  return api(`/api/files/${id}/access?action=${encodeURIComponent(action)}`);
}

function openDirectFileUrl(url, targetWindow = null) {
  if (targetWindow) {
    targetWindow.location.replace(url);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function triggerDirectDownload(url, filename) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  if (filename) anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function previewFile(id) {
  const previewWindow = window.open("about:blank", "_blank");
  if (previewWindow) {
    previewWindow.opener = null;
    previewWindow.document.write("<title>正在加载文件...</title><p style='font-family:sans-serif;padding:16px'>正在加载文件...</p>");
    previewWindow.document.close();
  }
  try {
    const access = await fetchFileAccess(id, "preview");
    if (access.url) {
      openDirectFileUrl(access.url, previewWindow);
      return;
    }
    if (access.previewMessage) {
      if (previewWindow && !previewWindow.closed) previewWindow.close();
      throw new Error(access.previewMessage);
    }
    const { blob, type } = await fetchProtectedBlob(`/api/files/${id}/preview`);
    const objectUrl = URL.createObjectURL(type ? blob.slice(0, blob.size, type) : blob);
    if (previewWindow) {
      previewWindow.location.replace(objectUrl);
    } else {
      window.open(objectUrl, "_blank", "noopener,noreferrer");
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    if (previewWindow && !previewWindow.closed) previewWindow.close();
    throw error;
  }
}

async function downloadFile(id) {
  toast("正在获取下载链接...");
  const access = await fetchFileAccess(id, "download");
  if (access.backend === "onedrive-cn" && access.url) {
    triggerDirectDownload(access.url, access.filename);
    toast("已向浏览器发起下载，请查看下载列表", "ok");
    return;
  }
  toast("正在读取文件...");
  const { blob, filename } = await fetchProtectedBlob(`/api/files/${id}/download`);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || `file-${id}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  toast("已向浏览器发起下载，请查看下载列表", "ok");
}

async function deleteFile(id) {
  const ok = await confirmInApp({
    title: "删除文件",
    body: "提交记录会保留，但该文件会从服务器移除。",
    okText: "删除文件",
  });
  if (!ok) return;
  await api(`/api/files/${id}`, { method: "DELETE" });
  await selectTask(state.current.id);
  if ($("#fileDialog").open) renderFileManager();
  toast("文件已删除", "ok");
}

function openFileManager() {
  if (!state.detail) return;
  $("#fileSearch").value = "";
  renderFileManager();
  $("#fileDialog").showModal();
}

function renderFileManager() {
  const files = allTaskFiles();
  const query = $("#fileSearch").value.trim().toLowerCase();
  const filtered = files.filter((file) => !query || fileSearchText(file).includes(query));
  $("#fileDialogMeta").textContent = `${state.detail.title} · 共 ${files.length} 个文件`;
  if (!filtered.length) {
    $("#fileManager").innerHTML = `
      <div class="table-empty">
        <strong>${files.length ? "没有匹配文件" : "暂无文件"}</strong>
        <span>${files.length ? "换个关键词再试。" : "提交者上传后会出现在这里。"}</span>
      </div>
    `;
    return;
  }
  $("#fileManager").innerHTML = `
    <div class="file-manager-list">
      ${filtered.map((file) => `
        <article class="file-card" data-file-card="${file.id}">
          <div>
            <strong>${escapeHtml(file.storedName)}</strong>
            <span>${escapeHtml(file.originalName)} · ${formatBytes(file.size)}</span>
          </div>
          <dl>
            <dt>提交人</dt><dd>${escapeHtml(file.owner)}</dd>
            <dt>编号</dt><dd>${escapeHtml(file.identifier || "-")}</dd>
            <dt>时间</dt><dd>${new Date(file.submittedAt).toLocaleString()}</dd>
          </dl>
          ${fileActions(file)}
        </article>
      `).join("")}
    </div>
  `;
  bindFileActionButtons();
}

async function deleteSubmission(id) {
  const ok = await confirmInApp({
    title: "删除提交记录",
    body: "这会同时删除该提交记录下的所有文件。",
    okText: "删除提交",
  });
  if (!ok) return;
  await api(`/api/submissions/${id}`, { method: "DELETE" });
  await selectTask(state.current.id);
  toast("提交记录已删除", "ok");
}

async function deleteTask() {
  if (!state.current) return;
  const ok = await confirmInApp({
    title: "删除任务",
    body: `删除任务「${state.current.title}」及所有提交文件？此操作不可恢复。`,
    okText: "删除任务",
  });
  if (!ok) return;
  await api(`/api/tasks/${state.current.id}`, { method: "DELETE" });
  clearDashboardSelection();
  await loadTasks();
  closeEditor();
  toast("任务已删除", "ok");
}

async function download(path, filename) {
  const response = await fetch(path, { credentials: "same-origin", headers: authHeaders() });
  if (response.status === 401) {
    setAuthed(false);
    throw new Error("登录已过期，请重新登录");
  }
  if (!response.ok) throw new Error("下载失败");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function zipSafePathSegment(value) {
  return cleanRenderedName(String(value || "file").replace(/[\\/:*?"<>|]+/g, "_"));
}

function renderTemplateBase(template, data = {}, originalName = "", index = 1, totalCount = 1) {
  const original = originalName.includes(".") ? originalName.slice(0, originalName.lastIndexOf(".")) : originalName;
  const values = {
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, zipSafePathSegment(value)])),
    index: totalCount > 1 ? String(index) : "",
    original: zipSafePathSegment(original),
  };
  const rendered = String(template || "{name}-{student_id}").replace(/\{([a-zA-Z0-9_]+)(?:\|(last|first):(\d{1,2}))?\}/g, (_, key, op, rawCount) => {
    const value = String(values[key] || "");
    const count = Number(rawCount || 0);
    if (op === "last") return count > 0 ? value.slice(-count) : "";
    if (op === "first") return count > 0 ? value.slice(0, count) : "";
    return value;
  });
  return zipSafePathSegment(rendered);
}

function zipEntryPath(task, submission, file) {
  if (submission.files.length <= 1) return zipSafePathSegment(file.storedName);
  const folder = renderTemplateBase(task.folderTemplate || "{name}-{student_id}", submission.data);
  return `${folder}/${zipSafePathSegment(file.storedName)}`;
}

function uniqueZipPath(path, used) {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? `${path.slice(0, slash + 1)}` : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  let next = `${dir}${stem}-${index}${ext}`;
  while (used.has(next)) {
    index += 1;
    next = `${dir}${stem}-${index}${ext}`;
  }
  used.add(next);
  return next;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zipHeader(fields) {
  const bytes = new Uint8Array(fields.reduce((sum, item) => sum + item[1], 0));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const [value, size] of fields) {
    if (size === 2) view.setUint16(offset, value, true);
    if (size === 4) view.setUint32(offset, value, true);
    offset += size;
  }
  return bytes;
}

function buildZip(entries) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const data = entry.bytes;
    const crc = crc32(data);
    const { time, day } = dosDateTime(entry.date);
    const local = zipHeader([
      [0x04034b50, 4], [20, 2], [0x0800, 2], [0, 2], [time, 2], [day, 2],
      [crc, 4], [data.length, 4], [data.length, 4], [name.length, 2], [0, 2],
    ]);
    parts.push(local, name, data);

    const centralHeader = zipHeader([
      [0x02014b50, 4], [20, 2], [20, 2], [0x0800, 2], [0, 2], [time, 2], [day, 2],
      [crc, 4], [data.length, 4], [data.length, 4], [name.length, 2], [0, 2],
      [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4],
    ]);
    central.push(centralHeader, name);
    offset += local.length + name.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = zipHeader([
    [0x06054b50, 4], [0, 2], [0, 2], [entries.length, 2], [entries.length, 2],
    [centralSize, 4], [offset, 4], [0, 2],
  ]);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

async function downloadClientZip() {
  const task = state.detail;
  if (!task) throw new Error("请先选择任务");
  const fileCount = fileTotal(task);
  if (!fileCount) throw new Error("当前任务还没有可下载的文件");

  const entries = [];
  const usedPaths = new Set();
  let current = 0;
  toast(`正在读取文件 0/${fileCount}`);
  for (const submission of task.submissions) {
    for (const file of submission.files) {
      current += 1;
      toast(`正在读取文件 ${current}/${fileCount}`);
      const response = await fetch(`/api/files/${file.id}/download`, { credentials: "same-origin", headers: authHeaders() });
      if (response.status === 401) {
        setAuthed(false);
        throw new Error("登录已过期，请重新登录");
      }
      if (!response.ok) throw new Error(`读取文件失败：${file.storedName}`);
      entries.push({
        path: uniqueZipPath(zipEntryPath(task, submission, file), usedPaths),
        bytes: new Uint8Array(await response.arrayBuffer()),
        date: new Date(submission.createdAt || Date.now()),
      });
    }
  }

  toast("正在浏览器中生成 ZIP");
  const blob = buildZip(entries);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${zipSafePathSegment(task.title)}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  toast("ZIP 已生成", "ok");
}

async function copyText(text, done = "已复制") {
  if (!text) throw new Error("没有可复制的内容");
  if (!navigator.clipboard) throw new Error("当前浏览器不允许访问剪贴板");
  await navigator.clipboard.writeText(text);
  toast(done, "ok");
}

function bind() {
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#loginMessage").textContent = "正在登录...";
    $("#loginMessage").className = "message";
    try {
      await login($("#loginPassword").value);
      $("#loginPassword").value = "";
      $("#loginMessage").textContent = "";
    } catch (error) {
      $("#loginMessage").textContent = error.message;
      $("#loginMessage").className = "message error";
    }
  });
  $("#newTask").addEventListener("click", safe(() => openEditor(null)));
  $("#emptyNewTask").addEventListener("click", safe(() => openEditor(null)));
  $("#editTask").addEventListener("click", safe(() => openEditor(state.current)));
  $("#bindTaskOwner").addEventListener("click", safe(bindTaskOwner));
  $("#closeEditor").addEventListener("click", closeEditor);
  $("#drawerScrim").addEventListener("click", closeEditor);
  $("#taskSearch").addEventListener("input", renderTaskList);
  $("#submissionSearch").addEventListener("input", renderSubmissionTable);
  $("#addField").addEventListener("click", safe(() => addField({ required: true })));
  $("#fields").addEventListener("input", () => {
    renderRenameFieldOptions();
    updateRenamePreview();
  });
  $("#renameTemplate").addEventListener("input", updateRenamePreview);
  $("#folderTemplate").addEventListener("input", updateRenamePreview);
  $$(".static-rename-token").forEach((button) => {
    button.addEventListener("click", () => insertAtCursor($(`#${button.dataset.target}`), button.dataset.token || ""));
  });
  $$(".insert-rename-field").forEach((button) => {
    button.addEventListener("click", safe(() => insertAtCursor($(`#${button.dataset.target}`), renameFieldToken(button.dataset.target))));
  });
  $$(".reset-rename-template").forEach((button) => {
    button.addEventListener("click", () => {
      const fields = collectFields().filter(f => f.key);
      let defaultTpl = "{original}";
      if (fields.length >= 2) {
        defaultTpl = `{${fields[0].key}}-{${fields[1].key}}`;
      } else if (fields.length === 1) {
        defaultTpl = `{${fields[0].key}}`;
      }
      $(`#${button.dataset.target}`).value = defaultTpl;
      updateRenamePreview();
    });
  });
  $("#templateSelect").addEventListener("change", () => {
    state.templateKey = $("#templateSelect").value;
    syncTemplateActions();
  });
  $("#applyTemplate").addEventListener("click", safe(() => applyTemplate()));
  $("#deleteTemplate").addEventListener("click", safe(deleteSelectedTemplate));
  $("#saveTask").addEventListener("click", safe(saveTask));
  $("#saveTemplate").addEventListener("click", safe(saveTemplate));
  const resetEditor = $("#resetEditor");
  if (resetEditor) {
    resetEditor.addEventListener("click", safe(() => fillEditor(state.mode === "edit" ? state.current : null)));
  }
  $("#deleteTask").addEventListener("click", safe(deleteTask));
  $("#copyLink").addEventListener("click", safe(() => copyText(absoluteSubmitUrl(state.current), "提交链接已复制")));
  $("#copyLinkInline").addEventListener("click", safe(() => copyText(absoluteSubmitUrl(state.current), "提交链接已复制")));
  $("#copyStatusLink").addEventListener("click", safe(() => copyText(absoluteStatusUrl(state.current), "成功名单链接已复制")));
  $("#copyMissing").addEventListener("click", safe(() => copyText(state.detail.stats.missing.join("\n"), "缺交名单已复制")));
  $("#showQr").addEventListener("click", safe(() => {
    const url = absoluteSubmitUrl(state.current);
    if (!url) throw new Error("请先选择任务");
    $("#qrImage").src = qrCodeImageUrl(url);
    $("#qrLink").textContent = url;
    $("#qrDialog").showModal();
  }));
  $("#closeQr").addEventListener("click", () => $("#qrDialog").close());
  $("#openFileManager").addEventListener("click", safe(openFileManager));
  $("#openFileManagerInline").addEventListener("click", safe(openFileManager));
  $("#closeFileDialog").addEventListener("click", () => $("#fileDialog").close());
  $("#fileSearch").addEventListener("input", renderFileManager);
  $("#exportCsv").addEventListener("click", safe(() => download(`/api/tasks/${state.current.id}/export.csv`, `${state.current.title}.csv`)));
  $("#downloadZip").addEventListener("click", safe(downloadClientZip));

  // Wizard Navigation
  $("#prevStep").addEventListener("click", () => {
    if (currentStep > 1) {
      currentStep -= 1;
      updateStepNavigation();
    }
  });
  $("#nextStep").addEventListener("click", () => {
    if (currentStep === 1) {
      if (!$("#title").value.trim()) {
        toast("请填写任务标题", "error");
        $("#title").focus();
        return;
      }
    }
    if (currentStep === 2) {
      const fields = collectFields();
      if (!fields.length) {
        toast("请至少添加一个表单字段", "error");
        return;
      }
      if (fields.some(f => !f.label || !f.key)) {
        toast("字段名称和 Key 不能为空", "error");
        return;
      }
    }
    if (currentStep < 4) {
      currentStep += 1;
      updateStepNavigation();
    }
  });
  $$(".step-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      const targetStep = Number(dot.dataset.step);
      if (targetStep > currentStep) {
        if (currentStep === 1 || targetStep > 1) {
          if (!$("#title").value.trim()) {
            toast("请填写任务标题", "error");
            return;
          }
        }
        if (currentStep === 2 || targetStep > 2) {
          const fields = collectFields();
          if (!fields.length || fields.some(f => !f.label || !f.key)) {
            toast("请配置正确的表单字段", "error");
            return;
          }
        }
      }
      currentStep = targetStep;
      updateStepNavigation();
    });
  });

  // Mobile sidebar toggle
  const toggleSidebar = $("#toggleSidebar");
  const closeSidebar = $("#closeSidebar");
  const sidebarScrim = $("#sidebarScrim");
  const sidebar = $(".app-sidebar");

  if (toggleSidebar) {
    toggleSidebar.addEventListener("click", () => {
      sidebar.classList.add("open");
      sidebarScrim.classList.add("open");
    });
  }
  if (closeSidebar) {
    closeSidebar.addEventListener("click", () => {
      sidebar.classList.remove("open");
      sidebarScrim.classList.remove("open");
    });
  }
  if (sidebarScrim) {
    sidebarScrim.addEventListener("click", () => {
      sidebar.classList.remove("open");
      sidebarScrim.classList.remove("open");
    });
  }
}

fillEditor(null);
bind();
loadSiteFooter();
checkSession();
