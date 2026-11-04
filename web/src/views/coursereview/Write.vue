<template>
  <div class="crw">
    <RouterLink class="crw-back" :to="backTo"><el-icon><ArrowLeft /></el-icon> {{ course ? course.name : "课程点评" }}</RouterLink>
    <h2>{{ editingTopicId ? "修改点评" : "写点评" }}</h2>

    <div v-if="loadError" class="crw-card crw-state">
      <p>{{ loadError }}</p>
      <el-button @click="init">重试</el-button>
    </div>

    <template v-else>
      <section class="crw-card">
        <div class="crw-label">课程</div>
        <div v-if="course" class="crw-course">
          <div class="crw-course-main">
            <b>{{ course.name }}</b>
            <span>{{ courseMetaLine(course) }}</span>
          </div>
          <button v-if="!editingTopicId" data-cpu-button="text" type="button" @click="clearCourse">换一门</button>
        </div>
        <div v-else class="crw-picker">
          <el-input v-model="courseQuery" placeholder="搜课程名、代码或老师" clearable @input="onCourseQuery">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <div class="crw-picker-hint">{{ courseQuery.trim() ? "搜索结果" : "我修过、还没评价的课" }}</div>
          <div v-if="pickerLoading && !pickerItems.length" class="crw-muted">正在查找…</div>
          <div v-else-if="!pickerItems.length" class="crw-muted">
            {{ courseQuery.trim() ? "没找到这门课。" : "没有待评价的课，可以直接搜索。" }}
          </div>
          <ul v-else class="crw-picker-list">
            <li v-for="c in pickerItems" :key="c.id">
              <button type="button" @click="pickCourse(c.id)">
                <b>{{ c.name }}</b>
                <span>{{ [courseMetaLine(c), c.mine?.teacherNames.join("、") || c.teachers.slice(0, 3).map((t) => t.name).join("、")].filter(Boolean).join(" · ") }}</span>
              </button>
            </li>
          </ul>
        </div>
      </section>

      <template v-if="course">
        <section class="crw-card">
          <div class="crw-label">任课老师</div>
          <div class="crw-teachers">
            <button
              v-for="t in teacherOptions"
              :key="t.courseTeacherId"
              type="button"
              :class="{ active: form.courseTeacherId === t.courseTeacherId }"
              @click="pickTeacher(t.courseTeacherId)"
            >{{ t.name }}<em v-if="mineTeacherNames.includes(t.name)">我的老师</em></button>
            <button type="button" :class="{ active: typingTeacher }" @click="startTypingTeacher">其他老师</button>
          </div>
          <el-input
            v-if="typingTeacher"
            v-model="form.teacherName"
            class="crw-teacher-input"
            maxlength="40"
            placeholder="老师姓名"
          />
        </section>

        <section class="crw-card">
          <div class="crw-label">打分</div>
          <div class="crw-ratings">
            <div v-for="field in RATING_FIELDS" :key="field.key" class="crw-rating">
              <div class="crw-rating-head">
                <b>{{ field.label }}</b>
                <span>{{ field.hint }}</span>
              </div>
              <div class="crw-levels" role="radiogroup" :aria-label="field.label">
                <button
                  v-for="(word, index) in field.levels"
                  :key="word"
                  type="button"
                  role="radio"
                  :aria-checked="form.ratings[field.key] === index + 1"
                  :class="{ active: form.ratings[field.key] === index + 1 }"
                  @click="form.ratings[field.key] = index + 1"
                ><i>{{ index + 1 }}</i>{{ word }}</button>
              </div>
            </div>
          </div>
        </section>

        <section class="crw-card">
          <div class="crw-label">学期 <span class="crw-optional">选填</span></div>
          <el-select
            v-model="form.semester"
            class="crw-semester"
            filterable
            allow-create
            clearable
            default-first-option
            placeholder="例如 2024-2025-1"
          >
            <el-option v-for="s in semesterOptions" :key="s" :value="s" :label="s" />
          </el-select>
        </section>

        <section class="crw-card">
          <div class="crw-label">点评</div>
          <el-input v-model="form.title" maxlength="60" show-word-limit :placeholder="defaultTitle" />
          <div class="crw-prompts">
            <button v-for="p in prompts" :key="p" type="button" @click="appendPrompt(p)">+ {{ p }}</button>
          </div>
          <el-input
            v-model="form.content"
            type="textarea"
            :autosize="{ minRows: 6, maxRows: 18 }"
            maxlength="5000"
            show-word-limit
            placeholder="上课方式、作业和考试、给分情况、需要注意什么……写得越具体越有用。"
          />
          <label v-if="anonymousAvailable && !editingTopicId" class="crw-anon">
            <el-switch v-model="form.anonymous" size="small" />
            <span>匿名发布（会消耗一次匿名次数）</span>
          </label>
        </section>

        <div class="crw-actions">
          <span class="crw-muted">{{ submitHint }}</span>
          <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">
            {{ editingTopicId ? "保存修改" : "发布点评" }}
          </el-button>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowLeft, Search } from "@element-plus/icons-vue";
