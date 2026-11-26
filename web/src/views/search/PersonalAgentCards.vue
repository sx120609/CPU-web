<template>
  <!-- 工具执行时间线：Result.vue 用 section="steps" 放在回答上方 -->
  <div v-if="showSteps && steps?.length" class="sj-steps">
    <button
      type="button"
      class="sj-steps-toggle"
      :aria-expanded="stepsExpanded"
      :aria-controls="stepsListId"
      @click="stepsExpanded = !stepsExpanded"
    >
      <span class="sj-steps-dot" :class="{ 'is-running': hasRunningStep }" aria-hidden="true"></span>
      <span class="sj-steps-summary" aria-live="polite">{{ summaryLabel }}</span>
      <el-icon class="sj-steps-arrow" :class="{ 'is-open': stepsExpanded }" aria-hidden="true"><ArrowRight /></el-icon>
    </button>
    <ul v-if="stepsExpanded || streaming" :id="stepsListId" class="sj-steps-list">
      <li v-for="step in steps" :key="step.id" class="sj-step-item" :class="`is-${step.status}`">
        <span class="sj-step-icon" aria-hidden="true">{{ STEP_ICONS[step.status] }}</span>
        <span class="sj-step-text">
          {{ step.label }}<span class="sj-visually-hidden">（{{ STEP_STATUS_TEXT[step.status] }}）</span>
          <em v-if="step.detail">（{{ step.detail }}）</em>
        </span>
      </li>
    </ul>
  </div>

  <template v-if="showActions && !streaming">
    <!-- 记忆自动更新 -->
    <div v-if="memoryChanges?.length" class="sj-mem-notes">
      <button
        v-for="change in memoryChanges"
        :key="change.id"
        type="button"
        class="sj-mem-note"
        aria-label="管理个人记忆"
        @click="emit('openMemories')"
      >
        <span class="sj-mem-note-text">{{ change.op === "deleted" ? "已删除一条记忆" : `已记住：${change.memory?.content || ""}` }}</span>
        <span class="sj-mem-note-link">管理</span>
      </button>
    </div>

    <!-- 待确认操作 -->
    <div v-if="visibleProposals.length" class="sj-proposals">
      <section
        v-for="{ proposal, idx } in visibleProposals"
        :key="idx"
        class="sj-card"
        :class="`is-${cardState(idx)}`"
        :aria-label="cardLabel(proposal)"
      >
        <!-- 开启授权 -->
        <template v-if="proposal.type === 'permission.enable'">
          <header class="sj-card-head">
            <span class="sj-card-kind">需要授权</span>
            <strong class="sj-card-title">{{ proposal.title }}</strong>
          </header>
          <p v-if="proposal.hint" class="sj-card-desc">{{ proposal.hint }}</p>
          <div class="sj-card-actions">
            <template v-if="cardState(idx) === 'pending'">
              <button
                type="button"
                class="sj-btn sj-btn--primary"
                :disabled="busy[idx]"
                @click="enableScopeAndRetry(proposal, idx)"
              >
                {{ busy[idx] ? "正在开启…" : "开启并重试" }}
              </button>
              <button type="button" class="sj-btn" :disabled="busy[idx]" @click="setCardState(idx, 'dismissed')">暂不开启</button>
            </template>
            <span v-else-if="cardState(idx) === 'applied'" class="sj-card-done" role="status">已开启</span>
            <span v-else class="sj-card-muted">已忽略</span>
          </div>
        </template>

        <!-- 教务重新登录 -->
        <template v-else-if="proposal.type === 'jwxt.reauth'">
          <header class="sj-card-head">
            <span class="sj-card-kind">教务登录已过期</span>
          </header>
          <p class="sj-card-desc">{{ proposal.reason }}</p>
          <div class="sj-card-actions">
            <button type="button" class="sj-btn sj-btn--primary" @click="emit('requestJwxtReauth')">重新登录教务</button>
          </div>
        </template>

        <!-- 新建日程 -->
        <template v-else-if="proposal.type === 'agenda.create'">
          <header class="sj-card-head">
            <span class="sj-card-kind">新建日程</span>
            <strong v-if="cardState(idx) !== 'pending'" class="sj-card-title">{{ drafts[idx].title || proposal.item.title }}</strong>
          </header>
          <template v-if="cardState(idx) === 'pending'">
            <div class="sj-fields">
              <label class="sj-field sj-field--wide">
                <span>标题</span>
                <input v-model="drafts[idx].title" class="sj-input" maxlength="60" />
              </label>
              <label class="sj-field">
                <span>日期</span>
                <input v-model="drafts[idx].date" class="sj-input" type="date" />
              </label>
              <label class="sj-field">
                <span>提醒</span>
                <select v-model.number="drafts[idx].remind" class="sj-input" :disabled="!drafts[idx].date">
                  <option v-for="choice in remindChoices(drafts[idx].remind)" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
                </select>
              </label>
              <label class="sj-field">
                <span>开始</span>
                <input v-model="drafts[idx].start" class="sj-input" type="time" :disabled="!drafts[idx].date" />
              </label>
              <label class="sj-field">
                <span>结束</span>
                <input v-model="drafts[idx].end" class="sj-input" type="time" :disabled="!drafts[idx].date || !drafts[idx].start" />
              </label>
            </div>
            <p v-if="agendaExtraText(proposal)" class="sj-card-meta">{{ agendaExtraText(proposal) }}</p>
            <p v-if="proposal.conflictHint" class="sj-card-warn">{{ proposal.conflictHint }}</p>
          </template>
          <p v-else class="sj-card-meta">{{ formatAgendaSchedule(drafts[idx]) }}</p>
          <div class="sj-card-actions">
            <template v-if="cardState(idx) === 'pending'">
              <button type="button" class="sj-btn sj-btn--primary" :disabled="busy[idx]" @click="applyAgendaCreate(proposal, idx)">
                {{ busy[idx] ? "正在保存…" : "加入日程" }}
              </button>
              <button type="button" class="sj-btn" :disabled="busy[idx]" @click="setCardState(idx, 'dismissed')">忽略</button>
            </template>
            <template v-else-if="cardState(idx) === 'applied'">
              <span class="sj-card-done" role="status">已加入日程</span>
              <button v-if="drafts[idx].agendaId" type="button" class="sj-btn" @click="undoAgendaCreate(idx)">撤销</button>
              <router-link class="sj-link" to="/agenda">查看日程</router-link>
            </template>
            <span v-else class="sj-card-muted">已忽略</span>
          </div>
        </template>

        <!-- 修改 / 完成 / 删除日程 -->
        <template v-else-if="proposal.type === 'agenda.update' || proposal.type === 'agenda.complete' || proposal.type === 'agenda.delete'">
          <header class="sj-card-head">
            <span class="sj-card-kind">{{ AGENDA_MUTATION_KIND[proposal.type] }}</span>
            <strong class="sj-card-title">{{ agenda.find(proposal.id)?.title || proposal.title || "日程" }}</strong>
          </header>
          <dl v-if="proposal.type === 'agenda.update' && cardState(idx) === 'pending'" class="sj-diff">
            <div v-for="row in agendaChangeRows(proposal)" :key="row.key" class="sj-diff-row">
              <dt>{{ row.label }}</dt>
              <dd>
                <template v-if="row.before !== null"><s>{{ row.before }}</s> → </template>{{ row.after }}
              </dd>
            </div>
          </dl>
          <p v-else-if="proposal.type === 'agenda.complete' && cardState(idx) === 'pending' && completeDateText(proposal)" class="sj-card-meta">
            {{ completeDateText(proposal) }}
          </p>
          <div class="sj-card-actions">
            <template v-if="cardState(idx) === 'pending'">
              <button
                type="button"
                class="sj-btn"
                :class="proposal.type === 'agenda.delete' ? 'sj-btn--danger' : 'sj-btn--primary'"
                :disabled="busy[idx]"
                @click="applyAgendaMutation(proposal, idx)"
              >
                {{ busy[idx] ? "正在保存…" : AGENDA_MUTATION_ACTION[proposal.type] }}
              </button>
              <button type="button" class="sj-btn" :disabled="busy[idx]" @click="setCardState(idx, 'dismissed')">取消</button>
            </template>
            <template v-else-if="cardState(idx) === 'applied'">
              <span class="sj-card-done" role="status">{{ drafts[idx].resultNote || AGENDA_MUTATION_DONE[proposal.type] }}</span>
              <button v-if="proposal.type === 'agenda.delete' && removedItems[idx]" type="button" class="sj-btn" @click="undoAgendaDelete(idx)">撤销</button>
            </template>
            <span v-else class="sj-card-muted">已取消</span>
          </div>
        </template>

        <!-- 论坛发帖 -->
        <template v-else-if="proposal.type === 'forum.post'">
          <header class="sj-card-head">
            <span class="sj-card-kind">发帖{{ proposal.boardName ? ` · ${proposal.boardName}` : "" }}</span>
            <strong v-if="cardState(idx) !== 'pending'" class="sj-card-title">{{ drafts[idx].title }}</strong>
          </header>
          <template v-if="cardState(idx) === 'pending'">
            <label class="sj-field">
              <span>标题</span>
              <input v-model="drafts[idx].title" class="sj-input" maxlength="80" />
            </label>
            <label class="sj-field">
              <span>正文</span>
              <textarea v-model="drafts[idx].content" class="sj-input sj-textarea" rows="5" maxlength="5000"></textarea>
            </label>
            <label v-if="anonAllowed[idx]" class="sj-check">
              <input v-model="drafts[idx].anonymous" type="checkbox" />
              <span>匿名发布</span>
            </label>
            <div class="sj-card-actions">
              <button type="button" class="sj-btn sj-btn--primary" :disabled="busy[idx]" @click="submitForumPost(proposal, idx)">
                {{ busy[idx] ? "正在发布…" : "发布" }}
              </button>
              <button type="button" class="sj-btn" :disabled="busy[idx]" @click="setCardState(idx, 'dismissed')">放弃</button>
            </div>
          </template>
          <div v-else-if="cardState(idx) === 'applied'" class="sj-card-actions">
            <span class="sj-card-done" role="status">{{ drafts[idx].resultNote || "已发布" }}</span>
            <router-link v-if="drafts[idx].resultLink" class="sj-link" :to="drafts[idx].resultLink">查看帖子</router-link>
          </div>
          <span v-else class="sj-card-muted">已放弃</span>
        </template>

        <!-- 回复帖子 -->
        <template v-else-if="proposal.type === 'forum.reply'">
          <header class="sj-card-head">
            <span class="sj-card-kind">回复帖子</span>
            <strong class="sj-card-title">{{ proposal.topicTitle || `帖子 #${proposal.topicId}` }}</strong>
          </header>
          <template v-if="cardState(idx) === 'pending'">
            <label class="sj-field">
              <span>回复内容</span>
              <textarea v-model="drafts[idx].content" class="sj-input sj-textarea" rows="3" maxlength="2000"></textarea>
            </label>
            <label v-if="anonAllowed[idx]" class="sj-check">
              <input v-model="drafts[idx].anonymous" type="checkbox" />
              <span>匿名回复</span>
            </label>
            <div class="sj-card-actions">
              <button type="button" class="sj-btn sj-btn--primary" :disabled="busy[idx]" @click="submitForumReply(proposal, idx)">
                {{ busy[idx] ? "正在发送…" : "发送回复" }}
              </button>
              <button type="button" class="sj-btn" :disabled="busy[idx]" @click="setCardState(idx, 'dismissed')">取消</button>
            </div>
          </template>
          <div v-else-if="cardState(idx) === 'applied'" class="sj-card-actions">
            <span class="sj-card-done" role="status">{{ drafts[idx].resultNote || "已回复" }}</span>
            <router-link class="sj-link" :to="`/forum/topic/${proposal.topicId}`">查看原帖</router-link>
          </div>
          <span v-else class="sj-card-muted">已取消</span>
        </template>

        <!-- 失物招领 -->
        <template v-else-if="proposal.type === 'lostfound.post'">
          <header class="sj-card-head">
            <span class="sj-card-kind">{{ proposal.kind === "found" ? "发布招领" : "发布寻物" }}</span>
            <strong v-if="cardState(idx) !== 'pending'" class="sj-card-title">{{ drafts[idx].itemName }}</strong>
          </header>
          <template v-if="cardState(idx) === 'pending'">
            <div class="sj-fields">
              <label class="sj-field">
                <span>物品</span>
                <input v-model="drafts[idx].itemName" class="sj-input" maxlength="80" />
              </label>
              <label class="sj-field">
                <span>校区</span>
                <select v-if="campusOptions.length" v-model="drafts[idx].campus" class="sj-input">
                  <option value="" disabled>选择校区</option>
                  <option v-for="campus in campusOptions" :key="campus" :value="campus">{{ campus }}</option>
                </select>
                <input v-else v-model="drafts[idx].campus" class="sj-input" maxlength="40" />
              </label>
              <label class="sj-field">
                <span>地点</span>
                <input v-model="drafts[idx].location" class="sj-input" maxlength="100" />
              </label>
              <label class="sj-field">
                <span>{{ proposal.kind === "found" ? "捡到时间" : "丢失时间" }}</span>
                <input v-model="drafts[idx].happenedAt" class="sj-input" type="datetime-local" />
              </label>
              <label v-if="proposal.kind === 'found'" class="sj-field">
                <span>存放处</span>
                <input v-model="drafts[idx].storageLocation" class="sj-input" maxlength="160" />
              </label>
              <label class="sj-field">
                <span>联系方式</span>
                <input v-model="drafts[idx].contact" class="sj-input" maxlength="120" />
              </label>
              <label class="sj-field sj-field--wide">
                <span>描述</span>
                <textarea v-model="drafts[idx].description" class="sj-input sj-textarea" rows="2" maxlength="1000"></textarea>
              </label>
            </div>
            <div class="sj-card-actions">
              <button type="button" class="sj-btn sj-btn--primary" :disabled="busy[idx]" @click="submitLostFound(proposal, idx)">
                {{ busy[idx] ? "正在发布…" : "发布" }}
              </button>
              <button type="button" class="sj-btn" :disabled="busy[idx]" @click="setCardState(idx, 'dismissed')">取消</button>
            </div>
          </template>
          <div v-else-if="cardState(idx) === 'applied'" class="sj-card-actions">
            <span class="sj-card-done" role="status">{{ drafts[idx].resultNote || "已发布" }}</span>
            <router-link class="sj-link" :to="drafts[idx].resultLink || '/lost-found'">查看</router-link>
          </div>
          <span v-else class="sj-card-muted">已取消</span>
        </template>

        <!-- 私信 -->
        <template v-else-if="proposal.type === 'dm.send'">
          <header class="sj-card-head">
            <span class="sj-card-kind">私信</span>
            <strong class="sj-card-title">{{ proposal.name || `用户 #${proposal.userId}` }}</strong>
          </header>
          <template v-if="cardState(idx) === 'pending'">
            <label class="sj-field">
              <span>内容</span>
              <textarea v-model="drafts[idx].content" class="sj-input sj-textarea" rows="3" maxlength="1000"></textarea>
            </label>
            <p class="sj-card-meta">发出后不能撤回</p>
            <div class="sj-card-actions">
              <button type="button" class="sj-btn sj-btn--primary" :disabled="busy[idx]" @click="submitDirectMessage(proposal, idx)">
                {{ busy[idx] ? "正在发送…" : "发送" }}
              </button>
              <button type="button" class="sj-btn" :disabled="busy[idx]" @click="setCardState(idx, 'dismissed')">取消</button>
            </div>
          </template>
          <span v-else-if="cardState(idx) === 'applied'" class="sj-card-done" role="status">已发送</span>
          <span v-else class="sj-card-muted">已取消</span>
        </template>

        <!-- 通知全部已读 -->
        <template v-else-if="proposal.type === 'messages.readAll'">
          <header class="sj-card-head">
            <span class="sj-card-kind">通知</span>
            <strong class="sj-card-title">全部标为已读</strong>
          </header>
          <div class="sj-card-actions">
            <template v-if="cardState(idx) === 'pending'">
              <button type="button" class="sj-btn sj-btn--primary" :disabled="busy[idx]" @click="markAllMessagesRead(idx)">
                {{ busy[idx] ? "正在处理…" : "全部已读" }}
              </button>
              <button type="button" class="sj-btn" :disabled="busy[idx]" @click="setCardState(idx, 'dismissed')">取消</button>
            </template>
            <span v-else-if="cardState(idx) === 'applied'" class="sj-card-done" role="status">已全部标为已读</span>
            <span v-else class="sj-card-muted">已取消</span>
          </div>
        </template>
      </section>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ArrowRight } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { boardApi } from "@/api/board";
