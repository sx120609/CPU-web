<template>
  <div class="privacy-consent">
    <el-checkbox :model-value="modelValue" :disabled="disabled" @update:model-value="emit('update:modelValue', $event === true)">
      我已阅读并同意
    </el-checkbox>
    <span class="policy-links">
      <a href="/privacy.html" target="_blank" rel="noopener">《隐私政策》</a>及
      <a href="/terms.html" target="_blank" rel="noopener">《用户协议》</a>
    </span>
    <p>不同意可暂不登录，继续浏览无需登录的内容。</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean; disabled?: boolean }>();
const emit = defineEmits<{ (event: "update:modelValue", value: boolean): void }>();
</script>

<style scoped>
.privacy-consent { margin: 12px 0; font-size: 13px; line-height: 1.7; color: var(--cpu-text-secondary); }
.privacy-consent :deep(.el-checkbox) { min-height: 44px; height: auto; margin-right: 4px; }
.privacy-consent :deep(.el-checkbox__label) { white-space: normal; }
.policy-links { display: inline-block; }
.policy-links a { color: var(--cpu-primary); text-decoration: underline; text-underline-offset: 3px; }
.policy-links a:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 3px; }
.privacy-consent p { margin: 0; }
</style>
