<template>
  <div
    ref="rowRef"
    class="topic-row"
    :class="{ 'topic-row--card': isCard, 'topic-row--simple': isSimple }"
    role="button"
    tabindex="0"
    @click="openTopic"
    @keydown.enter.prevent="openTopic"
    @keydown.space.prevent="openTopic"
  >
    <template v-if="isSimple">
      <UserAvatar :size="36" class="avatar" :src="topic.author?.avatar" :name="topic.author?.nickname" :profile-frame="topic.author?.profileFrame" alt="作者头像" />
      <div class="simple-main">
        <div class="simple-heading" :class="{ 'has-price': metaPriceLabel }">
          <span class="simple-title"><b v-if="topic.globalPinned || topic.pinned">置顶</b>{{ displayTitle }}</span>
          <strong v-if="metaPriceLabel" class="simple-price">{{ metaPriceLabel }}</strong>
        </div>
        <div class="simple-context">
          <span class="simple-board">{{ boardDisplayName }}</span>
          <span v-if="marketKindLabel">{{ marketKindLabel }}</span>
          <span v-if="marketCategoryLabel">{{ marketCategoryLabel }}</span>
          <span v-if="reviewState" class="simple-review">{{ reviewState.label }}</span>
        </div>
        <div class="simple-footer">
          <div class="simple-byline">
            <span v-if="topic.author?.vipActive" class="vip-badge" title="VIP 用户">VIP</span>
            <span class="simple-author">{{ topic.author?.nickname ?? '—' }}</span>
            <span class="simple-time">{{ fmtRelative(topic.lastReplyAt || topic.createdAt) }}</span>
            <span v-if="topic.editCount && topic.editCount > 0" class="simple-edited">已编辑 {{ topic.editCount }} 次</span>
          </div>
          <div class="simple-stats">
            <span class="heat">热度 {{ hotScore }}</span>
            <span><el-icon><View /></el-icon>{{ displayedViewCount }}</span>
            <span><el-icon><ChatLineRound /></el-icon>{{ topic.replyCount }}</span>
            <span><el-icon><Star /></el-icon>{{ topic.likeCount }}</span>
          </div>
        </div>
      </div>
    </template>
    <template v-else-if="isCard">
      <img v-if="cardImage" class="market-card-image" :src="cardImage" alt="帖子图片" loading="lazy" decoding="async" />
      <div class="market-card-body">
        <div class="market-card-tags">
          <el-tag v-if="topic.globalPinned || topic.pinned" size="small" type="danger" effect="plain">置顶</el-tag>
          <el-tag v-if="marketKindLabel" size="small" effect="plain" :type="marketKindType">{{ marketKindLabel }}</el-tag>
          <el-tag v-if="marketCategoryLabel" size="small" effect="plain" type="info">{{ marketCategoryLabel }}</el-tag>
        </div>
        <h3>{{ displayTitle }}</h3>
        <p v-if="cardExcerpt && !isSayTopic" class="market-card-excerpt">{{ cardExcerpt }}</p>
        <strong v-if="metaPriceLabel" class="market-card-price">{{ metaPriceLabel }}</strong>
        <div class="market-card-meta">
          <UserAvatar :size="28" class="avatar" :src="topic.author?.avatar" :name="topic.author?.nickname" :profile-frame="topic.author?.profileFrame" alt="作者头像" />
          <span class="market-card-author">{{ topic.author?.nickname ?? "—" }}</span>
          <span>{{ fmtRelative(topic.lastReplyAt || topic.createdAt) }}</span>
          <span class="market-card-stat"><el-icon><ChatLineRound /></el-icon>{{ topic.replyCount }}</span>
          <span class="market-card-stat"><el-icon><View /></el-icon>{{ displayedViewCount }}</span>
        </div>
      </div>
    </template>
    <template v-else>
    <UserAvatar :size="36" class="avatar" :src="topic.author?.avatar" :name="topic.author?.nickname" :profile-frame="topic.author?.profileFrame" alt="作者头像" />
    <div class="main">
      <div class="line1" :class="{ 'has-inline-price': metaPriceLabel, 'has-ai-tags': aiTags.length }">
        <el-tag v-if="topic.globalPinned" size="small" type="warning" effect="dark" class="tag">全局置顶</el-tag>
        <el-tag v-if="topic.pinned" size="small" type="danger" effect="plain" class="tag">板块置顶</el-tag>
        <el-tag v-if="topic.board && showBoardTag" size="small" :style="{ background: topic.board.color || '#168776', color: '#fff', border: 'none' }" class="tag">
          {{ boardDisplayName }}
        </el-tag>
        <el-tag v-if="marketKindLabel" size="small" effect="plain" :type="marketKindType" class="tag market-kind-tag">
          {{ marketKindLabel }}
        </el-tag>
        <el-tag v-if="marketCategoryLabel" size="small" effect="plain" type="info" class="tag market-category-tag">
          {{ marketCategoryLabel }}
        </el-tag>
        <el-tag v-if="reviewState" size="small" :type="reviewState.type" effect="plain" class="tag review-tag">
          {{ reviewState.label }}
        </el-tag>
        <span class="title" :class="{ 'say-content': isSayTopic }">{{ displayTitle }}</span>
        <strong v-if="metaPriceLabel" class="inline-price">{{ metaPriceLabel }}</strong>
        <el-tag
          v-for="tag in aiTags"
          :key="tag.name"
          size="small"
          effect="plain"
          type="warning"
          class="tag ai-tag"
        >
          {{ tag.name }}
        </el-tag>
        <el-tag v-if="topic.locked" size="small" type="info" class="tag">🔒</el-tag>
        <el-tag v-if="metaSolved" size="small" type="success" class="tag">已解决</el-tag>
        <el-tag v-if="metaBounty" size="small" type="warning" class="tag">悬赏 {{ metaBounty }}</el-tag>
      </div>
      <div class="line2">
        <div class="row-byline">
          <span v-if="topic.author?.vipActive" class="vip-badge" title="VIP 用户">VIP</span>
          <span class="author">{{ topic.author?.nickname ?? "—" }}</span>
          <span v-if="topic.isAnonymous" class="anon">匿名</span>
          <span v-if="topic.author?.role === 'bot'" class="bot">🤖 公告同步</span>
          <span class="meta-separator">·</span>
          <span class="row-time">{{ fmtRelative(topic.lastReplyAt || topic.createdAt) }}</span>
          <span v-if="topic.editCount && topic.editCount > 0" class="edited">已编辑 {{ topic.editCount }} 次</span>
        </div>
        <div class="row-stats">
          <span class="heat">热度 {{ hotScore }}</span>
          <span><el-icon><View /></el-icon>{{ displayedViewCount }}</span>
          <span><el-icon><ChatLineRound /></el-icon>{{ topic.replyCount }}</span>
          <span><el-icon><Star /></el-icon>{{ topic.likeCount }}</span>
        </div>
      </div>
    </div>
    <div v-if="metaRating" class="rating">
      <el-rate :model-value="metaRating" disabled size="small" />
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { View, ChatLineRound, Star } from "@element-plus/icons-vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { fmtRelative } from "@/utils/format";
import { forumContentExcerpt } from "@/utils/forumContent";
import {
  hasTrackedTopicImpression,
  knownTopicViewCount,
  queueTopicImpression,
} from "@/utils/topicImpressions";

