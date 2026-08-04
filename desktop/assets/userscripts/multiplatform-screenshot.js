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
    const text = String(content || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          answer: typeof parsed.answer === "string" ? parsed.answer.trim() : "",
          explanation: typeof parsed.explanation === "string" ? parsed.explanation.trim() : "",
        };
      }
    } catch { /* 兼容已经缓存的旧版纯文本响应 */ }
    const answerMatch = text.match(/(?:^|\n)\s*答案\s*[：:]\s*([\s\S]*?)(?=\n\s*解题思路\s*[：:]|$)/i);
    const explanationMatch = text.match(/(?:^|\n)\s*解题思路\s*[：:]\s*([\s\S]*)$/i);
    return {
      answer: String(answerMatch ? answerMatch[1] : "").trim(),
      explanation: String(explanationMatch ? explanationMatch[1] : (answerMatch ? "" : text)).trim(),
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
  let hiddenPanels = [];
  const closeResult = () => {
    resultPanel?.remove();
    resultPanel = null;
    for (const panel of hiddenPanels) panel.style.removeProperty("display");
    hiddenPanels = [];
  };
  const showResult = ({ status, imageUrl = "", answer = "", explanation = "", error = "" }) => {
    closeResult();
    const panel = document.createElement("section");
    panel.className = "cpu-ocs-shot-workbench";
    panel.setAttribute("role", "region");
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
    hiddenPanels = Array.from(container.body.children).filter((child) => child !== panel);
    for (const current of hiddenPanels) current.style.setProperty("display", "none", "important");
    container.body.append(panel);
    resultPanel = panel;
  };
  const chooseArea = () => new Promise((resolve) => {
    // OCS 工作台位于可拖动的 ShadowRoot 中。把 fixed 遮罩挂在其中会让
    // clientX/clientY（视口坐标）与选择框（工作台局部坐标）发生偏移。
    // 独立的顶层宿主既不受工作台 transform 影响，也不会污染网课页面样式。
    const captureHost = document.createElement("div");
    captureHost.id = "cpu-ocs-capture-host";
    Object.assign(captureHost.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "block",
    });
    const captureRoot = captureHost.attachShadow({ mode: "closed" });
    captureRoot.innerHTML = `
      <style>
        :host { all: initial; }
        .cpu-ocs-capture-overlay { position: fixed; inset: 0; cursor: crosshair; background: rgba(8,18,16,.28); user-select: none; touch-action: none; }
        .cpu-ocs-capture-hint { position: fixed; left: 50%; top: 22px; transform: translateX(-50%); padding: 9px 14px; color: #fff; background: rgba(14,31,27,.92); border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,.22); font: 650 13px system-ui,sans-serif; }
        .cpu-ocs-capture-box { position: fixed; display: none; box-sizing: border-box; border: 2px solid #83dbc3; background: rgba(131,219,195,.12); box-shadow: 0 0 0 9999px rgba(8,18,16,.38); }
      </style>
      <div class="cpu-ocs-capture-overlay"><div class="cpu-ocs-capture-hint">拖动框选题目区域 · Esc 取消</div><div class="cpu-ocs-capture-box"></div></div>
    `;
    document.documentElement.append(captureHost);
    const overlay = captureRoot.querySelector(".cpu-ocs-capture-overlay");
    const box = overlay.querySelector(".cpu-ocs-capture-box");
    let start = null;
    const finish = (result) => {
      document.removeEventListener("keydown", onKeyDown, true);
      captureHost.remove();
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
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
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
          { type: "input_text", text: "请识别截图中的完整题目并作答。若有选项，请结合选项判断；若信息不足，将 answer 留空并在 explanation 说明。只返回 JSON：{\"answer\":\"可直接提交的答案\",\"explanation\":\"简短解题依据\"}，不要输出 JSON 之外的文字。" },
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
      showResult({
        status: "done",
        imageUrl,
        answer: parsed.answer,
        explanation: parsed.explanation || (parsed.answer ? "" : "未识别到可提交答案，请重新框选完整题面与选项。"),
      });
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
    const runButton = toolbar.querySelector(".cpu-assistant-run");
    const minimizeButton = toolbar.lastElementChild;
    if (runButton) toolbar.insertBefore(button, runButton);
    else if (minimizeButton && minimizeButton !== header) toolbar.insertBefore(button, minimizeButton);
    else toolbar.append(button);
    return true;
  };
  mountButton();
  const observer = new MutationObserver(() => { mountButton(); });
  observer.observe(root, { childList: true, subtree: true });
}
