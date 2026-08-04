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
        script.hideInPanel = !["guide", "settings"].includes(key);
        if (key === "guide") script.name = "当前任务";
        if (key === "settings") script.name = "设置";
      }
    }
  }
}

function installCpuUnifiedSurface(root, container, bridge) {
  let updating = false;

  const currentTab = async () => {
    const current = String(await bridge.getCurrentPanel() || "");
    if (current === "render.console" || current.endsWith("-运行日志")) return "logs";
    if (current === "common.settings" || current.endsWith("-设置")) return "settings";
    return "task";
  };

  const updateActiveTab = async (tabs) => {
    const active = await currentTab();
    tabs.querySelectorAll("button[data-cpu-assistant-tab]").forEach((button) => {
      const selected = button.dataset.cpuAssistantTab === active;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    });
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

      if (!toolbar.querySelector(".cpu-assistant-close")) {
        const close = document.createElement("button");
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
        tabs.addEventListener("click", async (event) => {
          const button = event.target.closest("button[data-cpu-assistant-tab]");
          if (!button) return;
          event.stopPropagation();
          const tab = button.dataset.cpuAssistantTab;
          if (tab === "task") await bridge.openTask();
          else if (tab === "logs") await bridge.openPanel("render.console");
          else if (tab === "settings") await bridge.openPanel("common.settings");
          await updateActiveTab(tabs);
        });
        headerShell.append(tabs);
      }

      void updateActiveTab(tabs);
    } finally {
      updating = false;
    }
  };

  mount();
  const observer = new MutationObserver(() => queueMicrotask(mount));
  observer.observe(root, { childList: true, subtree: true });
}
