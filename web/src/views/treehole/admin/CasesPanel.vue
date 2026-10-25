<template>
  <div class="th-admin-split">
    <section class="th-group th-group--flush th-case-list">
      <div class="th-group-head">
        <h2 class="th-h2">高危工单</h2>
        <el-select v-model="status" size="small" class="th-case-filter" @change="loadList">
          <el-option label="未结案" value="unclosed" />
          <el-option label="待处理" value="open" />
          <el-option label="跟进中" value="following" />
          <el-option label="已结案" value="closed" />
          <el-option label="全部" value="all" />
        </el-select>
      </div>
      <div v-if="!cases.length" class="th-empty"><p>没有符合条件的工单。</p></div>
      <div v-else class="th-rows">
        <button v-for="row in cases" :key="row.id" type="button" class="th-row" :class="{ 'is-selected': selected?.id === row.id }" @click="open(row.id)">
          <div class="th-row-copy">
            <div class="th-row-title">
              {{ row.session.alias }}
              <em class="th-chip" :class="urgencyTone(row.urgency)">{{ urgencyLabel(row.urgency) }}</em>
              <em class="th-chip">{{ caseStatusLabel(row.status) }}</em>
              <em v-if="row.pendingReveal" class="th-chip is-violet">溯源待审批</em>
              <em v-if="row.revealed" class="th-chip is-violet">已溯源</em>
            </div>
            <p class="th-meta"><span>{{ row.crisisType }}</span><span>{{ row.reporter }}</span><span>{{ timeText(row.createdAt) }}</span></p>
          </div>
        </button>
      </div>
    </section>

    <section v-if="selected" ref="detailSection" class="th-group th-case-detail">
      <div class="th-group-head">
        <div>
          <h2 class="th-h2">工单 #{{ selected.id }} · {{ selected.session.alias }}</h2>
          <p class="th-meta"><span>{{ selected.reporter }} 上报</span><span>{{ timeText(selected.createdAt) }}</span><span>{{ selected.session.host }} 接待</span></p>
        </div>
        <div class="th-actions">
          <el-select :model-value="selected.status" size="small" class="th-case-filter" @change="setStatus">
            <el-option label="待处理" value="open" />
            <el-option label="跟进中" value="following" />
            <el-option label="已结案" value="closed" />
          </el-select>
          <el-button size="small" @click="router.push(`/treehole/session/${selected.session.id}`)">查看对话</el-button>
        </div>
      </div>

      <dl class="th-case-facts">
        <dt>危机类型</dt><dd>{{ selected.crisisType }}</dd>
        <dt>紧急等级</dt><dd>{{ urgencyLabel(selected.urgency) }}</dd>
        <dt>当下状态</dt><dd class="th-text">{{ selected.currentState }}</dd>
        <dt>陪伴记录</dt><dd class="th-text">{{ selected.hostRecord }}</dd>
        <dt>联系方式</dt><dd>{{ selected.session.contact || "来访者尚未留下（方案 A：请洞主友好引导）" }}</dd>
      </dl>

      <h3 class="th-h3">跟进记录</h3>
      <div v-if="!selected.notes.length" class="th-muted">还没有跟进记录。</div>
      <ul v-else class="th-notes">
        <li v-for="note in selected.notes" :key="note.id">
          <p class="th-meta"><span>{{ note.author }}</span><span>{{ timeText(note.createdAt) }}</span></p>
          <p class="th-text">{{ note.content }}</p>
        </li>
      </ul>
      <div class="th-note-form">
        <el-input v-model="note" type="textarea" :rows="2" maxlength="2000" placeholder="追加备注：评估结论、联系情况、转介进展…" />
        <el-button type="primary" :disabled="note.trim().length < 2" :loading="saving" @click="addNote">追加</el-button>
      </div>

      <h3 class="th-h3">实名溯源（方案 B）</h3>
      <p class="th-sub">需要线下干预时提交申请，经两名不同的核心管理员同意（提交人算一人）后才能查看来访者的拾间账号信息。每次查看都记入日志。</p>
      <div v-for="reveal in selected.reveals" :key="reveal.id" class="th-reveal">
        <div class="th-row-title">
          <em class="th-chip" :class="reveal.status === 'approved' ? 'is-violet' : reveal.status === 'pending' ? 'is-warn' : ''">{{ revealStatus(reveal.status) }}</em>
          <span>{{ reveal.requester }} 申请 · {{ timeText(reveal.createdAt) }}</span>
        </div>
        <p class="th-text">{{ reveal.reason }}</p>
        <p class="th-meta">
          <span>同意 {{ reveal.approvalCount }}/{{ reveal.required }}<template v-if="reveal.approvals.length">：{{ reveal.approvals.map((item) => item.by).join("、") }}</template></span>
          <span v-if="reveal.rejectedBy">{{ reveal.rejectedBy }} 不同意：{{ reveal.rejectReason }}</span>
        </p>
        <div v-if="reveal.status === 'pending'" class="th-actions">
          <el-button v-if="!reveal.approvedByMe" size="small" type="primary" @click="approve(reveal.id)">同意溯源</el-button>
          <span v-else class="th-muted">你已同意，等待另一名核心管理员</span>
          <el-button size="small" @click="reject(reveal.id)">不同意</el-button>
        </div>
        <div v-else-if="reveal.status === 'approved'" class="th-actions">
          <el-button size="small" type="primary" plain @click="viewIdentity(reveal.id)">查看实名信息</el-button>
        </div>
        <dl v-if="identity && identityFor === reveal.id" class="th-case-facts th-identity">
          <template v-if="identity.deleted"><dt>账号</dt><dd>来访者已注销账号，无法再关联到本人</dd></template>
          <template v-else>
            <dt>学号</dt><dd>{{ identity.studentId }}<em v-if="identity.studentVerified" class="th-chip is-ok">学校认证</em></dd>
            <dt>昵称</dt><dd>{{ identity.nickname }}</dd>
            <dt>院系</dt><dd>{{ identity.college || "未填写" }}<template v-if="identity.enrollYear"> · {{ identity.enrollYear }} 级</template></dd>
            <dt>邮箱</dt><dd>{{ identity.email || "未绑定" }}</dd>
            <dt>最近登录</dt><dd>{{ timeText(identity.lastLoginAt) || "—" }}</dd>
          </template>
        </dl>
      </div>
      <div v-if="canRequestReveal" class="th-note-form">
        <el-input v-model="revealReason" type="textarea" :rows="2" maxlength="500" placeholder="为什么需要线下干预、准备如何对接心理中心" />
        <el-button type="danger" plain :disabled="revealReason.trim().length < 4" :loading="saving" @click="requestReveal">提交溯源申请</el-button>
      </div>
    </section>
    <section v-else class="th-group th-empty th-case-detail"><p>选择左侧的工单查看详情。</p></section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { treeholeApi, type TreeholeCaseDetail, type TreeholeCaseSummary, type TreeholeIdentity } from "@/api/treehole";
