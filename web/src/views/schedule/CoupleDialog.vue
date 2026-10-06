<template>
  <el-dialog
    v-model="couple.dialogOpen.value"
    title="情侣课表"
    :width="400"
    align-center
    append-to-body
    class="schedule-themed-dialog couple-dialog"
    :style="pageStyle"
    @open="onOpen"
    @closed="onClosed"
  >
    <div v-if="loading" class="couple-loading"><el-skeleton :rows="4" animated /></div>

    <template v-else-if="status?.status === 'active'">
      <div class="pair">
        <div class="person">
          <UserAvatar :size="48" :src="status.me.avatar" :name="status.me.nickname" :seed="status.me.id" />
          <b>{{ status.me.nickname }}</b>
        </div>
        <div class="pair-center">
          <HeartGlyph class="heart" />
          <span v-if="couple.togetherDays.value">第 <b>{{ couple.togetherDays.value }}</b> 天</span>
        </div>
        <div class="person">
          <UserAvatar :size="48" :src="status.partner.avatar" :name="status.partner.nickname" :seed="status.partner.id" />
          <b>{{ status.partner.nickname }}</b>
        </div>
      </div>

      <div class="line"><span>TA 此刻</span><strong>{{ partnerNowText }}</strong></div>
      <div class="line">
        <span>TA 的课表</span>
        <strong>{{ status.partner.snapshot ? `同步于 ${relative(status.partner.snapshot.syncedAt)}` : "还没有同步" }}</strong>
      </div>
      <div class="line">
        <span>我的课表</span>
        <strong>{{ status.me.snapshot ? `同步于 ${relative(status.me.snapshot.syncedAt)}` : "打开课表后自动同步" }}</strong>
      </div>
      <div class="line">
        <span>配色</span>
        <div class="colors">
          <span class="swatch" :class="status.me.color">我</span>
          <span class="swatch" :class="status.partner.color">TA</span>
          <el-button data-cpu-button-theme="schedule" size="small" text :loading="busy" @click="swapColors">互换</el-button>
        </div>
      </div>
      <div class="line">
        <span>在课表里显示 TA 的课</span>
        <el-switch :model-value="couple.visible.value" @update:model-value="(value: string | number | boolean) => couple.setVisible(Boolean(value))" />
      </div>
      <div class="line">
        <span>纪念日</span>
        <el-date-picker
          :model-value="status.anniversary || ''"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="未设置"
          size="small"
          :clearable="true"
          :disabled-date="isFutureDate"
          :teleported="true"
          class="anniversary-picker"
          @update:model-value="(value: string | null) => act(() => coupleApi.setAnniversary(value || null), value ? '纪念日已保存' : '纪念日已清除')"
        />
      </div>
      <p class="note">每一格左半是你的课、右半是 TA 的课，一起上的课合并成一格。配色双方看到的一样，任意一方都可以互换。</p>
    </template>

    <template v-else>
      <p class="note lead">绑定后，TA 的课会和你的课显示在同一张课表里，两人都有空的时间一目了然。任何一方都可以随时解除，解除后双方的课表快照立即删除。</p>

      <section class="block">
        <h3>邀请 TA</h3>
        <template v-if="invite">
          <div class="invite-code">{{ invite.code }}</div>
          <p class="note center">24 小时内有效，TA 在「更多 → 情侣课表」里输入</p>
          <div class="waiting"><i />等待 TA 接受…</div>
        </template>
        <p v-else class="note">生成一个邀请码发给 TA。</p>
      </section>

      <section class="block">
        <h3>输入 TA 的邀请码</h3>
        <form class="accept" @submit.prevent="accept">
          <input v-model="code" class="code-input" maxlength="8" placeholder="6 位邀请码" autocomplete="off" aria-label="TA 的邀请码" />
          <el-button data-cpu-button-theme="schedule" type="primary" native-type="submit" :loading="busy" :disabled="!code.trim()">绑定</el-button>
        </form>
      </section>
    </template>

    <template #footer>
      <template v-if="status?.status === 'active'">
        <el-button data-cpu-button-theme="schedule" text type="danger" :loading="busy" @click="unbind">解除绑定</el-button>
        <el-button data-cpu-button-theme="schedule" @click="couple.dialogOpen.value = false">完成</el-button>
      </template>
      <template v-else-if="invite">
        <el-button data-cpu-button-theme="schedule" text :loading="busy" @click="act(coupleApi.cancelInvite)">取消邀请</el-button>
        <el-button data-cpu-button-theme="schedule" :loading="busy" @click="act(coupleApi.invite)">换一个</el-button>
        <el-button data-cpu-button-theme="schedule" type="primary" @click="copyInvite">复制邀请</el-button>
      </template>
      <template v-else>
        <el-button data-cpu-button-theme="schedule" @click="couple.dialogOpen.value = false">关闭</el-button>
        <el-button data-cpu-button-theme="schedule" type="primary" :loading="busy" @click="act(coupleApi.invite)">生成邀请码</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { coupleApi, type CoupleStatus } from "@/api/couple";
