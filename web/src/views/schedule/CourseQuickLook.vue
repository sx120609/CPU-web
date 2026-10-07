<template>
  <!-- 课程速览：课名、「星期 · 节次 · 时间」，然后是教室、老师、周次和备注。
       在课表上点任意一门课都会打开它；「编辑」把同一处换成编辑器。 -->
  <Teleport to="body">
    <Transition name="quick-look">
      <div v-if="block" class="quick-look-overlay" :style="pageStyle" @click.self="emit('close')">
        <section class="quick-look-panel" role="dialog" aria-modal="true" :aria-label="block.course.name">
          <header class="quick-look-head">
            <i class="quick-look-bar" :style="{ background: accent }" aria-hidden="true" />
            <div class="quick-look-title">
              <h2>{{ block.course.name }}</h2>
              <p v-if="scheduleLine"><el-icon><Clock /></el-icon>{{ scheduleLine }}</p>
            </div>
            <button v-if="canEdit" type="button" class="quick-look-edit" aria-label="编辑课程" @click="emit('edit')">编辑</button>
            <button v-else type="button" class="quick-look-close" aria-label="关闭" @click="emit('close')">
              <el-icon><Close /></el-icon>
            </button>
          </header>

          <!-- 四个标题都是两个字，值就对齐成一列；没有值的行不占地方。 -->
          <dl v-if="details.length" class="quick-look-details">
            <div v-for="detail in details" :key="detail.title">
              <dt><el-icon :style="{ color: accent }"><component :is="detail.icon" /></el-icon>{{ detail.title }}</dt>
              <dd>{{ detail.value }}</dd>
            </div>
          </dl>

          <p v-if="ownerLabel" class="quick-look-note">{{ ownerLabel }}</p>
          <p v-else-if="block.course.orphaned" class="quick-look-note warn">
            <el-icon><WarningFilled /></el-icon>教务课表里已找不到这门课，请核对后保留或删除。
          </p>
          <p v-else-if="block.course.custom" class="quick-look-note">
            <el-icon><EditPen /></el-icon>自己添加或修改过的课程
          </p>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch, type Component } from "vue";
import { Calendar, Clock, Close, EditPen, Location, Memo, User, WarningFilled } from "@element-plus/icons-vue";
import { cleanLocation } from "./nowIndicator";
import type { WeekCourseBlock } from "./types";

const props = withDefaults(defineProps<{
  /** 有值就打开。 */
  block: WeekCourseBlock | null;
  /** 「周一 · 第 1–2 节 · 08:00–09:40」。 */
  scheduleLine?: string;
  /** 课程色，和课表上那张卡片一致。 */
  accent?: string;
  canEdit?: boolean;
  /** 不是自己的课时写一行说明（TA 的课、共享课表）。 */
  ownerLabel?: string;
  pageStyle?: Record<string, string>;
}>(), {
  scheduleLine: "",
  accent: "var(--schedule-accent)",
  canEdit: false,
  ownerLabel: "",
  pageStyle: () => ({}),
});

const emit = defineEmits<{
  (event: "close"): void;
  (event: "edit"): void;
}>();

function clean(value: string | undefined) {
  const text = String(value ?? "").trim();
  return text || null;
}

/** 合并连续节次时自动生成的「01-02节」不算备注。 */
function noteOf(value: string | undefined) {
  const text = clean(value);
  if (!text) return null;
  return /^(第\s*)?\d+(\s*[-–]\s*\d+)?\s*节$/u.test(text) ? null : text;
}

const details = computed(() => {
  const course = props.block?.course;
  if (!course) return [];
  const rows: Array<{ title: string; icon: Component; value: string | null }> = [
    { title: "教室", icon: Location, value: cleanLocation(course.location) },
    { title: "老师", icon: User, value: clean(course.teacher) },
    { title: "周次", icon: Calendar, value: clean(course.weeks) },
    { title: "备注", icon: Memo, value: noteOf(course.slotNote) },
  ];
  return rows.filter((row): row is { title: string; icon: Component; value: string } => Boolean(row.value));
});

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

watch(() => Boolean(props.block), (open) => {
  if (open) window.addEventListener("keydown", onKeydown);
  else window.removeEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<style scoped lang="scss">
.quick-look-overlay {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(15, 18, 24, 0.36);
}
.quick-look-panel {
  box-sizing: border-box;
  width: 100%;
  max-width: 520px;
  max-height: min(560px, 86dvh);
  overflow-y: auto;
  padding: 24px 20px calc(18px + env(safe-area-inset-bottom));
  border-radius: 20px 20px 0 0;
  background: var(--cpu-card, #fff);
  color: var(--cpu-text, #16191d);
  box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.16);
}
.quick-look-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
// 课程色的竖条和课表上那张卡片一致，和旁边的课名、时间一样高。
.quick-look-bar {
  align-self: stretch;
  flex: 0 0 4px;
  border-radius: 2px;
}
.quick-look-title {
  flex: 1 1 auto;
  min-width: 0;
}
.quick-look-title h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.25;
  word-break: break-word;
}
.quick-look-title p {
  margin: 6px 0 0;
  color: var(--cpu-text-secondary, #4e5661);
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.quick-look-edit,
.quick-look-close {
  flex: 0 0 auto;
  border: 0;
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
}
.quick-look-edit {
  padding: 7px 14px;
  border-radius: 999px;
  background: var(--schedule-accent-pale, rgba(15, 143, 127, 0.1));
  color: var(--schedule-accent-strong, #0f8f7f);
  font-size: 14px;
  font-weight: 600;
}
.quick-look-close {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--cpu-surface-subtle, rgba(127, 127, 127, 0.14));
  color: var(--cpu-text-secondary, #4e5661);
  display: grid;
  place-items: center;
}
.quick-look-details {
  margin: 16px 0 0;
  padding-top: 16px;
  border-top: 1px solid var(--cpu-border-soft, #e4e6ea);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.quick-look-details > div {
  display: flex;
  align-items: baseline;
  gap: 16px;
}
.quick-look-details dt {
  flex: 0 0 auto;
  color: var(--cpu-text-secondary, #4e5661);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}
.quick-look-details dt .el-icon {
  width: 18px;
  transform: translateY(2px);
}
.quick-look-details dd {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 16px;
  line-height: 1.4;
  word-break: break-word;
}
.quick-look-note {
  margin: 16px 0 0;
  color: var(--cpu-text-muted, #666e7a);
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 13px;
  line-height: 1.5;
}
.quick-look-note .el-icon {
  flex: 0 0 auto;
  transform: translateY(3px);
}
.quick-look-note.warn {
  color: #c2410c;
}

@media (min-width: 761px) {
  .quick-look-overlay {
    align-items: center;
  }
  .quick-look-panel {
    max-width: 420px;
    padding: 24px;
    border-radius: 16px;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.22);
  }
}

.quick-look-enter-active,
.quick-look-leave-active {
  transition: opacity 0.2s ease;
}
.quick-look-enter-active .quick-look-panel,
.quick-look-leave-active .quick-look-panel {
  transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.quick-look-enter-from,
.quick-look-leave-to {
  opacity: 0;
}
.quick-look-enter-from .quick-look-panel,
.quick-look-leave-to .quick-look-panel {
  transform: translateY(24px);
}
@media (prefers-reduced-motion: reduce) {
  .quick-look-enter-active,
  .quick-look-leave-active,
  .quick-look-enter-active .quick-look-panel,
  .quick-look-leave-active .quick-look-panel {
    transition: none;
  }
}
</style>
