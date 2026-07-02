<template>
  <section class="admin-section managers-section">
    <div class="section-head">
      <div>
        <h3>使用权限</h3>
        <p>{{ description }}</p>
      </div>
    </div>
    <div class="access-setting">
      <div>
        <b>展示在工具列表</b>
        <span>{{ visibleText }}</span>
      </div>
      <el-switch
        :model-value="visible"
        :loading="saving"
        @change="emit('change:visible', $event)"
      />
    </div>
    <div class="access-setting">
      <div>
        <b>登录后使用</b>
        <span>{{ requireLoginText }}</span>
      </div>
      <el-switch
        :model-value="requireLogin"
        :loading="saving"
        @change="emit('change:requireLogin', $event)"
      />
    </div>
    <div v-if="showPublicManage" class="access-setting">
      <div>
        <b>开放管理入口</b>
        <span>{{ publicManageText }}</span>
      </div>
      <el-switch
        :model-value="allowPublicManage"
        :loading="saving"
        @change="emit('change:publicManage', $event)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  description: string;
  visible: boolean;
  visibleText: string;
  requireLogin: boolean;
  requireLoginText: string;
  allowPublicManage?: boolean;
  publicManageText?: string;
  showPublicManage?: boolean;
  saving?: boolean;
}>(), {
  allowPublicManage: false,
  publicManageText: "",
  showPublicManage: true,
  saving: false,
});

const emit = defineEmits<{
  "change:visible": [value: string | number | boolean];
  "change:requireLogin": [value: string | number | boolean];
  "change:publicManage": [value: string | number | boolean];
}>();
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

.access-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-subtle);
}

.access-setting + .access-setting {
  margin-top: 10px;
}

.access-setting div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.access-setting b {
  color: var(--cpu-text);
}

.access-setting span {
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
}
</style>
