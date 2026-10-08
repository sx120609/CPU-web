<template>
  <IndexMobile v-if="isMobileLayout" />
  <IndexDesktop v-else />
</template>

<script setup lang="ts">
import { provide } from "vue";
import IndexDesktop from "@/views/services/IndexDesktop.vue";
import IndexMobile from "@/views/services/IndexMobile.vue";
import { useMobileLayout } from "@/utils/mobileLayout";
import { servicesPageKey, useServicesPage } from "./servicesPage";

const isMobileLayout = useMobileLayout();
// 页面状态放在这一层，iPad 旋转或分屏跨过布局切换点时，搜索词和打开的对话框不会丢失。
provide(servicesPageKey, useServicesPage());
</script>
