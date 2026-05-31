const token = location.pathname.split("/").pop();
let task = null;
let selectedFiles = [];
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
  const updateTip = "如果提交后发现文件或信息有误，请使用相同的姓名和学号/考试号重新提交，系统会自动用新提交覆盖旧提交。";
  if (!task.description) return `请按要求填写信息并上传文件。${updateTip}`;
  return `${task.description}\n${updateTip}`;
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
  document.title = `${task.siteTitle || "Filestore"} - ${task.title}`;
  $("#submitHeader").innerHTML = `
    <p class="eyebrow">${isClosed ? "CLOSED" : "FILE SUBMISSION"}</p>
    <h1>${escapeHtml(task.title)}</h1>
    <p>${escapeHtml(submitDescription()).replaceAll("\n", "<br>")}</p>
    ${task.deadline ? `<p class="hint">截止时间：${new Date(task.deadline).toLocaleString()}</p>` : ""}
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
    $("#submitHeader").innerHTML = `<p class="eyebrow">ERROR</p><h1>无法提交</h1><p>${escapeHtml(error.message)}</p>`;
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

$("#submitForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const files = selectedFiles.map((item) => item.file);
  const fileError = validateFiles(files);
  if (fileError) {
    message(fileError, "error");
    return;
  }

  const formData = new FormData(form);
  formData.delete("files");
  selectedFiles.forEach((item) => formData.append("files", item.file, item.file.name));
  const xhr = new XMLHttpRequest();
  $("#progress").hidden = false;
  $("#progress").value = 0;

  xhr.upload.addEventListener("progress", (event) => {
    if (event.lengthComputable) $("#progress").value = Math.round((event.loaded / event.total) * 100);
  });

  xhr.addEventListener("load", () => {
    const payload = JSON.parse(xhr.responseText || "{}");
    if (xhr.status >= 200 && xhr.status < 300) {
      successReset = true;
      form.reset();
      clearFiles();
      $("#progress").value = 100;
      message(`提交成功，编号 ${payload.submissionId}。文件：${payload.files.join("、")}`, "ok");
      showSuccessDialog(payload);
    } else {
      message(payload.details ? payload.details.join("；") : payload.error || "提交失败", "error");
    }
  });

  xhr.addEventListener("error", () => message("网络错误，提交失败", "error"));
  xhr.open("POST", `/api/submit/${token}`);
  xhr.send(formData);
  message("正在上传...");
});

loadTask();

$("#closeSuccessDialog").addEventListener("click", () => $("#successDialog").close());
