<template>
  <!-- 个人模式与授权 -->
  <el-dialog
    :model-value="permissionsOpen"
    title="个人模式"
    width="min(460px, calc(100vw - 24px))"
    align-center
    append-to-body
    class="sj-agent-dialog"
    @update:model-value="emit('update:permissionsOpen', $event)"
  >
    <div class="sj-perm-body">
      <div class="sj-group">
        <div class="sj-row">
          <div class="sj-row-copy">
            <strong id="sj-perm-enabled">个人模式</strong>
            <small>开启后，拾间AI 在你提问时按下面的授权读取本人数据，也能替你准备日程和帖子草稿。关闭后只回答公开问题。</small>
          </div>
          <el-switch
            :model-value="effectiveOn"
            :loading="savingKey === 'enabled'"
            :disabled="Boolean(savingKey)"
            aria-labelledby="sj-perm-enabled"
            @change="(val: string | number | boolean) => togglePermission('enabled', Boolean(val))"
          />
        </div>
      </div>

      <p class="sj-group-title">可以读取的数据</p>
      <div class="sj-group" :class="{ 'is-disabled': !effectiveOn }">
        <div v-for="scope in SCOPE_ITEMS" :key="scope.key" class="sj-row">
          <div class="sj-row-copy">
            <strong :id="`sj-perm-${scope.key}`">{{ scope.title }}</strong>
            <small>{{ scope.hint }}</small>
          </div>
          <el-switch
            :model-value="permissions[scope.key]"
            :loading="savingKey === scope.key"
            :disabled="!effectiveOn || Boolean(savingKey)"
            :aria-labelledby="`sj-perm-${scope.key}`"
            @change="(val: string | number | boolean) => togglePermission(scope.key, Boolean(val))"
          />
        </div>
      </div>

      <p class="sj-group-title">个人记忆</p>
      <div class="sj-group" :class="{ 'is-disabled': !effectiveOn }">
        <div class="sj-row">
          <div class="sj-row-copy">
            <strong id="sj-perm-memory">记住我的情况</strong>
            <small>记住校区、年级专业、升学打算和作息，以后的回答会参考。</small>
          </div>
          <el-switch
            :model-value="permissions.memory"
            :loading="savingKey === 'memory'"
            :disabled="!effectiveOn || Boolean(savingKey)"
            aria-labelledby="sj-perm-memory"
            @change="(val: string | number | boolean) => togglePermission('memory', Boolean(val))"
          />
        </div>
        <button type="button" class="sj-row sj-row--link" @click="openMemories">
          <span>已记住的内容</span>
          <span class="sj-row-value">{{ memories.length ? `${memories.length} 条` : "无" }}<el-icon><ArrowRight /></el-icon></span>
        </button>
      </div>

      <p class="sj-foot">
        成绩、通知私信默认不读取。读到的数据只用于当次回答，回答本身会和对话记录一起保存；注销账号时授权设置和记忆一并删除。
      </p>
    </div>
  </el-dialog>

  <!-- 个人记忆 -->
  <el-dialog
    :model-value="memoriesOpen"
    title="个人记忆"
    width="min(500px, calc(100vw - 24px))"
    align-center
    append-to-body
    class="sj-agent-dialog"
    @update:model-value="emit('update:memoriesOpen', $event)"
  >
    <div class="sj-mem-body">
      <p class="sj-lead">拾间AI 回答时会参考这些内容。也可以在对话里说“记住……”或“忘掉……”。</p>

      <form class="sj-mem-form" @submit.prevent="submitMemory">
        <select v-model="draftCategory" class="sj-mem-select" aria-label="分类" :disabled="savingMem">
          <option v-for="cat in CATEGORY_OPTIONS" :key="cat.value" :value="cat.value">{{ cat.label }}</option>
        </select>
        <input
          v-model="draftContent"
          type="text"
          maxlength="200"
          class="sj-mem-input"
          placeholder="例如：江宁校区 24 级药学，准备保研"
          :aria-label="editingId ? '修改这条记忆' : '新增一条记忆'"
          :disabled="savingMem"
        />
        <button type="submit" class="sj-btn sj-btn--primary" :disabled="!draftContent.trim() || savingMem">
          {{ editingId ? "保存" : "添加" }}
        </button>
        <button v-if="editingId" type="button" class="sj-btn" :disabled="savingMem" @click="cancelEdit">取消</button>
      </form>

      <div v-if="memories.length" class="sj-group sj-mem-list">
        <div v-for="item in memories" :key="item.id" class="sj-row sj-mem-item">
          <div class="sj-row-copy">
            <small>{{ CATEGORY_LABELS[item.category] || "备忘" }} · {{ item.source === "agent" ? "对话中记下" : "手动添加" }}</small>
            <p class="sj-mem-text">{{ item.content }}</p>
          </div>
          <div class="sj-mem-ops">
            <button type="button" title="修改" aria-label="修改这条记忆" :disabled="savingMem" @click="startEdit(item)">
              <el-icon><EditPen /></el-icon>
            </button>
            <button type="button" title="删除" aria-label="删除这条记忆" :disabled="savingMem" @click="removeMemory(item.id)">
              <el-icon><Delete /></el-icon>
            </button>
          </div>
        </div>
      </div>
      <p v-else class="sj-empty">还没有记住任何内容。</p>

      <div v-if="memories.length" class="sj-mem-footer">
        <span>{{ memories.length }} / 80 条</span>
        <button type="button" class="sj-btn sj-btn--danger" :disabled="savingMem" @click="clearAll">全部清空</button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowRight, Delete, EditPen } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  searchApi,
  type PersonalAgentMemory,
  type PersonalAgentMemoryCategory,
  type PersonalAgentPermissions,
  type PersonalAgentScopeKey,
} from "@/api/search";

