<template>
  <div
    class="layout-root"
    :class="{
      'keyboard-open': keyboardOpen,
      'keyboard-geometry-open': keyboardGeometryOpen,
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
          <img
            class="brand-logo"
            src="/brand/original-logo-1024.png"
            alt=""
            aria-hidden="true"
            decoding="async"
          />
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
            <el-tooltip v-if="msg.directUnreadCount" :content="`${msg.directUnreadCount} 条未读私信`">
              <el-button class="direct-message-shortcut" text @click="$router.push('/messages?tab=private')">
                <el-icon><Message /></el-icon>
                <span>私信</span>
                <span class="direct-message-count">{{ Math.min(msg.directUnreadCount, 99) }}</span>
              </el-button>
            </el-tooltip>
            <el-tooltip :content="messageAriaLabel">
              <el-button class="message-entry" :class="{ 'has-direct': msg.directUnreadCount }" text :aria-label="messageAriaLabel" @click="$router.push('/messages')">
                <el-badge :value="msg.unreadCount" :hidden="msg.unreadCount === 0">
                  <el-icon size="20"><Bell /></el-icon>
                </el-badge>
              </el-button>
            </el-tooltip>
            <el-dropdown @command="onUserCmd">
              <span class="user-info">
                <UserAvatar :size="30" class="user-avatar" :src="auth.user?.avatar" :name="displayName" :seed="auth.user?.id" alt="用户头像" />
                <span class="user-name">{{ displayName }}</span>
                <el-icon><ArrowDown /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="profile">个人中心</el-dropdown-item>
                  <el-dropdown-item command="vip">VIP 中心</el-dropdown-item>
                  <el-dropdown-item command="settings">消息设置</el-dropdown-item>
                  <el-dropdown-item v-if="auth.canAccessModuleAdmin" command="admin" divided>🛠 管理后台</el-dropdown-item>
                  <el-dropdown-item command="logout" :divided="!auth.canAccessModuleAdmin" :disabled="logoutPending">退出登录</el-dropdown-item>
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
          <el-button
            v-if="auth.isLoggedIn"
            text
            class="touch-icon-btn message-entry"
            :class="{ 'has-direct': msg.directUnreadCount }"
            :aria-label="messageAriaLabel"
            @click="$router.push(msg.directUnreadCount ? '/messages?tab=private' : '/messages')"
          >
            <el-badge :value="msg.unreadCount" :hidden="msg.unreadCount === 0">
              <el-icon><component :is="msg.directUnreadCount ? Message : Bell" /></el-icon>
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
        v-if="assistantWidgetOpen && showFloatingActions"
        class="assistant-widget"
        role="dialog"
        aria-label="拾间AI"
      >
        <ShijianAssistant embedded @close="assistantWidgetOpen = false" />
      </aside>
    </transition>

    <transition name="assistant-widget">
      <aside
        v-if="toolsWidgetOpen && showToolsFab"
        class="tools-widget"
        role="dialog"
        aria-label="PC 小工具"
      >
        <DesktopToolsPanel
          @close="toolsWidgetOpen = false"
          @download-guide="showDesktopDownloadGuide"
        />
      </aside>
    </transition>

    <DownloadSafetyGuideDialog
      v-model="downloadSafetyGuideVisible"
      platform="windows"
    />

    <ComposeActionSheet v-if="useMobileForumLayout" v-model="composeMenuOpen" />

    <button
      v-if="showForumPostFab"
      type="button"
      class="forum-post-fab"
      aria-label="发布内容"
      @click="openForumPost"
    >
      <el-icon><Edit /></el-icon>
      <span>发布</span>
    </button>

    <button
      v-if="showToolsFab"
      type="button"
      class="tools-fab"
      aria-label="打开 PC 小工具"
      :aria-expanded="toolsWidgetOpen"
      title="PC 小工具"
      @click="toggleToolsWidget"
    >
      <el-icon>
        <Close v-if="toolsWidgetOpen" />
        <Monitor v-else />
      </el-icon>
    </button>

    <button
      v-if="showFloatingActions"
      type="button"
      class="assistant-fab"
      aria-label="打开拾间AI"
      :aria-expanded="assistantWidgetOpen"
      title="拾间AI"
      @click="toggleAssistantWidget"
    >
      <el-icon>
        <Close v-if="assistantWidgetOpen" />
        <ChatDotRound v-else />
      </el-icon>
    </button>

    <footer v-if="!hideChrome && !useNativeShell && !fullHeightContent" class="footer">
      <span class="footer-item">© 2026 药大拾间 · 校园互助与服务平台</span>
      <router-link class="footer-item" to="/download">客户端下载</router-link>
      <a class="footer-item" href="https://github.com/sx120609/CPU-web" target="_blank" rel="noopener noreferrer">GitHub</a>
      <span class="footer-item">非学校官方站点</span>
      <span class="footer-item">严禁商业用途</span>
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
          <UserAvatar :size="34" class="user-avatar" :src="auth.user?.avatar" :name="displayName" :seed="auth.user?.id" alt="用户头像" />
          <div class="drawer-user">
            <div>{{ displayName }}</div>
            <button type="button" @click="goDrawer({ id: 'system-profile', to: '/profile', label: '个人中心', icon: UserFilled })">个人中心</button>
          </div>
          <el-button text type="danger" :loading="logoutPending" :disabled="logoutPending" @click="onMobileLogout">退出</el-button>
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
  Download,
  StarFilled,
} from "@element-plus/icons-vue";
import type { TopNavigationIcon, TopNavigationItem } from "@/api/site";
import UserAvatar from "@/components/common/UserAvatar.vue";
import ShijianAssistant from "@/views/search/Result.vue";
import DesktopToolsPanel from "@/components/common/DesktopToolsPanel.vue";
import DownloadSafetyGuideDialog from "@/components/common/DownloadSafetyGuideDialog.vue";
import ComposeActionSheet from "@/components/forum/ComposeActionSheet.vue";
import { useAuthStore } from "@/stores/auth";
import { useMessageStore } from "@/stores/message";
import { useSiteStore } from "@/stores/site";
import { useAppearanceStore, type AppearanceMode } from "@/stores/appearance";
import { isDesktopNativeApp, isFlutterNativeShell } from "@/utils/clientInfo";