const props = withDefaults(defineProps<{ topic: any; variant?: "row" | "card" | "simple" }>(), {
  variant: "row",
});
const route = useRoute();
const router = useRouter();
const rowRef = ref<HTMLElement | null>(null);
const displayedViewCount = ref(knownTopicViewCount(Number(props.topic.id), Number(props.topic.viewCount) || 0));
let impressionObserver: IntersectionObserver | null = null;
let impressionTimer: ReturnType<typeof setTimeout> | null = null;
const isSayTopic = computed(() => props.topic.metadata?._postMode === "say");
const isCard = computed(() => props.variant === "card");
const isSimple = computed(() => props.variant === "simple");
const showBoardTag = computed(() => route.name !== "board");
const displayTitle = computed(() => isSayTopic.value
  ? forumContentExcerpt(props.topic.content, 110) || props.topic.title
  : props.topic.title);
const cardExcerpt = computed(() => forumContentExcerpt(props.topic.content, 90));
const cardImage = computed(() => {
  const content = String(props.topic.content || "");
  const htmlMatch = content.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  if (htmlMatch?.[1]) return htmlMatch[1];
  return content.match(/!\[[^\]]*\]\(([^\n)]+)\)/)?.[1] || "";
});
const marketKind = computed(() => {
  if (props.topic.board?.type !== "market") return "";
  const raw = props.topic.metadata?.marketKind || props.topic.metadata?.listingType;
  if (raw === "wanted" || props.topic.metadata?.condition === "求购") return "wanted";
  if (raw === "discuss") return "discuss";
  return "sell";
});
const marketKindLabel = computed(() => {
  if (marketKind.value === "wanted") return "求购";
  if (marketKind.value === "discuss") return "交流";
  return marketKind.value === "sell" ? "出闲置" : "";
});
const marketKindType = computed(() => marketKind.value === "wanted" ? "warning" as const : marketKind.value === "discuss" ? "info" as const : "success" as const);
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
const marketCategoryLabel = computed(() => {
  if (!marketKind.value || marketKind.value === "discuss") return "";
  return MARKET_CATEGORY_LABELS[String(props.topic.metadata?.category || "")] || "";
});
const metaPriceLabel = computed(() => {
  if (!marketKind.value || marketKind.value === "discuss") return "";
  if (props.topic.metadata?.priceType === "negotiable") {
    return marketKind.value === "wanted" ? "预算面议" : "面议";
  }
  const raw = props.topic.metadata?.price;
  if (raw === undefined || raw === null || raw === "") return "";
  const price = Number(raw);
  if (!Number.isFinite(price)) return "";
  return price > 0 ? `¥${price}` : "面议";
});
const metaSolved = computed(() => props.topic.metadata?.resolved === true);
const metaBounty = computed(() => props.topic.metadata?.bounty ? props.topic.metadata.bounty : 0);
const boardDisplayName = computed(() => props.topic.board?.name || "");
const metaRating = computed(() => {
  const r = props.topic.metadata?.ratings?.recommend;
  return typeof r === "number" ? r : 0;
});
const hotScore = computed(() => Math.round((props.topic.likeCount ?? 0) * 5 + (props.topic.replyCount ?? 0) * 3 + displayedViewCount.value * 0.03));
const aiTags = computed(() => Array.isArray(props.topic.tags) ? props.topic.tags.slice(0, 2) : []);
const reviewState = computed(() => {
  if (!props.topic.hidden) return null;
  const status = String(props.topic.aiReviewStatus || "");
  if (status === "checking") return { label: "审核中 · 仅自己可见", type: "warning" as const };
  if (status === "review_failed") return { label: "审核暂未完成", type: "danger" as const };
  if (status === "blocked_ai") return { label: "暂未通过审核", type: "danger" as const };
  if (["manual_requested", "manual_reviewing"].includes(status)) return { label: "人工复核中", type: "warning" as const };
  if (status === "rejected_manual") return { label: "人工复核未通过", type: "danger" as const };
  return { label: "仅自己可见", type: "info" as const };
});
const restorableRouteNames = new Set(["board", "market", "forum-latest", "forum-hot"]);

