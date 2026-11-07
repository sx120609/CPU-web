<template>
  <div class="th-page th-bookings">
    <router-link class="th-back" to="/treehole">
      <el-icon aria-hidden="true"><ArrowLeft /></el-icon>艾绒树洞
    </router-link>
    <header class="th-head">
      <div class="th-head-copy">
        <h1>预约线下 1 对 1 倾诉</h1>
        <p v-if="schedule">在约好的时间到 <strong>{{ schedule.place }}</strong> 找你预约的小艾绒，当面聊聊。每档 {{ schedule.slotMinutes }} 分钟，至少提前 1 小时预约。</p>
      </div>
    </header>

    <div v-if="loading && !schedule" class="th-group" role="status"><el-skeleton :rows="5" animated /></div>
    <div v-else-if="error" class="th-group th-empty" role="alert"><p>{{ error }}</p><el-button @click="load">重试</el-button></div>

    <template v-else-if="schedule">
      <section v-if="mine.length" class="th-group th-group--flush">
        <div class="th-group-head"><h2 class="th-h2">我的预约</h2></div>
        <div class="th-rows">
          <div v-for="booking in mine" :key="booking.id" class="th-row th-booking-row">
            <div class="th-row-copy">
              <div class="th-row-title">
                {{ bookingTimeText(booking.startAt, booking.endAt) }}
                <em class="th-chip" :class="bookingStatusTone(booking.status)">{{ bookingStatusLabel(booking.status) }}</em>
              </div>
              <p class="th-meta"><span>{{ booking.host.name }}</span><span>{{ booking.place }}</span></p>
              <p v-if="booking.status === 'pending'" class="th-muted">等待小艾绒确认，确认后会提醒你。</p>
              <p v-if="booking.rejectReason" class="th-muted">未接受的原因：{{ booking.rejectReason }}</p>
              <p v-if="booking.status === 'cancelled'" class="th-muted">
                {{ booking.cancelledBy === "host" ? "小艾绒取消了这次预约" : "你取消了这次预约" }}<template v-if="booking.cancelReason">：{{ booking.cancelReason }}</template>
              </p>
            </div>
            <el-button v-if="booking.cancellable" size="small" @click="cancel(booking)">取消预约</el-button>
          </div>
        </div>
      </section>

      <section class="th-group">
        <div class="th-group-head th-group-head--tight">
          <h2 class="th-h2">选时间</h2>
          <span class="th-muted">灰色的时段已被约走</span>
        </div>
        <div v-if="!days.length" class="th-empty"><p>接下来两周还没有可以预约的值班时段。</p></div>
        <template v-else>
          <div class="th-day-picker" role="tablist" aria-label="选择日期">
            <button
              v-for="day in days"
              :key="day.key"
              type="button"
              role="tab"
              class="th-day-chip"
              :class="{ 'is-on': day.key === selectedDay, 'is-full': !day.available }"
              :aria-selected="day.key === selectedDay"
              @click="selectedDay = day.key"
            >
              <strong>{{ day.title }}</strong>
              <span>{{ day.sub }}</span>
              <em>{{ day.available ? `${day.available} 档可约` : "已约满" }}</em>
            </button>
          </div>

          <div class="th-day-hosts">
            <div v-for="host in hostsOfDay" :key="host.id" class="th-day-host">
              <div class="th-day-host-head">
                <span class="th-host-avatar" data-hue="violet">{{ hostAvatarText(host) }}</span>
                <div class="th-row-copy">
                  <div class="th-row-title">{{ host.name }}<em v-if="host.mine" class="th-chip">我</em></div>
                  <div v-if="host.intro" class="th-row-preview">{{ host.intro }}</div>
                </div>
              </div>
              <div class="th-slot-grid">
                <button
                  v-for="slot in host.daySlots"
                  :key="slot.startAt"
                  type="button"
                  class="th-slot"
                  :disabled="!slot.available || host.mine"
                  @click="pick(host, slot)"
                >
                  {{ clockText(slot.startAt) }}
                </button>
              </div>
            </div>
          </div>
        </template>
      </section>

      <section class="th-group th-group--flush">
        <button type="button" class="th-group-head th-week-toggle" :aria-expanded="weekOpen" @click="weekOpen = !weekOpen">
          <h2 class="th-h2">每周值班表</h2>
          <span class="th-muted">{{ weekOpen ? "收起" : "展开" }}</span>
        </button>
        <div v-if="weekOpen" class="th-rows">
          <div v-for="(label, index) in WEEKDAYS" :key="label" class="th-row th-week-row">
            <strong class="th-week-day">{{ label }}</strong>
            <div class="th-row-copy">
              <span v-if="!weekTable[index].length" class="th-muted">无人值班</span>
              <p v-for="item in weekTable[index]" :key="item.key" class="th-week-item">
                {{ item.name }} <span class="th-muted">{{ item.time }}</span>
              </p>
            </div>
          </div>
        </div>
      </section>
    </template>

    <el-dialog v-model="dialogOpen" title="确认预约" width="min(92vw, 420px)" append-to-body>
      <dl v-if="picked" class="th-booking-facts">
        <dt>小艾绒</dt><dd>{{ picked.host.name }}</dd>
        <dt>时间</dt><dd>{{ bookingTimeText(picked.slot.startAt, picked.slot.endAt) }}</dd>
        <dt>地点</dt><dd>{{ schedule?.place }}</dd>
      </dl>
      <div class="th-field th-booking-note">
        <label for="th-booking-note">想先说点什么吗？（选填，只有这位小艾绒能看到）</label>
        <el-input id="th-booking-note" v-model="note" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="比如最近困扰你的事，方便小艾绒提前准备" />
      </div>
      <p class="th-muted">小艾绒确认后预约才算成功。去不了的话请提前取消，把时间留给其他同学。</p>
      <template #footer>
        <el-button @click="dialogOpen = false">再想想</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交预约</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";
