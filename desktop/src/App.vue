<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const ready = ref(false);

onMounted(async () => {
  const token = await window.courseBot.loadToken();
  if (token) {
    // 已登录平台，检查学习通
    try {
      const cx = await window.courseBot.chaoxingStatus();
      router.replace(cx.loggedIn ? "/courses" : "/chaoxing-login");
    } catch {
      router.replace("/chaoxing-login");
    }
  } else {
    router.replace("/welcome");
  }
  ready.value = true;
});
</script>

<template>
  <div v-if="ready" class="app-root">
    <router-view />
  </div>
  <div v-else class="loading-screen">加载中…</div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { height: 100%; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
.app-root { height: 100%; }
.loading-screen {
  height: 100%; display: flex; align-items: center; justify-content: center;
  color: #909399; font-size: 14px;
}
</style>
