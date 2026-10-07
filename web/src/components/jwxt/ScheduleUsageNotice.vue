<template>
  <el-dialog
    :model-value="visible"
    title="课表使用提醒"
    width="min(480px, calc(100vw - 32px))"
    class="schedule-usage-notice"
    align-center
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    :before-close="acknowledge"
    @opened="beginReading"
  >
    <ol class="schedule-usage-notice__items">
      <li>
        <strong>先核对上课周次</strong>
        <p>药大拾间课表理论上与教务系统保持一致。如发现差异，请先仔细核对教务系统中的“单双周”“上课周次”等信息，确认是否因周次理解不同造成误读。</p>
      </li>
      <li>
        <strong>点击课程即可编辑</strong>
        <p>点击课表中的课程，即可编辑课程信息，按需调整自己的课表。</p>
      </li>
      <li>
        <strong>调课以实际安排为准</strong>
        <p>如遇调课、补课或临时变动，请以学校、学院或任课教师通知的实际安排为准。</p>
      </li>
    </ol>
    <template #footer>
      <el-button
        type="primary"
        class="schedule-usage-notice__confirm"
        :disabled="secondsLeft > 0"
        @click="acknowledge"
      >
        {{ secondsLeft > 0 ? `请先阅读 ${secondsLeft} 秒` : "我知道了" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElButton, ElDialog } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { useScheduleUsageNotice } from "@/views/schedule/useScheduleUsageNotice";

const auth = useAuthStore();
const { visible, secondsLeft, beginReading, acknowledge } = useScheduleUsageNotice(
  () => auth.isLoggedIn && !auth.needDataAuthAgreement ? auth.user : null,
);
</script>

<style scoped>
.schedule-usage-notice__items {
  margin: 0;
  padding-inline-start: 24px;
  color: var(--el-text-color-regular);
  font-size: 15px;
  line-height: 1.7;
}

.schedule-usage-notice__items li + li {
  margin-top: 18px;
}

.schedule-usage-notice__items li::marker,
.schedule-usage-notice__items strong {
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.schedule-usage-notice__items p {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}

.schedule-usage-notice__confirm {
  min-width: 144px;
  min-height: 44px;
}
</style>
