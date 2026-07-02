<template>
  <div class="search-page" v-loading="loading">
    <div class="head">
      <h2>搜索 "{{ q }}"</h2>
      <div class="counts" v-if="result">
        共找到 {{ result.topics.length + result.courses.length + result.services.length }} 条结果
      </div>
    </div>

    <div v-if="!q" class="cpu-card empty"><el-empty description="请输入搜索关键词" /></div>
    <div v-else-if="error && !loading" class="cpu-card empty">
      <el-empty :description="error">
        <el-button type="primary" @click="reload">重试</el-button>
      </el-empty>
    </div>

    <template v-else-if="result">
      <section v-if="result.topics.length" class="cpu-card">
        <h3 class="title">💬 帖子（{{ result.topics.length }}）</h3>
        <TopicListItem v-for="t in result.topics" :key="t.id" :topic="t" />
      </section>

      <section v-if="result.courses.length" class="cpu-card">
        <h3 class="title">📚 课程（{{ result.courses.length }}）</h3>
        <div
          v-for="c in result.courses"
          :key="c.id"
          class="course-row"
          role="button"
          tabindex="0"
          @click="openCourse(c.id)"
          @keydown.enter.prevent="openCourse(c.id)"
          @keydown.space.prevent="openCourse(c.id)"
        >
          <div>
            <div class="c-name">{{ c.code }} · {{ c.name }}</div>
            <div class="c-meta">{{ c.teachers?.length ? c.teachers.map((t: any) => t.name).join("、") : (c.teacher || "—") }} · {{ c.ratingCount }} 评价</div>
          </div>
          <el-icon><Right /></el-icon>
        </div>
      </section>

      <section v-if="result.services.length" class="cpu-card">
        <h3 class="title">🧭 服务（{{ result.services.length }}）</h3>
        <div
          v-for="s in result.services"
          :key="s.id"
          class="svc-row"
          role="button"
          tabindex="0"
          @click="open(s)"
          @keydown.enter.prevent="open(s)"
          @keydown.space.prevent="open(s)"
        >
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
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Right } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import { searchApi, type SearchResult } from "@/api/search";

const route = useRoute();
const router = useRouter();
const q = ref((route.query.q as string) ?? "");
const result = ref<SearchResult | null>(null);
const loading = ref(false);
const error = ref("");
let searchSeq = 0;

const hasResult = computed(() =>
  result.value && (result.value.topics.length + result.value.courses.length + result.value.services.length) > 0
);

watch(() => route.query.q, async (v) => {
  q.value = (v as string) ?? "";
  await reload();
}, { immediate: true });

async function reload() {
  const keyword = q.value.trim();
  if (!keyword) {
    searchSeq += 1;
    result.value = null;
    error.value = "";
    loading.value = false;
    return;
  }
  const seq = ++searchSeq;
  loading.value = true;
  error.value = "";
  try {
    const next = await searchApi.search(keyword, { suppressErrorMessage: true });
    if (seq === searchSeq) result.value = next;
  } catch (searchError) {
    if (seq === searchSeq) {
      result.value = null;
      error.value = normalizeSearchError(searchError);
    }
  } finally {
    if (seq === searchSeq) loading.value = false;
  }
}

function normalizeSearchError(searchError: unknown) {
  const status = (searchError as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (searchError as { response?: { data?: { message?: string } } })?.response?.data?.message || "搜索失败";
  }
  return "搜索失败，请稍后再试";
}

function open(s: any) {
  const url = typeof s?.url === "string" ? s.url.trim() : "";
  if (!url) {
    ElMessage.warning("该服务暂未配置链接");
    return;
  }
  if (url.startsWith("/")) {
    router.push(url);
    return;
  }
  if (url.startsWith("tel:") || url.startsWith("mailto:")) {
    window.location.href = url;
    return;
  }
  if (/^https?:\/\//i.test(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  ElMessage.warning("该服务链接格式暂不支持");
}

function openCourse(id: number) {
  router.push(`/coursereview/${id}`);
}
</script>

<style scoped>
.search-page { display: flex; flex-direction: column; gap: 16px; }
.head h2 { margin: 0; font-size: 20px; }
.counts { font-size: 12px; color: var(--cpu-text-muted); margin-top: 4px; }
.cpu-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
  color: var(--cpu-text);
}
.title { margin: 0 0 10px; font-size: 15px; }

.course-row, .svc-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  cursor: pointer;
  border-radius: 6px;
  border-bottom: 1px dashed var(--cpu-border-soft);
  min-width: 0;
  overflow: hidden;
}
.course-row:last-child, .svc-row:last-child { border-bottom: none; }
.course-row:hover, .svc-row:hover { background: var(--cpu-surface-subtle); }
.course-row:focus-visible, .svc-row:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}
.course-row > div, .svc-row > div { flex: 1; min-width: 0; }
.course-row > .el-icon, .svc-row > .el-icon { flex: 0 0 auto; }
.c-name, .s-name { font-size: 14px; color: var(--cpu-text); overflow-wrap: anywhere; }
.c-meta, .s-desc { font-size: 12px; color: var(--cpu-text-secondary); margin-top: 2px; overflow-wrap: anywhere; }
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
