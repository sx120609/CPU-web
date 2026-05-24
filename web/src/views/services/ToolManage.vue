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
          <section class="admin-section questionnaire-section">
            <div class="section-head">
              <div>
                <h3>问卷</h3>
                <p>{{ activeTool === "feedback" ? "需求反馈已接入系统问卷，可查看反馈结果。" : "创建、编辑、发布并统计在线问卷。" }}</p>
              </div>
              <el-button v-if="activeTool === 'questionnaire'" type="primary" @click="openCreate">
                <el-icon><Plus /></el-icon>
                新建问卷
              </el-button>
            </div>

            <div class="questionnaire-summary">
              <div>
                <b>{{ questionnaires.length }}</b>
                <span>问卷</span>
              </div>
              <div>
                <b>{{ openCount }}</b>
                <span>开放中</span>
              </div>
              <div>
                <b>{{ totalResponses }}</b>
                <span>答卷</span>
              </div>
            </div>

            <el-table :data="questionnaires" size="default" class="desktop-table">
              <el-table-column prop="title" label="标题" min-width="220">
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
              <el-table-column label="填写权限" width="120">
                <template #default="{ row }">
                  <el-tag size="small" effect="plain">{{ row.visibility === "login" ? "登录填写" : "公开填写" }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="题目" width="80">
                <template #default="{ row }">{{ row.fields?.length ?? 0 }}</template>
              </el-table-column>
              <el-table-column label="答卷" width="90">
                <template #default="{ row }">{{ row.responseCount ?? 0 }}</template>
              </el-table-column>
              <el-table-column label="更新时间" width="150">
                <template #default="{ row }">{{ fmtDate(row.updatedAt) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="330" fixed="right">
                <template #default="{ row }">
                  <el-button v-if="!row.isSystem" size="small" @click="openEdit(row)">
                    <el-icon><Edit /></el-icon>
                    编辑
                  </el-button>
                  <el-button size="small" @click="openPreview(row)">
                    <el-icon><View /></el-icon>
                    预览
                  </el-button>
                  <el-button size="small" @click="openResponses(row)">
                    <el-icon><DataAnalysis /></el-icon>
                    结果
                  </el-button>
                  <el-dropdown trigger="click" @command="handleQuestionnaireCommand($event, row)">
                    <el-button size="small">
                      更多<el-icon><ArrowDown /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="link">
                          <el-icon><Link /></el-icon>
                          复制链接
                        </el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="duplicate">
                          <el-icon><CopyDocument /></el-icon>
                          复制问卷
                        </el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="open" divided>开放</el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="close">关闭</el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="draft">设为草稿</el-dropdown-item>
                        <el-dropdown-item v-if="!row.isSystem" command="delete" divided>
                          <el-icon><Delete /></el-icon>
                          删除
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </template>
              </el-table-column>
            </el-table>

            <div class="mobile-list">
              <article v-for="row in questionnaires" :key="row.id" class="mobile-item">
                <div class="mobile-main">
                  <b>{{ row.title }}</b>
                  <span>{{ row.responseCount ?? 0 }} 份答卷 · {{ row.fields?.length ?? 0 }} 题 · {{ statusText(row.status) }}</span>
                </div>
                <div class="mobile-actions">
                  <el-button v-if="!row.isSystem" size="small" @click="openEdit(row)">编辑</el-button>
                  <el-button size="small" @click="openPreview(row)">预览</el-button>
                  <el-button size="small" @click="openResponses(row)">结果</el-button>
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

    <el-dialog v-model="editorOpen" :title="editorTitle" width="min(1080px, 96vw)" :close-on-click-modal="false">
      <div class="builder-layout">
        <aside class="type-palette">
          <h4>题型</h4>
          <button v-for="type in fieldTypeOptions" :key="type.value" type="button" @click="addField(type.value)">
            <el-icon><component :is="type.icon" /></el-icon>
            <span>
              <b>{{ type.label }}</b>
              <small>{{ type.hint }}</small>
            </span>
          </button>
        </aside>

        <el-form label-position="top" class="questionnaire-editor">
          <div class="editor-card">
            <el-form-item label="标题" required>
              <el-input v-model="form.title" maxlength="120" placeholder="例如：校园服务满意度调查" />
            </el-form-item>
            <el-form-item label="说明">
              <el-input v-model="form.description" type="textarea" :rows="3" maxlength="1000" placeholder="填写说明、用途或截止提醒" />
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
          </div>

          <div class="fields-head">
            <h4>题目设计</h4>
            <div>
              <el-button size="small" plain @click="openPreview()">
                <el-icon><View /></el-icon>
                预览
              </el-button>
              <el-button size="small" type="primary" plain @click="addField('single')">
                <el-icon><Plus /></el-icon>
                添加题目
              </el-button>
            </div>
          </div>

          <div class="field-editor-list">
            <article v-for="(field, index) in form.fields" :key="field.localKey" class="field-editor">
              <div class="field-index">{{ index + 1 }}</div>
              <div class="field-editor-body">
                <div class="field-editor-main">
                  <el-input v-model="field.label" placeholder="题目名称" maxlength="80" />
                  <el-select v-model="field.type" class="type-select" @change="normalizeEditableField(field)">
                    <el-option v-for="type in fieldTypeOptions" :key="type.value" :label="type.label" :value="type.value" />
                  </el-select>
                  <el-checkbox v-model="field.required">必填</el-checkbox>
                </div>
                <el-input v-model="field.description" placeholder="题目补充说明（选填）" maxlength="300" />
                <el-input
                  v-if="field.type === 'text' || field.type === 'textarea' || field.type === 'number' || field.type === 'date'"
                  v-model="field.placeholder"
                  placeholder="占位提示（选填）"
                  maxlength="120"
                />
                <el-input
                  v-if="field.type === 'single' || field.type === 'multiple'"
                  v-model="field.optionsText"
                  placeholder="选项，用换行分隔"
                  type="textarea"
                  :rows="4"
                />
                <div v-if="field.type === 'number' || field.type === 'rating' || field.type === 'text' || field.type === 'textarea'" class="advanced-grid">
                  <el-form-item v-if="field.type === 'number'" label="最小值">
                    <el-input-number v-model="field.min" :precision="2" controls-position="right" />
                  </el-form-item>
                  <el-form-item v-if="field.type === 'number'" label="最大值">
                    <el-input-number v-model="field.max" :precision="2" controls-position="right" />
                  </el-form-item>
                  <el-form-item v-if="field.type === 'number'" label="步进">
                    <el-input-number v-model="field.step" :min="0.01" :precision="2" controls-position="right" />
                  </el-form-item>
                  <el-form-item v-if="field.type === 'rating'" label="最低分">
                    <el-input-number v-model="field.min" :min="0" :max="9" controls-position="right" />
                  </el-form-item>
                  <el-form-item v-if="field.type === 'rating'" label="最高分">
                    <el-input-number v-model="field.max" :min="2" :max="10" controls-position="right" />
                  </el-form-item>
                  <el-form-item v-if="field.type === 'text' || field.type === 'textarea'" label="字数上限">
                    <el-input-number v-model="field.maxLength" :min="1" :max="field.type === 'textarea' ? 2000 : 300" controls-position="right" />
                  </el-form-item>
                </div>
                <div class="field-actions">
                  <el-button size="small" text :disabled="index === 0" @click="moveField(index, -1)">
                    <el-icon><ArrowUp /></el-icon>
                    上移
                  </el-button>
                  <el-button size="small" text :disabled="index === form.fields.length - 1" @click="moveField(index, 1)">
                    <el-icon><ArrowDown /></el-icon>
                    下移
                  </el-button>
                  <el-button size="small" text @click="duplicateField(index)">
                    <el-icon><CopyDocument /></el-icon>
                    复制
                  </el-button>
                  <el-button size="small" text type="danger" @click="removeField(index)">
                    <el-icon><Delete /></el-icon>
                    删除
                  </el-button>
                </div>
              </div>
            </article>
            <el-empty v-if="!form.fields.length" description="从左侧选择题型开始设计问卷" />
          </div>
        </el-form>

        <aside class="builder-side">
          <div class="side-stat">
            <span>题目数</span>
            <b>{{ form.fields.length }}</b>
          </div>
          <div class="side-stat">
            <span>当前状态</span>
            <b>{{ statusText(form.status) }}</b>
          </div>
          <div class="side-note">
            <h4>发布检查</h4>
            <p>开放前建议确认必填题、选项数量、匿名设置和登录限制。发布后的问卷仍可编辑，已有答卷会按题目 ID 保留。</p>
          </div>
        </aside>
      </div>
      <template #footer>
        <el-button @click="editorOpen = false">取消</el-button>
        <el-button :loading="saving" @click="submitEditor('draft')">保存草稿</el-button>
        <el-button type="primary" plain :loading="saving" @click="submitEditor()">保存</el-button>
        <el-button type="primary" :loading="saving" @click="submitEditor('open')">保存并开放</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="previewOpen" title="问卷预览" size="min(760px, 92vw)">
      <div class="preview-shell">
        <div class="preview-head">
          <h2>{{ previewQuestionnaire.title || "未命名问卷" }}</h2>
          <p>{{ previewQuestionnaire.description || "请按实际情况填写。" }}</p>
          <div class="meta-row">
            <el-tag size="small" effect="plain">{{ previewQuestionnaire.visibility === "login" ? "需登录" : "公开填写" }}</el-tag>
            <el-tag v-if="previewQuestionnaire.oneResponsePerUser" size="small" type="warning" effect="plain">每人一次</el-tag>
          </div>
        </div>
        <div class="preview-form">
          <section v-for="(field, index) in previewQuestionnaire.fields" :key="field.id" class="preview-field">
            <div class="preview-label">
              <b>{{ index + 1 }}. {{ field.label }}</b>
              <span v-if="field.required">*</span>
            </div>
            <p v-if="field.description">{{ field.description }}</p>
            <el-input v-if="field.type === 'text'" disabled :placeholder="field.placeholder || '单行文本'" />
            <el-input v-else-if="field.type === 'textarea'" disabled type="textarea" :rows="4" :placeholder="field.placeholder || '多行文本'" />
            <el-radio-group v-else-if="field.type === 'single'" disabled>
              <el-radio v-for="option in field.options || []" :key="option" :label="option">{{ option }}</el-radio>
            </el-radio-group>
            <el-checkbox-group v-else-if="field.type === 'multiple'" disabled>
              <el-checkbox v-for="option in field.options || []" :key="option" :label="option">{{ option }}</el-checkbox>
            </el-checkbox-group>
            <el-input-number v-else-if="field.type === 'number'" disabled :min="field.min" :max="field.max" :step="field.step || 1" />
            <el-date-picker v-else-if="field.type === 'date'" disabled type="date" placeholder="选择日期" />
            <div v-else-if="field.type === 'rating'" class="preview-rating">
              <span v-for="score in ratingRange(field)" :key="score">{{ score }}</span>
            </div>
          </section>
          <el-empty v-if="!previewQuestionnaire.fields.length" description="暂无题目" />
        </div>
      </div>
    </el-drawer>

    <el-dialog v-model="responsesOpen" width="min(920px, 96vw)">
      <template #header>
        <div class="responses-title">
          <div>
            <b>{{ responsesTitle }}</b>
            <span>{{ responses.length }} 份答卷</span>
          </div>
          <el-button size="small" plain @click="exportResponses">
            <el-icon><Download /></el-icon>
            导出 CSV
          </el-button>
        </div>
      </template>

      <el-tabs v-model="responsesTab">
        <el-tab-pane label="统计" name="stats">
          <div class="stats-list">
            <article v-for="stat in responseStats" :key="stat.field.id" class="stat-card">
              <div class="stat-head">
                <div>
                  <b>{{ stat.field.label }}</b>
                  <span>{{ fieldTypeText(stat.field.type) }} · {{ stat.answered }}/{{ responses.length }} 已答</span>
                </div>
                <el-tag v-if="stat.field.required" size="small" type="danger" effect="plain">必填</el-tag>
              </div>

              <div v-if="stat.choices.length" class="choice-stats">
                <div v-for="choice in stat.choices" :key="choice.label" class="choice-stat-row">
                  <span>{{ choice.label }}</span>
                  <el-progress :percentage="choice.percent" :show-text="false" />
                  <b>{{ choice.count }} / {{ choice.percent }}%</b>
                </div>
              </div>

              <div v-else-if="stat.numericCount" class="metric-grid">
                <div>
                  <span>平均</span>
                  <b>{{ stat.average }}</b>
                </div>
                <div>
                  <span>最小</span>
                  <b>{{ stat.min }}</b>
                </div>
                <div>
                  <span>最大</span>
                  <b>{{ stat.max }}</b>
                </div>
              </div>

              <div v-else-if="stat.samples.length" class="text-samples">
                <p v-for="sample in stat.samples" :key="sample">{{ sample }}</p>
              </div>

              <el-empty v-else description="暂无可统计数据" />
            </article>
            <el-empty v-if="!responseStats.length" description="暂无题目" />
          </div>
        </el-tab-pane>

        <el-tab-pane label="明细" name="details">
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
        </el-tab-pane>
      </el-tabs>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Calendar,
  CopyDocument,
  DataAnalysis,
  Delete,
  DocumentAdd,
  Download,
  Edit,
  Link,
  Plus,
  Rank,
  Star,
  Tickets,
  View,
} from "@element-plus/icons-vue";
import {
  toolsApi,
  type Questionnaire,
  type QuestionnaireField,
  type QuestionnaireFieldType,
  type QuestionnaireResponse,
  type QuestionnaireStatus,
  type QuestionnaireVisibility,
  type ServiceToolCode,
  type ToolManager,
  type ToolMeta,
} from "@/api/tools";
import { fmtDate } from "@/utils/format";

