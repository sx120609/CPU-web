<template>
  <IndexMobile v-if="isMobileLayout" />
  <IndexDesktop v-else />
</template>

<script setup lang="ts">
import IndexDesktop from "@/views/profile/IndexDesktop.vue";
import IndexMobile from "@/views/profile/IndexMobile.vue";
import { useMobileLayout } from "@/utils/mobileLayout";

const isMobileLayout = useMobileLayout();
</script>
