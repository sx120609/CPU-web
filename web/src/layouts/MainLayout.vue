<template>
  <div class="layout-root" :class="{ 'keyboard-open': keyboardOpen }" :style="layoutStyle">
    <!-- 顶栏 -->
    <header v-if="!hideChrome" class="topbar">
      <div class="topbar-inner">
        <router-link to="/home" class="brand">
          <span class="brand-logo">药</span>
          <span class="brand-text">
            <span class="brand-name">药大拾间</span>
            <span class="brand-sub">CPU 校园互助服务</span>
          </span>
        </router-link>

        <div class="top-search">
          <el-input
            v-model="q"
            :placeholder="searchPlaceholder"
            clearable
            @keyup.enter="goSearch"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
        </div>

        <nav class="top-nav" aria-label="主导航">
          <router-link v-for="item in desktopNavItems" :key="item.to" :to="item.to">
            {{ item.label }}
          </router-link>
        </nav>

        <div class="top-right">
          <template v-if="auth.isLoggedIn">
            <el-tooltip content="刷新页面">
              <el-button text @click="reloadPage">
                <el-icon size="20"><Refresh /></el-icon>
              </el-button>
            </el-tooltip>
            <el-button v-if="auth.canAccessForum && site.features.forum" type="primary" size="default" @click="$router.push('/post')">
              <el-icon><Edit /></el-icon> 发帖
            </el-button>
            <el-tooltip content="消息">
              <el-button text @click="$router.push('/messages')">
                <el-badge :value="msg.unreadCount" :hidden="msg.unreadCount === 0">
                  <el-icon size="20"><Bell /></el-icon>
                </el-badge>
              </el-button>
            </el-tooltip>
            <el-dropdown @command="onUserCmd">
              <span class="user-info">
                <UserAvatar :size="30" class="user-avatar" :src="auth.user?.avatar" :name="auth.user?.nickname" alt="用户头像" />
                <span class="user-name">{{ auth.user?.nickname }}</span>
                <el-icon><ArrowDown /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="profile">个人中心</el-dropdown-item>
                  <el-dropdown-item command="settings">消息设置</el-dropdown-item>
                  <el-dropdown-item v-if="auth.isMod" command="admin" divided>🛠 管理后台</el-dropdown-item>
                  <el-dropdown-item command="logout" :divided="!auth.isMod">退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <template v-else>
            <el-button text @click="goAuth('login')">登录</el-button>
          </template>
        </div>

        <div class="mobile-actions">
          <el-button text class="touch-icon-btn" aria-label="刷新页面" @click="reloadPage">
            <el-icon><Refresh /></el-icon>
          </el-button>
          <el-button v-if="auth.canAccessForum && site.features.forum" text class="touch-icon-btn" aria-label="发帖" @click="$router.push('/post')">
            <el-icon><Edit /></el-icon>
          </el-button>
          <el-button v-if="auth.isLoggedIn" text class="touch-icon-btn" aria-label="消息" @click="$router.push('/messages')">
            <el-badge :value="msg.unreadCount" :hidden="msg.unreadCount === 0">
              <el-icon><Bell /></el-icon>
            </el-badge>
          </el-button>
          <el-button v-else text class="mobile-login-btn" @click="goAuth('login')">登录</el-button>
          <el-button text class="touch-icon-btn" aria-label="更多" @click="mobileMenuOpen = true">
            <el-icon><Menu /></el-icon>
          </el-button>
        </div>
      </div>
    </header>

    <!-- 主内容 -->
    <main class="main" :class="{ 'main--bare': hideChrome }">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <footer v-if="!hideChrome" class="footer">
      <span class="footer-item">© 2026 药大拾间 · 校园互助与服务平台</span>
      <a class="footer-item" href="https://github.com/sx120609/CPU-web" target="_blank" rel="noopener noreferrer">GitHub</a>
      <span class="footer-item">非学校官方站点</span>
      <a
        v-if="site.siteFilingNumber"
        class="footer-item"
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ site.siteFilingNumber }}
      </a>
    </footer>

    <nav class="mobile-tabbar" :class="{ 'is-hidden': keyboardOpen }" aria-label="移动端主导航" :style="{ gridTemplateColumns: `repeat(${mobileNavItems.length}, 1fr)` }">
      <router-link
        v-for="item in mobileNavItems"
        :key="item.to"
        :to="resolveMobileTo(item)"
        class="mobile-tab"
        :class="{ active: isMobileRouteActive(item) }"
      >
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </router-link>
    </nav>

    <el-drawer
      v-model="mobileMenuOpen"
      direction="btt"
      size="420px"
      class="mobile-drawer"
      title="快捷入口"
    >
      <div class="drawer-grid">
        <button
          v-for="item in drawerItems"
          :key="item.to"
          type="button"
          class="drawer-link"
          @click="goDrawer(item.to)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </button>
        <button type="button" class="drawer-link" @click="reloadPage">
          <el-icon><Refresh /></el-icon>
          <span>刷新页面</span>
        </button>
      </div>
      <div class="drawer-account">
        <template v-if="auth.isLoggedIn">
          <UserAvatar :size="34" class="user-avatar" :src="auth.user?.avatar" :name="auth.user?.nickname" alt="用户头像" />
          <div class="drawer-user">
            <div>{{ auth.user?.nickname }}</div>
            <button type="button" @click="goDrawer('/profile')">个人中心</button>
          </div>
          <el-button text type="danger" @click="onMobileLogout">退出</el-button>
        </template>
        <template v-else>
          <el-button type="primary" @click="goDrawerAuth('login')">登录</el-button>
        </template>
      </div>
    </el-drawer>

    <!-- 首次登录设昵称（强制） -->
    <el-dialog
      v-model="showNicknameDialog"
      title="设置展示昵称"
      width="420"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <p class="dlg-tip">
        欢迎来到药大拾间，先设置一个公开显示的昵称
      </p>
      <p class="dlg-hint">
        {{ nicknameHint }}，<b>不会展示你的学号</b>。
      </p>
      <el-input
        v-model="newNickname"
        size="large"
        placeholder="2-20 个字符，支持中文"
        maxlength="20"
        show-word-limit
        @keyup.enter="saveNickname"
      />
      <template #footer>
        <el-button type="primary" size="large" :loading="savingNickname" :disabled="savingNickname" @click="saveNickname">
          完成设置
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  Search,
  Edit,
  Bell,
  ArrowDown,
  Menu,
  House,
  ChatLineRound,
  Calendar,
  Reading,
  UserFilled,
  Goods,
  Service,
  Message,
  Refresh,
  Tools,
} from "@element-plus/icons-vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { useAuthStore } from "@/stores/auth";
import { useMessageStore } from "@/stores/message";
import { useSiteStore } from "@/stores/site";

