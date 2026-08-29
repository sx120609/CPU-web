<template>
  <MarketMobile v-if="isMobileLayout" />
  <MarketDesktop v-else />
</template>

<script setup lang="ts">
import MarketDesktop from "@/views/forum/MarketDesktop.vue";
import MarketMobile from "@/views/forum/MarketMobile.vue";
import { useMobileLayout } from "@/utils/mobileLayout";

const isMobileLayout = useMobileLayout();
</script>
