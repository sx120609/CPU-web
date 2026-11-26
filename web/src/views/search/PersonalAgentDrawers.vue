<template>
  <!-- 数据授权管理弹窗 -->
  <el-dialog
    :model-value="permissionsOpen"
    title="拾间AI 个人模式与数据授权"
    width="min(480px, calc(100vw - 24px))"
    align-center
    append-to-body
    class="sj-agent-dialog"
    @update:model-value="emit('update:permissionsOpen', $event)"
  >
    <div class="sj-perm-body">
      <div class="sj-perm-master">
        <div class="sj-perm-copy">
          <strong>启用个人 Agent 深度处理模式</strong>
          <small>开启后可按下方分项授权实时读取本人数据并执行代码级精算；关闭则退回仅回答公开校园知识的普通模式。</small>
        </div>
        <el-switch
          :model-value="permissions.enabled"
          :disabled="savingPerm"
          @change="(val: string | number | boolean) => togglePermission('enabled', Boolean(val))"
        />
      </div>

      <div class="sj-perm-list" :class="{ 'is-disabled': !permissions.enabled }">
        <div v-for="scope in SCOPE_ITEMS" :key="scope.key" class="sj-perm-row">
          <div class="sj-perm-copy">
            <strong>
              {{ scope.title }}
              <span v-if="scope.sensitive" class="sj-perm-tag">敏感默认关</span>
            </strong>
            <small>{{ scope.hint }}</small>
          </div>
          <el-switch
            :model-value="permissions[scope.key]"
            :disabled="!permissions.enabled || savingPerm"
            @change="(val: string | number | boolean) => togglePermission(scope.key, Boolean(val))"
          />
        </div>

        <div class="sj-perm-row sj-perm-row--memory">
          <div class="sj-perm-copy">
            <strong>跨会话个人记忆</strong>
            <small>允许记住你的校区、年级专业、升学目标与日程偏好；可随时在「个人记忆」面板查看、修改或一键清空。</small>
          </div>
          <el-switch
            :model-value="permissions.memory"
            :disabled="!permissions.enabled || savingPerm"
            @change="(val: string | number | boolean) => togglePermission('memory', Boolean(val))"
          />
        </div>
      </div>

      <p class="sj-perm-foot">
        原始课表、成绩、电费、借阅与私信仅在当次推理内存中实时取用并核算，不写入长期日志；注销账号时个人授权与记忆会自动彻底清除。
      </p>
    </div>
  </el-dialog>

  <!-- 跨会话个人记忆管理弹窗 -->
  <el-dialog
    :model-value="memoriesOpen"
    title="拾间AI 个人记忆管理"
    width="min(520px, calc(100vw - 24px))"
    align-center
    append-to-body
    class="sj-agent-dialog"
    @update:model-value="emit('update:memoriesOpen', $event)"
  >
    <div class="sj-mem-body">
      <p class="sj-mem-lead">
        拾间AI 会在每次对话时参考以下背景，使选课建议、时间安排与学业分析更贴合你的实际情况。你可以直接添加或随时移除。
      </p>

      <form class="sj-mem-form" @submit.prevent="submitMemory">
        <select v-model="draftCategory" class="sj-mem-select" aria-label="记忆分类">
          <option v-for="cat in CATEGORY_OPTIONS" :key="cat.value" :value="cat.value">{{ cat.label }}</option>
        </select>
        <input
          v-model="draftContent"
          type="text"
          maxlength="200"
          class="sj-mem-input"
          placeholder="例如：江宁校区 24 级药学本科，正在准备保研"
          aria-label="新增或编辑个人记忆"
        />
        <button type="submit" class="sj-mem-save" :disabled="!draftContent.trim() || savingMem">
          {{ editingId ? "保存" : "添加" }}
        </button>
        <button v-if="editingId" type="button" class="sj-mem-cancel" @click="cancelEdit">取消</button>
      </form>

      <div v-if="memories.length" class="sj-mem-list">
        <div v-for="item in memories" :key="item.id" class="sj-mem-item">
          <div class="sj-mem-main">
            <div class="sj-mem-badges">
              <span class="sj-mem-cat">{{ CATEGORY_LABELS[item.category] || "备忘" }}</span>
              <span class="sj-mem-src">{{ item.source === "agent" ? "对话提取" : "手动添加" }}</span>
            </div>
            <p class="sj-mem-text">{{ item.content }}</p>
          </div>
          <div class="sj-mem-ops">
            <button type="button" title="编辑" aria-label="编辑记忆" @click="startEdit(item)">
              <el-icon><EditPen /></el-icon>
            </button>
            <button type="button" title="删除" aria-label="删除记忆" @click="removeMemory(item.id)">
              <el-icon><Delete /></el-icon>
            </button>
          </div>
        </div>
      </div>
      <div v-else class="sj-mem-empty">
        还没有保存任何个人记忆。你可以在上方手动添加，或在聊天时直接对拾间AI说「记住我是江宁校区药学院的」。
      </div>

      <div v-if="memories.length" class="sj-mem-footer">
        <span>共 {{ memories.length }} / 80 条</span>
        <button type="button" class="sj-mem-clear" :disabled="savingMem" @click="clearAll">清空全部记忆</button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Delete, EditPen } from "@element-plus/icons-vue";
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
}>();

