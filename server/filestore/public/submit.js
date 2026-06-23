const token = location.pathname.split("/").pop();
let task = null;
let selectedFiles = [];
const SITE_TITLE_DEFAULT = "药大拾间文件收集";
let draggedFileId = null;
let successReset = false;

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function applySiteFooter(config = {}) {
  const filingNumber = String(config.siteFilingNumber || "").trim();
  document.querySelectorAll("[data-filing-link]").forEach((node) => {
    node.hidden = !filingNumber;
    node.textContent = filingNumber;
  });
}

async function loadSiteFooter() {
  try {
    const response = await fetch("/api/platform/site-config");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "备案信息加载失败");
    applySiteFooter(payload);
  } catch {
    applySiteFooter({});
  }
}

function message(text, type = "") {
  const node = $("#submitMessage");
  node.textContent = text;
  node.className = `message submit-form ${type}`;
}

function showStatusShortcut() {
  const node = $("#statusShortcut");
  node.hidden = false;
  node.innerHTML = `
    <a href="/status/${encodeURIComponent(token)}">
      查看提交成功名单
      <span>确认自己是否提交成功，以及提交了哪些文件。</span>
    </a>
  `;
}

function showSuccessDialog(payload) {
  const dialog = $("#successDialog");
  const files = Array.isArray(payload.files) ? payload.files : [];
  $("#successSummary").textContent = `提交编号 ${payload.submissionId}`;
  $("#successFiles").innerHTML = files.length
    ? files.map((file) => `<span>${escapeHtml(file)}</span>`).join("")
    : "<span>文件已成功上传</span>";
  $("#successStatusLink").href = `/status/${encodeURIComponent(token)}`;
  dialog.showModal();
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function fileKey(file) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function fileExt(fileName) {
  return fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
}

function originalStem(fileName) {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function safeFileName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 140) || "file";
}

function cleanRenderedName(value) {
  return safeFileName(value)
    .replace(/[-_ ]{2,}/g, "-")
    .replace(/^[\s\-_.]+|[\s\-_.]+$/g, "") || "file";
}

function currentData() {
  const data = {};
  task.fields.forEach((field) => {
    const input = document.querySelector(`[name="${CSS.escape(field.key)}"]`);
    data[field.key] = input?.value.trim() || field.label || "";
  });
  return data;
}

function submissionFolderName() {
  const data = currentData();
  const template = task.folderTemplate || "{name}-{student_id}";
  const values = {
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, safeFileName(value)])),
    index: "",
    original: "",
  };
  const rendered = template.replace(/\{([a-zA-Z0-9_]+)(?:\|(last|first):(\d{1,2}))?\}/g, (_, key, op, rawCount) => {
    const value = String(values[key] || "");
    const count = Number(rawCount || 0);
    if (op === "last") return count > 0 ? value.slice(-count) : "";
    if (op === "first") return count > 0 ? value.slice(0, count) : "";
    return value;
  });
  return cleanRenderedName(rendered || "提交文件");
}

function renamedFileName(file, index, totalCount = 1) {
  const template = task.renameTemplate || "{name}-{student_id}";
  const data = currentData();
  const values = {
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, safeFileName(value)])),
    index: totalCount > 1 ? String(index) : "",
    original: safeFileName(originalStem(file.name)),
  };
  const rendered = template.replace(/\{([a-zA-Z0-9_]+)(?:\|(last|first):(\d{1,2}))?\}/g, (_, key, op, rawCount) => {
    const value = String(values[key] || "");
    const count = Number(rawCount || 0);
    if (op === "last") return count > 0 ? value.slice(-count) : "";
    if (op === "first") return count > 0 ? value.slice(0, count) : "";
    return value;
  });
  let base = cleanRenderedName(rendered);
  if (totalCount > 1 && !template.includes("{index}")) base = `${base}-${index}`;
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  return `${base}${ext}`;
}

function savedPathPreview(file, index, totalCount) {
  const name = renamedFileName(file, index, totalCount);
  return totalCount > 1 ? `${submissionFolderName()}/${name}` : name;
}

