<template>
  <span class="display-nickname" :aria-label="resolvedName">
    <template v-for="(part, index) in parts" :key="`${index}-${part.value}`">
      <span v-if="part.symbol" class="nickname-symbol" aria-hidden="true">{{ part.value }}</span>
      <span v-else aria-hidden="true">{{ part.value }}</span>
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{ name?: string | null }>(), {
  name: "",
});

const resolvedName = computed(() => String(props.name || ""));
const parts = computed(() => resolvedName.value
  .split(/([♂♀⚧]\uFE0F?)/u)
  .filter(Boolean)
  .map((value) => ({
    value,
    symbol: /^[♂♀⚧]/u.test(value),
  })));
</script>

<style scoped>
.display-nickname {
  min-width: 0;
}

.nickname-symbol {
  display: inline-block;
  font-family: "Inter Variable", sans-serif;
  font-size: .9em;
  font-variant-emoji: text;
  line-height: 1;
  vertical-align: .08em;
  transform: translateY(-.06em);
}
</style>
