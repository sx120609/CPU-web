<template>
  <div
    class="layout-root"
    :class="{
      'keyboard-open': keyboardOpen,
      'layout-root--full-width': fullWidthContent && !hideChrome,
      'layout-root--full-height': fullHeightContent && !hideChrome,
      'layout-root--native-shell': useNativeShell,
      'layout-root--tabbar-fallback': useTabbarFallback,
    }"
    :style="layoutStyle"
  >
    <!-- 顶栏 -->
    <header v-if="!hideChrome && !useNativeShell" class="topbar">
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
          <template
            v-for="item in desktopPrimaryNavItems"
            :key="item.id"
          >
            <a
              v-if="isExternalNav(item.to) || item.openInNewTab"
              :href="item.to"
              :target="item.openInNewTab ? '_blank' : undefined"
              :rel="item.openInNewTab ? 'noopener noreferrer' : undefined"
              :title="item.fullLabel || item.label"
            >{{ item.label }}</a>
            <router-link v-else :to="item.to" :title="item.fullLabel || item.label">{{ item.label }}</router-link>
          </template>
          <el-dropdown
            v-if="desktopOverflowNavItems.length"
            class="top-nav-more"
            trigger="click"
            @command="goDesktopNav"
          >
            <button type="button" class="top-nav-more-btn">
              <span>更多</span>
              <el-icon><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="item in desktopOverflowNavItems"
                  :key="item.id"
                  :command="item.id"
                >
                  {{ item.fullLabel || item.label }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </nav>

        <div class="top-right">
          <el-dropdown trigger="click" @command="setAppearanceMode">
            <button type="button" class="appearance-cycle-btn" :aria-label="`外观：${appearance.modeLabel}`">
              <el-icon size="20"><component :is="appearanceIcon" /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="item in appearanceOptions"
                  :key="item.value"
                  :command="item.value"
                  :class="{ 'is-current-appearance': appearance.mode === item.value }"
                >
                  <el-icon><component :is="item.icon" /></el-icon>
                  <span>{{ item.label }}</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <template v-if="auth.isLoggedIn">
            <el-tooltip content="刷新页面">
              <el-button text @click="reloadPage">
                <el-icon size="20"><Refresh /></el-icon>
              </el-button>
            </el-tooltip>
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
                  <el-dropdown-item v-if="auth.canAccessModuleAdmin" command="admin" divided>🛠 管理后台</el-dropdown-item>
                  <el-dropdown-item command="logout" :divided="!auth.canAccessModuleAdmin">退出登录</el-dropdown-item>
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
          <el-button text class="touch-icon-btn assistant-shortcut-touch" aria-label="拾间AI" @click="$router.push('/search')">
            <el-icon><ChatDotRound /></el-icon>
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
    <main
      class="main"
      :class="{
        'main--bare': hideChrome,
        'main--full-width': fullWidthContent && !hideChrome,
        'main--full-height': fullHeightContent && !hideChrome,
      }"
    >
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <transition name="assistant-widget">
      <aside
        v-if="assistantWidgetOpen && !hideChrome && !useNativeShell && route.path !== '/search'"
        class="assistant-widget"
        role="dialog"
        aria-label="拾间AI"
      >
        <ShijianAssistant embedded @close="assistantWidgetOpen = false" />
      </aside>
    </transition>

    <button
      v-if="!hideChrome && !useNativeShell && route.path !== '/search'"
      type="button"
      class="assistant-fab"
      aria-label="打开拾间AI"
      :aria-expanded="assistantWidgetOpen"
      title="拾间AI"
      @click="assistantWidgetOpen = !assistantWidgetOpen"
    >
      <el-icon>
        <Close v-if="assistantWidgetOpen" />
        <ChatDotRound v-else />
      </el-icon>
    </button>

    <footer v-if="!hideChrome && !useNativeShell && !fullHeightContent" class="footer">
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

    <nav v-if="!useNativeShell" class="mobile-tabbar" :class="{ 'is-hidden': keyboardOpen }" aria-label="移动端主导航" :style="{ gridTemplateColumns: `repeat(${mobileNavItems.length}, 1fr)` }">
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
      size="auto"
      class="mobile-drawer"
      title="快捷入口"
    >
      <div class="drawer-grid">
        <button
          v-for="item in drawerItems"
          :key="item.id"
          type="button"
          class="drawer-link"
          @click="goDrawer(item)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </button>
        <button type="button" class="drawer-link" @click="reloadPage">
          <el-icon><Refresh /></el-icon>
          <span>刷新页面</span>
        </button>
      </div>
      <div class="drawer-appearance">
        <span>外观</span>
        <div class="appearance-segmented" role="radiogroup" aria-label="外观模式">
          <button
            v-for="item in appearanceOptions"
            :key="item.value"
            type="button"
            :class="{ active: appearance.mode === item.value }"
            :aria-checked="appearance.mode === item.value"
            role="radio"
            @click="appearance.setMode(item.value)"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>
      <div class="drawer-account">
        <template v-if="auth.isLoggedIn">
          <UserAvatar :size="34" class="user-avatar" :src="auth.user?.avatar" :name="auth.user?.nickname" alt="用户头像" />
          <div class="drawer-user">
            <div>{{ auth.user?.nickname }}</div>
            <button type="button" @click="goDrawer({ id: 'system-profile', to: '/profile', label: '个人中心', icon: UserFilled })">个人中心</button>
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
  ChatDotRound,
  Close,
  Calendar,
  Reading,
  UserFilled,
  Goods,
  Service,
  Message,
  Refresh,
  Tools,
  Sunny,
  Moon,
  Monitor,
  Compass,
  Link,
} from "@element-plus/icons-vue";
import type { TopNavigationIcon, TopNavigationItem } from "@/api/site";
import UserAvatar from "@/components/common/UserAvatar.vue";
import ShijianAssistant from "@/views/search/Result.vue";
import { useAuthStore } from "@/stores/auth";
import { useMessageStore } from "@/stores/message";
import { useSiteStore } from "@/stores/site";
import { useAppearanceStore, type AppearanceMode } from "@/stores/appearance";
import { isFlutterNativeShell } from "@/utils/clientInfo";