watch(() => [props.topic.id, props.topic.viewCount], ([id, viewCount]) => {
  displayedViewCount.value = knownTopicViewCount(Number(id), Number(viewCount) || 0);
  observeImpression();
});

onMounted(observeImpression);

onBeforeUnmount(() => {
  clearImpressionTracking();
});

function clearImpressionTracking() {
  impressionObserver?.disconnect();
  impressionObserver = null;
  if (impressionTimer !== null) {
    clearTimeout(impressionTimer);
    impressionTimer = null;
  }
}

function recordVisibleImpression() {
  impressionTimer = null;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  clearImpressionTracking();
  const topicId = Number(props.topic.id);
  void queueTopicImpression(topicId).then((viewCount) => {
    if (typeof viewCount === "number") {
      displayedViewCount.value = Math.max(displayedViewCount.value, viewCount);
    }
  });
}

function observeImpression() {
  clearImpressionTracking();
  const topicId = Number(props.topic.id);
  if (!Number.isInteger(topicId) || topicId <= 0 || props.topic.hidden || hasTrackedTopicImpression(topicId)) return;
  if (typeof IntersectionObserver === "undefined" || !rowRef.value) {
    recordVisibleImpression();
    return;
  }
  impressionObserver = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry?.isIntersecting && entry.intersectionRatio >= 0.5) {
      if (impressionTimer === null) {
        impressionTimer = setTimeout(recordVisibleImpression, 450);
      }
      return;
    }
    if (impressionTimer !== null) {
      clearTimeout(impressionTimer);
      impressionTimer = null;
    }
  }, { threshold: [0, 0.5] });
  impressionObserver.observe(rowRef.value);
}

