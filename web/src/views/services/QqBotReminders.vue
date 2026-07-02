<template>
  <div class="qqbot-reminder-page">
    <section class="reminder-head">
      <div>
        <div class="kicker">通知设置</div>
        <h2>小工具提醒规则</h2>
        <p>按问卷、收集任务和成绩核对表分别设置通知事件与触发时间。</p>
      </div>
      <div class="head-actions">
        <el-button plain @click="router.push('/messages?tab=settings')">
          <el-icon><ArrowLeft /></el-icon>
          返回通知设置
        </el-button>
        <el-button plain type="primary" @click="router.push('/messages?tab=settings')">
          <el-icon><Bell /></el-icon>
          QQ 私聊绑定
        </el-button>
      </div>
    </section>

    <section class="reminder-panel" v-loading="loading">
      <el-alert
        v-if="pageError"
        type="error"
        :closable="false"
        show-icon
        class="panel-alert"
        :title="pageError"
      >
        <template #default>
          <el-button size="small" :loading="loading" @click="loadPage">重试</el-button>
        </template>
      </el-alert>

      <template v-else>
        <div class="binding-strip" :class="{ muted: !page?.binding?.enabled }">
          <div>
            <b>{{ bindingTitle }}</b>
            <span>{{ bindingHint }}</span>
          </div>
          <el-button v-if="!page?.binding?.enabled" type="primary" plain @click="router.push('/messages?tab=settings')">去绑定</el-button>
        </div>

        <el-empty v-if="!loading && !items.length" description="暂无可设置提醒的小工具">
          <el-button type="primary" @click="router.push('/services/tools/manage')">去发起小工具</el-button>
        </el-empty>

        <div v-else class="reminder-list">
          <article v-for="item in items" :key="itemKey(item)" class="reminder-item">
            <div class="item-head">
              <div class="item-title">
                <span class="tool-badge">{{ item.toolName }}</span>
                <h3>{{ item.title }}</h3>
                <div class="item-meta">
                  <span>{{ statusText(item.status) }}</span>
                  <span>{{ item.metricLabel }}</span>
                  <span>{{ item.eventLabel }}</span>
                </div>
              </div>
              <el-switch
                v-model="drafts[itemKey(item)].enabled"
                inline-prompt
                active-text="开"
                inactive-text="关"
              />
            </div>

            <div class="setting-grid">
              <label class="setting-block">
                <span>提醒事件</span>
                <el-checkbox-group v-model="drafts[itemKey(item)].events">
                  <el-checkbox
                    v-for="event in item.eventOptions"
                    :key="event.value"
                    :label="event.value"
                  >
                    {{ event.label }}
                  </el-checkbox>
                </el-checkbox-group>
              </label>

              <label class="setting-block">
                <span>触发时机</span>
                <el-radio-group v-model="drafts[itemKey(item)].timing" class="timing-group">
                  <el-radio-button label="instant">立即</el-radio-button>
                  <el-radio-button label="after">指定时间后</el-radio-button>
                  <el-radio-button label="deadline">截止前</el-radio-button>
                </el-radio-group>
              </label>

              <label v-if="drafts[itemKey(item)].timing === 'after'" class="setting-block">
                <span>开始提醒时间</span>
                <el-date-picker
                  v-model="drafts[itemKey(item)].afterAt"
                  type="datetime"
                  placeholder="选择时间"
                  style="width: 100%"
                />
              </label>

              <template v-if="drafts[itemKey(item)].timing === 'deadline'">
                <label class="setting-block">
                  <span>截止时间</span>
                  <el-date-picker
                    v-model="drafts[itemKey(item)].deadlineAt"
                    type="datetime"
                    placeholder="选择截止时间"
                    style="width: 100%"
                  />
                </label>
                <label class="setting-block">
                  <span>提前小时数</span>
                  <el-input-number
                    v-model="drafts[itemKey(item)].beforeDeadlineHours"
                    :min="1"
                    :max="720"
                    :step="1"
                    controls-position="right"
                    style="width: 160px"
                  />
                </label>
              </template>
            </div>

            <div class="item-actions">
              <el-button text @click="router.push(item.manageLink)">
                <el-icon><Setting /></el-icon>
                管理
              </el-button>
              <el-button text @click="router.push(item.link)">
                <el-icon><Link /></el-icon>
                打开
              </el-button>
              <el-button
                type="primary"
                :loading="savingKey === itemKey(item)"
                :disabled="savingKey !== ''"
                @click="saveItem(item)"
              >
                保存
              </el-button>
            </div>
          </article>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowLeft, Bell, Link, Setting } from "@element-plus/icons-vue";
import {
  toolsApi,
  type ToolQqReminderItem,
  type ToolQqReminderPage,
  type ToolQqReminderTiming,
} from "@/api/tools";

type ReminderDraft = {
  enabled: boolean;
  events: string[];
  timing: ToolQqReminderTiming;
  afterAt: Date | null;
  deadlineAt: Date | null;
  beforeDeadlineHours: number;
};

const router = useRouter();
const loading = ref(false);
const savingKey = ref("");
const pageError = ref("");
const page = ref<ToolQqReminderPage | null>(null);
const drafts = reactive<Record<string, ReminderDraft>>({});