const auth = useAuthStore();
const msg = useMessageStore();
const site = useSiteStore();
const appearance = useAppearanceStore();
const router = useRouter();
const route = useRoute();
const q = ref("");
const mobileMenuOpen = ref(false);
const assistantWidgetOpen = ref(false);
const keyboardOpen = ref(false);
const mobileViewportHeight = ref(0);
const mobileViewportWidth = ref(0);
const mobileViewportOffsetTop = ref(0);
const touchLikeViewport = ref(false);
const editableFocused = ref(false);
const editorFocused = ref(false);
const mobileViewportBaseHeight = ref(0);
const isMobileViewport = ref(false);
let focusOutTimer = 0;
let disposed = false;

const appearanceOptions: Array<{ value: AppearanceMode; label: string; icon: unknown }> = [
  { value: "system", label: "跟随", icon: Monitor },
  { value: "light", label: "浅色", icon: Sunny },
  { value: "dark", label: "深色", icon: Moon },
];
const appearanceIcon = computed(() => (
  appearance.mode === "system" ? Monitor : appearance.resolved === "dark" ? Moon : Sunny
));

/** 某些路由（如 /schedule）希望"裸壳"渲染，没有顶栏/免责声明/footer */
const hideChrome = computed(() => Boolean(route.meta?.hideChrome));
const fullWidthContent = computed(() => Boolean(route.meta?.fullWidthContent));
const fullHeightContent = computed(() => Boolean(route.meta?.fullHeightContent));
const useNativeShell = computed(() => isFlutterNativeShell());
const isPortraitViewport = computed(() => mobileViewportHeight.value >= mobileViewportWidth.value);
const useTabbarFallback = computed(() => (
  touchLikeViewport.value
  && !useNativeShell.value
  && isPortraitViewport.value
));
const layoutStyle = computed(() => {
  if (!mobileViewportHeight.value) return {};
  const baseHeight = Math.max(
    mobileViewportBaseHeight.value || 0,
    mobileViewportHeight.value,
  );
  const keyboardInset = keyboardOpen.value
    ? Math.max(0, baseHeight - mobileViewportHeight.value)
    : 0;
  return {
    "--layout-viewport-height": `${mobileViewportHeight.value}px`,
    "--layout-viewport-base-height": `${baseHeight}px`,
    "--layout-viewport-offset-top": `${mobileViewportOffsetTop.value}px`,
    "--layout-keyboard-inset": `${keyboardInset}px`,
  };
});

