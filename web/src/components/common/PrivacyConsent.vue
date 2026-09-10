<template>
  <div class="privacy-consent">
    <div class="consent-line">
      <el-checkbox :model-value="modelValue" :disabled="disabled" aria-label="我已阅读并同意隐私政策和用户协议" @update:model-value="emit('update:modelValue', $event === true)" />
      <div class="consent-copy">
        我已阅读并同意<button type="button" class="policy-link" @click="openPolicy('privacy')">《隐私政策》</button>及<button type="button" class="policy-link" @click="openPolicy('terms')">《用户协议》</button>
      </div>
    </div>
    <p class="consent-hint">不同意可暂不登录，继续浏览无需登录的内容。</p>
    <PolicyDocumentDialog v-model="policyOpen" :document="policyDocument" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import PolicyDocumentDialog from './PolicyDocumentDialog.vue';

defineProps<{ modelValue: boolean; disabled?: boolean }>();
const emit = defineEmits<{ (event: "update:modelValue", value: boolean): void }>();
const policyOpen = ref(false);
const policyDocument = ref<'privacy' | 'terms'>('privacy');
function openPolicy(document: 'privacy' | 'terms') {
  policyDocument.value = document;
  policyOpen.value = true;
}
</script>

<style scoped>
.privacy-consent { margin: 16px 0; font-size: 13px; line-height: 24px; color: var(--cpu-text-secondary); }
.consent-line { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 6px; align-items: start; }
.privacy-consent :deep(.el-checkbox) { height: 24px; margin: 0; }
.consent-copy { min-width: 0; }
.policy-link { appearance: none; display: inline; margin: 0; padding: 0; border: 0; background: none; color: var(--cpu-primary); font: inherit; line-height: inherit; cursor: pointer; }
.policy-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.policy-link:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 3px; border-radius: 2px; }
.privacy-consent .consent-hint { margin: 4px 0 0 26px; font-size: 12px; line-height: 1.7; }
</style>
