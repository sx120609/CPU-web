/// <reference types="vite/client" />

interface Window {
  courseBot: {
    // ── 平台登录 ──
    ssoBegin(): Promise<{ pendingId: string; needCaptcha: boolean; captchaImage?: string }>;
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
    loadToken(): Promise<string | null>;
    clearToken(): Promise<void>;
    getQuota(): Promise<{
      aiBalance: number;
      totalConsumed: number;
      totalGranted: number;
      videoFree: boolean;
    }>;
    heartbeat(): Promise<{
      alive: boolean;
      quota: { aiBalance: number };
      config: Record<string, unknown>;
    }>;

    // ── 学习通 ──
    chaoxingLogin(
      phone: string,
      password: string
    ): Promise<{
      ok: boolean;
      user?: { uid: string; name: string; phone: string };
      error?: string;
    }>;
    chaoxingLogout(): Promise<void>;
    chaoxingStatus(): Promise<{
      loggedIn: boolean;
      user: { uid: string; name: string; phone: string } | null;
    }>;
    getCourses(): Promise<
      Array<{
        courseId: string;
        clazzId: string;
        cpi: string;
        name: string;
        teacher: string;
        image: string;
        progress: number | null;
      }>
    >;
    getChapters(
      courseId: string,
      clazzId: string,
      cpi: string
    ): Promise<any[]>;

    // ── 刷课控制 ──
    startCourse(
      courseId: string,
      clazzId: string,
      cpi: string,
      chapters: any[]
    ): Promise<{ ok: boolean; message: string }>;
    stopCourse(): Promise<void>;
    showChaoxingWindow(): Promise<void>;

    // ── 进度 ──
    onProgress(
      cb: (e: {
        type: string;
        message: string;
        chapter?: string;
        task?: string;
        progress?: number;
        data?: unknown;
      }) => void
    ): () => void;
  };
}