const searchPlaceholder = computed(() => {
  const scopes: string[] = [];
  if (site.features.forum && auth.canAccessForum) scopes.push("帖子");
  scopes.push("失物");
  if (site.features.coursereview && auth.canAccessForum) scopes.push("课程");
  scopes.push("公告");
  scopes.push("服务");
  return `问拾间AI：${scopes.join(" / ")}`;
});

type DesktopNavItem = TopNavigationItem;
type DrawerNavItem = { id: string; to: string; label: string; icon: unknown; openInNewTab?: boolean };

const navigationIconMap: Record<TopNavigationIcon, unknown> = {
  home: House,
  forum: ChatLineRound,
  "lost-found": Compass,
  announcement: Bell,
  academic: Reading,
  schedule: Calendar,
  service: Service,
  course: Reading,
  market: Goods,
  search: Search,
  link: Link,
};

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
  return site.topNavigation.filter(navigationItemVisible);
});

const desktopPrimaryNavItems = computed(() => {
  return desktopNavItems.value.filter((item) => item.primary);
});

const desktopOverflowNavItems = computed(() => {
  return desktopNavItems.value.filter((item) => !item.primary);
});

const mobileNavItems = computed(() => {
  // 固定 5 项：首页 / 教务 / 课表 / 服务 / 我的
  return [
    { to: "/home", label: "首页", icon: House, match: ["/home"] },
    { to: "/jwxt", label: "教务", icon: Reading, match: ["/jwxt"] },
    { to: "/schedule", label: "课表", icon: Calendar, match: ["/schedule"] },
    { to: "/services", label: "服务", icon: Service, match: ["/services"] },
    { to: "/profile", label: "我的", icon: UserFilled, match: ["/profile", "/sponsor-wall", "/messages", "/admin", "/u/"], auth: true },
  ] as { to: string; label: string; icon: any; match: string[]; auth?: boolean }[];
});

const drawerItems = computed(() => {
  const items: DrawerNavItem[] = [];
  if (auth.canAccessForum && site.features.forum) items.push({ id: "system-post", to: "/post", label: "发帖", icon: Edit });
  items.push({ id: "system-messages", to: "/messages", label: "消息", icon: Message });
  if (auth.canAccessModuleAdmin) items.push({ id: "system-admin", to: "/admin", label: "管理后台", icon: Tools });
  for (const item of site.topNavigation.filter((candidate) => candidate.showInDrawer && navigationItemVisible(candidate))) {
    items.push({ id: `configured-${item.id}`, to: item.to, label: item.fullLabel || item.label, icon: navigationIconMap[item.icon], openInNewTab: item.openInNewTab });
  }
  if (!items.some((item) => item.to === "/search")) items.push({ id: "system-search", to: "/search", label: "拾间AI", icon: Search });
  return items;
});

function navigationItemVisible(item: TopNavigationItem) {
  if (!item.enabled) return false;
  if (item.feature && !site.features[item.feature]) return false;
  if (item.requireForumAccess && !auth.canAccessForum) return false;
  if (item.audience === "guest" && auth.isLoggedIn) return false;
  if (item.audience === "logged-in" && !auth.isLoggedIn) return false;
  if (item.audience === "staff" && !auth.isMod) return false;
  return true;
}