const emit = defineEmits<{
  "update:permissionsOpen": [value: boolean];
  "update:memoriesOpen": [value: boolean];
  "update:permissions": [value: PersonalAgentPermissions];
  "update:memories": [value: PersonalAgentMemory[]];
}>();

const SCOPE_ITEMS: Array<{ key: PersonalAgentScopeKey; title: string; hint: string; sensitive?: boolean }> = [
  {
    key: "schedule",
    title: "课表与个人日程",
    hint: "读取本学期课表、调休与个人日程待办，检查时间冲突并联动查找空闲自习教室",
  },
  {
    key: "academic",
    title: "成绩与学业档案",
    hint: "读取成绩单精算总绩点/必修绩点/刷分增幅、期中与考试考场、学业完成度与培养方案缺口、四六级",
    sensitive: true,
  },
  {
    key: "collab",
    title: "多人协同课表",
    hint: "读取已绑定的情侣课表或宿舍室友课表，自动计算全员共同没课的时段",
  },
  {
    key: "campusLife",
    title: "校园生活与待办",
    hint: "查询本宿舍电费余额、图书馆在借图书到期时间、老师发布的查分单及文件收集/问卷任务",
  },
  {
    key: "community",
    title: "社区、选课课评与代办",
    hint: "检索公告热帖、真实学生课程点评辅助选课、失物招领匹配，以及生成发帖/回帖草稿",
  },
  {
    key: "messages",
    title: "我的通知与站内私信",
    hint: "汇总未读通知与最近私信会话摘要，支持一键全部已读与代拟私信草稿",
    sensitive: true,
  },
];

const CATEGORY_LABELS: Record<PersonalAgentMemoryCategory, string> = {
  academic: "学业背景",
  goal: "目标规划",
  campus: "校区生活",
  schedule: "时间习惯",
  preference: "个人偏好",
  note: "长期备忘",
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
  value: value as PersonalAgentMemoryCategory,
  label,
}));

const savingPerm = ref(false);
const savingMem = ref(false);
const draftCategory = ref<PersonalAgentMemoryCategory>("academic");
const draftContent = ref("");
const editingId = ref("");

async function togglePermission(key: keyof PersonalAgentPermissions, value: boolean) {
  savingPerm.value = true;
  try {
    const res = await searchApi.savePersonalAgentPermissions({ [key]: value });
    emit("update:permissions", res.permissions);
  } catch {
    ElMessage.error("保存授权设置失败，请稍后重试");
  } finally {
    savingPerm.value = false;
  }
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
    });
    const next = [
      res.memory,
      ...props.memories.filter((m) => m.id !== res.memory.id),
    ].sort((a, b) => b.updatedAt - a.updatedAt);
    emit("update:memories", next);
    editingId.value = "";
    draftContent.value = "";
    ElMessage.success("已保存个人记忆");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存记忆失败");
  } finally {
    savingMem.value = false;
  }
}

