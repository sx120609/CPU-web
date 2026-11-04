<template>
  <div class="crd">
    <div v-if="error && !detail" class="crd-card crd-state">
      <p>{{ error }}</p>
      <el-button @click="reload">重试</el-button>
    </div>
    <div v-else-if="!detail" class="crd-card crd-state">正在加载课程…</div>

    <template v-else>
      <RouterLink class="crd-back" to="/coursereview"><el-icon><ArrowLeft /></el-icon> 课程点评</RouterLink>

      <section class="crd-card crd-head">
        <div class="crd-head-main">
          <div class="crd-meta">{{ courseMetaLine(course!, true) }}</div>
          <h1>{{ course!.name }}</h1>
          <p v-if="detail.mine" class="crd-mine">
            {{ mineLine }}
          </p>
        </div>
        <div class="crd-head-action">
          <el-button v-if="detail.myReview" @click="editMine">
            {{ detail.myReview.pending ? "我的点评审核中 · 修改" : "修改我的点评" }}
          </el-button>
          <el-button v-else-if="auth.canAccessForum" type="primary" @click="goWrite">
            <el-icon><EditPen /></el-icon> 写点评
          </el-button>
        </div>
      </section>

      <section class="crd-card crd-summary">
        <template v-if="course!.stats.count">
          <div class="crd-overall">
            <div class="crd-overall-score">{{ scoreText(course!.stats.recommend) }}</div>
            <div class="crd-overall-label">推荐度 · {{ course!.stats.count }} 篇点评</div>
            <div class="crd-dist">
              <div v-for="level in [5, 4, 3, 2, 1]" :key="level" class="crd-dist-row">
                <span>{{ level }}</span>
                <div class="crd-dist-track"><i :style="{ width: distWidth(level) }" /></div>
                <span class="crd-dist-count">{{ detail.distribution[level - 1] }}</span>
              </div>
            </div>
          </div>
          <div class="crd-metrics">
            <div v-for="field in metricFields" :key="field.key" class="crd-metric">
              <span class="crd-metric-label">{{ field.label }}</span>
              <b>{{ scoreText(statValue(course!.stats, field.key)) }}</b>
              <span class="crd-metric-word">{{ ratingWord(field.key, statValue(course!.stats, field.key)) }}</span>
            </div>
          </div>
        </template>
        <div v-else class="crd-empty-summary">
          <b>还没有人评价这门课</b>
          <p>上过这门课的话，写几句上课方式、作业考试和给分情况，帮后面的同学选课。</p>
        </div>
      </section>

      <section class="crd-card">
        <div class="crd-section-head">
          <h3>授课老师</h3>
          <button v-if="auth.canAccessForum" data-cpu-button="text" type="button" :disabled="addingTeacher" @click="onAddTeacher">添加老师</button>
        </div>
        <div v-if="!teachers.length" class="crd-muted">暂无老师信息。导入课程或写点评时填上老师就会出现在这里。</div>
        <div v-else class="crd-teachers">
          <button
            type="button"
            class="crd-teacher"
            :class="{ active: !teacherFilter }"
            @click="setTeacherFilter(0)"
          >
            <span class="crd-teacher-name">全部老师</span>
            <span class="crd-teacher-stats">{{ course!.stats.count }} 篇</span>
          </button>
          <button
            v-for="t in teachers"
            :key="t.courseTeacherId"
            type="button"
            class="crd-teacher"
            :class="{ active: teacherFilter === t.courseTeacherId }"
            @click="setTeacherFilter(t.courseTeacherId)"
          >
            <span class="crd-teacher-name">{{ t.name }}<em v-if="detail.mine?.teacherNames.includes(t.name)">我的老师</em></span>
            <span class="crd-teacher-stats">
              <template v-if="t.stats.count">推荐 {{ scoreText(t.stats.recommend) }} · 给分{{ ratingWord("givingScore", t.stats.grading) }} · {{ t.stats.count }} 篇</template>
              <template v-else>暂无点评</template>
            </span>
          </button>
        </div>
      </section>

      <section class="crd-card crd-reviews">
        <div class="crd-section-head">
          <h3>点评 <span class="crd-muted">{{ reviewTotal }}</span></h3>
          <div class="crd-sort">
            <button type="button" :class="{ active: reviewSort === 'new' }" @click="setReviewSort('new')">最新</button>
            <button type="button" :class="{ active: reviewSort === 'hot' }" @click="setReviewSort('hot')">最有用</button>
          </div>
        </div>
        <div v-if="reviewsLoading && !reviews.length" class="crd-muted crd-pad">正在加载点评…</div>
        <div v-else-if="!reviews.length" class="crd-muted crd-pad">{{ teacherFilter ? "这位老师还没有点评。" : "还没有点评。" }}</div>
        <article v-for="item in reviews" :key="item.topic.id" class="crd-review">
          <header class="crd-review-head">
            <UserAvatar
              :size="28"
              :src="item.topic.author?.avatar"
              :name="item.topic.author?.nickname"
              :seed="item.topic.author?.id ?? item.topic.anonymousAlias ?? item.topic.id"
              alt="作者头像"
            />
            <div class="crd-review-who">
              <span class="crd-review-name">{{ item.topic.author?.nickname ?? "同学" }}</span>
              <span class="crd-review-sub">
                {{ [item.rating.teacherName, item.rating.semester, fmtRelative(item.topic.createdAt)].filter(Boolean).join(" · ") }}
              </span>
            </div>
            <span v-if="item.topic.hidden" class="crd-pending">仅自己可见 · 审核中</span>
          </header>
          <div class="crd-review-rates">
            <span v-for="field in metricFields" :key="field.key" :data-level="item.rating[field.key]">
              {{ field.label }} <b>{{ ratingWord(field.key, item.rating[field.key]) }}</b>
            </span>
          </div>
          <h4 class="crd-review-title">{{ item.topic.title }}</h4>
          <div class="crd-review-body" :class="{ collapsed: !expanded.has(item.topic.id) && isLong(item) }">
            <MarkdownView :content="item.topic.content" />
          </div>
          <footer class="crd-review-foot">
            <button v-if="isLong(item)" data-cpu-button="text" type="button" @click="toggleExpanded(item.topic.id)">
              {{ expanded.has(item.topic.id) ? "收起" : "展开全文" }}
            </button>
            <RouterLink :to="`/forum/topic/${item.topic.id}`" class="crd-review-link">
              <span>赞 {{ item.topic.likeCount }}</span>
              <span>回复 {{ item.topic.replyCount }}</span>
              <span>查看讨论</span>
            </RouterLink>
          </footer>
        </article>
        <div v-if="reviews.length < reviewTotal" class="crd-more">
          <el-button :loading="reviewsLoading" @click="loadReviews(reviewPage + 1)">更多点评</el-button>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, EditPen } from "@element-plus/icons-vue";
