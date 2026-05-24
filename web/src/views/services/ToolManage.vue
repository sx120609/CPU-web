<template>
  <div class="tool-manage-page">
    <section class="manage-head">
      <div>
        <div class="kicker">校园小工具</div>
        <h2>小工具管理</h2>
        <p>拥有某个小工具管理权限后，可以维护这个工具的内容与管理人员。</p>
      </div>
      <el-button plain @click="$router.push('/services/tools')">
        <el-icon><ArrowLeft /></el-icon>
        返回小工具
      </el-button>
    </section>

    <section class="manage-panel" v-loading="loading">
      <el-empty v-if="!loading && !manageableTools.length" description="你还没有任何小工具管理权限" />

      <template v-else>
        <el-tabs v-model="activeTool" @tab-change="reloadActive">
          <el-tab-pane
            v-for="tool in manageableTools"
            :key="tool.code"
            :name="tool.code"
            :label="tool.name"
          />
        </el-tabs>

        <div class="tool-admin-grid">
          <section class="admin-section">
            <div class="section-head">
              <div>
                <h3>问卷</h3>
                <p>{{ activeTool === "feedback" ? "需求反馈已接入系统问卷，可查看反馈结果。" : "创建并发布可填写的在线问卷。" }}</p>
              </div>
              <el-button v-if="activeTool === 'questionnaire'" type="primary" @click="openCreate">
                <el-icon><Plus /></el-icon>
                新建问卷
              </el-button>
            </div>

            <el-table :data="questionnaires" size="default" class="desktop-table">
              <el-table-column prop="title" label="标题" min-width="180">
                <template #default="{ row }">
                  <div class="q-title-cell">
                    <b>{{ row.title }}</b>
                    <span>{{ row.slug }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="110">
                <template #default="{ row }">
                  <el-tag :type="statusTag(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="答卷" width="90">
                <template #default="{ row }">{{ row.responseCount ?? 0 }}</template>
              </el-table-column>
              <el-table-column label="操作" width="250" fixed="right">
                <template #default="{ row }">
                  <el-button size="small" @click="openResponses(row)">答卷</el-button>
                  <el-button size="small" @click="copyLink(row)">链接</el-button>
                  <el-dropdown v-if="!row.isSystem" trigger="click" @command="handleQuestionnaireCommand($event, row)">
                    <el-button size="small">
                      更多<el-icon><ArrowDown /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="open">开放</el-dropdown-item>
                        <el-dropdown-item command="close">关闭</el-dropdown-item>
                        <el-dropdown-item command="draft">设为草稿</el-dropdown-item>
                        <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </template>
              </el-table-column>
            </el-table>

            <div class="mobile-list">
              <article v-for="row in questionnaires" :key="row.id" class="mobile-item">
                <div>
                  <b>{{ row.title }}</b>
                  <span>{{ row.responseCount ?? 0 }} 份答卷 · {{ statusText(row.status) }}</span>
                </div>
                <div class="mobile-actions">
                  <el-button size="small" @click="openResponses(row)">答卷</el-button>
                  <el-button size="small" @click="copyLink(row)">链接</el-button>
                </div>
              </article>
            </div>
          </section>

          <section class="admin-section managers-section">
            <div class="section-head">
              <div>
                <h3>使用权限</h3>
                <p>开启后，未登录用户不能打开或提交当前小工具。</p>
              </div>
            </div>
            <div class="access-setting">
              <div>
                <b>登录后使用</b>
                <span>{{ currentToolMeta?.requireLogin ? "当前需要登录" : "当前允许游客使用" }}</span>
              </div>
              <el-switch
                v-model="toolRequireLogin"
                :loading="settingSaving"
                @change="saveToolSetting"
              />
            </div>
          </section>

          <section class="admin-section managers-section">
            <div class="section-head">
              <div>
                <h3>管理器</h3>
                <p>被分配后可进入此页面管理当前小工具。</p>
              </div>
            </div>
            <div class="add-manager">
              <el-input v-model="managerUsername" placeholder="输入用户名" clearable @keyup.enter="addManager" />
              <el-button type="primary" :loading="managerSaving" @click="addManager">添加</el-button>
            </div>
            <div class="manager-list">
              <div v-for="manager in managers" :key="manager.id" class="manager-row">
                <div>
                  <b>{{ manager.user.nickname || manager.user.username }}</b>
                  <span>{{ manager.user.username }}</span>
                </div>
                <el-button text type="danger" @click="removeManager(manager.user.id)">移除</el-button>
              </div>
              <el-empty v-if="!managers.length" description="暂无单独分配的管理器" />
            </div>
          </section>
        </div>
      </template>
    </section>

    <el-dialog v-model="createOpen" title="新建问卷" width="720" :close-on-click-modal="false">
      <el-form label-position="top" class="questionnaire-editor">
        <el-form-item label="标题" required>
          <el-input v-model="form.title" maxlength="120" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.description" type="textarea" :rows="3" maxlength="1000" />
        </el-form-item>
        <div class="editor-row">
          <el-form-item label="状态">
            <el-select v-model="form.status">
              <el-option label="草稿" value="draft" />
              <el-option label="开放" value="open" />
              <el-option label="关闭" value="closed" />
            </el-select>
          </el-form-item>
          <el-form-item label="可见性">
            <el-select v-model="form.visibility">
              <el-option label="公开填写" value="public" />
              <el-option label="登录后填写" value="login" />
            </el-select>
          </el-form-item>
        </div>
        <div class="switch-row">
          <el-checkbox v-model="form.allowAnonymous">允许匿名填写</el-checkbox>
          <el-checkbox v-model="form.oneResponsePerUser">每个登录用户限填一次</el-checkbox>
        </div>

        <div class="fields-head">
          <h4>题目</h4>
          <el-button size="small" plain @click="addField">
            <el-icon><Plus /></el-icon>
            添加题目
          </el-button>
        </div>
        <div class="field-editor-list">
          <div v-for="(field, index) in form.fields" :key="field.localKey" class="field-editor">
            <div class="field-editor-main">
              <el-input v-model="field.label" placeholder="题目名称" maxlength="80" />
              <el-select v-model="field.type" class="type-select">
                <el-option label="单行文本" value="text" />
                <el-option label="多行文本" value="textarea" />
                <el-option label="单选" value="single" />
                <el-option label="多选" value="multiple" />
              </el-select>
              <el-checkbox v-model="field.required">必填</el-checkbox>
            </div>
            <el-input v-model="field.placeholder" placeholder="占位提示（选填）" maxlength="120" />
            <el-input
              v-if="field.type === 'single' || field.type === 'multiple'"
              v-model="field.optionsText"
              placeholder="选项，用换行分隔"
              type="textarea"
              :rows="3"
            />
            <el-button text type="danger" @click="removeField(index)">删除题目</el-button>
          </div>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="createOpen = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="responsesOpen" :title="responsesTitle" width="760">
      <div class="responses-list">
        <article v-for="item in responses" :key="item.id" class="response-card">
          <div class="response-head">
            <b>{{ item.respondent?.nickname || "匿名填写" }}</b>
            <span>{{ fmtDate(item.createdAt) }}</span>
          </div>
          <div class="answer-list">
            <div v-for="field in activeResponseFields" :key="field.id" class="answer-row">
              <span>{{ field.label }}</span>
              <b>{{ formatAnswer(item.answers[field.id]) }}</b>
            </div>
          </div>
        </article>
        <el-empty v-if="!responses.length" description="暂无答卷" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowDown, ArrowLeft, Plus } from "@element-plus/icons-vue";
