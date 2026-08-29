<template>
  <article
    ref="cardRef"
    class="feed-card"
    role="button"
    tabindex="0"
    @click="openTopic"
    @keydown.enter.prevent="openTopic"
    @keydown.space.prevent="openTopic"
  >
    <header class="feed-card-head">
      <UserAvatar
        :size="38"
        class="feed-avatar"
        :src="topic.author?.avatar"
        :name="topic.author?.nickname"
        :seed="topic.author?.id ?? topic.anonymousAlias ?? topic.id"
        :profile-frame="topic.author?.profileFrame"
        alt="作者头像"
      />
      <div class="feed-author">
        <div class="feed-author-line">
          <span class="feed-author-name">{{ topic.author?.nickname || "匿名同学" }}</span>
          <span v-if="topic.author?.vipActive" class="vip-badge">VIP</span>
          <span v-if="topic.isAnonymous" class="anonymous-badge">匿名</span>
        </div>
        <div class="feed-context">
          <span>{{ fmtRelative(topic.lastReplyAt || topic.createdAt) }}</span>
          <span class="feed-dot">·</span>
          <span class="board-badge" :style="boardBadgeStyle">{{ topic.board?.name || "校园动态" }}</span>
        </div>
      </div>
      <span v-if="rank" class="rank-badge" :class="{ 'is-top': rank <= 3 }">#{{ rank }}</span>
      <strong v-else-if="marketPrice" class="market-price">{{ marketPrice }}</strong>
    </header>

    <div class="feed-card-body">
      <div class="feed-title-line">
        <span v-if="topic.globalPinned || topic.pinned" class="pin-badge">置顶</span>
        <h3>{{ displayTitle }}</h3>
      </div>
      <p v-if="excerpt" class="feed-excerpt">{{ excerpt }}</p>
      <div v-if="images.length" class="feed-media" :class="`feed-media--${Math.min(images.length, 3)}`">
        <span v-for="(src, index) in images.slice(0, 3)" :key="src" class="feed-media-cell">
          <img
            :src="src"
            :alt="`帖子图片 ${index + 1}`"
            loading="lazy"
            decoding="async"
            @error="hideBrokenImage"
          />
        </span>
        <span v-if="images.length > 3" class="media-count">共 {{ images.length }} 张</span>
      </div>
      <div v-if="marketFacts.length" class="market-facts">
        <span v-for="fact in marketFacts" :key="fact">{{ fact }}</span>
      </div>
    </div>

    <footer class="feed-card-foot">
      <span v-if="reviewLabel" class="review-state">{{ reviewLabel }}</span>
      <span v-else class="feed-hint">{{ topic.board?.type === "market" ? "校内交流" : "校园分享" }}</span>
      <span class="feed-stat"><el-icon><View /></el-icon>{{ topic.viewCount || 0 }}</span>
      <span class="feed-stat"><el-icon><ChatLineRound /></el-icon>{{ topic.replyCount || "回复" }}</span>
      <span class="feed-stat"><el-icon><Star /></el-icon>{{ topic.likeCount || "点赞" }}</span>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ChatLineRound, Star, View } from "@element-plus/icons-vue";
import type { Topic } from "@/api/topic";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { fmtRelative } from "@/utils/format";
import { forumContentExcerpt, forumContentImages } from "@/utils/forumContent";
import { hasTrackedTopicImpression, queueTopicImpression } from "@/utils/topicImpressions";

const props = withDefaults(defineProps<{ topic: Topic; rank?: number }>(), { rank: 0 });
const route = useRoute();
const router = useRouter();
const cardRef = ref<HTMLElement | null>(null);
let impressionObserver: IntersectionObserver | null = null;
let impressionTimer: ReturnType<typeof setTimeout> | null = null;

