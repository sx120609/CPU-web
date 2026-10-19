<template>
  <main class="nx-page">
    <section class="nx-card" aria-labelledby="nx-title">
      <header class="nx-head">
        <img class="nx-logo" :src="nextLogo" alt="" width="64" height="64" />
        <div>
          <h1 id="nx-title" class="nx-title">药大拾间 NEXT</h1>
          <p class="nx-sub">
            邀请你抢先体验
            <span v-if="release" class="nx-version">测试版 {{ release.versionName }}</span>
          </p>
        </div>
      </header>

      <p v-if="state === 'loading'" class="nx-muted" role="status">正在读取邀请…</p>

      <template v-else-if="state === 'invalid'">
        <p class="nx-lead">这个邀请链接无效或已经失效。</p>
        <p class="nx-muted">请向邀请你的同学要一个新的链接。正式版药大拾间可以在下载页获取。</p>
        <RouterLink class="nx-secondary" to="/download">前往下载页</RouterLink>
      </template>

      <template v-else-if="release">
        <p class="nx-lead">可以按你的方式重新组装的药大拾间。它和正式版是两个应用，可以同时安装，互不影响。</p>
        <ul class="nx-features">
          <li><strong>导航栏随你组装</strong>任意页面都能做成标签，改名、换图标、选启动页</li>
          <li><strong>属于你的工作台</strong>下一节课倒计时、今日课程、未读、公告和热榜</li>
          <li><strong>主题引擎</strong>任意主题色、纯黑深色，连网页一起换装</li>
          <li><strong>增量更新</strong>以后只下载变化的部分，离开拾间后自动装好</li>
        </ul>
        <div v-if="release.notes.length" class="nx-notes">
          <p class="nx-notes-title">这一版</p>
          <ul>
            <li v-for="note in release.notes" :key="note">{{ note }}</li>
          </ul>
        </div>

        <p v-if="insideNext" class="nx-done">你已经在使用药大拾间 NEXT 了。</p>
        <template v-else-if="installable">
          <a class="nx-primary" :href="release.downloadUrl" rel="nofollow">下载安装包 · {{ sizeLabel }}</a>
          <ol class="nx-steps">
            <li>下载后点开安装包；系统询问时，允许浏览器“安装未知应用”。</li>
            <li>打开桌面上的“拾间 NEXT”，用学校账号登录（和正式版分开登录）。</li>
            <li>以后的更新在 App 里完成，不用再回到这个页面。</li>
          </ol>
        </template>
        <template v-else>
          <p class="nx-lead">药大拾间 NEXT 目前只有安卓版，请用安卓手机打开这个链接。</p>
          <button class="nx-secondary" type="button" @click="copyLink">{{ copied ? '已复制链接' : '复制邀请链接' }}</button>
        </template>

        <p class="nx-muted">测试版可能还有没发现的问题，欢迎在论坛或反馈群告诉我们；不想用了直接卸载，正式版不受影响。请不要公开转发这个邀请链接。</p>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { canInstallAndroidApk, isAndroidNextApp } from "@/utils/clientInfo";
import nextLogo from "@/assets/next/next-logo.png";

/**
 * The invitation page of 药大拾间 NEXT while it is invite-only: the code in the
 * link unlocks its release and the APK download from the enterprise drive.
 */
type NextRelease = { versionName: string; size: number; notes: string[]; downloadUrl: string };

const route = useRoute();
const state = ref<"loading" | "ready" | "invalid">("loading");
const release = ref<NextRelease | null>(null);
const copied = ref(false);
const insideNext = isAndroidNextApp();
const installable = canInstallAndroidApk();
const sizeLabel = computed(() => release.value ? `${(release.value.size / 1048576).toFixed(1)} MB` : "");

onMounted(async () => {
  const invite = typeof route.query.invite === "string" ? route.query.invite.trim() : "";
  if (!/^[A-Za-z0-9]{8,64}$/.test(invite)) {
    state.value = "invalid";
    return;
  }
  try {
    const response = await fetch(`/api/site/downloads/android-next?invite=${encodeURIComponent(invite)}`, { cache: "no-store" });
    const data = response.ok ? (await response.json())?.data : null;
    const downloadUrl = typeof data?.downloadUrl === "string" && data.downloadUrl.startsWith("/api/site/downloads/android-next-app")
      ? data.downloadUrl : "";
    if (!data || !downloadUrl || typeof data.versionName !== "string" || !Number.isSafeInteger(data.size)) throw new Error("invalid");
    release.value = {
      versionName: data.versionName,
      size: data.size,
      notes: Array.isArray(data.notes) ? data.notes.filter((note: unknown) => typeof note === "string" && note.trim()) : [],
      downloadUrl,
    };
    state.value = "ready";
  } catch {
    state.value = "invalid";
  }
});

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}
</script>

<style scoped>
.nx-page {
  display: flex;
  min-height: 100vh;
  justify-content: center;
  padding: 32px 16px;
  background: var(--cpu-bg);
  color: var(--cpu-text);
  font-size: var(--cpu-fs-m);
  line-height: 1.6;
}

.nx-card {
  width: 100%;
  max-width: 480px;
  height: fit-content;
  padding: 24px 20px;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
}

.nx-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.nx-logo {
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  border-radius: 14px;
}

.nx-title {
  margin: 0;
  font-size: var(--cpu-fs-xxl);
  font-weight: 700;
  line-height: 1.25;
}

.nx-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 4px 0 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}

.nx-version {
  padding: 0 8px;
  border-radius: var(--cpu-radius-pill);
  background: linear-gradient(90deg, #0f8f7f, #4b3aa8);
  color: #fff;
  font-size: var(--cpu-fs-xs);
  font-weight: 600;
  line-height: 1.7;
}

.nx-lead {
  margin: 18px 0 0;
  font-size: var(--cpu-fs-l);
  line-height: 1.55;
}

.nx-muted {
  margin: 16px 0 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}

.nx-features {
  display: grid;
  gap: 10px;
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
}

.nx-features li {
  padding: 10px 12px;
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}

.nx-features strong {
  display: block;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-m);
  font-weight: 600;
}

.nx-notes {
  margin-top: 16px;
}

.nx-notes-title {
  margin: 0;
  font-weight: 600;
}

.nx-notes ul,
.nx-steps {
  margin: 6px 0 0;
  padding-left: 20px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}

.nx-steps {
  margin-top: 12px;
}

.nx-primary,
.nx-secondary {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  margin-top: 20px;
  border: 0;
  border-radius: var(--cpu-radius-pill);
  font: inherit;
  font-size: var(--cpu-fs-l);
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.nx-primary {
  background: var(--cpu-primary);
  color: var(--cpu-on-primary, #fff);
}

.nx-secondary {
  width: 100%;
  background: var(--cpu-surface-soft);
  color: var(--cpu-primary);
}

.nx-done {
  margin: 20px 0 0;
  color: var(--cpu-primary);
  font-weight: 600;
}
</style>
