/// <reference types="vite/client" />

interface Window {
  /** 由 preload 注入的桥接 API */
  courseBot: {
    /** SSO 两步登录：第一步拿验证码与 pendingId */
    ssoBegin(): Promise<{ pendingId: string; needCaptcha: boolean; captchaImage?: string }>;
    /** SSO 两步登录：第二步提交学号密码 */
    ssoLogin(args: {
      pendingId: string;
      username: string;
      password: string;
      captcha?: string;
    }): Promise<{
      ok: boolean;
      siteToken?: string;
      error?: string;
      needCaptcha?: boolean;
      captcha?: string;
      user?: { id: number; username: string; nickname: string };
      needNickname?: boolean;
    }>;
    /** 读取本地持久化的 JWT（启动时自动恢复会话用） */
    loadToken(): Promise<string | null>;
    /** 清除本地 JWT（登出） */
    clearToken(): Promise<void>;
    /** 查 AI 额度 */
    getQuota(): Promise<{ aiBalance: number; totalConsumed: number; totalGranted: number; videoFree: boolean }>;
    /** 心跳 */
    heartbeat(): Promise<{ alive: boolean; quota: { aiBalance: number }; config: Record<string, unknown> }>;
    /** 打开学习通窗口（用户在里面登录学习通） */
    openChaoxing(): Promise<void>;
    /** 开始自动刷视频 */
    startAutoPlay(): Promise<{ ok: boolean; message: string }>;
    /** 停止自动刷视频 */
    stopAutoPlay(): Promise<void>;
    /** 监听刷课进度事件（主进程 -> 渲染进程） */
    onProgress(cb: (e: { type: string; message: string; data?: unknown }) => void): void>;
  };
}
