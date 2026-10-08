<template>
  <el-drawer
    v-model="editorVisible"
    :direction="isMobileLayout ? 'btt' : 'rtl'"
    :size="isMobileLayout ? '100%' : '720px'"
    :with-header="false"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :class="['fs-editor', { 'cpu-sheet-above-native-bar': isMobileLayout }]"
    append-to-body
  >
    <div class="fs-ed">
      <header class="fs-ed-head">
        <div>
          <small>任务配置</small>
          <h2>{{ editorMode === "edit" ? "编辑任务" : "新建收集任务" }}</h2>
        </div>
        <el-button text circle :icon="Close" aria-label="关闭" :disabled="saving" @click="editorVisible = false" />
      </header>

      <nav class="fs-ed-steps" aria-label="配置步骤">
        <button
          v-for="step in filestoreEditorSteps"
          :key="step.value"
          data-cpu-button="surface"
          type="button"
          :class="{ active: currentStep === step.value, done: currentStep > step.value }"
          :aria-current="currentStep === step.value ? 'step' : undefined"
          @click="currentStep = step.value"
        >
          <span class="fs-ed-step-num">
            <el-icon v-if="currentStep > step.value" aria-hidden="true"><Check /></el-icon>
            <template v-else>{{ step.value }}</template>
          </span>
          <span class="fs-ed-step-label">{{ step.label }}</span>
        </button>
      </nav>

      <div ref="bodyRef" class="fs-ed-body">
        <section v-show="currentStep === 1" class="fs-ed-section">
          <p class="fs-ed-guide">起一个清晰的任务名称，并写清提交要求和截止时间。</p>
          <label class="fs-ed-field">
            <span>任务标题<em>*</em></span>
            <el-input v-model="draft.title" maxlength="80" placeholder="例如：期末作业收集、证件照收集" />
          </label>
          <label class="fs-ed-field">
            <span>说明 / 公告</span>
            <el-input v-model="draft.description" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="说明提交范围、格式要求等" />
          </label>
          <div class="fs-ed-grid two">
            <label class="fs-ed-field">
              <span>截止时间</span>
              <el-date-picker
                v-model="draft.deadline"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm"
                format="YYYY-MM-DD HH:mm"
                placeholder="不设置则不限时"
                :teleported="!isMobileLayout"
              />
            </label>
            <div class="fs-ed-field">
              <span>提交状态</span>
              <el-radio-group v-model="draft.status">
                <el-radio-button value="open">开放提交</el-radio-button>
                <el-radio-button value="closed">停止提交</el-radio-button>
              </el-radio-group>
            </div>
          </div>
        </section>

        <section v-show="currentStep === 2" class="fs-ed-section">
          <p class="fs-ed-guide">身份字段用于识别提交人、覆盖旧提交、核对名单和自动命名文件，建议保留姓名和学号 / 考试号。</p>
          <div class="fs-ed-template">
            <el-select v-model="templateKey" aria-label="表单模板">
              <el-option v-for="option in templateOptions" :key="option.key" :value="option.key" :label="option.custom ? `${option.label}（自定义）` : option.label" />
            </el-select>
            <el-button @click="applySelectedTemplate">应用模板</el-button>
            <el-button
              v-if="viewer?.isManager"
              type="danger"
              plain
              :disabled="!templateKey.startsWith('custom:')"
              @click="deleteSelectedTemplate"
            >删除模板</el-button>
          </div>

          <article v-for="(field, index) in draft.fields" :key="index" class="fs-ed-card">
            <header>
              <b>{{ field.label || `字段 ${index + 1}` }}</b>
              <code>{{ "{" + (field.key || "?") + "}" }}</code>
            </header>
            <div class="fs-ed-grid two">
              <label class="fs-ed-field">
                <span>名称</span>
                <el-input v-model="field.label" placeholder="姓名" />
              </label>
              <label class="fs-ed-field">
                <span>变量</span>
                <el-input v-model="field.key" placeholder="name" @blur="field.key = normalizeFieldKey(field.key)" />
              </label>
              <label class="fs-ed-field">
                <span>占位提示</span>
                <el-input v-model="field.placeholder" placeholder="请输入姓名" />
              </label>
              <label class="fs-ed-field">
                <span>正则校验</span>
                <el-input v-model="field.pattern" placeholder="可选" class="fs-ed-mono" />
              </label>
            </div>
            <footer>
              <el-checkbox v-model="field.required">必填</el-checkbox>
              <span class="fs-ed-spacer" />
              <el-button size="small" :icon="MagicStick" @click="generateRegex(field)">AI 正则</el-button>
              <el-button size="small" type="danger" plain :icon="Delete" :disabled="draft.fields.length <= 1" @click="draft.fields.splice(index, 1)">删除</el-button>
            </footer>
          </article>
          <el-button class="fs-ed-add" :icon="Plus" @click="addDraftField">添加自定义字段</el-button>
        </section>

        <section v-show="currentStep === 3" class="fs-ed-section">
          <p class="fs-ed-guide">需要额外收集说明、选择或评分时添加题目；答案会进入提交记录和 CSV，不参与文件命名和覆盖判断。只收文件可以跳过。</p>
          <div v-if="!draft.surveyFields.length" class="fs-ed-empty">
            <b>暂未添加问卷题目</b>
            <span>需要备注、选项或评分时再添加。</span>
          </div>
          <article v-for="(field, index) in draft.surveyFields" :key="field.id || index" class="fs-ed-card">
            <header>
              <b>题目 {{ index + 1 }}</b>
              <span class="fs-ed-spacer" />
              <el-button size="small" text :icon="CopyDocument" @click="duplicateSurveyField(index)">复制</el-button>
              <el-button size="small" text type="danger" :icon="Delete" @click="draft.surveyFields.splice(index, 1)">删除</el-button>
            </header>
            <div class="fs-ed-grid two">
              <label class="fs-ed-field wide">
                <span>题目标题</span>
                <el-input v-model="field.label" placeholder="例如：是否需要纸质版" />
              </label>
              <label class="fs-ed-field">
                <span>题型</span>
                <el-select v-model="field.type" @change="normalizeSurveyField(field)">
                  <el-option v-for="type in filestoreSurveyFieldTypes" :key="type.value" :value="type.value" :label="type.label" />
                </el-select>
              </label>
              <label class="fs-ed-field">
                <span>题目 ID</span>
                <el-input v-model="field.id" placeholder="q_1" class="fs-ed-mono" @blur="field.id = normalizeSurveyFieldId(field.id)" />
              </label>
              <label class="fs-ed-field">
                <span>题目说明</span>
                <el-input v-model="field.description" placeholder="选填，展示在题目下方" />
              </label>
              <label class="fs-ed-field">
                <span>占位提示</span>
                <el-input v-model="field.placeholder" placeholder="选填" />
              </label>
              <label v-if="field.type === 'single' || field.type === 'multiple'" class="fs-ed-field wide">
                <span>选项（每行一个）</span>
                <el-input
                  :model-value="(field.options || []).join('\n')"
                  type="textarea"
                  :autosize="{ minRows: 3, maxRows: 8 }"
                  placeholder="选项1&#10;选项2"
                  @update:model-value="setSurveyOptions(field, $event)"
                />
              </label>
              <template v-if="field.type === 'number' || field.type === 'rating'">
                <label class="fs-ed-field">
                  <span>最小值</span>
                  <el-input-number v-model="field.min" controls-position="right" />
                </label>
                <label class="fs-ed-field">
                  <span>最大值</span>
                  <el-input-number v-model="field.max" controls-position="right" />
                </label>
                <label v-if="field.type === 'number'" class="fs-ed-field">
                  <span>步进</span>
                  <el-input-number v-model="field.step" :min="0.01" :step="0.01" controls-position="right" />
                </label>
              </template>
              <label v-if="field.type === 'text' || field.type === 'textarea'" class="fs-ed-field">
                <span>最大字数</span>
                <el-input-number v-model="field.maxLength" :min="1" :max="2000" controls-position="right" />
              </label>
            </div>
            <footer>
              <el-checkbox v-model="field.required">必填</el-checkbox>
            </footer>
          </article>
          <el-button class="fs-ed-add" :icon="Plus" @click="addSurveyField">添加题目</el-button>
        </section>

        <section v-show="currentStep === 4" class="fs-ed-section">
          <p class="fs-ed-guide">限制上传的格式、大小与数量，并设置文件自动命名规则，收齐后无需手动改名。</p>
          <div class="fs-ed-grid three">
            <label class="fs-ed-field">
              <span>允许格式</span>
              <el-input v-model="draft.allowedTypes" placeholder="pdf,docx,jpg" class="fs-ed-mono" />
            </label>
            <label class="fs-ed-field">
              <span>单文件大小（MB）</span>
              <el-input-number v-model="draft.maxSizeMb" :min="1" :max="100" controls-position="right" />
            </label>
            <label class="fs-ed-field">
              <span>文件数量上限</span>
              <el-input-number v-model="draft.maxCount" :min="1" :max="20" controls-position="right" />
            </label>
          </div>

          <div class="fs-ed-card">
            <label class="fs-ed-field">
              <span>文件命名格式</span>
              <el-input v-model="draft.renameTemplate" class="fs-ed-mono" />
            </label>
            <div class="fs-ed-tokens">
              <button v-for="field in draft.fields" :key="`file-${field.key}`" data-cpu-button="surface" type="button" @click="insertToken('renameTemplate', `{${field.key}}`)">{{ field.label || field.key }}</button>
              <button data-cpu-button="surface" type="button" @click="insertToken('renameTemplate', '{original}')">原文件名</button>
              <button data-cpu-button="surface" type="button" @click="insertToken('renameTemplate', '{index}')">序号</button>
              <button data-cpu-button="surface" type="button" class="is-reset" @click="draft.renameTemplate = '{name}-{student_id}'">恢复默认</button>
            </div>
            <p class="fs-ed-preview"><span>预览</span>{{ renamePreview }}</p>
            <el-checkbox v-if="editorMode === 'edit'" v-model="draft.renameExistingFiles">同步重命名已有文件</el-checkbox>
          </div>

          <div class="fs-ed-card">
            <label class="fs-ed-field">
              <span>归档文件夹命名（仅多文件提交时使用）</span>
              <el-input v-model="draft.folderTemplate" class="fs-ed-mono" />
            </label>
            <div class="fs-ed-tokens">
              <button v-for="field in draft.fields" :key="`folder-${field.key}`" data-cpu-button="surface" type="button" @click="insertToken('folderTemplate', `{${field.key}}`)">{{ field.label || field.key }}</button>
              <button data-cpu-button="surface" type="button" class="is-reset" @click="draft.folderTemplate = '{name}-{student_id}'">恢复默认</button>
            </div>
            <p class="fs-ed-preview"><span>预览</span>{{ folderPreview }}</p>
          </div>
          <p class="fs-ed-note">例如 <code>{student_id|last:2}</code> 会取学号 / 考试号的最后 2 位。</p>
        </section>

        <section v-show="currentStep === 5" class="fs-ed-section">
          <p class="fs-ed-guide">粘贴应提交人员名单后，系统会自动算出谁还没提交，并可一键复制催交名单。不需要核对可以留空。</p>
          <label class="fs-ed-field">
            <span>应提交人员名单（每行一个学号 / 考试号 / 姓名）<em v-if="expectedCount" class="fs-ed-count">{{ expectedCount }} 人</em></span>
            <el-input v-model="draft.expectedEntries" type="textarea" :autosize="{ minRows: 8, maxRows: 18 }" placeholder="2020240444&#10;2020240445&#10;2020240446" class="fs-ed-mono" />
          </label>
        </section>
      </div>

      <footer class="fs-ed-foot">
        <div class="fs-ed-foot-extra">
          <el-button v-if="viewer?.isManager" text :disabled="saving" @click="saveTemplateFromDraft">保存为模板</el-button>
          <el-button v-if="editorMode === 'edit'" text type="danger" :disabled="saving" @click="deleteTask">删除任务</el-button>
        </div>
        <div class="fs-ed-foot-main">
          <el-button :disabled="currentStep <= 1 || saving" @click="go(currentStep - 1)">上一步</el-button>
          <el-button v-if="currentStep < lastStep" type="primary" @click="go(currentStep + 1)">下一步</el-button>
          <el-button v-else type="primary" :loading="saving" :disabled="saving" @click="saveTask">保存任务</el-button>
        </div>
      </footer>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Check, Close, CopyDocument, Delete, MagicStick, Plus } from "@element-plus/icons-vue";