import { courseApi, COURSE_SOURCE_LABEL, type CourseDetail, type CourseReviewItem } from "@/api/course";
import { useAuthStore } from "@/stores/auth";
import { fmtRelative } from "@/utils/format";
import UserAvatar from "@/components/common/UserAvatar.vue";
import MarkdownView from "@/components/forum/MarkdownView.vue";
import { courseMetaLine, RATING_FIELDS, ratingWord, scoreText, statValue } from "./courseReviewText";

const REVIEW_PAGE_SIZE = 10;

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const detail = ref<CourseDetail | null>(null);
const error = ref("");
const addingTeacher = ref(false);
const reviews = ref<CourseReviewItem[]>([]);
const reviewTotal = ref(0);
const reviewPage = ref(1);
const reviewsLoading = ref(false);
const reviewSort = ref<"new" | "hot">("new");
const teacherFilter = ref(0);
const expanded = ref(new Set<number>());
let loadSeq = 0;
let reviewSeq = 0;

const metricFields = RATING_FIELDS;
const course = computed(() => detail.value?.course ?? null);
const teachers = computed(() => detail.value?.teachers ?? []);
const courseId = computed(() => Number(route.params.id));

const mineLine = computed(() => {
  const mine = detail.value?.mine;
  if (!mine) return "";
  return [
    `${COURSE_SOURCE_LABEL[mine.source]}${mine.semester ? `（${mine.semester}）` : ""}`,
    mine.score ? `成绩 ${mine.score}` : "",
    mine.teacherNames.length ? `老师 ${mine.teacherNames.join("、")}` : "",
  ].filter(Boolean).join(" · ");
});

onMounted(reload);
watch(() => route.params.id, () => {
  teacherFilter.value = 0;
  void reload();
});

function distWidth(level: number) {
  const counts = detail.value?.distribution ?? [];
  const max = Math.max(1, ...counts);
  return `${Math.round(((counts[level - 1] ?? 0) / max) * 100)}%`;
}

async function reload() {
  const id = courseId.value;
  if (!Number.isSafeInteger(id) || id <= 0) {
    detail.value = null;
    error.value = "课程不存在或已被删除";
    return;
  }
  const seq = ++loadSeq;
  error.value = "";
  try {
    const next = await courseApi.detail(id, { suppressErrorMessage: true });
    if (seq !== loadSeq) return;
    detail.value = next;
    await loadReviews(1);
  } catch (e) {
    if (seq !== loadSeq) return;
    detail.value = null;
    error.value = detailError(e);
  }
}