type EditableField = {
  localKey: string;
  id: string;
  label: string;
  type: QuestionnaireFieldType;
  required: boolean;
  placeholder: string;
  description: string;
  optionsText: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
};

type FieldStat = {
  field: QuestionnaireField;
  answered: number;
  choices: Array<{ label: string; count: number; percent: number }>;
  numericCount: number;
  average?: number;
  min?: number;
  max?: number;
  samples: string[];
};

const fieldTypeOptions: Array<{ value: QuestionnaireFieldType; label: string; hint: string; icon: unknown }> = [
  { value: "single", label: "单选", hint: "从多个选项中选一项", icon: Tickets },
  { value: "multiple", label: "多选", hint: "可同时选择多个选项", icon: DocumentAdd },
  { value: "text", label: "填空", hint: "短文本、姓名、联系方式", icon: Edit },
  { value: "textarea", label: "多行文本", hint: "意见、说明、开放反馈", icon: Rank },
  { value: "rating", label: "评分", hint: "满意度、推荐度、星级", icon: Star },
  { value: "number", label: "数字", hint: "人数、金额、分数", icon: DataAnalysis },
  { value: "date", label: "日期", hint: "报名日期、预约时间", icon: Calendar },
];

const loading = ref(false);
const allTools = ref<ToolMeta[]>([]);
const manageableCodes = ref<ServiceToolCode[]>([]);
const activeTool = ref<ServiceToolCode>("questionnaire");
const questionnaires = ref<Questionnaire[]>([]);
const managers = ref<ToolManager[]>([]);
const managerUsername = ref("");
const managerSaving = ref(false);
const settingSaving = ref(false);

