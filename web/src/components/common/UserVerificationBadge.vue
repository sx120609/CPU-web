<template>
  <span
    v-if="verification"
    class="account-verification-badge"
    role="img"
    :aria-label="`已认证：${verification.label}`"
    :title="`拾间认证：${verification.label}`"
  >
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 1.25 12.1 2.5l2.43-.13 1.1 2.17 2.17 1.1-.13 2.43L18.75 10l-1.08 1.93.13 2.43-2.17 1.1-1.1 2.17-2.43-.13L10 18.75 7.9 17.5l-2.43.13-1.1-2.17-2.17-1.1.13-2.43L1.25 10l1.08-1.93-.13-2.43 2.17-1.1 1.1-2.17 2.43.13L10 1.25Z" />
      <path class="verification-check" d="m6.15 10.15 2.35 2.3 5.3-5.25" />
    </svg>
  </span>
</template>

<script setup lang="ts">
import type { AccountVerification } from "@/api/accountVerification";

defineProps<{ verification?: AccountVerification | null }>();
</script>

<style scoped>
.account-verification-badge {
  display: inline-flex;
  width: 21px;
  height: 21px;
  flex: 0 0 21px;
  align-items: center;
  justify-content: center;
  color: #1d9bf0;
  filter: drop-shadow(0 1px 1px rgba(29, 155, 240, .18));
  vertical-align: middle;
}

.account-verification-badge svg { display: block; width: 100%; height: 100%; fill: currentColor; }
.verification-check { fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

@media (max-width: 640px) {
  .account-verification-badge {
    width: 19px;
    height: 19px;
    flex-basis: 19px;
  }
}
</style>