function isExternalNav(to: string) {
  return /^(?:https?:\/\/|mailto:|#)/i.test(to);
}

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
  disposed = false;
  if (auth.token && !auth.user) await auth.fetchMe();
  if (disposed) return;
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
  disposed = true;
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
  assistantWidgetOpen.value = false;
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
  if (fullHeightContent.value && editableFocused.value && isMobileViewport.value) {
    keyboardOpen.value = true;
    return;
  }
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
  mobileViewportOffsetTop.value = Math.max(0, Math.round(window.visualViewport?.offsetTop ?? 0));
  mobileViewportHeight.value = visualHeight;
  mobileViewportWidth.value = visualWidth;
  touchLikeViewport.value = isTabletTouchViewport(visualWidth, visualHeight);
  isMobileViewport.value = isTouchNavigationViewport(visualWidth, visualHeight);
  if (!keyboardOpen.value) {
    mobileViewportBaseHeight.value = Math.max(mobileViewportBaseHeight.value, visualHeight, window.innerHeight);
  }
}

function isTouchNavigationViewport(width: number, height: number) {
  if (width <= 768) return true;
  return isTabletTouchViewport(width, height);
}

function isTabletTouchViewport(width: number, height: number) {
  const touchLike = window.matchMedia?.("(pointer: coarse)").matches
    || window.matchMedia?.("(hover: none)").matches
    || navigator.maxTouchPoints > 0;
  const longestSide = Math.max(width, height);
  return Boolean(touchLike && longestSide <= 1366);
}

