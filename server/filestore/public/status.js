const token = location.pathname.split("/").pop();
let statusData = null;

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function renderHeader() {
  document.title = `${statusData.siteTitle || "Filestore"} - 提交成功名单`;
  $("#statusHeader").innerHTML = `
    <p class="eyebrow">SUBMISSION STATUS</p>
    <h1>${escapeHtml(statusData.title)}</h1>
    <p>这里显示已经成功提交的记录和文件名。文件内容不会在此页面公开。</p>
    ${statusData.deadline ? `<p class="hint">截止时间：${new Date(statusData.deadline).toLocaleString()}</p>` : ""}
  `;
}

function renderMetrics() {
  const stats = statusData.stats;
  $("#statusMetrics").innerHTML = `
    <div class="metric"><span>已提交</span><b>${stats.submitted}</b><small>成功记录数</small></div>
    <div class="metric"><span>应提交</span><b>${stats.expected || "-"}</b><small>${stats.expected ? "来自名单行数" : "未设置名单"}</small></div>
    <div class="metric"><span>未提交</span><b>${stats.missing}</b><small>${stats.expected ? "名单内尚未提交" : "未设置名单"}</small></div>
  `;
}

function submissionText(item) {
  return `${item.displayName} ${item.identity} ${item.files.map((file) => file.storedName).join(" ")}`.toLowerCase();
}

function renderList() {
  const query = $("#statusSearch").value.trim().toLowerCase();
  const rows = statusData.submissions.filter((item) => !query || submissionText(item).includes(query));
  if (!rows.length) {
    $("#statusList").innerHTML = `
      <div class="table-empty">
        <strong>${statusData.submissions.length ? "没有匹配结果" : "暂无成功提交"}</strong>
        <span>${statusData.submissions.length ? "换个关键词再试。" : "提交成功后会显示在这里。"}</span>
      </div>
    `;
    return;
  }
  $("#statusList").innerHTML = rows.map((item) => `
    <article class="status-item">
      <div class="status-person">
        <strong>${escapeHtml(item.displayName)}</strong>
        <span>${item.identity ? escapeHtml(item.identity) : `提交 #${item.id}`} · ${new Date(item.createdAt).toLocaleString()}</span>
      </div>
      <div class="status-files">
        ${item.files.map((file) => `
          <div class="status-file">
            <strong>${escapeHtml(file.storedName)}</strong>
            <span>${formatBytes(file.size)}</span>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
}

async function loadStatus() {
  try {
    const response = await fetch(`/api/public/status/${token}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "成功名单加载失败");
    statusData = payload;
    renderHeader();
    renderMetrics();
    renderList();
    $("#statusBody").hidden = false;
  } catch (error) {
    $("#statusHeader").innerHTML = `<p class="eyebrow">ERROR</p><h1>无法查看</h1><p>${escapeHtml(error.message)}</p>`;
  }
}

$("#statusSearch").addEventListener("input", renderList);
loadStatus();
