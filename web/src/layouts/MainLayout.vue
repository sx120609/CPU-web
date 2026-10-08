<template>
  <div
    class="layout-root"
    :class="{
      'keyboard-open': keyboardOpen,
      'keyboard-geometry-open': keyboardGeometryOpen,
      'layout-root--full-width': fullWidthContent && !hideChrome,
      'layout-root--full-height': fullHeightContent && !hideChrome,
      'layout-root--assistant': route.name === 'search',
      'layout-root--native-shell': useFlutterShell,
      'layout-root--ios-next': useIosNextShell,
      'layout-root--tabbar-fallback': showWebTabbar,
      'layout-root--no-tools-fab': !showToolsFab,
      'layout-root--post-fab': showForumPostFab,
      'layout-root--android-insets': isAndroidNativeApp(),
    }"
    :style="layoutStyle"
  >
    <!-- Native shells supply their own navigation; detail pages own theirs. -->
    <header v-if="!hideChrome && !useNativeShell && !mobileTopicChrome" class="topbar">
      <div class="topbar-inner">
        <router-link to="/home" class="brand">
          <img
            class="brand-logo"
            :src="'/favicon.svg?v=20260830'"
            alt=""
            aria-hidden="true"
            decoding="async"
            data-image-eager="true"
          />
          <span class="brand-text">
            <span class="brand-name">药大拾间</span>
            <span class="brand-sub">CPU 校园互助服务</span>
          </span>
        </router-link>

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
            <button data-cpu-button="icon" type="button" class="top-nav-more-btn">
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
          <el-tooltip content="刷新页面" :disabled="!ff.canHover">
            <el-button text class="page-refresh-btn" aria-label="刷新页面" @click="reloadPage">
              <el-icon size="20"><Refresh /></el-icon>
            </el-button>
          </el-tooltip>
          <el-dropdown trigger="click" @command="setAppearanceMode">
            <button data-cpu-button="icon" type="button" class="appearance-cycle-btn" :aria-label="`外观：${appearance.modeLabel}`">
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
            <el-tooltip v-if="msg.directUnreadCount" :content="`${msg.directUnreadCount} 条未读私信`" :disabled="!ff.canHover">
              <el-button class="direct-message-shortcut" text @click="$router.push('/messages?tab=private')">
                <el-icon><Message /></el-icon>
                <span>私信</span>
                <span class="direct-message-count">{{ Math.min(msg.directUnreadCount, 99) }}</span>
              </el-button>
            </el-tooltip>
            <el-tooltip :content="messageAriaLabel" :disabled="!ff.canHover">
              <el-button class="message-entry" :class="{ 'has-direct': msg.directUnreadCount }" text :aria-label="messageAriaLabel" @click="$router.push('/messages')">
                <el-badge :value="msg.unreadCount" :hidden="msg.unreadCount === 0">
                  <el-icon size="20"><Bell /></el-icon>
                </el-badge>
              </el-button>
            </el-tooltip>
            <!-- Hover opens it with a mouse; a tap has no hover, so touch devices open and close it by tapping. -->
            <el-dropdown :trigger="ff.canHover ? 'hover' : 'click'" @command="onUserCmd">
              <span class="user-info">
                <UserAvatar :size="30" class="user-avatar" :src="auth.user?.avatar" :name="displayName" :seed="auth.user?.id" alt="用户头像" />
                <span class="user-name">{{ displayName }}</span>
                <el-icon><ArrowDown /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="profile">个人中心</el-dropdown-item>
                  <el-dropdown-item v-if="!hidesNativeCommerce()" command="vip">VIP 中心</el-dropdown-item>
                  <el-dropdown-item command="settings">消息设置</el-dropdown-item>
                  <el-dropdown-item v-if="auth.canAccessModuleAdmin" command="admin" divided><AppIcon name="tools" /> 管理后台</el-dropdown-item>
                  <el-dropdown-item command="logout" :divided="!auth.canAccessModuleAdmin" :disabled="logoutPending">退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <template v-else>
            <el-button type="primary" round class="top-login-btn" @click="goAuth('login')">登录</el-button>
          </template>
        </div>

        <div class="mobile-actions cpu-button-row">
          <el-button text class="touch-icon-btn" aria-label="刷新页面" @click="reloadPage">
            <el-icon><Refresh /></el-icon>
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
        'main--mobile-topic': mobileTopicChrome,
      }"
    >
      <IosAppRecommendation v-if="route.name === 'home'" style="--ios-app-recommendation-max-width: 1120px" />
      <router-view v-slot="{ Component }">
        <transition name="page-route" :css="!auth.forumHidden && (!useIosRouteTransition || (iosRouteTransitionEnabled && !useIosNextShell))"
          @before-leave="freezeRoutePage" @after-leave="releaseRoutePage" @leave-cancelled="releaseRoutePage">
          <component :is="Component" v-if="!auth.forumHidden || !isForumDestination(route.path)" />
        </transition>
      </router-view>
    </main>

    <transition name="assistant-widget">
      <aside
        v-if="assistantWidgetOpen && showFloatingActions && assistantEntryVisible"
        class="assistant-widget"
        :class="{ 'is-keyboard-pinned': assistantKeyboardPinned }"
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
      v-if="downloadSafetyGuideVisible"
      v-model="downloadSafetyGuideVisible"
      platform="windows"
    />

    <button data-cpu-button="surface"
      v-if="showForumPostFab"
      type="button"
      class="forum-post-fab"
      aria-label="投稿"
      @click="openForumPost"
    >
      <el-icon><Edit /></el-icon>
      <span>投稿</span>
    </button>

    <button data-cpu-button="surface"
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

    <button data-cpu-button="surface"
      v-if="showFloatingActions && assistantEntryVisible"
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

    <SiteFooter
      v-if="!hideChrome && !fullHeightContent && !mobileTopicChrome && (!useFlutterShell || showAppFiling)"
      :app-filing="showAppFiling"
      :compact="useFlutterShell"
      :fab-gutter="showToolsFab || showForumPostFab || (showFloatingActions && assistantEntryVisible)"
    />

    <MobileTabbar
      v-if="showWebTabbar"
      class="mobile-tabbar"
      :hidden="keyboardOpen"
      :items="mobileNavItems.map(item => ({ ...item, to: resolveMobileTo(item) }))"
      :active-index="mobileNavItems.findIndex(isMobileRouteActive)"
    />

    <el-drawer
      v-model="mobileMenuOpen"
      direction="btt"
      size="auto"
      class="mobile-drawer"
      title="快捷入口"
    >
      <div class="drawer-grid">
        <button data-cpu-button="surface"
          v-for="item in drawerItems"
          :key="item.id"
          type="button"
          class="drawer-link"
          @click="goDrawer(item)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </button>
      </div>
      <div class="drawer-appearance">
        <span>外观</span>
        <div class="appearance-segmented" role="radiogroup" aria-label="外观模式">
          <button data-cpu-button="option"
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
            <button data-cpu-button="action" type="button" @click="goDrawer({ id: 'system-profile', to: '/profile', label: '个人中心', icon: UserFilled })">个人中心</button>
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
        {{ nicknameHint }}，<b>不会展示你的学号</b>。提交后由 AI 在后台异步审核，通过后才会公开显示。
      </p>
      <p v-if="nicknameReviewProblem" class="dlg-review-problem">{{ nicknameReviewProblem }}</p>
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
import IosAppRecommendation from "@/components/install/IosAppRecommendation.vue";
import { ref, computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, watch, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import MobileTabbar from "../components/common/MobileTabbar.vue";
import SiteFooter from "../components/common/SiteFooter.vue";
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
import AppIcon from "@/components/common/AppIcon.vue";
import { useAuthStore } from "@/stores/auth";
import { useMessageStore } from "@/stores/message";
import { isForumDestination } from "@/utils/nativeForumVisibility";
import { useSiteStore } from "@/stores/site";
import { useAppearanceStore, type AppearanceMode } from "@/stores/appearance";
import { iosRouteTransitionEnabled } from "@/router";
import { freezeLeavingPage, releaseLeavingPage } from "@/utils/routeTransition";
import { canOfferDesktopClient, isAndroidNativeApp, isCampusAssistantDestination, isFlutterNativeShell, isIosNextNativeShell, isLikelyIosDevice, hidesNativeCommerce, shouldHideHarmonyAssistant } from "@/utils/clientInfo";
import { useFormFactor } from "@/utils/formFactor";
import {
  assumesKeyboardOnFocus,
  closeKeyboardAfterBlur,
  initialKeyboardViewportState,
  KEYBOARD_BLUR_CLOSE_MS,
  reduceKeyboardBaseline,
  reduceKeyboardGeometry,
  settleKeyboardGeometryClose,
  type KeyboardViewportState,
  type ViewportSample,
} from "@/utils/keyboardViewport";
import { isRegisteredMobileApp } from "../../../shared/appFiling";

const ShijianAssistant = defineAsyncComponent(() => import("@/views/search/Result.vue"));
const DesktopToolsPanel = defineAsyncComponent(() => import("@/components/common/DesktopToolsPanel.vue"));
const DownloadSafetyGuideDialog = defineAsyncComponent(() => import("@/components/common/DownloadSafetyGuideDialog.vue"));

const auth = useAuthStore();
const msg = useMessageStore();
const site = useSiteStore();
const appearance = useAppearanceStore();
const router = useRouter();
const route = useRoute();
const ff = useFormFactor();
const mobileMenuOpen = ref(false);
const logoutPending = ref(false);
const assistantWidgetOpen = ref(false);
const toolsWidgetOpen = ref(false);
const downloadSafetyGuideVisible = ref(false);
const keyboardOpen = ref(false);
const keyboardGeometryOpen = ref(false);
const mobileViewportHeight = ref(0);
const mobileViewportOffsetTop = ref(0);
const virtualKeyboardInset = ref(0);
const editableFocused = ref(false);
const editorFocused = ref(false);
const assistantFocused = ref(false);
const mobileViewportBaseHeight = ref(0);
const headerCollapsedViewport = ref(false);
// Keyboard detection runs wherever a software keyboard can cover the page; it never decides the layout.
const isMobileViewport = computed(() => ff.value.compact || ff.value.touchPrimary);
const KEYBOARD_FOCUS_GRACE_MS = 1200;
const KEYBOARD_GEOMETRY_CLOSE_DELAY_MS = 240;
const HEADER_COLLAPSED_QUERY = "(max-width: 960px)";
const NICKNAME_REVIEW_POLL_MIN_MS = 5_000;
const NICKNAME_REVIEW_POLL_MAX_MS = 60_000;
let keyboardViewport: KeyboardViewportState = initialKeyboardViewportState;
let focusOutTimer = 0;
let focusKeyboardGraceTimer = 0;
let keyboardGeometryCloseTimer = 0;
let keyboardBlurCloseTimer = 0;
let nicknameReviewPollTimer = 0;
let nicknameReviewPollDelay = NICKNAME_REVIEW_POLL_MIN_MS;
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
const hideChrome = computed(() => Boolean(route.meta?.hideChrome)
  || (useIosNextShell.value && route.meta?.nativeChrome === "page"));
const fullWidthContent = computed(() => Boolean(route.meta?.fullWidthContent));
const fullHeightContent = computed(() => Boolean(route.meta?.fullHeightContent));
const useFlutterShell = computed(() => isFlutterNativeShell());
const useIosNextShell = computed(() => isIosNextNativeShell());
const useNativeShell = computed(() => useFlutterShell.value || useIosNextShell.value);
const showAppFiling = isRegisteredMobileApp(navigator.userAgent);
const useIosRouteTransition = isLikelyIosDevice();
// 两个悬浮球共用同一套显示条件
const showFloatingActions = computed(() => (
  !hideChrome.value
  && !useNativeShell.value
  && route.path !== "/search"
  && route.path !== "/messages"
));
const assistantEntryVisible = computed(() => site.features.assistantEntry
  && !shouldHideHarmonyAssistant(auth.isLoggedIn, auth.user?.username));
// PC 小工具只对真正的 Windows / macOS 桌面有用：桌面客户端里已是独立标签页，iPad、手机和各 App 壳都装不了。
const desktopToolsOffered = canOfferDesktopClient();
const showToolsFab = computed(() => showFloatingActions.value && desktopToolsOffered);
const desktopForumRouteNames = new Set(["forum", "forum-hot", "forum-latest", "board", "topic", "market"]);
const mobileForumRouteNames = new Set(["home", ...desktopForumRouteNames]);
// Pages, the router and this shell share one classifier, so the phone tree always gets phone chrome.
const useMobileForumLayout = computed(() => ff.value.compact);
const mobileTopicChrome = computed(() => useMobileForumLayout.value && route.name === "topic");
const showWebTabbar = computed(() => ff.value.compact && !useNativeShell.value && !mobileTopicChrome.value);
const showForumPostFab = computed(() => {
  const routeName = String(route.name || "");
  return !hideChrome.value
    && !useNativeShell.value
    && !mobileTopicChrome.value
    && site.features.forum
    && auth.canAccessForum
    && (useMobileForumLayout.value
      ? auth.canAccessForum && mobileForumRouteNames.has(routeName)
      // On a touch tablet in landscape the button would cover the topic's own reply controls.
      : desktopForumRouteNames.has(routeName) && !(ff.value.device === "tablet" && routeName === "topic"));
});
// The pill-shaped 投稿 button sits just above the tab bar; content outside .layout-root reads it from <html>.
const compactPostFabVisible = computed(() => (
  showForumPostFab.value && !keyboardOpen.value && (ff.value.compact || headerCollapsedViewport.value)
));
const assistantKeyboardPinned = computed(() => (
  assistantWidgetOpen.value && keyboardGeometryOpen.value && assistantFocused.value
));

function openForumPost() {
  const target = useMobileForumLayout.value ? "/post?board=general" : "/post";
  if (!auth.isLoggedIn) {
    void router.push({ name: "login", query: { redirect: target } });
    return;
  }
  void router.push(target);
}

// 两个面板占同一块位置，只能开一个
const toggleAssistantWidget = () => {
  if (!assistantEntryVisible.value) return;
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
  if (site.features.forum && auth.canAccessForum) actions.push("发帖、回复");
  if (site.features.coursereview && !auth.forumHidden) actions.push("课程点评");
  if (!actions.length) return "后续使用站内功能时会显示昵称";
  return `后续${actions.join("和")}都会显示昵称`;
});