import { copyText } from "@/utils/userGroup";
import type { CoupleNowStatus } from "./couple";
import type { CoupleOverlay } from "./useCoupleOverlay";

const props = defineProps<{ couple: CoupleOverlay; pageStyle?: Record<string, string>; initialCode?: string }>();
const emit = defineEmits<{ changed: [status: CoupleStatus["status"]] }>();

const HeartGlyph = defineComponent({
  name: "HeartGlyph",
  setup: () => () => h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
    h("path", { fill: "currentColor", d: "M12 20.3l-1.3-1.2C6 14.9 3 12.2 3 8.9 3 6.2 5.1 4 7.8 4c1.5 0 3 .7 4.2 1.9C13.2 4.7 14.7 4 16.2 4 18.9 4 21 6.2 21 8.9c0 3.3-3 6-7.7 10.2L12 20.3z" }),
  ]),
});

const status = computed(() => props.couple.status.value);
const invite = computed(() => {
  const value = status.value;
  return value?.status === "pending" && value.invite.code && !value.invite.expired ? value.invite as { code: string } : null;
});
const loading = ref(false);
const busy = ref(false);
const code = ref("");
let pollTimer = 0;

const partnerNowText = computed(() => describeNowText(props.couple.partnerNow.value));

function describeNowText(value: CoupleNowStatus) {
  switch (value.kind) {
    case "no-data": return "还没有同步课表";
    case "out-of-term": return "今天不在学期内";
    case "free-day": return "今天没有课";
    case "in-class": return `在上《${value.current.course.name}》，${value.current.end} 下课`;
    case "between": return `下一节《${value.next.course.name}》${value.next.start} 开始`;
    case "done": return "今天的课都上完了";
  }
}

function relative(value: string) {
  const diff = props.couple.now.value.getTime() - new Date(value).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(value).toLocaleDateString("zh-CN");
}

function isFutureDate(date: Date) {
  return date.getTime() > Date.now();
}

async function act(task: () => Promise<CoupleStatus>, success?: string) {
  if (busy.value) return;
  busy.value = true;
  const before = status.value?.status;
  try {
    const next = await props.couple.run(task);
    if (success) ElMessage.success(success);
    if (next && next.status !== before) emit("changed", next.status);
  } catch {
    // 请求层已经提示了具体错误。
  } finally {
    busy.value = false;
  }
}

function swapColors() {
  const value = status.value;
  if (value?.status !== "active") return;
  void act(() => coupleApi.setMyColor(value.me.color === "blue" ? "pink" : "blue"), "配色已互换");
}

async function accept() {
  const value = code.value.trim();
  if (!value) return;
  await act(() => coupleApi.accept(value));
  if (status.value?.status === "active") {
    code.value = "";
    ElMessage.success(`已和 ${status.value.partner.nickname} 绑定`);
  }
}

async function copyInvite() {
  if (!invite.value) return;
  const link = `${window.location.origin}/schedule?couple=1&code=${invite.value.code}`;
  await copyText(`我们来绑定情侣课表吧！邀请码 ${invite.value.code}（24 小时内有效），打开 ${link} 就能绑定。`);
  ElMessage.success("邀请已复制，发给 TA 吧");
}

async function unbind() {
  if (status.value?.status !== "active") return;
  try {
    await ElMessageBox.confirm(
      `确定解除和 ${status.value.partner.nickname} 的绑定吗？双方的课表快照和纪念日会立即删除。`,
      "解除绑定",
      { confirmButtonText: "解除", cancelButtonText: "再想想", type: "warning", appendTo: document.body },
    );
  } catch {
    return;
  }
  await act(coupleApi.unbind, "已解除绑定");
}

