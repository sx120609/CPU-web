<template>
  <div class="identity-picker" :class="{ compact }">
    <div v-if="showCopy" class="identity-copy">
      <b>{{ label }}</b>
      <span v-if="hint">{{ hint }}</span>
    </div>
    <div class="identity-switch" :aria-label="ariaLabel" role="radiogroup">
      <button
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
}

.identity-copy {
  display: grid;
  gap: 4px;
}

.identity-copy b {
  font-size: 13px;
  color: #172033;
}

.identity-copy span {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.6;
}

.identity-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.identity-picker.compact .identity-switch {
  gap: 6px;
}

.identity-option {
  min-width: 0;
  border: 1px solid #dce3ee;
  border-radius: 12px;
  background: #f8fafc;
  color: #475467;
  padding: 11px 12px;
  display: grid;
  gap: 4px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}

.identity-picker.compact .identity-option {
  min-height: 36px;
  padding: 0 12px;
  place-items: center;
  text-align: center;
}

.identity-option strong {
  font-size: 14px;
  color: inherit;
}

.identity-picker.compact .identity-option strong {
  font-size: 13px;
  line-height: 1;
}

.identity-option small {
  font-size: 11px;
  line-height: 1.5;
  color: inherit;
  opacity: 0.92;
}

.identity-option:hover:not(:disabled) {
  border-color: rgba(22, 135, 118, 0.4);
  box-shadow: 0 6px 18px rgba(22, 135, 118, 0.08);
}

.identity-option.active {
  border-color: var(--cpu-primary);
  background: linear-gradient(135deg, rgba(22, 135, 118, 0.12), rgba(232, 163, 23, 0.08));
  color: #0f5f52;
}

.identity-option:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

@media (max-width: 520px) {
  .identity-option {
    padding: 10px;
  }
}
</style>