const isSayTopic = computed(() => props.topic.metadata?._postMode === "say");
const contentExcerpt = computed(() => forumContentExcerpt(props.topic.content, isSayTopic.value ? 180 : 120));
const displayTitle = computed(() => isSayTopic.value ? contentExcerpt.value || props.topic.title : props.topic.title);
const excerpt = computed(() => isSayTopic.value ? "" : contentExcerpt.value && contentExcerpt.value !== props.topic.title ? contentExcerpt.value : "");
const images = computed(() => forumContentImages(props.topic.content, 9));
const boardBadgeStyle = computed(() => ({
  color: props.topic.board?.color || "var(--cpu-primary)",
  borderColor: `color-mix(in srgb, ${props.topic.board?.color || "var(--cpu-primary)"} 26%, var(--cpu-border-soft))`,
}));
const marketKind = computed(() => {
  if (props.topic.board?.type !== "market") return "";
  const raw = props.topic.metadata?.marketKind || props.topic.metadata?.listingType;
  if (raw === "wanted" || props.topic.metadata?.condition === "求购") return "wanted";
  if (raw === "discuss") return "discuss";
  return raw === "sell" ? "sell" : "";
});
const marketPrice = computed(() => {
  if (!marketKind.value || marketKind.value === "discuss") return "";
  if (props.topic.metadata?.priceType === "negotiable") return marketKind.value === "wanted" ? "预算面议" : "面议";
  const price = Number(props.topic.metadata?.price);
  return Number.isFinite(price) && price > 0 ? `¥${price}` : "面议";
});
const MARKET_CATEGORY_LABELS: Record<string, string> = {
  books: "教材书籍",
  digital: "数码电器",
  appliance: "数码电器",
  dorm: "宿舍生活",
  fashion: "衣物日用",
  sports: "运动户外",
  tickets: "票券周边",
  digital_goods: "电子资料",
  other: "其他",
};
const marketFacts = computed(() => {
  if (!marketKind.value || marketKind.value === "discuss") return [];
  const facts = [
    marketKind.value === "wanted" ? "求购" : "出闲置",
    MARKET_CATEGORY_LABELS[String(props.topic.metadata?.category || "")] || "",
    String(props.topic.metadata?.campus || "").trim(),
  ].filter(Boolean);
  return facts.slice(0, 2);
});
const reviewLabel = computed(() => {
  if (!props.topic.hidden) return "";
  const status = String(props.topic.aiReviewStatus || "");
  if (status === "checking") return "审核中 · 仅自己可见";
  if (["manual_requested", "manual_reviewing"].includes(status)) return "人工复核中";
  return "暂未公开";
});

watch(() => props.topic.id, observeImpression);
onMounted(observeImpression);
onBeforeUnmount(clearImpressionTracking);

function clearImpressionTracking() {
  impressionObserver?.disconnect();
  impressionObserver = null;
  if (impressionTimer !== null) clearTimeout(impressionTimer);
  impressionTimer = null;
}

function observeImpression() {
  clearImpressionTracking();
  const topicId = Number(props.topic.id);
  if (!Number.isInteger(topicId) || topicId <= 0 || props.topic.hidden || hasTrackedTopicImpression(topicId)) return;
  const record = () => {
    impressionTimer = null;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    clearImpressionTracking();
    void queueTopicImpression(topicId);
  };
  if (typeof IntersectionObserver === "undefined" || !cardRef.value) return record();
  impressionObserver = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting && entry.intersectionRatio >= 0.45) {
      if (impressionTimer === null) impressionTimer = setTimeout(record, 450);
    } else if (impressionTimer !== null) {
      clearTimeout(impressionTimer);
      impressionTimer = null;
    }
  }, { threshold: [0, 0.45] });
  impressionObserver.observe(cardRef.value);
}

function hideBrokenImage(event: Event) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLImageElement)) return;
  target.hidden = true;
  const cell = target.parentElement;
  if (cell?.classList.contains("feed-media-cell")) cell.hidden = true;
}

function openTopic() {
  router.push({ path: `/forum/topic/${props.topic.id}`, query: { from: route.fullPath } });
}
</script>

