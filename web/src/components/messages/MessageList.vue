<template>
  <div class="message-list">
    <el-empty v-if="!list.length" description="暂无消息" class="empty-state" />
    <button
      v-for="n in list"
      :key="n.id"
      type="button"
      class="row"
      :class="{ unread: !n.readAt }"
      @click="onClick(n)"
    >
      <div class="info">
        <div class="top-line">
          <div class="tags">
            <span class="tag" :class="[`tag-${n.category}`, `lv-${n.level}`]">{{ categoryLabel(n.category) }}</span>
            <span v-if="platformTag(n.targetClient)" class="tag tag-target" :class="`tag-target-${n.targetClient}`">
              {{ platformTag(n.targetClient) }}
            </span>
            <span v-if="n.level === 'strong'" class="tag tag-strong">强提醒</span>
          </div>
          <span class="time">{{ fmtRelative(n.createdAt) }}</span>
        </div>
        <div class="title">{{ n.title }}</div>
        <div class="content">{{ n.content }}</div>
        <div class="meta">{{ n.source || "校内" }}<span v-if="n.link"> · 点按查看</span></div>
      </div>
      <el-icon class="arrow"><ArrowRight /></el-icon>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ArrowRight } from "@element-plus/icons-vue";
import { fmtRelative } from "@/utils/format";

const emit = defineEmits<{ (e: "read", id: number): void; (e: "open", item: any): void }>();
defineProps<{ list: any[] }>();

function onClick(n: any) {
  if (!n.readAt) emit("read", n.id);
  emit("open", n);
}

function platformTag(targetClient?: string | null) {
  if (targetClient === "ios") return "iOS";
  if (targetClient === "android") return "安卓";
  if (targetClient === "harmony") return "鸿蒙";
  return "";
}

function categoryLabel(category?: string | null) {
  if (category === "reply") return "回复";
  if (category === "like") return "点赞";
  if (category === "system") return "系统";
  if (category === "school") return "公告";
  return category || "消息";
}
</script>

<style scoped>
.message-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.empty-state {
  padding: 18px 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid #edf2f7;
  background: #fff;
  cursor: pointer;
  border-radius: 14px;
  appearance: none;
  color: inherit;
  font: inherit;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.row:hover {
  background: #f8fafc;
  border-color: #dbe5f0;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
}
.row.unread {
  border-color: #cfe0ff;
  background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
}
.row:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}

.tag {
  min-width: 46px;
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  border-radius: 999px;
  text-align: center;
  line-height: 24px;
  flex-shrink: 0;
}
.tag-target {
  min-width: 0;
}
.tag-reply { background: #dbeafe; color: #1d4ed8; }
.tag-like { background: #fee2e2; color: #dc2626; }
.tag-system { background: #ede9fe; color: #6d28d9; }
.tag-school { background: #dcfce7; color: #15803d; }
.tag-事务 { background: #fee2e2; color: #dc2626; }
.tag-通知 { background: #dbeafe; color: #1d4ed8; }
.tag-服务 { background: #dcfce7; color: #15803d; }
.tag-资讯 { background: #f3e8ff; color: #7c3aed; }
.tag-strong {
  background: #fff7ed;
  color: #c2410c;
}
.lv-strong { box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.18); }
.tag-target-ios { background: #e0e7ff; color: #4338ca; }
.tag-target-android { background: #dcfce7; color: #15803d; }
.tag-target-harmony { background: #fef3c7; color: #92400e; }

.info { flex: 1; min-width: 0; }
.top-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.tags {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}
.time {
  flex-shrink: 0;
  color: #94a3b8;
  font-size: 11px;
}
.title {
  margin-top: 8px;
  font-size: 14px;
  color: #1f2937;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.unread .title { font-weight: 600; }
.unread .title::after {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ef4444;
  margin-left: 6px;
}
.content {
  font-size: 12px;
  color: #6b7280;
  margin-top: 4px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.meta { font-size: 11px; color: #94a3b8; margin-top: 6px; overflow-wrap: anywhere; }
.arrow {
  color: #cbd5e1;
  flex-shrink: 0;
  font-size: 16px;
}

@media (max-width: 640px) {
  .row {
    align-items: flex-start;
    gap: 10px;
    padding: 14px 14px 15px;
    border-radius: 12px;
  }

  .content {
    -webkit-line-clamp: 3;
    line-height: 1.5;
  }

  .arrow {
    margin-top: 30px;
  }

  .top-line {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .time {
    font-size: 12px;
  }
}

@media (max-width: 420px) {
  .row {
    padding: 13px 12px 14px;
  }

  .tag {
    min-width: 0;
  }

  .title {
    margin-top: 6px;
  }

  .arrow {
    margin-top: 28px;
  }
}
</style>