const auth = useAuthStore();
const msg = useMessageStore();
const site = useSiteStore();
const router = useRouter();
const route = useRoute();
const q = ref("");
const mobileMenuOpen = ref(false);
const keyboardOpen = ref(false);
const mobileViewportHeight = ref(0);
const editableFocused = ref(false);
const editorFocused = ref(false);
const mobileViewportBaseHeight = ref(0);
const isMobileViewport = ref(false);
let focusOutTimer = 0;

/** 某些路由（如 /schedule）希望"裸壳"渲染，没有顶栏/免责声明/footer，仅保留 main + tabbar */
const hideChrome = computed(() => Boolean(route.meta?.hideChrome));
const layoutStyle = computed(() => (
  mobileViewportHeight.value
    ? { "--layout-viewport-height": `${mobileViewportHeight.value}px` }
    : {}
));

const searchPlaceholder = computed(() => {
  const scopes: string[] = [];
  if (site.features.forum && auth.canAccessForum) scopes.push("帖子");
  if (site.features.coursereview && auth.canAccessForum) scopes.push("课程");
  scopes.push("公告");
  scopes.push("服务");
  return `搜索${scopes.join(" / ")}`;
});

const nicknameHint = computed(() => {
  const actions: string[] = [];
  if (site.features.forum) actions.push("发帖、回复");
  if (site.features.coursereview) actions.push("课程点评");
  if (!actions.length) return "后续使用站内功能时会显示昵称";
  return `后续${actions.join("和")}都会显示昵称`;
});

function reloadPage() {
  window.location.reload();
}

