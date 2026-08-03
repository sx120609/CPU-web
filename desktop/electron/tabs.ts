import { BrowserWindow, Menu, WebContentsView } from "electron";
import path from "node:path";
import { branding } from "./config";

// 单窗口标签页。整个应用只有一个窗口，学习通不再另开窗口。
//
// 有一条硬约束决定了整体设计：WebContentsView 永远盖在窗口自身页面内容之上，
// 外壳页面画的浮层会被内容视图压住。所以"工具"不做浮层，而是做成一个常驻标签 ——
// 切到它时把所有内容视图藏起来，露出外壳自己的页面。顺带它也就不像个外挂插件了。

export const CHROME_HEIGHT = 46;

// 学习通标签里的地址判断。允许 http 是因为超星登录链路中间有一跳是明文的；
// 这只影响要不要留在标签里显示，注入与特权桥另有更严的判断。
const isWebUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

export type TabKind = "site" | "tools" | "learning";

export type TabState = {
  id: string;
  kind: TabKind;
  title: string;
  url: string;
  loading: boolean;
  closable: boolean;
  canGoBack: boolean;
};

type Tab = {
  id: string;
  kind: TabKind;
  title: string;
  url: string;
  loading: boolean;
  closable: boolean;
  view?: WebContentsView;
};

export type TabHooks = {
  /** 透传给内容视图的应用版本，主站靠它识别桌面端 */
  appVersion: string;
  /** 决定一个地址该不该留在应用里；返回 false 表示交给系统浏览器 */
  isNavigable: (url: string) => boolean;
  /** 记录 webContents 属于哪种标签，供导航策略区分对待 */
  registerKind: (webContentsId: number, kind: TabKind) => void;
  /** 交给系统浏览器 */
  openExternally: (url: string) => void;
  /** 页面加载完成，用于注入用户脚本 */
  onDidFinishLoad: (contents: Electron.WebContents) => void;
  /** 主框架地址变化（含 SPA 路由），用于识别主站刚完成登录 */
  onNavigation: (contents: Electron.WebContents) => void;
  /** 标签状态变化，推给外壳渲染 */
  onChange: (tabs: TabState[], activeId: string) => void;
};

const PRELOAD = {
  site: "site-preload.js",
  learning: "learning-preload.js"
} as const;

export class TabManager {
  private tabs: Tab[] = [];
  private activeId = "";
  private counter = 0;

  constructor(private window: BrowserWindow, private hooks: TabHooks) {
    this.window.on("resize", () => this.layout());
  }

  /* --------------------------------------------------------------- 查询 */

  getState(): { tabs: TabState[]; activeId: string } {
    return {
      tabs: this.tabs.map((tab) => ({
        id: tab.id,
        kind: tab.kind,
        title: tab.title,
        url: tab.url,
        loading: tab.loading,
        closable: tab.closable,
        canGoBack: tab.view ? tab.view.webContents.navigationHistory.canGoBack() : false
      })),
      activeId: this.activeId
    };
  }

  private emit(): void {
    const { tabs, activeId } = this.getState();
    this.hooks.onChange(tabs, activeId);
  }

  private find(id: string): Tab | undefined {
    return this.tabs.find((tab) => tab.id === id);
  }

  activeContents(): Electron.WebContents | undefined {
    return this.find(this.activeId)?.view?.webContents;
  }

  contentsOfKind(kind: TabKind): Electron.WebContents[] {
    return this.tabs.filter((tab) => tab.kind === kind && tab.view).map((tab) => tab.view!.webContents);
  }

  hasKind(kind: TabKind): boolean {
    return this.tabs.some((tab) => tab.kind === kind);
  }

  /* --------------------------------------------------------------- 布局 */

  private contentBounds(): Electron.Rectangle {
    const [width, height] = this.window.getContentSize();
    return { x: 0, y: CHROME_HEIGHT, width, height: Math.max(0, height - CHROME_HEIGHT) };
  }

  private layout(): void {
    const bounds = this.contentBounds();
    for (const tab of this.tabs) {
      if (!tab.view) continue;
      const visible = tab.id === this.activeId;
      tab.view.setBounds(visible ? bounds : { x: 0, y: bounds.y, width: 0, height: 0 });
      // setVisible 在部分版本上没有，用零尺寸兜底
      tab.view.setVisible?.(visible);
    }
  }

  /* --------------------------------------------------------------- 创建 */