import { useMobileLayout } from "@/utils/mobileLayout";
import { filestoreSurveyFieldTypes, normalizeFieldKey, normalizeSurveyFieldId } from "../shared";
import { filestoreEditorSteps, useInjectedFilestoreWorkspace } from "../workspace";

const isMobileLayout = useMobileLayout();
const {
  viewer,
  saving,
  editorVisible,
  editorMode,
  currentStep,
  templateKey,
  templateOptions,
  draft,
  renamePreview,
  folderPreview,
  applySelectedTemplate,
  deleteSelectedTemplate,
  addDraftField,
  addSurveyField,
  duplicateSurveyField,
  normalizeSurveyField,
  setSurveyOptions,
  insertToken,
  generateRegex,
  saveTask,
  deleteTask,
  saveTemplateFromDraft,
} = useInjectedFilestoreWorkspace();

const bodyRef = ref<HTMLElement | null>(null);
const lastStep = filestoreEditorSteps[filestoreEditorSteps.length - 1].value;
const expectedCount = computed(() => draft.expectedEntries.split(/\r?\n/).filter((line) => line.trim()).length);

watch(currentStep, () => {
  bodyRef.value?.scrollTo({ top: 0 });
});

function go(step: number) {
  currentStep.value = Math.min(lastStep, Math.max(1, step));
}
</script>