const auth = useAuthStore();
const msg = useMessageStore();
const site = useSiteStore();
const appearance = useAppearanceStore();
const router = useRouter();
const route = useRoute();
const q = ref("");
const mobileMenuOpen = ref(false);
const logoutPending = ref(false);
const assistantWidgetOpen = ref(false);
const toolsWidgetOpen = ref(false);
const downloadSafetyGuideVisible = ref(false);
const composeMenuOpen = ref(false);
const keyboardOpen = ref(false);
const keyboardGeometryOpen = ref(false);
const mobileViewportHeight = ref(0);
const mobileViewportWidth = ref(0);
const mobileViewportOffsetTop = ref(0);
const virtualKeyboardInset = ref(0);
const touchLikeViewport = ref(false);
const editableFocused = ref(false);
const editorFocused = ref(false);
const mobileViewportBaseHeight = ref(0);
const isMobileViewport = ref(false);
const KEYBOARD_INSET_THRESHOLD = 96;
const KEYBOARD_FOCUS_GRACE_MS = 1200;
const KEYBOARD_GEOMETRY_CLOSE_DELAY_MS = 240;
const viewportBaseHeights = new Map<string, number>();
let viewportBaselineOrientation = "";
let focusOutTimer = 0;
let focusKeyboardGraceTimer = 0;
let keyboardGeometryCloseTimer = 0;
let focusKeyboardGraceUntil = 0;
let disposed = false;

type VirtualKeyboardApi = EventTarget & {
  boundingRect?: { height?: number };
};

const appearanceOptions: Array<{ value: AppearanceMode; label: string; icon: unknown }> = [
  { value: "system", label: "跟随", icon: Monitor },
  { value: "light", label: "浅色", icon: Sunny },
  { value: "dark", label: "深色", icon: Moon },
];
const appearanceIcon = computed(() => (
  appearance.mode === "system" ? Monitor : appearance.resolved === "dark" ? Moon : Sunny
));
const messageAriaLabel = computed(() => {
  if (msg.directUnreadCount) return `消息，${msg.unreadCount} 条未读，其中 ${msg.directUnreadCount} 条私信`;
  return msg.unreadCount ? `消息，${msg.unreadCount} 条未读` : "消息";
});

