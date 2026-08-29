<template>
  <el-avatar :size="size" class="user-avatar" :class="frameClass" :style="avatarStyle" :aria-label="alt || `${name || '用户'}的头像`">
    <img v-if="resolvedSrc" :src="resolvedSrc" :alt="alt" loading="lazy" decoding="async" fetchpriority="low" @error="onImageError" />
    <svg v-else class="generated-avatar" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" :fill="generated.background" />
      <g v-if="generated.backgroundPattern === 0">
        <circle :cx="generated.bubbleX" :cy="generated.bubbleY" r="11" :fill="generated.accent" opacity=".28" />
        <circle :cx="62 - generated.bubbleX / 2" :cy="58 - generated.bubbleY / 3" r="8" fill="#fff" opacity=".2" />
      </g>
      <g v-else-if="generated.backgroundPattern === 1" :stroke="generated.accent" stroke-width="4" opacity=".2">
        <path d="M-8 18 18-8M-6 42 42-6M10 66 66 10M36 70 70 36" />
      </g>
      <g v-else-if="generated.backgroundPattern === 2" :fill="generated.accent" opacity=".25">
        <circle cx="10" cy="11" r="3" /><circle cx="29" cy="7" r="2" /><circle cx="53" cy="16" r="4" />
        <circle cx="8" cy="49" r="4" /><circle cx="54" cy="51" r="2.5" />
      </g>
      <g v-else-if="generated.backgroundPattern === 3" fill="none" :stroke="generated.accent" stroke-width="3" opacity=".22">
        <path d="M-3 15c8-7 16 7 24 0s16 7 24 0 16 7 24 0M-3 51c8-7 16 7 24 0s16 7 24 0 16 7 24 0" />
      </g>
      <g v-else :fill="generated.accent" opacity=".2">
        <path d="M32 4 35 21 46 7 40 24 57 18 42 29 61 32 42 35 57 47 40 40 46 58 35 43 32 61 29 43 18 58 24 40 7 47 22 35 3 32 22 29 7 18 24 24 18 7 29 21Z" />
      </g>

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
      <path v-else-if="generated.accessory === 4" d="m49 11 2 4 5 .7-3.5 3.4.8 4.9-4.3-2.3-4.3 2.3.8-4.9-3.5-3.4 5-.7 2-4Z" fill="#fff" opacity=".9" />
      <g v-else-if="generated.accessory === 5" :transform="`rotate(${generated.tilt} 32 18)`">
        <path d="m19 21 3-12 10 8 10-8 3 12Z" :fill="generated.accent" :stroke="generated.ink" stroke-width="2" stroke-linejoin="round" />
        <circle cx="22" cy="8" r="2.5" fill="#fff" /><circle cx="42" cy="8" r="2.5" fill="#fff" />
      </g>
      <g v-else-if="generated.accessory === 6" :transform="`rotate(${generated.tilt} 32 17)`">
        <path d="M31 17c-7-8-14-6-13 1 1 6 8 6 13 2M33 17c7-8 14-6 13 1-1 6-8 6-13 2" :fill="generated.accent" :stroke="generated.ink" stroke-width="2" />
        <circle cx="32" cy="19" r="4" fill="#fff" />
      </g>
      <g v-else-if="generated.accessory === 8" :transform="`rotate(${generated.tilt} 32 17)`">
        <circle cx="42" cy="12" r="4" fill="#fff" /><circle cx="48" cy="17" r="4" :fill="generated.accent" />
        <circle cx="42" cy="22" r="4" fill="#fff" /><circle cx="36" cy="17" r="4" :fill="generated.accent" />
        <circle cx="42" cy="17" r="3" :fill="generated.ink" />
      </g>

      <g :transform="`rotate(${generated.tilt} 32 35)`">
        <path :d="generated.bodyPath" :fill="generated.body" />
        <g v-if="generated.bodyPattern === 0" :fill="generated.accent" opacity=".3">
          <circle cx="20" cy="24" r="3" /><circle cx="43" cy="45" r="4" />
        </g>
        <path v-else-if="generated.bodyPattern === 1" d="M17 42c9-4 20-4 31 0M19 48c8-3 17-3 26 0" fill="none" :stroke="generated.accent" stroke-width="3" opacity=".32" />
        <path v-else-if="generated.bodyPattern === 2" d="m33 44 2 4 5 .7-3.5 3.4.8 4.9-4.3-2.3-4.3 2.3.8-4.9-3.5-3.4 5-.7 2-4Z" :fill="generated.accent" opacity=".5" />
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
          <template v-if="generated.face === 2">
            <circle :cx="25 + generated.eyeOffset" cy="31" r="2" :fill="generated.ink" />
            <circle :cx="39 + generated.eyeOffset" cy="31" r="2" :fill="generated.ink" />
            <path d="M28 40h9" :stroke="generated.ink" stroke-width="2.5" stroke-linecap="round" />
          </template>
          <template v-else-if="generated.face === 3">
            <path d="M22 31h6M36 31h6" :stroke="generated.ink" stroke-width="2.5" stroke-linecap="round" />
            <path d="M28 40c3-2 6-2 9 0" fill="none" :stroke="generated.ink" stroke-width="2.3" stroke-linecap="round" />
          </template>
          <template v-else>
            <path d="M22 31c2 2 4 2 6 0M36 31c2 2 4 2 6 0" fill="none" :stroke="generated.ink" stroke-width="2.5" stroke-linecap="round" />
            <path d="M27 39c3 6 8 6 11 0" fill="#fff" :stroke="generated.ink" stroke-width="2" stroke-linejoin="round" />
          </template>
        </template>
        <g v-if="generated.accessory === 7" fill="none" :stroke="generated.ink" stroke-width="2.3">
          <circle cx="24" cy="31" r="5" /><circle cx="40" cy="31" r="5" /><path d="M29 31h6" />
        </g>
      </g>
    </svg>
  </el-avatar>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { cdnImageUrl } from "@/utils/cdnMedia";

