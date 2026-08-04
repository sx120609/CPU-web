function installCpuScreenshotSearch(root, container) {
  if (typeof GM_cpuCaptureArea !== "function" || typeof GM_cpuAIRequest !== "function") return;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const renderText = (value) => escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\r?\n/g, "<br>");
  const parseReply = (content) => {
    const text = String(content || "").trim();
    const answerMatch = text.match(/(?:^|\n)\s*答案\s*[：:]\s*([\s\S]*?)(?=\n\s*解题思路\s*[：:]|$)/i);
    const explanationMatch = text.match(/(?:^|\n)\s*解题思路\s*[：:]\s*([\s\S]*)$/i);
    return {
      answer: String(answerMatch ? answerMatch[1] : text).trim(),
      explanation: String(explanationMatch ? explanationMatch[1] : "").trim(),
    };
  };
  const extractOutputText = (payload) => String(
    payload.output_text || (payload.output || [])
      .flatMap((item) => item && item.content || [])
      .filter((item) => item && item.type === "output_text")
      .map((item) => item.text || "")
      .join("") || "",
  ).trim();
  const report = (message) => {
    try { typeof GM_cpuReport === "function" && GM_cpuReport("status", message); } catch { /* 不影响搜题 */ }
  };
  let resultPanel = null;
  const closeResult = () => {
    resultPanel?.remove();
    resultPanel = null;
  };
  const showResult = ({ status, imageUrl = "", answer = "", explanation = "", error = "" }) => {
    closeResult();
    const panel = document.createElement("section");
    panel.className = "cpu-ocs-shot-result";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "截图搜题结果");
    panel.innerHTML = `
      <header><div><b>截图搜题</b><span>${status === "loading" ? "正在识别并解答" : status === "done" ? "识别完成" : "未能完成"}</span></div><button type="button" data-cpu-shot-action="close" title="关闭" aria-label="关闭">×</button></header>
      <main>
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="框选的题目截图">` : ""}
        ${status === "loading" ? '<div class="cpu-ocs-shot-progress"><i></i></div><p class="muted">正在读取题面、选项并核对答案…</p>' : ""}
        ${answer ? `<section class="cpu-ocs-shot-card"><span>答案</span><div>${renderText(answer)}</div></section>` : ""}
        ${explanation ? `<section class="cpu-ocs-shot-card"><span>解题思路</span><div>${renderText(explanation)}</div></section>` : ""}
        ${error ? `<p class="cpu-ocs-shot-error">${escapeHtml(error)}</p>` : ""}
      </main>
      <footer><button class="base-style-button-secondary" type="button" data-cpu-shot-action="retry">重新截图</button>${answer ? '<button class="base-style-button" type="button" data-cpu-shot-action="copy">复制答案</button>' : ""}<button class="base-style-button-secondary" type="button" data-cpu-shot-action="close">返回助手</button></footer>
    `;
    panel.addEventListener("click", (event) => {
      const action = event.target.closest("[data-cpu-shot-action]")?.dataset.cpuShotAction;
      if (action === "close") closeResult();
      else if (action === "retry") { closeResult(); void startSearch(); }
      else if (action === "copy" && answer) {
        navigator.clipboard?.writeText(answer).then(() => report("截图答案已复制")).catch(() => report("复制失败，请手动选择答案"));
      }
    });
    root.append(panel);
    resultPanel = panel;
  };
  const chooseArea = () => new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "cpu-ocs-capture-overlay";
    overlay.innerHTML = '<div class="cpu-ocs-capture-hint">拖动框选题目区域 · Esc 取消</div><div class="cpu-ocs-capture-box"></div>';
    root.append(overlay);
    const box = overlay.querySelector(".cpu-ocs-capture-box");
    let start = null;
    const finish = (result) => {
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
      resolve(result);
    };
    const draw = (event) => {
      if (!start) return;
      const left = Math.min(start.x, event.clientX);
      const top = Math.min(start.y, event.clientY);
      box.style.display = "block";
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${Math.abs(event.clientX - start.x)}px`;
      box.style.height = `${Math.abs(event.clientY - start.y)}px`;
    };
    const onKeyDown = (event) => { if (event.key === "Escape") finish(null); };
    overlay.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      overlay.setPointerCapture(event.pointerId);
      draw(event);
    });
    overlay.addEventListener("pointermove", draw);
    overlay.addEventListener("pointerup", (event) => {
      if (!start) return;
      const rect = {
        x: Math.min(start.x, event.clientX),
        y: Math.min(start.y, event.clientY),
        width: Math.abs(event.clientX - start.x),
        height: Math.abs(event.clientY - start.y),
      };
      finish(rect.width >= 24 && rect.height >= 24 ? rect : null);
    });
    document.addEventListener("keydown", onKeyDown, true);
  });
  const startSearch = async () => {
    if (container.dataset.cpuScreenshotBusy === "true") return;
    container.dataset.cpuScreenshotBusy = "true";
    closeResult();
    container.style.visibility = "hidden";
    const rect = await chooseArea();
    if (!rect) {
      container.style.visibility = "";
      delete container.dataset.cpuScreenshotBusy;
      return;
    }
    let imageUrl = "";
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      imageUrl = await GM_cpuCaptureArea(rect);
      container.style.visibility = "";
      showResult({ status: "loading", imageUrl });
      const config = GM_getValue("config", {}) || {};
      const response = await GM_cpuAIRequest({
        model: config.aiModel || "deepseek-reasoner",
        reasoningEffort: ["low", "high", "max"].includes(config.answerDepth) ? config.answerDepth : "low",
        input: [{ role: "user", content: [
          { type: "input_text", text: "请识别截图中的完整题目并作答。若有选项，请结合选项判断。只返回可供用户阅读的答案与简明解题思路，不得把‘图片缺失’、‘无法完成’等内部判断当作填空答案。严格使用纯文本格式：答案：... 换行 解题思路：..." },
          { type: "input_image", image_url: imageUrl, detail: "high" },
        ] }],
      });
      if (!response || response.status < 200 || response.status >= 300) {
        let message = `截图搜题失败（${response ? response.status : "无响应"}）`;
        try {
          const payload = JSON.parse(response?.text || "{}");
          message = payload.message || payload.error?.message || payload.error || message;
        } catch { /* 保留状态码错误 */ }
        throw new Error(message);
      }
      const payload = JSON.parse(response.text || "{}");
      const structured = payload.learning_answer;
      const parsed = structured && typeof structured === "object"
        ? { answer: String(structured.answer || "").trim(), explanation: String(structured.explanation || "").trim() }
        : parseReply(extractOutputText(payload));
      showResult({ status: "done", imageUrl, answer: parsed.answer || "未识别到可提交答案", explanation: parsed.explanation });
      report("截图搜题已完成");
    } catch (error) {
      container.style.visibility = "";
      const message = error instanceof Error ? error.message : String(error);
      showResult({ status: "error", imageUrl, error: message });
      report(message);
    } finally {
      container.style.visibility = "";
      delete container.dataset.cpuScreenshotBusy;
    }
  };
  const mountButton = () => {
    const header = root.querySelector("header-element");
    if (!header || header.querySelector(".cpu-ocs-shot-button")) return false;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cpu-ocs-shot-button";
    button.title = "截图搜题（建议先暂停自动任务）";
    button.setAttribute("aria-label", "截图搜题");
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"></path><circle cx="12" cy="12" r="3.2"></circle></svg>';
    button.addEventListener("click", (event) => { event.stopPropagation(); void startSearch(); });
    const toolbar = header.firstElementChild?.firstElementChild || header;
    const minimizeButton = toolbar.lastElementChild;
    if (minimizeButton && minimizeButton !== header) toolbar.insertBefore(button, minimizeButton);
    else toolbar.append(button);
    return true;
  };
  mountButton();
  const observer = new MutationObserver(() => { mountButton(); });
  observer.observe(root, { childList: true, subtree: true });
}