const items = computed(() => page.value?.items ?? []);
const bindingTitle = computed(() => {
  if (!page.value?.binding) return "尚未绑定 QQ 私聊";
  return page.value.binding.enabled ? `已绑定 QQ ${page.value.binding.qqId}` : `QQ ${page.value.binding.qqId} 已停用`;
});
const bindingHint = computed(() => {
  if (!page.value?.binding) return "提醒设置会保存，但需要绑定并启用 QQ 私聊后才能收到提醒。";
  return page.value.binding.enabled ? "符合策略的新消息会通过 QQ 私聊提醒你。" : "当前绑定已停用，请在通知设置中重新绑定或联系管理员。";
});

onMounted(loadPage);

async function loadPage() {
  loading.value = true;
  pageError.value = "";
  try {
    const next = await toolsApi.qqBotReminders({ suppressErrorMessage: true });
    page.value = next;
    syncDrafts(next.items);
  } catch (error) {
    page.value = null;
    pageError.value = requestMessage(error) || "小工具提醒加载失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}

function syncDrafts(nextItems: ToolQqReminderItem[]) {
  const keys = new Set(nextItems.map(itemKey));
  for (const key of Object.keys(drafts)) {
    if (!keys.has(key)) delete drafts[key];
  }
  for (const item of nextItems) {
    drafts[itemKey(item)] = {
      enabled: item.enabled,
      events: [...(item.config?.events?.length ? item.config.events : item.eventOptions.map((event) => event.value))],
      timing: item.config?.timing ?? "instant",
      afterAt: toDate(item.config?.afterAt),
      deadlineAt: toDate(item.config?.deadlineAt || item.deadlineAt),
      beforeDeadlineHours: Number(item.config?.beforeDeadlineHours ?? 24),
    };
  }
}

async function saveItem(item: ToolQqReminderItem) {
  const key = itemKey(item);
  const draft = drafts[key];
  if (!draft || savingKey.value) return;
  savingKey.value = key;
  try {
    const updated = await toolsApi.updateQqBotReminder(item.targetType, item.targetId, {
      enabled: draft.enabled,
      events: draft.events,
      timing: draft.timing,
      afterAt: toIso(draft.afterAt),
      deadlineAt: toIso(draft.deadlineAt),
      beforeDeadlineHours: draft.beforeDeadlineHours,
    });
    const index = items.value.findIndex((current) => itemKey(current) === key);
    if (page.value && index >= 0) page.value.items.splice(index, 1, updated);
    syncDrafts(page.value?.items ?? []);
    ElMessage.success(updated.enabled ? "提醒设置已保存" : "已关闭该提醒");
  } finally {
    savingKey.value = "";
  }
}

function itemKey(item: ToolQqReminderItem) {
  return `${item.targetType}:${item.targetId}`;
}

function statusText(status: string) {
  if (status === "open") return "开放中";
  if (status === "draft") return "草稿";
  if (status === "closed") return "已关闭";
  return status || "未知状态";
}

function toDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function toIso(value: Date | null) {
  return value && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function requestMessage(error: unknown) {
  return (error as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message
    || (error as { message?: string }).message
    || "";
}
</script>

<style scoped>
.qqbot-reminder-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.reminder-head,
.reminder-panel {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(15, 23, 42, 0.04);
}

.reminder-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 24px;
}

.kicker {
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 700;
}

.reminder-head h2 {
  margin: 4px 0 6px;
  font-size: 24px;
  color: var(--cpu-text);
}

.reminder-head p {
  margin: 0;
  color: var(--cpu-text-secondary);
}

.head-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.reminder-panel {
  padding: 18px;
  min-height: 280px;
}

.panel-alert {
  margin-bottom: 14px;
}

.binding-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 8px;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.28);
  color: var(--cpu-text);
  margin-bottom: 16px;
}

.binding-strip.muted {
  background: rgba(245, 158, 11, 0.14);
  border-color: rgba(245, 158, 11, 0.28);
  color: var(--cpu-text);
}

.binding-strip div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.binding-strip span {
  font-size: 13px;
  color: var(--cpu-text-secondary);
}

.reminder-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.reminder-item {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  padding: 16px;
  background: var(--cpu-card);
}

.item-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.item-title {
  min-width: 0;
}

.tool-badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
  font-size: 12px;
  font-weight: 700;
}

.item-title h3 {
  margin: 8px 0 6px;
  font-size: 18px;
  line-height: 1.35;
  color: var(--cpu-text);
}

.item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--cpu-text-secondary);
  font-size: 13px;
}

.setting-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 16px;
}

.setting-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.setting-block > span {
  color: var(--cpu-text-secondary);
  font-size: 13px;
  font-weight: 700;
}

:global(html[data-theme="dark"]) .tool-badge {
  color: #93c5fd;
}

.timing-group {
  display: flex;
  flex-wrap: wrap;
}

.item-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

@media (max-width: 720px) {
  .reminder-head,
  .item-head,
  .binding-strip {
    align-items: stretch;
    flex-direction: column;
  }

  .setting-grid {
    grid-template-columns: 1fr;
  }

  .head-actions,
  .item-actions {
    justify-content: stretch;
  }

  .head-actions .el-button,
  .item-actions .el-button {
    flex: 1;
  }
}
</style>
