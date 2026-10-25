<template>
  <div class="th-composer">
    <div v-if="pendingImage || uploading" class="th-composer-attach">
      <img v-if="previewUrl" :src="previewUrl" alt="" class="th-composer-thumb" loading="eager" data-image-eager="true" />
      <span v-if="uploading">图片上传中…</span>
      <template v-else-if="pendingImage">
        <span>图片已就绪，可以再写几句一起发送</span>
        <button type="button" class="th-composer-remove" @click="clearImage">移除</button>
      </template>
    </div>
    <div class="th-composer-row">
      <button
        v-if="allowImage"
        type="button"
        class="th-composer-icon"
        aria-label="发送图片"
        :disabled="disabled || uploading"
        @click="fileInput?.click()"
      >
        <el-icon><Picture /></el-icon>
      </button>
      <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden @change="onFile" />
      <el-input
        ref="inputRef"
        v-model="text"
        type="textarea"
        :autosize="{ minRows: 1, maxRows: 5 }"
        :maxlength="maxLength"
        :placeholder="placeholder"
        :disabled="disabled"
        resize="none"
        @keydown.enter="onEnter"
        @focus="emit('focus')"
      />
      <!-- 按下时不让输入框失焦：手机上点发送后键盘不收起，可以接着打字 -->
      <el-button
        type="primary"
        class="th-composer-send"
        :loading="sending"
        :disabled="disabled || uploading || (!text.trim() && !pendingImage)"
        @pointerdown.prevent
        @click="submit"
      >
        发送
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { Picture } from "@element-plus/icons-vue";
import { treeholeApi, type TreeholeImageRef } from "@/api/treehole";
import { errorText } from "./shared";

const props = withDefaults(defineProps<{
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  allowImage?: boolean;
  /** 未发出的草稿只存在本标签页里（sessionStorage），关掉页面就没了。 */
  draftKey?: string;
  send: (payload: { content: string; imageId: number | null }) => Promise<void>;
}>(), {
  placeholder: "说说你的感受…",
  disabled: false,
  maxLength: 2000,
  allowImage: true,
  draftKey: "",
});
const emit = defineEmits<{ (event: "focus"): void }>();

const DRAFT_PREFIX = "cpu-treehole-draft:";
function readDraft() {
  if (!props.draftKey) return "";
  try { return sessionStorage.getItem(DRAFT_PREFIX + props.draftKey) || ""; } catch { return ""; }
}
function writeDraft(value: string) {
  if (!props.draftKey) return;
  try {
    if (value) sessionStorage.setItem(DRAFT_PREFIX + props.draftKey, value);
    else sessionStorage.removeItem(DRAFT_PREFIX + props.draftKey);
  } catch { /* 存不了就算了 */ }
}

const text = ref(readDraft());
const pendingImage = ref<TreeholeImageRef | null>(null);
const previewUrl = ref("");
const uploading = ref(false);
const sending = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const inputRef = ref<{ focus: () => void } | null>(null);

watch(text, (value) => writeDraft(value));
watch(() => props.draftKey, () => { text.value = readDraft(); });

function setPreview(file: File | null) {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = file ? URL.createObjectURL(file) : "";
}

function clearImage() {
  pendingImage.value = null;
  setPreview(null);
}

onBeforeUnmount(() => setPreview(null));

const coarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) {
    ElMessage.warning("图片不能超过 15MB");
    return;
  }
  uploading.value = true;
  setPreview(file);
  try {
    pendingImage.value = await treeholeApi.uploadImage(file);
  } catch {
    // 拦截器已提示
    setPreview(null);
  } finally {
    uploading.value = false;
  }
}

function onEnter(event: Event | KeyboardEvent) {
  const keyboard = event as KeyboardEvent;
  // 手机上回车换行；电脑上回车发送，Shift+回车换行。
  if (coarsePointer || keyboard.shiftKey || keyboard.isComposing) return;
  keyboard.preventDefault();
  void submit();
}

async function submit() {
  const content = text.value.trim();
  if ((!content && !pendingImage.value) || sending.value || props.disabled) return;
  sending.value = true;
  try {
    await props.send({ content, imageId: pendingImage.value?.id ?? null });
    text.value = "";
    clearImage();
    // 电脑上用鼠标点了发送，焦点回到输入框；手机上按钮本来就没抢走焦点。
    if (!coarsePointer) inputRef.value?.focus();
  } catch (error) {
    // 拦截器通常已提示；这里兜底保留输入内容。
    if (!(error as { response?: unknown })?.response) ElMessage.error(errorText(error, "发送失败"));
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.th-composer { display: flex; flex-direction: column; gap: 6px; }
.th-composer-attach {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
}
.th-composer-remove {
  padding: 0;
  border: 0;
  background: none;
  color: var(--cpu-hue-brand-ink);
  font: inherit;
  cursor: pointer;
}
.th-composer-row { display: flex; align-items: flex-end; gap: 8px; }
.th-composer-row :deep(.el-textarea__inner) { min-height: 36px !important; padding: 7px 10px; }
.th-composer-icon {
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex: none;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
  font-size: 18px;
  cursor: pointer;
}
.th-composer-icon:disabled { opacity: 0.5; cursor: not-allowed; }
.th-composer-row .el-button { height: 36px; }
.th-composer-thumb {
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 6px;
  object-fit: cover;
}
@media (pointer: coarse) {
  .th-composer-icon { width: 40px; height: 40px; }
  .th-composer-row :deep(.el-textarea__inner) { min-height: 40px !important; padding: 9px 12px; border-radius: 20px; }
  .th-composer-row .th-composer-send { height: 40px; padding: 0 16px; border-radius: 20px; }
}
</style>
