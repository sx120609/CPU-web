<template>
  <ToolsMobile v-if="isMobileLayout" />
  <ToolsDesktop v-else />
</template>

<script setup lang="ts">
import ToolsDesktop from "@/views/services/ToolsDesktop.vue";
import ToolsMobile from "@/views/services/ToolsMobile.vue";
import { useMobileLayout } from "@/utils/mobileLayout";

const isMobileLayout = useMobileLayout();
</script>
