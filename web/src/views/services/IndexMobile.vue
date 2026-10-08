<template>
  <div class="svc-m">
    <header class="svc-m-head">
      <h1>校园服务</h1>
      <router-link v-if="jwxt.isLoggedIn" class="svc-m-status is-on" to="/jwxt">
        <span class="svc-m-dot" aria-hidden="true" />教务已连接
      </router-link>
      <router-link v-else-if="!academicDataUnavailable" class="svc-m-status" to="/jwxt">
        登录教务<el-icon aria-hidden="true"><ArrowRight /></el-icon>
      </router-link>
    </header>

    <div class="svc-m-search" role="search">
      <el-icon aria-hidden="true"><Search /></el-icon>
      <input
        v-model="keyword"
        type="search"
        maxlength="40"
        enterkeyhint="search"
        autocomplete="off"
        aria-label="搜索校园服务"
        :placeholder="jwxt.isLoggedIn ? '搜索工具或校园应用' : '搜索校园工具'"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <button v-if="keyword" data-cpu-button="surface" type="button" aria-label="清空搜索" @click="keyword = ''">
        <el-icon><CircleCloseFilled /></el-icon>
      </button>
    </div>

    <section v-if="matchedShortcuts.length" class="svc-m-shortcuts" aria-label="常用功能">
      <button
        v-for="item in matchedShortcuts"
        :key="item.key"
        data-cpu-button="surface"
        type="button"
        class="svc-m-shortcut"
        :style="{ '--tone': item.tone }"
        @click="item.open()"
      >
        <span class="svc-m-tile" aria-hidden="true"><AppIcon :name="item.icon" /></span>
        <span class="svc-m-shortcut-copy">
          <b>{{ item.title }}</b>
          <small>{{ item.sub }}</small>
        </span>
      </button>
    </section>

    <section v-if="matchedTools.length || (!searching && toolsError)" class="svc-m-section" aria-labelledby="svc-m-tools-title">
      <header class="svc-m-section-head">
        <h2 id="svc-m-tools-title">校园小工具</h2>
        <router-link v-if="!searching" to="/services/tools">全部<el-icon aria-hidden="true"><ArrowRight /></el-icon></router-link>
      </header>
      <p v-if="toolsError && !searching" class="svc-m-warning">
        <span>{{ toolsError }}</span>
        <button data-cpu-button="surface" type="button" :disabled="toolsLoading" @click="loadToolMetas">重试</button>
      </p>

      <div v-if="!searching" class="svc-m-tool-grid" :aria-busy="toolsLoading">
        <button
          v-for="tool in matchedTools"
          :key="tool.slug"
          data-cpu-button="surface"
          type="button"
          class="svc-m-tool"
          :style="{ '--tone': tool.accent }"
          @click="openTool(tool)"
        >
          <span class="svc-m-tile">
            <el-icon aria-hidden="true"><component :is="tool.iconComponent" /></el-icon>
            <span v-if="needsLogin(tool.slug)" class="svc-m-lock" title="需登录"><el-icon><Lock /></el-icon></span>
          </span>
          <span class="svc-m-tool-name">{{ tool.name }}</span>
          <span v-if="needsLogin(tool.slug)" class="svc-m-sr">（需登录）</span>
        </button>
      </div>

      <div v-else class="svc-m-rows">
        <ToolRowMobile
          v-for="tool in matchedTools"
          :key="tool.slug"
          :tool="tool"
          :badge="toolBadge(tool)"
          :login-required="isLoginRequired(tool.slug)"
          @click="openTool(tool)"
        />
      </div>
    </section>

    <section v-show="!searching || appMatchCount" class="svc-m-section" aria-labelledby="svc-m-apps-title">
      <header class="svc-m-section-head">
        <h2 id="svc-m-apps-title">校园应用</h2>
        <span v-if="jwxt.isLoggedIn && !searching">来自学校融合门户</span>
      </header>

      <IServiceMobilePane v-if="jwxt.isLoggedIn" :keyword="keyword" @matches="appMatches = $event" />

      <div v-else-if="academicDataUnavailable" class="svc-m-card svc-m-notice">
        <span class="svc-m-tile" aria-hidden="true"><el-icon><InfoFilled /></el-icon></span>
        <div>
          <b>暂无教务数据</b>
          <p>当前账号已完成站内登录，但学校暂未开放可读取的教务数据；公共服务仍可正常使用，教务相关入口会在数据可用后自动显示，不需要重新登录。</p>
          <router-link to="/jwxt">查看教务说明<el-icon aria-hidden="true"><ArrowRight /></el-icon></router-link>
        </div>
      </div>

      <div v-else class="svc-m-card svc-m-login">
        <div class="svc-m-login-head">
          <span class="svc-m-tile" aria-hidden="true"><el-icon><Lock /></el-icon></span>
          <div>
            <b>登录后可查看更完整的服务列表</b>
            <p>登录后可查看更多校园应用和常用入口。</p>
          </div>
        </div>
        <el-button type="primary" size="large" @click="$router.push('/jwxt')">前往登录</el-button>
        <div class="svc-m-login-note">
          <p>学号 / 工号仅用于关联站内账号；勾选保持登录后会在当前浏览器加密保存账号密码，验证码不会保存。</p>
          <PrivacyPolicyNotice align="left" compact />
        </div>
      </div>
    </section>

    <section v-if="matchedLinks.length" class="svc-m-section" aria-labelledby="svc-m-links-title">
      <header class="svc-m-section-head">
        <h2 id="svc-m-links-title">公开入口</h2>
        <span>在新页面打开</span>
      </header>
      <div class="svc-m-links">
        <a v-for="link in matchedLinks" :key="link.url" :href="link.url" target="_blank" rel="noopener noreferrer">
          <AppIcon :name="link.icon" /><span>{{ link.name }}</span>
        </a>
      </div>
    </section>

    <div v-if="searching && !hasMatches" class="svc-m-card svc-m-empty">
      <b>没有找到“{{ keyword.trim() }}”相关的服务</b>
      <p>换个关键词试试，或到全站搜索里找找。</p>
      <el-button type="primary" plain @click="searchSite">全站搜索</el-button>
    </div>

    <DormElectricDialog v-model="electricOpen" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { ArrowRight, CircleCloseFilled, InfoFilled, Lock, Search } from "@element-plus/icons-vue";
