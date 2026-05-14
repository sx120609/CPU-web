<template>
  <div class="layout-root">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="topbar-inner">
        <router-link to="/home" class="brand">
          <span class="brand-logo">药</span>
          <span class="brand-text">
            <span class="brand-name">药大垎坊</span>
            <span class="brand-sub">CPU 民间学生论坛</span>
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

        <nav class="top-nav">
          <router-link to="/home">首页</router-link>
          <router-link to="/forum">论坛</router-link>
          <router-link to="/jwxt">教务直连</router-link>
          <router-link to="/coursereview">课评</router-link>
          <router-link to="/market">二手</router-link>
          <router-link to="/services">服务导航</router-link>
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
                  <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <template v-else>
            <el-button text @click="$router.push('/login')">登录</el-button>
            <el-button type="primary" @click="$router.push('/register')">注册</el-button>
          </template>
        </div>
      </div>
    </header>

    <!-- disclaimer -->
    <div class="disclaimer">
      <el-icon><WarningFilled /></el-icon>
      <span>
        药大垎坊为学生自发聚合站，<b>与中国药科大学官方无关</b>。
        登录账号系本站独立账号，<b>请勿使用学校账号密码</b>。
        本站内容由用户发布，仅代表个人观点。
      </span>
    </div>

    <!-- 主内容 -->
    <main class="main">
      <router-view v-slot="{ Component }">
        <transition name="fade">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <footer class="footer">
      <span>© 2026 药大垎坊 · 民间学生论坛</span>
      <span class="dot">·</span>
      <a href="https://github.com" target="_blank">GitHub</a>
      <span class="dot">·</span>
      <span>本站不存储任何学校账号</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { Search, Edit, Bell, ArrowDown, WarningFilled } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { useMessageStore } from "@/stores/message";

const auth = useAuthStore();
const msg = useMessageStore();
const router = useRouter();
const q = ref("");

onMounted(async () => {
  if (auth.token && !auth.user) await auth.fetchMe();
  if (auth.isLoggedIn) msg.refresh();
});

function goSearch() {
  if (q.value.trim()) router.push({ name: "search", query: { q: q.value.trim() } });
}

async function onUserCmd(cmd: string) {
  if (cmd === "profile") router.push("/profile");
  else if (cmd === "settings") router.push("/messages?tab=settings");
  else if (cmd === "logout") {
    await auth.logout();
    router.push("/login");
  }
}
</script>

<style scoped lang="scss">
.layout-root {
  min-height: 100vh;
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

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 900px) {
  .top-nav { display: none; }
  .top-search { width: 200px; }
}
</style>