import { treeholeApi, type TreeholeBooking, type TreeholeSchedule, type TreeholeScheduleHost } from "@/api/treehole";
import {
  hostAvatarText,
  beijingDayKey,
  bookingDayLabel,
  bookingStatusLabel,
  bookingStatusTone,
  bookingTimeText,
  clockText,
  errorText,
  minuteText,
  WEEKDAYS,
} from "./shared";
import "./treehole.css";

type Slot = TreeholeScheduleHost["slots"][number];

const router = useRouter();
const schedule = ref<TreeholeSchedule | null>(null);
const mine = ref<TreeholeBooking[]>([]);
const loading = ref(false);
const error = ref("");
const selectedDay = ref("");
const weekOpen = ref(false);
const dialogOpen = ref(false);
const picked = ref<{ host: TreeholeScheduleHost; slot: Slot } | null>(null);
const note = ref("");
const submitting = ref(false);

const days = computed(() => {
  const map = new Map<string, { key: string; title: string; sub: string; available: number }>();
  for (const host of schedule.value?.hosts ?? []) {
    for (const slot of host.slots) {
      const key = beijingDayKey(slot.startAt);
      const entry = map.get(key) ?? { key, ...bookingDayLabel(slot.startAt), available: 0 };
      if (slot.available && !host.mine) entry.available += 1;
      map.set(key, entry);
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
});

const hostsOfDay = computed(() => (schedule.value?.hosts ?? [])
  .map((host) => ({ ...host, daySlots: host.slots.filter((slot) => beijingDayKey(slot.startAt) === selectedDay.value) }))
  .filter((host) => host.daySlots.length));

const weekTable = computed(() => WEEKDAYS.map((_, index) => (schedule.value?.hosts ?? []).flatMap((host) => host.shifts
  .filter((shift) => shift.weekday === index + 1)
  .map((shift) => ({ key: `${host.id}-${shift.startMinute}`, name: host.name, time: `${minuteText(shift.startMinute)}–${minuteText(shift.endMinute)}`, start: shift.startMinute })))
  .sort((a, b) => a.start - b.start)));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const me = await treeholeApi.me();
    if (!me.consent.agreed) {
      router.replace("/treehole");
      return;
    }
    const [scheduleResult, mineResult] = await Promise.all([treeholeApi.schedule(), treeholeApi.myBookings()]);
    schedule.value = scheduleResult;
    mine.value = mineResult;
    if (!days.value.some((day) => day.key === selectedDay.value)) {
      selectedDay.value = days.value.find((day) => day.available)?.key ?? days.value[0]?.key ?? "";
    }
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

function pick(host: TreeholeScheduleHost, slot: Slot) {
  picked.value = { host, slot };
  note.value = "";
  dialogOpen.value = true;
}

async function submit() {
  if (!picked.value) return;
  submitting.value = true;
  try {
    await treeholeApi.book({ hostId: picked.value.host.id, startAt: picked.value.slot.startAt, note: note.value.trim() });
    dialogOpen.value = false;
    ElMessage.success("预约已提交，小艾绒确认后会提醒你");
    await load();
  } catch {
    // 拦截器已提示；时段可能刚被约走，刷新一下
    await load();
  } finally {
    submitting.value = false;
  }
}

async function cancel(booking: TreeholeBooking) {
  const result = await ElMessageBox.prompt("取消后这个时间会重新开放给其他同学。可以写一句原因（选填），小艾绒会看到。", "取消预约", {
    confirmButtonText: "取消预约",
    cancelButtonText: "不取消",
    inputPlaceholder: "选填",
    inputValidator: (value: string) => !value || value.length <= 200 || "最多 200 字",
  }).catch(() => null);
  if (!result) return;
  await treeholeApi.cancelBooking(booking.id, String(result.value || "").trim());
  ElMessage.success("已取消");
  await load();
}

onMounted(load);
</script>

<style scoped>
.th-group-head--tight { margin-bottom: 10px; }
.th-day-picker {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin: 0 -4px;
  padding: 2px 4px 4px;
  scrollbar-width: none;
}
.th-day-picker::-webkit-scrollbar { display: none; }
.th-day-chip {
  display: flex;
  min-width: 68px;
  flex: none;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 8px 6px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-card);
  color: var(--cpu-text);
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.th-day-chip strong { font-size: var(--cpu-fs-m); }
.th-day-chip span { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); }
.th-day-chip em { color: var(--cpu-hue-brand-ink); font-size: 11px; font-style: normal; }
.th-day-chip.is-full em { color: var(--cpu-text-muted); }
.th-day-chip.is-on { border-color: var(--cpu-primary); background: var(--cpu-primary-soft); }
.th-day-hosts { display: flex; flex-direction: column; gap: 14px; margin-top: 14px; }
.th-day-host-head { display: flex; align-items: center; gap: 10px; }
.th-host-avatar {
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--cpu-hue-bg);
  color: var(--cpu-hue-ink);
  font-size: var(--cpu-fs-s);
  font-weight: 700;
}
.th-slot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 8px;
  margin-top: 8px;
  padding-left: 46px;
}
.th-slot {
  min-height: 36px;
  border: 1px solid var(--cpu-primary);
  border-radius: var(--cpu-radius-s);
  background: var(--cpu-card);
  color: var(--cpu-hue-brand-ink);
  font: inherit;
  font-size: var(--cpu-fs-s);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.th-slot:hover:not(:disabled) { background: var(--cpu-primary-soft); }
.th-slot:disabled {
  border-color: var(--cpu-border-soft);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-muted);
  font-weight: 400;
  text-decoration: line-through;
  cursor: not-allowed;
}
.th-week-toggle {
  width: 100%;
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.th-week-row { align-items: flex-start; }
.th-week-day { width: 40px; flex: none; }
.th-week-item { margin: 0; }
.th-booking-row { flex-wrap: wrap; }
.th-booking-row p { margin: 2px 0 0; }
.th-booking-facts {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 6px 12px;
  margin: 0 0 12px;
}
.th-booking-facts dt { color: var(--cpu-text-muted); }
.th-booking-facts dd { margin: 0; font-weight: 600; }
.th-booking-note { margin-bottom: 8px; }
@media (max-width: 640px) {
  .th-slot-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); padding-left: 0; }
}
</style>
