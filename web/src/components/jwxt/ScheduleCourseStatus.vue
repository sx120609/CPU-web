<template>
  <div v-if="label" class="schedule-course-status" :class="{ detail, orphaned: course.orphaned }" :title="course.orphaned ? '个人编辑待核对，点开查看详情' : label">
    <b>{{ detail && course.orphaned ? "这门课的安排需要核对" : label }}</b>
    <template v-if="detail">
      <p v-if="course.orphaned">
        当前教务课表与保存编辑时的信息未能对应，可能是时间、周次、老师或地点变化，不表示课程已取消。这里仍保留着你的编辑。
      </p>
      <p v-else-if="course.sourceKey && course.orphaned === undefined">暂未载入教务课表，当前展示的是你保存的编辑。刷新后再核对课程安排。</p>
      <p v-else-if="course.sourceKey">这是你编辑过的课程，可通过“使用教务安排”移除个人修改。</p>
      <p v-else>这是你添加或保留的自定义课程，不属于教务课表。</p>
      <p v-if="course.orphaned">继续用自己的安排，可保留为自定义课程；以教务为准，可选择“使用教务安排”。</p>
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
  border-radius: 3px;
  padding: 1px 2px;
  font-size: 9px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.schedule-course-status b { font-weight: 500; }
.orphaned {
  color: #805c20;
  background: #fff1d6;
}
.detail {
  margin-bottom: 12px;
  border-radius: 12px;
  padding: 12px;
  font-size: 14px;
  line-height: 1.5;
  white-space: normal;
}
.detail b { font-weight: 600; }
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
