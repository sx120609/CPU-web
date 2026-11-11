<template>
  <JwxtSubViews :views="views" label="学业" id-prefix="jwxt-progress" :active="active">
    <template #overview><ProgressPane :data="data" :loading="loading" /></template>
    <template #audit="{ active: shown }"><RecordPane :sources="auditSources" :active="shown" /></template>
    <template #status="{ active: shown }"><RecordPane :sources="statusSources" :active="shown" /></template>
  </JwxtSubViews>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { useAcademicViews } from "@/utils/academicSystem";
import JwxtSubViews from "@/components/jwxt/JwxtSubViews.vue";
import type { RecordKind } from "@/components/jwxt/records/recordCards";

const ProgressPane = defineAsyncComponent(() => import("@/components/jwxt/ProgressPane.vue"));
const RecordPane = defineAsyncComponent(() => import("@/components/jwxt/records/RecordPane.vue"));

defineProps<{ data: unknown; loading?: boolean; active?: boolean }>();

type Source = { kind: RecordKind; label?: string };
// 学分修得怎么样、能不能毕业、学籍状态；重修报名放在选课里。
// 子视图按学校档案里的教务视图清单显示；完成情况各校都有。
const academicViews = useAcademicViews();
const views = computed(() => [
  { key: "overview", label: "完成情况" },
  ...(academicViews.value.has("graduationAudit") ? [{ key: "audit", label: "毕业审核" }] : []),
  ...(academicViews.value.has("studentStatus") ? [{ key: "status", label: "学籍" }] : []),
]);
const auditSources: Source[] = [{ kind: "graduation-audit" }];
// 转专业计划放在学籍里：都是学籍处的事，数据量也都不大。
const statusSources: Source[] = [{ kind: "student-status" }, { kind: "major-transfer", label: "转专业计划" }];
</script>
