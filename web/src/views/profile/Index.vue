<template>
  <div class="profile">
    <div class="cpu-card profile-card">
      <UserAvatar :size="80" class="avatar" :src="user?.avatar" :name="user?.nickname" alt="用户头像" />
      <div class="avatar-actions">
        <el-button size="small" plain :loading="avatarSaving" @click="pickAvatar">上传头像</el-button>
        <el-button v-if="user?.avatar" size="small" text :loading="avatarSaving" @click="removeAvatar">移除头像</el-button>
      </div>
      <h3 class="name">
        {{ user?.nickname }}
        <el-tag v-if="user?.role === 'admin'" size="small" type="danger">管理员</el-tag>
        <el-tag v-else-if="user?.role === 'mod'" size="small">论坛管理员</el-tag>
        <el-tag v-if="user?.reputationLevel" size="small" type="warning" effect="plain">
          Lv.{{ user.reputationLevel.level }} {{ user.reputationLevel.name }}
        </el-tag>
      </h3>
      <p class="account-note">{{ user?.studentSso ? "学号仅用于登录和身份校验，不会公开展示" : "登录账号仅自己可见，不会公开展示" }}</p>
      <p class="bio">{{ user?.bio || "这个人很懒，什么都没写" }}</p>
      <ul class="kv">
        <li><span>院系</span><span>{{ user?.college || "—" }}</span></li>
        <li><span>入学</span><span>{{ user?.enrollYear || "—" }}</span></li>
        <li><span>发帖</span><span>{{ user?.postCount }}</span></li>
        <li><span>回复</span><span>{{ user?.replyCount }}</span></li>
        <li><span>声望</span><span>{{ user?.reputation }}</span></li>
        <li v-if="(user?.sponsorAmount ?? 0) > 0"><span>赞助</span><span class="sponsor-total">¥{{ formatMoney(user?.sponsorAmount) }}</span></li>
      </ul>
      <div class="profile-actions">
        <el-button type="primary" plain @click="editing = true">编辑资料</el-button>
        <el-button v-if="!user?.studentSso" plain @click="passwordDialog = true">修改密码</el-button>
        <el-button type="danger" plain @click="onLogout">退出登录</el-button>
      </div>
    </div>

    <div v-if="site.features.sponsor || (user?.sponsorAmount ?? 0) > 0" class="cpu-card sponsor-card">
      <div class="sponsor-main">
        <div class="sponsor-copy">
          <h3 class="cpu-section-title">{{ sponsorOptions.title || "赞助本站" }}</h3>
          <p>{{ sponsorOptions.description || "赞助会通过易支付完成，成功后金额会展示在你的个人资料里。" }}</p>
          <strong>已赞助 ¥{{ formatMoney(user?.sponsorAmount) }}</strong>
          <div class="sponsor-actions">
            <el-button v-if="sponsorOptions.wallEnabled" plain @click="router.push('/sponsor-wall')">查看鸣谢墙</el-button>
          </div>
        </div>

        <div class="sponsor-panel">
          <template v-if="site.features.sponsor">
            <div v-if="sponsorOptions.enabled" class="sponsor-form">
              <div class="amount-grid">
                <button
                  v-for="amount in sponsorOptions.amounts"
                :key="amount"
                type="button"
                :class="{ active: sponsorAmount === String(amount) }"
                @click="sponsorAmount = String(amount)"
              >
                  ¥{{ amount }}
                </button>
              </div>

              <div class="sponsor-pay-row">
                <el-input v-model="sponsorAmount" placeholder="自定义金额" maxlength="8" class="sponsor-money-input">
                  <template #prepend>¥</template>
                </el-input>
                <el-select v-model="sponsorPayType" class="sponsor-pay-select">
                  <el-option v-for="item in enabledPayTypes" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
                <el-button class="sponsor-submit-btn" type="primary" :loading="sponsorSubmitting" @click="openSponsorConfirm">去支付</el-button>
              </div>
            </div>
            <el-alert v-else type="info" :closable="false" show-icon title="赞助支付暂不可用，请稍后再试。" />
          </template>
          <el-alert v-else type="info" :closable="false" show-icon title="赞助入口当前已关闭，已完成的赞助金额仍会保留展示。" />
        </div>
      </div>

      <div v-if="sponsorOrders.length" class="sponsor-history">
        <div class="sub-title">我的赞助记录</div>
        <div v-for="order in sponsorOrders" :key="order.outTradeNo" class="sponsor-order-row">
          <div>
            <b>¥{{ order.amount }}</b>
            <span>{{ payTypeLabels[order.payType as PayType] || order.payType }} · 已支付</span>
          </div>
          <div class="order-actions">
            <span>{{ fmtDate(order.paidAt || order.createdAt, "MM-DD HH:mm") }}</span>
          </div>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="sponsorConfirmOpen"
      title="确认赞助"
      width="420px"
      class="sponsor-confirm-dialog"
      append-to-body
    >
      <div class="sponsor-confirm">
        <div class="sponsor-confirm-summary">
          <span>赞助金额</span>
          <b>¥{{ formatMoney(sponsorAmount) }}</b>
        </div>
        <div class="sponsor-confirm-line">
          <span>支付方式</span>
          <strong>{{ payTypeLabels[sponsorPayType] || sponsorPayType }}</strong>
        </div>
        <div class="sponsor-confirm-field">
          <span>展示方式</span>
          <div class="sponsor-display-tabs" role="radiogroup" aria-label="展示方式">
            <button
              v-for="item in sponsorDisplayOptions"
              :key="item.value"
              type="button"
              :class="{ active: sponsorDisplayMode === item.value }"
              role="radio"
              :aria-checked="sponsorDisplayMode === item.value"
              @click="sponsorDisplayMode = item.value"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
        <el-input
          v-if="sponsorOptions.allowMessage"
          v-model="sponsorMessage"
          maxlength="80"
          show-word-limit
          placeholder="给本站留一句话（选填）"
        />
      </div>
      <template #footer>
        <el-button @click="sponsorConfirmOpen = false">取消</el-button>
        <el-button type="primary" :loading="sponsorSubmitting" @click="submitSponsor">确认并支付</el-button>
      </template>
    </el-dialog>

    <div class="cpu-card trust-card" v-if="user">
      <div class="trust-head">
        <div>
          <h3 class="cpu-section-title">信誉与匿名</h3>
          <p class="trust-sub">信誉值由注册时长、发帖数量、回复数量等因素共同决定，按周发放匿名积分。</p>
        </div>
        <div class="trust-score">{{ user.reputation }}</div>
      </div>

      <div v-if="user.reputationLevel" class="trust-level-row">
        当前等级：Lv.{{ user.reputationLevel.level }} {{ user.reputationLevel.name }}
      </div>

      <div class="trust-grid">
        <div class="trust-item">
          <span>本周额度</span>
          <b>{{ user.anonymousState?.weeklyQuota ?? 0 }}</b>
        </div>
        <div class="trust-item">
          <span>剩余积分</span>
          <b>{{ user.anonymousState?.availableCredits ?? 0 }}</b>
        </div>
        <div class="trust-item">
          <span>状态</span>
          <b>{{ anonymousStatusText }}</b>
        </div>
        <div class="trust-item">
          <span>下次刷新</span>
          <b>{{ anonymousResetText }}</b>
        </div>
      </div>

      <div class="trust-breakdown">
        <div class="trust-row">
          <span>注册时长贡献</span>
          <b>{{ user.reputationBreakdown?.agePoints ?? 0 }}</b>
        </div>
        <div class="trust-row">
          <span>发帖贡献</span>
          <b>{{ user.reputationBreakdown?.postPoints ?? 0 }}</b>
        </div>
        <div class="trust-row">
          <span>回复贡献</span>
          <b>{{ user.reputationBreakdown?.replyPoints ?? 0 }}</b>
        </div>
        <div class="trust-row">
          <span>论坛资历加成</span>
          <b>{{ user.reputationBreakdown?.forumPoints ?? 0 }}</b>
        </div>
      </div>

      <p v-if="user.anonymousState?.nextTier" class="trust-next">
        距离下一档匿名额度还差 {{ user.anonymousState.nextTier.need }} 点信誉值，达到后每周可得 {{ user.anonymousState.nextTier.weeklyQuota }} 点。
      </p>
      <p v-if="user.reputationLevel?.nextLevel" class="trust-next">
        距离下一信誉等级还差 {{ user.reputationLevel.nextLevel.need }} 点，达到后将升级为 Lv.{{ user.reputationLevel.nextLevel.level }} {{ user.reputationLevel.nextLevel.name }}。
      </p>

      <div class="anonymous-boards">
        <span class="anonymous-boards-label">支持匿名的板块</span>
        <div class="anonymous-board-tags">
          <el-tag v-for="board in anonymousBoards" :key="board.slug" effect="plain">
            {{ board.icon || "💬" }} {{ board.name }}
          </el-tag>
          <span v-if="!anonymousBoards.length" class="cpu-muted">当前还没有开放匿名的板块</span>
        </div>
      </div>
    </div>

    <div class="cpu-card user-group-card">
      <div>
        <h3 class="cpu-section-title">加入用户 QQ 群</h3>
        <p>遇到课表显示问题，或想反馈建议，可以加入用户群。</p>
        <strong>{{ USER_QQ_GROUP }}</strong>
      </div>
      <div class="user-group-actions">
        <el-button type="primary" @click="joinUserGroup">
          <el-icon><ChatDotRound /></el-icon>
          加入群聊
        </el-button>
        <el-button plain @click="copyUserGroup">
          <el-icon><CopyDocument /></el-icon>
          复制群号
        </el-button>
      </div>
    </div>

    <div class="cpu-card qqbot-card" v-if="qqBotProfile">
      <div class="qqbot-head">
        <div>
          <h3 class="cpu-section-title">QQBot 绑定</h3>
          <p>绑定后可以直接在 QQ 里投稿、查状态、看最近投稿。</p>
        </div>
        <el-tag :type="qqBotProfile.enabled ? 'success' : 'info'" effect="plain">
          {{ qqBotProfile.enabled ? "已启用" : "未启用" }}
        </el-tag>
      </div>

      <div class="qqbot-grid">
        <div class="qqbot-item">
          <span>绑定状态</span>
          <b>{{ qqBotProfile.binding ? (qqBotProfile.binding.enabled ? "已绑定" : "已停用") : "未绑定" }}</b>
        </div>
        <div class="qqbot-item">
          <span>绑定 QQ</span>
          <b>{{ qqBotProfile.binding?.qqId || "—" }}</b>
        </div>
        <div class="qqbot-item">
          <span>默认板块</span>
          <b>{{ qqBotProfile.defaultBoardSlug }}</b>
        </div>
        <div class="qqbot-item">
          <span>投稿开关</span>
          <b>{{ qqPostingText }}</b>
        </div>
      </div>

      <div class="qqbot-bind-box">
        <template v-if="qqBotProfile.activeBindToken">
          <div class="qqbot-token">
            <strong>{{ qqBotProfile.activeBindToken.token }}</strong>
            <span>请在 QQ 里发送：绑定 {{ qqBotProfile.activeBindToken.token }}</span>
            <span>有效期至 {{ fmtDate(qqBotProfile.activeBindToken.expiresAt, "MM-DD HH:mm") }}</span>
          </div>
        </template>
        <template v-else>
          <p class="qqbot-empty">还没有可用绑定码，生成后可直接去 QQ 完成绑定。</p>
        </template>
        <div class="qqbot-actions">
          <el-button type="primary" :loading="qqBotLoading" @click="refreshQqBotToken">
            {{ qqBotProfile.activeBindToken ? "重新生成绑定码" : "生成绑定码" }}
          </el-button>
          <el-button
            v-if="qqBotProfile.activeBindToken"
            plain
            :loading="qqBotLoading"
            @click="copyQqBotCommand"
          >
            复制绑定指令
          </el-button>
          <el-button
            v-if="qqBotProfile.binding"
            type="danger"
            plain
            :loading="qqBotLoading"
            @click="unbindQqBot"
          >
            解绑 QQ
          </el-button>
          <el-button plain :loading="qqBotLoading" @click="refreshQqBotProfile">刷新状态</el-button>
        </div>
      </div>

      <div class="qqbot-help">
        <div class="sub-title">QQ 内可用命令</div>
        <div class="qqbot-command-tags">
          <el-tag effect="plain">帮助</el-tag>
          <el-tag effect="plain">状态</el-tag>
          <el-tag effect="plain">板块</el-tag>
          <el-tag effect="plain">我的投稿</el-tag>
          <el-tag effect="plain">解绑</el-tag>
        </div>
      </div>

      <div class="qqbot-recent">
        <div class="sub-title">最近通过 QQ 投稿</div>
        <el-empty v-if="!qqBotProfile.recentTopics.length" description="还没有通过 QQ 投稿的帖子" />
        <div
          v-for="topic in qqBotProfile.recentTopics"
          :key="topic.id"
          class="topic-line"
          @click="$router.push(`/forum/topic/${topic.id}`)"
        >
          <span class="tag qqbot-topic-tag">{{ topic.boardName }}</span>
          <span v-if="topic.hidden" class="anon-tag">待审核</span>
          <span class="title">{{ topic.title }}</span>
          <span class="meta">{{ fmtRelative(topic.createdAt) }}</span>
        </div>
      </div>
    </div>

    <div class="cpu-card">
      <h3 class="cpu-section-title">我发布的帖子</h3>
      <el-empty v-if="!myTopics.length" description="还没有发过帖子" />
      <div v-for="t in myTopics" :key="t.id" class="topic-line" @click="$router.push(`/forum/topic/${t.id}`)">
        <span class="tag" :style="{ background: t.board?.color || '#168776' }">{{ t.board?.name }}</span>
        <span v-if="t.isAnonymous" class="anon-tag">匿名</span>
        <span class="title">{{ t.title }}</span>
        <span class="meta">{{ fmtRelative(t.createdAt) }}</span>
      </div>
    </div>

    <el-dialog v-model="editing" title="编辑资料" width="420">
      <el-form label-position="top" :model="editForm">
        <el-form-item label="昵称">
          <el-input v-model="editForm.nickname" maxlength="20" show-word-limit />
        </el-form-item>
        <el-form-item label="一句话签名">
          <el-input v-model="editForm.bio" type="textarea" :rows="3" maxlength="120" show-word-limit />
        </el-form-item>
        <el-form-item label="院系">
          <el-input v-model="editForm.college" maxlength="40" />
        </el-form-item>
        <el-form-item label="入学年份">
          <el-input-number v-model="editForm.enrollYear" :min="2010" :max="2030" style="width:100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editing = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="passwordDialog" title="修改密码" width="420" :close-on-click-modal="false">
      <el-form label-position="top" :model="pwForm" @keyup.enter="savePassword">
        <el-form-item label="原密码" required>
          <el-input v-model="pwForm.oldPassword" type="password" show-password autocomplete="current-password" />
        </el-form-item>
        <el-form-item label="新密码（至少 6 位）" required>
          <el-input v-model="pwForm.newPassword" type="password" show-password autocomplete="new-password" maxlength="64" />
        </el-form-item>
        <el-form-item label="再次输入新密码" required>
          <el-input v-model="pwForm.confirm" type="password" show-password autocomplete="new-password" maxlength="64" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingPw" @click="savePassword">保存</el-button>
      </template>
    </el-dialog>

    <input
      ref="avatarInputRef"
      class="hidden-file-input"
      type="file"
      accept="image/*"
      @change="onAvatarChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ChatDotRound, CopyDocument } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { authApi, type QqBotProfile } from "@/api/auth";