import {
  toolsApi,
  type Questionnaire,
  type QuestionnaireField,
  type QuestionnaireResponse,
  type QuestionnaireStatus,
  type ServiceToolCode,
  type ToolManager,
  type ToolMeta,
} from "@/api/tools";
import { fmtDate } from "@/utils/format";

type EditableField = {
  localKey: string;
  label: string;
  type: QuestionnaireField["type"];
  required: boolean;
  placeholder: string;
  optionsText: string;
};

const loading = ref(false);
const allTools = ref<ToolMeta[]>([]);
const manageableCodes = ref<ServiceToolCode[]>([]);
const activeTool = ref<ServiceToolCode>("questionnaire");
const questionnaires = ref<Questionnaire[]>([]);
const managers = ref<ToolManager[]>([]);
const managerUsername = ref("");
const managerSaving = ref(false);
const settingSaving = ref(false);

const createOpen = ref(false);
const creating = ref(false);
const form = reactive({
  title: "",
  description: "",
  status: "draft" as QuestionnaireStatus,
  visibility: "public" as "public" | "login",
  allowAnonymous: true,
  oneResponsePerUser: false,
  fields: [] as EditableField[],
});

const responsesOpen = ref(false);
const responsesTitle = ref("答卷");
const responses = ref<QuestionnaireResponse[]>([]);
const activeResponseFields = ref<QuestionnaireField[]>([]);

