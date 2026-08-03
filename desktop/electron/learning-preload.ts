import { contextBridge, ipcRenderer } from "electron";

// 全局名同时出现在 electron/main.ts 的 createInjection() 里，改名要两边一起改
// （sandbox:true 的 preload 不能 require 本地模块，所以只能重复这个字面量）。
//
// 每次调用都必须带上主进程注入时下发的一次性 nonce：仅仅暴露这个对象不构成授权，
// 主进程会同时校验 nonce、发起 frame 的 URL 与 webContents 归属。
contextBridge.exposeInMainWorld("cpuDesktopBridge", {
  fetchText: (nonce: string, url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; responseType?: string; timeout?: number }) =>
    ipcRenderer.invoke("userscript:fetch-text", nonce, url, options),
  requestAi: (nonce: string, body: string) => ipcRenderer.invoke("userscript:request-ai", nonce, body),
  captureArea: (nonce: string, rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke("userscript:capture-area", nonce, rect),
  // 脚本改了自己的配置时回传，让客户端界面与脚本保持同一份真相
  setValue: (nonce: string, key: string, json: string) => ipcRenderer.invoke("userscript:set-value", nonce, key, json),
  // 脚本的运行状态与日志，转发到客户端显示
  report: (nonce: string, payload: string) => ipcRenderer.invoke("userscript:report", nonce, payload)
});

/* --------------------------------------------------- 学习通「记住密码」 */
// 只在超星账号登录页生效。域名字面量与 electron/config.ts 的 chaoxingLoginHost
// 保持一致（sandbox preload 不能 require 本地模块）。「记住密码」开关没开时
// 主进程直接回 null，这里既不装钩子也不碰输入框。
//
// tsconfig 没开 DOM lib（主进程代码不该拿到 DOM 类型），下面只声明用到的最小
// 形状，且都在模块作用域内，不影响其它文件。Event 用的是 @types/node 的全局声明。

type LoginInput = { value: string; dispatchEvent(event: Event): void };
declare const document: {
  readonly readyState: string;
  querySelector(selector: string): LoginInput | null;
  addEventListener(type: string, listener: (event: { key?: string; target: unknown }) => void, capture?: boolean): void;
};
declare const window: {
  location: { hostname: string };
  addEventListener(type: string, listener: () => void): void;
};

const ACCOUNT_SELECTOR = "#phone, input[name='phone'], input[name='uname']";
const PASSWORD_SELECTOR = "#pwd, input[type='password']";

const inputValue = (selector: string): string => document.querySelector(selector)?.value ?? "";

const fillInput = (selector: string, value: string): void => {
  const input = document.querySelector(selector);
  // 用户已经开始输入就不覆盖
  if (!input || input.value) return;
  input.value = value;
  // 登录页脚本可能监听 input/change 同步内部状态
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

const offerCredential = (): void => {
  const account = inputValue(ACCOUNT_SELECTOR).trim();
  const password = inputValue(PASSWORD_SELECTOR);
  // 短信验证码 / 二维码登录没有密码可存
  if (!account || !password) return;
  void ipcRenderer.invoke("chaoxing:offer-credential", account, password).catch(() => undefined);
};

const setupChaoxingLogin = async (): Promise<void> => {
  let grant: { credential: { account: string; password: string } | null } | null;
  try {
    grant = await ipcRenderer.invoke("chaoxing:credential");
  } catch {
    return;
  }
  if (!grant) return;

  if (grant.credential) {
    fillInput(ACCOUNT_SELECTOR, grant.credential.account);
    fillInput(PASSWORD_SELECTOR, grant.credential.password);
  }

  // 捕获阶段抢在页面自己的处理器之前取值：登录脚本随后会把密码域加密替换。
  // 触发条件放得很宽（点登录按钮、任意处按回车），offerCredential 自己会
  // 在两个输入框凑不齐时静默返回。
  document.addEventListener("click", (event) => {
    const target = event.target as { closest?: (selector: string) => unknown } | null;
    if (target?.closest?.("#loginBtn, button[type='submit'], input[type='submit'], .btn-big-blue")) offerCredential();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter") offerCredential();
  }, true);
};

if (window.location.hostname === "passport2.chaoxing.com") {
  const run = (): void => void setupChaoxingLogin();
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", run);
  else run();
}
