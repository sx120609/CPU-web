import type { ZhsSnapshot, ZhsSettings } from "../../../web/src/api/zhihuishu";
export type { ZhsSnapshot, ZhsSettings, ZhsLog } from "../../../web/src/api/zhihuishu";
declare global {
  interface Window { cpuZhihuishu: { request: (action: string, input?: unknown) => Promise<{ ok: boolean; value?: unknown; error?: string }> } }
}
async function call<T>(action: string, input?: unknown): Promise<T> {
  const reply = await window.cpuZhihuishu.request(action, input);
  if (!reply.ok) throw new Error(reply.error || "本机执行组件连接失败");
  return reply.value as T;
}
export const zhihuishuApi = {
  session: () => call<ZhsSnapshot>("session"),
  login: () => call<ZhsSnapshot>("login"),
  disconnect: () => call<ZhsSnapshot>("disconnect"),
  refresh: () => call<ZhsSnapshot>("refresh"),
  start: (keys: string[], speed = 1) => call<ZhsSnapshot>("start", { keys, speed }),
  settings: () => call<ZhsSettings>("settings"),
  saveSettings: (input: Pick<ZhsSettings, "autoAnswer" | "autoSubmit">) => call<ZhsSettings>("saveSettings", input),
};
