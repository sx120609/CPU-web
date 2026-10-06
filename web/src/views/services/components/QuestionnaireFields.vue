<template>
  <div class="q-fields">
    <section v-for="(field, index) in fields" :key="field.id" class="q-field">
      <header class="q-field-head">
        <span aria-hidden="true">{{ index + 1 }}</span>
        <div>
          <b>{{ field.label }}<em v-if="field.required" title="必填">*</em></b>
          <p v-if="field.description">{{ field.description }}</p>
        </div>
      </header>

      <el-input
        v-if="field.type === 'text'"
        v-model="answers[field.id] as string"
        :maxlength="field.maxLength || 300"
        :placeholder="field.placeholder"
        clearable
        :disabled="disabled"
      />
      <el-input
        v-else-if="field.type === 'textarea'"
        v-model="answers[field.id] as string"
        type="textarea"
        :rows="5"
        :maxlength="field.maxLength || 2000"
        show-word-limit
        :placeholder="field.placeholder"
        :disabled="disabled"
      />
      <el-radio-group v-else-if="field.type === 'single'" v-model="answers[field.id] as string" class="q-options" :disabled="disabled">
        <el-radio v-for="option in field.options || []" :key="option" :value="option">{{ option }}</el-radio>
      </el-radio-group>
      <el-checkbox-group
        v-else-if="field.type === 'multiple'"
        :model-value="multiValue(field.id)"
        class="q-options"
        :disabled="disabled"
        @change="answers[field.id] = Array.isArray($event) ? $event.map(String) : []"
      >
        <el-checkbox v-for="option in field.options || []" :key="option" :value="option">{{ option }}</el-checkbox>
      </el-checkbox-group>
      <el-input
        v-else-if="field.type === 'number'"
        v-model="answers[field.id] as string"
        type="number"
        :min="field.min"
        :max="field.max"
        :step="field.step || 1"
        :placeholder="field.placeholder || '请输入数字'"
        :disabled="disabled"
      />
      <el-date-picker
        v-else-if="field.type === 'date'"
        :model-value="answers[field.id] as string"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="选择日期"
        :disabled="disabled"
        @update:model-value="answers[field.id] = String($event || '')"
      />
      <div v-else-if="field.type === 'rating'" class="q-rating">
        <button
          v-for="score in ratingRange(field)"
          :key="score"
          data-cpu-button="surface"
          type="button"
          :class="{ active: answers[field.id] === String(score) }"
          :aria-pressed="answers[field.id] === String(score)"
          :disabled="disabled"
          @click="answers[field.id] = answers[field.id] === String(score) ? '' : String(score)"
        >
          {{ score }}
        </button>
        <span>{{ answers[field.id] ? `${answers[field.id]} 分` : "未评分" }}</span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { QuestionnaireField } from "@/api/tools";

// answers 由调用方持有（reactive），这里直接写回对应题目的答案。
const props = defineProps<{
  fields: QuestionnaireField[];
  answers: Record<string, string | string[]>;
  disabled?: boolean;
}>();

function multiValue(fieldId: string) {
  const value = props.answers[fieldId];
  return Array.isArray(value) ? value : [];
}

function ratingRange(field: QuestionnaireField) {
  const min = Math.max(0, Math.round(field.min ?? 1));
  const max = Math.min(10, Math.round(field.max ?? 5));
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
}
</script>

<style scoped>
.q-fields { display: flex; flex-direction: column; }
.q-field {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--cpu-border-soft);
}
.q-field:first-child { padding-top: 0; }
.q-field:last-child { padding-bottom: 0; border-bottom: 0; }

.q-field-head { display: flex; align-items: flex-start; gap: 10px; }
.q-field-head > span {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  margin-top: 1px;
  border-radius: 50%;
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xs);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.q-field-head div { min-width: 0; }
.q-field-head b { color: var(--cpu-text); font-size: var(--cpu-fs-m); font-weight: 500; line-height: 1.6; overflow-wrap: anywhere; }
.q-field-head em { margin-left: 3px; color: var(--cpu-danger); font-style: normal; }
.q-field-head p { margin: 3px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.6; }

.q-options { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.q-options :deep(.el-radio),
.q-options :deep(.el-checkbox) { height: auto; min-height: 32px; margin-right: 0; white-space: normal; }

.q-rating { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.q-rating button {
  width: 40px;
  height: 40px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-card);
  color: var(--cpu-text-secondary);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.q-rating button.active { border-color: transparent; background: var(--cpu-button-primary); color: var(--cpu-button-on-primary); }
.q-rating button:disabled { opacity: .6; cursor: not-allowed; }
.q-rating span { margin-left: 4px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
</style>