/** 某些路由（如 /schedule）希望"裸壳"渲染，没有顶栏/免责声明/footer */
const hideChrome = computed(() => Boolean(route.meta?.hideChrome));
const fullWidthContent = computed(() => Boolean(route.meta?.fullWidthContent));
const fullHeightContent = computed(() => Boolean(route.meta?.fullHeightContent));
const useNativeShell = computed(() => isFlutterNativeShell());
// 两个悬浮球共用同一套显示条件
const showFloatingActions = computed(() => (
  !hideChrome.value
  && !useNativeShell.value
  && route.path !== "/search"
  && route.path !== "/messages"
));
// 桌面客户端把这些工具做成了应用自己的标签页，站内再挂一个悬浮球就是重复入口
const showToolsFab = computed(() => showFloatingActions.value && !isDesktopNativeApp());
const desktopForumRouteNames = new Set(["forum", "forum-hot", "forum-latest", "board", "topic", "market"]);
const mobileForumRouteNames = new Set(["home", ...desktopForumRouteNames]);
const useMobileForumLayout = computed(() => mobileViewportWidth.value > 0 && mobileViewportWidth.value <= 768);
const showForumPostFab = computed(() => (
  !hideChrome.value
  && !useNativeShell.value
  && site.features.forum
  && (useMobileForumLayout.value
    ? auth.canAccessForum && mobileForumRouteNames.has(String(route.name || ""))
    : desktopForumRouteNames.has(String(route.name || "")))
));

function openForumPost() {
  if (!useMobileForumLayout.value) {
    if (!auth.isLoggedIn) {
      void router.push({ name: "login", query: { redirect: "/post" } });
      return;
    }
    void router.push({ name: "post" });
    return;
  }
  composeMenuOpen.value = true;
}

// 两个面板占同一块位置，只能开一个
const toggleAssistantWidget = () => {
  if (!assistantWidgetOpen.value) toolsWidgetOpen.value = false;
  assistantWidgetOpen.value = !assistantWidgetOpen.value;
};

const toggleToolsWidget = () => {
  if (!toolsWidgetOpen.value) assistantWidgetOpen.value = false;
  toolsWidgetOpen.value = !toolsWidgetOpen.value;
};

const showDesktopDownloadGuide = () => {
  // 下载会把焦点切到浏览器下载列表。说明框放在布局根节点，并关掉底层工具面板，
  // 避免面板销毁或层叠上下文导致说明没有真正显示。
  toolsWidgetOpen.value = false;
  downloadSafetyGuideVisible.value = true;
};
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
  const keyboardInset = keyboardGeometryOpen.value
    ? Math.max(0, baseHeight - mobileViewportHeight.value, virtualKeyboardInset.value)
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
    { to: "/profile", label: "我的", icon: UserFilled, match: ["/profile", "/vip", "/sponsor-wall", "/messages", "/admin", "/u/"], auth: true },
  ] as { to: string; label: string; icon: any; match: string[]; auth?: boolean }[];
});

const drawerItems = computed(() => {
  const items: DrawerNavItem[] = [];
  if (auth.canAccessForum && site.features.forum) items.push({ id: "system-post", to: "/post", label: "发帖", icon: Edit });
  items.push({ id: "system-messages", to: "/messages", label: "消息", icon: Message });
  if (auth.isLoggedIn) items.push({ id: "system-vip", to: "/vip", label: "VIP 中心", icon: StarFilled });
  if (auth.canAccessModuleAdmin) items.push({ id: "system-admin", to: "/admin", label: "管理后台", icon: Tools });
  if (!items.some((item) => item.to === "/download")) items.push({ id: "system-download", to: "/download", label: "客户端下载", icon: Download });
  for (const item of site.topNavigation.filter((candidate) => candidate.to !== "/download" && candidate.showInDrawer && navigationItemVisible(candidate))) {
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

const displayName = computed(() => auth.user?.nickname?.trim() || auth.user?.username?.trim() || "已登录");

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
    getVirtualKeyboard()?.addEventListener("geometrychange", handleViewportMetricsChange);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
  }
});

