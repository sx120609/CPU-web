<template>
  <section class="settings-card" v-loading="loading">
    <div class="pane-head">
      <div>
        <h2>学校与功能</h2>
        <p>拾间品牌下的各所学校。每所学校单独开关各个功能，关掉后该校用户看不到入口，访问对应接口会返回 404；只有某校才有实现的功能，其他学校不能打开。</p>
      </div>
      <div class="head-actions">
        <el-button v-if="platformAdmin" type="primary" @click="openCreate">新建学校</el-button>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="mb" />

    <div v-for="school in schools" :key="school.id" class="school">
      <div class="school-head">
        <div class="school-title">
          <h3>{{ school.brandName }}</h3>
          <el-tag size="small" :type="school.enabled ? 'success' : 'info'">{{ school.enabled ? "开放中" : "未开放" }}</el-tag>
        </div>
        <span class="meta">{{ school.name }} · {{ school.shortName }} · {{ school.id }} · {{ school.ssoLogin ? "统一认证登录" : "站内账号登录" }}</span>
        <span v-if="school.tagline" class="meta">{{ school.tagline }}</span>
        <div class="school-actions">
          <el-button size="small" @click="openEdit(school)">编辑信息</el-button>
          <el-button v-if="platformAdmin" size="small" @click="openAccount(school)">开通账号</el-button>
        </div>
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

    <el-dialog v-model="schoolDialog.visible" :title="schoolDialog.creating ? '新建学校' : '编辑学校信息'" width="460px" append-to-body>
      <el-form label-width="84px" @submit.prevent="saveSchool">
        <el-form-item v-if="schoolDialog.creating" label="代号">
          <el-input v-model="schoolDialog.form.id" maxlength="32" placeholder="小写字母开头，例如 njmu" />
        </el-form-item>
        <el-form-item label="学校全称"><el-input v-model="schoolDialog.form.name" maxlength="40" placeholder="例如 南京医科大学" /></el-form-item>
        <el-form-item label="学校简称"><el-input v-model="schoolDialog.form.shortName" maxlength="12" placeholder="例如 南医" /></el-form-item>
        <el-form-item label="品牌名">
          <el-input v-model="schoolDialog.form.brandName" maxlength="20" :placeholder="`${schoolDialog.form.shortName || '简称'}拾间`" />
        </el-form-item>
        <el-form-item label="标语"><el-input v-model="schoolDialog.form.tagline" maxlength="40" placeholder="品牌名下面的一行小字，可不填" /></el-form-item>
        <el-form-item v-if="platformAdmin && !schoolDialog.isDefault" label="开放">
          <el-switch v-model="schoolDialog.form.enabled" />
          <span class="hint switch-hint">开放后会出现在登录页的学校列表里</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="schoolDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="schoolDialog.saving" @click="saveSchool">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="accountDialog.visible" :title="`在${accountDialog.schoolName}开通账号`" width="420px" append-to-body>
      <p class="dialog-tip">站内账号用用户名和密码登录，登录页先选这所学校。新学校的第一个管理员从这里开通。</p>
      <el-form label-width="72px" @submit.prevent="createAccount">
        <el-form-item label="用户名"><el-input v-model="accountDialog.form.username" maxlength="20" placeholder="英文、数字或下划线" /></el-form-item>
        <el-form-item label="昵称"><el-input v-model="accountDialog.form.nickname" maxlength="20" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="accountDialog.form.password" type="password" show-password maxlength="64" /></el-form-item>
        <el-form-item label="身份">
          <el-radio-group v-model="accountDialog.form.role">
            <el-radio value="admin">管理员</el-radio>
            <el-radio value="user">普通用户</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="accountDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="accountDialog.saving" @click="createAccount">开通</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { adminApi, type AdminSchool, type AdminSchoolModuleState, type SchoolModuleIsolation } from "@/api/admin";
import { useSiteStore } from "@/stores/site";

const isolationTag: Record<SchoolModuleIsolation, { label: string; type: "success" | "info" | "warning" }> = {
  school: { label: "各校独立", type: "success" },
  global: { label: "与学校无关", type: "info" },
  pending: { label: "待隔离", type: "warning" },
};

const site = useSiteStore();
const schools = ref<AdminSchool[]>([]);
const platformAdmin = ref(false);
const loading = ref(false);
const error = ref("");
const savingSchool = ref("");
const savingKey = ref("");

const emptySchoolForm = () => ({ id: "", name: "", shortName: "", brandName: "", tagline: "", enabled: false });
const schoolDialog = reactive({ visible: false, creating: false, saving: false, isDefault: false, form: emptySchoolForm() });
const emptyAccountForm = () => ({ username: "", nickname: "", password: "", role: "admin" as "admin" | "user" });
const accountDialog = reactive({ visible: false, saving: false, schoolId: "", schoolName: "", form: emptyAccountForm() });