function submitDescription() {
  const fields = (task.fields || []).slice(0, 2).map(f => f.label || f.key);
  const identifier = fields.length > 0 ? fields.join("和") : "身份信息";
  const updateTip = `如果提交后发现文件或信息有误，请使用相同的${identifier}重新提交，系统会自动用新提交覆盖旧提交。`;
  if (!task.description) return `请按要求填写信息并上传文件。\n${updateTip}`;
  return `${task.description}\n\n${updateTip}`;
}

function fileIcon(file) {
  const ext = fileExt(file.name);
  if (file.type.startsWith("image/")) return "IMG";
  if (ext === "pdf") return "PDF";
  if (["doc", "docx"].includes(ext)) return "W";
  if (["ppt", "pptx"].includes(ext)) return "P";
  if (["xls", "xlsx", "csv"].includes(ext)) return "X";
  if (["zip", "rar", "7z"].includes(ext)) return "ZIP";
  return ext ? ext.slice(0, 4).toUpperCase() : "FILE";
}

function moveFile(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= selectedFiles.length || fromIndex === toIndex) return;
  const [item] = selectedFiles.splice(fromIndex, 1);
  selectedFiles.splice(toIndex, 0, item);
  renderFileQueue();
}

function removeFile(id) {
  const item = selectedFiles.find((entry) => entry.id === id);
  if (item?.url) URL.revokeObjectURL(item.url);
  selectedFiles = selectedFiles.filter((entry) => entry.id !== id);
  renderFileQueue();
}

