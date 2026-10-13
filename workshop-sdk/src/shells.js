function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, action, className = "cw-button") {
  const node = element("button", className, text);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
function documentValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Authored stage + common menu, pause, results, history and settings. */
export function createGameShell({
  container,
  sdk,
  title,
  description,
  stage,
  settings = [],
  onStart,
  onPause,
  onResume,
  onStop,
}) {
  const root = element("main", "cw-game");
  const phone = element("section", "cw-phone");
  const menu = element("section", "cw-menu");
  const heading = element("h1", "", title);
  const best = element("strong", "", "0");
  const bestBox = element("div", "cw-best", "最高分 ");
  bestBox.append(best);
  const actions = element("div", "cw-actions");
  const notice = element("p", "cw-notice", "正在连接创意工坊…");
  notice.setAttribute("role", "status");
  menu.append(
    element("div", "cw-emblem", "✦"),
    heading,
    element("p", "cw-tagline", description),
    bestBox,
    actions,
    notice,
  );
  const hud = element("div", "cw-hud");
  const scoreLabel = element("strong", "cw-score", "0");
  const status = element("span", "cw-game-status");
  const overlay = element("section", "cw-shade");
  const panel = element("section", "cw-panel");
  stage.classList.add("cw-stage");
  stage.hidden = hud.hidden = overlay.hidden = panel.hidden = true;
  phone.append(stage, hud, menu, overlay, panel);
  root.append(phone);
  container.replaceChildren(root);
  let phase = "menu";
  let initialized = false;
  let hostPaused = false;
  let disposed = false;
  let state = {
    best: 0,
    history: [],
    settings: Object.fromEntries(settings.map((item) => [item.id, !!item.default])),
  };
  let storageAvailable = false;
  let persistence = Promise.resolve();
  function persist() {
    if (!storageAvailable) return;
    const snapshot = JSON.parse(JSON.stringify(state));
    persistence = sdk
      .updateSave((value) => ({ ...documentValue(value), gameShell: snapshot }))
      .catch((error) => {
        notice.textContent = `记录未保存：${error.message}`;
      });
  }
  function invoke(callback, ...args) {
    try {
      callback?.(...args);
    } catch (error) {
      status.textContent = error.message;
      pause();
    }
  }
  function showMenu() {
    invoke(onStop);
    phase = "menu";
    menu.hidden = false;
    stage.hidden = hud.hidden = overlay.hidden = panel.hidden = true;
    best.textContent = String(state.best);
  }
  function start() {
    if (!initialized || disposed || hostPaused || document.hidden) return;
    invoke(onStop);
    phase = "playing";
    menu.hidden = panel.hidden = overlay.hidden = true;
    stage.hidden = hud.hidden = false;
    scoreLabel.textContent = "0";
    status.textContent = "";
    invoke(onStart, { ...state.settings });
    stage.focus?.();
  }
  function modal(titleText, body, controls) {
    overlay.replaceChildren();
    const card = element("div", "cw-modal");
    card.append(element("h2", "", titleText), element("p", "", body), ...controls);
    overlay.append(card);
    overlay.hidden = false;
    controls[0]?.focus();
  }
  function pause() {
    if (phase !== "playing") return;
    phase = "paused";
    invoke(onPause);
    modal("先歇一会儿", `当前 ${scoreLabel.textContent} 分`, [
      button("继续游戏", resume, "cw-button cw-primary"),
      button("返回主页", showMenu),
    ]);
  }
  function resume() {
    if (phase !== "paused" || hostPaused || document.hidden) return;
    phase = "playing";
    overlay.hidden = true;
    invoke(onResume);
    stage.focus?.();
  }
  function openPanel(titleText) {
    menu.hidden = true;
    panel.hidden = false;
    panel.replaceChildren();
    const header = element("header", "cw-panel-header");
    header.append(element("h2", "", titleText), button("返回", showMenu));
    const content = element("div", "cw-panel-content");
    panel.append(header, content);
    return content;
  }
  actions.append(
    button("开始游戏", start, "cw-button cw-primary"),
    button("历史战绩", () => {
      const content = openPanel("历史战绩");
      if (!state.history.length) content.append(element("p", "", "还没有战绩，开始第一局吧。"));
      for (const item of state.history) {
        const row = element("article", "cw-history");
        row.append(
          element("strong", "", `${item.score} 分`),
          element("span", "", item.summary || ""),
          element("small", "", new Date(item.at).toLocaleString("zh-CN")),
        );
        content.append(row);
      }
    }),
    button("设置", () => {
      const content = openPanel("设置");
      for (const item of settings) {
        const row = element("label", "cw-setting", item.label);
        const input = element("input");
        input.type = "checkbox";
        input.checked = state.settings[item.id];
        input.addEventListener("change", () => {
          state.settings[item.id] = input.checked;
          persist();
        });
        row.append(input);
        content.append(row);
      }
      if (!settings.length) content.append(element("p", "", "此游戏没有额外设置。"));
      content.append(
        element(
          "p",
          "cw-notice",
          storageAvailable
            ? "设置、最高分与最近 30 局记录保存在此作品的独立存档中。"
            : "当前为临时体验，记录将在关闭后清除。",
        ),
      );
    }),
  );
  for (const child of actions.children) child.disabled = true;
  hud.append(scoreLabel, status, button("Ⅱ", pause, "cw-button cw-pause"));
  hud.lastChild.setAttribute("aria-label", "暂停游戏");
  const visibility = () => {
    if (document.hidden) pause();
  };
  const keydown = (event) => {
    if (event.key === "Escape") {
      if (phase === "playing") pause();
      else if (phase === "paused") resume();
    }
  };
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("keydown", keydown);
  const unsubscribePause = sdk.on("pause", () => {
    hostPaused = true;
    pause();
  });
  const unsubscribeResume = sdk.on("resume", () => {
    hostPaused = false; /* User must press Continue. */
  });
  const ready = (async () => {
    try {
      const env = await sdk.getEnvironment();
      storageAvailable = env.storageAvailable;
      if (storageAvailable) {
        try {
          const saved = documentValue(await sdk.getSave()).gameShell;
          if (saved && typeof saved === "object") {
            state.best = Number.isFinite(saved.best) ? saved.best : 0;
            state.history = Array.isArray(saved.history)
              ? saved.history
                  .filter((item) => item && Number.isFinite(item.score) && Number.isFinite(item.at))
                  .slice(0, 30)
              : [];
            for (const item of settings)
              if (typeof saved.settings?.[item.id] === "boolean")
                state.settings[item.id] = saved.settings[item.id];
          }
        } catch {
          storageAvailable = false;
        }
      }
      if (disposed) return;
      initialized = true;
      best.textContent = String(state.best);
      notice.textContent = storageAvailable ? "独立存档 · 随时暂停" : "临时体验 · 记录在关闭后清除";
      for (const child of actions.children) child.disabled = false;
    } catch (error) {
      notice.textContent = error.message;
    }
  })();
  return {
    ready,
    get phase() {
      return phase;
    },
    start,
    pause,
    resume,
    setScore(score) {
      scoreLabel.textContent = String(score);
    },
    setStatus(text) {
      status.textContent = text;
    },
    end({ score, summary = "" }) {
      if (phase !== "playing" && phase !== "paused") return;
      if (!Number.isFinite(score)) throw new Error("得分必须是有限数值");
      phase = "over";
      invoke(onStop);
      state.best = Math.max(state.best, score);
      state.history.unshift({ score, summary, at: Date.now() });
      state.history = state.history.slice(0, 30);
      persist();
      modal(`${score} 分`, `${summary} · 最高 ${state.best} 分`, [
        button("再来一局", start, "cw-button cw-primary"),
        button("返回主页", showMenu),
      ]);
    },
    destroy() {
      disposed = true;
      invoke(onStop);
      unsubscribePause();
      unsubscribeResume();
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("keydown", keydown);
      root.remove();
      return persistence;
    },
  };
}

/** A tool supplies its own input and output DOM; shell handles runs and cancellation. */
export function createToolShell({
  container,
  sdk,
  title,
  description,
  input,
  output,
  run,
  actionLabel = "开始处理",
}) {
  const root = element("main", "cw-tool");
  const status = element("p", "cw-tool-status", "正在连接创意工坊…");
  status.setAttribute("role", "status");
  const progress = element("progress");
  progress.max = 1;
  progress.hidden = true;
  const controls = element("div", "cw-tool-controls");
  let controller;
  let disposed = false;
  let hostPaused = false;
  let initialized = false;
  let generation = 0;
  const cancel = () => {
    if (!controller) return;
    controller.abort();
    controller = undefined;
    generation++;
    action.disabled = !initialized || hostPaused;
    cancelButton.hidden = progress.hidden = true;
    status.textContent = "已取消";
  };
  const action = button(
    actionLabel,
    async () => {
      if (controller || disposed || hostPaused || !initialized) return;
      controller = new AbortController();
      const signal = controller.signal;
      const current = ++generation;
      action.disabled = true;
      cancelButton.hidden = progress.hidden = false;
      progress.removeAttribute("value");
      status.textContent = "处理中…";
      try {
        await run({
          signal,
          onProgress(value, message) {
            if (current !== generation || disposed) return;
            if (Number.isFinite(value)) progress.value = Math.max(0, Math.min(1, value));
            if (message) status.textContent = message;
          },
        });
        if (current === generation && !disposed) status.textContent = "处理完成";
      } catch (error) {
        if (current === generation && !disposed)
          status.textContent = signal.aborted ? "已取消" : `处理失败：${error.message}`;
      } finally {
        if (current === generation && !disposed) {
          controller = undefined;
          action.disabled = hostPaused;
          cancelButton.hidden = progress.hidden = true;
        }
      }
    },
    "cw-tool-action",
  );
  action.disabled = true;
  const cancelButton = button("取消", cancel, "cw-tool-cancel");
  cancelButton.hidden = true;
  controls.append(action, cancelButton);
  root.append(
    element("h1", "", title),
    element("p", "cw-tool-description", description),
    input,
    controls,
    progress,
    status,
    output,
  );
  container.replaceChildren(root);
  const unsubscribePause = sdk.on("pause", () => {
    hostPaused = true;
    cancel();
    action.disabled = true;
  });
  const unsubscribeResume = sdk.on("resume", () => {
    hostPaused = false;
    action.disabled = !initialized;
  });
  const ready = sdk
    .getEnvironment()
    .then((env) => {
      if (disposed) return;
      root.dataset.theme = env.theme;
      initialized = true;
      action.disabled = hostPaused;
      status.textContent = "准备就绪";
    })
    .catch((error) => {
      status.textContent = error.message;
    });
  return {
    ready,
    cancel,
    destroy() {
      disposed = true;
      cancel();
      unsubscribePause();
      unsubscribeResume();
      root.remove();
    },
  };
}