import { courseApi, type Course, type CourseDetail, type CourseReviewMetadata } from "@/api/course";
import { topicApi } from "@/api/topic";
import { boardApi } from "@/api/board";
import { createForumSubmissionId, getForumRequestMessage } from "@/utils/forumSubmission";
import { courseMetaLine, RATING_FIELDS, type RatingKey } from "./courseReviewText";

const CONTENT_MIN = 15;

const route = useRoute();
const router = useRouter();

const editingTopicId = computed(() => {
  const id = Number(route.query.topic);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
});

const detail = ref<CourseDetail | null>(null);
const loadError = ref("");
const courseQuery = ref("");
const pickerItems = ref<Course[]>([]);
const pickerLoading = ref(false);
const typingTeacher = ref(false);
const submitting = ref(false);
const anonymousAvailable = ref(false);
let submissionId = "";
let pickerSeq = 0;
let pickerTimer: ReturnType<typeof setTimeout> | null = null;

const form = reactive({
  courseTeacherId: 0,
  teacherName: "",
  semester: "",
  title: "",
  content: "",
  anonymous: false,
  ratings: { recommend: 0, reward: 0, difficulty: 0, givingScore: 0 } as Record<RatingKey, number>,
});

const prompts = ["上课方式", "作业与考试", "给分情况", "选课建议"];

const course = computed(() => detail.value?.course ?? null);
const teacherOptions = computed(() => detail.value?.teachers ?? []);
const mineTeacherNames = computed(() => detail.value?.mine?.teacherNames ?? []);
const backTo = computed(() => (course.value ? `/coursereview/${course.value.id}` : "/coursereview"));
const selectedTeacherName = computed(() => {
  if (typingTeacher.value) return form.teacherName.trim();
  return teacherOptions.value.find((t) => t.courseTeacherId === form.courseTeacherId)?.name ?? "";
});
const defaultTitle = computed(() => [course.value?.name, selectedTeacherName.value].filter(Boolean).join(" · ") || "标题");
const semesterOptions = computed(() => [detail.value?.mine?.semester].filter((s): s is string => Boolean(s)));

const missing = computed(() => {
  const list: string[] = [];
  if (!selectedTeacherName.value) list.push("选择老师");
  if (RATING_FIELDS.some((f) => !form.ratings[f.key])) list.push("打完四项分");
  if (form.content.trim().length < CONTENT_MIN) list.push(`正文至少 ${CONTENT_MIN} 个字`);
  return list;
});
const canSubmit = computed(() => Boolean(course.value) && !missing.value.length && !submitting.value);
const submitHint = computed(() => (missing.value.length ? `还需要：${missing.value.join("、")}` : "发布后会经过内容审核"));

onMounted(init);
onBeforeUnmount(() => { if (pickerTimer) clearTimeout(pickerTimer); });
watch(() => [route.query.course, route.query.topic], () => { void init(); });

async function init() {
  loadError.value = "";
  submissionId = "";
  boardApi.detail("coursereview", { suppressErrorMessage: true })
    .then((board) => { anonymousAvailable.value = Boolean(board.anonymousEnabled); })
    .catch(() => { anonymousAvailable.value = false; });
  try {
    if (editingTopicId.value) {
      await loadForEdit(editingTopicId.value);
      return;
    }
    const courseId = Number(route.query.course);
    if (Number.isSafeInteger(courseId) && courseId > 0) await loadCourse(courseId);
    else {
      detail.value = null;
      void searchCourses();
    }
  } catch (e) {
    loadError.value = getForumRequestMessage(e) || "加载失败，请稍后再试";
  }
}