const desktopNavItems = computed(() => {
  return site.topNavigation.filter(navigationItemVisible);
});

function reloadPage() {
  window.location.reload();
}

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
    { to: "/profile", label: "我的", icon: UserFilled, match: ["/profile", "/vip", "/sponsor", "/sponsor-wall", "/messages", "/admin", "/u/"], auth: true },
  ] as { to: string; label: string; icon: any; match: string[]; auth?: boolean }[];
});

const drawerItems = computed(() => {
  const items: DrawerNavItem[] = [];
  if (auth.canAccessForum && site.features.forum) items.push({ id: "system-post", to: "/post", label: "发帖", icon: Edit });
  items.push({ id: "system-messages", to: "/messages", label: "消息", icon: Message });
  if (auth.isLoggedIn && !hidesNativeCommerce()) items.push({ id: "system-vip", to: "/vip", label: "VIP 中心", icon: StarFilled });
  if (auth.canAccessModuleAdmin) items.push({ id: "system-admin", to: "/admin", label: "管理后台", icon: Tools });
  if (!items.some((item) => item.to === "/download")) items.push({ id: "system-download", to: "/download", label: "客户端下载", icon: Download });
  for (const item of site.topNavigation.filter((candidate) => candidate.to !== "/download" && candidate.showInDrawer && navigationItemVisible(candidate))) {
    items.push({ id: `configured-${item.id}`, to: item.to, label: item.fullLabel || item.label, icon: navigationIconMap[item.icon], openInNewTab: item.openInNewTab });
  }
  if (assistantEntryVisible.value && !items.some((item) => item.to === "/search")) items.push({ id: "system-search", to: "/search", label: "拾间AI", icon: Search });
  return items;
});