import { directMessageApi } from "@/api/directMessage";
import { lostFoundApi, type LostFoundInput, type LostFoundItem } from "@/api/lostFound";
import { messageApi } from "@/api/message";
import { request } from "@/api/request";
import {
  searchApi,
  type PersonalAgentMemoryChange,
  type PersonalAgentPermissions,
  type PersonalAgentProposal,
  type PersonalAgentStep,
} from "@/api/search";
import {
  replyApi,
  topicApi,
  type ReplySubmissionResponse,
  type TopicSubmissionResponse,
} from "@/api/topic";
import { useAgendaStore } from "@/stores/agenda";
import { useAuthStore } from "@/stores/auth";
import { useMessageStore } from "@/stores/message";
import {
  AGENDA_REMIND_CHOICES,
  AGENDA_REMIND_NONE,
  agendaChinaClock,
  agendaDoneOn,
  agendaRemindLabel,
  agendaRepeatLabel,
  type AgendaItem,
} from "@/utils/agenda";
import {
  createForumSubmissionId,
  isAmbiguousForumSubmissionError,
  reconcileForumSubmission,
} from "@/utils/forumSubmission";

type CardState = "pending" | "applied" | "dismissed";
type ProposalOf<T extends PersonalAgentProposal["type"]> = Extract<PersonalAgentProposal, { type: T }>;
type AgendaMutationProposal = ProposalOf<"agenda.update" | "agenda.complete" | "agenda.delete">;
/** 卡片里可编辑的内容和提交结果；整份交给 Result.vue 存在消息上，重新打开对话时还原。 */
type CardDraft = Record<string, any>;