onBeforeUnmount(() => {
  disposed = true;
  window.clearTimeout(focusOutTimer);
  window.clearTimeout(focusKeyboardGraceTimer);
  window.clearTimeout(keyboardGeometryCloseTimer);
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", handleViewportMetricsChange);
    window.visualViewport?.removeEventListener("resize", handleViewportMetricsChange);
    window.visualViewport?.removeEventListener("scroll", handleViewportMetricsChange);
    getVirtualKeyboard()?.removeEventListener("geometrychange", handleViewportMetricsChange);
    document.removeEventListener("focusin", handleFocusIn);
    document.removeEventListener("focusout", handleFocusOut);
  }
});

watch(() => route.fullPath, () => {
  assistantWidgetOpen.value = false;
  toolsWidgetOpen.value = false;
  window.clearTimeout(focusOutTimer);
  window.clearTimeout(focusKeyboardGraceTimer);
  window.clearTimeout(keyboardGeometryCloseTimer);
  keyboardGeometryCloseTimer = 0;
  focusKeyboardGraceUntil = 0;
  keyboardOpen.value = false;
  keyboardGeometryOpen.value = false;
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
  window.clearTimeout(focusKeyboardGraceTimer);
  window.clearTimeout(keyboardGeometryCloseTimer);
  keyboardGeometryCloseTimer = 0;
  const target = event.target instanceof HTMLElement ? event.target : null;
  editableFocused.value = isEditableElement(target);
  editorFocused.value = Boolean(target?.closest(".rich-editor"));
  focusKeyboardGraceUntil = editableFocused.value
    ? performance.now() + KEYBOARD_FOCUS_GRACE_MS
    : 0;
  if (focusKeyboardGraceUntil) {
    focusKeyboardGraceTimer = window.setTimeout(() => {
      syncViewportMetrics();
      updateKeyboardState();
    }, KEYBOARD_FOCUS_GRACE_MS + 50);
  }
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
  window.clearTimeout(focusKeyboardGraceTimer);
  focusKeyboardGraceUntil = 0;
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
  const orientation = getScreenOrientation();
  if (orientation !== viewportBaselineOrientation) {
    viewportBaselineOrientation = orientation;
    mobileViewportBaseHeight.value = Math.max(
      viewportBaseHeights.get(orientation) || 0,
      visualHeight,
      window.innerHeight,
    );
  }
  mobileViewportOffsetTop.value = Math.max(0, Math.round(window.visualViewport?.offsetTop ?? 0));
  mobileViewportHeight.value = visualHeight;
  mobileViewportWidth.value = visualWidth;
  virtualKeyboardInset.value = getVirtualKeyboardInset();
  touchLikeViewport.value = isTabletTouchViewport(visualWidth, visualHeight);
  isMobileViewport.value = isTouchNavigationViewport(visualWidth, visualHeight);
  const measuredInset = Math.max(0, mobileViewportBaseHeight.value - visualHeight);
  if (!editableFocused.value && measuredInset <= KEYBOARD_INSET_THRESHOLD) {
    const stableHeight = Math.max(mobileViewportBaseHeight.value, visualHeight, window.innerHeight);
    mobileViewportBaseHeight.value = stableHeight;
    viewportBaseHeights.set(orientation, Math.max(viewportBaseHeights.get(orientation) || 0, stableHeight));
  }
}

function getScreenOrientation() {
  const type = window.screen.orientation?.type || "";
  if (type.startsWith("portrait")) return "portrait";
  if (type.startsWith("landscape")) return "landscape";
  return window.screen.height >= window.screen.width ? "portrait" : "landscape";
}

function getVirtualKeyboard() {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardApi }).virtualKeyboard;
}