function navigationItemVisible(item: TopNavigationItem) {
  if (auth.forumHidden && (isForumDestination(item.to) || item.requireForumAccess
    || ["forum", "market", "coursereview"].includes(item.feature || ""))) return false;
  if (!item.enabled) return false;
  if (isCampusAssistantDestination(item.to) && !assistantEntryVisible.value) return false;
  if (/^\/(?:forum|market|coursereview)(?:[/?#]|$)/.test(item.to) && !auth.canAccessForum) return false;
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

const displayName = computed(() => auth.user?.nickname?.trim() || "药大同学");

// 首次登录设昵称
const showNicknameDialog = ref(false);
const newNickname = ref("");
const savingNickname = ref(false);
const nicknameReviewProblem = computed(() => {
  const review = auth.user?.nicknameReview;
  if (review?.status === "rejected") return review.reason || "上次提交的昵称未通过审核，请换一个昵称。";
  if (review?.status === "review_failed") return review.reason || "上次昵称审核暂未完成，请重新提交。";
  return "";
});

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
    ElMessage.success("昵称已提交审核，通过后将公开显示");
    showNicknameDialog.value = false;
    newNickname.value = "";
  } finally { savingNickname.value = false; }
}

function stopNicknameReviewPoll() {
  window.clearTimeout(nicknameReviewPollTimer);
  nicknameReviewPollTimer = 0;
}

// 昵称审核通常很快完成；轮询间隔逐步拉长，页面在后台时不发请求，回到前台再立即补查。
function scheduleNicknameReviewPoll() {
  stopNicknameReviewPoll();
  nicknameReviewPollTimer = window.setTimeout(() => {
    nicknameReviewPollTimer = 0;
    if (!document.hidden) void auth.refreshSelfSilently();
    nicknameReviewPollDelay = Math.min(nicknameReviewPollDelay * 2, NICKNAME_REVIEW_POLL_MAX_MS);
    scheduleNicknameReviewPoll();
  }, nicknameReviewPollDelay);
}

function handleNicknameReviewVisibilityChange() {
  if (document.hidden || auth.user?.nicknameReview?.status !== "checking") return;
  void auth.refreshSelfSilently();
  scheduleNicknameReviewPoll();
}

watch(() => auth.user?.nicknameReview?.status, (status) => {
  stopNicknameReviewPoll();
  if (status === "checking") {
    nicknameReviewPollDelay = NICKNAME_REVIEW_POLL_MIN_MS;
    scheduleNicknameReviewPoll();
  }
}, { immediate: true });

// Measure before the first render so the layout never starts from an empty viewport height.
syncViewportMetrics();

// Elements outside .layout-root (teleported cards, overlays) position themselves from these values.
watchEffect(() => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (showWebTabbar.value && !keyboardOpen.value) root.setAttribute("data-cpu-web-tabbar", "");
  else root.removeAttribute("data-cpu-web-tabbar");
  if (compactPostFabVisible.value) root.setAttribute("data-cpu-post-fab", "");
  else root.removeAttribute("data-cpu-post-fab");
  root.style.setProperty(
    "--cpu-web-tabbar-reserve",
    isAndroidNativeApp() ? "56px" : "calc(56px + env(safe-area-inset-bottom, 0px))",
  );
});

onMounted(async () => {
  disposed = false;
  // Listeners first: the session check can take seconds, and a rotation or keyboard in that time must not be missed.
  syncViewportMetrics();
  if (typeof window !== "undefined") {
    window.addEventListener("resize", handleViewportMetricsChange, { passive: true });
    window.visualViewport?.addEventListener("resize", handleViewportMetricsChange);
    window.visualViewport?.addEventListener("scroll", handleViewportMetricsChange);
    getVirtualKeyboard()?.addEventListener("geometrychange", handleViewportMetricsChange);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("visibilitychange", handleNicknameReviewVisibilityChange);
  }
  if (auth.token && !auth.user) await auth.fetchMe();
  if (disposed) return;
  if (auth.isLoggedIn) msg.refresh();
});

onBeforeUnmount(() => {
  disposed = true;
  window.clearTimeout(focusOutTimer);
  window.clearTimeout(focusKeyboardGraceTimer);
  window.clearTimeout(keyboardGeometryCloseTimer);
  window.clearTimeout(keyboardBlurCloseTimer);
  stopNicknameReviewPoll();
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.removeAttribute("data-cpu-web-tabbar");
    root.removeAttribute("data-cpu-post-fab");
    root.style.removeProperty("--cpu-web-tabbar-reserve");
  }
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", handleViewportMetricsChange);
    window.visualViewport?.removeEventListener("resize", handleViewportMetricsChange);
    window.visualViewport?.removeEventListener("scroll", handleViewportMetricsChange);
    getVirtualKeyboard()?.removeEventListener("geometrychange", handleViewportMetricsChange);
    document.removeEventListener("focusin", handleFocusIn);
    document.removeEventListener("focusout", handleFocusOut);
    document.removeEventListener("visibilitychange", handleNicknameReviewVisibilityChange);
  }
});