<style scoped lang="scss">
@use "../../../../styles/compact" as *;

.fs-ed { display: flex; height: 100%; flex-direction: column; background: var(--cpu-bg); color: var(--cpu-text); }

.fs-ed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: calc(14px + var(--cpu-safe-area-inset-top, 0px)) 16px 10px 20px;
  background: var(--cpu-card);
}
.fs-ed-head small { color: var(--cpu-primary); font-size: var(--cpu-fs-xs); font-weight: 500; }
.fs-ed-head h2 { margin: 1px 0 0; font-size: var(--cpu-fs-xl); font-weight: 700; }

.fs-ed-steps {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  padding: 4px 16px 12px;
  border-bottom: 1px solid var(--cpu-border-soft);
  background: var(--cpu-card);
}
.fs-ed-steps button {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--cpu-radius-m);
  background: transparent;
  color: var(--cpu-text-muted);
  font: inherit;
  font-size: var(--cpu-fs-s);
  cursor: pointer;
}
.fs-ed-steps button:hover { background: var(--cpu-surface-soft); }
.fs-ed-steps button.active { background: var(--cpu-primary-soft); color: var(--cpu-primary); font-weight: 500; }
.fs-ed-steps button.done { color: var(--cpu-text-secondary); }
.fs-ed-step-num {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  border: 1.5px solid currentColor;
  border-radius: 50%;
  font-size: var(--cpu-fs-xs);
  font-weight: 700;
}
.fs-ed-steps button.active .fs-ed-step-num { border-color: var(--cpu-primary); background: var(--cpu-primary); color: #fff; }
.fs-ed-steps button.done .fs-ed-step-num { border-color: var(--cpu-success); background: var(--cpu-success); color: #fff; }
.fs-ed-step-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.fs-ed-body { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 18px 20px 24px; }
.fs-ed-section { display: flex; flex-direction: column; gap: 14px; }
.fs-ed-guide { margin: 0; padding: 10px 12px; border-radius: var(--cpu-radius-m); background: var(--cpu-primary-soft); color: var(--cpu-primary); font-size: var(--cpu-fs-s); line-height: 1.6; }
.fs-ed-field { display: flex; min-width: 0; flex-direction: column; gap: 6px; }
.fs-ed-field > span { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); font-weight: 500; }
.fs-ed-field > span em { margin-left: 2px; color: var(--cpu-danger); font-style: normal; }
.fs-ed-field > span em.fs-ed-count { margin-left: 8px; padding: 1px 7px; border-radius: var(--cpu-radius-pill); background: var(--cpu-primary-soft); color: var(--cpu-primary); font-size: var(--cpu-fs-xs); }
.fs-ed-field :deep(.el-date-editor),
.fs-ed-field :deep(.el-input-number),
.fs-ed-field :deep(.el-select) { width: 100%; }
.fs-ed-mono :deep(input),
.fs-ed-mono :deep(textarea) { font-family: var(--cpu-font-mono); }
.fs-ed-grid { display: grid; gap: 12px 14px; }
.fs-ed-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.fs-ed-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.fs-ed-grid .wide { grid-column: 1 / -1; }

.fs-ed-template { display: flex; gap: 8px; }
.fs-ed-template .el-select { min-width: 0; flex: 1; }
.fs-ed-template .el-button { margin: 0; }

.fs-ed-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.fs-ed-card > header,
.fs-ed-card > footer { display: flex; align-items: center; gap: 8px; }
.fs-ed-card > header b { font-size: var(--cpu-fs-m); font-weight: 500; }
.fs-ed-card > header code { padding: 1px 6px; border-radius: var(--cpu-radius-s); background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); font-family: var(--cpu-font-mono); font-size: var(--cpu-fs-xs); }
.fs-ed-card > header .el-button,
.fs-ed-card > footer .el-button { margin: 0; }
.fs-ed-spacer { flex: 1; }
.fs-ed-add { align-self: flex-start; }
.fs-ed-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 26px 16px; border: 1px dashed var(--cpu-border); border-radius: var(--cpu-radius-l); color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.fs-ed-empty b { color: var(--cpu-text); font-size: var(--cpu-fs-m); }

