<template>
  <section class="admin-section managers-section">
    <div class="section-head">
      <div>
        <h3>管理器</h3>
        <p>{{ description }}</p>
      </div>
    </div>
    <div class="add-manager">
      <el-input
        v-model="usernameModel"
        placeholder="输入用户名"
        clearable
        :disabled="saving || removingId !== null"
        @keyup.enter="emit('add')"
      />
      <el-button
        type="primary"
        :loading="saving"
        :disabled="saving || removingId !== null || !username.trim()"
        @click="emit('add')"
      >
        添加
      </el-button>
    </div>
    <div class="manager-list">
      <div v-for="manager in managers" :key="manager.id" class="manager-row">
        <div>
          <b>{{ manager.user.nickname || manager.user.username }}</b>
          <span>{{ manager.user.username }}</span>
        </div>
        <el-button
          text
          type="danger"
          :loading="removingId === manager.user.id"
          :disabled="saving || removingId !== null"
          @click="emit('remove', manager.user.id)"
        >
          移除
        </el-button>
      </div>
      <el-empty v-if="!managers.length" description="暂无单独分配的管理器" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolManager } from "@/api/tools";

const props = defineProps<{
  description: string;
  managers: ToolManager[];
  username: string;
  saving: boolean;
  removingId: number | null;
}>();

const emit = defineEmits<{
  "update:username": [value: string];
  add: [];
  remove: [userId: number];
}>();

const usernameModel = computed({
  get: () => props.username,
  set: (value: string) => emit("update:username", value),
});
</script>

<style scoped lang="scss">
.admin-section {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  padding: 16px;
  background: var(--cpu-card);
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.section-head h3 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 16px;
}

.section-head p {
  margin: 5px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.add-manager {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.manager-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.manager-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-subtle);
}

.manager-row div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.manager-row b {
  color: var(--cpu-text);
  overflow-wrap: anywhere;
}

.manager-row span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

@media (max-width: 760px) {
  .admin-section {
    padding: 14px;
  }

  .section-head {
    flex-direction: column;
    align-items: stretch;
  }

  .add-manager {
    flex-direction: column;
  }
}
</style>