watch(() => route.fullPath, () => {
  assistantWidgetOpen.value = false;
  toolsWidgetOpen.value = false;
  window.clearTimeout(focusOutTimer);
  window.clearTimeout(focusKeyboardGraceTimer);
  window.clearTimeout(keyboardGeometryCloseTimer);
  window.clearTimeout(keyboardBlurCloseTimer);
  keyboardGeometryCloseTimer = 0;
  keyboardBlurCloseTimer = 0;
  focusKeyboardGraceUntil = 0;
  // A query-only navigation (拾间AI sending from the keyboard) keeps the field focused and the keyboard up,
  // and no focusin follows, so read focus from the page instead of assuming it was lost.
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  editableFocused.value = isEditableElement(active);
  editorFocused.value = Boolean(active?.closest(".rich-editor"));
  assistantFocused.value = Boolean(active?.closest(".assistant-widget"));
  if (editableFocused.value) {
    // The leaving page can still hold focus; removing it fires no focusout, so check again shortly.
    scheduleKeyboardBlurClose();
  } else {
    keyboardOpen.value = false;
    applyKeyboardViewport({ ...keyboardViewport, geometryOpen: false });
  }
  syncViewportMetrics();
  updateKeyboardState();
});

watch(assistantEntryVisible, (visible) => {
  if (!visible) assistantWidgetOpen.value = false;
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
  // Focus on a button or dialog brings no software keyboard, so the blur safety net keeps running.
  if (editableFocused.value) {
    window.clearTimeout(keyboardBlurCloseTimer);
    keyboardBlurCloseTimer = 0;
  }
  editorFocused.value = Boolean(target?.closest(".rich-editor"));
  assistantFocused.value = Boolean(target?.closest(".assistant-widget"));
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
  // Only phones can assume a keyboard before the viewport shrinks; tablets often use a hardware keyboard.
  if (fullHeightContent.value && editableFocused.value && ff.value.device === "phone") {
    keyboardOpen.value = true;
    return;
  }
  if (editorFocused.value && ff.value.device === "phone") {
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
    assistantFocused.value = Boolean(active?.closest(".assistant-widget"));
    syncViewportMetrics();
    updateKeyboardState();
  }, 120);
  scheduleKeyboardBlurClose();
}

