<template>
  <div
    class="topic-row"
    role="button"
    tabindex="0"
    @click="openTopic"
    @keydown.enter.prevent="openTopic"
    @keydown.space.prevent="openTopic"
  >
    <UserAvatar :size="36" class="avatar" :src="topic.author?.avatar" :name="topic.author?.nickname" :profile-frame="topic.author?.profileFrame" alt="作者头像" />
    <div class="main">
      <div class="line1">
        <el-tag v-if="topic.globalPinned" size="small" type="warning" effect="dark" class="tag">全局置顶</el-tag>
        <el-tag v-if="topic.pinned" size="small" type="danger" effect="plain" class="tag">板块置顶</el-tag>
        <el-tag v-if="topic.board" size="small" :style="{ background: topic.board.color || '#168776', color: '#fff', border: 'none' }" class="tag">
          {{ boardDisplayName }}
        </el-tag>
        <el-tag v-if="reviewState" size="small" :type="reviewState.type" effect="plain" class="tag review-tag">
          {{ reviewState.label }}
        </el-tag>
        <span class="title">{{ topic.title }}</span>
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
        <span v-if="topic.author?.vipActive" class="vip-badge" title="VIP 用户">VIP</span>
        <span class="author">{{ topic.author?.nickname ?? "—" }}</span>
        <span v-if="topic.isAnonymous" class="anon">匿名</span>
        <span v-if="topic.author?.role === 'bot'" class="bot">🤖 公告同步</span>
        <span class="dot">·</span>
        <span>{{ fmtRelative(topic.lastReplyAt || topic.createdAt) }}</span>
        <span v-if="topic.editCount && topic.editCount > 0" class="edited">已编辑 {{ topic.editCount }} 次</span>
        <span class="dot">·</span>
        <span class="heat">热度 {{ hotScore }}</span>
        <span class="dot">·</span>
        <span><el-icon><View /></el-icon> {{ topic.viewCount }}</span>
        <span><el-icon><ChatLineRound /></el-icon> {{ topic.replyCount }}</span>
        <span><el-icon><Star /></el-icon> {{ topic.likeCount }}</span>
      </div>
    </div>
    <!-- 价格/评分等板块特化的右侧小标 -->
    <div v-if="metaPrice !== undefined" class="price">¥{{ metaPrice }}</div>
    <div v-else-if="metaRating" class="rating">
      <el-rate :model-value="metaRating" disabled size="small" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { View, ChatLineRound, Star } from "@element-plus/icons-vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { fmtRelative } from "@/utils/format";

const props = defineProps<{ topic: any }>();
const route = useRoute();
const router = useRouter();
const metaPrice = computed(() => props.topic.metadata?.price);
const metaSolved = computed(() => props.topic.metadata?.resolved === true);
const metaBounty = computed(() => props.topic.metadata?.bounty ? props.topic.metadata.bounty : 0);
const boardDisplayName = computed(() => props.topic.board?.name || "");
const metaRating = computed(() => {
  const r = props.topic.metadata?.ratings?.recommend;
  return typeof r === "number" ? r : 0;
});
const hotScore = computed(() => Math.round((props.topic.likeCount ?? 0) * 5 + (props.topic.replyCount ?? 0) * 3 + (props.topic.viewCount ?? 0) * 0.03));
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
const restorableRouteNames = new Set(["board", "forum-latest", "forum-hot"]);

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
.review-tag { font-weight: 600; }
.title { flex: 1 1 240px; font-size: 15px; color: var(--cpu-text); font-weight: 500; min-width: 0; overflow-wrap: anywhere; }

.line2 {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--cpu-text-secondary);
  margin-top: 4px;
  min-width: 0;
}
.line3 {
  margin-top: 6px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--cpu-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.line2 span { display: inline-flex; align-items: center; gap: 3px; min-width: 0; overflow-wrap: anywhere; }
.line2 .author { color: var(--cpu-primary); }
.vip-badge { color: #a16207; background: linear-gradient(135deg, #fef3c7, #fcd34d); border: 1px solid #f59e0b; border-radius: 999px; padding: 0 5px; font-size: 10px; font-weight: 800; letter-spacing: .04em; }
.line2 .anon { color: #7c3aed; font-weight: 600; }
.line2 .bot { color: #ef4444; }
.line2 .edited { color: #b45309; }
.line2 .heat { color: #0f766e; font-weight: 600; }
.line2 .dot { color: var(--cpu-border); }

.price {
  flex: 0 0 auto;
  font-size: 16px;
  font-weight: 700;
  color: #ef4444;
  white-space: nowrap;
  margin-left: 8px;
}
.rating { flex: 0 0 auto; white-space: nowrap; }

@media (max-width: 640px) {
  .topic-row {
    align-items: flex-start;
    gap: 10px;
    padding: 12px 8px;
  }

  .avatar {
    width: 32px !important;
    height: 32px !important;
    font-size: 13px;
  }

  .line1 {
    gap: 5px;
  }

  .title {
    width: 100%;
    font-size: 14px;
    line-height: 1.45;
  }

  .line2 {
    gap: 7px;
    flex-wrap: wrap;
    line-height: 1.5;
  }

  .price,
  .rating {
    margin-left: 0;
    align-self: flex-start;
    font-size: 15px;
  }
}
</style>