const manageableTools = computed(() => allTools.value.filter((tool) => manageableCodes.value.includes(tool.code)));
const currentToolMeta = computed(() => allTools.value.find((tool) => tool.code === activeTool.value));
const toolRequireLogin = computed({
  get: () => Boolean(currentToolMeta.value?.requireLogin),
  set: (value: boolean) => {
    const target = currentToolMeta.value;
    if (target) target.requireLogin = value;
  },
});

onMounted(init);

async function init() {
  loading.value = true;
  try {
    const [tools, perms] = await Promise.all([
      toolsApi.tools(),
      toolsApi.myPermissions(),
    ]);
    allTools.value = tools;
    manageableCodes.value = perms.toolCodes;
    activeTool.value = manageableCodes.value.includes("questionnaire") ? "questionnaire" : manageableCodes.value[0] ?? "questionnaire";
    if (manageableCodes.value.length) await reloadActive();
  } finally {
    loading.value = false;
  }
}

async function reloadActive() {
  if (!activeTool.value) return;
  const [questionnaireList, managerList] = await Promise.all([
    toolsApi.questionnaires({ toolCode: activeTool.value, manage: "1" }),
    toolsApi.managers(activeTool.value),
  ]);
  questionnaires.value = questionnaireList;
  managers.value = managerList;
}

async function saveToolSetting(value: string | number | boolean) {
  settingSaving.value = true;
  const previous = !Boolean(value);
  try {
    const updated = await toolsApi.updateToolSetting(activeTool.value, { requireLogin: Boolean(value) });
    const target = currentToolMeta.value;
    if (target) target.requireLogin = updated.requireLogin;
    ElMessage.success(updated.requireLogin ? "已设为登录后使用" : "已允许游客使用");
  } catch (e) {
    const target = currentToolMeta.value;
    if (target) target.requireLogin = previous;
    throw e;
  } finally {
    settingSaving.value = false;
  }
}

function openCreate() {
  Object.assign(form, {
    title: "",
    description: "",
    status: "draft",
    visibility: "public",
    allowAnonymous: true,
    oneResponsePerUser: false,
    fields: [],
  });
  addField();
  createOpen.value = true;
}

function addField() {
  form.fields.push({
    localKey: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label: "",
    type: "text",
    required: false,
    placeholder: "",
    optionsText: "",
  });
}

function removeField(index: number) {
  form.fields.splice(index, 1);
}

async function submitCreate() {
  const fields = buildFields();
  if (!form.title.trim()) {
    ElMessage.warning("请填写标题");
    return;
  }
  if (!fields.length) {
    ElMessage.warning("至少添加 1 个题目");
    return;
  }
  creating.value = true;
  try {
    await toolsApi.createQuestionnaire({
      toolCode: "questionnaire",
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      status: form.status,
      visibility: form.visibility,
      allowAnonymous: form.allowAnonymous,
      oneResponsePerUser: form.oneResponsePerUser,
      fields,
    });
    ElMessage.success("问卷已创建");
    createOpen.value = false;
    await reloadActive();
  } finally {
    creating.value = false;
  }
}

function buildFields(): QuestionnaireField[] {
  return form.fields
    .map((field, index) => ({
      id: `q${index + 1}`,
      label: field.label.trim(),
      type: field.type,
      required: field.required,
      placeholder: field.placeholder.trim() || undefined,
      options: field.type === "single" || field.type === "multiple"
        ? field.optionsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
        : undefined,
    }))
    .filter((field) => field.label);
}

async function handleQuestionnaireCommand(command: string, row: Questionnaire) {
  if (command === "delete") {
    const ok = await ElMessageBox.confirm(`删除问卷“${row.title}”？答卷也会一起删除。`, "确认删除", { type: "warning" })
      .then(() => true).catch(() => false);
    if (!ok) return;
    await toolsApi.deleteQuestionnaire(row.id);
    ElMessage.success("已删除");
  } else {
    const status = command === "open" ? "open" : command === "close" ? "closed" : "draft";
    await toolsApi.updateQuestionnaire(row.id, { status });
    ElMessage.success("状态已更新");
  }
  await reloadActive();
}

async function openResponses(row: Questionnaire) {
  const data = await toolsApi.responses(row.id);
  responsesTitle.value = `${row.title} · 答卷`;
  activeResponseFields.value = data.questionnaire.fields ?? [];
  responses.value = data.list;
  responsesOpen.value = true;
}

function copyLink(row: Questionnaire) {
  const path = `${window.location.origin}/services/tools/questionnaires/${row.slug}`;
  navigator.clipboard?.writeText(path).then(
    () => ElMessage.success("链接已复制"),
    () => ElMessage.info(path)
  );
}