// Without a focused editable no software keyboard can be up, whatever a rotation left in the geometry.
function scheduleKeyboardBlurClose() {
  window.clearTimeout(keyboardBlurCloseTimer);
  keyboardBlurCloseTimer = window.setTimeout(() => {
    keyboardBlurCloseTimer = 0;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (isEditableElement(active)) return;
    window.clearTimeout(keyboardGeometryCloseTimer);
    keyboardGeometryCloseTimer = 0;
    editableFocused.value = false;
    editorFocused.value = false;
    assistantFocused.value = false;
    applyKeyboardViewport(closeKeyboardAfterBlur(keyboardViewport, readViewportSample()));
    keyboardOpen.value = false;
  }, KEYBOARD_BLUR_CLOSE_MS);
}

function isEditableElement(target: HTMLElement | null) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || Boolean(target.closest("[contenteditable='true']"));
}

function readViewportSample(): ViewportSample {
  const viewport = window.visualViewport;
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    visualHeight: viewport?.height ?? window.innerHeight,
    visualScale: viewport?.scale ?? 1,
    keyboardInset: getVirtualKeyboardInset(),
  };
}

function applyKeyboardViewport(next: KeyboardViewportState) {
  keyboardViewport = next;
  mobileViewportBaseHeight.value = next.baseHeight;
  keyboardGeometryOpen.value = next.geometryOpen;
}

function keyboardClosePending() {
  return keyboardViewport.geometryOpen || keyboardGeometryCloseTimer !== 0 || keyboardBlurCloseTimer !== 0;
}

function keyboardAssumedFromFocus() {
  return assumesKeyboardOnFocus(ff.value.device, {
    editableFocused: editableFocused.value,
    withinFocusGrace: performance.now() < focusKeyboardGraceUntil,
    fullHeightContent: fullHeightContent.value,
    editorFocused: editorFocused.value,
  });
}

function syncViewportMetrics() {
  if (typeof window === "undefined") return;
  const sample = readViewportSample();
  mobileViewportOffsetTop.value = Math.max(0, Math.round(window.visualViewport?.offsetTop ?? 0));
  mobileViewportHeight.value = Math.round(sample.visualHeight);
  virtualKeyboardInset.value = sample.keyboardInset ?? 0;
  headerCollapsedViewport.value = window.matchMedia?.(HEADER_COLLAPSED_QUERY).matches ?? window.innerWidth <= 960;
  applyKeyboardViewport(reduceKeyboardBaseline(keyboardViewport, sample, {
    editableFocused: editableFocused.value,
    closePending: keyboardClosePending(),
    innerHeightIgnoresKeyboard: ff.value.appleTouch,
  }));
}

function getVirtualKeyboard() {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardApi }).virtualKeyboard;
}

function getVirtualKeyboardInset() {
  return Math.max(0, Math.round(getVirtualKeyboard()?.boundingRect?.height || 0));
}

function updateKeyboardState() {
  if (typeof window === "undefined") return;
  const sample = readViewportSample();
  const result = reduceKeyboardGeometry(keyboardViewport, sample, {
    editableFocused: editableFocused.value,
    enabled: isMobileViewport.value,
  });
  applyKeyboardViewport(result.state);
  if (result.scheduleClose) scheduleKeyboardGeometryClose();
  keyboardOpen.value = keyboardAssumedFromFocus() || keyboardGeometryOpen.value;
  if (!keyboardOpen.value && !editableFocused.value) {
    applyKeyboardViewport(reduceKeyboardBaseline(keyboardViewport, sample, {
      editableFocused: false,
      closePending: keyboardClosePending(),
      innerHeightIgnoresKeyboard: ff.value.appleTouch,
    }));
  }
}

