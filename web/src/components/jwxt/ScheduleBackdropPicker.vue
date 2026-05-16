<template>
  <div ref="pickerRef" class="backdrop-picker">
    <button
      type="button"
      class="icon-btn backdrop-trigger"
      :class="{ active: open || hasImage }"
      aria-label="设置课表背景"
      title="设置课表背景"
      @click.stop="open = !open"
    >
      <el-icon><PictureFilled /></el-icon>
    </button>

    <div v-if="open" class="backdrop-panel" @click.stop>
      <div class="preview" :class="{ empty: !hasImage }" :style="previewStyle">
        <div class="preview-mask" />
        <div class="preview-card">
          <b>课表预览</b>
          <span>会自动压暗、柔焦，再用半透明面板托住内容。</span>
        </div>
      </div>

      <p class="backdrop-note">
        背景图只保存在当前设备，不会上传到服务器。
      </p>

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
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { PictureFilled } from "@element-plus/icons-vue";
import { compressImageFile } from "@/utils/imageUpload";

const props = defineProps<{ modelValue?: string | null }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const open = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);
const pickerRef = ref<HTMLElement | null>(null);

const hasImage = computed(() => Boolean((props.modelValue ?? "").trim()));
const previewStyle = computed(() => {
  const image = (props.modelValue ?? "").trim();
  return image ? { backgroundImage: `url("${image}")` } : {};
});

function pickImage() {
  inputRef.value?.click();
}

function clearImage() {
  emit("update:modelValue", "");
  ElMessage.success("已移除课表背景");
  open.value = false;
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
    emit("update:modelValue", dataUrl);
    ElMessage.success("课表背景已更新");
    open.value = false;
  } catch (error: any) {
    ElMessage.error(error?.message || "背景图处理失败");
  } finally {
    if (target) target.value = "";
  }
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
.backdrop-picker {
  position: relative;
  flex: 0 0 auto;
}

.icon-btn {
  width: 38px;
  height: 38px;
  border: 1px solid #dde4ee;
  border-radius: 10px;
  background: #fff;
  color: #172033;
  display: grid;
  place-items: center;
  touch-action: manipulation;
  cursor: pointer;
  -webkit-tap-highlight-color: var(--schedule-accent-soft-hover);
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
}

.icon-btn:active {
  background: #f3f4f6;
}

.icon-btn.active {
  background: var(--schedule-accent);
  border-color: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
}

.icon-btn .el-icon {
  font-size: 18px;
}

.backdrop-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 30;
  width: min(280px, calc(100vw - 24px));
  padding: 10px;
  border: 1px solid rgba(222, 229, 239, 0.92);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 12px 30px rgba(24, 34, 51, 0.12);
}

.preview {
  position: relative;
  height: 136px;
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
  padding: 12px 13px;
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
  gap: 4px;
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

.backdrop-note {
  margin: 10px 2px 0;
  font-size: 12px;
  line-height: 1.5;
  color: #667085;
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
  font-weight: 600;
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

:global(.theme-color-glass) .icon-btn,
:global(.has-custom-bg) .icon-btn {
  border-color: rgba(255, 255, 255, 0.62);
  background: rgba(255, 255, 255, 0.72);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.66),
    0 6px 18px rgba(36, 58, 91, 0.06);
  backdrop-filter: blur(12px) saturate(135%);
  -webkit-backdrop-filter: blur(12px) saturate(135%);
}

:global(.theme-color-glass) .icon-btn.active,
:global(.has-custom-bg) .icon-btn.active {
  border-color: rgba(255, 255, 255, 0.62);
  background: linear-gradient(135deg, rgba(22, 135, 118, 0.88), rgba(59, 130, 246, 0.76));
  color: #fff;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.30),
    0 8px 20px rgba(22, 135, 118, 0.14);
}

:global(.theme-color-glass) .backdrop-panel,
:global(.has-custom-bg) .backdrop-panel {
  border-color: rgba(255, 255, 255, 0.68);
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 14px 34px rgba(36, 58, 91, 0.12);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
}

@media (max-width: 390px) {
  .icon-btn {
    width: 36px;
    height: 36px;
  }

  .backdrop-panel {
    width: min(260px, calc(100vw - 20px));
  }

  .backdrop-actions {
    grid-template-columns: 1fr;
  }
}
</style>
