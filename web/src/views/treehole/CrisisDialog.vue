<template>
  <el-dialog :model-value="modelValue" title="高危转介" width="min(92vw, 520px)" append-to-body @update:model-value="emit('update:modelValue', $event)">
    <div class="th-notice is-warn">
      提交后会立即告警给全部核心管理员，来访者的对话框会常驻显示心理发展中心的求助方式。提交后标签不能撤回。
    </div>
    <form class="th-form th-crisis-form" @submit.prevent="submit">
      <div class="th-field">
        <label for="th-crisis-type">危机类型</label>
        <el-select id="th-crisis-type" v-model="form.crisisType" placeholder="请选择">
          <el-option v-for="type in CRISIS_TYPES" :key="type" :label="type" :value="type" />
        </el-select>
      </div>
      <div class="th-field">
        <span class="th-field-label">紧急等级</span>
        <el-radio-group v-model="form.urgency">
          <el-radio-button v-for="item in URGENCY_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
        </el-radio-group>
      </div>
      <div class="th-field">
        <label for="th-crisis-state">学生当下状态</label>
        <el-input id="th-crisis-state" v-model="form.currentState" type="textarea" :rows="3" maxlength="1000" show-word-limit placeholder="情绪、言语中的风险信号、是否有具体计划等" />
      </div>
      <div class="th-field">
        <label for="th-crisis-record">洞主初步陪伴记录</label>
        <el-input id="th-crisis-record" v-model="form.hostRecord" type="textarea" :rows="3" maxlength="2000" show-word-limit placeholder="你做了哪些陪伴和引导、对方的回应" />
      </div>
      <el-checkbox v-model="form.requestReveal">建议实名溯源（需两名核心管理员审批）</el-checkbox>
      <div v-if="form.requestReveal" class="th-field">
        <label for="th-crisis-reveal">溯源理由</label>
        <el-input id="th-crisis-reveal" v-model="form.revealReason" type="textarea" :rows="2" maxlength="500" placeholder="为什么需要线下干预" />
      </div>
    </form>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="danger" :loading="submitting" :disabled="!ready" @click="submit">提交并告警</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { TreeholeCrisisInput } from "@/api/treehole";
import { CRISIS_TYPES, URGENCY_OPTIONS } from "./shared";

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
  (event: "submit", value: TreeholeCrisisInput, done: (ok: boolean) => void): void;
}>();

const form = reactive<TreeholeCrisisInput>({
  crisisType: "",
  urgency: "high",
  currentState: "",
  hostRecord: "",
  requestReveal: false,
  revealReason: "",
});
const submitting = ref(false);

const ready = computed(() => Boolean(
  form.crisisType
  && form.currentState.trim().length >= 2
  && form.hostRecord.trim().length >= 2
  && (!form.requestReveal || form.revealReason.trim().length >= 2),
));

function submit() {
  if (!ready.value || submitting.value) return;
  submitting.value = true;
  emit("submit", { ...form }, (ok) => {
    submitting.value = false;
    if (ok) emit("update:modelValue", false);
  });
}
</script>

<style scoped>
.th-crisis-form { margin-top: 12px; }
</style>