function scheduleKeyboardGeometryClose() {
  if (keyboardGeometryCloseTimer) return;
  keyboardGeometryCloseTimer = window.setTimeout(() => {
    keyboardGeometryCloseTimer = 0;
    applyKeyboardViewport(settleKeyboardGeometryClose(keyboardViewport, readViewportSample()));
    if (keyboardGeometryOpen.value) return;
    keyboardOpen.value = keyboardAssumedFromFocus();
  }, KEYBOARD_GEOMETRY_CLOSE_DELAY_MS);
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

function freezeRoutePage(element: Element) {
  // The native iOS shell keeps the shared WKWebView mounted while its native
  // tab selection changes. Freezing a Web page here would briefly pin the old
  // scroll position over the new route and produce a white flash.
  if (useIosNextShell.value) return;
  freezeLeavingPage(element);
}

function releaseRoutePage(element: Element) {
  if (useIosNextShell.value) return;
  releaseLeavingPage(element);
}

</script>

<style scoped lang="scss">
@use "../styles/compact" as *;

.layout-root {
  /* 底栏贴底、通栏：56px 加上系统手势条的安全区 */
  --liquid-tabbar-reserve: calc(56px + env(safe-area-inset-bottom, 0px));
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
  background: var(--cpu-card);
  box-shadow: inset 0 -1px 0 var(--cpu-border-soft);
  position: sticky;
  top: 0;
  z-index: 100;
  padding-top: var(--cpu-safe-area-inset-top, 0px);
}

.topbar-inner {
  max-width: 1280px;
  margin: 0 auto;
  height: 64px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 18px;
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
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  display: block;
  object-fit: contain;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
  min-width: 0;
}

.brand-name {
  font-size: var(--cpu-fs-l);
  font-weight: 700;
  color: var(--cpu-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand-sub {
  margin-top: 2px;
  font-size: var(--cpu-fs-xs);
  color: var(--cpu-text-muted);
}

/* 主导航是一排文字链接：当前页有一块浅灰底，其余只在悬停时变色。 */
.top-nav {
  display: flex;
  gap: 2px;
  flex: 0 1 auto;
  min-width: 0;
  overflow-x: visible;
  overflow-y: hidden;
  align-items: center;
}

.top-nav a {
  display: inline-flex;
  height: 36px;
  flex: 0 0 auto;
  align-items: center;
  padding: 0 12px;
  border-radius: 8px;
  color: var(--cpu-text-secondary);
  text-decoration: none;
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

@media (hover: hover) {
  .top-nav a:hover { color: var(--cpu-text); }
}
.top-nav a:active { color: var(--cpu-text); }
.top-nav a.router-link-active { color: var(--cpu-text); background: var(--cpu-bg); }
.top-nav a:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 1px; }
.top-nav:not(:has(*)) { display: none; }

.top-nav-more {
  flex: 0 0 auto;
}

.top-nav-more-btn {
  display: inline-flex;
  height: 36px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  line-height: 1;
  padding: 0 12px;
  white-space: nowrap;
}

.top-nav-more-btn:hover,
.top-nav-more-btn:focus-visible {
  color: var(--cpu-text);
  background: var(--cpu-bg);
  outline: none;
}

.top-right {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
}

.top-right .top-login-btn { margin-left: 8px; }

.page-refresh-btn,
.top-right .message-entry {
  min-width: 44px;
  min-height: 44px;
}

// el-badge 默认 inline-block + 基线对齐，会把铃铛顶高几像素，和旁边的刷新/外观图标对不齐
.top-right .message-entry :deep(.el-badge) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
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
  background: var(--cpu-primary-soft);
  font-weight: 500;
}

:global(.el-dropdown-menu__item.is-current-appearance .el-icon) {
  color: var(--cpu-primary);
}

.mobile-actions {
  --mobile-header-control-size: 44px;
  display: none;
  align-items: center;
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
  border-radius: 999px;
  color: var(--cpu-text-secondary);
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  -webkit-tap-highlight-color: transparent;
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
  background: var(--cpu-bg);
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
  /* The tab-bar reserve is 0 wherever these show; it only guards against a future overlap. */
  bottom: calc(var(--layout-mobile-tabbar-reserve) + 26px);
  width: min(clamp(440px, 32vw, 560px), calc(100vw - 122px));
  height: min(clamp(560px, 82dvh, 860px), calc(100dvh - 52px - var(--layout-mobile-tabbar-reserve)));
  overflow: hidden;
  border: 1px solid var(--cpu-border);
  border-radius: 22px;
  color: var(--cpu-text);
  background: var(--cpu-card);
  box-shadow:
    0 24px 64px rgba(15, 23, 42, 0.16),
    0 4px 16px rgba(15, 23, 42, 0.06);
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
  bottom: calc(var(--layout-mobile-tabbar-reserve) + 26px);
  display: flex;
  flex-direction: column;
  width: min(clamp(360px, 26vw, 420px), calc(100vw - 122px));
  height: min(760px, calc(100dvh - 52px - var(--layout-mobile-tabbar-reserve)));
  max-height: calc(100dvh - 52px - var(--layout-mobile-tabbar-reserve));
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
  bottom: calc(var(--layout-mobile-tabbar-reserve) + 96px);
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  color: var(--cpu-primary);
  background: var(--cpu-card);
  box-shadow: inset 0 0 0 1px var(--cpu-border);

  .el-icon {
    font-size: 24px;
  }
}

@media (hover: hover) {
  .tools-fab:hover {
    background: var(--cpu-surface-soft);
  }
}

.tools-fab:active {
  background: var(--cpu-surface-soft);
}

.assistant-fab {
  position: fixed;
  z-index: 1091;
  right: 26px;
  bottom: calc(var(--layout-mobile-tabbar-reserve) + 26px);
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--cpu-on-primary);
  background: var(--cpu-primary);
  cursor: pointer;
  font: inherit;
}

.assistant-fab .el-icon {
  font-size: 27px;
}

@media (hover: hover) {
  .assistant-fab:hover {
    background: var(--cpu-primary-dark);
  }
}

.assistant-fab:active {
  background: var(--cpu-primary-dark);
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

@media (hover: hover) {
  .direct-message-shortcut:hover {
    color: #fff;
    background: var(--cpu-primary);
  }
}

.direct-message-shortcut:active {
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
  .page-route-enter-active, .page-route-leave-active { transition: none; }
  .message-entry.has-direct :deep(.el-badge__content) { animation: none; }
}

.forum-post-fab {
  position: fixed;
  z-index: 1092;
  right: 26px;
  bottom: calc(var(--layout-mobile-tabbar-reserve) + 166px);
  display: grid;
  width: 58px;
  height: 58px;
  min-height: 58px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--cpu-primary);
  color: var(--cpu-on-primary);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.forum-post-fab .el-icon { font-size: 23px; }
.forum-post-fab span { display: none; }
@media (hover: hover) {
  .forum-post-fab:hover { background: var(--cpu-primary-dark); }
}
.forum-post-fab:active { background: var(--cpu-primary-dark); }
.forum-post-fab:focus-visible { outline: 3px solid color-mix(in srgb, var(--cpu-primary) 28%, transparent); outline-offset: 3px; }

html[data-theme="dark"] .assistant-widget {
  box-shadow: 0 30px 78px rgba(0, 0, 0, 0.5);
}

/* A software keyboard covers the lower half of a tablet in landscape; keep the composer in view. */
.assistant-widget.is-keyboard-pinned {
  bottom: auto;
  top: calc(var(--cpu-overlay-viewport-top, 0px) + 12px);
  height: calc(var(--cpu-overlay-viewport-height, 100dvh) - 24px);
}

/* Without the PC tools button the 投稿 button takes its slot directly above 拾间AI. */
@media (min-width: 961px) {
  @include expanded-only {
    .layout-root--no-tools-fab .forum-post-fab {
      bottom: calc(var(--layout-mobile-tabbar-reserve) + 96px);
    }
  }
}

.layout-root.keyboard-open .forum-post-fab { display: none; }

/* Desktop header on a touch tablet in landscape: finger-sized targets. */
@include expanded-touch {
  .top-nav a,
  .top-nav-more-btn {
    height: 44px;
  }

  .appearance-cycle-btn {
    width: 44px;
    height: 44px;
  }

  .user-info {
    min-height: 44px;
    box-sizing: border-box;
  }
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
  margin-left: 8px;
  cursor: pointer;
  padding: 4px 8px 4px 4px;
  border-radius: 8px;
}

@media (hover: hover) {
  .user-info:hover { background: var(--cpu-bg); }
}
.user-info:active { background: var(--cpu-bg); }

.user-avatar {
  background: var(--cpu-primary);
  color: #fff;
  font-weight: 600;
}

.user-name {
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  color: var(--cpu-text);
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

/* The assistant owns its own composer and conversation viewport. Keep the
   page tied to the visual viewport while the keyboard is open so WebKit does
   not pan the entire document and leave the header above the visible area. */
.layout-root--assistant.keyboard-geometry-open {
  position: fixed;
  inset: var(--layout-viewport-offset-top, 0px) 0 auto;
  width: 100%;
  height: var(--layout-viewport-height, 100dvh);
  overflow: hidden;
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

/* Keep the existing horizontal layout. Scrollable bottom clearance lets the
   last item move above SwiftUI's floating tab bar without an opaque safe area. */
.layout-root--ios-next .main {
  /* The native top bar is outside the WebView, so the Web page still needs
     its normal breathing room below that bar. The safe-area inset itself is
     already consumed by SwiftUI and is kept at zero on this shell. */
  padding-bottom: var(--cpu-ios-bottom-clearance, 96px) !important;
}
.layout-root--ios-next:has(.main--bare) .main--bare {
  padding-bottom: max(12px, env(safe-area-inset-bottom)) !important;
}
.layout-root--ios-next .main:not(.main--bare):not(.main--full-width):not(.main--mobile-topic) {
  padding-top: 14px !important;
}
.layout-root--ios-next .main--bare,
.layout-root--ios-next .main--full-width,
.layout-root--ios-next .main--mobile-topic {
  padding-top: 0 !important;
}
.layout-root--ios-next {
  /* SwiftUI positions the WebView below the native chrome. Letting mobile
     pages reserve the iOS status inset a second time leaves a clipped strip
     above the first card. Login/register pages stay outside this layout and
     continue to use the browser safe area. */
  --cpu-safe-area-inset-top: 0px;
}

.layout-root--ios-next:not(.layout-root--full-height) {
  min-height: 100%;
  height: auto;
}

/* 页脚本身在 SiteFooter.vue；布局只通过 --footer-clearance 告诉它底部要为标签栏或原生壳留多少空间。 */
.layout-root--ios-next .footer {
  /* The native tab bar floats over the WebView edge, so the footer itself
     needs enough scrollable tail to remain reachable. */
  --footer-clearance: var(--cpu-ios-bottom-clearance, 96px);
}
/* The standalone notice is already covered by the native app's legal pages.
   Keeping it out of the compact iOS shell prevents a wrapped line from
   pushing the first mobile card below the fold. */
:global(html[data-cpu-ios-next] .independent-service-note) {
  display: none !important;
}

:global(html[data-cpu-ios-next] .mobile-drawer),
:global(html[data-cpu-ios-next] .el-drawer.direction-btt) {
  bottom: var(--cpu-ios-bottom-clearance, 96px) !important;
  max-height: calc(92dvh - var(--cpu-ios-bottom-clearance, 96px)) !important;
}
:global(html[data-cpu-ios-next] .mobile-drawer .el-drawer__body),
:global(html[data-cpu-ios-next] .el-drawer.direction-btt .el-drawer__body) {
  padding-bottom: 16px !important;
  overflow-y: auto !important;
  overscroll-behavior: contain;
}
:global(html[data-cpu-ios-next] .course-editor-overlay) {
  padding-bottom: calc(8px + var(--cpu-ios-bottom-clearance, 96px)) !important;
}
:global(html[data-cpu-ios-next] .course-editor-panel) {
  max-height: calc(92dvh - var(--cpu-ios-bottom-clearance, 96px)) !important;
}
:global(html[data-cpu-ios-next] .course-editor-scroll) {
  padding-bottom: calc(12px + env(safe-area-inset-bottom) + var(--cpu-ios-bottom-clearance, 96px)) !important;
}

.mobile-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1100;
  display: none;
  height: var(--liquid-tabbar-reserve);
  pointer-events: auto;
  transition: opacity 160ms, transform 200ms, visibility 200ms;
}
.mobile-tabbar.is-hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(100%);
}
.layout-root--android-insets {
  /* The Android host has already removed system navigation insets from the WebView. */
  --liquid-tabbar-reserve: 56px;
}
.layout-root--tabbar-fallback {
  --layout-mobile-tabbar-reserve: var(--liquid-tabbar-reserve);
}

.layout-root--tabbar-fallback.keyboard-open .main {
  padding-bottom: 12px;
}

.layout-root--tabbar-fallback.keyboard-open .main--bare,
.layout-root--tabbar-fallback.keyboard-open .main--full-width {
  padding-bottom: 0 !important;
}

.layout-root--tabbar-fallback .main {
  padding-bottom: calc(var(--liquid-tabbar-reserve) + 20px);
}

.layout-root--tabbar-fallback .main--bare {
  padding-bottom: calc(var(--liquid-tabbar-reserve) + 20px) !important;
}

.layout-root--tabbar-fallback .main--full-width {
  padding: 0;
}

.layout-root--tabbar-fallback .footer {
  --footer-clearance: var(--liquid-tabbar-reserve);
}

.layout-root--tabbar-fallback .mobile-tabbar { display: block; }

/* The drawer opens wherever the header is collapsed (up to 960 px and compact tablets), so its
   sheet styling cannot depend on the phone media query. */
:deep(.mobile-drawer) {
  border-radius: 18px 18px 0 0;
  height: auto !important;
  max-height: min(92dvh, 640px);
  padding-bottom: env(safe-area-inset-bottom);
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

/* 快捷入口用和服务页一致的图标宫格。 */
.drawer-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: start;
  gap: 4px 0;
}

/* On tablets a full-width sheet stretches the four icons far apart; keep it phone-sized and centred. */
@media (min-width: 700px) {
  :deep(.mobile-drawer) {
    max-width: 640px;
    margin-inline: auto;
  }

  .drawer-grid {
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  }
}

.drawer-link {
  display: flex;
  min-width: 0;
  min-height: 80px;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 8px 2px 6px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--cpu-text);
  font: inherit;
  line-height: 1;
  -webkit-tap-highlight-color: transparent;
  transition: transform .12s ease;
}

.drawer-link:active { transform: scale(.96); }

.drawer-link .el-icon {
  display: inline-flex;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  align-items: center;
  justify-content: center;
  border-radius: 13px;
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: 21px;
}

.drawer-link span {
  max-width: 100%;
  overflow: hidden;
  font-size: 12px;
  font-weight: 550;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  padding: 2px;
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-track);
}

