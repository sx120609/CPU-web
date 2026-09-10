<template>
  <p :class="['privacy-policy-notice', `align-${align}`, `tone-${tone}`, { compact }]">
    <span v-if="prefix">{{ prefix }}</span>
    <button type="button" class="policy-link" @click="openPolicy('privacy')">《隐私政策》</button>
    <span>及</span>
    <button type="button" class="policy-link" @click="openPolicy('terms')">《用户协议》</button>
    <span v-if="suffix">{{ suffix }}</span>
  </p>
  <PolicyDocumentDialog v-model="policyOpen" :document="policyDocument" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import PolicyDocumentDialog from './PolicyDocumentDialog.vue';

const policyOpen = ref(false);
const policyDocument = ref<'privacy' | 'terms'>('privacy');
function openPolicy(document: 'privacy' | 'terms') {
  policyDocument.value = document;
  policyOpen.value = true;
}
withDefaults(defineProps<{
  prefix?: string;
  suffix?: string;
  align?: "left" | "center";
  tone?: "muted" | "accent";
  compact?: boolean;
}>(), {
  prefix: "登录前可先阅读",
  suffix: "，了解账号与身份信息如何被使用。",
  align: "center",
  tone: "muted",
  compact: false,
});
</script>

<style scoped lang="scss">
.privacy-policy-notice {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.7;
}

.privacy-policy-notice.align-center {
  text-align: center;
}

.privacy-policy-notice.align-left {
  text-align: left;
}

.privacy-policy-notice.tone-muted {
  color: var(--cpu-text-secondary);
}

.privacy-policy-notice.tone-accent {
  color: var(--cpu-text-secondary);
}

.privacy-policy-notice.compact {
  margin-top: 8px;
  font-size: 11px;
}

.privacy-policy-notice .policy-link {
  appearance: none;
  display: inline;
  border: 0;
  background: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: var(--cpu-primary);
  text-decoration: none;
  cursor: pointer;
}

.privacy-policy-notice .policy-link:hover {
  text-decoration: underline;
}

.privacy-policy-notice .policy-link:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 3px;
}
</style>