function updateKeyboardState() {
  if (typeof window === "undefined") return;
  if (fullHeightContent.value && editableFocused.value && isMobileViewport.value) {
    keyboardOpen.value = true;
    return;
  }
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

function goDesktopNav(command: string | number | object) {
  const id = String(command || "");
  const item = desktopOverflowNavItems.value.find((candidate) => candidate.id === id);
  if (item) navigateConfiguredItem(item);
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

function goDrawer(item: DrawerNavItem) {
  mobileMenuOpen.value = false;
  const to = item.to;
  if ((to === "/post" || to === "/messages") && !auth.isLoggedIn) {
    router.push({ name: "login", query: { redirect: to } });
    return;
  }
  navigateConfiguredItem(item);
}

function navigateConfiguredItem(item: { to: string; openInNewTab?: boolean }) {
  if (isExternalNav(item.to)) {
    if (item.openInNewTab) window.open(item.to, "_blank", "noopener,noreferrer");
    else window.location.href = item.to;
    return;
  }
  if (item.openInNewTab) {
    window.open(router.resolve(item.to).href, "_blank", "noopener,noreferrer");
    return;
  }
  router.push(item.to);
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

function setAppearanceMode(command: string | number | object) {
  const mode = String(command);
  if (mode === "system" || mode === "light" || mode === "dark") appearance.setMode(mode);
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

.layout-root--full-height {
  position: fixed;
  top: var(--layout-viewport-offset-top, 0);
  right: 0;
  bottom: auto;
  left: 0;
  height: var(--layout-viewport-height, 100dvh);
  width: 100%;
  overflow: hidden;
}

.topbar {
  background: var(--cpu-glass-bg);
  backdrop-filter: var(--cpu-glass-blur);
  -webkit-backdrop-filter: var(--cpu-glass-blur);
  border-bottom: 1px solid var(--cpu-border-soft);
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
  gap: 14px;
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
  color: var(--cpu-text-muted);
  letter-spacing: 1px;
}

.top-search {
  width: clamp(210px, 22vw, 320px);
  max-width: 320px;
  flex: 1 1 260px;
  min-width: 180px;
}

.top-nav {
  display: flex;
  gap: 4px;
  flex: 0 1 auto;
  min-width: 0;
  overflow-x: visible;
  overflow-y: hidden;
  align-items: center;
}

.top-nav a {
  flex: 0 0 auto;
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--cpu-text-secondary);
  text-decoration: none;
  font-size: 14px;
  line-height: 1;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

.top-nav a:hover { background: var(--cpu-surface-subtle); color: var(--cpu-primary); }
.top-nav a.router-link-active { color: var(--cpu-primary); font-weight: 600; background: rgba(20, 143, 123, 0.08); }

.top-nav-more {
  flex: 0 0 auto;
}

.top-nav-more-btn {
  display: inline-flex;
  height: 32px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  padding: 0 9px;
  white-space: nowrap;
}

.top-nav-more-btn:hover,
.top-nav-more-btn:focus-visible {
  color: var(--cpu-primary);
  background: var(--cpu-surface-subtle);
  outline: none;
}

.top-right {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-shrink: 0;
}

.appearance-cycle-btn {
  display: inline-flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
}

.appearance-cycle-btn:hover {
  color: var(--cpu-primary);
  background: var(--cpu-surface-subtle);
}

:global(.el-dropdown-menu__item.is-current-appearance) {
  color: var(--cpu-primary);
  background: rgba(20, 143, 123, 0.1);
  font-weight: 650;
}

:global(.el-dropdown-menu__item.is-current-appearance .el-icon) {
  color: var(--cpu-primary);
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
  color: var(--cpu-text-secondary);
  -webkit-tap-highlight-color: rgba(22, 135, 118, 0.18);
}

.touch-icon-btn:active {
  background: var(--cpu-surface-subtle);
}

.touch-icon-btn .el-icon {
  font-size: 20px;
}

.assistant-shortcut-touch {
  color: var(--cpu-text-secondary);
}

.assistant-widget {
  position: fixed;
  z-index: 1090;
  right: 26px;
  bottom: 94px;
  width: min(410px, calc(100vw - 52px));
  height: min(650px, calc(100dvh - 120px));
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 22px;
  color: var(--cpu-text);
  background: var(--cpu-card);
  box-shadow:
    0 24px 64px rgba(15, 23, 42, 0.2),
    0 4px 18px rgba(15, 23, 42, 0.1);
}

.assistant-widget-enter-active,
.assistant-widget-leave-active {
  transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  transform-origin: right bottom;
}

.assistant-widget-enter-from,
.assistant-widget-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

.assistant-fab {
  position: fixed;
  z-index: 1091;
  right: 26px;
  bottom: 26px;
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 50%;
  color: #fff;
  background: #171717;
  box-shadow:
    0 16px 36px rgba(0, 0, 0, 0.22),
    0 4px 12px rgba(0, 0, 0, 0.14);
  cursor: pointer;
  font: inherit;
  transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s ease;
}

.assistant-fab .el-icon {
  font-size: 27px;
}

.assistant-fab:hover {
  transform: translateY(-2px) scale(1.04);
  box-shadow:
    0 20px 42px rgba(0, 0, 0, 0.26),
    0 5px 14px rgba(0, 0, 0, 0.16);
}

.assistant-fab:active {
  transform: scale(0.96);
}

.assistant-fab:focus-visible {
  outline: 3px solid rgba(23, 23, 23, 0.22);
  outline-offset: 3px;
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

.user-info:hover { background: var(--cpu-surface-subtle); }

.user-avatar {
  background: var(--cpu-primary);
  color: #fff;
  font-weight: 600;
}

.user-name {
  font-size: 13px;
  color: var(--cpu-text-secondary);
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

.main--full-height {
  min-height: 0;
  overflow: hidden;
}

.layout-root--full-height.keyboard-open {
  height: var(--layout-viewport-base-height, var(--layout-viewport-height, 100dvh));
}

.main--full-height > :deep(*) {
  height: 100%;
  min-height: 0;
}

/* hideChrome 模式：内容页（如课表）自己管 padding；这里只为 mobile tabbar 留底部空间 */
.main--bare {
  padding: 0 !important;
  max-width: none;
}

.main--full-width {
  padding: 0;
  max-width: none;
  margin: 0;
  width: 100%;
}

.layout-root--full-width .main {
  padding: 0;
  max-width: none;
  margin: 0;
  width: 100%;
}

.layout-root--full-width .main > :deep(*) {
  width: 100%;
  max-width: none;
  min-width: 0;
}

.layout-root--native-shell .main {
  padding: 0;
  max-width: none;
  margin: 0;
  width: 100%;
}

.layout-root--native-shell .main > :deep(*) {
  width: 100%;
  max-width: none;
  min-width: 0;
}

.footer {
  background: var(--cpu-surface);
  border-top: 1px solid var(--cpu-border-soft);
  padding: 16px 20px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px 14px;
  font-size: 12px;
  color: var(--cpu-text-muted);
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

.layout-root--tabbar-fallback.keyboard-open .main {
  padding-bottom: 12px;
}

.layout-root--tabbar-fallback.keyboard-open .main--bare,
.layout-root--tabbar-fallback.keyboard-open .main--full-width {
  padding-bottom: 0 !important;
}

.layout-root--tabbar-fallback .main {
  padding-bottom: calc(88px + env(safe-area-inset-bottom));
}

.layout-root--tabbar-fallback .main--bare {
  padding-bottom: calc(88px + env(safe-area-inset-bottom)) !important;
}

.layout-root--tabbar-fallback .main--full-width {
  padding: 0;
}

.layout-root--tabbar-fallback .footer {
  padding-bottom: calc(12px + 68px + env(safe-area-inset-bottom));
}

.layout-root--tabbar-fallback .mobile-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1100;
  display: grid;
  padding: 6px 12px calc(6px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--cpu-border-soft);
  background: var(--cpu-glass-bg);
  backdrop-filter: var(--cpu-glass-blur);
  -webkit-backdrop-filter: var(--cpu-glass-blur);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.06);
  pointer-events: auto;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease, visibility 0.3s ease;
}

.layout-root--tabbar-fallback .mobile-tabbar.is-hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(calc(100% + env(safe-area-inset-bottom)));
}

.layout-root--tabbar-fallback .mobile-tab {
  min-width: 0;
  height: 52px;
  border-radius: 12px;
  color: var(--cpu-text-secondary);
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

.layout-root--tabbar-fallback .mobile-tab.active {
  color: var(--cpu-primary);
  background: rgba(20, 143, 123, 0.1);
  transform: scale(1.04);
}

.layout-root--tabbar-fallback .mobile-tab .el-icon {
  font-size: 21px;
}

.layout-root--tabbar-fallback .mobile-tab span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-rows: 62px;
  align-items: stretch;
  gap: 8px;
}

.drawer-link {
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface);
  border-radius: 10px;
  height: 62px;
  min-height: 62px;
  padding: 8px 6px;
  color: var(--cpu-text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  line-height: 1;
  font: inherit;
  overflow: hidden;
}

.drawer-link .el-icon {
  font-size: 20px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 22px;
  color: var(--cpu-primary);
}

.drawer-link span {
  max-width: 100%;
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drawer-account {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--cpu-border-soft);
  display: flex;
  align-items: center;
  gap: 10px;
}

.drawer-user {
  flex: 1;
  min-width: 0;
  color: var(--cpu-text);
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

.drawer-appearance {
  display: grid;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--cpu-border-soft);
}

.drawer-appearance > span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  font-weight: 650;
}

.appearance-segmented {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-surface-soft);
}

.appearance-segmented button {
  display: inline-flex;
  min-width: 0;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
}

.appearance-segmented button.active {
  color: #05201c;
  background: var(--cpu-primary);
  box-shadow: 0 6px 16px rgba(20, 143, 123, 0.18);
}

.appearance-segmented button:not(.active):hover {
  color: var(--cpu-primary);
  background: rgba(20, 143, 123, 0.1);
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.dlg-tip { font-size: 15px; color: var(--cpu-text); margin: 0 0 6px; }
.dlg-tip b { color: var(--cpu-primary); }
.dlg-hint { font-size: 13px; color: var(--cpu-text-secondary); margin: 0 0 14px; }
.dlg-hint b { color: #b45309; }

@media (max-width: 1120px) {
  .topbar-inner {
    gap: 10px;
  }

  .top-nav a {
    padding: 8px 8px;
  }

  .top-search {
    width: 220px;
    flex: 0 1 220px;
    max-width: 220px;
  }

  .brand-sub,
  .user-name {
    display: none;
  }
}

@media (max-width: 1040px) {
  .top-search {
    width: 190px;
    flex-basis: 190px;
    min-width: 160px;
  }

}

@media (max-width: 960px) {
  .top-nav { display: none; }
  .top-search { width: 200px; }
  .top-right { display: none; }
  .mobile-actions {
    display: flex;
    flex: 0 0 auto;
  }

  .assistant-fab {
    display: none;
  }

  .assistant-widget {
    display: none;
  }
}

@media (max-width: 768px) {
  .layout-root.keyboard-open .main {
    padding-bottom: 12px;
  }

  .layout-root.keyboard-open .main--bare {
    padding-bottom: 0 !important;
  }

  .layout-root.keyboard-open .main--full-width {
    padding: 0;
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
    display: none;
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

  .layout-root--full-height .main--full-height {
    padding-bottom: calc(68px + env(safe-area-inset-bottom));
  }

  .layout-root--full-height.keyboard-open .main--full-height {
    padding-bottom: 12px;
  }

  .main--full-width {
    padding: 0;
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

  .layout-root--native-shell .main {
    padding: 0;
  }

  .layout-root--native-shell .main--bare,
  .layout-root--native-shell .main--full-width {
    padding-bottom: 0 !important;
  }

  .layout-root--native-shell .footer {
    padding-bottom: 12px;
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
    border-top: 1px solid var(--cpu-border-soft);
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
    height: auto !important;
    max-height: min(92dvh, 640px);
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
    color: var(--cpu-text-secondary);
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
    margin-bottom: 6px;
  }

  :deep(.mobile-drawer .el-drawer__body) {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .dlg-tip {
    font-size: 14px;
  }
}

@media (min-width: 769px) and (max-width: 1366px) and (orientation: portrait) and (pointer: coarse),
       (min-width: 769px) and (max-width: 1366px) and (orientation: portrait) and (hover: none) {
  .main {
    padding-bottom: calc(88px + env(safe-area-inset-bottom));
  }

  .main--bare {
    padding-bottom: calc(88px + env(safe-area-inset-bottom)) !important;
  }

  .main--full-width {
    padding: 0;
  }

  .footer {
    padding-bottom: calc(12px + 68px + env(safe-area-inset-bottom));
  }

  .layout-root--native-shell .main {
    padding: 0;
  }

  .layout-root--native-shell .main--bare,
  .layout-root--native-shell .main--full-width {
    padding-bottom: 0 !important;
  }

  .layout-root--native-shell .footer {
    padding-bottom: 16px;
  }

  .mobile-tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1100;
    display: grid;
    padding: 6px 12px calc(6px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--cpu-border-soft);
    background: var(--cpu-glass-bg);
    backdrop-filter: var(--cpu-glass-blur);
    -webkit-backdrop-filter: var(--cpu-glass-blur);
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.06);
    pointer-events: auto;
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease, visibility 0.3s ease;
  }

  .mobile-tabbar.is-hidden {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(calc(100% + env(safe-area-inset-bottom)));
  }

  .mobile-tab {
    min-width: 0;
    height: 52px;
    border-radius: 12px;
    color: var(--cpu-text-secondary);
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

  .mobile-tab.active {
    color: var(--cpu-primary);
    background: rgba(20, 143, 123, 0.1);
    transform: scale(1.04);
  }

  .mobile-tab .el-icon {
    font-size: 21px;
  }

  .mobile-tab span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

@media (max-width: 420px) {
  .drawer-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
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

  .drawer-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-auto-rows: 58px;
    gap: 7px;
  }

  .drawer-link {
    height: 58px;
    min-height: 58px;
    padding: 7px 5px;
  }

  .drawer-link .el-icon {
    font-size: 19px;
    width: 21px;
    height: 21px;
    flex-basis: 21px;
  }
}
</style>