<style scoped>
.feed-card { padding: 15px 16px 12px; border: 1px solid var(--cpu-border-soft); border-radius: 14px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); cursor: pointer; transition: border-color .16s ease, transform .16s ease, box-shadow .16s ease; }
.feed-card:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--cpu-primary) 28%, var(--cpu-border)); box-shadow: var(--cpu-shadow-md); }
.feed-card:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.feed-card-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.feed-avatar { flex: 0 0 auto; }
.feed-author { flex: 1; min-width: 0; }
.feed-author-line, .feed-context, .feed-card-foot, .feed-stat { display: flex; align-items: center; }
.feed-author-line { gap: 6px; min-width: 0; }
.feed-author-name { overflow: hidden; color: var(--cpu-text); font-size: 14px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.feed-context { gap: 5px; margin-top: 3px; color: var(--cpu-text-muted); font-size: 11px; }
.feed-dot { color: var(--cpu-border); }
.board-badge { max-width: 130px; padding: 1px 6px; overflow: hidden; border: 1px solid; border-radius: 999px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.vip-badge, .anonymous-badge { flex: 0 0 auto; padding: 0 5px; border-radius: 999px; font-size: 9px; font-weight: 800; line-height: 17px; }
.vip-badge { border: 1px solid #f59e0b; background: #fef3c7; color: #a16207; }
.anonymous-badge { background: color-mix(in srgb, #8b5cf6 10%, var(--cpu-card)); color: #7c3aed; }
.rank-badge { flex: 0 0 auto; padding: 3px 8px; border-radius: 999px; background: var(--cpu-surface-soft); color: var(--cpu-text-muted); font-size: 11px; font-weight: 800; }
.rank-badge.is-top { background: color-mix(in srgb, #ef4444 10%, var(--cpu-card)); color: #dc2626; }
.market-price { flex: 0 0 auto; color: #dc2626; font-size: 14px; }
.feed-card-body { margin: 11px 0 0 48px; }
.feed-title-line { display: flex; align-items: flex-start; gap: 7px; }
.feed-title-line h3 { margin: 0; color: var(--cpu-text); font-size: 15px; font-weight: 620; line-height: 1.55; overflow-wrap: anywhere; }
.pin-badge { flex: 0 0 auto; margin-top: 2px; padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, #f59e0b 13%, var(--cpu-card)); color: #b45309; font-size: 10px; font-weight: 700; line-height: 18px; }
.feed-excerpt { display: -webkit-box; margin: 6px 0 0; overflow: hidden; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.65; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.feed-media { position: relative; display: grid; gap: 5px; max-width: 560px; margin-top: 10px; overflow: hidden; border-radius: 10px; }
.feed-media--1 { grid-template-columns: minmax(0, 320px); }
.feed-media--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.feed-media--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.feed-media-cell { display: contents; }
.feed-media img { width: 100%; height: 150px; object-fit: cover; background: var(--cpu-surface-subtle); }
.feed-media--1 img { height: auto; max-height: 330px; object-fit: contain; }
.media-count { position: absolute; right: 7px; bottom: 7px; padding: 3px 7px; border-radius: 999px; background: rgba(15, 23, 42, .7); color: #fff; font-size: 10px; }
.market-facts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.market-facts span { padding: 3px 7px; border-radius: 999px; background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); font-size: 10px; }
.feed-card-foot { justify-content: flex-end; gap: 16px; margin: 11px 0 0 48px; color: var(--cpu-text-muted); font-size: 12px; }
.feed-hint, .review-state { margin-right: auto; }
.review-state { color: #b45309; font-weight: 600; }
.feed-stat { gap: 4px; }
@media (max-width: 768px) {
  .feed-card { padding: 13px 12px 10px; border-radius: 11px; box-shadow: none; }
  .feed-card-body, .feed-card-foot { margin-left: 0; }
  .feed-card-body { margin-top: 10px; }
  .feed-card-foot { margin-top: 10px; }
  .feed-media-cell { display: block; min-width: 0; aspect-ratio: 1; overflow: hidden; border-radius: 8px; background: var(--cpu-surface-subtle); }
  .feed-media--1 { grid-template-columns: minmax(0, 220px); }
  .feed-media--1 .feed-media-cell { aspect-ratio: 4 / 3; }
  .feed-media img, .feed-media--1 img { width: 100%; height: 100%; max-height: none; object-fit: cover; }
  .feed-title-line h3 { font-size: 14px; }
}
</style>
