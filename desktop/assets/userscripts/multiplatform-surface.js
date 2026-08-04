function configureCpuDesktopProjects(projects) {
  for (const project of projects) {
    for (const [key, script] of Object.entries(project.scripts || {})) {
      script.projectName = project.name;

      if (project.name === "后台") {
        script.hideInPanel = key !== "console";
        if (key === "console") script.name = "运行日志";
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
      panel.innerHTML = `
        <header>
          <span>统一设置</span>
          <strong>复杂参数已经替你收好</strong>
          <p>多平台助手复用桌面客户端的 AI、节奏与提交策略，不再展示 OCS 的题库、线程、随机作答和通知回调等内部配置。</p>
        </header>
        <main>
          <article>
            <span class="cpu-assistant-settings-icon">自</span>
            <div><strong>自动识别任务</strong><p>进入课程、章节、作业或考试后自动识别；没有任务时保持等待。</p></div>
            <em>已开启</em>
          </article>
          <article>
            <span class="cpu-assistant-settings-icon">静</span>
            <div><strong>标签页默认静音</strong><p>后台学习时避免突然播放声音，需要时可在客户端标签栏恢复。</p></div>
            <em>已开启</em>
          </article>
          <article>
            <span class="cpu-assistant-settings-icon">交</span>
            <div><strong>提交保护</strong><p>章节测验是否自动提交由客户端「工具」页统一控制；作业和考试始终由你手动交卷。</p></div>
            <em>受保护</em>
          </article>
          <article>
            <span class="cpu-assistant-settings-icon">AI</span>
            <div><strong>AI 解答</strong><p>模型、题目档位和等待节奏均使用客户端「工具」页中的设置。</p></div>
            <em>已托管</em>
          </article>
        </main>
        <footer>
          <p>要修改上述选项，请点击客户端顶部的「工具」。本工具仅供个人学习辅助，严禁商业用途。</p>
          <button type="button" data-cpu-assistant-back>返回当前任务</button>
        </footer>
      `;
      panel.querySelector("[data-cpu-assistant-back]")?.addEventListener("click", () => { void selectTab("task"); });
      container.body.append(panel);
    }
    container.body.classList.add("cpu-assistant-custom-active");
  };

  const selectTab = async (tab) => {
    selectedTab = tab;
    const tabs = root.querySelector(".cpu-assistant-tabs");
    if (tab === "settings") {
      showSettingsWorkbench();
    } else {
      hideSettingsWorkbench();
      if (tab === "logs") await bridge.openPanel("render.console");
      else await bridge.openTask();
    }
    if (tabs) updateActiveTab(tabs);
  };

  const initializeTab = async () => {
    if (initialized) return;
    initialized = true;
    const current = String(await bridge.getCurrentPanel() || "");
    if (current === "render.console" || current.endsWith("-运行日志")) {
      selectedTab = "logs";
    } else {
      selectedTab = "task";
      if (current === "common.settings" || /(?:全局)?设置$/.test(current)) await bridge.openTask();
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
          <button type="button" role="tab" data-cpu-assistant-tab="logs">运行日志</button>
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
  const observer = new MutationObserver(() => queueMicrotask(mount));
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "disabled"] });
}
