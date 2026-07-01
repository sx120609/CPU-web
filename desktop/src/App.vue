<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const ready = ref(false);

onMounted(async () => {
  // 启动时尝试恢复会话：有 token 直接进主页，否则进登录页
  const token = await window.courseBot.loadToken();
  router.replace(token ? "/home" : "/login");
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