async function addManager() {
  const username = managerUsername.value.trim();
  if (!username) {
    ElMessage.warning("请输入用户名");
    return;
  }
  managerSaving.value = true;
  try {
    await toolsApi.addManager(activeTool.value, { username });
    managerUsername.value = "";
    ElMessage.success("已添加管理器");
    await reloadActive();
  } finally {
    managerSaving.value = false;
  }
}

async function removeManager(userId: number) {
  const ok = await ElMessageBox.confirm("移除该用户的小工具管理权限？", "确认", { type: "warning" })
    .then(() => true).catch(() => false);
  if (!ok) return;
  await toolsApi.removeManager(activeTool.value, userId);
  ElMessage.success("已移除");
  await reloadActive();
}

function statusText(status: QuestionnaireStatus) {
  if (status === "open") return "开放";
  if (status === "closed") return "关闭";
  return "草稿";
}

function statusTag(status: QuestionnaireStatus): "success" | "info" | "warning" {
  if (status === "open") return "success";
  if (status === "closed") return "info";
  return "warning";
}

function formatAnswer(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join("、") || "-";
  return value || "-";
}
</script>

<style scoped>
.tool-manage-page { display: flex; flex-direction: column; gap: 18px; }
.manage-head,
.manage-panel {
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.manage-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 24px;
}
.kicker {
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 650;
  margin-bottom: 5px;
}
.manage-head h2 { margin: 0; font-size: 22px; color: #111827; }
.manage-head p { margin: 6px 0 0; color: #6b7280; font-size: 13px; line-height: 1.7; }
.manage-panel { padding: 16px 18px 20px; min-height: 240px; }
.tool-admin-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 14px;
}
.admin-section {
  border: 1px solid #eef0f4;
  border-radius: 10px;
  padding: 16px;
  background: #fff;
}
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.section-head h3 { margin: 0; color: #111827; font-size: 16px; }
.section-head p { margin: 5px 0 0; color: #6b7280; font-size: 13px; line-height: 1.6; }
.q-title-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.q-title-cell b { color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-title-cell span { color: #9ca3af; font-size: 12px; }
.mobile-list { display: none; }
.add-manager {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.manager-list { display: flex; flex-direction: column; gap: 8px; }
.access-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fafafa;
}
.access-setting div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.access-setting b { color: #111827; }
.access-setting span { color: #6b7280; font-size: 12px; }
.manager-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fafafa;
}
.manager-row div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.manager-row b { color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.manager-row span { color: #6b7280; font-size: 12px; }
.questionnaire-editor { display: flex; flex-direction: column; gap: 2px; }
.editor-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.switch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 10px;
}
.fields-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 6px 0 10px;
}
.fields-head h4 { margin: 0; color: #111827; font-size: 15px; }
.field-editor-list { display: flex; flex-direction: column; gap: 10px; }
.field-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fafafa;
}
.field-editor-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 140px 72px;
  gap: 8px;
  align-items: center;
}
.responses-list { display: flex; flex-direction: column; gap: 12px; }
.response-card {
  border: 1px solid #eef0f4;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
}
.response-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f3f4f6;
  margin-bottom: 8px;
}
.response-head b { color: #111827; }
.response-head span { color: #9ca3af; font-size: 12px; }
.answer-list { display: grid; gap: 7px; }
.answer-row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 10px;
  color: #374151;
  font-size: 13px;
}
.answer-row span { color: #6b7280; }
.answer-row b { font-weight: 500; word-break: break-word; }
@media (max-width: 900px) {
  .tool-admin-grid { grid-template-columns: 1fr; }
  .managers-section { order: -1; }
}
@media (max-width: 700px) {
  .manage-head {
    flex-direction: column;
    padding: 16px;
  }
  .manage-head .el-button { width: 100%; }
  .manage-panel,
  .admin-section { padding: 14px; }
  .section-head { flex-direction: column; align-items: stretch; }
  .section-head .el-button { width: 100%; }
  .desktop-table { display: none; }
  .mobile-list { display: flex; flex-direction: column; gap: 10px; }
  .mobile-item {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 12px;
    border: 1px solid #eef0f4;
    border-radius: 8px;
  }
  .mobile-item div:first-child { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .mobile-item b { color: #111827; }
  .mobile-item span { color: #6b7280; font-size: 12px; }
  .mobile-actions { display: flex; gap: 6px; flex: 0 0 auto; }
  .editor-row,
  .field-editor-main { grid-template-columns: 1fr; }
  .add-manager { flex-direction: column; }
  .answer-row { grid-template-columns: 1fr; gap: 3px; }
}
</style>
