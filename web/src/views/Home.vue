<template>
  <HomeMobile v-if="isMobileLayout" />
  <HomeDesktop v-else />
</template>

<script setup lang="ts">
import HomeDesktop from "@/views/HomeDesktop.vue";
import HomeMobile from "@/views/HomeMobile.vue";
import { useMobileLayout } from "@/utils/mobileLayout";

const isMobileLayout = useMobileLayout();
</script>
