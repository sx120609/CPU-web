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
          <UserVerificationBadge :verification="topic.author?.verification" />
          <UserReputationBadge :level="topic.author?.reputationLevel" />
          <span v-if="topic.author?.vipActive" class="vip-badge">VIP</span>
          <span v-if="topic.isAnonymous" class="anonymous-badge">匿名</span>
        </div>
        <div class="feed-context">
          <span>{{ fmtRelative(displayedTime) }}</span>
          <span class="feed-dot">·</span>
          <span class="board-badge">{{ topic.board?.name || "校园动态" }}</span>
        </div>
      </div>
      <span v-if="rank" class="rank-badge" :class="{ 'is-top': rank <= 3 }">#{{ rank }}</span>
      <strong v-else-if="marketPrice" class="market-price">{{ marketPrice }}</strong>
    </header>

    <div class="feed-card-body">
      <div class="feed-title-line" :class="{ 'is-say': isSayTopic }">
        <span v-if="topic.globalPinned || topic.pinned" class="pin-badge">置顶</span>
        <h3>{{ displayTitle }}</h3>
      </div>
      <p v-if="excerpt" class="feed-excerpt">{{ excerpt }}</p>
      <div v-if="images.length" class="feed-media" :class="`feed-media--${Math.min(images.length, 3)}`">
        <span v-for="(image, index) in previewImages" :key="image.original" class="feed-media-cell">
          <img
            :src="image.src"
            :srcset="image.srcset"
            sizes="(max-width: 480px) 42vw, (max-width: 768px) 30vw, 220px"
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

    <div v-if="replyPreviews.length" class="reply-previews" aria-label="评论预览">
      <p v-for="reply in replyPreviews" :key="reply.id">
        <span class="reply-author"><strong>{{ reply.authorName }}</strong><UserVerificationBadge :verification="reply.verification" /><b>：</b></span><span>{{ reply.excerpt }}</span>
      </p>
      <span v-if="remainingReplyCount" class="reply-more">查看剩余 {{ remainingReplyCount }} 条评论 <b aria-hidden="true">›</b></span>
    </div>

    <footer class="feed-card-foot">
      <span v-if="reviewLabel" class="review-state">{{ reviewLabel }}</span>
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
import UserVerificationBadge from "@/components/common/UserVerificationBadge.vue";
import UserReputationBadge from "@/components/common/UserReputationBadge.vue";
import { fmtRelative } from "@/utils/format";
import { forumContentExcerpt, forumContentImages } from "@/utils/forumContent";
import { cdnImageSrcset, cdnImageUrl } from "@/utils/cdnMedia";
import { hasTrackedTopicImpression, queueTopicImpression } from "@/utils/topicImpressions";

const props = withDefaults(defineProps<{ topic: Topic; rank?: number; timeMode?: "activity" | "published" }>(), {
  rank: 0,
  timeMode: "activity",
});
const route = useRoute();
const router = useRouter();
const cardRef = ref<HTMLElement | null>(null);
let impressionObserver: IntersectionObserver | null = null;
let impressionTimer: ReturnType<typeof setTimeout> | null = null;

const isSayTopic = computed(() => props.topic.metadata?._postMode === "say");
const displayedTime = computed(() => props.timeMode === "published" ? props.topic.createdAt : props.topic.lastReplyAt || props.topic.createdAt);
const contentExcerpt = computed(() => forumContentExcerpt(props.topic.content, isSayTopic.value ? 180 : 120));
const displayTitle = computed(() => isSayTopic.value ? contentExcerpt.value || props.topic.title : props.topic.title);
const excerpt = computed(() => isSayTopic.value ? "" : contentExcerpt.value && contentExcerpt.value !== props.topic.title ? contentExcerpt.value : "");
const images = computed(() => forumContentImages(props.topic.content, 9));
const previewImages = computed(() => images.value.slice(0, 3).map((original) => ({
  original,
  src: cdnImageUrl(original, { width: 720, quality: 80 }),
  srcset: cdnImageSrcset(original, [320, 480, 720, 960], 80),
})));
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
const replyPreviews = computed(() => (props.topic.previewReplies || [])
  .map((reply) => ({
    id: reply.id,
    authorName: reply.author?.nickname || reply.anonymousAlias || "匿名同学",
    verification: reply.author?.verification,
    excerpt: forumContentExcerpt(reply.content, 96),
  }))
  .filter((reply) => reply.excerpt)
  .slice(0, 2));