const editorOpen = ref(false);
const editorMode = ref<"create" | "edit">("create");
const editingId = ref<number | null>(null);
const saving = ref(false);
const form = reactive({
  title: "",
  description: "",
  status: "draft" as QuestionnaireStatus,
  visibility: "public" as QuestionnaireVisibility,
  allowAnonymous: true,
  oneResponsePerUser: false,
  fields: [] as EditableField[],
});

const previewOpen = ref(false);
const previewQuestionnaire = reactive({
  title: "",
  description: "",
  visibility: "public" as QuestionnaireVisibility,
  oneResponsePerUser: false,
  fields: [] as QuestionnaireField[],
});

const responsesOpen = ref(false);
const responsesTab = ref<"stats" | "details">("stats");
const responsesTitle = ref("答卷");
const responses = ref<QuestionnaireResponse[]>([]);
const activeResponseFields = ref<QuestionnaireField[]>([]);

const manageableTools = computed(() => allTools.value.filter((tool) => manageableCodes.value.includes(tool.code)));
const currentToolMeta = computed(() => allTools.value.find((tool) => tool.code === activeTool.value));
const openCount = computed(() => questionnaires.value.filter((item) => item.status === "open").length);
const totalResponses = computed(() => questionnaires.value.reduce((sum, item) => sum + (item.responseCount ?? 0), 0));
const editorTitle = computed(() => editorMode.value === "create" ? "新建问卷" : "编辑问卷");
const toolRequireLogin = computed({
  get: () => Boolean(currentToolMeta.value?.requireLogin),
  set: (value: boolean) => {
    const target = currentToolMeta.value;
    if (target) target.requireLogin = value;
  },
});

