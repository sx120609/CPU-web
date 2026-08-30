export type WechatJsSdkConfig = {
  appId: string;
  timestamp: number;
  nonceStr: string;
  signature: string;
};

type WechatSdk = {
  config: (input: Record<string, unknown>) => void;
  ready: (callback: () => void) => void;
  error: (callback: (error: unknown) => void) => void;
};

declare global {
  interface Window {
    wx?: WechatSdk;
    WeixinJSBridge?: { call: (name: string, options?: Record<string, unknown>) => void };
  }
}

let sdkPromise: Promise<WechatSdk> | null = null;

export function isWechatBrowser() {
  return /MicroMessenger/iu.test(navigator.userAgent);
}

export function hideWechatToolbarBestEffort() {
  if (!isWechatBrowser()) return;
  const hide = () => {
    try {
      window.WeixinJSBridge?.call("hideToolbar");
    } catch {
      // This legacy bridge method is best-effort and must never block the page.
    }
  };
  if (window.WeixinJSBridge) hide();
  else document.addEventListener("WeixinJSBridgeReady", hide, { once: true });
  window.setTimeout(hide, 120);
}

export async function mountWechatSubscribeButton(
  container: HTMLElement,
  templateId: string,
  config: WechatJsSdkConfig,
  callbacks?: { onSuccess?: (detail: unknown) => void; onError?: (detail: unknown) => void },
) {
  const wx = await loadWechatSdk();
  await new Promise<void>((resolve, reject) => {
    wx.ready(resolve);
    wx.error(reject);
    wx.config({
      debug: false,
      ...config,
      jsApiList: [],
      openTagList: ["wx-open-subscribe"],
    });
  });

  const tag = document.createElement("wx-open-subscribe");
  tag.id = "wechat-subscribe-button";
  tag.setAttribute("template", templateId);
  const style = document.createElement("script");
  style.type = "text/wxtag-template";
  style.slot = "style";
  style.textContent = `<style>
    .subscribe-button {
      width: 100%; min-height: 42px; padding: 0 18px; border: 0; border-radius: 8px;
      color: #fff; background: #07c160; font-size: 15px; font-weight: 600;
    }
  </style>`;
  const button = document.createElement("script");
  button.type = "text/wxtag-template";
  button.textContent = '<button class="subscribe-button">订阅下一条微信提醒</button>';
  tag.append(style, button);
  const success = (event: Event) => callbacks?.onSuccess?.((event as CustomEvent).detail);
  const error = (event: Event) => callbacks?.onError?.((event as CustomEvent).detail);
  tag.addEventListener("success", success);
  tag.addEventListener("error", error);
  container.replaceChildren(tag);
  return () => {
    tag.removeEventListener("success", success);
    tag.removeEventListener("error", error);
    if (container.contains(tag)) container.replaceChildren();
  };
}

function loadWechatSdk() {
  if (window.wx) return Promise.resolve(window.wx);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<WechatSdk>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-wechat-js-sdk="1"]');
    const script = existing || document.createElement("script");
    const onLoad = () => window.wx ? resolve(window.wx) : reject(new Error("微信 JS-SDK 未正确加载"));
    const onError = () => reject(new Error("微信 JS-SDK 加载失败"));
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = "https://res.wx.qq.com/open/js/jweixin-1.6.0.js";
      script.async = true;
      script.dataset.wechatJsSdk = "1";
      document.head.appendChild(script);
    }
  }).catch((error) => {
    sdkPromise = null;
    throw error;
  });
  return sdkPromise;
}
