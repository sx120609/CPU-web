<template>
  <!-- 实时/可折叠多步工具执行时间线 -->
  <div v-if="steps?.length" class="sj-steps">
    <button
      type="button"
      class="sj-steps-toggle"
      :aria-expanded="stepsExpanded"
      @click="stepsExpanded = !stepsExpanded"
    >
      <span class="sj-steps-dot" :class="{ 'is-running': hasRunningStep }"></span>
      <span class="sj-steps-summary">{{ summaryLabel }}</span>
      <el-icon class="sj-steps-arrow" :class="{ 'is-open': stepsExpanded }"><ArrowRight /></el-icon>
    </button>
    <ul v-if="stepsExpanded || streaming" class="sj-steps-list">
      <li v-for="step in steps" :key="step.id" class="sj-step-item" :class="`is-${step.status}`">
        <span class="sj-step-icon" aria-hidden="true">
          <template v-if="step.status === 'running'">●</template>
          <template v-else-if="step.status === 'done'">✓</template>
          <template v-else-if="step.status === 'blocked'">!</template>
          <template v-else>×</template>
        </span>
        <span class="sj-step-text">
          {{ step.label }}
          <em v-if="step.detail">（{{ step.detail }}）</em>
        </span>
      </li>
    </ul>
  </div>

  <!-- 记忆自动更新轻提示 -->
  <div v-if="memoryChanges?.length && !streaming" class="sj-mem-chips">
    <button
      v-for="change in memoryChanges"
      :key="change.id"
      type="button"
      class="sj-mem-chip"
      title="点击管理个人记忆"
      @click="emit('openMemories')"
    >
      <span>{{ change.op === "deleted" ? "已移除记忆" : `已记住：${change.memory?.content || ""}` }}</span>
      <small>管理</small>
    </button>
  </div>

  <!-- 交互式待确认操作卡片 -->
  <div v-if="proposals?.length && !streaming" class="sj-proposals">
    <div
      v-for="(proposal, idx) in proposals"
      :key="idx"
      class="sj-proposal-card"
      :class="`is-${cardState(idx)}`"
    >
      <!-- 1. 权限快捷开启卡片 -->
      <template v-if="proposal.type === 'permission.enable'">
        <div class="sj-prop-head">
          <span class="sj-prop-badge">需要数据授权</span>
          <strong>{{ proposal.title }}</strong>
        </div>
        <p class="sj-prop-desc">{{ proposal.hint }}</p>
        <div class="sj-prop-actions">
          <button
            v-if="cardState(idx) === 'pending'"
            type="button"
            class="sj-prop-btn sj-prop-btn--primary"
            :disabled="busyIdx === idx"
            @click="enableScopeAndRetry(proposal, idx)"
          >
            {{ busyIdx === idx ? "正在授权…" : "开启此项授权并重新回答" }}
          </button>
          <span v-else class="sj-prop-done">✓ 已开启授权</span>
        </div>
      </template>

      <!-- 2. 教务重新授权卡片 -->
      <template v-else-if="proposal.type === 'jwxt.reauth'">
        <div class="sj-prop-head">
          <span class="sj-prop-badge sj-prop-badge--warn">教务登录已过期</span>
          <strong>恢复学校统一认证授权</strong>
        </div>
        <p class="sj-prop-desc">{{ proposal.reason }}</p>
        <div class="sj-prop-actions">
          <button
            type="button"
            class="sj-prop-btn sj-prop-btn--primary"
            @click="emit('requestJwxtReauth')"
          >
            恢复教务授权并重试
          </button>
        </div>
      </template>

      <!-- 3. 新建日程卡片 -->
      <template v-else-if="proposal.type === 'agenda.create'">
        <div class="sj-prop-head">
          <span class="sj-prop-badge">新建日程</span>
          <strong>{{ proposal.item.title }}</strong>
        </div>
        <p class="sj-prop-meta">
          <span>{{ formatAgendaSchedule(proposal.item) }}</span>
          <span v-if="proposal.item.location"> · {{ proposal.item.location }}</span>
        </p>
        <p v-if="proposal.conflictHint" class="sj-prop-warn">⚠️ {{ proposal.conflictHint }}</p>
        <div class="sj-prop-actions">
          <template v-if="cardState(idx) === 'pending'">
            <button type="button" class="sj-prop-btn sj-prop-btn--primary" @click="applyAgendaCreate(proposal, idx)">添加到我的日程</button>
            <button type="button" class="sj-prop-btn" @click="setCardState(idx, 'dismissed')">忽略</button>
          </template>
          <template v-else-if="cardState(idx) === 'applied'">
            <span class="sj-prop-done">✓ 已添加到日程并同步</span>
            <button v-if="appliedAgendaId[idx]" type="button" class="sj-prop-btn" @click="undoAgendaCreate(idx)">撤销</button>
            <router-link class="sj-prop-link" to="/agenda">查看日程</router-link>
          </template>
          <span v-else class="sj-prop-muted">已忽略</span>
        </div>
      </template>

      <!-- 4. 修改/完成/删除日程卡片 -->
      <template v-else-if="proposal.type === 'agenda.update' || proposal.type === 'agenda.complete' || proposal.type === 'agenda.delete'">
        <div class="sj-prop-head">
          <span class="sj-prop-badge">
            {{ proposal.type === "agenda.complete" ? "完成日程" : proposal.type === "agenda.delete" ? "删除日程" : "修改日程" }}
          </span>
          <strong>{{ proposal.title || proposal.id }}</strong>
        </div>
        <div class="sj-prop-actions">
          <template v-if="cardState(idx) === 'pending'">
            <button
              type="button"
              class="sj-prop-btn"
              :class="proposal.type === 'agenda.delete' ? 'sj-prop-btn--danger' : 'sj-prop-btn--primary'"
              @click="applyAgendaMutation(proposal, idx)"
            >
              确认执行
            </button>
            <button type="button" class="sj-prop-btn" @click="setCardState(idx, 'dismissed')">取消</button>
          </template>
          <span v-else-if="cardState(idx) === 'applied'" class="sj-prop-done">✓ 已更新日程</span>
          <span v-else class="sj-prop-muted">已取消</span>
        </div>
      </template>

      <!-- 5. 论坛发帖预览与确认卡片 -->
      <template v-else-if="proposal.type === 'forum.post'">
        <div class="sj-prop-head">
          <span class="sj-prop-badge">发帖草稿 · 需你确认后发出</span>
          <strong>板块：{{ proposal.boardName || proposal.board }}</strong>
        </div>
        <template v-if="cardState(idx) === 'pending'">
          <input v-model="getDraft(idx, proposal).title" class="sj-prop-input" maxlength="80" aria-label="帖子标题" />
          <textarea v-model="getDraft(idx, proposal).content" class="sj-prop-textarea" rows="4" maxlength="5000" aria-label="帖子正文"></textarea>
          <label class="sj-prop-check">
            <input v-model="getDraft(idx, proposal).anonymous" type="checkbox" />
            <span>匿名发布（若板块支持）</span>
          </label>
          <div class="sj-prop-actions">
            <button
              type="button"
              class="sj-prop-btn sj-prop-btn--primary"
              :disabled="busyIdx === idx"
              @click="submitForumPost(idx)"
            >
              {{ busyIdx === idx ? "正在发布…" : "确认发布帖子" }}
            </button>
            <button type="button" class="sj-prop-btn" @click="setCardState(idx, 'dismissed')">放弃草稿</button>
          </div>
        </template>
        <div v-else-if="cardState(idx) === 'applied'" class="sj-prop-actions">
          <span class="sj-prop-done">✓ {{ resultNotes[idx] || "帖子已提交" }}</span>
          <router-link v-if="resultLinks[idx]" class="sj-prop-link" :to="resultLinks[idx]">查看帖子</router-link>
        </div>
        <span v-else class="sj-prop-muted">已放弃该发帖草稿</span>
      </template>

      <!-- 6. 回帖预览与确认卡片 -->
      <template v-else-if="proposal.type === 'forum.reply'">
        <div class="sj-prop-head">
          <span class="sj-prop-badge">回帖草稿 · 需确认</span>
          <strong>回复：{{ proposal.topicTitle || `帖子 #${proposal.topicId}` }}</strong>
        </div>
        <template v-if="cardState(idx) === 'pending'">
          <textarea v-model="getDraft(idx, proposal).content" class="sj-prop-textarea" rows="3" maxlength="2000" aria-label="回复内容"></textarea>
          <div class="sj-prop-actions">
            <button
              type="button"
              class="sj-prop-btn sj-prop-btn--primary"
              :disabled="busyIdx === idx"
              @click="submitForumReply(proposal, idx)"
            >
              {{ busyIdx === idx ? "正在回复…" : "确认发送回复" }}
            </button>
            <button type="button" class="sj-prop-btn" @click="setCardState(idx, 'dismissed')">取消</button>
          </div>
        </template>
        <div v-else-if="cardState(idx) === 'applied'" class="sj-prop-actions">
          <span class="sj-prop-done">✓ {{ resultNotes[idx] || "回复已提交" }}</span>
          <router-link class="sj-prop-link" :to="`/forum/topic/${proposal.topicId}`">查看原帖</router-link>
        </div>
        <span v-else class="sj-prop-muted">已取消回复</span>
      </template>

      <!-- 7. 失物招领发布卡片 -->
      <template v-else-if="proposal.type === 'lostfound.post'">
        <div class="sj-prop-head">
          <span class="sj-prop-badge">{{ proposal.kind === "found" ? "招领草稿" : "寻物草稿" }} · 需确认</span>
          <strong>{{ proposal.itemName }}</strong>
        </div>
        <template v-if="cardState(idx) === 'pending'">
          <div class="sj-prop-grid">
            <input v-model="getDraft(idx, proposal).itemName" class="sj-prop-input" placeholder="物品名称" />
            <input v-model="getDraft(idx, proposal).campus" class="sj-prop-input" placeholder="校区" />
            <input v-model="getDraft(idx, proposal).location" class="sj-prop-input" placeholder="地点" />
            <input v-model="getDraft(idx, proposal).contact" class="sj-prop-input" placeholder="联系方式" />
            <input
              v-if="proposal.kind === 'found'"
              v-model="getDraft(idx, proposal).storageLocation"
              class="sj-prop-input"
              placeholder="物品存放处"
            />
          </div>
          <textarea v-model="getDraft(idx, proposal).description" class="sj-prop-textarea" rows="2" placeholder="物品特征补充描述"></textarea>
          <div class="sj-prop-actions">
            <button
              type="button"
              class="sj-prop-btn sj-prop-btn--primary"
              :disabled="busyIdx === idx"
              @click="submitLostFound(proposal, idx)"
            >
              {{ busyIdx === idx ? "正在发布…" : "确认发布到失物招领" }}
            </button>
            <button type="button" class="sj-prop-btn" @click="setCardState(idx, 'dismissed')">取消</button>
          </div>
        </template>
        <div v-else-if="cardState(idx) === 'applied'" class="sj-prop-actions">
          <span class="sj-prop-done">✓ 已发布失物招领信息</span>
          <router-link class="sj-prop-link" to="/lost-found">前往失物招领</router-link>
        </div>
        <span v-else class="sj-prop-muted">已取消</span>
      </template>

      <!-- 8. 站内私信草稿确认卡片 -->
      <template v-else-if="proposal.type === 'dm.send'">
        <div class="sj-prop-head">
          <span class="sj-prop-badge">私信草稿 · 发送后不可撤回</span>
          <strong>发给：{{ proposal.name || `用户 #${proposal.userId}` }}</strong>
        </div>
        <template v-if="cardState(idx) === 'pending'">
          <textarea v-model="getDraft(idx, proposal).content" class="sj-prop-textarea" rows="2" maxlength="1000"></textarea>
          <div class="sj-prop-actions">
            <button
              type="button"
              class="sj-prop-btn sj-prop-btn--primary"
              :disabled="busyIdx === idx"
              @click="submitDirectMessage(proposal, idx)"
            >
              {{ busyIdx === idx ? "正在发送…" : "确认发送私信" }}
            </button>
            <button type="button" class="sj-prop-btn" @click="setCardState(idx, 'dismissed')">取消</button>
          </div>
        </template>
        <span v-else-if="cardState(idx) === 'applied'" class="sj-prop-done">✓ 私信已发送</span>
        <span v-else class="sj-prop-muted">已取消</span>
      </template>

      <!-- 9. 通知全部已读卡片 -->
      <template v-else-if="proposal.type === 'messages.readAll'">
        <div class="sj-prop-head">
          <span class="sj-prop-badge">通知操作</span>
          <strong>将全部站内未读通知标为已读</strong>
        </div>
        <div class="sj-prop-actions">
          <button
            v-if="cardState(idx) === 'pending'"
            type="button"
            class="sj-prop-btn sj-prop-btn--primary"
            :disabled="busyIdx === idx"
            @click="markAllMessagesRead(idx)"
          >
            确认全部已读
          </button>
          <span v-else class="sj-prop-done">✓ 已全部标为已读</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ArrowRight } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { directMessageApi } from "@/api/directMessage";
