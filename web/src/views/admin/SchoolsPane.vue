<template>
  <section class="settings-card" v-loading="loading">
    <div class="pane-head">
      <div>
        <h2>学校与功能</h2>
        <p>每所学校单独开关各个功能，关掉后该校用户访问对应接口会返回 404。还没按学校隔离的功能只有药大能开，隔离完成后才对其他学校放开。</p>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="mb" />

    <div v-for="school in schools" :key="school.id" class="school">
      <div class="school-head">
        <h3>{{ school.name }}</h3>
        <span class="meta">{{ school.brandName }} · {{ school.id }} · {{ school.academicSystem }}</span>
      </div>
      <div class="module-list">
        <div v-for="module in school.modules" :key="module.key" class="module-row">
          <div class="module-copy">
            <span class="module-label">{{ module.label }}</span>
            <el-tag size="small" :type="isolationTag[module.isolation].type">{{ isolationTag[module.isolation].label }}</el-tag>
            <span v-if="!module.available" class="hint">{{ module.isolation === "pending" ? "隔离完成前不能对该校开放" : "没有该校的实现" }}</span>
            <span v-else-if="module.override !== null" class="hint">已改动，默认{{ module.defaultEnabled ? "开" : "关" }}</span>
          </div>
          <el-switch
            :model-value="module.enabled"
            :disabled="!module.available || savingSchool === school.id"
            :loading="savingKey === `${school.id}:${module.key}`"
            @change="(value: string | number | boolean) => toggle(school, module, Boolean(value))"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { adminApi, type AdminSchool, type AdminSchoolModuleState, type SchoolModuleIsolation } from "@/api/admin";

const isolationTag: Record<SchoolModuleIsolation, { label: string; type: "success" | "info" | "warning" }> = {
  school: { label: "各校独立", type: "success" },
  global: { label: "与学校无关", type: "info" },
  pending: { label: "待隔离", type: "warning" },
};

const schools = ref<AdminSchool[]>([]);
const loading = ref(false);
const error = ref("");
const savingSchool = ref("");
const savingKey = ref("");

async function load() {
  loading.value = true; error.value = "";
  try { schools.value = await adminApi.schools({ cacheTtlMs: 0 }); }
  catch (e) { error.value = e instanceof Error ? e.message : "学校列表加载失败"; }
  finally { loading.value = false; }
}

async function toggle(school: AdminSchool, module: AdminSchoolModuleState, enabled: boolean) {
  const modules = Object.fromEntries(school.modules.map((item) => [item.key, item.key === module.key ? enabled : item.enabled]));
  savingSchool.value = school.id;
  savingKey.value = `${school.id}:${module.key}`;
  try {
    school.modules = await adminApi.saveSchoolModules(school.id, modules);
    ElMessage.success(`${school.shortName}「${module.label}」已${enabled ? "开启" : "关闭"}`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "保存失败");
  } finally {
    savingSchool.value = "";
    savingKey.value = "";
  }
}

onMounted(load);
</script>

<style scoped>
.settings-card { background: var(--cpu-card); border: 1px solid var(--cpu-border-soft); border-radius: 8px; padding: 18px; }
.pane-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
h2 { margin: 0; font-size: 18px; } p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: 13px; }
.mb { margin-bottom: 14px; }
.school + .school { margin-top: 24px; }
.school-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
h3 { margin: 0; font-size: 16px; }
.meta, .hint { color: var(--cpu-text-secondary); font-size: 12px; }
.module-list { border: 1px solid var(--cpu-border-soft); border-radius: 8px; }
.module-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; }
.module-row + .module-row { border-top: 1px solid var(--cpu-border-soft); }
.module-copy { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.module-label { font-size: 14px; }
</style>
