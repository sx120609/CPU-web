<template>
  <div class="search-page">
    <div class="head">
      <h2>搜索 "{{ q }}"</h2>
      <div class="counts" v-if="result">
        共找到 {{ result.topics.length + result.courses.length + result.services.length }} 条结果
      </div>
    </div>

    <div v-if="!q" class="cpu-card empty"><el-empty description="请输入搜索关键词" /></div>

    <template v-else-if="result">
      <section v-if="result.topics.length" class="cpu-card">
        <h3 class="title">💬 帖子（{{ result.topics.length }}）</h3>
        <TopicListItem v-for="t in result.topics" :key="t.id" :topic="t" />
      </section>

      <section v-if="result.courses.length" class="cpu-card">
        <h3 class="title">📚 课程（{{ result.courses.length }}）</h3>
        <div v-for="c in result.courses" :key="c.id" class="course-row" @click="$router.push(`/coursereview/${c.id}`)">
          <div>
            <div class="c-name">{{ c.code }} · {{ c.name }}</div>
            <div class="c-meta">{{ c.teachers?.length ? c.teachers.map((t: any) => t.name).join("、") : (c.teacher || "—") }} · {{ c.ratingCount }} 评价</div>
          </div>
          <el-icon><Right /></el-icon>
        </div>
      </section>

      <section v-if="result.services.length" class="cpu-card">
        <h3 class="title">🧭 服务（{{ result.services.length }}）</h3>
        <div v-for="s in result.services" :key="s.id" class="svc-row" @click="open(s)">
          <span class="icon">{{ s.icon || "🔗" }}</span>
          <div>
            <div class="s-name">{{ s.name }}</div>
            <div class="s-desc">{{ s.owner }} · {{ s.description }}</div>
          </div>
          <el-icon><Right /></el-icon>
        </div>
      </section>

      <div v-if="!hasResult" class="cpu-card empty">
        <el-empty description="什么也没找到。换个关键词试试？" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useRoute } from "vue-router";
import { Right } from "@element-plus/icons-vue";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import { searchApi, type SearchResult } from "@/api/search";

const route = useRoute();
const q = ref((route.query.q as string) ?? "");
const result = ref<SearchResult | null>(null);

const hasResult = computed(() =>
  result.value && (result.value.topics.length + result.value.courses.length + result.value.services.length) > 0
);

watch(() => route.query.q, async (v) => {
  q.value = (v as string) ?? "";
  await reload();
});

onMounted(reload);

async function reload() {
  if (!q.value) { result.value = null; return; }
  result.value = await searchApi.search(q.value);
}

function open(s: any) {
  if (s.url.startsWith("tel:")) window.location.href = s.url;
  else window.open(s.url, "_blank", "noopener");
}
</script>

<style scoped>
.search-page { display: flex; flex-direction: column; gap: 16px; }
.head h2 { margin: 0; font-size: 20px; }
.counts { font-size: 12px; color: #9ca3af; margin-top: 4px; }
.cpu-card { background: #fff; border-radius: 12px; padding: 16px 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
.title { margin: 0 0 10px; font-size: 15px; }

.course-row, .svc-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  cursor: pointer;
  border-radius: 6px;
  border-bottom: 1px dashed #f1f5f9;
}
.course-row:last-child, .svc-row:last-child { border-bottom: none; }
.course-row:hover, .svc-row:hover { background: #f4f6f8; }
.course-row > div, .svc-row > div { flex: 1; min-width: 0; }
.c-name, .s-name { font-size: 14px; color: #1f2937; }
.c-meta, .s-desc { font-size: 12px; color: #6b7280; margin-top: 2px; }
.icon { font-size: 20px; }

.empty { text-align: center; }

@media (max-width: 640px) {
  .head h2 {
    font-size: 18px;
    line-height: 1.4;
    word-break: break-word;
  }

  .cpu-card {
    border-radius: 10px;
    padding: 14px 12px;
  }

  .course-row,
  .svc-row {
    align-items: flex-start;
    gap: 10px;
    padding: 12px 2px;
  }

  .c-meta,
  .s-desc {
    line-height: 1.5;
  }
}
</style>