function openTopic() {
  const routeName = String(route.name || "");
  const query = restorableRouteNames.has(routeName)
    ? { from: route.fullPath }
    : undefined;
  router.push({
    path: `/forum/topic/${props.topic.id}`,
    query,
  });
}
</script>

<style scoped>
.topic-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  border-radius: 8px;
  min-width: 0;
  overflow: hidden;
  transition: background 0.15s;
}
.topic-row:hover { background: var(--cpu-surface-soft); }
.topic-row:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}

.avatar { background: var(--cpu-primary); color: #fff; font-weight: 600; flex-shrink: 0; }

.main { flex: 1; min-width: 0; }

.line1 { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.tag { flex-shrink: 0; }
.ai-tag { --el-tag-border-color: #fdba74; --el-tag-hover-color: #9a3412; }
.market-kind-tag { font-weight: 600; }
.review-tag { font-weight: 600; }
.title { flex: 1 1 240px; font-size: 15px; color: var(--cpu-text); font-weight: 500; min-width: 0; overflow-wrap: anywhere; }
.title.say-content { font-weight: 400; line-height: 1.55; }

.line2 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font-size: 12px;
  color: var(--cpu-text-secondary);
  margin-top: 6px;
  min-width: 0;
}
.row-byline,
.row-stats {
  display: flex;
  align-items: center;
  min-width: 0;
}
.row-byline { flex: 1; gap: 7px; overflow: hidden; white-space: nowrap; }
.row-stats { flex: 0 0 auto; gap: 12px; white-space: nowrap; }
.row-byline > span,
.row-stats > span { display: inline-flex; align-items: center; gap: 3px; }
.line2 .author {
  min-width: 24px;
  max-width: clamp(96px, 20vw, 220px);
  overflow: hidden;
  color: var(--cpu-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-time { flex: 0 0 auto; }
.vip-badge { color: #a16207; background: linear-gradient(135deg, #fef3c7, #fcd34d); border: 1px solid #f59e0b; border-radius: 999px; padding: 0 5px; font-size: 10px; font-weight: 800; letter-spacing: .04em; }
.line2 .anon { color: #7c3aed; font-weight: 600; }
.line2 .bot { color: #ef4444; }
.line2 .edited { flex: 0 0 auto; color: #b45309; }
.line2 .heat { color: #0f766e; font-weight: 600; }
.meta-separator { color: var(--cpu-border); }

.line1.has-inline-price .title,
.line1.has-ai-tags .title { flex: 0 1 auto; }
.inline-price {
  flex: 0 0 auto;
  color: color-mix(in srgb, #ef4444 82%, var(--cpu-text));
  font-size: 15px;
  line-height: 1.5;
  white-space: nowrap;
}
.rating { flex: 0 0 auto; white-space: nowrap; }

.topic-row--simple {
  align-items: flex-start;
  padding: 13px 8px;
  border-bottom: 1px solid var(--cpu-border-soft);
  border-radius: 0;
}
.topic-row--simple:last-child { border-bottom: 0; }
.simple-main { flex: 1; min-width: 0; }
.simple-heading { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
.simple-heading.has-price .simple-title { flex: 0 1 auto; }
.simple-title {
  display: -webkit-box;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--cpu-text);
  font-size: 15px;
  font-weight: 500;
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.simple-title b { margin-right: 6px; color: #b45309; font-size: 12px; }
.simple-price { flex: 0 0 auto; color: color-mix(in srgb, #ef4444 82%, var(--cpu-text)); font-size: 15px; line-height: 1.5; }
.simple-context {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 5px;
  overflow: hidden;
  color: var(--cpu-text-muted);
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
}
.simple-context span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.simple-context span + span::before { content: "·"; margin-right: 8px; color: var(--cpu-border); }
.simple-board { color: var(--cpu-primary); font-weight: 650; }
.simple-review { color: var(--cpu-warn); }
.simple-footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  margin-top: 5px;
  color: var(--cpu-text-muted);
  font-size: 12px;
}
.simple-byline,
.simple-stats {
  display: flex;
  align-items: center;
  min-width: 0;
  white-space: nowrap;
}
.simple-byline { gap: 7px; overflow: hidden; }
.simple-byline > span + span:not(.simple-edited)::before { content: "·"; margin-right: 7px; color: var(--cpu-border); }
.simple-byline > .vip-badge + .simple-author::before { content: none; }
.simple-author {
  min-width: 24px;
  max-width: clamp(90px, 18vw, 190px);
  overflow: hidden;
  color: var(--cpu-primary);
  font-weight: 600;
  text-overflow: ellipsis;
}
.simple-time,
.simple-edited { flex: 0 0 auto; }
.simple-edited { color: #b45309; }
.simple-edited::before { content: "·"; margin-right: 7px; color: var(--cpu-border); }
.simple-stats { gap: 11px; }
.simple-stats span { display: inline-flex; align-items: center; gap: 3px; }
.simple-stats .heat { color: #0f766e; font-weight: 600; }

.topic-row--card {
  display: block;
  width: 100%;
  margin: 0 0 12px;
  padding: 0;
  break-inside: avoid;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 13px;
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.topic-row--card:hover { background: var(--cpu-card); border-color: color-mix(in srgb, var(--cpu-primary) 36%, var(--cpu-border)); }
.market-card-image { display: block; width: 100%; max-height: 220px; object-fit: cover; background: var(--cpu-surface-subtle); }
.market-card-body { padding: 12px; }
.market-card-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
.market-card-body h3 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.market-card-excerpt {
  display: -webkit-box;
  margin: 6px 0 0;
  overflow: hidden;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.market-card-price { display: block; margin-top: 10px; color: color-mix(in srgb, #ef4444 82%, var(--cpu-text)); font-size: 17px; }
.market-card-meta {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  margin-top: 11px;
  padding-top: 9px;
  border-top: 1px solid var(--cpu-border-soft);
  color: var(--cpu-text-muted);
  font-size: 11px;
}
.market-card-author { flex: 1; min-width: 0; overflow: hidden; color: var(--cpu-primary); text-overflow: ellipsis; white-space: nowrap; }
.market-card-stat { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }

@media (max-width: 640px) {
  .topic-row {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    align-items: flex-start;
    gap: 10px;
    padding: 12px 8px;
  }

  .avatar {
    grid-column: 1;
    width: 32px !important;
    height: 32px !important;
    font-size: 13px;
  }

  .topic-row--card { display: block; padding: 0; }
  .topic-row--card .avatar { width: 26px !important; height: 26px !important; }
  .market-card-image { max-height: 180px; }
  .market-card-body { padding: 10px; }
  .market-card-meta { gap: 5px; }

  .main { grid-column: 2; }

  .topic-row--simple {
    grid-template-columns: 32px minmax(0, 1fr);
    align-items: flex-start;
    padding: 12px 6px;
  }

  .topic-row--simple .simple-main { grid-column: 2; }
  .topic-row--simple .simple-title { font-size: 14px; line-height: 1.45; }
  .topic-row--simple .simple-price { font-size: 14px; }
  .topic-row--simple .simple-context {
    flex-wrap: wrap;
    overflow: visible;
    white-space: normal;
  }
  .topic-row--simple .simple-footer {
    grid-template-columns: minmax(0, 1fr);
    gap: 5px;
  }
  .topic-row--simple .simple-author { max-width: min(42vw, 150px); }
  .topic-row--simple .simple-stats { gap: 13px; }

  .line1 {
    gap: 5px;
  }

  .title {
    width: 100%;
    font-size: 14px;
    line-height: 1.45;
  }

  .line1.has-inline-price .title {
    width: auto;
    max-width: calc(100% - 66px);
  }

  .inline-price { font-size: 14px; }

  .line2 {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 5px;
    line-height: 1.45;
  }
  .row-byline { gap: 6px; }
  .line2 .author { max-width: min(42vw, 160px); }
  .row-stats { gap: 13px; }
  .line2 .edited { font-size: 11px; }

  .rating {
    grid-column: 2;
    margin-left: 0;
    align-self: flex-start;
    font-size: 15px;
  }
}
</style>