const desktopNavItems = computed(() => {
  const items: { to: string; label: string }[] = [];
  items.push({ to: "/home", label: "首页" });
  if (site.features.forum) items.push({ to: "/forum", label: "论坛" });
  items.push({ to: "/announcements", label: "公告" });
  items.push({ to: "/jwxt", label: "教务数据" });
  if (site.features.coursereview && auth.canAccessForum) items.push({ to: "/coursereview", label: "课评" });
  if (site.features.market && auth.canAccessForum) items.push({ to: "/market", label: "二手" });
  items.push({ to: "/services", label: "校园服务" });
  return items;
});

const mobileNavItems = computed(() => {
  // 固定 5 项：首页 / 教务 / 课表 / 服务 / 我的（论坛进 drawer）
  return [
    { to: "/home", label: "首页", icon: House, match: ["/home"] },
    { to: "/jwxt", label: "教务", icon: Reading, match: ["/jwxt"] },
    { to: "/schedule", label: "课表", icon: Calendar, match: ["/schedule"] },
    { to: "/services", label: "服务", icon: Service, match: ["/services"] },
    { to: "/profile", label: "我的", icon: UserFilled, match: ["/profile", "/sponsor-wall", "/messages", "/admin", "/u/"], auth: true },
  ] as { to: string; label: string; icon: any; match: string[]; auth?: boolean }[];
});

const drawerItems = computed(() => {
  const items: { to: string; label: string; icon: any }[] = [];
  if (auth.canAccessForum && site.features.forum) items.push({ to: "/post", label: "发帖", icon: Edit });
  items.push({ to: "/messages", label: "消息", icon: Message });
  if (auth.isMod) items.push({ to: "/admin", label: "管理后台", icon: Tools });
  if (site.features.forum) items.push({ to: "/forum", label: "论坛", icon: ChatLineRound });
  items.push({ to: "/announcements", label: "校园公告", icon: Bell });
  items.push({ to: "/jwxt", label: "教务数据", icon: Calendar });
  if (site.features.coursereview && auth.canAccessForum) items.push({ to: "/coursereview", label: "课评", icon: Reading });
  if (site.features.market && auth.canAccessForum) items.push({ to: "/market", label: "二手市场", icon: Goods });
  items.push({ to: "/services", label: "校园服务", icon: Service });
  items.push({ to: "/search", label: "搜索", icon: Search });
  return items;
});

// 首次登录设昵称
const showNicknameDialog = ref(false);
const newNickname = ref("");
const savingNickname = ref(false);

const shouldAskNickname = computed(() => auth.isLoggedIn && auth.needSetupNickname && !auth.needDataAuthAgreement);
watch(shouldAskNickname, (v) => {
  if (v) showNicknameDialog.value = true;
  else showNicknameDialog.value = false;
}, { immediate: true });

async function saveNickname() {
  const nick = newNickname.value.trim();
  if (nick.length < 2) { ElMessage.warning("昵称至少 2 个字"); return; }
  if (nick.length > 20) { ElMessage.warning("昵称最多 20 个字"); return; }
  savingNickname.value = true;
  try {
    await auth.updateProfile({ nickname: nick });
    ElMessage.success(`欢迎，${nick}`);
    showNicknameDialog.value = false;
    newNickname.value = "";
  } finally { savingNickname.value = false; }
}

onMounted(async () => {
  if (auth.token && !auth.user) await auth.fetchMe();
  if (auth.isLoggedIn) msg.refresh();
  syncViewportMetrics();
  if (typeof window !== "undefined") {
    window.addEventListener("resize", handleViewportMetricsChange, { passive: true });
    window.visualViewport?.addEventListener("resize", handleViewportMetricsChange);
    window.visualViewport?.addEventListener("scroll", handleViewportMetricsChange);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
  }
});

onBeforeUnmount(() => {
  window.clearTimeout(focusOutTimer);
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", handleViewportMetricsChange);
    window.visualViewport?.removeEventListener("resize", handleViewportMetricsChange);
    window.visualViewport?.removeEventListener("scroll", handleViewportMetricsChange);
    document.removeEventListener("focusin", handleFocusIn);
    document.removeEventListener("focusout", handleFocusOut);
  }
});

watch(() => route.fullPath, () => {
  window.clearTimeout(focusOutTimer);
  keyboardOpen.value = false;
  editableFocused.value = false;
  editorFocused.value = false;
  syncViewportMetrics();
});

function handleViewportMetricsChange() {
  syncViewportMetrics();
  updateKeyboardState();
}