import { lostFoundApi } from "@/api/lostFound";
import { messageApi } from "@/api/message";
import {
  searchApi,
  type PersonalAgentMemoryChange,
  type PersonalAgentPermissions,
  type PersonalAgentProposal,
  type PersonalAgentStep,
} from "@/api/search";
import { replyApi, topicApi } from "@/api/topic";
import { useAgendaStore } from "@/stores/agenda";

const props = defineProps<{
  steps?: PersonalAgentStep[];
  proposals?: PersonalAgentProposal[];
  proposalStates?: Record<number, "pending" | "applied" | "dismissed">;
  memoryChanges?: PersonalAgentMemoryChange[];
  streaming?: boolean;
}>();

const emit = defineEmits<{
  openMemories: [];
  requestJwxtReauth: [];
  permissionsUpdated: [permissions: PersonalAgentPermissions, retryCurrentQuestion: boolean];
  updateProposalState: [index: number, state: "pending" | "applied" | "dismissed"];
}>();

const agenda = useAgendaStore();
const stepsExpanded = ref(false);
const busyIdx = ref<number | null>(null);
const localStates = reactive<Record<number, "pending" | "applied" | "dismissed">>({});
const drafts = reactive<Record<number, Record<string, any>>>({});
const appliedAgendaId = reactive<Record<number, string>>({});
const resultLinks = reactive<Record<number, string>>({});
const resultNotes = reactive<Record<number, string>>({});

