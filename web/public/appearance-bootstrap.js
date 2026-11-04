(() => {
  const storageKey = "cpu-appearance-mode-v1";
  let mode = "system";
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark" || stored === "system") mode = stored;
  } catch {}
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = mode === "system" ? (prefersDark ? "dark" : "light") : mode;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.appearanceMode = mode;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  const themeColor = document.querySelector("meta[name='theme-color']");
  if (themeColor) themeColor.setAttribute("content", resolved === "dark" ? "#0e1012" : "#f8fafc");

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos || !window.matchMedia) return;

  const splashScreens = [
    ["750x1334", "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"],
    ["828x1792", "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"],
    ["1125x2436", "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"],
    ["1170x2532", "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"],
    ["1179x2556", "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"],
    ["1242x2688", "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"],
    ["1290x2796", "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"],
    ["1536x2048", "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"],
    ["1668x2388", "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"],
    ["2048x2732", "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"],
  ];
  const matched = splashScreens.find(([, media]) => window.matchMedia(media).matches);
  if (!matched) return;
  const link = document.createElement("link");
  link.rel = "apple-touch-startup-image";
  link.href = `/splash/ios-launch-v6-${matched[0]}.png?v=20260830`;
  link.media = matched[1];
  document.head.appendChild(link);
})();

// 拾间品牌下的学校：上次用的是哪所学校，启动画面和标签页标题先显示那所学校的品牌，
// 不要先闪一下默认学校（药大拾间）。品牌由网页在拿到学校信息后写入（stores/site.ts）。
(function () {
  let brand = null;
  try {
    brand = JSON.parse(window.localStorage.getItem("cpu-school-brand-v1") || "null");
  } catch {
    return;
  }
  if (!brand || typeof brand.brandName !== "string" || !brand.brandName || brand.brandName.length > 20) return;
  const brandName = brand.brandName;
  const schoolName = typeof brand.schoolName === "string" ? brand.schoolName.slice(0, 40) : "";
  if (document.title.indexOf("药大拾间") === 0) {
    document.title = schoolName ? `${brandName} · ${schoolName}校园互助与服务平台` : brandName;
  } else if (/ · 药大拾间$/.test(document.title)) {
    // 服务端给搜索引擎的页面标题（「论坛 · 药大拾间」），网页加载前先换成上次的学校。
    document.title = document.title.replace(/ · 药大拾间$/, ` · ${brandName}`);
  }
  // 「了解我们」「社区规范」这类说明页（body 标了 data-school-brand）把品牌和校名换成上次的学校；
  // 用户协议、隐私政策是法律文本，不标这个属性，原样显示。
  // 标了 data-school-only 的段落只给对应学校看：药大独有的说明在外校去掉，外校的补充说明（默认 hidden）在本校显示。
  const schoolId = typeof brand.schoolId === "string" ? brand.schoolId : (brandName === "药大拾间" ? "cpu" : "");
  const applySchoolOnly = () => {
    if (!schoolId) return;
    const scoped = document.querySelectorAll("[data-school-only]");
    for (let index = 0; index < scoped.length; index++) {
      const element = scoped[index];
      if (element.getAttribute("data-school-only") === schoolId) element.removeAttribute("hidden");
      else element.parentNode && element.parentNode.removeChild(element);
    }
  };
  const swapPageBrand = () => {
    if (!document.body || !document.body.hasAttribute("data-school-brand")) return;
    applySchoolOnly();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue || "";
      if (text.indexOf("药大拾间") < 0 && text.indexOf("中国药科大学") < 0) continue;
      node.nodeValue = text.split("药大拾间").join(brandName).split("中国药科大学").join(schoolName || "本校");
    }
    document.title = document.title.split("药大拾间").join(brandName);
  };
  const apply = () => {
    swapPageBrand();
    const screen = document.getElementById("boot-screen");
    if (!screen) return;
    screen.setAttribute("aria-label", `${brandName}正在启动`);
    const title = screen.querySelector(".app-launch-title");
    if (title) title.textContent = brandName;
    const logo = screen.querySelector(".app-launch-logo");
    if (logo) logo.setAttribute("aria-label", brandName);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply, { once: true });
  else apply();
})();
