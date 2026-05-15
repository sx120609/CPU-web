/**
 * 最小化的 Service Worker。
 *
 * 存在的唯一目的：满足 Chrome PWA "installable" 条件——必须有一个注册过的 SW
 * 且它至少有一个 fetch handler，beforeinstallprompt 事件才会触发。
 *
 * 这里 fetch handler 完全透传不做缓存，避免离线/缓存逻辑带来的复杂性与坑。
 * 真要做离线缓存时再扩展。
 */
self.addEventListener("install", (event) => {
  // 立即激活，不等旧版本结束
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // 接管所有客户端
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // 完全透传，不做缓存——但必须有这个 handler，PWA 才被视为 installable
  // 不调用 event.respondWith() 等于让浏览器走默认网络请求
});
