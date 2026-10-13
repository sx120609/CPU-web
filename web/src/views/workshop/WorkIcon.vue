<template>
  <span
    class="wk-icon"
    :class="`is-${type || 'tool'}`"
    :data-hue="workHue(slug)"
    :style="{ '--wk-icon-size': `${size}px` }"
    aria-hidden="true"
  >
    <span class="wk-icon-glyph">{{ workGlyph(name) }}</span>
    <el-icon class="wk-icon-mark"><component :is="mark" /></el-icon>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Aim, Connection, SetUp } from "@element-plus/icons-vue";
import type { WorkshopType } from "@/api/workshop";
import { workGlyph, workHue } from "./shared";

const props = withDefaults(
  defineProps<{ slug: string; name: string; type?: WorkshopType; size?: number }>(),
  { size: 56 },
);
const mark = computed(() =>
  props.type === "game" ? Aim : props.type === "extension" ? Connection : SetUp,
);
</script>

<style scoped>
.wk-icon {
  position: relative;
  display: grid;
  width: var(--wk-icon-size);
  height: var(--wk-icon-size);
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border-radius: calc(var(--wk-icon-size) * 0.24);
  background: var(--cpu-hue-bg);
  color: var(--cpu-hue-ink);
  user-select: none;
}
.wk-icon-glyph {
  font-size: calc(var(--wk-icon-size) * 0.46);
  font-weight: 700;
  line-height: 1;
}
/* 右下角的小记号区分游戏、工具和扩展；图标很小时不显示。 */
.wk-icon-mark {
  position: absolute;
  right: calc(var(--wk-icon-size) * 0.09);
  bottom: calc(var(--wk-icon-size) * 0.09);
  font-size: calc(var(--wk-icon-size) * 0.2);
  opacity: 0.55;
}
</style>
