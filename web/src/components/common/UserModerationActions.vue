<template>
  <div v-if="canModerate && user" class="user-moderation-actions" @click.stop>
    <template v-if="display === 'inline'">
      <el-button
        v-if="!isBanned"
        :size="size"
        :text="text"
        :plain="plain"
        type="danger"
        :loading="moderationBusy"
        :disabled="moderationBusy"
        @click="ban"
      >
        封禁
      </el-button>
      <el-button
        v-else
        :size="size"
        :text="text"
        :plain="plain"
        type="success"
        :loading="moderationBusy"
        :disabled="moderationBusy"
        @click="unban"
      >
        解禁
      </el-button>
      <el-button
        v-if="!isBanned"
        :size="size"
        :text="text"
        :plain="plain"
        :type="isMuted ? 'primary' : 'warning'"
        :disabled="moderationBusy"
        @click="openMuteDialog"
      >
        {{ isMuted ? "调整禁言" : "禁言" }}
      </el-button>
      <el-button
        v-if="isMuted"
        :size="size"
        :text="text"
        :plain="plain"
        type="success"
        :loading="moderationBusy"
        :disabled="moderationBusy"
        @click="unmute"
      >
        取消禁言
      </el-button>
    </template>

    <el-dropdown v-else trigger="click" @command="handleCommand">
      <el-button :size="size" :text="text" :plain="plain" :loading="moderationBusy" :disabled="moderationBusy">
        {{ label }}
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-if="!isBanned" command="ban" :disabled="moderationBusy">封禁用户</el-dropdown-item>
          <el-dropdown-item v-else command="unban" :disabled="moderationBusy">解除封禁</el-dropdown-item>
          <el-dropdown-item v-if="!isBanned" command="mute" :disabled="moderationBusy">
            {{ isMuted ? "调整禁言时间" : "禁言用户" }}
          </el-dropdown-item>
          <el-dropdown-item v-if="isMuted" command="unmute" :disabled="moderationBusy">取消禁言</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-dialog
      v-model="muteDialogOpen"
      title="设置禁言时间"
      width="420px"
      append-to-body
    >
      <el-form label-position="top">
        <el-form-item label="用户">
          <div class="dialog-user">{{ displayName }}</div>
        </el-form-item>
        <el-form-item label="快捷时长">
          <el-select v-model="durationPreset" style="width:100%" @change="applyPreset">
            <el-option v-for="item in durationOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="禁言截止时间">
          <el-date-picker
            v-model="muteUntil"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            style="width:100%"
            @change="durationPreset = 'custom'"
          />
        </el-form-item>
        <p class="dialog-tip">
          {{ muteUntil ? `到期后将自动解禁：${fmtDate(muteUntil)}` : "请选择一个晚于当前时间的截止时间" }}
        </p>
      </el-form>
      <template #footer>
        <el-button :disabled="savingMute" @click="muteDialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="savingMute" :disabled="savingMute" @click="submitMute">确认禁言</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi } from "@/api/admin";
import { useAuthStore } from "@/stores/auth";
import { fmtDate } from "@/utils/format";

type ModerateUser = {
  id: number;
  username?: string;
  nickname?: string;
  role?: string;
  status?: string;
  mutedUntil?: string | null;
};

const props = withDefaults(defineProps<{
  user: ModerateUser | null | undefined;
  display?: "inline" | "dropdown";
  size?: "small" | "default" | "large";
  text?: boolean;
  plain?: boolean;
  label?: string;
}>(), {
  display: "dropdown",
  size: "small",
  text: false,
  plain: false,
  label: "管理",
});

const emit = defineEmits<{
  (e: "updated", patch: Partial<ModerateUser>): void;
  (e: "changed"): void;
}>();

const auth = useAuthStore();
const muteDialogOpen = ref(false);
const moderationBusy = ref(false);
const savingMute = ref(false);
const durationPreset = ref("1d");
const muteUntil = ref<Date | null>(null);

const durationOptions = [
  { value: "1h", label: "1 小时" },
  { value: "6h", label: "6 小时" },
  { value: "1d", label: "1 天" },
  { value: "3d", label: "3 天" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "custom", label: "自定义时间" },
] as const;

