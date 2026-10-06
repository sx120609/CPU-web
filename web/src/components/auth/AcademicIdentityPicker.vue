<template>
  <div class="identity-picker" :class="{ compact }">
    <div v-if="showCopy" class="identity-copy">
      <b>{{ label }}</b>
      <span v-if="hint">{{ hint }}</span>
    </div>
    <div class="identity-switch" :aria-label="ariaLabel" role="radiogroup">
      <button data-cpu-button="option"
        v-for="option in academicIdentityOptions"
        :key="option.value"
        type="button"
        class="identity-option"
        :class="{ active: currentValue === option.value }"
        :disabled="disabled"
        role="radio"
        :aria-checked="currentValue === option.value"
        @click="updateValue(option.value)"
      >
        <strong>{{ compact ? option.shortLabel : option.label }}</strong>
        <small v-if="!compact">{{ option.description }}</small>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  academicIdentityOptions,
  normalizeAcademicIdentity,
  type AcademicIdentity,
} from "@/utils/academicIdentity";

const props = withDefaults(defineProps<{
  modelValue: AcademicIdentity;
  compact?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
  ariaLabel?: string;
}>(), {
  compact: false,
  disabled: false,
  label: "",
  hint: "",
  ariaLabel: "选择身份",
});

const emit = defineEmits<{
  (event: "update:modelValue", value: AcademicIdentity): void;
}>();

const currentValue = computed(() => normalizeAcademicIdentity(props.modelValue));
const showCopy = computed(() => Boolean(props.label || props.hint) && !props.compact);

function updateValue(value: AcademicIdentity) {
  if (props.disabled || value === currentValue.value) return;
  emit("update:modelValue", value);
}
</script>

<style scoped lang="scss">
.identity-picker {
  display: grid;
  gap: 10px;
}

.identity-picker.compact {
  gap: 0;
  width: fit-content;
  max-width: 100%;
}

.identity-copy {
  display: grid;
  gap: 4px;
}

.identity-copy b {
  font-size: var(--cpu-fs-s);
  color: var(--cpu-text);
  letter-spacing: 0.02em;
}

.identity-copy span {
  font-size: var(--cpu-fs-xs);
  color: var(--cpu-text-muted);
  line-height: 1.65;
}

.identity-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 6px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface-soft);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.identity-picker.compact .identity-switch {
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(52px, auto));
  width: fit-content;
  gap: 4px;
  padding: 4px;
  border-radius: var(--cpu-radius-pill);
  background: rgba(255, 255, 255, 0.72);
}

.identity-option {
  min-width: 0;
  min-height: 76px;
  border: 1px solid transparent;
  border-radius: var(--cpu-radius-l);
  background: rgba(255, 255, 255, 0.92);
  color: var(--cpu-text-secondary);
  padding: 13px 14px 12px;
  display: grid;
  gap: 4px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.identity-picker.compact .identity-option {
  min-height: 34px;
  padding: 0 16px;
  place-items: center;
  text-align: center;
  border-radius: var(--cpu-radius-pill);
  background: transparent;
  box-shadow: none;
}

.identity-option strong {
  font-size: var(--cpu-fs-m);
  color: inherit;
  line-height: 1.2;
}

.identity-picker.compact .identity-option strong {
  font-size: var(--cpu-fs-s);
  line-height: 1;
}

.identity-option small {
  font-size: var(--cpu-fs-xs);
  line-height: 1.55;
  color: inherit;
  opacity: 0.9;
}

.identity-option:hover:not(:disabled) {
  border-color: rgba(22, 135, 118, 0.22);
  transform: translateY(-1px);
}

.identity-option.active {
  border-color: rgba(22, 135, 118, 0.26);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  transform: translateY(-1px);
}

.identity-picker.compact .identity-option.active {
  border-color: transparent;
  background: var(--cpu-primary-soft);
  transform: none;
}

.identity-option:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

@media (max-width: 520px) {
  .identity-switch {
    padding: 5px;
    border-radius: var(--cpu-radius-l);
  }

  .identity-option {
    min-height: 72px;
    padding: 12px;
  }
}
</style>
