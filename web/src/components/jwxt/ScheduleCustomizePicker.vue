<template>
  <div ref="pickerRef" class="customize-picker">
    <button
      ref="triggerRef"
      type="button"
      class="custom-trigger"
      :class="{ active: open || hasImage }"
      aria-label="自定义课表样式"
      title="自定义"
      @click.stop="togglePanel"
    >
      <el-icon><Brush /></el-icon>
      <span>自定义</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        class="customize-panel"
        :class="{ 'is-glass': panelIsGlass }"
        :style="[panelStyle, panelThemeVars]"
        role="menu"
        aria-label="自定义课表样式"
        @click.stop
      >
        <section class="panel-section" aria-label="颜色选择">
          <div class="section-title">
            <span>颜色</span>
          </div>
          <div class="theme-grid">
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
        </section>

        <section class="panel-section" aria-label="背景选择">
          <div class="section-title">
            <span>背景</span>
          </div>

          <div class="preview" :class="{ empty: !hasImage }" :style="previewStyle">
            <div class="preview-mask" />
            <div class="preview-card">
              <b>课表预览</b>
              <span>背景图只保存在当前设备。</span>
            </div>
          </div>

          <div class="backdrop-actions">
            <button type="button" class="action-btn primary" @click="pickImage">
              {{ hasImage ? "更换图片" : "上传图片" }}
            </button>
            <button v-if="hasImage" type="button" class="action-btn" @click="clearImage">
              移除背景
            </button>
          </div>

          <input
            ref="inputRef"
            class="file-input"
            type="file"
            accept="image/*"
            @change="onFileChange"
          />
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { Brush } from "@element-plus/icons-vue";
import { compressImageFile } from "@/utils/imageUpload";
import { scheduleThemeCssVars, scheduleThemeOptions, type ScheduleThemeKey } from "./scheduleTheme";

const props = defineProps<{
  theme: ScheduleThemeKey;
  backdrop?: string | null;
}>();

const emit = defineEmits<{
  "update:theme": [value: ScheduleThemeKey];
  "update:backdrop": [value: string];
}>();

const open = ref(false);
const pickerRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

const hasImage = computed(() => Boolean((props.backdrop ?? "").trim()));
const panelIsGlass = computed(() => props.theme === "color-glass" || hasImage.value);
const panelThemeVars = computed(() => scheduleThemeCssVars(props.theme));
const previewStyle = computed(() => {
  const image = (props.backdrop ?? "").trim();
  return image ? { backgroundImage: `url("${image}")` } : {};
});

function togglePanel() {
  open.value = !open.value;
}

function selectTheme(nextTheme: ScheduleThemeKey) {
  emit("update:theme", nextTheme);
}

function pickImage() {
  inputRef.value?.click();
}

function clearImage() {
  emit("update:backdrop", "");
  ElMessage.success("已移除课表背景");
}

async function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const file = target?.files?.[0];
  if (!file) return;

  try {
    const dataUrl = await compressImageFile(file, {
      maxWidth: 1600,
      maxHeight: 1600,
      quality: 0.74,
      mimeType: "image/jpeg",
      maxBytes: 420 * 1024,
    });
    emit("update:backdrop", dataUrl);
    ElMessage.success("课表背景已更新");
  } catch (error: any) {
    ElMessage.error(error?.message || "背景图处理失败");
  } finally {
    if (target) target.value = "";
  }
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
  const panelWidth = Math.min(viewportWidth - margin * 2, viewportWidth <= 390 ? 300 : 332);
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

.custom-trigger {
  height: 38px;
  min-width: 76px;
  padding: 0 10px;
  border: 1px solid #dde4ee;
  border-radius: 10px;
  background: #fff;
  color: #172033;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  touch-action: manipulation;
  cursor: pointer;
  -webkit-tap-highlight-color: var(--schedule-accent-soft-hover);
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
}

