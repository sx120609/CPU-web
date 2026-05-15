<template>
  <div class="layout-root">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="topbar-inner">
        <router-link to="/home" class="brand">
          <span class="brand-logo">药</span>
          <span class="brand-text">
            <span class="brand-name">药大垎坊</span>
            <span class="brand-sub">CPU 校园互助服务</span>
          </span>
        </router-link>

        <div class="top-search">
          <el-input
            v-model="q"
            placeholder="搜索帖子 / 课程 / 服务"
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
            <el-button type="primary" size="default" @click="$router.push('/post')">
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
                <el-avatar :size="30" class="user-avatar">{{ auth.user?.nickname?.[0] ?? "U" }}</el-avatar>
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
          <el-button v-if="auth.isLoggedIn" text class="touch-icon-btn" aria-label="发帖" @click="$router.push('/post')">
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

    <!-- disclaimer -->
    <div class="disclaimer">
      <el-icon><WarningFilled /></el-icon>
      <span>
        药大垎坊为学生自发聚合站，<b>与中国药科大学官方无关</b>。
        学号 / 工号会用于创建或关联站内账号，<b>本站不保存学校密码和验证码</b>。
        用户内容仅代表发布者个人观点。
      </span>
    </div>

    <!-- 主内容 -->
    <main class="main">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <footer class="footer">
      <span>© 2026 药大垎坊 · 校园互助与服务平台</span>
      <span class="dot">·</span>
      <a href="https://github.com" target="_blank">GitHub</a>
      <span class="dot">·</span>
      <span>非学校官方站点</span>
    </footer>

    <nav class="mobile-tabbar" aria-label="移动端主导航">
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
          :key="item.to"
          type="button"
          class="drawer-link"
          @click="goDrawer(item.to)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </button>
      </div>
      <div class="drawer-account">
        <template v-if="auth.isLoggedIn">
          <el-avatar :size="34" class="user-avatar">{{ auth.user?.nickname?.[0] ?? "U" }}</el-avatar>
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
        欢迎来到药大垎坊，<b>{{ auth.user?.username }}</b> 同学
      </p>
      <p class="dlg-hint">
        后续发帖、回复和课程点评都会显示昵称，<b>不会展示你的学号</b>。
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
        <el-button type="primary" size="large" :loading="savingNickname" @click="saveNickname">
          完成设置
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  Search,
  Edit,
  Bell,
  ArrowDown,
  WarningFilled,
  Menu,
  House,
  ChatLineRound,
  Calendar,
  Reading,
  UserFilled,
  Goods,
  Service,
  Message,
} from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { useMessageStore } from "@/stores/message";

const auth = useAuthStore();
const msg = useMessageStore();
const router = useRouter();
const route = useRoute();
const q = ref("");
const mobileMenuOpen = ref(false);

const desktopNavItems = [
  { to: "/home", label: "首页" },
  { to: "/forum", label: "论坛" },
  { to: "/jwxt", label: "教务数据" },
  { to: "/coursereview", label: "课评" },
  { to: "/market", label: "二手" },
  { to: "/services", label: "校园服务" },
];

const mobileNavItems = [
  { to: "/home", label: "首页", icon: House, match: ["/home"] },
  { to: "/forum", label: "论坛", icon: ChatLineRound, match: ["/forum"] },
  { to: "/jwxt", label: "教务", icon: Calendar, match: ["/jwxt"] },
  { to: "/services", label: "服务", icon: Service, match: ["/services"] },
  { to: "/profile", label: "我的", icon: UserFilled, match: ["/profile", "/messages", "/u/"], auth: true },
];

const drawerItems = [
  { to: "/post", label: "发帖", icon: Edit },
  { to: "/messages", label: "消息", icon: Message },
  { to: "/coursereview", label: "课评", icon: Reading },
  { to: "/market", label: "二手市场", icon: Goods },
  { to: "/services", label: "校园服务", icon: Service },
  { to: "/search", label: "搜索", icon: Search },
];

// 首次登录设昵称
const showNicknameDialog = ref(false);
const newNickname = ref("");
const savingNickname = ref(false);

