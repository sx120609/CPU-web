<template>
  <article v-if="ad" class="forum-ad-card" :class="{ compact }">
    <a
      class="forum-ad-link"
      :href="ad.linkUrl"
      :target="isExternal ? '_blank' : undefined"
      :rel="isExternal ? 'noopener noreferrer sponsored' : 'sponsored'"
    >
      <div class="ad-badge">推广</div>
      <img v-if="ad.imageUrl" class="ad-image" :src="ad.imageUrl" :alt="ad.title" loading="lazy" />
      <div class="ad-copy">
        <h3>{{ ad.title }}</h3>
        <p v-if="ad.description">{{ ad.description }}</p>
      </div>
      <span v-if="ad.buttonText" class="ad-action">{{ ad.buttonText }} <span aria-hidden="true">→</span></span>
    </a>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ForumAd } from "@/api/forumAds";

const props = withDefaults(defineProps<{ ad: ForumAd; compact?: boolean }>(), { compact: false });
const isExternal = computed(() => /^https?:\/\//i.test(props.ad.linkUrl));
</script>

<style scoped>
.forum-ad-card {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 22%, var(--cpu-border-soft));
  border-radius: 14px;
  background: linear-gradient(115deg, color-mix(in srgb, var(--cpu-primary) 8%, var(--cpu-card)), var(--cpu-card));
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.045);
}
.forum-ad-link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 76px;
  padding: 14px 16px 14px 20px;
  color: inherit;
  text-decoration: none;
  transition: background .16s ease, transform .16s ease;
}
.forum-ad-link:hover { background: color-mix(in srgb, var(--cpu-primary) 6%, transparent); }
.ad-badge {
  flex: 0 0 auto;
  align-self: flex-start;
  padding: 3px 6px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 35%, transparent);
  border-radius: 5px;
  color: var(--cpu-primary);
  font-size: 11px;
  line-height: 1.2;
}
.ad-image { width: 76px; height: 48px; flex: 0 0 auto; object-fit: cover; border-radius: 8px; background: var(--cpu-surface-subtle); }
.ad-copy { min-width: 0; flex: 1; }
.ad-copy h3 { margin: 0; overflow: hidden; color: var(--cpu-text); font-size: 15px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.ad-copy p { margin: 5px 0 0; overflow: hidden; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.ad-action { flex: 0 0 auto; color: var(--cpu-primary); font-size: 13px; font-weight: 700; white-space: nowrap; }
.compact .forum-ad-link { min-height: 62px; padding-top: 11px; padding-bottom: 11px; }
@media (max-width: 600px) {
  .forum-ad-link { gap: 9px; padding-left: 13px; }
  .ad-image { width: 62px; height: 42px; }
  .ad-action { font-size: 12px; }
}
</style>