.appearance-segmented button {
  display: inline-flex;
  min-width: 0;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: var(--cpu-fs-s);
  font-weight: 500;
}

.appearance-segmented button.active {
  color: var(--cpu-text);
  background: var(--cpu-card);
}

.appearance-segmented button:not(.active):hover {
  color: var(--cpu-text);
}

.page-route-enter-active, .page-route-leave-active {
  transition: opacity 0.22s ease-out;
  will-change: opacity;
}
.page-route-enter-from { opacity: .55; }
.page-route-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .page-route-enter-active, .page-route-leave-active { transition: none; }
}

.dlg-tip { font-size: 15px; color: var(--cpu-text); margin: 0 0 6px; }
.dlg-tip b { color: var(--cpu-primary); }
.dlg-hint { font-size: 13px; color: var(--cpu-text-secondary); margin: 0 0 14px; }
.dlg-hint b { color: #b45309; }
.dlg-review-problem { margin: 0 0 12px; color: var(--el-color-danger); font-size: 13px; line-height: 1.55; }

@media (max-width: 1120px) {
  .topbar-inner {
    gap: 10px;
  }

  .top-nav a {
    padding: 8px 8px;
  }

  .brand-sub,
  .user-name {
    display: none;
  }
}

@media (max-width: 1040px) {
}

@include compact-header {
  .top-nav { display: none; }
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
    display: inline-flex;
    right: 14px;
    bottom: calc(var(--layout-mobile-tabbar-reserve) + 12px);
    width: auto;
    height: 52px;
    min-height: 52px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 16px;
  }

  .forum-post-fab span { display: inline; }
}