  private createView(kind: "site" | "learning"): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, PRELOAD[kind]),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        // 学习通里的视频、音频和答题队列需要在窗口最小化、切到其他桌面后继续运行。
        // 只为学习标签关闭 Chromium 后台节流，主站和工具页仍保持默认节能行为。
        backgroundThrottling: kind !== "learning",
        additionalArguments: [`--cpu-desktop-version=${this.hooks.appVersion}`]
      }
    });
    this.window.contentView.addChildView(view);
    return view;
  }

  private wire(tab: Tab): void {
    const contents = tab.view!.webContents;
    this.hooks.registerKind(contents.id, tab.kind);

    contents.on("page-title-updated", (_event, title) => {
      // 学习通的标题很长，截短好放进标签
      tab.title = title.trim().slice(0, 40) || tab.title;
      this.emit();
    });
    contents.on("did-start-loading", () => { tab.loading = true; this.emit(); });
    contents.on("did-stop-loading", () => { tab.loading = false; this.emit(); });
    contents.on("did-navigate", (_event, url) => {
      tab.url = url;
      this.hooks.onNavigation(contents);
      this.emit();
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) {
        tab.url = url;
        this.hooks.onNavigation(contents);
        this.emit();
      }
    });
    contents.on("did-finish-load", () => this.hooks.onDidFinishLoad(contents));

    // 答题要复制粘贴，标签里也得有右键菜单
    contents.on("context-menu", (_event, params) => {
      const items: Electron.MenuItemConstructorOptions[] = [];
      if (params.selectionText) items.push({ role: "copy", label: "复制" });
      if (params.isEditable) items.push({ role: "cut", label: "剪切" }, { role: "paste", label: "粘贴" });
      if (items.length > 0) Menu.buildFromTemplate(items).popup({ window: this.window });
    });

    // 一律开新标签而不是新窗口，也不丢给系统浏览器 —— 学习通的文档预览、
    // 主站里的外部链接都留在应用里。"不是通用浏览器"的边界靠没有地址栏来守。
    contents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void this.openLearningTab(url, { trusted: true });
      return { action: "deny" };
    });
  }

  /** 常驻的主站标签。loader 由调用方提供，好让它自己决定失败时回落到启动台 */
  async openSiteTab(load: (contents: Electron.WebContents) => Promise<void>): Promise<void> {
    const existing = this.tabs.find((tab) => tab.kind === "site");
    if (existing) {
      this.activate(existing.id);
      return;
    }
    this.counter += 1;
    const tab: Tab = {
      id: `site-${this.counter}`,
      kind: "site",
      title: branding.windowTitle,
      url: "",
      loading: true,
      closable: false,
      view: this.createView("site")
    };
    this.tabs.unshift(tab);
    this.wire(tab);
    this.activeId = tab.id;
    this.layout();
    this.emit();
    await load(tab.view!.webContents);
    tab.loading = false;
    this.emit();
  }

  /** 常驻的工具标签。它没有内容视图，靠隐藏其它视图露出外壳页面 */
  openToolsTab(): void {
    const existing = this.tabs.find((tab) => tab.kind === "tools");
    if (existing) {
      this.activate(existing.id);
      return;
    }
    this.counter += 1;
    const tab: Tab = {
      id: `tools-${this.counter}`,
      kind: "tools",
      title: "工具",
      url: "",
      loading: false,
      closable: false
    };
    // 固定排在主站之后
    const siteIndex = this.tabs.findIndex((item) => item.kind === "site");
    this.tabs.splice(siteIndex + 1, 0, tab);
    this.activate(tab.id);
  }

  /**
   * trusted 表示这个地址来自已经在学习通标签里的页面（它自己的跳转或弹窗）。
   * 这类地址不再要求命中站点白名单 —— 超星登录与文档预览会跳到白名单外的域名，
   * 把它们踢去外部浏览器会直接把会话断在半路。
   * 脚本注入与特权桥不受影响，那两件事始终只看 injectableHosts。
   */
  async openLearningTab(url: string, options: { trusted?: boolean } = {}): Promise<void> {
    const allowed = options.trusted ? isWebUrl(url) : this.hooks.isNavigable(url);
    if (!allowed) {
      this.hooks.openExternally(url);
      return;
    }
    this.counter += 1;
    const tab: Tab = {
      id: `learning-${this.counter}`,
      kind: "learning",
      title: branding.learningTitle,
      url,
      loading: true,
      closable: true,
      view: this.createView("learning")
    };
    this.tabs.push(tab);
    this.wire(tab);
    this.activate(tab.id);
    try {
      await tab.view!.webContents.loadURL(url);
    } catch (error) {
      console.error(`标签加载失败：${url}`, error);
    }
  }

  /* --------------------------------------------------------------- 操作 */

  activate(id: string): void {
    if (!this.find(id)) return;
    this.activeId = id;
    this.layout();
    const contents = this.activeContents();
    if (contents) contents.focus();
    this.emit();
  }

  close(id: string): void {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const tab = this.tabs[index];
    if (!tab.closable) return;
    if (tab.view) {
      this.window.contentView.removeChildView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.tabs.splice(index, 1);
    if (this.activeId === id) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activeId = next ? next.id : "";
    }
    this.layout();
    this.emit();
  }

  reload(id: string): void {
    this.find(id)?.view?.webContents.reload();
  }

  goBack(id: string): void {
    const contents = this.find(id)?.view?.webContents;
    if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
  }

  async navigateSite(url: string): Promise<boolean> {
    const tab = this.tabs.find((item) => item.kind === "site" && item.view);
    if (!tab?.view) return false;
    this.activate(tab.id);
    try {
      await tab.view.webContents.loadURL(url);
      return true;
    } catch (error) {
      console.error(`主站导航失败：${url}`, error);
      return false;
    }
  }

  closeAllLearningTabs(): void {
    for (const tab of [...this.tabs]) if (tab.kind === "learning") this.close(tab.id);
  }

  destroy(): void {
    // 这个方法会在主窗口 closed 之后被调用，那时 window 已经销毁，
    // 再碰 contentView 会抛 "Object has been destroyed"。
    const windowAlive = !this.window.isDestroyed();
    for (const tab of this.tabs) {
      if (!tab.view) continue;
      try {
        if (windowAlive) this.window.contentView.removeChildView(tab.view);
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      } catch {
        // 窗口连带视图一起销毁的情况，忽略即可
      }
    }
    this.tabs = [];
  }
}