function getVirtualKeyboardInset() {
  return Math.max(0, Math.round(getVirtualKeyboard()?.boundingRect?.height || 0));
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
  const currentHeight = Math.round(window.visualViewport?.height ?? window.innerHeight);
  const baseHeight = Math.max(mobileViewportBaseHeight.value || 0, currentHeight, window.innerHeight);
  const measuredInset = Math.max(
    0,
    baseHeight - currentHeight,
    virtualKeyboardInset.value,
  );
  const focusedEditableNeedsKeyboard = isMobileViewport.value
    && editableFocused.value
    && performance.now() < focusKeyboardGraceUntil
    && (fullHeightContent.value || editorFocused.value);
  const geometryThreshold = keyboardGeometryOpen.value
    ? 56
    : KEYBOARD_INSET_THRESHOLD;
  const viewportStillCovered = isMobileViewport.value
    && measuredInset > geometryThreshold;
  if (viewportStillCovered) {
    window.clearTimeout(keyboardGeometryCloseTimer);
    keyboardGeometryCloseTimer = 0;
    keyboardGeometryOpen.value = true;
  } else if (keyboardGeometryOpen.value) {
    scheduleKeyboardGeometryClose();
  }
  const keyboardLikelyOpen = focusedEditableNeedsKeyboard || keyboardGeometryOpen.value;
  keyboardOpen.value = keyboardLikelyOpen;
  if (!keyboardLikelyOpen && !editableFocused.value) {
    const stableHeight = Math.max(mobileViewportBaseHeight.value, currentHeight, window.innerHeight);
    mobileViewportBaseHeight.value = stableHeight;
    viewportBaseHeights.set(
      viewportBaselineOrientation || getScreenOrientation(),
      stableHeight,
    );
  }
}

function scheduleKeyboardGeometryClose() {
  if (keyboardGeometryCloseTimer) return;
  keyboardGeometryCloseTimer = window.setTimeout(() => {
    keyboardGeometryCloseTimer = 0;
    const currentHeight = Math.round(window.visualViewport?.height ?? window.innerHeight);
    const baseHeight = Math.max(mobileViewportBaseHeight.value || 0, currentHeight, window.innerHeight);
    const measuredInset = Math.max(
      0,
      baseHeight - currentHeight,
      getVirtualKeyboardInset(),
    );
    if (measuredInset > 56) return;
    keyboardGeometryOpen.value = false;
    keyboardOpen.value = Boolean(
      isMobileViewport.value
      && editableFocused.value
      && performance.now() < focusKeyboardGraceUntil
      && (fullHeightContent.value || editorFocused.value),
    );
  }, KEYBOARD_GEOMETRY_CLOSE_DELAY_MS);
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
  await performLogout();
}

async function onUserCmd(cmd: string) {
  if (cmd === "profile") router.push("/profile");
  else if (cmd === "vip") router.push("/vip");
  else if (cmd === "settings") router.push("/messages?tab=settings");
  else if (cmd === "admin") router.push("/admin");
  else if (cmd === "logout") await performLogout();
}

async function performLogout() {
  if (logoutPending.value) return;
  logoutPending.value = true;
  mobileMenuOpen.value = false;
  try {
    await auth.logout();
    await router.replace("/login");
  } finally {
    logoutPending.value = false;
  }
}

function setAppearanceMode(command: string | number | object) {
  const mode = String(command);
  if (mode === "system" || mode === "light" || mode === "dark") appearance.setMode(mode);
}
</script>

<style scoped lang="scss">
.layout-root {
  --layout-mobile-tabbar-reserve: 0px;
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
  padding-top: var(--cpu-safe-area-inset-top, 0px);
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
  gap: 9px;
  text-decoration: none;
  color: inherit;
  flex-shrink: 0;
  min-width: 0;
}

.brand-logo {
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  display: block;
  border-radius: 11px;
  object-fit: contain;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
  min-width: 0;
}

.brand-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--cpu-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand-sub {
  font-size: 10.5px;
  color: var(--cpu-text-muted);
  letter-spacing: 0.8px;
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
  --mobile-header-control-size: 42px;
  display: none;
  height: var(--mobile-header-control-size);
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-wrap: nowrap;
}

.touch-icon-btn {
  flex: 0 0 var(--mobile-header-control-size);
  width: var(--mobile-header-control-size);
  min-width: var(--mobile-header-control-size);
  height: var(--mobile-header-control-size);
  min-height: var(--mobile-header-control-size);
  margin: 0 !important;
  padding: 0 !important;
  border-radius: 10px;
  color: var(--cpu-text-secondary);
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  -webkit-tap-highlight-color: rgba(22, 135, 118, 0.18);
}