import AppIcon from "@/components/common/AppIcon.vue";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";
import IServiceMobilePane from "@/components/jwxt/IServiceMobilePane.vue";
import DormElectricDialog from "@/components/services/DormElectricDialog.vue";
import ToolRowMobile from "./components/ToolRowMobile.vue";
import { publicServiceLinks, useInjectedServicesPage } from "./servicesPage";

const router = useRouter();
const {
  jwxt,
  auth,
  electricOpen,
  electricAvailable,
  toolsLoading,
  toolsError,
  visibleTools,
  academicDataUnavailable,
  loadToolMetas,
  isLoginRequired,
  toolBadge,
  openTool,
  keyword,
} = useInjectedServicesPage();

const appMatches = ref(0);
const appMatchCount = computed(() => (jwxt.isLoggedIn ? appMatches.value : 0));
const needle = computed(() => keyword.value.trim().toLowerCase());
const searching = computed(() => Boolean(needle.value));

const shortcuts = computed(() => [
  ...(electricAvailable.value ? [{
    key: "electric",
    icon: "electric",
    tone: "#d97706",
    title: "宿舍电费",
    sub: "剩余电量与金额",
    open: () => { electricOpen.value = true; },
  }] : []),
  {
    key: "download",
    icon: "download",
    tone: "#2563eb",
    title: "客户端下载",
    sub: "桌面端与手机端",
    open: () => { void router.push("/download"); },
  },
]);