async function loadCourse(courseId: number) {
  const next = await courseApi.detail(courseId, { suppressErrorMessage: true, cacheTtlMs: 0 });
  if (next.myReview && !editingTopicId.value) {
    ElMessage.info(next.myReview.pending ? "你对这门课的点评正在审核，可以直接修改" : "你已经评价过这门课，可以修改原来那篇");
    await router.replace({ path: "/coursereview/write", query: { topic: String(next.myReview.topicId) } });
    return;
  }
  detail.value = next;
  resetForm();
  // 默认选中教务课表里的老师；只有一位老师时直接选上。
  const mine = teacherOptions.value.find((t) => mineTeacherNames.value.includes(t.name));
  const only = teacherOptions.value.length === 1 ? teacherOptions.value[0] : null;
  form.courseTeacherId = (mine ?? only)?.courseTeacherId ?? 0;
  typingTeacher.value = !teacherOptions.value.length;
  form.semester = next.mine?.semester ?? "";
}

async function loadForEdit(topicId: number) {
  const topic = await topicApi.detail(topicId, { suppressErrorMessage: true, cacheTtlMs: 0 });
  const meta = (topic.metadata ?? {}) as Partial<CourseReviewMetadata>;
  if (topic.board?.type !== "coursereview" || !meta.courseId) {
    await router.replace({ name: "edit-post", params: { id: String(topicId) } });
    return;
  }
  detail.value = await courseApi.detail(Number(meta.courseId), { suppressErrorMessage: true, cacheTtlMs: 0 });
  resetForm();
  form.title = topic.title;
  form.content = topic.editableContent ?? topic.content;
  form.semester = meta.semester ?? "";
  for (const field of RATING_FIELDS) form.ratings[field.key] = Number(meta.ratings?.[field.key] ?? (field.key === "givingScore" ? (meta.ratings as any)?.score : 0)) || 0;
  const known = teacherOptions.value.find((t) => t.courseTeacherId === Number(meta.courseTeacherId))
    ?? teacherOptions.value.find((t) => t.name === meta.teacherName);
  if (known) form.courseTeacherId = known.courseTeacherId;
  else if (meta.teacherName) {
    typingTeacher.value = true;
    form.teacherName = meta.teacherName;
  }
}

function resetForm() {
  form.courseTeacherId = 0;
  form.teacherName = "";
  form.semester = "";
  form.title = "";
  form.content = "";
  form.anonymous = false;
  for (const field of RATING_FIELDS) form.ratings[field.key] = 0;
  typingTeacher.value = false;
}

function onCourseQuery() {
  if (pickerTimer) clearTimeout(pickerTimer);
  pickerTimer = setTimeout(() => { void searchCourses(); }, 250);
}

async function searchCourses() {
  const seq = ++pickerSeq;
  pickerLoading.value = true;
  try {
    const q = courseQuery.value.trim();
    const result = await courseApi.list(q ? { q, size: 20 } : { scope: "todo", size: 20 }, { suppressErrorMessage: true });
    if (seq === pickerSeq) pickerItems.value = result.items;
  } catch {
    if (seq === pickerSeq) pickerItems.value = [];
  } finally {
    if (seq === pickerSeq) pickerLoading.value = false;
  }
}

function pickCourse(id: number) {
  void router.replace({ path: "/coursereview/write", query: { course: String(id) } });
}

function clearCourse() {
  void router.replace({ path: "/coursereview/write" });
}

function pickTeacher(id: number) {
  form.courseTeacherId = id;
  typingTeacher.value = false;
  form.teacherName = "";
}

function startTypingTeacher() {
  typingTeacher.value = true;
  form.courseTeacherId = 0;
}

function appendPrompt(prompt: string) {
  const prefix = form.content && !form.content.endsWith("\n") ? "\n\n" : "";
  form.content = `${form.content}${prefix}**${prompt}**：`;
}

