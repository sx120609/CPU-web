<template>
  <el-avatar :size="size" class="user-avatar" :class="frameClass" :style="avatarStyle" :aria-label="alt || `${name || '用户'}的头像`">
    <img v-if="resolvedSrc" :src="resolvedSrc" :alt="alt" loading="lazy" decoding="async" fetchpriority="low" @error="onImageError" />
    <svg v-else class="generated-avatar" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" :fill="generated.background" />
      <circle :cx="generated.bubbleX" :cy="generated.bubbleY" r="11" :fill="generated.accent" opacity=".28" />
      <circle :cx="62 - generated.bubbleX / 2" :cy="58 - generated.bubbleY / 3" r="8" fill="#fff" opacity=".18" />

      <g v-if="generated.accessory === 0" :transform="`rotate(${generated.tilt} 32 20)`">
        <path d="M17 23c4-10 12-15 23-12 5 1 9 5 11 10-11-2-23-1-34 2Z" :fill="generated.accent" />
        <path d="M17 23c10-3 22-3 34-2" fill="none" :stroke="generated.ink" stroke-width="3" stroke-linecap="round" opacity=".7" />
      </g>
      <g v-else-if="generated.accessory === 1" :transform="`rotate(${generated.tilt} 32 20)`">
        <path d="M32 19c-1-8 3-12 10-13-1 7-4 11-10 13Z" :fill="generated.accent" />
        <path d="M32 19c0-6-3-10-8-12-1 6 2 10 8 12Z" fill="#fff" opacity=".72" />
      </g>
      <g v-else-if="generated.accessory === 2">
        <path d="M22 23c1-10 19-10 20 0" fill="none" :stroke="generated.ink" stroke-width="4" stroke-linecap="round" />
        <rect x="17" y="23" width="7" height="15" rx="3.5" :fill="generated.accent" />
        <rect x="40" y="23" width="7" height="15" rx="3.5" :fill="generated.accent" />
      </g>
      <g v-else-if="generated.accessory === 3" :transform="`rotate(${generated.tilt} 32 18)`">
        <path d="M32 17V9" :stroke="generated.ink" stroke-width="3" stroke-linecap="round" />
        <circle cx="32" cy="7" r="4" :fill="generated.accent" />
      </g>
      <path v-else d="m49 11 2 4 5 .7-3.5 3.4.8 4.9-4.3-2.3-4.3 2.3.8-4.9-3.5-3.4 5-.7 2-4Z" fill="#fff" opacity=".86" />

      <g :transform="`rotate(${generated.tilt} 32 35)`">
        <path d="M15 35c0-14 7-23 18-23 12 0 18 10 17 24-1 12-7 19-18 19-10 0-17-8-17-20Z" :fill="generated.body" />
        <ellipse cx="22" cy="39" rx="4" ry="2.6" :fill="generated.blush" opacity=".72" />
        <ellipse cx="43" cy="39" rx="4" ry="2.6" :fill="generated.blush" opacity=".72" />

        <template v-if="generated.face === 0">
          <circle :cx="25 + generated.eyeOffset" cy="31" r="2.5" :fill="generated.ink" />
          <circle :cx="39 + generated.eyeOffset" cy="31" r="2.5" :fill="generated.ink" />
          <path d="M27 39c3 4 7 4 10 0" fill="none" :stroke="generated.ink" stroke-width="2.5" stroke-linecap="round" />
        </template>
        <template v-else-if="generated.face === 1">
          <path :d="`M${22 + generated.eyeOffset} 31c2-2 4-2 6 0`" fill="none" :stroke="generated.ink" stroke-width="2.5" stroke-linecap="round" />
          <circle :cx="39 + generated.eyeOffset" cy="31" r="2.5" :fill="generated.ink" />
          <ellipse cx="33" cy="40" rx="3" ry="2.4" :fill="generated.ink" />
        </template>
        <template v-else>
          <circle :cx="25 + generated.eyeOffset" cy="31" r="2" :fill="generated.ink" />
          <circle :cx="39 + generated.eyeOffset" cy="31" r="2" :fill="generated.ink" />
          <path d="M28 40h9" :stroke="generated.ink" stroke-width="2.5" stroke-linecap="round" />
        </template>
      </g>
    </svg>
  </el-avatar>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{
  size: number;
  src?: string | null;
  name?: string | null;
  seed?: string | number | null;
  alt?: string;
  profileFrame?: string | null;
}>();

const broken = ref(false);
const resolvedSrc = computed(() => (broken.value ? "" : (props.src ?? "").trim()));
const palettes = [
  { background: "#dff7ef", body: "#36b99b", accent: "#ffbd66", ink: "#173d36", blush: "#ff8f8f" },
  { background: "#e8e4ff", body: "#8c7cf0", accent: "#67d7c3", ink: "#2f285c", blush: "#ff9fb2" },
  { background: "#fff0d8", body: "#f19b52", accent: "#5cc8c1", ink: "#53311f", blush: "#f77f8e" },
  { background: "#dff1ff", body: "#62a9e9", accent: "#ffd166", ink: "#193b5a", blush: "#ff91a8" },
  { background: "#ffe4ec", body: "#ec7f9c", accent: "#76c7a7", ink: "#552637", blush: "#ffbd8b" },
  { background: "#e8f4d7", body: "#82b94b", accent: "#f4a261", ink: "#29451c", blush: "#ff8d86" },
  { background: "#f0e2d2", body: "#b98768", accent: "#8bd3dd", ink: "#493023", blush: "#f89b93" },
  { background: "#e2f1ed", body: "#218c7a", accent: "#f0c75e", ink: "#123d37", blush: "#ff9e9e" },
] as const;

function hashSeed(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const generated = computed(() => {
  const identity = String(props.seed ?? props.name ?? "campus-user").trim() || "campus-user";
  const hash = hashSeed(identity);
  const palette = palettes[hash % palettes.length];
  return {
    ...palette,
    accessory: (hash >>> 4) % 5,
    face: (hash >>> 9) % 3,
    tilt: ((hash >>> 14) % 17) - 8,
    eyeOffset: ((hash >>> 20) % 3) - 1,
    bubbleX: 8 + ((hash >>> 22) % 14),
    bubbleY: 8 + ((hash >>> 26) % 12),
  };
});
const avatarStyle = computed(() => ({
  background: resolvedSrc.value ? "transparent" : generated.value.background,
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

.generated-avatar {
  display: block;
  width: 100%;
  height: 100%;
}

.user-avatar--gold { box-shadow: 0 0 0 2px #f5c451, 0 0 0 4px rgba(245, 196, 81, 0.22); }
.user-avatar--neon { box-shadow: 0 0 0 2px #8b5cf6, 0 0 12px rgba(139, 92, 246, 0.55); }
.user-avatar--campus { box-shadow: 0 0 0 2px #168776, 0 0 0 4px rgba(22, 135, 118, 0.18); }
</style>