const responseStats = computed<FieldStat[]>(() => activeResponseFields.value.map((field) => buildFieldStat(field)));

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
  editorMode.value = "create";
  editingId.value = null;
  resetEditorForm();
  addField("single");
  editorOpen.value = true;
}

async function openEdit(row: Questionnaire) {
  if (row.isSystem) return;
  editorMode.value = "edit";
  editingId.value = row.id;
  const source = row.fields ? row : await toolsApi.questionnaire(row.slug);
  resetEditorForm(source);
  editorOpen.value = true;
}

function resetEditorForm(source?: Questionnaire) {
  form.title = source?.title ?? "";
  form.description = source?.description ?? "";
  form.status = source?.status ?? "draft";
  form.visibility = source?.visibility ?? "public";
  form.allowAnonymous = source?.allowAnonymous ?? true;
  form.oneResponsePerUser = source?.oneResponsePerUser ?? false;
  form.fields = (source?.fields ?? []).map(toEditableField);
}

function toEditableField(field: QuestionnaireField): EditableField {
  return {
    localKey: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    id: field.id,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    placeholder: field.placeholder ?? "",
    description: field.description ?? "",
    optionsText: (field.options ?? []).join("\n"),
    min: field.min,
    max: field.max,
    step: field.step,
    maxLength: field.maxLength,
  };
}