import { boardApi, type Board } from "@/api/board";
import { paymentsApi, type PayType, type SponsorOptions } from "@/api/payments";
import { request } from "@/api/request";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { fmtDate, fmtRelative } from "@/utils/format";
import { compressImageFile, normalizeImageUploadError } from "@/utils/imageUpload";
import { copyText, openUserGroup, USER_QQ_GROUP } from "@/utils/userGroup";

const auth = useAuthStore();
const site = useSiteStore();
const route = useRoute();
const router = useRouter();
const user = computed(() => auth.user);
const myTopics = ref<any[]>([]);
const boards = ref<Board[]>([]);
const editing = ref(false);
const saving = ref(false);
const avatarSaving = ref(false);
const avatarInputRef = ref<HTMLInputElement | null>(null);
const qqBotProfile = ref<QqBotProfile | null>(null);
const qqBotLoading = ref(false);
const sponsorSubmitting = ref(false);
const sponsorAmount = ref("10");
const sponsorPayType = ref<PayType>("alipay");
const sponsorMessage = ref("");
const sponsorDisplayMode = ref<"public" | "anonymous" | "hidden">("public");
const sponsorConfirmOpen = ref(false);
const sponsorOrders = ref<any[]>([]);
const sponsorOptions = reactive<SponsorOptions>({
  enabled: false,
  payTypes: [],
  amounts: [5, 10, 20, 50],
  minAmount: "1.00",
  maxAmount: "9999.00",
  title: "赞助本站",
  description: "赞助会通过易支付完成，成功后金额会展示在你的个人资料里。",
  wallEnabled: true,
  allowMessage: true,
});