function renderFileQueue() {
  const queue = $("#fileQueue");
  queue.hidden = !selectedFiles.length;
  if (!selectedFiles.length) {
    queue.innerHTML = "";
    return;
  }

  queue.innerHTML = `
    <div class="submit-file-head">
      <strong>已选择 ${selectedFiles.length} 个文件</strong>
      <span>拖动卡片可调整顺序，系统会按当前顺序上传并命名。</span>
    </div>
    <div class="submit-file-grid">
      ${selectedFiles.map((item, index) => {
        const file = item.file;
        const isImage = file.type.startsWith("image/");
        const renamed = savedPathPreview(file, index + 1, selectedFiles.length);
        return `
          <article class="submit-file-card" draggable="true" data-file-id="${escapeHtml(item.id)}">
            <div class="submit-file-title">
              <span class="file-type-badge">${escapeHtml(fileIcon(file))}</span>
              <strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong>
            </div>
            <button class="submit-file-remove" type="button" data-action="remove" data-file-id="${escapeHtml(item.id)}" title="删除">×</button>
            <div class="submit-file-preview">
              ${isImage ? `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(file.name)}">` : `<span class="submit-file-icon">${escapeHtml(fileIcon(file))}</span>`}
            </div>
            <dl class="submit-file-meta">
              <dt>顺序</dt><dd>${index + 1}</dd>
              <dt>大小</dt><dd>${formatBytes(file.size)}</dd>
              <dt>将保存为</dt><dd title="${escapeHtml(renamed)}">${escapeHtml(renamed)}</dd>
            </dl>
            <div class="submit-file-actions">
              <button type="button" data-action="up" data-file-id="${escapeHtml(item.id)}" ${index === 0 ? "disabled" : ""}>上移</button>
              <button type="button" data-action="down" data-file-id="${escapeHtml(item.id)}" ${index === selectedFiles.length - 1 ? "disabled" : ""}>下移</button>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function addFiles(files) {
  const known = new Set(selectedFiles.map((item) => fileKey(item.file)));
  const additions = files
    .filter((file) => !known.has(fileKey(file)))
    .map((file) => ({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      file,
      url: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
    }));
  selectedFiles = [...selectedFiles, ...additions];
  renderFileQueue();
}

function clearFiles() {
  selectedFiles.forEach((item) => {
    if (item.url) URL.revokeObjectURL(item.url);
  });
  selectedFiles = [];
  $("#files").value = "";
  renderFileQueue();
}

function renderTask() {
  const isClosed = task.status !== "open";
  document.title = `${task.siteTitle || SITE_TITLE_DEFAULT} - ${task.title}`;
  $("#submitHeader").innerHTML = `
    <p class="eyebrow">${isClosed ? "药大拾间 · 已停止提交" : "药大拾间 · 文件提交"}</p>
    <h1>${escapeHtml(task.title)}</h1>
    <p>${escapeHtml(submitDescription()).replaceAll("\n", "<br>")}</p>
    ${task.deadline ? `<p class="hint hero-deadline">截止时间：${new Date(task.deadline).toLocaleString()}</p>` : ""}
  `;
  showStatusShortcut();

  if (isClosed) {
    message("该任务已停止提交。", "error");
    return;
  }

  $("#dynamicFields").innerHTML = task.fields.map((field) => `
    <label>${escapeHtml(field.label)}
      <input
        name="${escapeHtml(field.key)}"
        placeholder="${escapeHtml(field.placeholder || "")}"
        ${field.required ? "required" : ""}
        ${field.pattern ? `pattern="${escapeHtml(field.pattern)}"` : ""}
      >
    </label>
  `).join("");
  const rules = task.fileRules;
  $("#files").setAttribute("accept", rules.allowedTypes.map((item) => `.${item}`).join(","));
  $("#fileRules").textContent = `允许 ${rules.allowedTypes.join(", ") || "任意类型"}；单文件不超过 ${rules.maxSizeMb} MB；最多 ${rules.maxCount} 个。`;
  $("#submitForm").hidden = false;
}

async function loadTask() {
  try {
    const response = await fetch(`/api/public/tasks/${token}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "任务加载失败");
    task = payload;
    renderTask();
  } catch (error) {
    $("#submitHeader").innerHTML = `<p class="eyebrow">药大拾间 · 访问异常</p><h1>无法提交</h1><p>${escapeHtml(error.message)}</p>`;
  }
}

function validateFiles(files) {
  const rules = task.fileRules;
  if (!files.length) return "请上传文件";
  if (files.length > Number(rules.maxCount)) return `最多只能上传 ${rules.maxCount} 个文件`;
  const allowed = new Set(rules.allowedTypes);
  const maxBytes = Number(rules.maxSizeMb) * 1024 * 1024;
  for (const file of files) {
    const ext = fileExt(file.name);
    if (allowed.size && !allowed.has(ext)) return `${file.name} 类型不允许`;
    if (file.size > maxBytes) return `${file.name} 超过大小限制`;
  }
  return "";
}

function directUploadThresholdBytes() {
  return Math.max(0, Number(task.remoteUpload?.minSizeBytes || 0));
}

function shouldUseFileDirectUpload(file) {
  if (!task.remoteUpload?.enabled) return false;
  const threshold = directUploadThresholdBytes();
  if (threshold <= 0) return true;
  return file.size >= threshold;
}

function shouldUseDirectUpload(files) {
  return files.some((file) => shouldUseFileDirectUpload(file));
}

function applySubmitSuccess(form, payload) {
  successReset = true;
  form.reset();
  clearFiles();
  $("#progress").value = 100;
  message(`提交成功，编号 ${payload.submissionId}。文件：${payload.files.join("、")}`, "ok");
  showSuccessDialog(payload);
}

function responseErrorMessage(payload, fallback = "提交失败") {
  if (Array.isArray(payload?.details) && payload.details.length) return payload.details.join("；");
  return payload?.error || fallback;
}

async function readJsonResponse(response, fallback = "请求失败") {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(responseErrorMessage(payload, fallback));
  return payload;
}

function renderOverwriteFileList(files = []) {
  if (!files.length) return "<span>旧提交没有可显示的文件名</span>";
  return files.map((file) => `<span>${escapeHtml(file)}</span>`).join("");
}

function askOverwriteSubmission(payload) {
  return new Promise((resolve) => {
    const dialog = $("#overwriteDialog");
    const submission = payload.submission || {};
    const label = payload.identityLabel || "身份信息";
    const identity = payload.identity || "";
    const createdAt = submission.createdAt ? new Date(submission.createdAt).toLocaleString() : "";
    $("#overwriteSummary").textContent = `${label}“${identity}”已经提交过${createdAt ? `，提交时间 ${createdAt}` : ""}。`;
    $("#overwriteFiles").innerHTML = renderOverwriteFileList(submission.files || []);

    const cleanup = (value) => {
      $("#confirmOverwrite").removeEventListener("click", onConfirm);
      $("#cancelOverwrite").removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onConfirm = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onClose = () => cleanup(false);

    $("#confirmOverwrite").addEventListener("click", onConfirm);
    $("#cancelOverwrite").addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}

async function confirmOverwriteIfNeeded() {
  message("正在检查是否已有提交...");
  const response = await fetch(`/api/submit/${token}/check-duplicate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: currentData() }),
  });
  const payload = await readJsonResponse(response, "检查已有提交失败");
  if (!payload.exists) {
    message("");
    return false;
  }
  const confirmed = await askOverwriteSubmission(payload);
  if (!confirmed) {
    message("已取消提交。", "warn");
    return null;
  }
  return true;
}

