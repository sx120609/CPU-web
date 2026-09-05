<template>
  <div v-if="label" class="schedule-course-status" :class="{ detail, orphaned: course.orphaned }">
    <b>{{ detail && course.orphaned ? "当前教务课表未找到原课程" : label }}</b>
    <template v-if="detail">
      <p v-if="course.orphaned">
        原课程可能已移除或调整。这里保留的是你之前的编辑，刷新不会自动删除。你可以保留为自定义课程，或恢复到最新教务课表以移除这份编辑。
      </p>
      <p v-else-if="course.sourceKey">这是你编辑过的课程，可通过“恢复原始”移除修改，以最新教务课表为准。</p>
      <p v-else>这是你添加或保留的自定义课程，不属于教务课表。</p>
      <slot />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { scheduleCourseEditLabel, type EditableScheduleCourse } from "@/utils/scheduleEdits";

const props = defineProps<{ course: EditableScheduleCourse; detail?: boolean }>();
const label = computed(() => scheduleCourseEditLabel(props.course));
</script>

<style scoped>
.schedule-course-status {
  flex: none;
  align-self: flex-start;
  max-width: 100%;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 1px 3px;
  font-size: 10px;
  line-height: 1.25;
  overflow-wrap: anywhere;
  text-wrap: balance;
}
.orphaned {
  color: #854d0e;
  background: #fef3c7;
}
.detail {
  margin-bottom: 12px;
  border-radius: 12px;
  padding: 12px;
  font-size: 14px;
  line-height: 1.5;
}
.detail p { margin: 6px 0 0; }
.detail :slotted(button) {
  margin-top: 10px;
  min-height: 36px;
  padding: 5px 12px;
  border: 1px solid currentColor;
  border-radius: 8px;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.detail :slotted(button:disabled) { opacity: 0.55; cursor: not-allowed; }
</style>