const editForm = reactive({ nickname: "", bio: "", college: "", enrollYear: undefined as any });

const passwordDialog = ref(false);
const savingPw = ref(false);
const pwForm = reactive({ oldPassword: "", newPassword: "", confirm: "" });
const anonymousBoards = computed(() => boards.value.filter((board) => board.anonymousEnabled));
const qqPostingText = computed(() => {
  if (!qqBotProfile.value) return "—";
  if (qqBotProfile.value.allowPrivatePost && qqBotProfile.value.allowGroupPost) return "私聊 / 群聊已开启";
  if (qqBotProfile.value.allowPrivatePost) return "仅私聊";
  if (qqBotProfile.value.allowGroupPost) return "仅群聊";
  return "未开启";
});
const anonymousStatusText = computed(() => {
  const state = user.value?.anonymousState;
  if (!state) return "—";
  if (state.frozen) return "已冻结";
  if (!state.eligible) return `未达门槛（${state.minReputation}）`;
  return "可用";
});
const anonymousResetText = computed(() => {
  const nextResetAt = user.value?.anonymousState?.nextResetAt;
  return nextResetAt ? fmtDate(nextResetAt, "MM-DD HH:mm") : "—";
});
const payTypeLabels: Record<PayType, string> = {
  alipay: "支付宝",
  wxpay: "微信支付",
  qqpay: "QQ 钱包",
  bank: "网银",
  jdpay: "京东支付",
};
const sponsorDisplayOptions = [
  { value: "public", label: "公开鸣谢" },
  { value: "anonymous", label: "匿名鸣谢" },
  { value: "hidden", label: "不展示" },
] as const;
const enabledPayTypes = computed(() => sponsorOptions.payTypes.map((value) => ({ value, label: payTypeLabels[value] })));