const canModerate = computed(() => Boolean(auth.isMod && props.user?.id && props.user.id !== auth.user?.id));
const currentStatus = computed(() => props.user?.status ?? "active");
const isBanned = computed(() => currentStatus.value === "banned");
const isMuted = computed(() => currentStatus.value === "muted");
const displayName = computed(() => {
  if (!props.user) return "—";
  return `${props.user.nickname || "未设置昵称"}${props.user.username ? `（${props.user.username}）` : ""}`;
});

function handleCommand(command: string) {
  if (moderationBusy.value) return;
  if (command === "ban") return ban();
  if (command === "unban") return unban();
  if (command === "mute") return openMuteDialog();
  if (command === "unmute") return unmute();
}

function minutesFromPreset(value: string) {
  if (value === "1h") return 60;
  if (value === "6h") return 360;
  if (value === "1d") return 1440;
  if (value === "3d") return 4320;
  if (value === "7d") return 10080;
  if (value === "30d") return 43200;
  return 0;
}

function buildMuteUntil(minutes: number) {
  const target = new Date();
  target.setMinutes(target.getMinutes() + minutes);
  return target;
}

function applyPreset(value: string) {
  const minutes = minutesFromPreset(value);
  if (!minutes) return;
  muteUntil.value = buildMuteUntil(minutes);
}

function openMuteDialog() {
  const existing = props.user?.mutedUntil ? new Date(props.user.mutedUntil) : null;
  if (existing && !Number.isNaN(existing.getTime()) && existing.getTime() > Date.now()) {
    muteUntil.value = existing;
    durationPreset.value = "custom";
  } else {
    durationPreset.value = "1d";
    muteUntil.value = buildMuteUntil(minutesFromPreset("1d"));
  }
  muteDialogOpen.value = true;
}

async function ban() {
  if (moderationBusy.value) return;
  if (!props.user) return;
  moderationBusy.value = true;
  try {
    const confirmed = await ElMessageBox.confirm(
      `封禁 ${displayName.value}？封禁后该用户将无法登录和发言。`,
      "确认",
      { type: "warning" }
    ).then(() => true).catch(() => false);
    if (!confirmed) return;
    await adminApi.updateUser(props.user.id, { status: "banned" });
    emit("updated", { status: "banned", mutedUntil: null });
    emit("changed");
    ElMessage.success("已封禁");
  } finally {
    moderationBusy.value = false;
  }
}

async function unban() {
  if (moderationBusy.value) return;
  if (!props.user) return;
  moderationBusy.value = true;
  try {
    await adminApi.updateUser(props.user.id, { status: "active" });
    emit("updated", { status: "active", mutedUntil: null });
    emit("changed");
    ElMessage.success("已解禁");
  } finally {
    moderationBusy.value = false;
  }
}

async function unmute() {
  if (moderationBusy.value) return;
  if (!props.user) return;
  moderationBusy.value = true;
  try {
    await adminApi.updateUser(props.user.id, { status: "active" });
    emit("updated", { status: "active", mutedUntil: null });
    emit("changed");
    ElMessage.success("已取消禁言");
  } finally {
    moderationBusy.value = false;
  }
}

async function submitMute() {
  if (savingMute.value) return;
  if (!props.user) return;
  if (!muteUntil.value || Number.isNaN(muteUntil.value.getTime())) {
    ElMessage.warning("请选择禁言截止时间");
    return;
  }
  if (muteUntil.value.getTime() <= Date.now()) {
    ElMessage.warning("禁言截止时间必须晚于当前时间");
    return;
  }
  moderationBusy.value = true;
  savingMute.value = true;
  try {
    const mutedUntilIso = muteUntil.value.toISOString();
    await adminApi.updateUser(props.user.id, { status: "muted", mutedUntil: mutedUntilIso });
    emit("updated", { status: "muted", mutedUntil: mutedUntilIso });
    emit("changed");
    muteDialogOpen.value = false;
    ElMessage.success("已设置禁言");
  } finally {
    savingMute.value = false;
    moderationBusy.value = false;
  }
}
</script>

<style scoped>
.user-moderation-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.dialog-user {
  font-size: 13px;
  color: #374151;
}

.dialog-tip {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #6b7280;
}
</style>
