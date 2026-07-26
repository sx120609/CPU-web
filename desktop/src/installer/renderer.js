// 安装页的渲染侧。真正的复制/建快捷方式/写注册表都在主进程，
// 这里只负责画状态 —— 渲染进程不碰文件系统。

const bridge = window.cpuInstaller;

const el = (id) => document.querySelector(`#${id}`);

const show = (name) => {
  for (const id of ["ready", "busy", "done", "oops"]) el(id).hidden = id !== name;
};

const renderProgress = (p) => {
  // 后端按字节报进度，但"复制完最后一个字节"离"能用"还有建快捷方式等几步，
  // 所以留 4% 给收尾，不让进度条卡在 100% 上不动。
  const pct = Math.max(0, Math.min(100, Math.round(p.percent ?? 0)));
  el("fill").style.width = `${pct}%`;
  el("busy-pct").textContent = `${pct}%`;
  if (p.text) el("busy-text").textContent = p.text;
  if (p.detail) el("busy-sub").textContent = p.detail;
};

const fail = (message, detail) => {
  show("oops");
  el("oops-text").textContent = message || "安装失败，请重试。";
  el("oops-more").hidden = !detail;
  el("oops-detail").textContent = detail || "";
};

const install = async () => {
  el("go").disabled = true;
  show("busy");
  renderProgress({ percent: 0, text: "正在准备" });
  try {
    const result = await bridge.install();
    if (!result?.ok) {
      fail(result?.message, result?.detail);
      return;
    }
    show("done");
    // 主进程会在启动正式版后自己退出，这里不用做别的
  } catch (error) {
    // 走到这里说明 IPC 本身炸了，不是安装逻辑返回的失败
    fail("安装程序出错了。", error instanceof Error ? error.message : String(error));
  }
};

const boot = async () => {
  el("close").addEventListener("click", () => void bridge.close());
  el("go").addEventListener("click", () => void install());
  el("retry").addEventListener("click", () => void install());

  bridge.onProgress(renderProgress);

  try {
    const info = await bridge.getInfo();
    el("where").textContent = info.targetLabel || "当前用户目录";
    if (info.upgrade) {
      // 旧版正开着时先说清楚会关掉它 —— 否则窗口突然消失会被当成崩溃
      el("lead").innerHTML = info.running
        ? "检测到药大拾间正在运行，更新前会先关闭它。<br />你的登录状态与设置都会保留。"
        : "检测到已安装的旧版本，将就地升级。<br />你的登录状态与设置都会保留。";
      el("go").textContent = "立即更新";
    }
  } catch {
    // 拿不到信息不影响安装，保持默认文案
  }
};

if (!bridge) {
  document.body.textContent = "安装程序桥未注入。";
} else {
  void boot();
}