const props = withDefaults(defineProps<{
  steps?: PersonalAgentStep[];
  proposals?: PersonalAgentProposal[];
  proposalStates?: Record<number, CardState>;
  memoryChanges?: PersonalAgentMemoryChange[];
  streaming?: boolean;
  /** steps：只显示执行过程；actions：只显示待确认操作和记忆提示；all：都显示。 */
  section?: "steps" | "actions" | "all";
  /** 上次保存的草稿（按提案序号），由 update-draft 事件产生。 */
  drafts?: Record<number, unknown>;
}>(), {
  section: "all",
});

const emit = defineEmits<{
  openMemories: [];
  requestJwxtReauth: [];
  permissionsUpdated: [permissions: PersonalAgentPermissions, retryCurrentQuestion: boolean];
  updateProposalState: [index: number, state: CardState];
  updateDraft: [index: number, draft: unknown];
}>();

const STEP_ICONS: Record<PersonalAgentStep["status"], string> = { running: "●", done: "✓", blocked: "!", error: "×" };
const STEP_STATUS_TEXT: Record<PersonalAgentStep["status"], string> = { running: "进行中", done: "已完成", blocked: "未授权", error: "失败" };
const AGENDA_MUTATION_KIND: Record<AgendaMutationProposal["type"], string> = {
  "agenda.update": "修改日程",
  "agenda.complete": "完成日程",
  "agenda.delete": "删除日程",
};
const AGENDA_MUTATION_ACTION: Record<AgendaMutationProposal["type"], string> = {
  "agenda.update": "保存修改",
  "agenda.complete": "标记完成",
  "agenda.delete": "删除",
};
const AGENDA_MUTATION_DONE: Record<AgendaMutationProposal["type"], string> = {
  "agenda.update": "已保存修改",
  "agenda.complete": "已标记完成",
  "agenda.delete": "已删除",
};
const AGENDA_FIELD_LABELS: Array<[keyof AgendaItem, string]> = [
  ["title", "标题"],
  ["date", "日期"],
  ["start", "开始"],
  ["end", "结束"],
  ["location", "地点"],
  ["note", "备注"],
  ["remind", "提醒"],
  ["repeat", "重复"],
];
const QUIET = { suppressErrorMessage: true, suppressAuthMessage: true, suppressAuthRedirect: true };