function addField(type: QuestionnaireFieldType = "text", afterIndex?: number) {
  const field = makeEditableField(type);
  if (typeof afterIndex === "number") form.fields.splice(afterIndex + 1, 0, field);
  else form.fields.push(field);
}

function makeEditableField(type: QuestionnaireFieldType): EditableField {
  const field: EditableField = {
    localKey: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    id: makeFieldId(),
    label: "",
    type,
    required: false,
    placeholder: "",
    description: "",
    optionsText: "",
  };
  normalizeEditableField(field);
  return field;
}

function normalizeEditableField(field: EditableField) {
  if (field.type === "single" || field.type === "multiple") {
    if (!field.optionsText.trim()) field.optionsText = "选项1\n选项2";
  } else {
    field.optionsText = "";
  }
  if (field.type === "rating") {
    field.min = field.min ?? 1;
    field.max = field.max ?? 5;
    field.step = undefined;
  } else if (field.type === "number") {
    field.step = field.step ?? 1;
  } else if (field.type === "text") {
    field.maxLength = field.maxLength ?? 300;
  } else if (field.type === "textarea") {
    field.maxLength = field.maxLength ?? 2000;
  }
}

function duplicateField(index: number) {
  const source = form.fields[index];
  if (!source) return;
  const copy: EditableField = {
    ...source,
    id: makeFieldId(),
    localKey: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label: source.label ? `${source.label} 副本` : "",
  };
  form.fields.splice(index + 1, 0, copy);
}

function removeField(index: number) {
  form.fields.splice(index, 1);
}

function moveField(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= form.fields.length) return;
  const [item] = form.fields.splice(index, 1);
  form.fields.splice(target, 0, item);
}

async function submitEditor(statusOverride?: QuestionnaireStatus) {
  if (statusOverride) form.status = statusOverride;
  const fields = buildFields();
  if (!validateEditor(fields)) return;

  saving.value = true;
  try {
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      status: form.status,
      visibility: form.visibility,
      allowAnonymous: form.allowAnonymous,
      oneResponsePerUser: form.oneResponsePerUser,
      fields,
    };
    if (editorMode.value === "edit" && editingId.value) {
      await toolsApi.updateQuestionnaire(editingId.value, payload);
      ElMessage.success("问卷已保存");
    } else {
      await toolsApi.createQuestionnaire({ toolCode: "questionnaire", ...payload });
      ElMessage.success(form.status === "open" ? "问卷已创建并开放" : "问卷已创建");
    }
    editorOpen.value = false;
    await reloadActive();
  } finally {
    saving.value = false;
  }
}

function buildFields(): QuestionnaireField[] {
  return form.fields
    .map((field) => normalizeField(field, false))
    .filter((field): field is QuestionnaireField => Boolean(field));
}

