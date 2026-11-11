<template>
  <Chapter v-if="route.params.chapter" />
  <Index v-else />
</template>

<script setup lang="ts">
// 目录和章节合在一个按需加载的页面里：路由表在首屏入口，少登记一个分包就少占一点首屏体积。
import { useRoute } from "vue-router";
import Chapter from "./Chapter.vue";
import Index from "./Index.vue";

const route = useRoute();
</script>