const remainingReplyCount = computed(() => Math.max(0, Number(props.topic.replyCount || 0) - replyPreviews.value.length));
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
/* 一种卡片：白色分组、无描边无阴影。列表页把它们叠成一整块时由父级去掉圆角并加细线。 */
.feed-card { padding: 16px; border-radius: var(--cpu-radius-l); background: var(--cpu-card); color: var(--cpu-text); font-size: var(--cpu-fs-m); line-height: 1.6; cursor: pointer; }
.feed-card:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -2px; }
.feed-card-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.feed-avatar { flex: 0 0 auto; }
.feed-author { flex: 1; min-width: 0; }
.feed-author-line, .feed-context, .feed-card-foot, .feed-stat { display: flex; align-items: center; }
.feed-author-line { gap: 6px; min-width: 0; line-height: 1.4; }
.feed-author-name { overflow: hidden; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.feed-context { gap: 5px; margin-top: 1px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.4; }
.board-badge { max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vip-badge, .anonymous-badge, .pin-badge { flex: 0 0 auto; height: 18px; padding: 0 5px; border-radius: var(--cpu-radius-s); font-size: var(--cpu-fs-xs); font-weight: 500; line-height: 18px; }
.vip-badge, .anonymous-badge { color: var(--cpu-text-muted); box-shadow: inset 0 0 0 1px var(--cpu-border); }
.pin-badge { margin-top: 3px; background: var(--cpu-accent-soft); color: var(--cpu-accent); }
.rank-badge { flex: 0 0 auto; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); font-weight: 600; font-variant-numeric: tabular-nums; }
.rank-badge.is-top { color: var(--cpu-rank-top); }
.market-price { flex: 0 0 auto; font-size: var(--cpu-fs-l); font-variant-numeric: tabular-nums; }
.feed-card-body { margin-top: 10px; }
.feed-title-line { display: flex; align-items: flex-start; gap: 6px; }
.feed-title-line h3 { display: -webkit-box; margin: 0; overflow: hidden; font-size: var(--cpu-fs-l); font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 3; text-wrap: pretty; }
/* 没有标题的“说说”直接显示正文，用正文的字号字重 */
.feed-title-line.is-say h3 { font-size: var(--cpu-fs-m); font-weight: 400; line-height: 1.6; -webkit-line-clamp: 5; }
.feed-excerpt { display: -webkit-box; margin: 4px 0 0; overflow: hidden; color: var(--cpu-text-secondary); -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.feed-media { position: relative; display: grid; gap: 3px; max-width: 560px; margin-top: 10px; overflow: hidden; border-radius: var(--cpu-radius-m); }
.feed-media--1 { grid-template-columns: minmax(0, 66%); border-radius: 0; }
.feed-media--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.feed-media--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.feed-media-cell { display: block; min-width: 0; aspect-ratio: 1; overflow: hidden; background: var(--cpu-surface-subtle); }
.feed-media--1 .feed-media-cell { aspect-ratio: 4 / 3; border-radius: var(--cpu-radius-m); }
.feed-media img { display: block; width: 100%; height: 100%; object-fit: cover; }
.media-count { position: absolute; right: 6px; bottom: 6px; padding: 2px 6px; border-radius: var(--cpu-radius-s); background: var(--cpu-scrim); color: #fff; font-size: var(--cpu-fs-xs); line-height: 1.4; }
.market-facts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.market-facts span { padding: 1px 6px; border-radius: var(--cpu-radius-s); background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); }
.reply-previews { display: grid; gap: 2px; margin-top: 12px; padding: 10px 12px; border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); }
.reply-previews p { display: flex; min-width: 0; gap: 2px; margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.7; }
.reply-previews .reply-author { display: inline-flex; max-width: 38%; flex: 0 0 auto; align-items: center; overflow: visible; }
.reply-previews strong { min-width: 0; overflow: hidden; color: var(--cpu-text); font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.reply-previews .reply-author :deep(.account-verification-badge) { width: 15px; height: 15px; flex-basis: 15px; margin-left: 2px; }
.reply-previews .reply-author b { flex: 0 0 auto; color: var(--cpu-text); font-weight: 500; }
.reply-previews span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reply-previews .reply-more { justify-self: start; color: var(--cpu-primary); font-size: var(--cpu-fs-s); }
.reply-more b { font-weight: 400; }
.feed-card-foot { gap: 20px; margin-top: 10px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); font-variant-numeric: tabular-nums; }
.review-state { order: 1; margin-left: auto; color: var(--cpu-accent); font-weight: 500; }
.feed-stat { gap: 5px; }
.feed-stat .el-icon { font-size: 16px; }
</style>