async function onOpen() {
  if (props.initialCode && !code.value) code.value = props.initialCode;
  loading.value = !status.value;
  try {
    const before = status.value?.status;
    props.couple.applyStatus(await coupleApi.status());
    await props.couple.loadSchedules().catch(() => undefined);
    if (status.value && status.value.status !== before) emit("changed", status.value.status);
  } catch { /* 请求层已提示 */ } finally {
    loading.value = false;
  }
  // 等待对方接受时轮询，让邀请方直接看到绑定结果。
  pollTimer = window.setInterval(async () => {
    if (status.value?.status !== "pending" || busy.value || document.visibilityState !== "visible") return;
    try {
      const next = await coupleApi.status(true);
      if (next.status === "pending") return;
      props.couple.applyStatus(next);
      await props.couple.loadSchedules().catch(() => undefined);
      emit("changed", next.status);
      if (next.status === "active") ElMessage.success(`${next.partner.nickname} 接受了你的邀请`);
    } catch { /* 下一轮再试 */ }
  }, 10_000);
}

function onClosed() {
  window.clearInterval(pollTimer);
  pollTimer = 0;
}

onBeforeUnmount(onClosed);
</script>

<style scoped>
.couple-loading { padding: 8px 0; }
.pair { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; margin: 0 0 14px; }
.person { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
.person b { max-width: 100%; overflow: hidden; color: var(--schedule-text); font-size: var(--cpu-fs-s); text-overflow: ellipsis; white-space: nowrap; }
.pair-center { display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--schedule-text-secondary); font-size: var(--cpu-fs-xs); }
.pair-center b { color: var(--couple-accent, #e2568a); font-size: var(--cpu-fs-l); }
.heart { width: 26px; height: 26px; color: var(--couple-accent, #e2568a); }
.line { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; padding: 6px 0; border-bottom: 1px solid var(--schedule-border); font-size: var(--cpu-fs-s); }
.line span { flex: 0 0 auto; color: var(--schedule-text-muted); }
.line strong { min-width: 0; color: var(--schedule-text); font-weight: 600; text-align: right; }
.colors { display: flex; align-items: center; gap: 6px; }
.swatch { display: inline-flex; align-items: center; justify-content: center; min-width: 34px; height: 22px; padding: 0 8px; border-radius: var(--cpu-radius-pill); font-size: 11px; font-weight: 700; }
.swatch.blue { background: hsl(214 88% 92%); color: hsl(214 58% 30%); box-shadow: inset 0 0 0 1px hsl(214 72% 76%); }
.swatch.pink { background: hsl(338 88% 93%); color: hsl(338 58% 30%); box-shadow: inset 0 0 0 1px hsl(338 72% 78%); }
.line :deep(.anniversary-picker.el-date-editor) { --el-date-editor-width: 150px; flex: 0 0 150px; width: 150px; }
.note { margin: 12px 0 0; color: var(--schedule-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.note.lead { margin: 0 0 6px; font-size: var(--cpu-fs-s); }
.note.center { margin-top: 4px; text-align: center; }
.block { padding: 12px 0; border-bottom: 1px solid var(--schedule-border); }
.block:last-child { border-bottom: 0; padding-bottom: 0; }
.block h3 { margin: 0; color: var(--schedule-text); font-size: var(--cpu-fs-m); }
.invite-code { margin: 10px 0 0; color: var(--schedule-course-text, var(--schedule-text)); font: 700 30px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, "Roboto Mono", monospace; letter-spacing: 6px; text-align: center; }
.waiting { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 8px; color: var(--schedule-text-muted); font-size: var(--cpu-fs-xs); }
.waiting i { width: 7px; height: 7px; border-radius: 50%; background: var(--couple-accent, #e2568a); animation: couple-pulse 1.6s ease-in-out infinite; }
@keyframes couple-pulse { 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .waiting i { animation: none; } }
.accept { display: flex; gap: 8px; margin-top: 10px; }
.code-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--schedule-border);
  border-radius: var(--cpu-radius-m);
  background: var(--schedule-surface-bg-soft, transparent);
  color: var(--schedule-text);
  font: 600 16px ui-monospace, SFMono-Regular, Menlo, Consolas, "Roboto Mono", monospace;
  letter-spacing: 3px;
  text-transform: uppercase;
  outline: none;
}
.code-input::placeholder { color: var(--schedule-text-muted); font: 400 13px var(--cpu-font-sans, inherit); letter-spacing: normal; text-transform: none; }
.code-input:focus { border-color: var(--schedule-accent, var(--cpu-primary)); }
</style>