const hasRunningStep = computed(() => Boolean(props.steps?.some((s) => s.status === "running")));
const summaryLabel = computed(() => {
  const list = props.steps || [];
  if (!list.length) return "";
  const running = [...list].reverse().find((s) => s.status === "running");
  if (running) return running.label;
  return `已完成 ${list.length} 项个人数据读取与精算`;
});

function cardState(idx: number): "pending" | "applied" | "dismissed" {
  return localStates[idx] || props.proposalStates?.[idx] || "pending";
}

function setCardState(idx: number, state: "pending" | "applied" | "dismissed") {
  localStates[idx] = state;
  emit("updateProposalState", idx, state);
}

function getDraft(idx: number, proposal: Record<string, any>) {
  if (!drafts[idx]) {
    drafts[idx] = JSON.parse(JSON.stringify(proposal));
  }
  return drafts[idx];
}

function formatAgendaSchedule(item: { date: string; start: string; end: string; repeat: string }) {
  const parts: string[] = [];
  if (item.date) parts.push(item.date);
  else parts.push("未设日期（待办）");
  if (item.start && item.end) parts.push(`${item.start} - ${item.end}`);
  else if (item.start) parts.push(item.start);
  const repMap: Record<string, string> = { daily: "每天", weekdays: "工作日", weekly: "每周", monthly: "每月" };
  if (item.repeat && item.repeat !== "none" && repMap[item.repeat]) parts.push(repMap[item.repeat]);
  return parts.join(" ");
}

