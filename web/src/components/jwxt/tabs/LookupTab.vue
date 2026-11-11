<template>
  <JwxtSubViews :views="views" label="全校查询" id-prefix="jwxt-lookup" :active="active">
    <template #search="{ active: shown }"><TimetableSearchPane :active="shown" /></template>
    <template #free="{ active: shown }"><FreeRoomsPane :active="shown" /></template>
  </JwxtSubViews>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAcademicViews } from "@/utils/academicSystem";
import JwxtSubViews from "@/components/jwxt/JwxtSubViews.vue";
import FreeRoomsPane from "@/components/jwxt/records/FreeRoomsPane.vue";
import TimetableSearchPane from "@/components/jwxt/records/TimetableSearchPane.vue";

defineProps<{ active?: boolean }>();

// 查的是全校的数据，和“我的”成绩、学业、选课分开：按课程／教师／教室／班级查开课，以及空教室。
// 子视图按学校档案里的教务视图清单显示。
const academicViews = useAcademicViews();
const views = computed(() => [
  ...(academicViews.value.has("timetableSearch") ? [{ key: "search", label: "开课查询" }] : []),
  ...(academicViews.value.has("freeRooms") ? [{ key: "free", label: "空教室" }] : []),
]);
</script>
