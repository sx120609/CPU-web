<template>
  <div ref="pickerRef" class="customize-picker" :class="{ 'is-colorful': theme === 'color-glass' }">
    <button
      ref="triggerRef"
      type="button"
      class="icon-trigger"
      :class="{ active: open }"
      aria-label="选择课表主题"
      title="选择课表主题"
      @click.stop="togglePanel"
    >
      <el-icon><Brush /></el-icon>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        class="theme-panel"
        :class="{ 'is-colorful': theme === 'color-glass' }"
        :style="[panelStyle, panelThemeVars]"
        role="menu"
        aria-label="选择课表主题"
        @click.stop
      >
        <button
          v-for="themeOption in scheduleThemeOptions"
          :key="themeOption.key"
          type="button"
          class="theme-choice"
          :class="{ active: themeOption.key === theme }"
          role="menuitemradio"
          :aria-checked="themeOption.key === theme"
          @click="selectTheme(themeOption.key)"
        >
          <span class="theme-swatch" :style="{ background: themeOption.preview }" />
          <span>{{ themeOption.label }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Brush } from "@element-plus/icons-vue";
import { scheduleThemeCssVars, scheduleThemeOptions, type ScheduleThemeKey } from "./scheduleTheme";

const props = defineProps<{ theme: ScheduleThemeKey }>();
const emit = defineEmits<{ "update:theme": [value: ScheduleThemeKey] }>();

const open = ref(false);
const pickerRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

const panelThemeVars = computed(() => scheduleThemeCssVars(props.theme));

function togglePanel() {
  open.value = !open.value;
}

function selectTheme(nextTheme: ScheduleThemeKey) {
  emit("update:theme", nextTheme);
  open.value = false;
}

function closeFromOutside(event: PointerEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  if (pickerRef.value?.contains(target) || panelRef.value?.contains(target)) return;
  open.value = false;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") open.value = false;
}

function updatePanelPosition() {
  const trigger = triggerRef.value;
  if (!trigger) return;

  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = viewportWidth <= 390 ? 10 : 12;
  const panelWidth = Math.min(viewportWidth - margin * 2, viewportWidth <= 390 ? 216 : 244);
  const left = Math.max(margin, Math.min(rect.right - panelWidth, viewportWidth - panelWidth - margin));
  const top = Math.min(rect.bottom + 8, viewportHeight - margin);

  panelStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${panelWidth}px`,
    maxHeight: `${Math.max(220, viewportHeight - top - margin)}px`,
  };
}

watch(open, async (isOpen) => {
  if (!isOpen) return;
  await nextTick();
  updatePanelPosition();
});

onMounted(() => {
  document.addEventListener("pointerdown", closeFromOutside);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", updatePanelPosition);
  window.addEventListener("scroll", updatePanelPosition, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeFromOutside);
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", updatePanelPosition);
  window.removeEventListener("scroll", updatePanelPosition, true);
});
</script>

<style scoped lang="scss">
.customize-picker {
  flex: 0 0 auto;
}

.icon-trigger {
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
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
}

.icon-trigger:active {
  background: var(--schedule-surface-bg-soft, var(--cpu-surface-subtle));
}

.icon-trigger.active {
  background: var(--schedule-accent);
  border-color: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
}

.customize-picker.is-colorful .icon-trigger.active {
  border: 1px solid transparent;
  background:
    linear-gradient(var(--schedule-surface-bg, rgba(255, 255, 255, 0.84)), var(--schedule-surface-bg, rgba(255, 255, 255, 0.84))) padding-box,
    linear-gradient(135deg, rgba(244, 63, 94, 0.58) 0%, rgba(249, 115, 22, 0.50) 22%, rgba(34, 197, 94, 0.45) 48%, rgba(59, 130, 246, 0.54) 74%, rgba(139, 92, 246, 0.52) 100%) border-box;
  color: var(--schedule-text, var(--cpu-text));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.56),
    0 3px 10px rgba(78, 99, 188, 0.07);
}

.icon-trigger .el-icon {
  font-size: 18px;
}

.theme-panel {
  position: fixed;
  z-index: 4000;
  max-height: min(360px, calc(100dvh - 92px));
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px;
  border: 1px solid var(--schedule-border, var(--cpu-border-soft));
  border-radius: 12px;
  background: var(--schedule-surface-bg, var(--cpu-card));
  box-shadow: 0 18px 44px rgba(24, 34, 51, 0.18);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
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

.theme-panel.is-colorful .theme-choice.active {
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
}

@media (max-width: 390px) {
  .icon-trigger {
    width: 36px;
    height: 36px;
  }
}
</style>
