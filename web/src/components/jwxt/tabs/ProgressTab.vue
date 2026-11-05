<template>
  <JwxtSubViews :views="views" label="学业" id-prefix="jwxt-progress" :active="active">
    <template #overview><ProgressPane :data="data" :loading="loading" /></template>
    <template #audit="{ active: shown }"><RecordPane :sources="auditSources" :active="shown" /></template>
    <template #retake="{ active: shown }">
      <RecordPane :sources="retakeSources" :active="shown" empty-text="没有可重修的课程" />
    </template>
    <template #status="{ active: shown }"><RecordPane :sources="statusSources" :active="shown" /></template>
  </JwxtSubViews>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { useExternalAcademic } from "@/utils/academicSystem";
import JwxtSubViews from "@/components/jwxt/JwxtSubViews.vue";
import type { RecordKind } from "@/components/jwxt/records/recordCards";

const ProgressPane = defineAsyncComponent(() => import("@/components/jwxt/ProgressPane.vue"));
const RecordPane = defineAsyncComponent(() => import("@/components/jwxt/records/RecordPane.vue"));

defineProps<{ data: unknown; loading?: boolean; active?: boolean }>();

type Source = { kind: RecordKind; label?: string };
const externalAcademic = useExternalAcademic();
// 外校只有完成情况（南医：学分统计和学业体检单；南中医：培养方案完成情况）。
const views = computed(() => (externalAcademic.value
  ? [{ key: "overview", label: "完成情况" }]
  : [
    { key: "overview", label: "完成情况" },
    { key: "audit", label: "毕业审核" },
    { key: "retake", label: "重修" },
    { key: "status", label: "学籍" },
  ]));
const auditSources: Source[] = [{ kind: "graduation-audit" }];
const retakeSources: Source[] = [{ kind: "retake-options" }];
// 转专业计划放在学籍里：都是学籍处的事，数据量也都不大。
const statusSources: Source[] = [{ kind: "student-status" }, { kind: "major-transfer", label: "转专业计划" }];
</script>
