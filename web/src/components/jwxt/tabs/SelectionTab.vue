<template>
  <JwxtSubViews :views="views" label="选课" id-prefix="jwxt-selection" :active="active">
    <template #courses="{ active: shown }">
      <RecordPane :sources="courseSources" :active="shown" empty-text="这个学期还没有课程" />
    </template>
    <template #records="{ active: shown }">
      <RecordPane :sources="recordSources" :active="shown" empty-text="这个学期没有选课记录" />
    </template>
    <template #retake="{ active: shown }">
      <RecordPane :sources="retakeSources" :active="shown" empty-text="没有可重修的课程" />
    </template>
    <template #textbooks="{ active: shown }">
      <RecordPane :sources="textbookSources" :active="shown" empty-text="这个学期没有教材记录" />
    </template>
  </JwxtSubViews>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAcademicViews } from "@/utils/academicSystem";
import JwxtSubViews from "@/components/jwxt/JwxtSubViews.vue";
import RecordPane from "@/components/jwxt/records/RecordPane.vue";
import type { RecordKind } from "@/components/jwxt/records/recordCards";

defineProps<{ active?: boolean }>();

type Source = { kind: RecordKind; label?: string };
// 这学期上什么课、怎么选上的、要不要重修报名、用什么教材。子视图按学校档案里的教务视图清单显示。
const academicViews = useAcademicViews();
const views = computed(() => [
  ...(academicViews.value.has("selection")
    ? [{ key: "courses", label: "本学期课程" }, { key: "records", label: "选课记录" }]
    : []),
  ...(academicViews.value.has("retake") ? [{ key: "retake", label: "重修" }] : []),
  ...(academicViews.value.has("selection") ? [{ key: "textbooks", label: "教材" }] : []),
]);
const courseSources: Source[] = [{ kind: "term-courses" }];
const recordSources: Source[] = [{ kind: "election-rounds", label: "选课轮次" }, { kind: "enrollment" }];
const retakeSources: Source[] = [{ kind: "retake-options" }];
const textbookSources: Source[] = [{ kind: "textbooks" }];
</script>
