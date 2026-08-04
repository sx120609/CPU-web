function configureCpuDesktopProjects(projects) {
  for (const project of projects) {
    for (const [key, script] of Object.entries(project.scripts || {})) {
      script.projectName = project.name;

      if (project.name === "后台") {
        script.hideInPanel = true;
        continue;
      }

      if (project.name === "通用") {
        script.hideInPanel = key !== "guide";
        if (key === "guide") script.name = "当前任务";
      }
    }
  }
}

function installCpuUnifiedSurface(root, container, bridge) {
  let updating = false;
  let initialized = false;
  let selectedTab = "task";
  let lastRunControl = null;
  let lastAnswererWrappers = Array.isArray(GM_getValue("common.settings.answererWrappers", []))
    ? GM_getValue("common.settings.answererWrappers", [])
    : [];

  document.documentElement.dataset.cpuMultiplatformSurface = "ready";

  const readControlText = (control) => String(control?.value || control?.textContent || "").trim();
  const findRunControl = () => Array.from(root.querySelectorAll('button, input[type="button"], input[type="submit"]')).find((control) => {
    if (control.classList?.contains("cpu-assistant-run")) return false;
    return /开始答题|暂停|继续/.test(readControlText(control));
  }) || null;

  const runIcons = {
    ready: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5v13l10-6.5-10-6.5z"></path></svg>',
    running: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12"></path></svg>',
    paused: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5v13l10-6.5-10-6.5z"></path></svg>',
    idle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5v13l10-6.5-10-6.5z"></path></svg>',
  };

  const syncRunButton = (button) => {
    const current = findRunControl();
    if (current) lastRunControl = current;
    const control = current || lastRunControl;
    const text = readControlText(control);
    let state = "idle";
    let title = "进入任务后可开始助手";
    if (control && !control.disabled) {
      if (/继续/.test(text)) {
        state = "paused";
        title = "继续助手";
      } else if (/暂停/.test(text)) {
        state = "running";
        title = "暂停助手";
      } else if (/开始答题/.test(text)) {
        state = "ready";
        title = "开始助手";
      }
    }
    const disabled = state === "idle";
    if (button.disabled !== disabled) button.disabled = disabled;
    button.title = title;
    button.setAttribute("aria-label", title);
    if (button.dataset.state !== state) {
      button.dataset.state = state;
      button.innerHTML = runIcons[state];
    }
  };

  const updateActiveTab = (tabs) => {
    tabs.querySelectorAll("button[data-cpu-assistant-tab]").forEach((button) => {
      const selected = button.dataset.cpuAssistantTab === selectedTab;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    });
  };

  const getConfig = () => {
    const current = GM_getValue("config", {});
    return current && typeof current === "object" && !Array.isArray(current) ? current : {};
  };

  const saveConfig = (patch, statusText = "设置已保存") => {
    const current = getConfig();
    const next = { ...current, ...patch };
    next.answerIntervalMin = Math.min(300, Math.max(1, Number(next.answerIntervalMin) || 8));
    next.answerIntervalMax = Math.min(300, Math.max(next.answerIntervalMin, Number(next.answerIntervalMax) || 20));
    GM_setValue("config", next);

    if (Object.prototype.hasOwnProperty.call(patch, "autoSubmit")) {
      GM_setValue("common.settings.upload", next.autoSubmit === true ? "100" : "save");
    }
    if (Object.prototype.hasOwnProperty.call(patch, "answerIntervalMin")) {
      GM_setValue("common.settings.period", next.answerIntervalMin);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "aiEnabled")) {
      const currentWrappers = GM_getValue("common.settings.answererWrappers", []);
      if (Array.isArray(currentWrappers) && currentWrappers.length > 0) lastAnswererWrappers = currentWrappers;
      if (next.aiEnabled === false) GM_setValue("common.settings.answererWrappers", []);
      else if (lastAnswererWrappers.length > 0) GM_setValue("common.settings.answererWrappers", lastAnswererWrappers);
    }

    const status = container.body?.querySelector("[data-cpu-settings-status]");
    if (status) status.textContent = statusText;
    if (typeof GM_cpuReport === "function") GM_cpuReport("status", statusText);
    return next;
  };

  const refreshAnswerModes = async () => {
    if (typeof GM_cpuGetLearningPolicy !== "function") return false;
    try {
      const policy = await GM_cpuGetLearningPolicy();
      const modes = Array.isArray(policy?.answerModes) ? policy.answerModes : [];
      if (modes.length !== 3) return false;
      const current = getConfig();
      const activeMode = modes.find((item) => item?.key === current.answerDepth);
      const fallbackMode = modes.find((item) => item?.available !== false) || modes[0];
      const answerDepth = activeMode?.available !== false ? current.answerDepth : fallbackMode.key;
      if (JSON.stringify(current.answerModes || []) === JSON.stringify(modes) && current.answerDepth === answerDepth) return false;
      GM_setValue("config", { ...current, answerModes: modes, answerDepth });
      return true;
    } catch (error) {
      if (typeof GM_cpuReport === "function") GM_cpuReport("log", `档位配置刷新失败：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  const answerModeMarkup = (config) => {
    const modes = Array.isArray(config.answerModes) && config.answerModes.length > 0
      ? config.answerModes
      : [
          { key: "low", label: "快速判断", pointMultiplier: 1 },
          { key: "high", label: "深入分析", pointMultiplier: 1.5 },
          { key: "max", label: "挑战难题", pointMultiplier: 2 },
        ];
    const active = ["low", "high", "max"].includes(config.answerDepth) ? config.answerDepth : "low";
    return modes.map((mode) => `
      <label class="cpu-assistant-mode ${mode.key === active ? "selected" : ""} ${mode.available === false ? "is-disabled" : ""}">
        <input type="radio" name="cpu-answer-depth" value="${mode.key}" ${mode.key === active ? "checked" : ""} ${mode.available === false ? "disabled" : ""}>
        <span><strong>${mode.label}</strong><small>${mode.available === false ? "限免期间未开放" : `${Number(mode.pointMultiplier) || 1} 倍 AI 点数`}</small></span>
      </label>
    `).join("");
  };

  const renderSettingsWorkbench = (panel) => {
    const config = getConfig();
    const minimum = Math.min(300, Math.max(1, Number(config.answerIntervalMin) || 8));
    const maximum = Math.min(300, Math.max(minimum, Number(config.answerIntervalMax) || 20));
    panel.innerHTML = `
      <header>
        <span>助手设置</span>
        <strong>直接调整本页正在使用的选项</strong>
        <p>这里只保留会影响实际运行的设置。修改后会保存到桌面客户端；已开始的任务重新进入后会完整应用。</p>
      </header>
      <main>
        <section class="cpu-assistant-setting-section">
          <div class="cpu-assistant-setting-heading">
            <div><strong>题目分析档位</strong><p>按题目难度选择回答质量与 AI 点数消耗。</p></div>
          </div>
          <div class="cpu-assistant-mode-grid">${answerModeMarkup(config)}</div>
        </section>
        <section class="cpu-assistant-setting-section cpu-assistant-setting-list">
          <label class="cpu-assistant-setting-row">
            <span><strong>使用 AI 解答</strong><small>关闭后不再请求药大拾间 AI。</small></span>
            <input type="checkbox" data-cpu-config="aiEnabled" ${config.aiEnabled !== false ? "checked" : ""}>
          </label>
          <label class="cpu-assistant-setting-row">
            <span><strong>章节测验答完自动提交</strong><small>作业和考试仍保持手动交卷。</small></span>
            <input type="checkbox" data-cpu-config="autoSubmit" ${config.autoSubmit === true ? "checked" : ""}>
          </label>
        </section>
        <section class="cpu-assistant-setting-section">
          <div class="cpu-assistant-setting-heading">
            <div><strong>每题等待时间</strong><p>保留自然的作答间隔，单位为秒。</p></div>
          </div>
          <div class="cpu-assistant-number-grid">
            <label><span>最短</span><input type="number" min="1" max="300" step="1" value="${minimum}" data-cpu-number="answerIntervalMin"></label>
            <label><span>最长</span><input type="number" min="1" max="300" step="1" value="${maximum}" data-cpu-number="answerIntervalMax"></label>
          </div>
        </section>
      </main>
      <footer>
        <p data-cpu-settings-status>设置会自动保存 · 本工具仅供个人学习辅助，严禁商业用途。</p>
        <button type="button" data-cpu-assistant-back>返回当前任务</button>
      </footer>
    `;

    panel.querySelectorAll('input[name="cpu-answer-depth"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        saveConfig({ answerDepth: input.value }, "题目分析档位已保存");
        panel.querySelectorAll(".cpu-assistant-mode").forEach((label) => label.classList.toggle("selected", label.contains(input)));
      });
    });
    panel.querySelectorAll("input[data-cpu-config]").forEach((input) => {
      input.addEventListener("change", () => {
        const label = input.dataset.cpuConfig === "autoSubmit" ? "提交方式已保存" : "AI 解答设置已保存";
        saveConfig({ [input.dataset.cpuConfig]: input.checked }, label);
      });
    });
    panel.querySelectorAll("input[data-cpu-number]").forEach((input) => {
      input.addEventListener("change", () => {
        const next = saveConfig({ [input.dataset.cpuNumber]: Number(input.value) }, "答题等待时间已保存");
        panel.querySelector('[data-cpu-number="answerIntervalMin"]').value = String(next.answerIntervalMin);
        panel.querySelector('[data-cpu-number="answerIntervalMax"]').value = String(next.answerIntervalMax);
      });
    });
    panel.querySelector("[data-cpu-assistant-back]")?.addEventListener("click", () => { void selectTab("task"); });
  };

  const hideSettingsWorkbench = () => {
    container.body?.classList.remove("cpu-assistant-custom-active");
    container.body?.querySelector(".cpu-assistant-settings-workbench")?.remove();
  };

  const showSettingsWorkbench = () => {
    if (!container.body) return;
    let panel = container.body.querySelector(".cpu-assistant-settings-workbench");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "cpu-assistant-settings-workbench";
      container.body.append(panel);
    }
    renderSettingsWorkbench(panel);
    container.body.classList.add("cpu-assistant-custom-active");
  };

  const selectTab = async (tab) => {
    selectedTab = tab === "settings" ? "settings" : "task";
    const tabs = root.querySelector(".cpu-assistant-tabs");
    if (selectedTab === "settings") {
      await refreshAnswerModes();
      showSettingsWorkbench();
    }
    else {
      hideSettingsWorkbench();
      await bridge.openTask();
    }
    if (tabs) updateActiveTab(tabs);
  };

  const initializeTab = async () => {
    if (initialized) return;
    initialized = true;
    const current = String(await bridge.getCurrentPanel() || "");
    selectedTab = "task";
    if (current === "common.settings" || current === "render.console" || /(?:全局)?设置$|运行日志$/.test(current)) {
      await bridge.openTask();
    }
    const tabs = root.querySelector(".cpu-assistant-tabs");
    if (tabs) updateActiveTab(tabs);
  };

  const mount = () => {
    if (updating) return;
    updating = true;
    try {
      const header = root.querySelector("header-element");
      const headerShell = header?.firstElementChild;
      const toolbar = headerShell?.firstElementChild;
      if (!header || !headerShell || !toolbar) return;

      const profile = toolbar.querySelector(".profile");
      if (profile && profile.dataset.cpuAssistantTitle !== "true") {
        profile.dataset.cpuAssistantTitle = "true";
        profile.title = "拖动助手窗口";
        profile.replaceChildren();
        const icon = document.createElement("span");
        icon.className = "cpu-assistant-brand-icon";
        icon.textContent = "拾";
        const copy = document.createElement("span");
        copy.className = "cpu-assistant-brand-copy";
        copy.innerHTML = "<strong>药大拾间·全平台网课助手</strong><small>任务、答案与运行控制</small>";
        profile.append(icon, copy);
      }

      let close = toolbar.querySelector(".cpu-assistant-close");
      if (!close) {
        close = document.createElement("button");
        close.type = "button";
        close.className = "cpu-assistant-close";
        close.title = "隐藏助手";
        close.setAttribute("aria-label", "隐藏助手");
        close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>';
        close.addEventListener("click", (event) => {
          event.stopPropagation();
          bridge.hide();
        });
        toolbar.append(close);
      }

      let run = toolbar.querySelector(".cpu-assistant-run");
      if (!run) {
        run = document.createElement("button");
        run.type = "button";
        run.className = "cpu-assistant-run";
        run.addEventListener("click", (event) => {
          event.stopPropagation();
          const current = findRunControl();
          if (current) lastRunControl = current;
          if (!lastRunControl || lastRunControl.disabled) return;
          lastRunControl.click();
          queueMicrotask(() => syncRunButton(run));
          setTimeout(() => syncRunButton(run), 80);
        });
        toolbar.insertBefore(run, close);
      }
      syncRunButton(run);

      let tabs = headerShell.querySelector(".cpu-assistant-tabs");
      if (!tabs) {
        tabs = document.createElement("nav");
        tabs.className = "cpu-assistant-tabs";
        tabs.setAttribute("role", "tablist");
        tabs.setAttribute("aria-label", "助手页面");
        tabs.innerHTML = `
          <button type="button" role="tab" data-cpu-assistant-tab="task">当前任务</button>
          <button type="button" role="tab" data-cpu-assistant-tab="settings">设置</button>
        `;
        tabs.addEventListener("click", (event) => {
          const button = event.target.closest("button[data-cpu-assistant-tab]");
          if (!button) return;
          event.stopPropagation();
          void selectTab(button.dataset.cpuAssistantTab);
        });
        headerShell.append(tabs);
      }

      updateActiveTab(tabs);
      void initializeTab();
    } finally {
      updating = false;
    }
  };

  mount();
  setInterval(async () => {
    if (selectedTab !== "settings") return;
    if (await refreshAnswerModes()) showSettingsWorkbench();
  }, 15_000);
  const observer = new MutationObserver(() => queueMicrotask(mount));
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "disabled"] });
}