const props = defineProps<{
  permissionsOpen: boolean;
  memoriesOpen: boolean;
  permissions: PersonalAgentPermissions;
  memories: PersonalAgentMemory[];
  /** 还没同意个人模式说明：打开个人模式要先弹说明。 */
  consentRequired?: boolean;
}>();

const emit = defineEmits<{
  "update:permissionsOpen": [value: boolean];
  "update:memoriesOpen": [value: boolean];
  "update:permissions": [value: PersonalAgentPermissions];
  "update:memories": [value: PersonalAgentMemory[]];
  requestConsent: [];
}>();

const SCOPE_ITEMS: Array<{ key: PersonalAgentScopeKey; title: string; hint: string }> = [
  { key: "schedule", title: "课表和日程", hint: "本学期课表、调课和你的日程，用来排时间、查冲突、找空教室" },
  { key: "academic", title: "成绩和学业", hint: "成绩单、绩点、考试安排、毕业学分和培养方案" },
  { key: "collab", title: "情侣和宿舍课表", hint: "已绑定的情侣课表、宿舍课表，用来找大家都没课的时间" },
  { key: "campusLife", title: "校园生活", hint: "宿舍电费、图书馆借阅、查分单、问卷和文件收集" },
  { key: "community", title: "论坛和课评", hint: "公告热帖、课程评价、失物招领，以及发帖回帖草稿" },
  { key: "messages", title: "通知和私信", hint: "未读通知、最近的私信，以及全部已读、私信草稿" },
];

const CATEGORY_LABELS: Record<PersonalAgentMemoryCategory, string> = {
  academic: "学业背景",
  goal: "目标规划",
  campus: "校区生活",
  schedule: "作息安排",
  preference: "个人偏好",
  note: "备忘",
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
  value: value as PersonalAgentMemoryCategory,
  label,
}));

const QUIET = { suppressErrorMessage: true } as const;

/** 个人模式实际是否生效：开关开着且同意过说明。 */
const effectiveOn = computed(() => props.permissions.enabled && !props.consentRequired);

const savingKey = ref<keyof PersonalAgentPermissions | "">("");
const savingMem = ref(false);
const draftCategory = ref<PersonalAgentMemoryCategory>("academic");
const draftContent = ref("");
const editingId = ref("");

function errorText(error: unknown, fallback: string) {
  const response = (error as { response?: { status?: number; data?: { message?: string } } })?.response;
  if (response?.status && response.status < 500 && response.data?.message) return response.data.message;
  return fallback;
}

async function togglePermission(key: keyof PersonalAgentPermissions, value: boolean) {
  if (savingKey.value) return;
  if (key === "enabled" && value && props.consentRequired) {
    emit("requestConsent");
    return;
  }
  savingKey.value = key;
  try {
    const res = await searchApi.savePersonalAgentPermissions({ [key]: value }, QUIET);
    emit("update:permissions", res.permissions);
  } catch (error) {
    ElMessage.error(errorText(error, "没有保存成功，请稍后再试"));
  } finally {
    savingKey.value = "";
  }
}

function openMemories() {
  emit("update:permissionsOpen", false);
  emit("update:memoriesOpen", true);
}

function startEdit(item: PersonalAgentMemory) {
  editingId.value = item.id;
  draftCategory.value = item.category;
  draftContent.value = item.content;
}