const agenda = useAgendaStore();
const auth = useAuthStore();
const stepsListId = `sj-steps-${Math.random().toString(36).slice(2, 10)}`;
const stepsExpanded = ref(false);
const busy = reactive<Record<number, boolean>>({});
const localStates = reactive<Record<number, CardState>>({});
const drafts = reactive<Record<number, CardDraft>>({});
/** 刚删除的日程，留着给“撤销”用（不跨刷新保存）。 */
const removedItems = reactive<Record<number, AgendaItem>>({});
const anonAllowed = reactive<Record<number, boolean>>({});
const campusOptions = ref<string[]>([]);
const lastEmittedDrafts = new Map<number, string>();
let boardsRequest: Promise<Array<{ slug: string; anonymousEnabled: boolean }>> | null = null;

const showSteps = computed(() => props.section !== "actions");
const showActions = computed(() => props.section !== "steps");

const visibleProposals = computed(() => (props.proposals || [])
  .map((proposal, idx) => ({ proposal, idx }))
  .filter(({ proposal }) => !(auth.forumHidden && (proposal.type === "forum.post" || proposal.type === "forum.reply"))));

const hasRunningStep = computed(() => Boolean(props.steps?.some((s) => s.status === "running")));
const summaryLabel = computed(() => {
  const list = props.steps || [];
  if (!list.length) return "";
  const running = [...list].reverse().find((s) => s.status === "running");
  if (running) return running.label;
  const done = list.filter((s) => s.status === "done").length;
  const blocked = list.filter((s) => s.status === "blocked").length;
  const failed = list.filter((s) => s.status === "error").length;
  if (!blocked && !failed) return `查询了 ${done} 项数据`;
  return [
    done ? `查询了 ${done} 项` : "",
    blocked ? `${blocked} 项未授权` : "",
    failed ? `${failed} 项失败` : "",
  ].filter(Boolean).join("，");
});

// MARK: 草稿

function todayInShanghai() {
  return agendaChinaClock(Date.now()).date;
}

/** 失物招领的时间统一成 datetime-local 用的 YYYY-MM-DDTHH:mm。 */
function toLocalDateTime(value: unknown) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/u.exec(String(value || ""));
  if (!match) return "";
  return `${match[1]}T${match[2] || "00:00"}`;
}