const shouldAskNickname = computed(() => auth.isLoggedIn && auth.needSetupNickname);
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
});

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
  display: flex;
  flex-direction: column;
  background: var(--cpu-bg);
}

.topbar {
  background: #fff;
  border-bottom: 1px solid #eef0f4;
  position: sticky;
  top: 0;
  z-index: 100;
  padding-top: env(safe-area-inset-top);
}

.topbar-inner {
  max-width: 1280px;
  margin: 0 auto;
  height: 60px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
  flex-shrink: 0;
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
}

.brand-name {
  font-size: 17px;
  font-weight: 700;
  color: var(--cpu-primary);
}

.brand-sub {
  font-size: 11px;
  color: #9ca3af;
  letter-spacing: 1px;
}

.top-search {
  width: 320px;
  max-width: 30%;
}

.top-nav {
  display: flex;
  gap: 4px;
  flex: 1;
}

.top-nav a {
  padding: 8px 12px;
  border-radius: 6px;
  color: #4b5563;
  text-decoration: none;
  font-size: 14px;
  transition: background 0.15s, color 0.15s;
}

.top-nav a:hover { background: #f3f4f6; color: var(--cpu-primary); }
.top-nav a.router-link-active { color: var(--cpu-primary); font-weight: 600; }

.top-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mobile-actions {
  display: none;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.touch-icon-btn {
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: 10px;
  color: #374151;
}

.touch-icon-btn .el-icon {
  font-size: 20px;
}

.mobile-login-btn {
  min-width: 52px;
  height: 40px;
  padding: 0 10px;
  color: var(--cpu-primary);
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
}

.disclaimer {
  background: #fef3c7;
  color: #92400e;
  font-size: 12px;
  padding: 8px 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid #fde68a;
}

.disclaimer b { color: #b45309; }

.main {
  flex: 1;
  padding: 24px 20px 40px;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  box-sizing: border-box;
}

.footer {
  background: #fff;
  border-top: 1px solid #eef0f4;
  padding: 16px 20px;
  text-align: center;
  font-size: 12px;
  color: #9ca3af;
}

.footer a { color: var(--cpu-primary); text-decoration: none; }
.footer .dot { margin: 0 8px; }

.mobile-tabbar {
  display: none;
}

.drawer-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.drawer-link {
  border: 1px solid #eef0f4;
  background: #fff;
  border-radius: 10px;
  min-height: 72px;
  color: #374151;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font: inherit;
}

.drawer-link .el-icon {
  font-size: 22px;
  color: var(--cpu-primary);
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

@media (max-width: 900px) {
  .top-nav { display: none; }
  .top-search { width: 200px; }
}

@media (max-width: 768px) {
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
    max-width: none;
  }

  .top-search :deep(.el-input__wrapper) {
    border-radius: 12px;
  }

  .top-right {
    display: none;
  }

  .mobile-actions {
    display: flex;
  }

  .disclaimer {
    justify-content: flex-start;
    align-items: flex-start;
    padding: 8px 12px;
    font-size: 11px;
    line-height: 1.5;
  }

  .disclaimer .el-icon {
    margin-top: 2px;
    flex-shrink: 0;
  }

  .main {
    padding: 14px 12px calc(88px + env(safe-area-inset-bottom));
    max-width: none;
  }

  .footer {
    display: none;
  }

  .mobile-tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1100;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
    border-top: 1px solid #e5e7eb;
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 -8px 24px rgba(15, 23, 42, 0.08);
    pointer-events: auto;
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
  }

  .mobile-tab .el-icon {
    font-size: 20px;
  }

  .mobile-tab.active {
    color: var(--cpu-primary);
    background: #ecfdf5;
  }

  :deep(.mobile-drawer) {
    border-radius: 18px 18px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }

  :deep(.mobile-drawer .el-drawer__header) {
    margin-bottom: 8px;
  }

  .dlg-tip {
    font-size: 14px;
  }
}

@media (max-width: 420px) {
  .drawer-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .touch-icon-btn {
    width: 38px;
  }
}
</style>