function normalizeField(field: EditableField, allowUntitled: boolean): QuestionnaireField | null {
  const label = field.label.trim();
  if (!label && !allowUntitled) return null;
  const result: QuestionnaireField = {
    id: field.id,
    label: label || "未命名题目",
    type: field.type,
    required: field.required,
    placeholder: field.placeholder.trim() || undefined,
    description: field.description.trim() || undefined,
    options: field.type === "single" || field.type === "multiple"
      ? field.optionsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
      : undefined,
    min: field.min,
    max: field.max,
    step: field.step,
    maxLength: field.maxLength,
  };
  return result;
}

function validateEditor(fields: QuestionnaireField[]) {
  if (!form.title.trim()) {
    ElMessage.warning("请填写标题");
    return false;
  }
  if (!fields.length) {
    ElMessage.warning("至少添加 1 个题目");
    return false;
  }
  const ids = new Set<string>();
  for (const field of fields) {
    if (ids.has(field.id)) {
      ElMessage.warning(`题目 ID 重复：${field.id}`);
      return false;
    }
    ids.add(field.id);
    if ((field.type === "single" || field.type === "multiple") && (!field.options || field.options.length < 2)) {
      ElMessage.warning(`选项题“${field.label}”至少需要 2 个选项`);
      return false;
    }
    if (field.type === "rating" && (field.min ?? 1) >= (field.max ?? 5)) {
      ElMessage.warning(`评分题“${field.label}”的最高分需要大于最低分`);
      return false;
    }
    if (field.type === "number" && field.min !== undefined && field.max !== undefined && field.min > field.max) {
      ElMessage.warning(`数字题“${field.label}”的最小值不能大于最大值`);
      return false;
    }
  }
  return true;
}

async function handleQuestionnaireCommand(command: string | number | object, row: Questionnaire) {
  const action = String(command);
  if (action === "link") return copyLink(row);
  if (action === "duplicate") return duplicateQuestionnaire(row);
  if (action === "delete") {
    const ok = await ElMessageBox.confirm(`删除问卷“${row.title}”？答卷也会一起删除。`, "确认删除", { type: "warning" })
      .then(() => true).catch(() => false);
    if (!ok) return;
    await toolsApi.deleteQuestionnaire(row.id);
    ElMessage.success("已删除");
  } else {
    const status = action === "open" ? "open" : action === "close" ? "closed" : "draft";
    await toolsApi.updateQuestionnaire(row.id, { status });
    ElMessage.success("状态已更新");
  }
  await reloadActive();
}

async function duplicateQuestionnaire(row: Questionnaire) {
  const source = row.fields ? row : await toolsApi.questionnaire(row.slug);
  await toolsApi.createQuestionnaire({
    toolCode: "questionnaire",
    title: `${source.title} 副本`,
    description: source.description ?? undefined,
    status: "draft",
    visibility: source.visibility,
    allowAnonymous: source.allowAnonymous,
    oneResponsePerUser: source.oneResponsePerUser,
    fields: (source.fields ?? []).map((field) => ({ ...field, id: makeFieldId() })),
  });
  ElMessage.success("已复制为草稿");
  await reloadActive();
}

function openPreview(row?: Questionnaire) {
  const fields = row
    ? (row.fields ?? [])
    : form.fields.map((field) => normalizeField(field, true)).filter((field): field is QuestionnaireField => Boolean(field));
  previewQuestionnaire.title = row?.title ?? form.title;
  previewQuestionnaire.description = row?.description ?? form.description;
  previewQuestionnaire.visibility = row?.visibility ?? form.visibility;
  previewQuestionnaire.oneResponsePerUser = row?.oneResponsePerUser ?? form.oneResponsePerUser;
  previewQuestionnaire.fields = fields;
  previewOpen.value = true;
}