function buildDraft(proposal: PersonalAgentProposal): CardDraft {
  switch (proposal.type) {
    case "agenda.create":
      return {
        title: proposal.item.title,
        date: proposal.item.date,
        start: proposal.item.start,
        end: proposal.item.end,
        remind: proposal.item.remind,
      };
    case "forum.post":
      // 匿名只在用户自己勾选时才用，不沿用模型给的值。
      return { title: proposal.title, content: proposal.content, anonymous: false };
    case "forum.reply":
      return { content: proposal.content, anonymous: false };
    case "lostfound.post":
      return {
        itemName: proposal.itemName,
        description: proposal.description,
        campus: proposal.campus,
        location: proposal.location,
        happenedAt: toLocalDateTime(proposal.happenedAt),
        storageLocation: proposal.storageLocation,
        contact: proposal.contact,
      };
    case "dm.send":
      return { content: proposal.content };
    default:
      return {};
  }
}

watch(() => props.proposals, (list) => {
  (list || []).forEach((proposal, idx) => {
    if (drafts[idx]) return;
    const stored = props.drafts?.[idx];
    drafts[idx] = {
      ...buildDraft(proposal),
      ...(stored && typeof stored === "object" ? stored as CardDraft : {}),
    };
    lastEmittedDrafts.set(idx, JSON.stringify(drafts[idx]));
  });
  void loadCardContext(list || []);
}, { immediate: true });

// 编辑过的草稿交给 Result.vue 保存。
watch(drafts, () => {
  for (const [key, draft] of Object.entries(drafts)) {
    const idx = Number(key);
    const serialized = JSON.stringify(draft);
    if (lastEmittedDrafts.get(idx) === serialized) continue;
    lastEmittedDrafts.set(idx, serialized);
    emit("updateDraft", idx, JSON.parse(serialized));
  }
}, { deep: true });

/** 只为还没处理的卡片读取需要的信息：板块是否允许匿名、失物招领的校区列表。 */
async function loadCardContext(list: PersonalAgentProposal[]) {
  const tasks: Array<Promise<unknown>> = [];
  list.forEach((proposal, idx) => {
    if (cardState(idx) !== "pending") return;
    if (proposal.type === "forum.post" && anonAllowed[idx] === undefined) {
      boardsRequest ||= boardApi.list(QUIET).catch(() => []);
      tasks.push(boardsRequest.then((boards) => {
        anonAllowed[idx] = Boolean(boards.find((board) => board.slug === proposal.board)?.anonymousEnabled);
      }));
    } else if (proposal.type === "forum.reply" && anonAllowed[idx] === undefined) {
      tasks.push(topicApi.detail(proposal.topicId, QUIET)
        .then((topic) => { anonAllowed[idx] = Boolean(topic.board?.anonymousEnabled); })
        .catch(() => { anonAllowed[idx] = false; }));
    }
  });
  const needsCampuses = list.some((proposal, idx) => proposal.type === "lostfound.post" && cardState(idx) === "pending");
  if (needsCampuses && !campusOptions.value.length) {
    tasks.push(lostFoundApi.meta(QUIET).then((meta) => {
      campusOptions.value = Array.isArray(meta.campuses) ? meta.campuses.filter(Boolean) : [];
      if (!campusOptions.value.length) return;
      // 模型给的校区不在列表里时留空让用户选，不发出列表外的校区名。
      list.forEach((proposal, idx) => {
        const draft = drafts[idx];
        if (proposal.type === "lostfound.post" && draft && !campusOptions.value.includes(draft.campus)) draft.campus = "";
      });
    }).catch(() => undefined));
  }
  await Promise.all(tasks);
}

// MARK: 状态

function cardState(idx: number): CardState {
  return localStates[idx] || props.proposalStates?.[idx] || "pending";
}

function setCardState(idx: number, state: CardState) {
  localStates[idx] = state;
  emit("updateProposalState", idx, state);
}

function cardLabel(proposal: PersonalAgentProposal) {
  switch (proposal.type) {
    case "permission.enable": return "需要授权";
    case "jwxt.reauth": return "教务登录已过期";
    case "agenda.create": return "新建日程";
    case "agenda.update":
    case "agenda.complete":
    case "agenda.delete": return AGENDA_MUTATION_KIND[proposal.type];
    case "forum.post": return "发帖";
    case "forum.reply": return "回复帖子";
    case "lostfound.post": return proposal.kind === "found" ? "发布招领" : "发布寻物";
    case "dm.send": return "私信";
    case "messages.readAll": return "通知";
    default: return "";
  }
}

/** 接口错误：优先用服务端给的中文原因，不显示 axios 的英文报错。 */
function errorText(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { message?: unknown } } } | null)?.response?.data;
  if (typeof data?.message === "string" && data.message) return data.message;
  if ((error as { isAxiosError?: boolean } | null)?.isAxiosError) return fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}

// MARK: 日程

function remindChoices(current: number) {
  return AGENDA_REMIND_CHOICES.some((choice) => choice.value === current)
    ? AGENDA_REMIND_CHOICES
    : [...AGENDA_REMIND_CHOICES, { value: current, label: agendaRemindLabel(current) }];
}

function agendaExtraText(proposal: ProposalOf<"agenda.create">) {
  return [
    proposal.item.repeat !== "none" ? agendaRepeatLabel(proposal.item.repeat) : "",
    proposal.item.location,
  ].filter(Boolean).join(" · ");
}

function formatAgendaSchedule(item: CardDraft) {
  const parts: string[] = [item.date || "未设日期"];
  if (item.date && item.start) parts.push(item.end ? `${item.start}–${item.end}` : item.start);
  return parts.join(" ");
}

function formatAgendaField(key: keyof AgendaItem, value: unknown) {
  if (key === "remind") return agendaRemindLabel(Number(value));
  if (key === "repeat") return agendaRepeatLabel(String(value) as AgendaItem["repeat"]);
  const text = String(value ?? "").trim();
  return text || "无";
}