const props = defineProps<{
  size: number;
  src?: string | null;
  name?: string | null;
  seed?: string | number | null;
  alt?: string;
  profileFrame?: string | null;
}>();

const broken = ref(false);
const resolvedSrc = computed(() => broken.value ? "" : cdnImageUrl(props.src, { width: Math.max(96, props.size * 3), quality: 84 }));
const palettes = [
  { background: "#dff7ef", body: "#36b99b", accent: "#ffbd66", ink: "#173d36", blush: "#ff8f8f" },
  { background: "#e8e4ff", body: "#8c7cf0", accent: "#67d7c3", ink: "#2f285c", blush: "#ff9fb2" },
  { background: "#fff0d8", body: "#f19b52", accent: "#5cc8c1", ink: "#53311f", blush: "#f77f8e" },
  { background: "#dff1ff", body: "#62a9e9", accent: "#ffd166", ink: "#193b5a", blush: "#ff91a8" },
  { background: "#ffe4ec", body: "#ec7f9c", accent: "#76c7a7", ink: "#552637", blush: "#ffbd8b" },
  { background: "#e8f4d7", body: "#82b94b", accent: "#f4a261", ink: "#29451c", blush: "#ff8d86" },
  { background: "#f0e2d2", body: "#b98768", accent: "#8bd3dd", ink: "#493023", blush: "#f89b93" },
  { background: "#e2f1ed", body: "#218c7a", accent: "#f0c75e", ink: "#123d37", blush: "#ff9e9e" },
  { background: "#f2e8ff", body: "#b36be2", accent: "#ffd56b", ink: "#402353", blush: "#ff9eb4" },
  { background: "#e4f7ff", body: "#35b6c9", accent: "#ff8f70", ink: "#173f49", blush: "#ffabb8" },
  { background: "#fff4c9", body: "#e1ad24", accent: "#6f9cf5", ink: "#4a3914", blush: "#ff927e" },
  { background: "#e7e9ff", body: "#5967d9", accent: "#ffba68", ink: "#20275a", blush: "#ff9aae" },
] as const;
const bodyPaths = [
  "M15 35c0-14 7-23 18-23 12 0 18 10 17 24-1 12-7 19-18 19-10 0-17-8-17-20Z",
  "M14 34c0-13 8-22 18-22s18 9 18 22-4 21-18 21-18-8-18-21Z",
  "M17 24c5-12 25-12 30 0l3 24c-6 6-30 6-36 0l3-24Z",
  "M16 21c7-8 26-8 33 0l-1 27c-8 8-24 9-32 0V21Z",
  "M13 37c3-8 4-21 14-24 7-2 11 4 14 10 8 1 11 8 9 16-2 11-9 17-20 16-11-1-20-7-17-18Z",
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
  const styleHash = hashSeed(`style:${identity}`);
  const detailHash = hashSeed(`detail:${identity}`);
  const palette = palettes[hash % palettes.length];
  return {
    ...palette,
    accessory: styleHash % 9,
    face: (styleHash >>> 5) % 5,
    bodyPath: bodyPaths[(styleHash >>> 9) % bodyPaths.length],
    bodyPattern: (styleHash >>> 13) % 4,
    backgroundPattern: (styleHash >>> 17) % 5,
    tilt: ((detailHash >>> 4) % 17) - 8,
    eyeOffset: ((detailHash >>> 10) % 3) - 1,
    bubbleX: 8 + ((detailHash >>> 14) % 14),
    bubbleY: 8 + ((detailHash >>> 20) % 12),
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
