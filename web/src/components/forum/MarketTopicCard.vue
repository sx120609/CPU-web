<template>
  <article
    ref="cardRef"
    class="market-topic-card"
    role="button"
    tabindex="0"
    @click="openTopic"
    @keydown.enter.prevent="openTopic"
    @keydown.space.prevent="openTopic"
  >
    <img v-if="image" class="market-topic-image" :src="image" alt="物品图片" loading="lazy" decoding="async" @error="hideBrokenImage" />
    <div class="market-topic-body">
      <div class="market-topic-tags">
        <span v-if="topic.globalPinned || topic.pinned" class="market-tag is-pinned">置顶</span>
        <span v-if="kindLabel" class="market-tag" :class="`is-${marketKind}`">{{ kindLabel }}</span>
        <span v-if="categoryLabel" class="market-tag is-category">{{ categoryLabel }}</span>
      </div>
      <h3>{{ displayTitle }}</h3>
      <p v-if="excerpt && marketKind !== 'discuss'">{{ excerpt }}</p>
      <strong v-if="priceLabel" class="market-topic-price">{{ priceLabel }}</strong>
      <div v-if="facts.length" class="market-topic-facts">
        <span v-for="fact in facts" :key="fact">{{ fact }}</span>
      </div>
      <footer>
        <UserAvatar
          :size="27"
          :src="topic.author?.avatar"
          :name="topic.author?.nickname"
          :seed="topic.author?.id ?? topic.anonymousAlias ?? topic.id"
          :profile-frame="topic.author?.profileFrame"
          alt="作者头像"
        />
        <span class="market-topic-author">{{ topic.author?.nickname || "匿名同学" }}</span>
        <span>{{ fmtRelative(topic.lastReplyAt || topic.createdAt) }}</span>
        <span v-if="topic.replyCount" class="market-topic-replies"><el-icon><ChatLineRound /></el-icon>{{ topic.replyCount }}</span>
      </footer>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ChatLineRound } from "@element-plus/icons-vue";
import type { Topic } from "@/api/topic";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { fmtRelative } from "@/utils/format";
import { forumContentExcerpt, forumContentImages } from "@/utils/forumContent";
import { hasTrackedTopicImpression, queueTopicImpression } from "@/utils/topicImpressions";

const props = defineProps<{ topic: Topic }>();
const route = useRoute();
const router = useRouter();
const cardRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const marketKind = computed(() => {
  const raw = props.topic.metadata?.marketKind || props.topic.metadata?.listingType;
  if (raw === "wanted" || props.topic.metadata?.condition === "求购") return "wanted";
  if (raw === "discuss") return "discuss";
  return raw === "sell" ? "sell" : "";
});
const kindLabel = computed(() => marketKind.value === "wanted" ? "求购" : marketKind.value === "discuss" ? "讨论" : marketKind.value === "sell" ? "出闲置" : "");
const CATEGORY_LABELS: Record<string, string> = {
  books: "教材书籍", digital: "数码电器", appliance: "数码电器", dorm: "宿舍生活", fashion: "衣物日用",
  sports: "运动户外", tickets: "票券周边", digital_goods: "电子资料", other: "其他",
};
const categoryLabel = computed(() => marketKind.value && marketKind.value !== "discuss" ? CATEGORY_LABELS[String(props.topic.metadata?.category || "")] || "" : "");
const priceLabel = computed(() => {
  if (!marketKind.value || marketKind.value === "discuss") return "";
  if (props.topic.metadata?.priceType === "negotiable") return marketKind.value === "wanted" ? "预算面议" : "面议";
  const price = Number(props.topic.metadata?.price);
  return Number.isFinite(price) && price > 0 ? `¥${price}` : "面议";
});
const isSay = computed(() => props.topic.metadata?._postMode === "say");
const excerpt = computed(() => forumContentExcerpt(props.topic.content, 92));
const displayTitle = computed(() => isSay.value ? excerpt.value || props.topic.title : props.topic.title);
const image = computed(() => forumContentImages(props.topic.content, 1)[0] || "");
const facts = computed(() => {
  if (!marketKind.value || marketKind.value === "discuss") return [];
  const values = [
    String(props.topic.metadata?.campus || "").trim(),
    String(props.topic.metadata?.tradeMode || "").trim(),
    marketKind.value === "sell" ? String(props.topic.metadata?.condition || "").trim() : "",
  ].filter(Boolean);
  return values.slice(0, 2);
});