import { caseStatusLabel, timeText, urgencyLabel } from "../shared";

const props = defineProps<{ initialCase: number | null }>();
const emit = defineEmits<{ (event: "changed"): void }>();

const router = useRouter();
const status = ref("unclosed");
const cases = ref<TreeholeCaseSummary[]>([]);
const selected = ref<TreeholeCaseDetail | null>(null);
const note = ref("");
const revealReason = ref("");
const saving = ref(false);
const identity = ref<TreeholeIdentity | null>(null);
const identityFor = ref<number | null>(null);
const detailSection = ref<HTMLElement | null>(null);

const canRequestReveal = computed(() => Boolean(selected.value && !selected.value.reveals.some((reveal) => reveal.status === "pending" || reveal.status === "approved")));

function urgencyTone(value: string) {
  return value === "urgent" ? "is-danger" : value === "high" ? "is-warn" : "";
}

function revealStatus(value: string) {
  return { pending: "待审批", approved: "已批准", rejected: "未批准" }[value] ?? value;
}

async function loadList() {
  cases.value = await treeholeApi.adminCases(status.value);
}

async function open(id: number) {
  identity.value = null;
  identityFor.value = null;
  selected.value = await treeholeApi.adminCase(id);
  // 窄屏上详情排在列表下面，点开后滚过去。
  if (window.innerWidth < 860) {
    await nextTick();
    detailSection.value?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function apply(task: Promise<TreeholeCaseDetail>) {
  saving.value = true;
  try {
    selected.value = await task;
    await loadList();
    emit("changed");
  } finally {
    saving.value = false;
  }
}

async function addNote() {
  if (!selected.value) return;
  await apply(treeholeApi.addCaseNote(selected.value.id, note.value.trim()));
  note.value = "";
}

async function setStatus(value: string) {
  if (!selected.value) return;
  await apply(treeholeApi.setCaseStatus(selected.value.id, value));
}

async function requestReveal() {
  if (!selected.value) return;
  await apply(treeholeApi.requestReveal(selected.value.id, revealReason.value.trim()));
  revealReason.value = "";
  ElMessage.success("已提交，需要另一名核心管理员同意");
}

async function approve(id: number) {
  const confirmed = await ElMessageBox.confirm("同意后，若已满两名核心管理员同意，即可查看来访者的拾间账号信息。此操作记入日志。", "同意实名溯源？", {
    confirmButtonText: "同意",
    cancelButtonText: "取消",
  }).then(() => true, () => false);
  if (!confirmed) return;
  await apply(treeholeApi.approveReveal(id));
}

async function reject(id: number) {
  const result = await ElMessageBox.prompt("请写明不同意的理由。", "不同意溯源", {
    confirmButtonText: "提交",
    cancelButtonText: "取消",
    inputValidator: (value: string) => (value && value.trim().length >= 2) || "请写明理由",
  }).catch(() => null);
  if (!result) return;
  await apply(treeholeApi.rejectReveal(id, String(result.value).trim()));
}

async function viewIdentity(id: number) {
  identity.value = await treeholeApi.revealIdentity(id);
  identityFor.value = id;
}

onMounted(async () => {
  await loadList();
  if (props.initialCase) await open(props.initialCase).catch(() => undefined);
});
</script>

<style scoped>
.th-admin-split {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.th-case-filter { width: 110px; }
.th-row.is-selected { background: var(--cpu-primary-soft); }
.th-case-facts {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 6px 12px;
  margin: 0;
  font-size: var(--cpu-fs-s);
}
.th-case-facts dt { color: var(--cpu-text-muted); }
.th-case-facts dd { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
.th-h3 { margin: 18px 0 6px; font-size: var(--cpu-fs-m); font-weight: 600; }
.th-notes { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.th-notes li { padding: 8px 12px; border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); font-size: var(--cpu-fs-s); }
.th-note-form { display: flex; align-items: flex-end; gap: 8px; margin-top: 10px; }
.th-reveal {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-m);
  font-size: var(--cpu-fs-s);
}
.th-identity { padding: 10px 12px; border-radius: var(--cpu-radius-m); background: var(--cpu-hue-violet-bg); }
@media (max-width: 860px) {
  .th-admin-split { grid-template-columns: minmax(0, 1fr); }
}
</style>
