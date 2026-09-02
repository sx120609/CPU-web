<template>
  <div
    v-if="slides.length"
    class="forum-ad-carousel"
    :class="{ 'has-multiple': slides.length > 1 }"
    @mouseenter="pauseRotation"
    @mouseleave="startRotation"
    @focusin="pauseRotation"
    @focusout="resumeAfterFocus"
  >
    <ForumAdCard v-if="slides.length === 1" :ad="slides[0]" :compact="compact" />
    <el-carousel
      v-else
      ref="carouselRef"
      :height="carouselHeight"
      :interval="rotationInterval"
      :autoplay="false"
      :loop="false"
      arrow="never"
      indicator-position="none"
      aria-label="推广内容"
      @change="activeIndex = $event"
    >
      <el-carousel-item v-for="ad in slides" :key="ad.id">
        <ForumAdCard :ad="ad" :compact="compact" />
      </el-carousel-item>
    </el-carousel>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ForumAd } from "@/api/forumAds";
import ForumAdCard from "@/components/forum/ForumAdCard.vue";

const props = withDefaults(defineProps<{ ads: ForumAd[]; compact?: boolean }>(), { compact: false });
const slides = computed(() => [...new Map(props.ads.map((ad) => [ad.id, ad])).values()]);
const carouselHeight = computed(() => props.compact ? "92px" : "114px");
const carouselRef = ref<{ setActiveItem: (index: number) => void } | null>(null);
const activeIndex = ref(0);
const rotationInterval = 6000;
let rotationTimer: ReturnType<typeof setInterval> | null = null;

watch(() => slides.value.length, async () => {
  activeIndex.value = 0;
  await nextTick();
  carouselRef.value?.setActiveItem(0);
  startRotation();
});

onMounted(() => {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  startRotation();
});

onBeforeUnmount(() => {
  pauseRotation();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});

function pauseRotation() {
  if (!rotationTimer) return;
  clearInterval(rotationTimer);
  rotationTimer = null;
}

function startRotation() {
  pauseRotation();
  if (slides.value.length < 2 || document.hidden || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  rotationTimer = setInterval(() => {
    carouselRef.value?.setActiveItem((activeIndex.value + 1) % slides.value.length);
  }, rotationInterval);
}

function resumeAfterFocus(event: FocusEvent) {
  const root = event.currentTarget as HTMLElement | null;
  if (!root || !(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget)) startRotation();
}

function handleVisibilityChange() {
  if (document.hidden) pauseRotation();
  else startRotation();
}
</script>

<style scoped>
.forum-ad-carousel { min-width: 0; width: 100%; }
.has-multiple :deep(.el-carousel__container) { border-radius: 16px; }
.has-multiple :deep(.el-carousel__item) { overflow: hidden; border-radius: 16px; }
.has-multiple :deep(.forum-ad-card),
.has-multiple :deep(.forum-ad-link) { box-sizing: border-box; height: 100%; }
@media (max-width: 600px) {
  .has-multiple :deep(.el-carousel__container) { height: 92px !important; }
}
</style>