watch(() => props.topic.id, observeImpression);
onMounted(observeImpression);
onBeforeUnmount(clearTracking);

function clearTracking() {
  observer?.disconnect();
  observer = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function observeImpression() {
  clearTracking();
  const id = Number(props.topic.id);
  if (!Number.isInteger(id) || id <= 0 || props.topic.hidden || hasTrackedTopicImpression(id)) return;
  const record = () => {
    timer = null;
    clearTracking();
    if (typeof document === "undefined" || document.visibilityState === "visible") void queueTopicImpression(id);
  };
  if (typeof IntersectionObserver === "undefined" || !cardRef.value) return record();
  observer = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting && entry.intersectionRatio >= .45) {
      if (timer === null) timer = setTimeout(record, 450);
    } else if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }, { threshold: [0, .45] });
  observer.observe(cardRef.value);
}

function hideBrokenImage(event: Event) {
  const target = event.currentTarget;
  if (target instanceof HTMLImageElement) target.hidden = true;
}

function openTopic() {
  void router.push({ path: `/forum/topic/${props.topic.id}`, query: { from: route.fullPath } });
}
</script>

<style scoped>
.market-topic-card { width: 100%; margin: 0 0 12px; overflow: hidden; break-inside: avoid; border: 1px solid var(--cpu-border-soft); border-radius: 13px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); cursor: pointer; }
.market-topic-card:hover { border-color: color-mix(in srgb, var(--cpu-primary) 36%, var(--cpu-border)); }
.market-topic-card:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.market-topic-image { display: block; width: 100%; max-height: 220px; object-fit: cover; background: var(--cpu-surface-subtle); }
.market-topic-body { padding: 12px; }
.market-topic-tags, .market-topic-facts, .market-topic-body footer, .market-topic-replies { display: flex; align-items: center; }
.market-topic-tags { flex-wrap: wrap; gap: 5px; margin-bottom: 7px; }
.market-tag { padding: 2px 6px; border: 1px solid color-mix(in srgb, var(--cpu-primary) 28%, var(--cpu-border)); border-radius: 5px; color: var(--cpu-primary); font-size: 10px; font-weight: 650; }
.market-tag.is-wanted { border-color: color-mix(in srgb, #f59e0b 38%, var(--cpu-border)); color: #b45309; }
.market-tag.is-category { border-color: var(--cpu-border-soft); color: var(--cpu-text-secondary); font-weight: 500; }
.market-tag.is-pinned { border-color: color-mix(in srgb, #ef4444 32%, var(--cpu-border)); color: #dc2626; }
.market-topic-body h3 { margin: 0; color: var(--cpu-text); font-size: 14px; font-weight: 620; line-height: 1.55; overflow-wrap: anywhere; }
.market-topic-body p { display: -webkit-box; margin: 5px 0 0; overflow: hidden; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.market-topic-price { display: block; margin-top: 8px; color: #dc2626; font-size: 16px; }
.market-topic-facts { flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.market-topic-facts span { padding: 3px 7px; border-radius: 999px; background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); font-size: 10px; }
.market-topic-body footer { gap: 6px; min-width: 0; margin-top: 10px; color: var(--cpu-text-muted); font-size: 10px; }
.market-topic-author { flex: 1; min-width: 0; overflow: hidden; color: var(--cpu-primary); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.market-topic-replies { gap: 2px; }
@media (max-width: 720px) {
  .market-topic-card { display: flex; align-items: stretch; gap: 10px; margin: 0; border: 0; border-bottom: 1px solid var(--cpu-border-soft); border-radius: 0; box-shadow: none; }
  .market-topic-image { flex: 0 0 84px; width: 84px; height: 84px; margin: 10px 0; border-radius: 9px; }
  .market-topic-body { flex: 1; min-width: 0; padding: 10px 0; }
  .market-topic-tags { flex-wrap: nowrap; overflow: hidden; }
  .market-topic-body p { -webkit-line-clamp: 2; }
}
</style>
