<template>
  <JwxtSubViews :views="views" label="教室" id-prefix="jwxt-rooms" :active="active">
    <template #free="{ active: shown }"><FreeRoomsPane :active="shown" /></template>
    <template #search="{ active: shown }"><TimetableSearchPane :active="shown" /></template>
  </JwxtSubViews>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAcademicViews } from "@/utils/academicSystem";
import JwxtSubViews from "@/components/jwxt/JwxtSubViews.vue";
import FreeRoomsPane from "@/components/jwxt/records/FreeRoomsPane.vue";
import TimetableSearchPane from "@/components/jwxt/records/TimetableSearchPane.vue";

defineProps<{ active?: boolean }>();

// 子视图按学校档案里的教务视图清单显示。
const academicViews = useAcademicViews();
const views = computed(() => [
  ...(academicViews.value.has("freeRooms") ? [{ key: "free", label: "空教室" }] : []),
  ...(academicViews.value.has("timetableSearch") ? [{ key: "search", label: "课表检索" }] : []),
]);
</script>