async function openResponses(row: Questionnaire) {
  const data = await toolsApi.responses(row.id);
  responsesTitle.value = row.title;
  activeResponseFields.value = data.questionnaire.fields ?? [];
  responses.value = data.list;
  responsesTab.value = "stats";
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

function buildFieldStat(field: QuestionnaireField): FieldStat {
  const optionCounts = new Map<string, number>();
  const samples: string[] = [];
  const numbers: number[] = [];
  let answered = 0;

  if (field.type === "single" || field.type === "multiple") {
    for (const option of field.options ?? []) optionCounts.set(option, 0);
  }
  if (field.type === "rating") {
    const min = Math.max(0, Math.round(field.min ?? 1));
    const max = Math.min(10, Math.round(field.max ?? 5));
    for (let value = min; value <= max; value += 1) optionCounts.set(String(value), 0);
  }

  for (const response of responses.value) {
    const raw = response.answers[field.id];
    if (Array.isArray(raw)) {
      const values = raw.map(String).map((item) => item.trim()).filter(Boolean);
      if (!values.length) continue;
      answered += 1;
      for (const value of values) optionCounts.set(value, (optionCounts.get(value) ?? 0) + 1);
      continue;
    }

    const value = String(raw ?? "").trim();
    if (!value) continue;
    answered += 1;
    if (field.type === "single" || field.type === "date" || field.type === "rating") {
      optionCounts.set(value, (optionCounts.get(value) ?? 0) + 1);
    }
    if (field.type === "number" || field.type === "rating") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) numbers.push(numeric);
    }
    if ((field.type === "text" || field.type === "textarea") && samples.length < 8) {
      samples.push(value);
    }
  }

  const choices = Array.from(optionCounts.entries())
    .filter(([, count]) => field.type !== "date" || count > 0)
    .slice(0, field.type === "date" ? 10 : undefined)
    .map(([label, count]) => ({
      label,
      count,
      percent: answered ? Math.round((count / answered) * 100) : 0,
    }));

  const sum = numbers.reduce((total, item) => total + item, 0);
  return {
    field,
    answered,
    choices,
    numericCount: numbers.length,
    average: numbers.length ? round(sum / numbers.length) : undefined,
    min: numbers.length ? Math.min(...numbers) : undefined,
    max: numbers.length ? Math.max(...numbers) : undefined,
    samples,
  };
}

