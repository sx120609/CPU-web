<template>
  <IndexMobile v-if="isMobileLayout" />
  <IndexDesktop v-else />
</template>

<script setup lang="ts">
import { computed, provide } from "vue";
import IndexDesktop from "@/views/jwxt/IndexDesktop.vue";
import IndexMobile from "@/views/jwxt/IndexMobile.vue";
import { useMobileLayout } from "@/utils/mobileLayout";
import { jwxtPageKey, useJwxtPage } from "./jwxtPage";

const isMobileLayout = useMobileLayout();
// 页面状态放在这一层，iPad 旋转或分屏跨过布局切换点时，已输入的登录信息和已加载的数据不会丢失。
provide(jwxtPageKey, useJwxtPage(computed(() => (isMobileLayout.value ? "mobile" : "desktop"))));
</script>
