<template>
  <div class="site-search-page">
    <header class="search-head">
      <div>
        <h1>站内搜索</h1>
        <p>按关键词查找帖子、课程与校园服务，不消耗 AI 额度。</p>
      </div>
      <form class="search-form" role="search" @submit.prevent="submitSearch">
        <el-input
          v-model="searchInput"
          clearable
          maxlength="100"
          aria-label="搜索站内内容"
          placeholder="输入帖子标题、正文、课程或服务关键词"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button native-type="submit" type="primary" :disabled="!searchInput.trim()">搜索</el-button>
      </form>
    </header>

    <div v-if="!query" class="cpu-card empty-state">
      <el-empty description="输入关键词开始搜索" />
    </div>

    <div v-else-if="error && !loading" class="cpu-card empty-state">
      <el-empty :description="error">
        <el-button type="primary" @click="reload">重试</el-button>
      </el-empty>
    </div>

    <template v-else>
      <div class="result-summary" aria-live="polite">
        <span v-if="loading">正在搜索“{{ query }}”…</span>
        <span v-else-if="result">“{{ query }}”共找到 {{ resultCount }} 条结果</span>
      </div>

      <section v-if="result?.topics.length" class="cpu-card result-block">
        <div class="result-head">
          <div>
            <h2>帖子</h2>
            <span>标题与正文匹配</span>
          </div>
          <strong>{{ result.topics.length }}</strong>
        </div>
        <TopicListItem v-for="topic in result.topics" :key="topic.id" :topic="topic" variant="simple" />
      </section>

      <section v-if="result?.courses.length" class="cpu-card result-block">
        <div class="result-head">
          <div>
            <h2>课程</h2>
            <span>课程名、代码或教师</span>
          </div>
          <strong>{{ result.courses.length }}</strong>
        </div>
        <button
          v-for="course in result.courses"
          :key="course.id"
          type="button"
          class="result-row"
          @click="openCourse(course.id)"
        >
          <span class="result-icon">📚</span>
          <span class="result-copy">
            <b>{{ [course.code, course.name].filter(Boolean).join(" · ") }}</b>
            <small>{{ courseTeacherNames(course) }}</small>
          </span>
          <el-icon><Right /></el-icon>
        </button>
      </section>

      <section v-if="result?.services.length" class="cpu-card result-block">
        <div class="result-head">
          <div>
            <h2>校园服务</h2>
            <span>服务名称、说明与负责单位</span>
          </div>
          <strong>{{ result.services.length }}</strong>
        </div>
        <button
          v-for="service in result.services"
          :key="service.id || service.url"
          type="button"
          class="result-row"
          @click="openService(service)"
        >
          <span class="result-icon">{{ service.icon || "🔗" }}</span>
          <span class="result-copy">
            <b>{{ service.name }}</b>
            <small>{{ [service.owner, service.description].filter(Boolean).join(" · ") }}</small>
          </span>
          <el-icon><Right /></el-icon>
        </button>
      </section>

      <div v-if="result && !resultCount && !loading" class="cpu-card empty-state">
        <el-empty description="没有找到相关内容，换个关键词试试" />
      </div>

      <div v-if="loading && !result" class="cpu-card loading-state" v-loading="true" aria-label="正在搜索"></div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Right, Search } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import { searchApi, type SearchResult } from "@/api/search";

const route = useRoute();
const router = useRouter();
const searchInput = ref("");
const result = ref<SearchResult | null>(null);
const loading = ref(false);
const error = ref("");
let searchSeq = 0;

const query = computed(() => String(route.query.q ?? "").trim().slice(0, 100));
const resultCount = computed(() => {
  if (!result.value) return 0;
  return result.value.topics.length + result.value.courses.length + result.value.services.length;
});

watch(query, async (keyword) => {
  searchInput.value = keyword;
  await reload();
}, { immediate: true });

async function submitSearch() {
  const keyword = searchInput.value.trim().slice(0, 100);
  if (!keyword) return;
  if (keyword === query.value) {
    await reload();
    return;
  }
  await router.push({ name: "site-search", query: { q: keyword } });
}

async function reload() {
  const keyword = query.value;
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

function courseTeacherNames(course: any) {
  const teachers = Array.isArray(course.teachers)
    ? course.teachers.map((teacher: any) => teacher?.name).filter(Boolean)
    : [];
  return teachers.join("、") || course.teacher || "暂未提供教师信息";
}

function openCourse(id: number) {
  router.push(`/coursereview/${id}`);
}

function openService(service: any) {
  const url = typeof service?.url === "string" ? service.url.trim() : "";
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

function normalizeSearchError(searchError: unknown) {
  const response = (searchError as { response?: { status?: number; data?: { message?: string } } })?.response;
  if (response?.status && response.status < 500) return response.data?.message || "搜索失败";
  return "搜索失败，请稍后再试";
}
</script>

<style scoped>
.site-search-page { display: flex; flex-direction: column; gap: 16px; }
.search-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 520px);
  align-items: end;
  gap: 24px;
}
.search-head h1 { margin: 0; color: var(--cpu-text); font-size: 22px; }
.search-head p { margin: 6px 0 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.6; }
.search-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.result-summary { min-height: 20px; color: var(--cpu-text-secondary); font-size: 13px; }
.cpu-card {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.result-block { padding: 14px 18px; }
.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 2px 8px 10px;
  border-bottom: 1px solid var(--cpu-border-soft);
}
.result-head h2 { margin: 0; color: var(--cpu-text); font-size: 16px; }
.result-head span { display: block; margin-top: 3px; color: var(--cpu-text-muted); font-size: 11px; }
.result-head strong { color: var(--cpu-primary); font-size: 18px; }
.result-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 13px 8px;
  border: 0;
  border-bottom: 1px solid var(--cpu-border-soft);
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.result-row:last-child { border-bottom: 0; }
.result-row:hover { background: var(--cpu-surface-subtle); }
.result-row:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -2px; }
.result-icon { flex: 0 0 auto; font-size: 22px; }
.result-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.result-copy b { overflow: hidden; color: var(--cpu-text); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.result-copy small { overflow: hidden; color: var(--cpu-text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.result-row > .el-icon { flex: 0 0 auto; color: var(--cpu-text-muted); }
.empty-state { padding: 24px 16px; }
.loading-state { min-height: 180px; }

@media (max-width: 768px) {
  .search-head { grid-template-columns: 1fr; gap: 14px; }
  .search-head h1 { font-size: 20px; }
  .search-form { grid-template-columns: minmax(0, 1fr) auto; }
  .result-block { padding: 12px 10px; }
  .result-head { padding-inline: 6px; }
  .result-row { align-items: flex-start; padding: 13px 6px; }
  .result-copy b,
  .result-copy small { white-space: normal; overflow-wrap: anywhere; }
}
</style>
