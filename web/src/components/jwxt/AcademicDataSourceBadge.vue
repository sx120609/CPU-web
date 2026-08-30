<template>
  <el-tooltip v-if="meta" :content="meta.hint" placement="top">
    <el-tag
      class="academic-data-source-badge"
      :type="meta.type"
      effect="plain"
      size="small"
      :aria-label="`当前数据来自${meta.label}`"
    >
      {{ compact ? meta.label : `数据源：${meta.label}` }}
    </el-tag>
  </el-tooltip>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ source?: unknown; compact?: boolean }>();

const meta = computed(() => {
  if (props.source === "modern") {
    return {
      label: "新版教务",
      hint: "本次展示的数据由新版教务接口返回。",
      type: "success" as const,
    };
  }
  if (props.source === "legacy") {
    return {
      label: "旧版教务",
      hint: "本次展示的数据由旧版教务接口返回。",
      type: "warning" as const,
    };
  }
  return null;
});
</script>

<style scoped>
.academic-data-source-badge {
  flex: 0 0 auto;
  font-weight: 600;
}
</style>