watch(passwordDialog, (v) => {
  if (!v) { pwForm.oldPassword = ""; pwForm.newPassword = ""; pwForm.confirm = ""; }
});

onMounted(async () => {
  if (!auth.user) await auth.fetchMe();
  if (!auth.user) return;
  if (!site.loaded) await site.fetch();
  const sponsorQuery = String(route.query.sponsor ?? "");
  if (sponsorQuery === "success") {
    await pollSponsorReturn(String(route.query.outTradeNo ?? ""));
  }
  const [topicList, boardList] = await Promise.all([
    request.get<any[]>(`/user/${auth.user.id}/topics`),
    boardApi.list(),
  ]);
  myTopics.value = topicList;
  boards.value = boardList;
  await loadQqBotProfile();
  if (site.features.sponsor || (user.value?.sponsorAmount ?? 0) > 0) await loadSponsorOptions();
  await loadSponsorOrders();
});

watch(editing, (v) => {
  if (v && user.value) {
    editForm.nickname = user.value.nickname;
    editForm.bio = user.value.bio || "";
    editForm.college = user.value.college || "";
    editForm.enrollYear = user.value.enrollYear ?? undefined;
  }
});

async function saveEdit() {
  saving.value = true;
  try {
    const u = await authApi.updateMe(editForm as any);
    auth.user = u;
    ElMessage.success("已保存");
    editing.value = false;
  } finally { saving.value = false; }
}