.mobile-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.touch-icon-btn :deep(> span) {
  width: 100%;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.touch-icon-btn:active {
  background: var(--cpu-surface-subtle);
}

.touch-icon-btn :deep(.el-icon) {
  width: 22px;
  height: 22px;
  font-size: 22px;
  line-height: 1;
}

.touch-icon-btn :deep(.el-badge) {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.assistant-shortcut-touch {
  color: var(--cpu-text-secondary);
}

/* 面板放在悬浮球那一列的左边：右偏移 = 26 底距 + 58 球宽 + 12 间距。
   两颗球竖着占住右边一列，面板就不必为了让开它们而往上抬，高度也拿得回来。 */
.assistant-widget {
  position: fixed;
  z-index: 1090;
  right: 96px;
  bottom: 26px;
  width: min(clamp(440px, 32vw, 560px), calc(100vw - 122px));
  height: min(clamp(560px, 82dvh, 860px), calc(100dvh - 52px));
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 30%, var(--cpu-border-soft));
  border-radius: 24px;
  color: var(--cpu-text);
  background:
    linear-gradient(155deg, color-mix(in srgb, var(--cpu-primary) 6%, var(--cpu-card)) 0%, var(--cpu-card) 32%);
  box-shadow:
    0 28px 72px color-mix(in srgb, var(--cpu-primary-dark) 22%, transparent),
    0 5px 20px rgba(15, 23, 42, 0.1);
  isolation: isolate;
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

/* PC 小工具面板与 AI 面板占同一块位置，两者互斥打开 */
.tools-widget {
  position: fixed;
  z-index: 1090;
  right: 96px;
  bottom: 26px;
  display: flex;
  flex-direction: column;
  width: min(clamp(360px, 26vw, 420px), calc(100vw - 122px));
  height: min(760px, calc(100dvh - 52px));
  max-height: calc(100dvh - 52px);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 30%, var(--cpu-border-soft));
  border-radius: 20px;
  color: var(--cpu-text);
  background:
    linear-gradient(155deg, color-mix(in srgb, var(--cpu-primary) 6%, var(--cpu-card)) 0%, var(--cpu-card) 32%);
  box-shadow:
    0 28px 72px color-mix(in srgb, var(--cpu-primary-dark) 22%, transparent),
    0 5px 20px rgba(15, 23, 42, 0.1);
  isolation: isolate;
}

/* 竖着叠在 AI 悬浮球正上方：26 底距 + 58 球高 + 12 间距。
   注意两个面板的 bottom 必须让开这颗球的上沿（154px），否则球会压进面板右下角。 */
.tools-fab {
  position: fixed;
  z-index: 1091;
  right: 26px;
  bottom: 96px;
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 26%, var(--cpu-border));
  border-radius: 50%;
  cursor: pointer;
  color: var(--cpu-primary);
  background: var(--cpu-card);
  box-shadow:
    0 14px 32px color-mix(in srgb, var(--cpu-primary-dark) 16%, transparent),
    0 3px 10px rgba(15, 23, 42, 0.08);
  transition: transform 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;

  .el-icon {
    font-size: 24px;
  }

  &:hover {
    transform: translateY(-2px);
    color: var(--cpu-primary-dark);
    box-shadow:
      0 18px 40px color-mix(in srgb, var(--cpu-primary-dark) 22%, transparent),
      0 4px 12px rgba(15, 23, 42, 0.1);
  }
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
  background: linear-gradient(145deg, var(--cpu-primary), var(--cpu-primary-dark));
  box-shadow:
    0 16px 36px color-mix(in srgb, var(--cpu-primary-dark) 34%, transparent),
    0 4px 12px rgba(0, 0, 0, 0.12);
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
    0 20px 42px color-mix(in srgb, var(--cpu-primary-dark) 42%, transparent),
    0 5px 14px rgba(0, 0, 0, 0.14);
}

.assistant-fab:active {
  transform: scale(0.96);
}

.assistant-fab:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--cpu-primary) 30%, transparent);
  outline-offset: 3px;
}

.direct-message-shortcut {
  min-height: 34px;
  margin-left: 0 !important;
  padding: 0 10px !important;
  gap: 5px;
  border-radius: 999px;
  color: var(--cpu-primary);
  background: color-mix(in srgb, var(--cpu-primary) 11%, transparent);
  font-weight: 650;
}