.fs-ed-tokens { display: flex; flex-wrap: wrap; gap: 6px; }
.fs-ed-tokens button {
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text);
  font: inherit;
  font-size: var(--cpu-fs-xs);
  cursor: pointer;
}
.fs-ed-tokens button:hover { border-color: var(--cpu-primary); color: var(--cpu-primary); }
.fs-ed-tokens button.is-reset { border-style: dashed; color: var(--cpu-text-secondary); }
.fs-ed-preview { margin: 0; padding: 8px 10px; border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); color: var(--cpu-text); font-family: var(--cpu-font-mono); font-size: var(--cpu-fs-xs); overflow-wrap: anywhere; }
.fs-ed-preview span { margin-right: 8px; color: var(--cpu-text-muted); font-family: var(--cpu-font-sans); }
.fs-ed-note { margin: 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.fs-ed-note code { font-family: var(--cpu-font-mono); }

.fs-ed-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--cpu-border-soft);
  background: var(--cpu-card);
}
.fs-ed-foot-extra,
.fs-ed-foot-main { display: flex; align-items: center; gap: 8px; }
.fs-ed-foot .el-button { margin: 0; }
.fs-ed-foot-main .el-button { min-width: 92px; }

:global(.fs-editor .el-drawer__body) { padding: 0; }
:global(.fs-editor.el-drawer.btt) { border-radius: 0; }

// The phone sheet layout follows the rendered tree, so touch tablets below 1024 px get it too.
@include compact-layout {
  .fs-ed-head { padding-left: 16px; }
  .fs-ed-steps { display: flex; overflow-x: auto; padding: 2px 12px 10px; scrollbar-width: none; }
  .fs-ed-steps::-webkit-scrollbar { display: none; }
  .fs-ed-steps button { flex: 0 0 auto; padding: 6px 10px 6px 6px; }
  .fs-ed-body { padding: 14px 14px 20px; }
  .fs-ed-grid.two,
  .fs-ed-grid.three { grid-template-columns: minmax(0, 1fr); }
  .fs-ed-template { flex-wrap: wrap; }
  .fs-ed-template .el-select { flex-basis: 100%; }
  .fs-ed-foot { flex-direction: column-reverse; align-items: stretch; gap: 6px; padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); }
  .fs-ed-foot-main .el-button { flex: 1; }
  .fs-ed-foot-extra { justify-content: center; }
  // 16px 以下 iOS 会在聚焦时放大页面
  .fs-ed-body :deep(.el-input__inner),
  .fs-ed-body :deep(.el-textarea__inner) { font-size: var(--cpu-fs-l); }
}
</style>
