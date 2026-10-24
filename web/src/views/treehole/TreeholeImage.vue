<template>
  <div class="th-image" :style="boxStyle">
    <img
      v-if="url"
      :src="url"
      :class="{ 'is-veiled': veiled }"
      alt="树洞图片"
      loading="eager"
      data-image-eager="true"
      draggable="false"
      @contextmenu.prevent
      @click="open"
    />
    <div v-else class="th-image-placeholder">{{ failed ? "图片无法加载" : "加载中…" }}</div>
    <button v-if="url && veiled" type="button" class="th-image-veil" @click="veiled = false">
      <el-icon aria-hidden="true"><Hide /></el-icon>
      <span>图片可能包含让人不适的内容</span>
      <em>点击查看</em>
    </button>
    <el-dialog v-model="previewOpen" width="min(92vw, 720px)" append-to-body class="th-image-dialog" :show-close="true">
      <div class="th-image-preview" @contextmenu.prevent>
        <img :src="url" alt="树洞图片" loading="eager" data-image-eager="true" draggable="false" />
      </div>
      <p class="th-muted">树洞图片仅限在这里查看，请不要截图或转发，保护好彼此的隐私。</p>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Hide } from "@element-plus/icons-vue";
import type { TreeholeImageRef } from "@/api/treehole";
import { loadTreeholeImageUrl } from "./shared";

const props = defineProps<{ image: TreeholeImageRef; mine?: boolean }>();

const url = ref("");
const failed = ref(false);
const veiled = ref(!props.mine);
const previewOpen = ref(false);

const boxStyle = computed(() => {
  const maxSide = 220;
  const scale = Math.min(1, maxSide / Math.max(props.image.width || 1, props.image.height || 1));
  return {
    width: `${Math.max(80, Math.round((props.image.width || maxSide) * scale))}px`,
    aspectRatio: `${props.image.width || 1} / ${props.image.height || 1}`,
  };
});

async function load() {
  failed.value = false;
  try {
    url.value = await loadTreeholeImageUrl(props.image.id);
  } catch {
    failed.value = true;
  }
}

function open() {
  if (veiled.value) {
    veiled.value = false;
    return;
  }
  previewOpen.value = true;
}

onMounted(load);
watch(() => props.image.id, load);
</script>

<style scoped>
.th-image {
  position: relative;
  max-width: 100%;
  overflow: hidden;
  border-radius: 10px;
  background: var(--cpu-surface-subtle);
  -webkit-touch-callout: none;
  user-select: none;
}
.th-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: zoom-in;
  transition: filter 0.2s;
}
.th-image img.is-veiled { filter: blur(18px) brightness(0.85); }
.th-image-placeholder {
  display: flex;
  height: 100%;
  min-height: 80px;
  align-items: center;
  justify-content: center;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}
.th-image-veil {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px;
  border: 0;
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  font: inherit;
  font-size: var(--cpu-fs-xs);
  text-align: center;
  cursor: pointer;
}
.th-image-veil em { font-style: normal; font-weight: 600; }
.th-image-preview {
  display: flex;
  justify-content: center;
  -webkit-touch-callout: none;
  user-select: none;
}
.th-image-preview img {
  max-width: 100%;
  max-height: 70vh;
  border-radius: 8px;
  pointer-events: none;
}
</style>