function handleFocusIn(event: FocusEvent) {
  window.clearTimeout(focusOutTimer);
  const target = event.target instanceof HTMLElement ? event.target : null;
  editableFocused.value = isEditableElement(target);
  editorFocused.value = Boolean(target?.closest(".rich-editor"));
  syncViewportMetrics();
  if (editorFocused.value && isMobileViewport.value) {
    keyboardOpen.value = true;
    requestAnimationFrame(() => {
      syncViewportMetrics();
      updateKeyboardState();
    });
    return;
  }
  requestAnimationFrame(updateKeyboardState);
}

function handleFocusOut() {
  window.clearTimeout(focusOutTimer);
  focusOutTimer = window.setTimeout(() => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    editableFocused.value = isEditableElement(active);
    editorFocused.value = Boolean(active?.closest(".rich-editor"));
    syncViewportMetrics();
    updateKeyboardState();
  }, 120);
}

function isEditableElement(target: HTMLElement | null) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || Boolean(target.closest("[contenteditable='true']"));
}

function syncViewportMetrics() {
  if (typeof window === "undefined") return;
  const visualHeight = Math.round(window.visualViewport?.height ?? window.innerHeight);
  const visualWidth = Math.round(window.visualViewport?.width ?? window.innerWidth);
  mobileViewportHeight.value = visualHeight;
  isMobileViewport.value = visualWidth <= 768;
  if (!keyboardOpen.value) {
    mobileViewportBaseHeight.value = Math.max(mobileViewportBaseHeight.value, visualHeight, window.innerHeight);
  }
}

function updateKeyboardState() {
  if (typeof window === "undefined") return;
  if (editorFocused.value && isMobileViewport.value) {
    keyboardOpen.value = true;
    return;
  }
  const currentHeight = Math.round(window.visualViewport?.height ?? window.innerHeight);
  const baseHeight = Math.max(mobileViewportBaseHeight.value || 0, currentHeight, window.innerHeight);
  const keyboardLikelyOpen = isMobileViewport.value && editableFocused.value && baseHeight - currentHeight > 120;
  keyboardOpen.value = keyboardLikelyOpen;
  if (!keyboardLikelyOpen) {
    mobileViewportBaseHeight.value = Math.max(currentHeight, window.innerHeight);
  }
}

function goSearch() {
  if (q.value.trim()) router.push({ name: "search", query: { q: q.value.trim() } });
}

function resolveMobileTo(item: { to: string; auth?: boolean }) {
  if (item.auth && !auth.isLoggedIn) {
    return { name: "login", query: { redirect: item.to } };
  }
  return item.to;
}

function isMobileRouteActive(item: { match: string[]; auth?: boolean }) {
  if (item.auth && !auth.isLoggedIn && route.path === "/login") return true;
  return item.match.some((prefix) => route.path === prefix || route.path.startsWith(`${prefix}/`));
}

function goDrawer(to: string) {
  mobileMenuOpen.value = false;
  if ((to === "/post" || to === "/messages") && !auth.isLoggedIn) {
    router.push({ name: "login", query: { redirect: to } });
    return;
  }
  router.push(to);
}

function authRedirectTarget() {
  if (route.path === "/home") return undefined;
  return route.fullPath;
}

function goAuth(name: "login" | "register") {
  const redirect = authRedirectTarget();
  router.push({ name, query: redirect ? { redirect } : undefined });
}

function goDrawerAuth(name: "login" | "register") {
  mobileMenuOpen.value = false;
  goAuth(name);
}

async function onMobileLogout() {
  mobileMenuOpen.value = false;
  await auth.logout();
  router.push("/login");
}

async function onUserCmd(cmd: string) {
  if (cmd === "profile") router.push("/profile");
  else if (cmd === "settings") router.push("/messages?tab=settings");
  else if (cmd === "admin") router.push("/admin");
  else if (cmd === "logout") {
    await auth.logout();
    router.push("/login");
  }
}
</script>

<style scoped lang="scss">
.layout-root {
  min-height: 100dvh;
  min-height: var(--layout-viewport-height, 100dvh);
  display: flex;
  flex-direction: column;
  background: var(--cpu-bg);
  /* 防 iOS Safari 整页橡皮筋拉动 */
  overscroll-behavior-y: none;
}