async function prepareRemoteSubmission(files, overwrite) {
  const response = await fetch(`/api/submit/${token}/prepare-remote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: currentData(),
      overwrite,
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
      })),
    }),
  });
  return readJsonResponse(response, "创建直传会话失败");
}

async function uploadFileToSession(file, uploadFile, onProgress) {
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

async function completeRemoteSubmission(submissionId, remoteFileIds, localEntries, onLocalProgress, overwrite) {
  if (localEntries.length) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("submissionId", String(submissionId));
      formData.append("remoteFileIds", JSON.stringify(remoteFileIds));
      formData.append("localFileIds", JSON.stringify(localEntries.map((entry) => entry.preparedFile.id)));
      formData.append("overwrite", overwrite ? "true" : "false");
      localEntries.forEach((entry) => formData.append("files", entry.file, entry.file.name));
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) onLocalProgress(event.loaded);
      });
      xhr.addEventListener("load", () => {
        const payload = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
        else reject(new Error(responseErrorMessage(payload, "确认提交失败")));
      });
      xhr.addEventListener("error", () => reject(new Error("网络错误，确认提交失败")));
      xhr.open("POST", `/api/submit/${token}/complete-remote`);
      xhr.send(formData);
    });
  }

  const response = await fetch(`/api/submit/${token}/complete-remote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ submissionId, remoteFileIds, overwrite }),
  });
  return readJsonResponse(response, "确认提交失败");
}

async function submitRemote(form, files, overwrite) {
  $("#progress").hidden = false;
  $("#progress").value = 0;
  message("正在创建世纪互联直传会话...");
  const prepared = await prepareRemoteSubmission(files, overwrite);
  const uploadFiles = Array.isArray(prepared.files) ? prepared.files : [];
  const localFiles = Array.isArray(prepared.localFiles) ? prepared.localFiles : [];
  const remoteByIndex = new Map(uploadFiles.map((item) => [Number(item.index), item]));
  const localByIndex = new Map(localFiles.map((item) => [Number(item.index), item]));
  const remoteEntries = files
    .map((file, index) => ({ file, preparedFile: remoteByIndex.get(index) }))
    .filter((entry) => entry.preparedFile);
  const localEntries = files
    .map((file, index) => ({ file, preparedFile: localByIndex.get(index) }))
    .filter((entry) => entry.preparedFile);
  if (remoteEntries.length !== uploadFiles.length || localEntries.length !== localFiles.length) {
    throw new Error("上传会话数量不匹配，请刷新后重试");
  }
  if (remoteEntries.length + localEntries.length !== files.length) {
    throw new Error("上传会话缺少部分文件，请刷新后重试");
  }

  let uploadedBytes = 0;
  let localUploadedBytes = 0;
  const remoteBytes = remoteEntries.reduce((sum, entry) => sum + entry.file.size, 0);
  const localBytes = localEntries.reduce((sum, entry) => sum + entry.file.size, 0);
  const totalBytes = remoteBytes + localBytes;
  message("正在直传至世纪互联...");
  for (const entry of remoteEntries) {
    await uploadFileToSession(entry.file, entry.preparedFile, (bytes) => {
      uploadedBytes += bytes;
      $("#progress").value = totalBytes ? Math.min(99, Math.round((uploadedBytes / totalBytes) * 100)) : 0;
    });
  }

  message(localEntries.length ? "正在上传小文件并确认提交..." : "正在确认提交...");
  const payload = await completeRemoteSubmission(
    prepared.submissionId,
    remoteEntries.map((entry) => entry.preparedFile.id),
    localEntries,
    (bytes) => {
      localUploadedBytes = bytes;
      const done = uploadedBytes + localUploadedBytes;
      $("#progress").value = totalBytes ? Math.min(99, Math.round((done / totalBytes) * 100)) : 0;
    },
    overwrite,
  );
  applySubmitSuccess(form, payload);
}

