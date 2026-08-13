<template>
  <el-avatar :size="size" class="user-avatar" :class="frameClass" :style="avatarStyle">
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
  profileFrame?: string | null;
}>();

const broken = ref(false);
const fallbackText = computed(() => props.name?.trim()?.[0] ?? "U");
const resolvedSrc = computed(() => (broken.value ? "" : (props.src ?? "").trim()));
const avatarStyle = computed(() => ({
  background: resolvedSrc.value ? "transparent" : "linear-gradient(135deg, #168776, #0f6557)",
  color: "#fff",
}));
const frameClass = computed(() => props.profileFrame ? `user-avatar--${props.profileFrame}` : "");

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

.user-avatar--gold { box-shadow: 0 0 0 2px #f5c451, 0 0 0 4px rgba(245, 196, 81, 0.22); }
.user-avatar--neon { box-shadow: 0 0 0 2px #8b5cf6, 0 0 12px rgba(139, 92, 246, 0.55); }
.user-avatar--campus { box-shadow: 0 0 0 2px #168776, 0 0 0 4px rgba(22, 135, 118, 0.18); }
</style>
