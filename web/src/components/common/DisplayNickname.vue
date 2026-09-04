<template>
  <span class="display-nickname" :aria-label="resolvedName">
    <template v-for="(part, index) in parts" :key="`${index}-${part.value}`">
      <span v-if="part.symbol" class="nickname-symbol" aria-hidden="true">{{ part.value }}</span>
      <span v-else class="nickname-text" aria-hidden="true">{{ part.value }}</span>
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{ name?: string | null }>(), {
  name: "",
});

const resolvedName = computed(() => String(props.name || "").trim() || "药大同学");
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
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  line-height: inherit;
}

.nickname-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.nickname-symbol {
  position: relative;
  top: -.16em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-inline: .03em;
  font-family: "Inter Variable", "Segoe UI Symbol", sans-serif;
  font-size: .86em;
  font-variant-emoji: text;
  line-height: 1;
}
</style>
