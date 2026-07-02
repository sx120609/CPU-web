<template>
  <div ref="pickerRef" class="theme-picker" :class="{ 'is-colorful': modelValue === 'color-glass' }">
    <button
      type="button"
      class="icon-btn theme-trigger"
      :class="{ active: open }"
      aria-label="选择课表主题"
      title="选择课表主题"
      @click.stop="open = !open"
    >
      <el-icon><Brush /></el-icon>
    </button>

    <div v-if="open" class="theme-panel" role="menu" aria-label="选择课表主题" @click.stop>
      <button
        v-for="theme in scheduleThemeOptions"
        :key="theme.key"
        type="button"
        class="theme-choice"
        :class="{ active: theme.key === modelValue }"
        role="menuitemradio"
        :aria-checked="theme.key === modelValue"
        @click="selectTheme(theme.key)"
      >
        <span class="theme-swatch" :style="{ background: theme.preview }" />
        <span>{{ theme.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { Brush } from "@element-plus/icons-vue";
import { scheduleThemeOptions, type ScheduleThemeKey } from "./scheduleTheme";

defineProps<{ modelValue: ScheduleThemeKey }>();
const emit = defineEmits<{ "update:modelValue": [value: ScheduleThemeKey] }>();

const open = ref(false);
const pickerRef = ref<HTMLElement | null>(null);

function selectTheme(theme: ScheduleThemeKey) {
  emit("update:modelValue", theme);
  open.value = false;
}

function closeFromOutside(event: PointerEvent) {
  const target = event.target as Node | null;
  if (target && pickerRef.value?.contains(target)) return;
  open.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", closeFromOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeFromOutside);
});
</script>

<style scoped lang="scss">
.theme-picker {
  position: relative;
  flex: 0 0 auto;
}

.icon-btn {
  width: 38px;
  height: 38px;
  border: 1px solid var(--schedule-border, var(--cpu-border-soft));
  border-radius: 10px;
  background: var(--schedule-surface-bg, var(--cpu-card));
  color: var(--schedule-text, var(--cpu-text));
  display: grid;
  place-items: center;
  touch-action: manipulation;
  cursor: pointer;
  -webkit-tap-highlight-color: var(--schedule-accent-soft-hover);
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.icon-btn:active {
  background: var(--schedule-surface-bg-soft, var(--cpu-surface-subtle));
}

.icon-btn.active {
  background: var(--schedule-accent);
  border-color: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
}

.theme-picker.is-colorful .icon-btn.active {
  border: 1px solid transparent;
  background:
    linear-gradient(var(--schedule-surface-bg, rgba(255, 255, 255, 0.84)), var(--schedule-surface-bg, rgba(255, 255, 255, 0.84))) padding-box,
    linear-gradient(135deg, rgba(244, 63, 94, 0.58) 0%, rgba(249, 115, 22, 0.50) 22%, rgba(34, 197, 94, 0.45) 48%, rgba(59, 130, 246, 0.54) 74%, rgba(139, 92, 246, 0.52) 100%) border-box;
  color: var(--schedule-text, var(--cpu-text));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.56),
    0 3px 10px rgba(78, 99, 188, 0.07);
}

.icon-btn .el-icon {
  font-size: 18px;
}

.theme-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 30;
  width: 244px;
  max-height: min(360px, calc(100dvh - 92px));
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--schedule-border, var(--cpu-border-soft));
  border-radius: 12px;
  background: var(--schedule-surface-bg, var(--cpu-card));
  box-shadow: 0 12px 30px rgba(24, 34, 51, 0.12);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  overscroll-behavior: contain;
}

.theme-choice {
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--schedule-text-secondary, var(--cpu-text-secondary));
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  padding: 8px 6px;
  display: grid;
  justify-items: center;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.theme-choice:active {
  background: var(--schedule-surface-bg-soft, var(--cpu-surface-subtle));
}

.theme-choice.active {
  border-color: var(--schedule-accent-border);
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
}

.theme-picker.is-colorful .theme-choice.active {
  border-color: transparent;
  background:
    linear-gradient(var(--schedule-surface-bg, rgba(255, 255, 255, 0.84)), var(--schedule-surface-bg, rgba(255, 255, 255, 0.84))) padding-box,
    linear-gradient(135deg, rgba(244, 63, 94, 0.58) 0%, rgba(249, 115, 22, 0.50) 22%, rgba(34, 197, 94, 0.45) 48%, rgba(59, 130, 246, 0.54) 74%, rgba(139, 92, 246, 0.52) 100%) border-box;
  color: var(--schedule-text, var(--cpu-text));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.52);
}

.theme-swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.82);
  box-shadow: inset 0 0 0 1px rgba(24, 34, 51, 0.08);
  flex: 0 0 auto;
}

@media (max-width: 390px) {
  .icon-btn {
    width: 36px;
    height: 36px;
  }

  .theme-panel {
    width: 216px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