async function enableScopeAndRetry(proposal: Extract<PersonalAgentProposal, { type: "permission.enable" }>, idx: number) {
  busyIdx.value = idx;
  try {
    const res = await searchApi.savePersonalAgentPermissions({ [proposal.scope]: true });
    setCardState(idx, "applied");
    emit("permissionsUpdated", res.permissions, true);
  } catch {
    ElMessage.error("开启授权失败，请重试");
  } finally {
    busyIdx.value = null;
  }
}

function applyAgendaCreate(proposal: Extract<PersonalAgentProposal, { type: "agenda.create" }>, idx: number) {
  const saved = agenda.save({
    ...proposal.item,
    origin: "assistant",
  });
  if (!saved) {
    ElMessage.warning(agenda.error || "添加日程失败");
    return;
  }
  appliedAgendaId[idx] = saved.id;
  setCardState(idx, "applied");
  void agenda.sync();
}

function undoAgendaCreate(idx: number) {
  const id = appliedAgendaId[idx];
  if (!id) return;
  agenda.remove(id);
  delete appliedAgendaId[idx];
  setCardState(idx, "pending");
  void agenda.sync();
}

function applyAgendaMutation(
  proposal: Extract<PersonalAgentProposal, { type: "agenda.update" | "agenda.complete" | "agenda.delete" }>,
  idx: number,
) {
  agenda.attach();
  if (proposal.type === "agenda.complete") {
    agenda.setDone(proposal.id, proposal.date || "", true);
  } else if (proposal.type === "agenda.delete") {
    agenda.remove(proposal.id);
  } else {
    const existing = agenda.find(proposal.id);
    if (!existing) {
      ElMessage.warning("未在本机日程中找到该条目，可能已被删除");
      return;
    }
    agenda.save({ ...existing, ...proposal.changes, id: proposal.id });
  }
  setCardState(idx, "applied");
  void agenda.sync();
}

