<template>
  <div class="topic-row" @click="$router.push(`/forum/topic/${topic.id}`)">
    <UserAvatar :size="36" class="avatar" :src="topic.author?.avatar" :name="topic.author?.nickname" alt="作者头像" />
    <div class="main">
      <div class="line1">
        <el-tag v-if="topic.pinned" size="small" type="danger" effect="plain" class="tag">置顶</el-tag>
        <el-tag v-if="topic.board" size="small" :style="{ background: topic.board.color || '#168776', color: '#fff', border: 'none' }" class="tag">
          {{ topic.board.name }}
        </el-tag>
        <span class="title">{{ topic.title }}</span>
        <el-tag v-if="topic.locked" size="small" type="info" class="tag">🔒</el-tag>
        <el-tag v-if="metaSolved" size="small" type="success" class="tag">已解决</el-tag>
        <el-tag v-if="metaBounty" size="small" type="warning" class="tag">悬赏 {{ metaBounty }}</el-tag>
      </div>
      <div class="line2">
        <span class="author">{{ topic.author?.nickname ?? "—" }}</span>
        <span v-if="topic.author?.role === 'bot'" class="bot">🤖 自动同步</span>
        <span class="dot">·</span>
        <span>{{ fmtRelative(topic.lastReplyAt || topic.createdAt) }}</span>
        <span v-if="topic.editCount && topic.editCount > 0" class="edited">已编辑 {{ topic.editCount }} 次</span>
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
import { View, ChatLineRound, Star } from "@element-plus/icons-vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { fmtRelative } from "@/utils/format";

const props = defineProps<{ topic: any }>();
const metaPrice = computed(() => props.topic.metadata?.price);
const metaSolved = computed(() => props.topic.metadata?.resolved === true);
const metaBounty = computed(() => props.topic.metadata?.bounty ? props.topic.metadata.bounty : 0);
const metaRating = computed(() => {
  const r = props.topic.metadata?.ratings?.recommend;
  return typeof r === "number" ? r : 0;
});
</script>

<style scoped>
.topic-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s;
}
.topic-row:hover { background: #f4f6f8; }

.avatar { background: var(--cpu-primary); color: #fff; font-weight: 600; flex-shrink: 0; }

.main { flex: 1; min-width: 0; }

.line1 { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tag { flex-shrink: 0; }
.title { font-size: 15px; color: #1f2937; font-weight: 500; }

.line2 {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #6b7280;
  margin-top: 4px;
}
.line2 span { display: inline-flex; align-items: center; gap: 3px; }
.line2 .author { color: var(--cpu-primary); }
.line2 .bot { color: #ef4444; }
.line2 .edited { color: #b45309; }
.line2 .dot { color: #d1d5db; }

.price {
  font-size: 16px;
  font-weight: 700;
  color: #ef4444;
  white-space: nowrap;
  margin-left: 8px;
}
.rating { white-space: nowrap; }

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