const matchedShortcuts = computed(() => shortcuts.value.filter((item) => matches(item.title, item.sub)));
const matchedTools = computed(() => visibleTools.value.filter((tool) => matches(tool.name, tool.summary, tool.category, tool.description)));
// 已登录教务时完整应用列表里已包含这些入口，不再重复展示。
const matchedLinks = computed(() => (jwxt.isLoggedIn ? [] : publicServiceLinks.filter((link) => matches(link.name))));
const hasMatches = computed(() => Boolean(
  matchedShortcuts.value.length
  || matchedTools.value.length
  || matchedLinks.value.length
  || appMatchCount.value,
));

function matches(...fields: string[]) {
  return !needle.value || fields.some((field) => field.toLowerCase().includes(needle.value));
}

function needsLogin(slug: string) {
  return !auth.isLoggedIn && isLoginRequired(slug);
}

function searchSite() {
  void router.push({ name: "site-search", query: { q: keyword.value.trim(), scope: "services" } });
}
</script>

<style scoped>
.svc-m {
  --svc-m-tile-fill: 11%;
  --svc-m-tile-ink: 100%;
  display: flex;
  min-width: 0;
  max-width: 720px;
  margin: 0 auto;
  flex-direction: column;
  gap: 16px;
  color: var(--cpu-text);
}
.svc-m button,
.svc-m a { -webkit-tap-highlight-color: transparent; }
.svc-m :is(button, a):focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.svc-m-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

.svc-m-head { display: flex; min-height: 32px; align-items: center; justify-content: space-between; gap: 12px; padding: 0 2px; }
.svc-m-head h1 { margin: 0; font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.3; letter-spacing: -.01em; }
.svc-m-status {
  display: inline-flex;
  min-height: 30px;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 0 11px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
  text-decoration: none;
}
.svc-m-status.is-on { gap: 6px; background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); }
.svc-m-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--cpu-success); }

.svc-m-search {
  display: flex;
  height: 44px;
  align-items: center;
  gap: 8px;
  margin-top: -4px;
  padding: 0 6px 0 13px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
  transition: border-color .15s;
}
.svc-m-search:focus-within { border-color: var(--cpu-primary); }
.svc-m-search > .el-icon { flex: 0 0 auto; color: var(--cpu-text-muted); font-size: var(--cpu-fs-l); }
.svc-m-search input {
  min-width: 0;
  height: 100%;
  flex: 1;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--cpu-text);
  font: inherit;
  /* 16px 以下 iOS 会在聚焦时放大页面 */
  font-size: var(--cpu-fs-l);
  appearance: none;
}
.svc-m-search input::placeholder { color: var(--cpu-text-muted); }
.svc-m-search input::-webkit-search-cancel-button { display: none; }
.svc-m-search button {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-l);
  cursor: pointer;
}

/* 图标底块：浅色主题用强调色淡底，暗色主题提亮图标本身。 */
.svc-m-tile {
  position: relative;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  background: color-mix(in srgb, var(--tone, var(--cpu-primary)) var(--svc-m-tile-fill), var(--cpu-card));
  color: color-mix(in srgb, var(--tone, var(--cpu-primary)) var(--svc-m-tile-ink), var(--cpu-text));
}