async function submitForumPost(idx: number) {
  const draft = drafts[idx];
  if (!draft?.title?.trim() || !draft?.content?.trim()) {
    ElMessage.warning("标题和内容不能为空");
    return;
  }
  busyIdx.value = idx;
  try {
    const res = await topicApi.create({
      boardSlug: draft.board,
      title: draft.title.trim(),
      content: draft.content.trim(),
      anonymous: Boolean(draft.anonymous),
    });
    const topicId = (res as any)?.topic?.id ?? (res as any)?.id;
    if (topicId) resultLinks[idx] = `/forum/topic/${topicId}`;
    resultNotes[idx] = (res as any)?.topic?.hidden ? "已提交，审核通过后公开显示" : "帖子已发布";
    setCardState(idx, "applied");
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || err?.message || "发帖失败");
  } finally {
    busyIdx.value = null;
  }
}

async function submitForumReply(proposal: Extract<PersonalAgentProposal, { type: "forum.reply" }>, idx: number) {
  const draft = getDraft(idx, proposal);
  if (!draft.content?.trim()) {
    ElMessage.warning("回复内容不能为空");
    return;
  }
  busyIdx.value = idx;
  try {
    const res = await replyApi.create({
      topicId: proposal.topicId,
      content: draft.content.trim(),
      parentReplyId: proposal.parentReplyId,
      anonymous: Boolean(draft.anonymous),
    });
    resultNotes[idx] = (res as any)?.reply?.hidden ? "已提交，审核通过后显示" : "回复已发出";
    setCardState(idx, "applied");
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || err?.message || "回复失败");
  } finally {
    busyIdx.value = null;
  }
}

async function submitLostFound(proposal: Extract<PersonalAgentProposal, { type: "lostfound.post" }>, idx: number) {
  const draft = getDraft(idx, proposal);
  busyIdx.value = idx;
  try {
    await lostFoundApi.create({
      kind: proposal.kind,
      itemName: String(draft.itemName || "").trim(),
      description: String(draft.description || "").trim(),
      campus: String(draft.campus || "").trim(),
      location: String(draft.location || "").trim(),
      happenedAt: proposal.happenedAt,
      storageLocation: String(draft.storageLocation || "").trim(),
      contact: String(draft.contact || "").trim(),
      images: [],
    });
    setCardState(idx, "applied");
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || err?.message || "发布失物招领失败");
  } finally {
    busyIdx.value = null;
  }
}