function cancelEdit() {
  editingId.value = "";
  draftContent.value = "";
}

async function submitMemory() {
  const content = draftContent.value.trim();
  if (!content || savingMem.value) return;
  savingMem.value = true;
  try {
    const res = await searchApi.upsertPersonalAgentMemory({
      id: editingId.value || undefined,
      category: draftCategory.value,
      content,
    }, QUIET);
    const next = [
      res.memory,
      ...props.memories.filter((m) => m.id !== res.memory.id),
    ].sort((a, b) => b.updatedAt - a.updatedAt);
    emit("update:memories", next);
    cancelEdit();
  } catch (error) {
    ElMessage.error(errorText(error, "没有保存成功，请稍后再试"));
  } finally {
    savingMem.value = false;
  }
}

async function removeMemory(id: string) {
  if (savingMem.value) return;
  savingMem.value = true;
  try {
    await searchApi.deletePersonalAgentMemory(id, QUIET);
    emit("update:memories", props.memories.filter((m) => m.id !== id));
    if (editingId.value === id) cancelEdit();
  } catch (error) {
    ElMessage.error(errorText(error, "没有删除成功，请稍后再试"));
  } finally {
    savingMem.value = false;
  }
}

async function clearAll() {
  try {
    await ElMessageBox.confirm("清空后不能恢复。", "清空全部个人记忆？", {
      confirmButtonText: "清空",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    return;
  }
  savingMem.value = true;
  try {
    await searchApi.clearPersonalAgentMemories(QUIET);
    emit("update:memories", []);
    cancelEdit();
  } catch (error) {
    ElMessage.error(errorText(error, "没有清空成功，请稍后再试"));
  } finally {
    savingMem.value = false;
  }
}
</script>

<style scoped>
.sj-perm-body,
.sj-mem-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--cpu-text);
}
.sj-group-title {
  margin: 8px 4px 0;
  font-size: 12px;
  color: var(--cpu-text-secondary);
}
.sj-group {
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: var(--cpu-surface-subtle);
  transition: opacity 0.18s ease;
}
.sj-group.is-disabled {
  opacity: 0.5;
}
.sj-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  font: inherit;
}
.sj-row + .sj-row {
  border-top: 1px solid var(--cpu-border-soft);
}
.sj-row--link {
  width: 100%;
  font-size: 14px;
  cursor: pointer;
}
.sj-row--link:hover {
  background: color-mix(in srgb, var(--cpu-text) 4%, transparent);
}
.sj-row-value {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--cpu-text-secondary);
  font-size: 13px;
}
.sj-row-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sj-row-copy strong {
  font-size: 14px;
  font-weight: 500;
}
.sj-row-copy small {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.45;
}
.sj-foot,
.sj-lead {
  margin: 4px 4px 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--cpu-text-secondary);
}
.sj-lead {
  margin: 0 0 4px;
  font-size: 13px;
}
.sj-mem-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.sj-mem-select,
.sj-mem-input {
  height: 36px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-card);
  color: var(--cpu-text);
  font-size: 14px;
}
.sj-mem-input {
  flex: 1 1 200px;
  min-width: 0;
}
.sj-mem-input:focus,
.sj-mem-select:focus {
  outline: 2px solid var(--cpu-primary);
  outline-offset: -1px;
}
.sj-btn {
  height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: 10px;
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text);
  font-size: 14px;
  cursor: pointer;
}
.sj-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.sj-btn--primary {
  background: var(--cpu-primary);
  color: var(--cpu-on-primary, #fff);
}
.sj-btn--danger {
  height: 32px;
  background: transparent;
  color: var(--cpu-danger);
  font-size: 13px;
}
.sj-mem-list {
  max-height: 320px;
  overflow-y: auto;
}
.sj-mem-item {
  align-items: flex-start;
}
.sj-mem-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  word-break: break-word;
}
.sj-mem-ops {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.sj-mem-ops button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--cpu-text-secondary);
  cursor: pointer;
}
.sj-mem-ops button:hover:not(:disabled) {
  color: var(--cpu-text);
  background: color-mix(in srgb, var(--cpu-text) 7%, transparent);
}
.sj-mem-ops button:disabled {
  opacity: 0.4;
  cursor: default;
}
.sj-empty {
  margin: 0;
  padding: 20px 14px;
  border-radius: 12px;
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text-secondary);
  font-size: 13px;
  text-align: center;
}
.sj-mem-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  font-size: 12px;
  color: var(--cpu-text-secondary);
}
</style>