.svc-m-shortcuts { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.svc-m-shortcut {
  display: flex;
  min-width: 0;
  min-height: 62px;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform .12s ease;
}
.svc-m-shortcut .svc-m-tile { width: 38px; height: 38px; border-radius: var(--cpu-radius-m); font-size: var(--cpu-fs-xl); }
.svc-m-shortcut-copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.svc-m-shortcut-copy b { overflow: hidden; font-size: var(--cpu-fs-m); font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.svc-m-shortcut-copy small { overflow: hidden; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); text-overflow: ellipsis; white-space: nowrap; }

.svc-m-section { display: flex; min-width: 0; flex-direction: column; gap: 10px; }
.svc-m-section-head { display: flex; min-height: 24px; align-items: center; justify-content: space-between; gap: 12px; padding: 0 2px; }
.svc-m-section-head h2 { margin: 0; font-size: var(--cpu-fs-l); font-weight: 700; line-height: 1.4; }
.svc-m-section-head > span { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.svc-m-section-head a,
.svc-m-notice a {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 1px;
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
  text-decoration: none;
}

.svc-m-warning {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  padding: 8px 8px 8px 12px;
  border: 1px solid var(--cpu-accent-soft);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-accent-soft);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  line-height: 1.5;
}
.svc-m-warning button {
  min-height: 30px;
  flex: 0 0 auto;
  padding: 0 10px;
  border: 0;
  border-radius: var(--cpu-radius-m);
  background: transparent;
  color: var(--cpu-primary);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}

.svc-m-card,
.svc-m-tool-grid,
.svc-m-rows {
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}

.svc-m-tool-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2px 0; padding: 10px 6px; }
.svc-m-tool-grid[aria-busy="true"] { opacity: .72; }
.svc-m-tool {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 86px;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 9px 2px 6px;
  border: 0;
  border-radius: var(--cpu-radius-l);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: transform .12s ease;
}
.svc-m-tool .svc-m-tile { width: 46px; height: 46px; border-radius: var(--cpu-radius-l); font-size: var(--cpu-fs-xl); }
.svc-m-tool-name {
  display: -webkit-box;
  max-width: 100%;
  overflow: hidden;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
  line-height: 1.3;
  text-align: center;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.svc-m-lock {
  position: absolute;
  top: -4px;
  right: -4px;
  display: grid;
  width: 17px;
  height: 17px;
  place-items: center;
  border: 2px solid var(--cpu-card);
  border-radius: 50%;
  background: var(--cpu-gold);
  color: #fff;
  font-size: var(--cpu-fs-xs);
}
.svc-m-shortcut:active,
.svc-m-tool:active { transform: scale(.96); }

.svc-m-rows { overflow: hidden; }
.svc-m-card { padding: 14px; }
.svc-m-card b { font-size: var(--cpu-fs-m); font-weight: 500; line-height: 1.4; }
.svc-m-card p { margin: 3px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.65; }
.svc-m-card .svc-m-tile { width: 40px; height: 40px; border-radius: var(--cpu-radius-l); font-size: var(--cpu-fs-xl); }

.svc-m-notice,
.svc-m-login-head { display: flex; align-items: flex-start; gap: 12px; }
.svc-m-notice > div,
.svc-m-login-head > div { min-width: 0; flex: 1; }
.svc-m-notice a { margin-top: 4px; }
.svc-m-login { display: flex; flex-direction: column; gap: 12px; }
.svc-m-login .el-button { width: 100%; margin: 0; }
.svc-m-login-note p { margin: 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.svc-m-login-note :deep(.privacy-policy-notice) { margin-top: 2px; }

.svc-m-links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.svc-m-links a {
  display: flex;
  min-width: 0;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 6px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  color: var(--cpu-text);
  font-size: var(--cpu-fs-s);
  font-weight: 500;
  text-decoration: none;
}
.svc-m-links a:active { background: var(--cpu-surface-soft); }
.svc-m-links .cpu-app-icon { flex: 0 0 auto; color: var(--cpu-primary); font-size: var(--cpu-fs-l); }
.svc-m-links span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.svc-m-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 26px 16px 20px; text-align: center; }
.svc-m-empty b { overflow-wrap: anywhere; }
.svc-m-empty .el-button { margin-top: 10px; }

:global(html[data-theme="dark"] .svc-m) {
  --svc-m-tile-fill: 20%;
  --svc-m-tile-ink: 46%;
}

@media (max-width: 340px) {
  .svc-m-head h1 { font-size: var(--cpu-fs-xl); }
  .svc-m-tool .svc-m-tile { width: 42px; height: 42px; font-size: var(--cpu-fs-xl); }
  .svc-m-tool-name { font-size: var(--cpu-fs-xs); }
}
@media (prefers-reduced-motion: reduce) {
  .svc-m-shortcut,
  .svc-m-tool,
  .svc-m-search { transition: none; }
}
</style>