@include compact-layout {
  .layout-root:not(.layout-root--native-shell):not(.layout-root--ios-next) {
    --layout-mobile-tabbar-reserve: var(--liquid-tabbar-reserve);
  }

  .layout-root.keyboard-open .main {
    padding-bottom: 12px;
  }

  .forum-post-fab {
    right: 14px;
    bottom: calc(var(--layout-mobile-tabbar-reserve) + 12px);
    width: auto;
    height: 48px;
    min-height: 48px;
    padding: 0 18px 0 16px;
    border-radius: var(--cpu-radius-pill);
  }

  .forum-post-fab .el-icon { font-size: 18px; }
  .forum-post-fab span { display: inline; font-size: var(--cpu-fs-m); }

  .layout-root.keyboard-open .main--bare {
    padding-bottom: 0 !important;
  }

  .layout-root.keyboard-open .main--full-width {
    padding: 0;
  }

  .topbar-inner {
    height: 52px;
    padding: 0 4px 0 16px;
    gap: 8px;
    flex-wrap: nowrap;
  }

  .brand {
    flex: 1 1 auto;
  }

  .brand-logo {
    width: 28px;
    height: 28px;
  }

  .brand-sub {
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
    padding: 14px 12px calc(var(--liquid-tabbar-reserve) + 20px);
    max-width: none;
  }

  .main.main--mobile-topic {
    width: 100%;
    margin: 0;
    // Topic.vue reserves the measured height of its own floating composer.
    padding: 0;
  }

  .layout-root--full-height .main--full-height {
    padding-bottom: var(--liquid-tabbar-reserve);
  }

  .layout-root--full-height.keyboard-open .main--full-height {
    padding-bottom: var(--liquid-tabbar-reserve);
  }

  .main--full-width {
    padding: 0;
    max-width: none;
  }

  // 移动端裸壳模式：去掉 top/side padding，仅保留 tabbar 底部空间，让子组件自己管
  .main--bare {
    padding: 0 0 calc(var(--liquid-tabbar-reserve) + 20px) !important;
  }

  .footer {
    --footer-clearance: var(--liquid-tabbar-reserve);
  }

  .layout-root--native-shell .main {
    padding: 0;
  }

  .layout-root--native-shell .main--bare,
  .layout-root--native-shell .main--full-width {
    padding-bottom: 0 !important;
  }

  .layout-root--native-shell .footer {
    --footer-clearance: 0px;
  }

  .mobile-tabbar { display: block; }

  .dlg-tip {
    font-size: 14px;
  }
}

@media (max-width: 360px) {
  .topbar-inner {
    padding-inline: 10px;
  }

  .mobile-actions {
    --mobile-header-control-size: 40px;
  }

  .drawer-link .el-icon {
    width: 40px;
    height: 40px;
    flex-basis: 40px;
    font-size: 19px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mobile-tabbar.mobile-tabbar { transition: none; }
}
</style>