function errorMessage(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

async function load() {
  loading.value = true; error.value = "";
  try {
    const result = await adminApi.schools({ cacheTtlMs: 0 });
    schools.value = result.schools;
    platformAdmin.value = result.platformAdmin;
  } catch (e) {
    error.value = errorMessage(e, "学校列表加载失败");
  } finally {
    loading.value = false;
  }
}

async function toggle(school: AdminSchool, module: AdminSchoolModuleState, enabled: boolean) {
  const modules = Object.fromEntries(school.modules.map((item) => [item.key, item.key === module.key ? enabled : item.enabled]));
  savingSchool.value = school.id;
  savingKey.value = `${school.id}:${module.key}`;
  try {
    school.modules = await adminApi.saveSchoolModules(school.id, modules);
    ElMessage.success(`${school.shortName}「${module.label}」已${enabled ? "开启" : "关闭"}`);
  } catch (e) {
    ElMessage.error(errorMessage(e, "保存失败"));
  } finally {
    savingSchool.value = "";
    savingKey.value = "";
  }
}

function openCreate() {
  Object.assign(schoolDialog, { visible: true, creating: true, saving: false, isDefault: false, form: emptySchoolForm() });
}

function openEdit(school: AdminSchool) {
  Object.assign(schoolDialog, {
    visible: true,
    creating: false,
    saving: false,
    isDefault: Boolean(school.isDefault),
    form: { id: school.id, name: school.name, shortName: school.shortName, brandName: school.brandName, tagline: school.tagline, enabled: school.enabled },
  });
}

async function saveSchool() {
  const form = schoolDialog.form;
  schoolDialog.saving = true;
  try {
    const fields = {
      name: form.name.trim(),
      shortName: form.shortName.trim(),
      brandName: form.brandName.trim() || `${form.shortName.trim()}拾间`,
      tagline: form.tagline.trim(),
      ...(platformAdmin.value && !schoolDialog.isDefault ? { enabled: form.enabled } : {}),
    };
    if (schoolDialog.creating) await adminApi.createSchool({ id: form.id.trim(), ...fields });
    else await adminApi.updateSchool(form.id, fields);
    ElMessage.success(schoolDialog.creating ? `已新建${fields.brandName}` : "学校信息已保存");
    schoolDialog.visible = false;
    await load();
    // 改的是自己学校时，页面上的品牌名跟着更新。
    if (form.id === site.school?.id) void site.fetch(true);
  } catch (e) {
    ElMessage.error(errorMessage(e, "保存失败"));
  } finally {
    schoolDialog.saving = false;
  }
}

function openAccount(school: AdminSchool) {
  Object.assign(accountDialog, { visible: true, saving: false, schoolId: school.id, schoolName: school.brandName, form: emptyAccountForm() });
}

async function createAccount() {
  const form = accountDialog.form;
  accountDialog.saving = true;
  try {
    await adminApi.createUser({
      username: form.username.trim(),
      nickname: form.nickname.trim(),
      password: form.password,
      role: form.role,
      schoolId: accountDialog.schoolId,
    });
    ElMessage.success(`已在${accountDialog.schoolName}开通 ${form.username.trim()}`);
    accountDialog.visible = false;
  } catch (e) {
    ElMessage.error(errorMessage(e, "开通失败"));
  } finally {
    accountDialog.saving = false;
  }
}

onMounted(load);
</script>

<style scoped>
.settings-card { background: var(--cpu-card); border: 1px solid var(--cpu-border-soft); border-radius: 8px; padding: 18px; }
.pane-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.head-actions { display: flex; gap: 8px; flex: none; }
h2 { margin: 0; font-size: 18px; } p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: 13px; }
.mb { margin-bottom: 14px; }
.school + .school { margin-top: 24px; }
.school-head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.school-title { display: flex; align-items: center; gap: 8px; }
.school-actions { display: flex; gap: 8px; margin-top: 4px; }
h3 { margin: 0; font-size: 16px; }
.meta, .hint { color: var(--cpu-text-secondary); font-size: 12px; }
.switch-hint { margin-left: 8px; }
.dialog-tip { margin: 0 0 12px; }
.module-list { border: 1px solid var(--cpu-border-soft); border-radius: 8px; }
.module-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; }
.module-row + .module-row { border-top: 1px solid var(--cpu-border-soft); }
.module-copy { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.module-label { font-size: 14px; }
</style>
