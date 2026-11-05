<template>
  <JwxtSubViews :views="views" label="成绩" id-prefix="jwxt-grades" :active="active">
    <template #courses><GradesPane :data="data" :loading="loading" /></template>
    <template #level-exams="{ active: shown }">
      <RecordPane :sources="levelExamSources" :active="shown" empty-text="没有等级考试记录" />
    </template>
    <template #exams><ExamsPane :data="null" /></template>
    <template #transcript="{ active: shown }"><TranscriptPane :active="shown" /></template>
  </JwxtSubViews>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { useExternalAcademic } from "@/utils/academicSystem";
import JwxtSubViews from "@/components/jwxt/JwxtSubViews.vue";
import type { RecordKind } from "@/components/jwxt/records/recordCards";

const GradesPane = defineAsyncComponent(() => import("@/components/jwxt/GradesPane.vue"));
const RecordPane = defineAsyncComponent(() => import("@/components/jwxt/records/RecordPane.vue"));
const TranscriptPane = defineAsyncComponent(() => import("@/components/jwxt/records/TranscriptPane.vue"));
const ExamsPane = defineAsyncComponent(() => import("@/components/jwxt/ExamsPane.vue"));

defineProps<{ data: unknown; loading?: boolean; active?: boolean }>();

const externalAcademic = useExternalAcademic();
const views = computed(() => [
  { key: "courses", label: "课程成绩" },
  { key: "level-exams", label: "等级考试" },
  // 考试安排：药大教务的考试接口各学期都是空的，只给外校（南医、南中医有真实安排）。
  ...(externalAcademic.value ? [{ key: "exams", label: "考试安排" }] : []),
  // 成绩单 PDF 来自药大的电子证明平台。
  ...(externalAcademic.value ? [] : [{ key: "transcript", label: "成绩单" }]),
]);
const levelExamSources: Array<{ kind: RecordKind }> = [{ kind: "level-exams" }];
</script>