function agendaChangeRows(proposal: ProposalOf<"agenda.update">) {
  const existing = agenda.find(proposal.id);
  const changes = (proposal.changes || {}) as Partial<AgendaItem>;
  return AGENDA_FIELD_LABELS
    .filter(([key]) => changes[key] !== undefined && (!existing || existing[key] !== changes[key]))
    .map(([key, label]) => ({
      key,
      label,
      before: existing ? formatAgendaField(key, existing[key]) : null,
      after: formatAgendaField(key, changes[key]),
    }));
}

function completeDate(proposal: ProposalOf<"agenda.complete">, existing: AgendaItem | null) {
  if (proposal.date) return proposal.date;
  if (existing && existing.repeat === "none") return existing.date;
  return todayInShanghai();
}

function completeDateText(proposal: ProposalOf<"agenda.complete">) {
  const existing = agenda.find(proposal.id);
  if (!existing || existing.repeat === "none") return existing?.date || proposal.date || "";
  return `重复日程，只标记 ${completeDate(proposal, existing)} 这一次`;
}

/** 先和服务器同步一次，确保别处刚改过的日程也在本机副本里。 */
async function prepareAgenda() {
  if (!agenda.attach()) {
    ElMessage.warning("请先登录");
    return false;
  }
  await agenda.sync();
  return true;
}

async function applyAgendaCreate(proposal: ProposalOf<"agenda.create">, idx: number) {
  if (busy[idx]) return;
  const draft = drafts[idx];
  const title = String(draft.title || "").trim();
  if (!title) {
    ElMessage.warning("请填写标题");
    return;
  }
  if (draft.date && draft.start && draft.end && draft.end <= draft.start) {
    ElMessage.warning("结束时间要晚于开始时间");
    return;
  }
  busy[idx] = true;
  try {
    if (!(await prepareAgenda())) return;
    const saved = agenda.save({
      ...proposal.item,
      title,
      date: draft.date || "",
      start: draft.date ? draft.start || "" : "",
      end: draft.date && draft.start ? draft.end || "" : "",
      remind: draft.date ? Number(draft.remind) : AGENDA_REMIND_NONE,
      origin: "assistant",
    });
    if (!saved) {
      ElMessage.warning(agenda.error || "没能加入日程");
      return;
    }
    draft.agendaId = saved.id;
    setCardState(idx, "applied");
    await agenda.sync();
    if (agenda.error) ElMessage.warning(agenda.error);
  } finally {
    busy[idx] = false;
  }
}

async function undoAgendaCreate(idx: number) {
  const draft = drafts[idx];
  const id = draft?.agendaId;
  if (!id || busy[idx]) return;
  busy[idx] = true;
  try {
    if (agenda.find(id)) agenda.remove(id);
    delete draft.agendaId;
    setCardState(idx, "pending");
    await agenda.sync();
  } finally {
    busy[idx] = false;
  }
}

async function applyAgendaMutation(proposal: AgendaMutationProposal, idx: number) {
  if (busy[idx]) return;
  busy[idx] = true;
  try {
    if (!(await prepareAgenda())) return;
    const existing = agenda.find(proposal.id);
    if (!existing) {
      ElMessage.warning("没有找到这条日程，可能已经删除");
      return;
    }
    if (proposal.type === "agenda.complete") {
      const date = completeDate(proposal, existing);
      agenda.setDone(proposal.id, date, true);
      const updated = agenda.find(proposal.id);
      if (!date || !updated || !agendaDoneOn(updated, date)) {
        ElMessage.warning("没能标记完成");
        return;
      }
      drafts[idx].resultNote = existing.repeat === "none" ? "已标记完成" : `已标记 ${date} 完成`;
    } else if (proposal.type === "agenda.delete") {
      const removed = agenda.remove(proposal.id);
      if (!removed) {
        ElMessage.warning("没能删除这条日程");
        return;
      }
      removedItems[idx] = removed;
    } else {
      const changes = (proposal.changes || {}) as Partial<AgendaItem>;
      const saved = agenda.save({ ...existing, ...changes, id: proposal.id, title: changes.title || existing.title });
      if (!saved) {
        ElMessage.warning(agenda.error || "没能保存修改");
        return;
      }
    }
    setCardState(idx, "applied");
    await agenda.sync();
    if (agenda.error) ElMessage.warning(agenda.error);
  } finally {
    busy[idx] = false;
  }
}

async function undoAgendaDelete(idx: number) {
  const item = removedItems[idx];
  if (!item || busy[idx]) return;
  busy[idx] = true;
  try {
    agenda.restore(item);
    delete removedItems[idx];
    setCardState(idx, "pending");
    await agenda.sync();
  } finally {
    busy[idx] = false;
  }
}

// MARK: 论坛

/** 和发帖页一样按服务端返回的审核状态说明结果。 */
function describeForumResult(
  result: { hidden?: boolean; blocked?: boolean; submissionResult?: { status?: string; reason?: string } },
  noun: "帖子" | "回复",
): { ok: boolean; note: string } {
  const status = result.submissionResult?.status;
  if (status === "failed") return { ok: false, note: result.submissionResult?.reason || "审核服务暂时不可用，请稍后重试" };
  if (status === "pending") return { ok: true, note: "已提交，审核通过后公开" };
  if (status === "manual_review") return { ok: true, note: "已转人工审核" };
  if (status === "deleted") return { ok: true, note: `这条${noun}已经删除` };
  if (status === "blocked_ai" || result.blocked) return { ok: true, note: "暂未通过审核，可在帖子页申请人工复核" };
  if (result.hidden) return { ok: true, note: "已提交，审核通过后公开" };
  return { ok: true, note: noun === "帖子" ? "已发布" : "已回复" };
}

/** 内容变了就换一个新的提交 ID；没变时沿用，重试不会重复发出。ID 存在草稿里，刷新后也沿用。 */
function submissionIdFor(draft: CardDraft, kind: "topic" | "reply", fingerprint: string) {
  if (!draft.submissionId || draft.submissionFingerprint !== fingerprint) {
    draft.submissionId = createForumSubmissionId(kind);
    draft.submissionFingerprint = fingerprint;
  }
  return String(draft.submissionId);
}