async function loadReviews(target: number) {
  const seq = ++reviewSeq;
  reviewsLoading.value = true;
  try {
    const result = await courseApi.reviews(courseId.value, {
      teacher: teacherFilter.value || undefined,
      sort: reviewSort.value,
      page: target,
      size: REVIEW_PAGE_SIZE,
    }, { suppressErrorMessage: true });
    if (seq !== reviewSeq) return;
    reviews.value = target === 1 ? result.list : [...reviews.value, ...result.list];
    reviewTotal.value = result.total;
    reviewPage.value = target;
  } catch {
    if (seq === reviewSeq && target === 1) {
      reviews.value = [];
      reviewTotal.value = 0;
    }
  } finally {
    if (seq === reviewSeq) reviewsLoading.value = false;
  }
}

function setTeacherFilter(id: number) {
  teacherFilter.value = teacherFilter.value === id ? 0 : id;
  void loadReviews(1);
}

function setReviewSort(value: "new" | "hot") {
  if (reviewSort.value === value) return;
  reviewSort.value = value;
  void loadReviews(1);
}

function isLong(item: CourseReviewItem) {
  const text = String(item.topic.content || "");
  return text.length > 240 || text.split("\n").length > 6 || /!\[|<img/u.test(text);
}

function toggleExpanded(id: number) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

function goWrite() {
  void router.push({ path: "/coursereview/write", query: { course: String(courseId.value) } });
}

function editMine() {
  const own = detail.value?.myReview;
  if (own) void router.push({ path: "/coursereview/write", query: { topic: String(own.topicId) } });
}

async function onAddTeacher() {
  if (addingTeacher.value) return;
  const { value } = await ElMessageBox.prompt("填写这门课的任课老师姓名，和教务里一致最好。", "添加老师", {
    inputPlaceholder: "老师姓名",
    inputValidator: (v) => Boolean(v) && v.trim().length >= 2 && v.trim().length <= 40,
    inputErrorMessage: "请填写 2–40 个字",
  }).catch(() => ({ value: "" }));
  const name = String(value || "").trim();
  if (!name) return;
  addingTeacher.value = true;
  try {
    await courseApi.addTeacher(courseId.value, name);
    ElMessage.success("已添加");
    await reload();
  } finally {
    addingTeacher.value = false;
  }
}

function detailError(e: unknown) {
  const response = (e as { response?: { status?: number; data?: { message?: string } } })?.response;
  if (response?.status === 404) return "课程不存在或已被删除";
  if (response?.status && response.status < 500) return response.data?.message || "课程加载失败";
  return "课程加载失败，请稍后再试";
}
</script>

<style scoped>
.crd { display: flex; flex-direction: column; gap: 12px; }
.crd-card { background: var(--cpu-card); border-radius: var(--cpu-radius-l); padding: 16px 20px; }
.crd-state { min-height: 160px; display: grid; place-content: center; gap: 12px; text-align: center; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.crd-state p { margin: 0; }
.crd-back { display: inline-flex; align-items: center; gap: 4px; width: fit-content; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); text-decoration: none; }
.crd-back:hover { color: var(--cpu-primary); }
.crd-muted { color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); font-weight: 400; }
.crd-pad { padding: 12px 0; }

