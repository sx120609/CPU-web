<template>
  <div>
    <el-empty v-if="!list.length" description="暂无消息" />
    <div
      v-for="n in list"
      :key="n.id"
      class="row"
      :class="{ unread: !n.readAt }"
      @click="onClick(n)"
    >
      <span class="tag" :class="[`tag-${n.category}`, `lv-${n.level}`]">{{ n.category }}</span>
      <div class="info">
        <div class="title">{{ n.title }}</div>
        <div class="content">{{ n.content }}</div>
        <div class="meta">{{ n.source || "校内" }} · {{ fmtRelative(n.createdAt) }}</div>
      </div>
      <el-icon class="arrow"><ArrowRight /></el-icon>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowRight } from "@element-plus/icons-vue";
import { useRouter } from "vue-router";
import { fmtRelative } from "@/utils/format";

const emit = defineEmits<{ (e: "read", id: number): void }>();
const router = useRouter();
defineProps<{ list: any[] }>();

function onClick(n: any) {
  if (!n.readAt) emit("read", n.id);
  if (n.link) router.push(n.link);
}
</script>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 6px;
  border-bottom: 1px dashed #f1f5f9;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s;
}
.row:hover { background: #f8fafc; }
.row:last-child { border-bottom: none; }

.tag {
  width: 50px;
  height: 22px;
  font-size: 11px;
  border-radius: 4px;
  text-align: center;
  line-height: 22px;
  flex-shrink: 0;
}
.tag-事务 { background: #fee2e2; color: #dc2626; }
.tag-通知 { background: #dbeafe; color: #1d4ed8; }
.tag-服务 { background: #dcfce7; color: #15803d; }
.tag-资讯 { background: #f3e8ff; color: #7c3aed; }
.lv-strong { box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.18); }

.info { flex: 1; min-width: 0; }
.title { font-size: 14px; color: #1f2937; }
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
  margin-top: 2px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}
.meta { font-size: 11px; color: #94a3b8; margin-top: 2px; }
.arrow { color: #cbd5e1; }

@media (max-width: 640px) {
  .row {
    align-items: flex-start;
    gap: 10px;
    padding: 12px 2px;
  }

  .tag {
    width: auto;
    min-width: 44px;
    padding: 0 7px;
  }

  .content {
    -webkit-line-clamp: 2;
    line-height: 1.5;
  }

  .arrow {
    margin-top: 3px;
  }
}
</style>