async function submitForumPost(proposal: ProposalOf<"forum.post">, idx: number) {
  if (busy[idx]) return;
  const draft = drafts[idx];
  const title = String(draft.title || "").trim();
  const content = String(draft.content || "").trim();
  if (title.length < 2) {
    ElMessage.warning("标题至少 2 个字");
    return;
  }
  if (!content) {
    ElMessage.warning("请填写正文");
    return;
  }
  const anonymous = Boolean(anonAllowed[idx] && draft.anonymous);
  const submissionId = submissionIdFor(draft, "topic", JSON.stringify([proposal.board, title, content, anonymous]));
  busy[idx] = true;
  try {
    let result: TopicSubmissionResponse | null = null;
    try {
      result = await topicApi.create({ boardSlug: proposal.board, title, content, anonymous, submissionId });
    } catch (error) {
      if (!isAmbiguousForumSubmissionError(error)) {
        delete draft.submissionId;
        ElMessage.error(errorText(error, "发布失败，请稍后重试"));
        return;
      }
      result = await reconcileForumSubmission(() => topicApi.submissionStatus(submissionId)).catch(() => null);
      if (!result) {
        ElMessage.warning("暂未确认发布结果，再点一次发布不会重复发帖");
        return;
      }
    }
    const outcome = describeForumResult(result, "帖子");
    if (!outcome.ok) {
      ElMessage.error(outcome.note);
      return;
    }
    draft.resultNote = outcome.note;
    if (result.id) draft.resultLink = `/forum/topic/${result.id}`;
    if (anonymous) void auth.fetchMe();
    setCardState(idx, "applied");
  } finally {
    busy[idx] = false;
  }
}

async function submitForumReply(proposal: ProposalOf<"forum.reply">, idx: number) {
  if (busy[idx]) return;
  const draft = drafts[idx];
  const content = String(draft.content || "").trim();
  if (!content) {
    ElMessage.warning("请填写回复内容");
    return;
  }
  const anonymous = Boolean(anonAllowed[idx] && draft.anonymous);
  const submissionId = submissionIdFor(draft, "reply", JSON.stringify([proposal.topicId, proposal.parentReplyId ?? 0, content, anonymous]));
  busy[idx] = true;
  try {
    let result: ReplySubmissionResponse | null = null;
    try {
      result = await replyApi.create({
        topicId: proposal.topicId,
        content,
        parentReplyId: proposal.parentReplyId,
        anonymous,
        submissionId,
      });
    } catch (error) {
      if (!isAmbiguousForumSubmissionError(error)) {
        delete draft.submissionId;
        ElMessage.error(errorText(error, "回复失败，请稍后重试"));
        return;
      }
      result = await reconcileForumSubmission(() => replyApi.submissionStatus(submissionId)).catch(() => null);
      if (!result) {
        ElMessage.warning("暂未确认回复结果，再点一次发送不会重复回复");
        return;
      }
    }
    const outcome = describeForumResult(result, "回复");
    if (!outcome.ok) {
      ElMessage.error(outcome.note);
      return;
    }
    draft.resultNote = outcome.note;
    if (anonymous) void auth.fetchMe();
    setCardState(idx, "applied");
  } finally {
    busy[idx] = false;
  }
}

// MARK: 失物招领、私信、通知、授权

/** 和失物招领页的发布表单同一套检查。 */
function validLostFound(kind: "lost" | "found", draft: CardDraft) {
  const text = (key: string) => String(draft[key] || "").trim();
  if (text("itemName").length < 2) return ElMessage.warning("请填写物品名称"), false;
  if (!text("campus")) return ElMessage.warning("请填写校区"), false;
  if (text("location").length < 2) return ElMessage.warning("请填写具体地点"), false;
  if (kind === "found" && text("storageLocation").length < 2) return ElMessage.warning("请填写物品放到哪里了"), false;
  if (!toLocalDateTime(text("happenedAt"))) return ElMessage.warning("请选择时间"), false;
  if (text("contact").length < 2) return ElMessage.warning("请填写联系方式"), false;
  return true;
}

async function submitLostFound(proposal: ProposalOf<"lostfound.post">, idx: number) {
  if (busy[idx]) return;
  const draft = drafts[idx];
  if (!validLostFound(proposal.kind, draft)) return;
  const payload: LostFoundInput = {
    kind: proposal.kind,
    itemName: String(draft.itemName).trim(),
    description: String(draft.description || "").trim(),
    campus: String(draft.campus).trim(),
    location: String(draft.location).trim(),
    // 和失物招领页的时间选择器同一格式。
    happenedAt: `${toLocalDateTime(draft.happenedAt)}:00`,
    storageLocation: proposal.kind === "found" ? String(draft.storageLocation || "").trim() : "",
    contact: String(draft.contact).trim(),
    images: [],
  };
  busy[idx] = true;
  try {
    // 与 lostFoundApi.create 同一个接口；直接调用是为了关掉拦截器的错误提示，只在这里提示一次。
    const item = await request.post<LostFoundItem & { review?: { status: string; reason?: string } | null }>(
      "/lost-found/items",
      payload,
      { suppressErrorMessage: true },
    );
    draft.resultNote = item.status === "reviewing" ? "已提交审核，通过后公开" : "已发布";
    if (item.id) draft.resultLink = `/lost-found?item=${item.id}`;
    setCardState(idx, "applied");
  } catch (error) {
    ElMessage.error(errorText(error, "发布失败，请稍后重试"));
  } finally {
    busy[idx] = false;
  }
}

async function submitDirectMessage(proposal: ProposalOf<"dm.send">, idx: number) {
  if (busy[idx]) return;
  const content = String(drafts[idx].content || "").trim();
  if (!content) {
    ElMessage.warning("请填写私信内容");
    return;
  }
  busy[idx] = true;
  try {
    await directMessageApi.sendToUser(proposal.userId, content, { suppressErrorMessage: true });
    setCardState(idx, "applied");
  } catch (error) {
    ElMessage.error(errorText(error, "发送失败，请稍后重试"));
  } finally {
    busy[idx] = false;
  }
}

