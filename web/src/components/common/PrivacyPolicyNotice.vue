<template>
  <p :class="['privacy-policy-notice', `align-${align}`, `tone-${tone}`, { compact }]">
    <span v-if="prefix">{{ prefix }}</span>
    <a href="/privacy.html">《隐私政策》</a>
    <span v-if="suffix">{{ suffix }}</span>
  </p>
</template>

<script setup lang="ts">
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
  color: #6b7280;
}

.privacy-policy-notice.tone-accent {
  color: #4b5563;
}

.privacy-policy-notice.compact {
  margin-top: 8px;
  font-size: 11px;
}

.privacy-policy-notice a {
  color: var(--cpu-primary);
  text-decoration: none;
}

.privacy-policy-notice a:hover {
  text-decoration: underline;
}
</style>