function submitMultipart(form, files, overwrite) {
  const formData = new FormData(form);
  formData.delete("files");
  formData.set("overwrite", overwrite ? "true" : "false");
  files.forEach((file) => formData.append("files", file, file.name));
  const xhr = new XMLHttpRequest();
  $("#progress").hidden = false;
  $("#progress").value = 0;

  xhr.upload.addEventListener("progress", (event) => {
    if (event.lengthComputable) $("#progress").value = Math.round((event.loaded / event.total) * 100);
  });

  xhr.addEventListener("load", () => {
    const payload = JSON.parse(xhr.responseText || "{}");
    if (xhr.status >= 200 && xhr.status < 300) {
      applySubmitSuccess(form, payload);
    } else {
      message(responseErrorMessage(payload), "error");
    }
  });

  xhr.addEventListener("error", () => message("网络错误，提交失败", "error"));
  xhr.open("POST", `/api/submit/${token}`);
  xhr.send(formData);
  message("正在上传...");
}

$("#files").addEventListener("change", (event) => {
  addFiles([...event.currentTarget.files]);
  event.currentTarget.value = "";
});

$("#dynamicFields").addEventListener("input", renderFileQueue);

$("#fileQueue").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const index = selectedFiles.findIndex((item) => item.id === button.dataset.fileId);
  if (index < 0) return;
  if (button.dataset.action === "remove") removeFile(button.dataset.fileId);
  if (button.dataset.action === "up") moveFile(index, index - 1);
  if (button.dataset.action === "down") moveFile(index, index + 1);
});

$("#fileQueue").addEventListener("dragstart", (event) => {
  const card = event.target.closest(".submit-file-card");
  if (!card) return;
  draggedFileId = card.dataset.fileId;
  card.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedFileId);
});

$("#fileQueue").addEventListener("dragend", () => {
  draggedFileId = null;
  document.querySelectorAll(".submit-file-card.dragging").forEach((card) => card.classList.remove("dragging"));
});

$("#fileQueue").addEventListener("dragover", (event) => {
  const card = event.target.closest(".submit-file-card");
  if (!card || !draggedFileId || card.dataset.fileId === draggedFileId) return;
  event.preventDefault();
  const fromIndex = selectedFiles.findIndex((item) => item.id === draggedFileId);
  const toIndex = selectedFiles.findIndex((item) => item.id === card.dataset.fileId);
  moveFile(fromIndex, toIndex);
});

$("#submitForm").addEventListener("reset", () => {
  setTimeout(() => {
    if (successReset) {
      successReset = false;
      return;
    }
    clearFiles();
    message("");
    $("#progress").hidden = true;
    $("#progress").value = 0;
  });
});

$("#submitForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const files = selectedFiles.map((item) => item.file);
  const fileError = validateFiles(files);
  if (fileError) {
    message(fileError, "error");
    return;
  }

  let overwrite = false;
  try {
    const overwriteDecision = await confirmOverwriteIfNeeded();
    if (overwriteDecision === null) return;
    overwrite = overwriteDecision;
  } catch (error) {
    message(error && error.message ? error.message : "检查已有提交失败，请重试", "error");
    return;
  }

  if (shouldUseDirectUpload(files)) {
    try {
      await submitRemote(form, files, overwrite);
    } catch (error) {
      message(error && error.message ? error.message : "直传失败，请重试", "error");
    }
    return;
  }

  submitMultipart(form, files, overwrite);
});

loadSiteFooter();
loadTask();

$("#closeSuccessDialog").addEventListener("click", () => $("#successDialog").close());