async function submit() {
  if (!canSubmit.value || !course.value) return;
  const metadata: CourseReviewMetadata = {
    courseId: course.value.id,
    ratings: {
      recommend: form.ratings.recommend,
      reward: form.ratings.reward,
      difficulty: form.ratings.difficulty,
      givingScore: form.ratings.givingScore,
    },
    ...(form.semester.trim() ? { semester: form.semester.trim() } : {}),
    ...(typingTeacher.value ? { teacherName: form.teacherName.trim() } : { courseTeacherId: form.courseTeacherId }),
  };
  const title = (form.title.trim() || defaultTitle.value).slice(0, 60);
  submitting.value = true;
  try {
    const result = editingTopicId.value
      ? await topicApi.update(editingTopicId.value, { title, content: form.content.trim(), metadata })
      : await topicApi.create({
          boardSlug: "coursereview",
          title: title.length >= 2 ? title : `${title}点评`,
          content: form.content.trim(),
          metadata,
          anonymous: form.anonymous,
          submissionId: submissionId || (submissionId = createForumSubmissionId("topic")),
        });
    const status = result.submissionResult?.status;
    if (status === "published") ElMessage.success(editingTopicId.value ? "已保存" : "已发布，谢谢你的点评");
    else if (status === "blocked_ai") ElMessage.warning(result.submissionResult?.reason || "内容没有通过审核，只有你自己能看到");
    else ElMessage.success("已提交，审核通过后所有人可见");
    submissionId = "";
    await router.replace(`/coursereview/${course.value.id}`);
  } catch (e) {
    ElMessage.error(getForumRequestMessage(e) || "提交失败，请稍后再试");
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.crw { display: flex; flex-direction: column; gap: 12px; max-width: 760px; width: 100%; margin: 0 auto; }
.crw h2 { margin: 0; font-size: var(--cpu-fs-xl); font-weight: 600; color: var(--cpu-text); }
.crw-back { display: inline-flex; align-items: center; gap: 4px; width: fit-content; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); text-decoration: none; }
.crw-back:hover { color: var(--cpu-primary); }
.crw-card { display: flex; flex-direction: column; gap: 10px; background: var(--cpu-card); border-radius: var(--cpu-radius-l); padding: 16px 20px; }
.crw-state { align-items: center; text-align: center; color: var(--cpu-text-muted); }
.crw-state p { margin: 0; }
.crw-label { font-size: var(--cpu-fs-s); font-weight: 600; color: var(--cpu-text); }
.crw-optional { margin-left: 4px; font-weight: 400; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.crw-muted { color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }

.crw-course { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.crw-course-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.crw-course-main b { font-size: var(--cpu-fs-m); color: var(--cpu-text); }
.crw-course-main span { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }

.crw-picker { display: flex; flex-direction: column; gap: 8px; }
.crw-picker-hint { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
.crw-picker-list { list-style: none; margin: 0; padding: 0; max-height: 360px; overflow-y: auto; border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-m); }
.crw-picker-list li + li { border-top: 1px solid var(--cpu-border-soft); }
.crw-picker-list button { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 8px 12px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.crw-picker-list button:hover { background: var(--cpu-surface-soft); }
.crw-picker-list b { font-size: var(--cpu-fs-s); color: var(--cpu-text); }
.crw-picker-list span { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.crw-teachers { display: flex; flex-wrap: wrap; gap: 6px; }
.crw-teachers button,
.crw-prompts button {
  padding: 4px 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  background: transparent;
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-s);
  cursor: pointer;
}
.crw-teachers button.active { border-color: var(--cpu-primary); background: var(--cpu-primary-soft); color: var(--cpu-primary); }
.crw-teachers em { margin-left: 4px; font-style: normal; font-size: var(--cpu-fs-xs); color: var(--cpu-primary); }
.crw-teacher-input { max-width: 240px; }

.crw-ratings { display: flex; flex-direction: column; gap: 14px; }
.crw-rating-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.crw-rating-head b { font-size: var(--cpu-fs-s); color: var(--cpu-text); }
.crw-rating-head span { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
.crw-levels { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.crw-levels button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 4px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-m);
  background: transparent;
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-xs);
  cursor: pointer;
}
.crw-levels button i { font-style: normal; font-size: var(--cpu-fs-m); font-weight: 600; color: var(--cpu-text); }
.crw-levels button:hover { border-color: var(--cpu-border); }
.crw-levels button.active { border-color: var(--cpu-primary); background: var(--cpu-primary-soft); color: var(--cpu-primary); }
.crw-levels button.active i { color: var(--cpu-primary); }

.crw-semester { max-width: 240px; }
.crw-prompts { display: flex; flex-wrap: wrap; gap: 6px; }
.crw-prompts button { font-size: var(--cpu-fs-xs); padding: 2px 10px; }
.crw-anon { display: flex; align-items: center; gap: 8px; font-size: var(--cpu-fs-s); color: var(--cpu-text-secondary); }

.crw-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding-bottom: 16px; }

@media (max-width: 700px) {
  .crw h2 { font-size: var(--cpu-fs-l); }
  .crw-card { padding: 14px; border-radius: var(--cpu-radius-m); }
  .crw-levels { gap: 4px; }
  .crw-levels button { padding: 6px 2px; }
  .crw-actions { flex-direction: column-reverse; align-items: stretch; }
  .crw-actions .el-button { width: 100%; }
  .crw-semester, .crw-teacher-input { max-width: none; }
}
</style>
