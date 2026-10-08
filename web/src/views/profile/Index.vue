<template>
  <IndexMobile v-if="isMobileLayout" />
  <IndexDesktop v-else />
</template>

<script setup lang="ts">
import { provide } from "vue";
import IndexDesktop from "@/views/profile/IndexDesktop.vue";
import IndexMobile from "@/views/profile/IndexMobile.vue";
import { useMobileLayout } from "@/utils/mobileLayout";
import { profilePageKey, useProfilePage } from "./profilePage";

const isMobileLayout = useMobileLayout();
// 页面状态放在这一层，iPad 旋转或分屏跨过布局切换点时，打开的对话框和输入内容不会丢失。
provide(profilePageKey, useProfilePage());
</script>
