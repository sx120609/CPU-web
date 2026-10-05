<template>
  <IndexMobile v-if="isMobileLayout" />
  <IndexDesktop v-else />
</template>

<script setup lang="ts">
import IndexDesktop from "@/views/jwxt/IndexDesktop.vue";
import IndexMobile from "@/views/jwxt/IndexMobile.vue";
import { useMobileLayout } from "@/utils/mobileLayout";

const isMobileLayout = useMobileLayout();
</script>