async function loadSponsorOptions() {
  try {
    Object.assign(sponsorOptions, await paymentsApi.sponsorOptions());
    if (sponsorOptions.amounts.length) sponsorAmount.value = String(sponsorOptions.amounts[1] ?? sponsorOptions.amounts[0]);
    if (sponsorOptions.payTypes.length) sponsorPayType.value = sponsorOptions.payTypes[0];
  } catch {
    sponsorOptions.enabled = false;
  }
}

async function loadSponsorOrders() {
  try {
    sponsorOrders.value = (await paymentsApi.sponsorOrders({ page: 1, size: 10, status: "paid" })).list;
  } catch {
    sponsorOrders.value = [];
  }
}

function formatMoney(value: number | string | undefined | null) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function submitEpayForm(result: { epay: { method: "POST"; submitUrl: string; params: Record<string, string> } }) {
  const form = document.createElement("form");
  form.method = result.epay.method;
  form.action = result.epay.submitUrl;
  form.style.display = "none";
  for (const [key, value] of Object.entries(result.epay.params)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

function validateSponsorAmount() {
  const amount = Number(sponsorAmount.value);
  const min = Number(sponsorOptions.minAmount);
  const max = Number(sponsorOptions.maxAmount);
  if (!Number.isFinite(amount) || amount < min || amount > max) {
    ElMessage.warning(`赞助金额需在 ${formatMoney(min)} - ${formatMoney(max)} 元之间`);
    return false;
  }
  return true;
}

function openSponsorConfirm() {
  if (!validateSponsorAmount()) return;
  sponsorConfirmOpen.value = true;
}

async function submitSponsor() {
  if (!validateSponsorAmount()) return;
  sponsorSubmitting.value = true;
  try {
    const result = await paymentsApi.createSponsorOrderWithOptions({
      amount: sponsorAmount.value,
      payType: sponsorPayType.value,
      message: sponsorMessage.value,
      displayMode: sponsorDisplayMode.value,
    });
    sponsorConfirmOpen.value = false;
    submitEpayForm(result);
  } finally {
    sponsorSubmitting.value = false;
  }
}

async function pollSponsorReturn(outTradeNo: string) {
  if (!outTradeNo) {
    await auth.fetchMe();
    ElMessage.success("支付完成后赞助金额会自动刷新，若未显示请稍等片刻");
    return;
  }
  for (let i = 0; i < 6; i += 1) {
    const order = await paymentsApi.sponsorOrder(outTradeNo).catch(() => null);
    if (order?.status === "paid") {
      await auth.fetchMe();
      ElMessage.success("赞助已到账，感谢支持");
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
  }
  await auth.fetchMe();
  ElMessage.info("已返回本站，支付状态还在确认中");
}

async function savePassword() {
  if (pwForm.newPassword.length < 6) { ElMessage.warning("新密码至少 6 位"); return; }
  if (pwForm.newPassword !== pwForm.confirm) { ElMessage.warning("两次输入的新密码不一致"); return; }
  if (pwForm.newPassword === pwForm.oldPassword) { ElMessage.warning("新密码不能与原密码相同"); return; }
  savingPw.value = true;
  try {
    await authApi.changePassword(pwForm.oldPassword, pwForm.newPassword);
    ElMessage.success("密码已修改");
    passwordDialog.value = false;
  } finally { savingPw.value = false; }
}

async function onLogout() {
  await ElMessageBox.confirm("确认退出登录？", "提示");
  await auth.logout();
  router.push("/login");
}

async function copyUserGroup() {
  await copyText(USER_QQ_GROUP);
  ElMessage.success(`已复制QQ群号 ${USER_QQ_GROUP}`);
}

async function loadQqBotProfile(opts?: { silent?: boolean }) {
  if (!opts?.silent) qqBotLoading.value = true;
  try {
    qqBotProfile.value = await authApi.qqBotProfile();
  } finally {
    if (!opts?.silent) qqBotLoading.value = false;
  }
}

function refreshQqBotProfile() {
  return loadQqBotProfile();
}

async function refreshQqBotToken() {
  qqBotLoading.value = true;
  try {
    await authApi.createQqBotBindToken();
    await loadQqBotProfile({ silent: true });
    ElMessage.success("绑定码已生成");
  } finally {
    qqBotLoading.value = false;
  }
}

async function copyQqBotCommand() {
  if (!qqBotProfile.value?.activeBindToken) return;
  await copyText(`绑定 ${qqBotProfile.value.activeBindToken.token}`);
  ElMessage.success("已复制绑定指令");
}

async function unbindQqBot() {
  await ElMessageBox.confirm("确认解绑当前 QQBot 绑定？解绑后将不能继续通过 QQ 投稿。", "解绑 QQBot", { type: "warning" });
  qqBotLoading.value = true;
  try {
    await authApi.deleteQqBotBinding();
    await loadQqBotProfile({ silent: true });
    ElMessage.success("QQBot 已解绑");
  } finally {
    qqBotLoading.value = false;
  }
}

function joinUserGroup() {
  openUserGroup();
}

function pickAvatar() {
  avatarInputRef.value?.click();
}

async function onAvatarChange(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const file = target?.files?.[0];
  if (!file) return;

  avatarSaving.value = true;
  try {
    const avatar = await compressImageFile(file, {
      maxWidth: 320,
      maxHeight: 320,
      quality: 0.78,
      mimeType: "image/jpeg",
      maxBytes: 140 * 1024,
    });
    await auth.updateProfile({ avatar });
    ElMessage.success("头像已更新");
  } catch (error) {
    ElMessage.error(normalizeImageUploadError(error, "头像上传失败，请稍后重试"));
  } finally {
    avatarSaving.value = false;
    if (target) target.value = "";
  }
}

async function removeAvatar() {
  avatarSaving.value = true;
  try {
    await auth.updateProfile({ avatar: null });
    ElMessage.success("头像已移除");
  } finally {
    avatarSaving.value = false;
  }
}
</script>

<style scoped>
.profile { display: flex; flex-direction: column; gap: 16px; }
.cpu-card { background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

.profile-card { text-align: center; }
.avatar { font-size: 28px; font-weight: 600; }
.avatar-actions {
  margin-top: 10px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.name {
  margin: 12px 0 4px;
  font-size: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}
.account-note { font-size: 12px; color: #9ca3af; margin: 0 0 8px; }
.bio { font-size: 13px; color: #6b7280; margin: 0 0 16px; }

.kv {
  list-style: none;
  padding: 0;
  margin: 0 auto 16px;
  max-width: 320px;
}
.kv li {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 13px;
  border-bottom: 1px dashed #f1f5f9;
}
.kv li:last-child { border-bottom: none; }
.kv li span:first-child { color: #6b7280; }
.kv li span:last-child { color: #1f2937; font-weight: 500; }
.sponsor-total { color: #b45309 !important; }

.profile-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.profile-actions .el-button { flex: 1 1 auto; min-width: 100px; margin-left: 0 !important; }

.sponsor-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sponsor-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}
.sponsor-copy {
  flex: 1;
  min-width: 0;
}
.sponsor-copy p {
  margin: 4px 0 8px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}
.sponsor-copy strong {
  display: block;
  color: #168776;
  font-size: 20px;
  letter-spacing: 0;
  margin-bottom: 12px;
}
.sponsor-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.sponsor-actions .el-button {
  margin-left: 0 !important;
}
.sponsor-panel {
  width: min(560px, 100%);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sponsor-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.amount-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.amount-grid button {
  height: 38px;
  border: 1px solid #d8e2ec;
  border-radius: 8px;
  background: #fff;
  color: #1f2937;
  font-weight: 700;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}
.amount-grid button:hover {
  border-color: #168776;
  color: #168776;
}
.amount-grid button.active {
  border-color: #168776;
  background: #ecfdf5;
  color: #168776;
  box-shadow: inset 0 0 0 1px rgba(22, 135, 118, 0.18);
}
.sponsor-pay-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 136px 108px;
  gap: 8px;
  align-items: center;
}
.sponsor-submit-btn {
  width: 100%;
  margin-left: 0 !important;
  font-weight: 700;
}
.sponsor-money-input :deep(.el-input-group__prepend),
.sponsor-money-input :deep(.el-input__wrapper),
.sponsor-pay-select :deep(.el-select__wrapper) {
  background: #fff;
  min-height: 40px;
}
.sponsor-history {
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px dashed #e5e7eb;
}
.sub-title {
  font-size: 13px;
  font-weight: 700;
  color: #374151;
}
.sponsor-order-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0 0;
}
.sponsor-order-row b {
  display: block;
  color: #b45309;
}
.sponsor-order-row span {
  color: #6b7280;
  font-size: 12px;
}
.order-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.sponsor-confirm {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sponsor-confirm-summary,
.sponsor-confirm-line,
.sponsor-confirm-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sponsor-confirm-summary {
  padding: 12px 14px;
  border-radius: 8px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
}
.sponsor-confirm-summary span,
.sponsor-confirm-line span,
.sponsor-confirm-field > span {
  color: #6b7280;
  font-size: 13px;
}
.sponsor-confirm-summary b {
  color: #168776;
  font-size: 22px;
}
.sponsor-confirm-line strong {
  color: #1f2937;
}
.sponsor-confirm-field {
  align-items: flex-start;
}
.sponsor-confirm-field > span {
  padding-top: 7px;
  white-space: nowrap;
}
.sponsor-display-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: 100%;
  overflow: hidden;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
}
.sponsor-display-tabs button {
  appearance: none;
  min-width: 0;
  width: 100%;
  height: 36px;
  padding: 0 8px;
  border: 0;
  border-right: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.sponsor-display-tabs button:last-child {
  border-right: 0;
}
.sponsor-display-tabs button.active {
  background: #168776;
  color: #fff;
}
.sponsor-display-tabs button:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid rgba(22, 135, 118, 0.35);
  outline-offset: -2px;
}

.trust-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.trust-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.trust-sub {
  margin: 4px 0 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}

.trust-score {
  min-width: 72px;
  text-align: center;
  padding: 10px 14px;
  border-radius: 14px;
  background: linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%);
  color: #fff;
  font-size: 24px;
  font-weight: 700;
}

.trust-level-row {
  margin-top: -4px;
  color: #7c3aed;
  font-size: 13px;
  font-weight: 600;
}

.trust-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.trust-item {
  padding: 12px;
  border-radius: 12px;
  background: #f7f7fb;
}

.trust-item span {
  display: block;
  color: #6b7280;
  font-size: 12px;
  margin-bottom: 6px;
}

.trust-item b {
  color: #111827;
  font-size: 18px;
}

.trust-breakdown {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
}

.trust-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed #eceff3;
  font-size: 13px;
}

.trust-row span {
  color: #6b7280;
}

.trust-row b {
  color: #111827;
}

.trust-next {
  margin: 0;
  color: #7c3aed;
  font-size: 13px;
  line-height: 1.6;
}

.anonymous-boards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.anonymous-boards-label {
  color: #6b7280;
  font-size: 12px;
}

.anonymous-board-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.user-group-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.user-group-card p {
  margin: 4px 0 8px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}
.user-group-card strong {
  color: #168776;
  font-size: 20px;
  letter-spacing: 0;
}
.user-group-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.user-group-actions .el-button {
  margin-left: 0 !important;
}

.qqbot-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.qqbot-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.qqbot-head p {
  margin: 4px 0 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}

.qqbot-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.qqbot-item {
  padding: 12px;
  border-radius: 12px;
  background: #f5fbf9;
  border: 1px solid #d7efe8;
}

.qqbot-item span {
  display: block;
  color: #6b7280;
  font-size: 12px;
  margin-bottom: 6px;
}

.qqbot-item b {
  color: #0f5132;
  font-size: 16px;
}

.qqbot-bind-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 12px;
  background: #fcfffd;
  border: 1px dashed #cfe7df;
}

.qqbot-token {
  display: grid;
  gap: 6px;
}

.qqbot-token strong {
  font-size: 24px;
  color: #168776;
  letter-spacing: 1px;
}

.qqbot-token span,
.qqbot-empty {
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
  margin: 0;
}

.qqbot-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.qqbot-actions .el-button {
  margin-left: 0 !important;
}

.qqbot-help,
.qqbot-recent {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.qqbot-command-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.qqbot-topic-tag {
  background: #168776 !important;
}

.topic-line {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px dashed #f1f5f9;
  cursor: pointer;
  border-radius: 6px;
  min-width: 0;
  overflow: hidden;
}
.topic-line:last-child { border-bottom: none; }
.topic-line:hover { background: #f4f6f8; }
.tag { color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
.anon-tag { color: #7c3aed; font-size: 12px; font-weight: 600; }
.title { font-size: 14px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.meta { font-size: 12px; color: #9ca3af; flex-shrink: 0; }

.cpu-section-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.hidden-file-input { display: none; }

@media (max-width: 640px) {
  .cpu-card {
    border-radius: 10px;
    padding: 14px;
  }

  .profile-actions {
    gap: 6px;
  }
  .profile-actions .el-button {
    flex: 1 1 calc(50% - 4px);
    min-width: 0;
  }

  .avatar-actions {
    gap: 6px;
  }

  .trust-head {
    flex-direction: column;
  }

  .sponsor-main {
    align-items: stretch;
    flex-direction: column;
    gap: 16px;
  }

  .sponsor-copy strong {
    font-size: 20px;
  }

  .amount-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .amount-grid button {
    height: 42px;
  }

  .sponsor-pay-row {
    grid-template-columns: minmax(0, 1fr) 118px;
    gap: 10px;
  }

  .sponsor-submit-btn {
    grid-column: 1 / -1;
    height: 42px;
  }

  .sponsor-history {
    text-align: left;
  }

  .sponsor-order-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .sponsor-confirm-summary,
  .sponsor-confirm-line,
  .sponsor-confirm-field {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .sponsor-confirm-field > span {
    padding-top: 0;
  }

  .sponsor-display-tabs button {
    height: 38px;
    padding: 0 4px;
    font-size: 12px;
  }

  .trust-score {
    min-width: 0;
    width: 100%;
  }

  .trust-grid,
  .trust-breakdown,
  .qqbot-grid {
    grid-template-columns: 1fr;
  }

  .user-group-card {
    align-items: stretch;
    flex-direction: column;
  }

  .qqbot-head {
    flex-direction: column;
  }

  .qqbot-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .user-group-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .topic-line {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 2px;
  }

  .title {
    flex-basis: 100%;
    order: 3;
    white-space: normal;
    line-height: 1.45;
  }

  .meta {
    margin-left: auto;
  }
}
</style>
