<template>
  <!-- 原生壳按 .layout-root > .footer 注入样式；根节点类名和 footer-main / footer-bottom / footer-app-filing 不能改。 -->
  <footer class="footer" :class="{ 'footer--app': appFiling, 'footer--compact': compact }">
    <div class="footer-inner">
      <div class="footer-main">
        <div class="footer-brand-block">
          <router-link class="footer-brand" to="/home">
            <img class="footer-brand-mark" :src="'/favicon.svg?v=20260830'" alt="" aria-hidden="true" decoding="async" />
            药大拾间
          </router-link>
          <p class="footer-tagline">CPU 校园互助服务</p>
          <p class="footer-company">球谐信息技术（深圳）有限公司</p>
        </div>

        <nav class="footer-col footer-col--use" aria-label="常用入口">
          <h2>使用</h2>
          <router-link to="/services">校园服务</router-link>
          <router-link to="/schedule">课表</router-link>
          <router-link to="/download">客户端下载</router-link>
        </nav>

        <nav class="footer-col" aria-label="关于与条款">
          <h2>关于</h2>
          <a href="/about.html">了解我们</a>
          <a href="/terms.html">用户协议</a>
          <a href="/privacy.html">隐私政策</a>
          <a href="https://github.com/sx120609/CPU-web" target="_blank" rel="noopener noreferrer">GitHub</a>
        </nav>

        <address class="footer-col footer-contact">
          <h2>联系</h2>
          <a href="tel:19984839722" aria-label="联系电话 19984839722">19984839722</a>
          <a href="mailto:admin@lizmt.cn">admin@lizmt.cn</a>
          <p>深圳市南山区高新南九道51号航空航天大厦1号楼2302</p>
        </address>
      </div>

      <div class="footer-bottom">
        <span>© 2026 药大拾间 · 非学校官方站点</span>
        <a v-if="site.siteFilingNumber" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{{ site.siteFilingNumber }}</a>
      </div>

      <div v-if="appFiling" class="footer-app-filing">
        <a :href="APP_FILING_URL" target="_blank" rel="noopener noreferrer">APP 备案号：{{ APP_FILING_NUMBER }}</a>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { useSiteStore } from "@/stores/site";
import { APP_FILING_NUMBER, APP_FILING_URL } from "../../../../shared/appFiling";

// appFiling：已备案的移动端壳内显示 APP 备案号；compact：旧 Flutter 壳只保留备案号一行。
defineProps<{ appFiling?: boolean; compact?: boolean }>();

const site = useSiteStore();
</script>

<style scoped>
/* --footer-clearance 由 MainLayout 按底部标签栏 / 原生壳占位设置。 */
.footer {
  padding: 30px 20px calc(16px + var(--footer-clearance, 0px));
  border-top: 1px solid var(--cpu-border-soft);
  background: color-mix(in srgb, var(--cpu-surface) 94%, var(--cpu-bg));
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.footer-inner {
  max-width: 1240px;
  margin: 0 auto;
}

.footer a {
  color: inherit;
  text-decoration: none;
  transition: color 160ms ease;
}

.footer a:focus-visible {
  border-radius: 3px;
  outline: 2px solid var(--cpu-primary);
  outline-offset: 3px;
}

@media (hover: hover) {
  .footer a:hover { color: var(--cpu-primary); }
}

.footer-main {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, .7fr)) minmax(0, 1.2fr);
  gap: 16px 40px;
  padding-bottom: 24px;
}

.footer-brand-block { min-width: 0; }

.footer a.footer-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--cpu-text);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
}

.footer-brand-mark {
  display: block;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border-radius: 9px;
  object-fit: contain;
}

.footer-tagline,
.footer-company { margin: 0; }
.footer-tagline { margin-top: 12px; }
.footer-company { margin-top: 2px; color: var(--cpu-text-muted); font-size: 12px; }

.footer-col {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  font-style: normal;
}

.footer-col h2 {
  margin: 4px 0 8px;
  color: var(--cpu-text);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.5;
}

.footer-col a {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
}

.footer-contact a { font-variant-numeric: tabular-nums; }
.footer-contact p {
  margin: 5px 0 0;
  color: var(--cpu-text-muted);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.footer-bottom {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 24px;
  padding-top: 14px;
  border-top: 1px solid var(--cpu-border-soft);
  color: var(--cpu-text-muted);
  font-size: 12px;
}

.footer-bottom a {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
}

.footer-app-filing {
  margin-top: 8px;
  font-size: 12px;
  text-align: center;
}

.footer-app-filing a {
  display: inline-flex;
  min-height: 48px;
  max-width: 100%;
  align-items: center;
  justify-content: center;
  overflow-wrap: anywhere;
}

/* 桌面端右下角有悬浮按钮，窗口不够宽时给它们让出位置。 */
@media (min-width: 961px) and (max-width: 1439px) {
  .footer-inner { padding-right: 76px; }
}

/* 移动端只保留品牌、条款、联系方式和版权信息，各占一行。 */
@media (max-width: 768px) {
  .footer {
    padding: 16px max(16px, env(safe-area-inset-right, 0px)) calc(10px + var(--footer-clearance, 0px)) max(16px, env(safe-area-inset-left, 0px));
    font-size: 12px;
  }

  .footer-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-bottom: 8px;
  }

  .footer a.footer-brand { gap: 8px; margin-bottom: 4px; font-size: 16px; }
  .footer-brand-mark { width: 26px; height: 26px; border-radius: 7px; }

  .footer-tagline,
  .footer-company,
  .footer-col--use,
  .footer-col h2,
  .footer-contact p { display: none; }

  .footer-col { flex-flow: row wrap; gap: 0 18px; }
  .footer-col a { min-height: 28px; }

  .footer-bottom { padding-top: 8px; font-size: 11px; }
  .footer-bottom a { min-height: 24px; }
}

@media (prefers-reduced-motion: reduce) {
  .footer a { transition: none; }
}

/* 原生壳里页脚只留 APP 备案号一行。 */
.footer--compact .footer-main,
.footer--compact .footer-bottom,
:global(html[data-cpu-ios-next] .footer--app .footer-main),
:global(html[data-cpu-ios-next] .footer--app .footer-bottom),
:global(html[data-cpu-harmony-native] .footer--app .footer-main),
:global(html[data-cpu-harmony-native] .footer--app .footer-bottom) {
  display: none;
}

:global(html[data-cpu-ios-next] .layout-root > .footer.footer--app) {
  padding: 6px 20px calc(10px + var(--cpu-ios-bottom-clearance, 96px));
  border-top: 0;
  background: transparent;
}

:global(html[data-cpu-ios-next] .footer--app .footer-app-filing) {
  margin-top: 0;
  font-size: 10px;
}

:global(html[data-cpu-ios-next] .footer--app .footer-app-filing a) {
  min-height: 36px;
}

/* Installed Harmony shells hide the old footer; keep the app filing reachable. */
:global(html[data-cpu-harmony-native] .layout-root > .footer.footer--app) {
  display: block !important;
  padding-bottom: calc(16px + var(--cpu-harmony-bottom-clearance, 96px));
}
</style>