.direct-message-shortcut:hover {
  color: #fff;
  background: var(--cpu-primary);
}

.direct-message-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  line-height: 1;
  box-sizing: border-box;
}

.message-entry.has-direct {
  color: var(--cpu-primary);
  background: color-mix(in srgb, var(--cpu-primary) 10%, transparent);
}

.message-entry.has-direct :deep(.el-badge__content) {
  border-color: var(--cpu-card);
  animation: direct-message-pulse 1.8s ease-in-out infinite;
}

@keyframes direct-message-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, .18); }
  50% { box-shadow: 0 0 0 5px rgba(239, 68, 68, 0); }
}

@media (prefers-reduced-motion: reduce) {
  .message-entry.has-direct :deep(.el-badge__content) { animation: none; }
}

.forum-post-fab {
  position: fixed;
  z-index: 1092;
  right: 26px;
  bottom: 166px;
  display: grid;
  width: 58px;
  height: 58px;
  min-height: 58px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--cpu-primary);
  color: #fff;
  box-shadow: 0 14px 30px color-mix(in srgb, var(--cpu-primary-dark) 28%, transparent);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.forum-post-fab .el-icon { font-size: 23px; }
.forum-post-fab span { display: none; }
.forum-post-fab:hover { background: var(--cpu-primary-dark); transform: translateY(-1px); }
.forum-post-fab:focus-visible { outline: 3px solid color-mix(in srgb, var(--cpu-primary) 28%, transparent); outline-offset: 3px; }

:global(html[data-theme="dark"]) .assistant-widget {
  border-color: color-mix(in srgb, var(--cpu-primary) 34%, var(--cpu-border-soft));
  background:
    linear-gradient(155deg, color-mix(in srgb, var(--cpu-primary) 9%, var(--cpu-card)) 0%, var(--cpu-card) 38%);
  box-shadow:
    0 30px 78px rgba(0, 0, 0, 0.48),
    0 0 0 1px rgba(54, 208, 183, 0.05);
}

.mobile-login-btn {
  flex: 0 0 auto;
  min-width: 60px;
  height: var(--mobile-header-control-size, 42px);
  min-height: var(--mobile-header-control-size, 42px);
  margin: 0 !important;
  padding: 0 12px;
  color: var(--cpu-primary);
  font-weight: 500;
  box-sizing: border-box;
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

.layout-root--full-height.keyboard-geometry-open {
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
  transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.16s ease, visibility 0.2s linear;
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

  .assistant-fab,
  .tools-fab {
    display: none;
  }

  .assistant-widget,
  .tools-widget {
    display: none;
  }

  .forum-post-fab {
    right: 14px;
    bottom: calc(var(--layout-mobile-tabbar-reserve) + 12px);
    width: auto;
    height: 52px;
    min-height: 52px;
    justify-content: center;
    padding: 0 15px;
  }

  .forum-post-fab span { display: inline; }
}

@media (max-width: 768px) {
  .layout-root:not(.layout-root--native-shell) {
    --layout-mobile-tabbar-reserve: calc(68px + env(safe-area-inset-bottom));
  }

  .layout-root.keyboard-open .main {
    padding-bottom: 12px;
  }

  .layout-root.keyboard-open .forum-post-fab { display: none; }

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
    flex-wrap: nowrap;
  }

  .brand {
    flex: 1 1 auto;
  }

  .brand-logo {
    width: 34px;
    height: 34px;
    border-radius: 9px;
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
    padding-bottom: calc(68px + env(safe-area-inset-bottom));
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
    transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.16s ease, visibility 0.2s linear;
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
    transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.16s ease, visibility 0.2s linear;
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

  .mobile-actions {
    --mobile-header-control-size: 38px;
    gap: 6px;
  }
}

@media (max-width: 360px) {
  .topbar-inner {
    padding-inline: 10px;
  }

  .brand-logo {
    width: 32px;
    height: 32px;
  }

  .brand-name {
    font-size: 15px;
  }

  .mobile-actions {
    --mobile-header-control-size: 36px;
    gap: 4px;
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
