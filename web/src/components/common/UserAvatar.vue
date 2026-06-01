<template>
  <el-avatar :size="size" class="user-avatar" :style="avatarStyle">
    <img v-if="resolvedSrc" :src="resolvedSrc" :alt="alt" loading="lazy" decoding="async" fetchpriority="low" @error="onImageError" />
    <span v-else>{{ fallbackText }}</span>
  </el-avatar>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{
  size: number;
  src?: string | null;
  name?: string | null;
  alt?: string;
}>();

const broken = ref(false);
const fallbackText = computed(() => props.name?.trim()?.[0] ?? "U");
const resolvedSrc = computed(() => (broken.value ? "" : (props.src ?? "").trim()));
const avatarStyle = computed(() => ({
  background: resolvedSrc.value ? "transparent" : "linear-gradient(135deg, #168776, #0f6557)",
  color: "#fff",
}));

watch(() => props.src, () => {
  broken.value = false;
}, { immediate: true });

function onImageError() {
  broken.value = true;
}
</script>

<style scoped>
.user-avatar {
  overflow: hidden;
}

.user-avatar :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