function exportResponses() {
  const headers = ["提交时间", "填写人", ...activeResponseFields.value.map((field) => field.label)];
  const rows = responses.value.map((item) => [
    fmtDate(item.createdAt),
    item.respondent?.nickname || item.respondent?.username || "匿名填写",
    ...activeResponseFields.value.map((field) => formatAnswer(item.answers[field.id])),
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(responsesTitle.value)}-答卷.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function makeFieldId() {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
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

function fieldTypeText(type: QuestionnaireFieldType) {
  return fieldTypeOptions.find((item) => item.value === type)?.label ?? type;
}

function ratingRange(field: QuestionnaireField) {
  const min = Math.max(0, Math.round(field.min ?? 1));
  const max = Math.min(10, Math.round(field.max ?? 5));
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
}

function formatAnswer(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join("、") || "-";
  return value || "-";
}

function csvEscape(value: string) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function sanitizeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "questionnaire";
}

function round(value: number) {
  return Math.round(value * 100) / 100;
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
.questionnaire-section { grid-row: span 2; }
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.section-head h3 { margin: 0; color: #111827; font-size: 16px; }
.section-head p { margin: 5px 0 0; color: #6b7280; font-size: 13px; line-height: 1.6; }
.questionnaire-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.questionnaire-summary div {
  padding: 10px 12px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fafafa;
}
.questionnaire-summary b { display: block; color: #111827; font-size: 20px; }
.questionnaire-summary span { color: #6b7280; font-size: 12px; }
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
.builder-layout {
  display: grid;
  grid-template-columns: 178px minmax(0, 1fr) 190px;
  gap: 14px;
  align-items: start;
}
.type-palette,
.builder-side,
.editor-card,
.field-editor {
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fff;
}
.type-palette {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}
.type-palette h4,
.builder-side h4,
.fields-head h4 {
  margin: 0;
  color: #111827;
  font-size: 15px;
}
.type-palette button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 52px;
  padding: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fafafa;
  color: #374151;
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.type-palette button:hover { border-color: var(--cpu-primary); color: var(--cpu-primary); background: #f0fdfa; }
.type-palette .el-icon { font-size: 18px; flex: 0 0 auto; }
.type-palette span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.type-palette b { font-size: 13px; }
.type-palette small { color: #9ca3af; font-size: 11px; line-height: 1.3; }
.questionnaire-editor { display: flex; flex-direction: column; gap: 12px; }
.editor-card { padding: 14px; }
.editor-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.switch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.fields-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.fields-head > div { display: flex; gap: 8px; }
.field-editor-list { display: flex; flex-direction: column; gap: 10px; }
.field-editor {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  padding: 12px;
  background: #fafafa;
}
.field-index {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: var(--cpu-primary);
  font-size: 12px;
  font-weight: 700;
}
.field-editor-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.field-editor-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 140px 72px;
  gap: 8px;
  align-items: center;
}
.advanced-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.advanced-grid :deep(.el-form-item) { margin-bottom: 0; }
.field-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
}
.builder-side {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}
.side-stat {
  padding: 10px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fafafa;
}
.side-stat span { display: block; color: #6b7280; font-size: 12px; }
.side-stat b { color: #111827; font-size: 18px; }
.side-note {
  padding: 10px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #f9fafb;
}
.side-note p { margin: 6px 0 0; color: #6b7280; font-size: 12px; line-height: 1.7; }
.preview-shell { max-width: 720px; margin: 0 auto; }
.preview-head {
  padding-bottom: 18px;
  border-bottom: 1px solid #eef0f4;
  margin-bottom: 14px;
}
.preview-head h2 { margin: 0; color: #111827; font-size: 22px; }
.preview-head p { margin: 7px 0 0; color: #6b7280; line-height: 1.7; }
.meta-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.preview-form { display: flex; flex-direction: column; gap: 12px; }
.preview-field {
  padding: 14px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fff;
}
.preview-label {
  display: flex;
  gap: 4px;
  color: #111827;
  margin-bottom: 8px;
}
.preview-label span { color: #dc2626; }
.preview-field p { margin: 0 0 10px; color: #6b7280; font-size: 12px; line-height: 1.6; }
.preview-field :deep(.el-radio-group),
.preview-field :deep(.el-checkbox-group) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.preview-rating {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.preview-rating span {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  color: #4b5563;
  background: #fff;
  font-weight: 650;
}
.responses-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-right: 32px;
}
.responses-title div { display: flex; flex-direction: column; gap: 3px; }
.responses-title b { color: #111827; font-size: 16px; }
.responses-title span { color: #6b7280; font-size: 12px; }
.stats-list,
.responses-list { display: flex; flex-direction: column; gap: 12px; }
.stat-card,
.response-card {
  border: 1px solid #eef0f4;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
}
.stat-head,
.response-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f3f4f6;
  margin-bottom: 10px;
}
.stat-head div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.stat-head b,
.response-head b { color: #111827; }
.stat-head span,
.response-head span { color: #9ca3af; font-size: 12px; }
.choice-stats { display: flex; flex-direction: column; gap: 10px; }
.choice-stat-row {
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr) 76px;
  gap: 10px;
  align-items: center;
  color: #374151;
  font-size: 13px;
}
.choice-stat-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.choice-stat-row b { color: #111827; font-weight: 600; text-align: right; }
.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.metric-grid div {
  padding: 10px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fafafa;
}
.metric-grid span { display: block; color: #6b7280; font-size: 12px; }
.metric-grid b { color: #111827; font-size: 18px; }
.text-samples { display: flex; flex-direction: column; gap: 8px; }
.text-samples p {
  margin: 0;
  padding: 9px 10px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  color: #374151;
  background: #fafafa;
  line-height: 1.6;
}
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
@media (max-width: 1100px) {
  .builder-layout { grid-template-columns: 150px minmax(0, 1fr); }
  .builder-side { display: none; }
}
@media (max-width: 900px) {
  .tool-admin-grid { grid-template-columns: 1fr; }
  .managers-section { order: -1; }
}
@media (max-width: 760px) {
  .builder-layout { grid-template-columns: 1fr; }
  .type-palette {
    position: static;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .type-palette h4 { grid-column: 1 / -1; }
  .field-editor-main,
  .editor-row,
  .advanced-grid { grid-template-columns: 1fr; }
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
  .questionnaire-summary { grid-template-columns: 1fr; }
  .desktop-table { display: none; }
  .mobile-list { display: flex; flex-direction: column; gap: 10px; }
  .mobile-item {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid #eef0f4;
    border-radius: 8px;
  }
  .mobile-main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .mobile-item b { color: #111827; }
  .mobile-item span { color: #6b7280; font-size: 12px; }
  .mobile-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .mobile-actions .el-button { flex: 1; }
  .add-manager { flex-direction: column; }
  .answer-row,
  .choice-stat-row { grid-template-columns: 1fr; gap: 5px; }
  .choice-stat-row b { text-align: left; }
  .metric-grid { grid-template-columns: 1fr; }
}
</style>