.topbar {
  background: var(--cpu-glass-bg);
  backdrop-filter: var(--cpu-glass-blur);
  -webkit-backdrop-filter: var(--cpu-glass-blur);
  border-bottom: 1px solid rgba(255, 255, 255, 0.4);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02), 0 4px 16px -4px rgba(0, 0, 0, 0.02);
  position: sticky;
  top: 0;
  z-index: 100;
  padding-top: env(safe-area-inset-top);
  transition: all 0.3s ease;
}

.topbar-inner {
  max-width: 1280px;
  margin: 0 auto;
  height: 60px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
  flex-shrink: 0;
  min-width: 0;
}

.brand-logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--cpu-primary), var(--cpu-primary-dark));
  color: var(--cpu-gold);
  display: grid;
  place-items: center;
  font-family: serif;
  font-weight: 700;
  font-size: 20px;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
  min-width: 0;
}

.brand-name {
  font-size: 17px;
  font-weight: 700;
  color: var(--cpu-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand-sub {
  font-size: 11px;
  color: #9ca3af;
  letter-spacing: 1px;
}

.top-search {
  width: 320px;
  max-width: 30%;
  flex: 0 1 320px;
  min-width: 180px;
}

.top-nav {
  display: flex;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.top-nav::-webkit-scrollbar {
  display: none;
}

.top-nav a {
  flex: 0 0 auto;
  padding: 8px 12px;
  border-radius: 6px;
  color: #4b5563;
  text-decoration: none;
  font-size: 14px;
  line-height: 1;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

.top-nav a:hover { background: rgba(0, 0, 0, 0.04); color: var(--cpu-primary); }
.top-nav a.router-link-active { color: var(--cpu-primary); font-weight: 600; background: rgba(20, 143, 123, 0.08); }

.top-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.mobile-actions {
  display: none;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.touch-icon-btn {
  width: 42px;
  height: 42px;
  padding: 0;
  border-radius: 10px;
  color: #374151;
  -webkit-tap-highlight-color: rgba(22, 135, 118, 0.18);
}

.touch-icon-btn:active {
  background: #f3f4f6;
}

.touch-icon-btn .el-icon {
  font-size: 20px;
}

.mobile-login-btn {
  min-width: 60px;
  height: 42px;
  padding: 0 12px;
  color: var(--cpu-primary);
  font-weight: 500;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}

.user-info:hover { background: #f3f4f6; }

.user-avatar {
  background: var(--cpu-primary);
  color: #fff;
  font-weight: 600;
}

.user-name {
  font-size: 13px;
  color: #374151;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.main {
  flex: 1;
  padding: 24px 20px 40px;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  box-sizing: border-box;
}

/* hideChrome 模式：内容页（如课表）自己管 padding；这里只为 mobile tabbar 留底部空间 */
.main--bare {
  padding: 0 !important;
  max-width: none;
}

.footer {
  background: #fff;
  border-top: 1px solid #eef0f4;
  padding: 16px 20px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px 14px;
  font-size: 12px;
  color: #9ca3af;
}

.footer-item {
  color: inherit;
  line-height: 1.6;
}

.footer a.footer-item {
  color: var(--cpu-primary);
  text-decoration: none;
}

.mobile-tabbar {
  display: none;
}

.drawer-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: 76px;
  align-items: stretch;
  gap: 10px;
}

.drawer-link {
  border: 1px solid #eef0f4;
  background: #fff;
  border-radius: 10px;
  height: 76px;
  min-height: 76px;
  padding: 10px 8px;
  color: #374151;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  line-height: 1;
  font: inherit;
  overflow: hidden;
}

.drawer-link .el-icon {
  font-size: 22px;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
  color: var(--cpu-primary);
}

.drawer-link span {
  max-width: 100%;
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drawer-account {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #eef0f4;
  display: flex;
  align-items: center;
  gap: 10px;
}

.drawer-user {
  flex: 1;
  min-width: 0;
  color: #1f2937;
  font-size: 14px;
}

.drawer-user > div {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-user button {
  border: none;
  background: none;
  padding: 2px 0 0;
  color: var(--cpu-primary);
  font: inherit;
  font-size: 12px;
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.dlg-tip { font-size: 15px; color: #1f2937; margin: 0 0 6px; }
.dlg-tip b { color: var(--cpu-primary); }
.dlg-hint { font-size: 13px; color: #6b7280; margin: 0 0 14px; }
.dlg-hint b { color: #b45309; }

@media (max-width: 1120px) {
  .topbar-inner {
    gap: 12px;
  }

  .top-nav a {
    padding: 8px 9px;
  }

  .top-search {
    width: 240px;
    flex-basis: 240px;
    max-width: 24%;
  }
}

@media (max-width: 960px) {
  .top-nav { display: none; }
  .top-search { width: 200px; }
}

@media (max-width: 768px) {
  .layout-root.keyboard-open .main {
    padding-bottom: 12px;
  }

  .layout-root.keyboard-open .main--bare {
    padding-bottom: 0 !important;
  }

  .topbar {
    box-shadow: 0 1px 10px rgba(15, 23, 42, 0.05);
  }

  .topbar-inner {
    height: auto;
    min-height: 58px;
    padding: 8px 12px 10px;
    gap: 8px;
    flex-wrap: wrap;
  }

  .brand {
    flex: 1 1 auto;
  }

  .brand-logo {
    width: 34px;
    height: 34px;
    border-radius: 9px;
    font-size: 19px;
  }

  .brand-name {
    font-size: 16px;
  }

  .brand-sub {
    display: none;
  }

  .top-search {
    order: 10;
    width: 100%;
    flex: 0 0 100%;
    max-width: none;
    min-width: 0;
    display: flex;
    justify-content: center;
  }

  .top-search :deep(.el-input) {
    width: min(100%, 520px);
  }

  .top-search :deep(.el-input__wrapper) {
    border-radius: 12px;
  }

  .top-right {
    display: none;
  }

  .mobile-actions {
    display: flex;
    flex: 0 0 auto;
  }

  .main {
    padding: 14px 12px calc(88px + env(safe-area-inset-bottom));
    max-width: none;
  }

  /* 移动端裸壳模式：去掉 top/side padding，仅保留 tabbar 底部空间，让子组件自己管 */
  .main--bare {
    padding: 0 0 calc(88px + env(safe-area-inset-bottom)) !important;
  }

  .footer {
    padding: 12px 12px calc(12px + 68px + env(safe-area-inset-bottom));
    gap: 6px 12px;
    font-size: 11px;
  }

  .mobile-tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1100;
    display: grid;
    /* 列数由 inline style 提供（mobileNavItems.length），保证关闭某项后剩余项仍均匀分布 */
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
    border-top: 1px solid rgba(255, 255, 255, 0.5);
    background: var(--cpu-glass-bg);
    backdrop-filter: var(--cpu-glass-blur);
    -webkit-backdrop-filter: var(--cpu-glass-blur);
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.06);
    pointer-events: auto;
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease, visibility 0.3s ease;
  }

  .mobile-tab.active {
    color: var(--cpu-primary);
    background: rgba(20, 143, 123, 0.1);
    transform: scale(1.05);
  }

  :deep(.mobile-drawer) {
    border-radius: 18px 18px 0 0;
    height: min(420px, calc(100dvh - 16px)) !important;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .mobile-tabbar.is-hidden {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(calc(100% + env(safe-area-inset-bottom)));
  }

  .mobile-tab {
    min-width: 0;
    height: 50px;
    border-radius: 12px;
    color: #6b7280;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    font-size: 11px;
    font-weight: 500;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(22, 135, 118, 0.18);
    cursor: pointer;
    transition: transform 0.2s ease, background 0.2s ease;
  }

  .mobile-tab .el-icon {
    font-size: 20px;
  }

  .mobile-tab span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :deep(.mobile-drawer .el-drawer__header) {
    margin-bottom: 8px;
  }

  :deep(.mobile-drawer .el-drawer__body) {
    display: flex;
    flex-direction: column;
  }

  .dlg-tip {
    font-size: 14px;
  }
}

@media (max-width: 420px) {
  .drawer-grid {
    grid-template-columns: repeat(3, 1fr);
  }

  .touch-icon-btn {
    width: 38px;
  }
}

@media (max-width: 360px) {
  .topbar-inner {
    padding-inline: 10px;
  }

  .brand-logo {
    width: 32px;
    height: 32px;
    font-size: 18px;
  }

  .brand-name {
    font-size: 15px;
  }

  .mobile-actions {
    gap: 2px;
  }

  .touch-icon-btn {
    width: 36px;
  }
}
</style>