async function removeMemory(id: string) {
  savingMem.value = true;
  try {
    await searchApi.deletePersonalAgentMemory(id);
    emit("update:memories", props.memories.filter((m) => m.id !== id));
    if (editingId.value === id) cancelEdit();
  } catch {
    ElMessage.error("删除失败，请重试");
  } finally {
    savingMem.value = false;
  }
}

async function clearAll() {
  try {
    await ElMessageBox.confirm("确定清空拾间AI保存的全部跨会话个人记忆吗？清空后不可恢复。", "清空个人记忆", {
      confirmButtonText: "确认清空",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    return;
  }
  savingMem.value = true;
  try {
    await searchApi.clearPersonalAgentMemories();
    emit("update:memories", []);
    cancelEdit();
    ElMessage.success("已清空全部个人记忆");
  } catch {
    ElMessage.error("清空失败，请稍后重试");
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
  gap: 12px;
  color: var(--cpu-text);
}
.sj-perm-master {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--cpu-primary-soft);
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 22%, transparent);
}
.sj-perm-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  overflow: hidden;
  transition: opacity 0.18s ease;
}
.sj-perm-list.is-disabled {
  opacity: 0.5;
}
.sj-perm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 14px;
  background: var(--cpu-card);
}
.sj-perm-row + .sj-perm-row {
  border-top: 1px solid var(--cpu-border-soft);
}
.sj-perm-row--memory {
  background: var(--cpu-surface-subtle);
}
.sj-perm-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.sj-perm-copy strong {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
}
.sj-perm-copy small {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.45;
}
.sj-perm-tag {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  color: var(--cpu-primary);
  background: var(--cpu-primary-soft);
}
.sj-perm-foot {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--cpu-text-tertiary, var(--cpu-text-secondary));
}

.sj-mem-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--cpu-text-secondary);
}
.sj-mem-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.sj-mem-select {
  height: 36px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text);
  font-size: 13px;
}
.sj-mem-input {
  flex: 1 1 200px;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text);
  font-size: 13px;
}
.sj-mem-input:focus,
.sj-mem-select:focus {
  outline: 2px solid var(--cpu-primary);
  outline-offset: -1px;
}
.sj-mem-save,
.sj-mem-cancel {
  height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  border: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.sj-mem-save {
  background: var(--cpu-primary);
  color: #fff;
}
.sj-mem-save:disabled {
  opacity: 0.45;
  cursor: default;
}
.sj-mem-cancel {
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text-secondary);
}
.sj-mem-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
}
.sj-mem-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-subtle);
}
.sj-mem-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.sj-mem-badges {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sj-mem-cat {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--cpu-primary);
  background: var(--cpu-primary-soft);
}
.sj-mem-src {
  font-size: 11px;
  color: var(--cpu-text-secondary);
}
.sj-mem-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  word-break: break-word;
}
.sj-mem-ops {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.sj-mem-ops button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--cpu-text-secondary);
  cursor: pointer;
}
.sj-mem-ops button:hover {
  color: var(--cpu-text);
  background: color-mix(in srgb, var(--cpu-text) 7%, transparent);
}
.sj-mem-empty {
  padding: 20px 14px;
  border-radius: 12px;
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.55;
  text-align: center;
}
.sj-mem-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--cpu-text-secondary);
}
.sj-mem-clear {
  padding: 4px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--cpu-danger, #dc2626);
  font-size: 12px;
  cursor: pointer;
}
.sj-mem-clear:hover {
  background: color-mix(in srgb, var(--cpu-danger, #dc2626) 10%, transparent);
}
</style>