.crd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.crd-head-main { min-width: 0; }
.crd-meta { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
.crd-head h1 { margin: 4px 0 0; font-size: var(--cpu-fs-xl); font-weight: 600; color: var(--cpu-text); line-height: 1.35; }
.crd-mine { margin: 6px 0 0; font-size: var(--cpu-fs-s); color: var(--cpu-text-secondary); }
.crd-head-action { flex: none; }

.crd-summary { display: flex; gap: 24px; align-items: stretch; }
.crd-overall { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 20px; flex: 1; min-width: 0; }
.crd-overall-score { grid-row: 1; font-size: 40px; font-weight: 600; line-height: 1; color: var(--cpu-text); font-variant-numeric: tabular-nums; }
.crd-overall-label { grid-row: 2; grid-column: 1; margin-top: 6px; font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); white-space: nowrap; }
.crd-dist { grid-row: 1 / span 2; grid-column: 2; display: flex; flex-direction: column; justify-content: center; gap: 3px; }
.crd-dist-row { display: grid; grid-template-columns: 12px 1fr 28px; align-items: center; gap: 8px; font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
.crd-dist-track { height: 6px; border-radius: var(--cpu-radius-pill); background: var(--cpu-track); overflow: hidden; }
.crd-dist-track i { display: block; height: 100%; border-radius: inherit; background: var(--cpu-primary); }
.crd-dist-count { text-align: right; font-variant-numeric: tabular-nums; }
.crd-metrics { display: grid; grid-template-columns: repeat(2, minmax(96px, 1fr)); gap: 8px 20px; flex: none; padding-left: 24px; border-left: 1px solid var(--cpu-border-soft); }
.crd-metric { display: grid; grid-template-columns: auto auto; grid-template-rows: auto auto; column-gap: 8px; align-items: baseline; }
.crd-metric-label { grid-column: 1 / span 2; font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
.crd-metric b { font-size: var(--cpu-fs-l); font-weight: 600; color: var(--cpu-text); font-variant-numeric: tabular-nums; }
.crd-metric-word { font-size: var(--cpu-fs-s); color: var(--cpu-text-secondary); }
.crd-empty-summary b { font-size: var(--cpu-fs-m); color: var(--cpu-text); }
.crd-empty-summary p { margin: 4px 0 0; font-size: var(--cpu-fs-s); color: var(--cpu-text-muted); }

.crd-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.crd-section-head h3 { margin: 0; font-size: var(--cpu-fs-m); font-weight: 600; color: var(--cpu-text); }
.crd-teachers { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 8px; }
.crd-teacher {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-m);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.crd-teacher:hover { border-color: var(--cpu-border); }
.crd-teacher.active { border-color: var(--cpu-primary); background: var(--cpu-primary-soft); }
.crd-teacher-name { font-size: var(--cpu-fs-s); font-weight: 600; color: var(--cpu-text); }
.crd-teacher-name em { margin-left: 6px; font-style: normal; font-weight: 400; font-size: var(--cpu-fs-xs); color: var(--cpu-primary); }
.crd-teacher-stats { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }

.crd-sort { display: flex; gap: 2px; padding: 2px; border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); }
.crd-sort button { padding: 3px 10px; border: 0; border-radius: var(--cpu-radius-s); background: transparent; color: var(--cpu-text-secondary); font: inherit; font-size: var(--cpu-fs-xs); cursor: pointer; }
.crd-sort button.active { background: var(--cpu-card); color: var(--cpu-text); font-weight: 600; }

.crd-review { padding: 14px 0; border-top: 1px solid var(--cpu-border-soft); }
.crd-review:first-of-type { border-top: 0; padding-top: 4px; }
.crd-review-head { display: flex; align-items: center; gap: 8px; }
.crd-review-who { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.crd-review-name { font-size: var(--cpu-fs-s); font-weight: 600; color: var(--cpu-text); }
.crd-review-sub { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
.crd-pending { flex: none; padding: 0 6px; border-radius: var(--cpu-radius-s); background: var(--cpu-surface-soft); font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); line-height: 20px; }
.crd-review-rates { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.crd-review-rates span { padding: 1px 8px; border-radius: var(--cpu-radius-pill); background: var(--cpu-surface-soft); font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
.crd-review-rates b { font-weight: 600; color: var(--cpu-text-secondary); }
.crd-review-title { margin: 10px 0 4px; font-size: var(--cpu-fs-m); font-weight: 600; color: var(--cpu-text); }
.crd-review-body { font-size: var(--cpu-fs-m); color: var(--cpu-text); }
.crd-review-body.collapsed { max-height: 140px; overflow: hidden; -webkit-mask-image: linear-gradient(#000 70%, transparent); mask-image: linear-gradient(#000 70%, transparent); }
.crd-review-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 6px; }
.crd-review-link { display: flex; gap: 12px; margin-left: auto; font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); text-decoration: none; }
.crd-review-link span:last-child { color: var(--cpu-primary); }
.crd-more { display: flex; justify-content: center; padding-top: 8px; }

@media (max-width: 700px) {
  .crd-card { padding: 14px; border-radius: var(--cpu-radius-m); }
  .crd-head { flex-direction: column; gap: 10px; }
  .crd-head h1 { font-size: var(--cpu-fs-l); }
  .crd-head-action, .crd-head-action .el-button { width: 100%; }
  .crd-summary { flex-direction: column; gap: 14px; }
  .crd-overall-score { font-size: 32px; }
  .crd-metrics { grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 12px 0 0; border-left: 0; border-top: 1px solid var(--cpu-border-soft); }
  .crd-metric { grid-template-columns: auto; }
  .crd-metric-label { grid-column: 1; }
}
</style>