async function submitDirectMessage(proposal: Extract<PersonalAgentProposal, { type: "dm.send" }>, idx: number) {
  const draft = getDraft(idx, proposal);
  if (!draft.content?.trim()) {
    ElMessage.warning("私信内容不能为空");
    return;
  }
  busyIdx.value = idx;
  try {
    await directMessageApi.sendToUser(proposal.userId, draft.content.trim());
    setCardState(idx, "applied");
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || err?.message || "发送私信失败");
  } finally {
    busyIdx.value = null;
  }
}

async function markAllMessagesRead(idx: number) {
  busyIdx.value = idx;
  try {
    await messageApi.readAll();
    setCardState(idx, "applied");
  } catch {
    ElMessage.error("操作失败，请稍后重试");
  } finally {
    busyIdx.value = null;
  }
}
</script>

<style scoped>
.sj-steps {
  margin-bottom: 10px;
  border-radius: 12px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-subtle);
  overflow: hidden;
}
.sj-steps-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 11px;
  border: none;
  background: transparent;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.sj-steps-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--cpu-primary);
  flex-shrink: 0;
}
.sj-steps-dot.is-running {
  animation: sj-pulse 1.2s ease-in-out infinite;
}
@keyframes sj-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.15); }
}
.sj-steps-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sj-steps-arrow {
  font-size: 12px;
  transition: transform 0.16s ease;
}
.sj-steps-arrow.is-open {
  transform: rotate(90deg);
}
.sj-steps-list {
  margin: 0;
  padding: 2px 11px 9px 11px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-top: 1px solid var(--cpu-border-soft);
}
.sj-step-item {
  display: flex;
  align-items: baseline;
  gap: 7px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--cpu-text-secondary);
}
.sj-step-item.is-done .sj-step-icon { color: var(--cpu-primary); font-weight: 700; }
.sj-step-item.is-blocked .sj-step-icon { color: #d97706; font-weight: 700; }
.sj-step-item.is-error .sj-step-icon { color: #dc2626; font-weight: 700; }
.sj-step-text em {
  font-style: normal;
  opacity: 0.8;
}

.sj-mem-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.sj-mem-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 24%, transparent);
  background: var(--cpu-primary-soft);
  color: var(--cpu-text);
  font-size: 12px;
  cursor: pointer;
}
.sj-mem-chip small {
  color: var(--cpu-primary);
  font-weight: 600;
}

.sj-proposals {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}
.sj-proposal-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-subtle);
}
.sj-proposal-card.is-dismissed {
  opacity: 0.65;
}
.sj-prop-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sj-prop-head strong {
  font-size: 13.5px;
  font-weight: 600;
}
.sj-prop-badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--cpu-primary);
  background: var(--cpu-primary-soft);
}
.sj-prop-badge--warn {
  color: #b45309;
  background: rgba(245, 158, 11, 0.15);
}
.sj-prop-desc,
.sj-prop-meta {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--cpu-text-secondary);
}
.sj-prop-warn {
  margin: 0;
  font-size: 12px;
  color: #b45309;
}
.sj-prop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
}
.sj-prop-input,
.sj-prop-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border-radius: 10px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-card);
  color: var(--cpu-text);
  font: inherit;
  font-size: 13px;
}
.sj-prop-textarea {
  resize: vertical;
  line-height: 1.5;
}
.sj-prop-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--cpu-text-secondary);
}
.sj-prop-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sj-prop-btn {
  padding: 6px 13px;
  border-radius: 9px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-card);
  color: var(--cpu-text);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}
.sj-prop-btn--primary {
  border-color: transparent;
  background: var(--cpu-primary);
  color: #fff;
}
.sj-prop-btn--danger {
  border-color: transparent;
  background: #dc2626;
  color: #fff;
}
.sj-prop-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.sj-prop-done {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--cpu-primary);
}
.sj-prop-muted {
  font-size: 12px;
  color: var(--cpu-text-secondary);
}
.sj-prop-link {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--cpu-primary);
  text-decoration: none;
}
.sj-prop-link:hover {
  text-decoration: underline;
}
</style>