async function markAllMessagesRead(idx: number) {
  if (busy[idx]) return;
  busy[idx] = true;
  try {
    // 和消息页一样：隐藏论坛的账号只把能看到的通知逐条标为已读。
    if (auth.forumHidden) {
      const notices = await messageApi.list(undefined, { suppressErrorMessage: true, cacheTtlMs: 0 }) as Array<{ id: number; readAt?: string | null }>;
      await Promise.all(notices.filter((notice) => !notice.readAt)
        .map((notice) => messageApi.read(notice.id, { suppressErrorMessage: true })));
    } else {
      await messageApi.readAll({ suppressErrorMessage: true });
    }
    setCardState(idx, "applied");
    void useMessageStore().refresh();
  } catch (error) {
    ElMessage.error(errorText(error, "操作失败，请稍后重试"));
  } finally {
    busy[idx] = false;
  }
}

async function enableScopeAndRetry(proposal: ProposalOf<"permission.enable">, idx: number) {
  if (busy[idx]) return;
  busy[idx] = true;
  try {
    const res = await searchApi.savePersonalAgentPermissions({ [proposal.scope]: true }, { suppressErrorMessage: true });
    setCardState(idx, "applied");
    emit("permissionsUpdated", res.permissions, true);
  } catch (error) {
    ElMessage.error(errorText(error, "开启失败，请稍后重试"));
  } finally {
    busy[idx] = false;
  }
}
</script>

<style scoped>
/* 类名写两遍：Result.vue 的 .sj :where(button) 重置带作用域属性，特异性和单个类相同且后加载，会盖掉这里的按钮样式。 */
.sj-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* 执行过程 */
.sj-steps {
  margin-bottom: 10px;
  border-radius: 12px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-subtle);
  overflow: hidden;
}
.sj-steps-toggle.sj-steps-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.sj-steps-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cpu-text-muted);
  flex-shrink: 0;
}
.sj-steps-dot.is-running {
  background: var(--cpu-primary);
  animation: sj-pulse 1.2s ease-in-out infinite;
}
@keyframes sj-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .sj-steps-dot.is-running { animation: none; }
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
  padding: 6px 12px 8px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--cpu-border-soft);
}
.sj-step-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--cpu-text-secondary);
}
.sj-step-icon {
  width: 12px;
  flex-shrink: 0;
  text-align: center;
}
.sj-step-item.is-blocked .sj-step-icon { color: var(--cpu-warn); }
.sj-step-item.is-error .sj-step-icon { color: var(--cpu-danger); }
.sj-step-text em {
  font-style: normal;
  color: var(--cpu-text-muted);
}

/* 记忆提示 */
.sj-mem-notes {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 10px;
}
.sj-mem-note.sj-mem-note {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  min-height: 32px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.sj-mem-note-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sj-mem-note-link {
  flex-shrink: 0;
  color: var(--cpu-primary);
}

/* 待确认操作：安静的分组面板 */
.sj-proposals {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.sj-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-card);
  color: var(--cpu-text);
}
.sj-card.is-dismissed {
  opacity: 0.6;
}
.sj-card-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sj-card-kind {
  font-size: 12px;
  color: var(--cpu-text-secondary);
}
.sj-card-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
}
.sj-card-desc,
.sj-card-meta {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--cpu-text-secondary);
}
.sj-card-warn {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--cpu-warn);
}

.sj-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}
.sj-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.sj-field--wide {
  grid-column: 1 / -1;
}
.sj-field > span {
  font-size: 12px;
  color: var(--cpu-text-secondary);
}
.sj-input {
  width: 100%;
  min-height: 32px;
  box-sizing: border-box;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text);
  font: inherit;
  font-size: 13px;
}
.sj-input:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: -1px;
}
.sj-input:disabled {
  opacity: 0.5;
}
.sj-textarea {
  resize: vertical;
  line-height: 1.5;
}
.sj-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  font-size: 13px;
  color: var(--cpu-text-secondary);
}

.sj-diff {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}
.sj-diff-row {
  display: flex;
  gap: 10px;
  font-size: 13px;
  line-height: 1.5;
}
.sj-diff-row dt {
  flex-shrink: 0;
  width: 3em;
  color: var(--cpu-text-secondary);
}
.sj-diff-row dd {
  margin: 0;
  min-width: 0;
  word-break: break-word;
}
.sj-diff-row s {
  color: var(--cpu-text-muted);
}

.sj-card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sj-btn.sj-btn {
  min-height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.sj-btn--primary.sj-btn--primary {
  border-color: transparent;
  background: var(--cpu-primary);
  color: var(--cpu-on-primary);
}
.sj-btn--danger.sj-btn--danger {
  border-color: transparent;
  background: var(--cpu-danger);
  color: var(--cpu-on-primary);
}
.sj-btn.sj-btn:focus-visible,
.sj-link:focus-visible,
.sj-mem-note.sj-mem-note:focus-visible,
.sj-steps-toggle.sj-steps-toggle:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}
.sj-btn.sj-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.sj-card-done {
  font-size: 13px;
  color: var(--cpu-text);
}
.sj-card-muted {
  font-size: 13px;
  color: var(--cpu-text-secondary);
}
.sj-link {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  font-size: 13px;
  color: var(--cpu-primary);
  text-decoration: none;
}
.sj-link:hover {
  text-decoration: underline;
}

@media (max-width: 640px), (pointer: coarse) {
  .sj-btn.sj-btn,
  .sj-input,
  .sj-link,
  .sj-check,
  .sj-mem-note.sj-mem-note,
  .sj-steps-toggle.sj-steps-toggle {
    min-height: 36px;
  }
}
</style>