.custom-trigger:active {
  background: #f3f4f6;
}

.custom-trigger.active {
  background: var(--schedule-accent);
  border-color: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
}

.custom-trigger .el-icon {
  font-size: 17px;
}

.customize-panel {
  position: fixed;
  z-index: 4000;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px;
  border: 1px solid rgba(222, 229, 239, 0.92);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 18px 44px rgba(24, 34, 51, 0.18);
}

.customize-panel.is-glass {
  border-color: rgba(255, 255, 255, 0.68);
  background: rgba(255, 255, 255, 0.90);
  box-shadow: 0 18px 44px rgba(36, 58, 91, 0.16);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
}

.panel-section + .panel-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(222, 229, 239, 0.86);
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 2px 8px;
  color: #172033;
  font-size: 13px;
  font-weight: 800;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.theme-choice {
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: #374151;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  padding: 8px 5px;
  display: grid;
  justify-items: center;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.theme-choice:active {
  background: #f3f4f6;
}

.theme-choice.active {
  border-color: var(--schedule-accent-border);
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
}

.theme-swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.82);
  box-shadow: inset 0 0 0 1px rgba(24, 34, 51, 0.08);
}

.preview {
  position: relative;
  height: 132px;
  border-radius: 12px;
  overflow: hidden;
  background:
    radial-gradient(circle at 16% 14%, rgba(157, 214, 255, 0.38), transparent 28%),
    linear-gradient(135deg, #edf7f5 0%, #f7fbff 100%);
  background-size: cover;
  background-position: center;
  border: 1px solid rgba(221, 228, 238, 0.92);
}

.preview.empty::before {
  content: "还没有背景图";
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 700;
  color: #526073;
  z-index: 1;
}

.preview-mask {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(13, 22, 38, 0.18) 0%, rgba(248, 251, 255, 0.58) 54%, rgba(252, 253, 255, 0.88) 100%);
  backdrop-filter: blur(5px) saturate(110%);
  -webkit-backdrop-filter: blur(5px) saturate(110%);
}

.preview-card {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 2;
  padding: 11px 12px;
  border: 1px solid rgba(255, 255, 255, 0.64);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.58),
    0 10px 22px rgba(24, 34, 51, 0.08);
  backdrop-filter: blur(14px) saturate(135%);
  -webkit-backdrop-filter: blur(14px) saturate(135%);
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.preview-card b {
  font-size: 13px;
  color: #172033;
}

.preview-card span {
  font-size: 11px;
  line-height: 1.45;
  color: #526073;
}

.backdrop-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.action-btn {
  min-height: 36px;
  border: 1px solid #d7dfeb;
  border-radius: 10px;
  background: #fff;
  color: #374151;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.action-btn.primary {
  border-color: var(--schedule-accent);
  background: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
}

.file-input {
  display: none;
}

:global(.theme-color-glass) .custom-trigger,
:global(.has-custom-bg) .custom-trigger {
  border-color: rgba(255, 255, 255, 0.62);
  background: rgba(255, 255, 255, 0.70);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.66),
    0 6px 18px rgba(36, 58, 91, 0.06);
  backdrop-filter: blur(12px) saturate(135%);
  -webkit-backdrop-filter: blur(12px) saturate(135%);
}

:global(.theme-color-glass) .custom-trigger.active,
:global(.has-custom-bg) .custom-trigger.active {
  border-color: rgba(255, 255, 255, 0.62);
  background: linear-gradient(135deg, rgba(22, 135, 118, 0.88), rgba(59, 130, 246, 0.76));
  color: #fff;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.30),
    0 8px 20px rgba(22, 135, 118, 0.14);
}

@media (max-width: 390px) {
  .custom-trigger {
    height: 36px;
    min-width: 68px;
    padding: 0 8px;
    font-size: 12px;
  }

  .theme-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .backdrop-actions {
    grid-template-columns: 1fr;
  }
}
</style>
