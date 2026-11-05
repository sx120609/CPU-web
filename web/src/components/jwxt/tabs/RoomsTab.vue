<template>
  <JwxtSubViews :views="views" label="教室" id-prefix="jwxt-rooms" :active="active">
    <template #free="{ active: shown }"><FreeRoomsPane :active="shown" /></template>
    <template #search="{ active: shown }"><TimetableSearchPane :active="shown" /></template>
  </JwxtSubViews>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useExternalAcademic } from "@/utils/academicSystem";
import JwxtSubViews from "@/components/jwxt/JwxtSubViews.vue";
import FreeRoomsPane from "@/components/jwxt/records/FreeRoomsPane.vue";
import TimetableSearchPane from "@/components/jwxt/records/TimetableSearchPane.vue";

defineProps<{ active?: boolean }>();

const externalAcademic = useExternalAcademic();
// 全校课表检索是药大教务独有的。
const views = computed(() => [
  { key: "free", label: "空教室" },
  ...(externalAcademic.value ? [] : [{ key: "search", label: "课表检索" }]),
]);
</script>
