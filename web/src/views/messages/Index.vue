<template>
  <div class="msg-page" :class="{ 'is-private': tab === 'private' }" v-loading="loading && tab !== 'private'">
    <div class="page-head">
      <div class="page-head-main">
        <h2 class="page-title">消息中心</h2>
        <span v-if="tab !== 'settings' && tab !== 'private'" class="page-sub">{{ unreadCount ? `${unreadCount} 条未读` : "当前全部已读" }}</span>
        <span v-else-if="tab === 'settings'" class="page-sub settings-page-sub">管理通知渠道与订阅偏好</span>
        <span v-else class="page-sub private-page-sub">查看会话与站内私信</span>
      </div>
      <div v-if="tab !== 'settings' && tab !== 'private' && unreadCount" class="page-head-actions">
        <el-button text :loading="markingAll" :disabled="markingAll" @click="readAll">全部标为已读</el-button>
      </div>
      <nav class="mobile-message-modes" aria-label="消息中心主要功能">
        <button
          type="button"
          :class="{ active: tab === 'private' }"
          :aria-current="tab === 'private' ? 'page' : undefined"
          @click="selectMobileMessageMode('private')"
        >
          <span class="mode-icon"><el-icon><ChatDotRound /></el-icon></span>
          <span class="mode-copy"><b>私聊</b><small>会话消息</small></span>
          <span v-if="msg.directUnreadCount" class="mode-count">{{ Math.min(msg.directUnreadCount, 99) }}</span>
        </button>
        <button type="button" :class="{ active: tab !== 'settings' && tab !== 'private' }" :aria-current="tab !== 'settings' && tab !== 'private' ? 'page' : undefined" @click="selectMobileMessageMode('all')">
          <span class="mode-icon"><el-icon><Bell /></el-icon></span>
          <span class="mode-copy"><b>通知</b><small>{{ unreadCount ? `${unreadCount} 条未读` : "全部已读" }}</small></span>
          <span v-if="unreadCount" class="mode-count">{{ Math.min(unreadCount, 99) }}</span>
        </button>
        <button type="button" :class="{ active: tab === 'settings' }" :aria-current="tab === 'settings' ? 'page' : undefined" @click="selectMobileMessageMode('settings')">
          <span class="mode-icon"><el-icon><Setting /></el-icon></span>
          <span class="mode-copy"><b>设置</b><small>通知渠道</small></span>
        </button>
      </nav>
    </div>
    <nav v-if="tab !== 'private' && tab !== 'settings'" class="mobile-notice-filters" aria-label="通知分类">
      <button
        v-for="item in mobileNoticeTabs"
        :key="item.name"
        type="button"
        :class="{ active: tab === item.name }"
        :aria-current="tab === item.name ? 'page' : undefined"
        @click="tab = item.name"
      >
        <span>{{ item.label }}</span>
        <small v-if="unreadForTab(item.name)">{{ Math.min(unreadForTab(item.name), 99) }}</small>
      </button>
    </nav>
    <div v-if="pageError && tab !== 'private'" class="cpu-card page-error">
      <el-empty :description="pageError">
        <el-button type="primary" @click="loadPage">重试</el-button>
      </el-empty>
    </div>
    <el-tabs v-else v-model="tab" class="cpu-card messages-tabs" :class="{ 'is-private': tab === 'private' }">
      <el-tab-pane name="private" lazy>
        <template #label>
          <span class="private-tab-label">
            私聊
            <span v-if="msg.directUnreadCount" class="private-tab-count">{{ Math.min(msg.directUnreadCount, 99) }}</span>
          </span>
        </template>
        <DirectMessages @notices-read="onDirectNoticesRead" />
      </el-tab-pane>
      <el-tab-pane label="全部" name="all">
        <MessageList :list="filteredMessages('')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="回复 / 提及" name="reply">
        <MessageList :list="filteredMessages('reply')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="点赞" name="like">
        <MessageList :list="filteredMessages('like')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="系统 / 站务" name="system">
        <MessageList :list="filteredMessages('system')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="小工具" name="service-tool">
        <MessageList :list="filteredMessages('service-tool')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="失物招领" name="lost-found">
        <MessageList :list="filteredMessages('lost-found')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="设置" name="settings">
        <div v-if="settings" class="settings">
          <div v-if="qqBotBindingReturnUrl" class="qq-bind-guide">
            <div class="qq-bind-guide-copy">
              <b>先绑定群管理员 QQ，再继续处理通报</b>
              <span>生成绑定码后，私聊 QQ Bot 发送绑定命令；完成后刷新下方状态，再返回原通报链接。</span>
            </div>
            <el-button
              type="primary"
              :disabled="!qqBotBindingReady"
              @click="returnToQqBotReport"
            >
              返回处理链接
            </el-button>
          </div>
          <h4>通知渠道</h4>
          <div class="qq-channel-card wechat-channel-card" v-loading="wechatLoading">
            <div class="qq-channel-head">
              <div>
                <b>微信服务号</b>
                <span>绑定后可通过服务号接收已开启的站内通知。</span>
              </div>
              <el-tag :type="wechatChannelTagType" effect="plain">{{ wechatChannelStateText }}</el-tag>
            </div>
            <el-alert
              v-if="wechatProfileError"
              type="warning"
              :closable="false"
              show-icon
              class="qq-channel-alert"
              :title="wechatProfileError"
            >
              <template #default><el-button size="small" :loading="wechatLoading" @click="refreshWechatProfile">重试</el-button></template>
            </el-alert>
            <template v-else>
              <div class="qq-channel-grid wechat-channel-grid">
                <div><span>服务号</span><b>{{ wechatProfile?.accountName || "未配置" }}</b></div>
                <div><span>微信号</span><b>{{ wechatProfile?.wechatId || "未配置" }}</b></div>
                <div><span>账号状态</span><b>{{ wechatProfile?.binding ? (wechatProfile.binding.subscribed ? "已关注并绑定" : "已绑定，当前未关注") : "未绑定" }}</b></div>
              </div>
              <div v-if="wechatQr" class="channel-qr-box">
                <img :src="wechatQr.imageUrl" alt="微信服务号绑定二维码" />
                <div>
                  <b>使用微信扫码完成绑定</b>
                  <span>在微信中打开授权页后会立即确认；二维码有效期至 {{ formatNoticeTime(wechatQr.expiresAt) }}</span>
                </div>
              </div>
              <div v-else-if="!wechatProfile?.binding" class="channel-qr-box">
                <img src="/wechat-service-qrcode.png" :alt="`${wechatProfile?.accountName || '拾小间'}服务号二维码`" />
                <div>
                  <b>扫码关注 {{ wechatProfile?.accountName || "拾小间" }}</b>
                  <span v-if="wechatProfile?.wechatId">微信号：{{ wechatProfile.wechatId }}</span>
                  <span>关注后可在微信内打开本页授权绑定；也可点击下方“扫码绑定”生成专属二维码。</span>
                </div>
              </div>
              <p class="qq-channel-hint">
                {{ wechatProfile?.binding ? "当前账号已绑定微信服务号。" : "微信绑定不需要输入绑定码，请使用微信内授权或专属二维码。" }}
              </p>
              <el-alert
                v-if="wechatProfile?.binding?.subscribed && !wechatProfile.persistentNotificationAvailable"
                type="warning"
                :closable="false"
                show-icon
                class="qq-channel-alert"
                title="当前仅支持互动窗口内推送"
                description="请先向服务号发送一条文字消息，系统会立即补发近 48 小时内尚未送达的重要通知；只点击菜单的有效窗口仅为 1 分钟。"
              />
              <label class="qq-channel-toggle">
                <span>
                  <b>微信提醒</b>
                  <small>开启后，服务号会按照下方订阅偏好发送可用的提醒。</small>
                </span>
                <el-switch v-model="settings.wechatNotifyEnabled" />
              </label>
              <div
                v-if="wechatProfile?.binding && wechatProfile.subscriptionAvailable && isWechatBrowser"
                class="wechat-subscribe-card"
              >
                <div>
                  <b>一次性微信提醒</b>
                  <span>每次同意可接收下一条超出客服窗口的站内通知，由微信原生界面确认。</span>
                </div>
                <div ref="wechatSubscribeContainer" class="wechat-subscribe-button-host" />
                <small v-if="wechatSubscribeState">{{ wechatSubscribeState }}</small>
              </div>
              <div class="qq-channel-actions">
                <el-button
                  v-if="!wechatProfile?.binding && isWechatBrowser"
                  type="primary"
                  :loading="wechatLoading"
                  :disabled="wechatLoading || !wechatProfile?.oauthAvailable"
                  @click="startWechatOauthBinding"
                >
                  微信内绑定
                </el-button>
                <el-button
                  v-if="!wechatProfile?.binding"
                  type="primary"
                  plain
                  :loading="wechatLoading"
                  :disabled="wechatLoading || !wechatProfile?.qrBindingAvailable"
                  @click="createWechatQr"
                >
                  {{ wechatQr ? "重新生成二维码" : "扫码绑定" }}
                </el-button>
                <el-button
                  v-if="wechatProfile?.binding"
                  type="danger"
                  plain
                  :loading="wechatLoading"
                  @click="unbindWechat"
                >
                  解绑微信
                </el-button>
                <el-button plain :loading="wechatLoading" @click="refreshWechatProfile">刷新状态</el-button>
              </div>
            </template>
          </div>
          <div class="qq-channel-card" v-loading="qqBotLoading">
            <div class="qq-channel-head">
              <div>
                <b>QQ 私聊</b>
                <span>绑定后，开启的通知可通过 QQ 私聊送达。</span>
              </div>
              <el-tag :type="qqChannelTagType" effect="plain">{{ qqChannelStateText }}</el-tag>
            </div>
            <el-alert
              v-if="qqBotProfileError"
              type="warning"
              :closable="false"
              show-icon
              class="qq-channel-alert"
              :title="qqBotProfileError"
            >
              <template #default>
                <el-button size="small" :loading="qqBotLoading" @click="refreshQqBotProfile">重试</el-button>
              </template>
            </el-alert>
            <template v-else>
              <div class="qq-channel-grid">
                <div>
                  <span>机器人账号</span>
                  <b>{{ qqBotProfile?.botQqId || "未配置" }}</b>
                </div>
                <div>
                  <span>绑定 QQ</span>
                  <b>{{ qqBotProfile?.binding?.qqId || "未绑定" }}</b>
                </div>
                <div>
                  <span>QQ 投稿</span>
                  <b>{{ qqPostingText }}</b>
                </div>
              </div>
              <div v-if="!qqBotProfile?.binding && qqBotAddFriendQr" class="channel-qr-box">
                <a :href="qqBotAddFriendUrl" target="_blank" rel="noopener noreferrer"><img :src="qqBotAddFriendQr" alt="QQBot 添加好友二维码" /></a>
                <div>
                  <b>扫码添加机器人好友</b>
                  <span>QQ：{{ qqBotProfile?.botQqId }}</span>
                  <span>由 QQ 官方页面唤起好友添加；若未跳转，可搜索上方 QQ 号。</span>
                  <span>添加后私聊发送下方绑定指令。</span>
                  <a :href="qqBotAddFriendUrl" target="_blank" rel="noopener noreferrer" class="channel-qr-link">在 QQ 中打开</a>
                </div>
              </div>
              <div v-if="qqBotProfile?.activeBindToken" class="qq-token-box">
                <strong>{{ qqBotProfile.activeBindToken.token }}</strong>
                <span>请在 QQ 私聊机器人发送：{{ qqBotBindCommandText }}</span>
                <span>有效期至 {{ formatNoticeTime(qqBotProfile.activeBindToken.expiresAt) }}</span>
              </div>
              <p v-else class="qq-channel-hint">
                {{ qqBotProfile?.binding ? "当前账号已绑定 QQ，如需更换请先解绑。" : "生成绑定码后，在 QQ 私聊机器人发送绑定命令即可完成绑定。" }}
              </p>
              <label class="qq-channel-toggle">
                <span>
                  <b>QQ 私聊提醒</b>
                  <small>开启后，已订阅的通知会通过 QQ 私聊发送；关闭后仅保留站内消息。</small>
                </span>
                <el-switch v-model="settings.qqBotNotifyEnabled" />
              </label>
              <div class="qq-channel-actions">
                <el-button
                  v-if="!qqBotProfile?.binding"
                  type="primary"
                  plain
                  :loading="qqBotLoading"
                  :disabled="qqBotLoading || !qqBotProfile?.enabled"
                  @click="refreshQqBotToken"
                >
                  {{ qqBotProfile?.activeBindToken ? "重新生成绑定码" : "生成绑定码" }}
                </el-button>
                <el-button
                  v-if="qqBotProfile?.activeBindToken"
                  plain
                  :loading="qqBotLoading"
                  :disabled="qqBotLoading"
                  @click="copyQqBotCommand"
                >
                  复制完整绑定指令
                </el-button>
                <el-button
                  v-if="qqBotProfile?.binding"
                  type="danger"
                  plain
                  :loading="qqBotLoading"
                  :disabled="qqBotLoading"
                  @click="unbindQqBot"
                >
                  解绑 QQ
                </el-button>
                <el-button plain :loading="qqBotLoading" :disabled="qqBotLoading" @click="refreshQqBotProfile">刷新状态</el-button>
              </div>
            </template>
          </div>
          <el-divider />
          <h4>订阅偏好</h4>
          <div class="switches">
            <label class="switch-item">
              <span>收到回复时</span>
              <el-switch v-model="settings.subscribeReply" />
            </label>
            <label class="switch-item">
              <span>收到点赞时</span>
              <el-switch v-model="settings.subscribeLike" />
            </label>
            <label class="switch-item">
              <span>校园公告更新</span>
              <el-switch v-model="settings.subscribeSchool" />
            </label>
            <label class="switch-item">
              <span>系统 / 站务通知</span>
              <el-switch v-model="settings.subscribeSystem" />
            </label>
          </div>
          <el-divider />
          <h4>小工具提醒</h4>
          <button type="button" class="settings-action-row" @click="openQqBotReminderSettings">
            <span class="settings-action-icon">
              <el-icon><Bell /></el-icon>
            </span>
            <span class="settings-action-copy">
              <b>小工具提醒规则</b>
              <span>选择哪些问卷、文件收集和成绩表通过已启用的消息渠道提醒。</span>
            </span>
            <el-icon class="settings-action-arrow"><ArrowRight /></el-icon>
          </button>
          <el-button type="primary" :loading="saving" :disabled="saving" class="save-btn" @click="saveSettings">保存设置</el-button>
        </div>
        <el-empty v-else description="设置暂不可用" />
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="detailOpen" title="通知详情" width="620px" append-to-body class="notice-dialog">
      <div v-if="activeNotice" class="notice-detail">
        <div class="notice-head">
          <h3 class="notice-title">{{ activeNotice.title }}</h3>
          <div class="notice-meta">{{ activeNotice.source || "校内" }} · {{ formatNoticeTime(activeNotice.createdAt) }}</div>
        </div>
        <p v-if="activeNoticeContent" class="notice-content">{{ activeNoticeContent }}</p>
        <div v-if="reviewStateText" class="review-state" :class="{ done: !canReviewActiveNotice }">
          {{ reviewStateText }}
        </div>

        <div v-if="activeNotice.payload?.riskScore !== undefined || activeNotice.payload?.reason" class="notice-risk">
          <span v-if="activeNotice.payload?.reason">审核说明：{{ activeNotice.payload.reason }}</span>
          <span v-else>系统判定这条内容需要进一步确认。</span>
        </div>

        <div v-if="activeNotice.payload?.title" class="notice-draft">
          <div class="draft-title">{{ activeNotice.payload.title }}</div>
          <div v-if="activeNotice.payload?.note" class="draft-note">{{ activeNotice.payload.note }}</div>
        </div>
      </div>
      <template #footer>
        <div class="notice-actions">
          <el-button v-if="canOpenActiveNoticeTarget" @click="goNoticeLink">前往查看</el-button>
          <el-button
            v-if="canRequestManualReviewFromNotice"
            type="warning"
            :loading="requestingManualReview"
            :disabled="requestingManualReview"
            @click="requestManualReviewFromNotice"
          >
            申请人工复核
          </el-button>
          <el-button
            v-if="canReviewActiveNotice"
            type="success"
            :loading="reviewing"
            :disabled="reviewing"
            @click="approveFromNotice"
          >
            {{ reviewActionLabel }}通过
          </el-button>
          <el-button
            v-if="canReviewActiveNotice"
            type="warning"
            :loading="reviewing"
            :disabled="reviewing"
            @click="rejectFromNotice"
          >
            {{ reviewActionLabel }}驳回
          </el-button>
          <el-button @click="detailOpen = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowRight, Bell, ChatDotRound, Setting } from "@element-plus/icons-vue";
import MessageList from "@/components/messages/MessageList.vue";
import DirectMessages from "@/components/messages/DirectMessages.vue";
import { messageApi } from "@/api/message";
import { topicApi } from "@/api/topic";
import { authApi, type QqBotProfile, type WechatProfile } from "@/api/auth";
import { useMessageStore } from "@/stores/message";
import { useAuthStore } from "@/stores/auth";
import { adminApi } from "@/api/admin";
import { fmtDate } from "@/utils/format";
import { copyText } from "@/utils/userGroup";
import QRCode from "qrcode";
import { buildQqAddFriendUrl } from "@/utils/qqContact";
import { isServerHandledRedirect, resolveSafeRedirect } from "@/utils/redirect";
import { forumContentExcerpt } from "@/utils/forumContent";
import { isWechatBrowser as detectWechatBrowser, mountWechatSubscribeButton } from "@/utils/wechatBridge";

const route = useRoute();
const router = useRouter();
const msg = useMessageStore();
const auth = useAuthStore();

const messageTabs = new Set(["all", "private", "reply", "like", "system", "service-tool", "lost-found", "settings"]);
type NoticeTab = "all" | "reply" | "like" | "system" | "service-tool" | "lost-found";
const mobileNoticeTabs: Array<{ name: NoticeTab; label: string }> = [
  { name: "all", label: "全部" },
  { name: "reply", label: "回复" },
  { name: "like", label: "点赞" },
  { name: "system", label: "系统" },
  { name: "service-tool", label: "小工具" },
  { name: "lost-found", label: "失物招领" },
];
const tab = ref(normalizeMessageTab(route.query.tab));
const list = ref<any[]>([]);
const settings = ref<any>(null);
const qqBotProfile = ref<QqBotProfile | null>(null);
const qqBotLoading = ref(false);
const qqBotProfileError = ref("");
const qqBotAddFriendQr = ref("");
const wechatProfile = ref<WechatProfile | null>(null);
const wechatLoading = ref(false);
const wechatProfileError = ref("");
const wechatQr = ref<{ imageUrl: string; expiresAt: string } | null>(null);
const wechatSubscribeContainer = ref<HTMLElement | null>(null);
const wechatSubscribeState = ref("");
const loading = ref(false);
const pageError = ref("");
const saving = ref(false);
const markingAll = ref(false);
const detailOpen = ref(false);
const activeNotice = ref<any | null>(null);
const reviewing = ref(false);
const requestingManualReview = ref(false);
const reviewTarget = ref<{ kind: "topic" | "reply"; id: number; title: string; aiReviewStatus: string; hidden: boolean; topicId?: number; reviewable: boolean } | null>(null);
const reviewTargetLoading = ref(false);
let loadSeq = 0;
let qqBotProfileSeq = 0;
let qqBotAddFriendQrSeq = 0;
let wechatProfileSeq = 0;
let reviewTargetSeq = 0;
let disposed = false;
let wechatQrPollTimer: ReturnType<typeof setTimeout> | null = null;
let wechatQrPollSeq = 0;
let disposeWechatSubscribeButton: (() => void) | null = null;
let privateViewportQuery: MediaQueryList | null = null;

const unreadCount = computed(() => list.value.filter((item) => !item.readAt).length);
const isWechatBrowser = detectWechatBrowser();
const activeNoticeContent = computed(() => forumContentExcerpt(activeNotice.value?.content, 500));
const wechatChannelStateText = computed(() => {
  if (wechatProfileError.value) return "状态未知";
  if (!wechatProfile.value?.enabled) return "未启用";
  if (!wechatProfile.value.binding) return "未绑定";
  if (!wechatProfile.value.binding.enabled) return "已停用";
  return wechatProfile.value.binding.subscribed ? "已绑定" : "已取消关注";
});
const wechatChannelTagType = computed(() => {
  if (wechatProfileError.value) return "warning";
  if (!wechatProfile.value?.enabled || !wechatProfile.value.binding) return "info";
  return wechatProfile.value.binding.enabled && wechatProfile.value.binding.subscribed ? "success" : "warning";
});
const qqBotBindingReturnUrl = computed(() => {
  if (route.query.qqbot !== "bind") return "";
  const target = resolveSafeRedirect(route.query.returnTo, "");
  return isServerHandledRedirect(target) ? target : "";
});
const qqBotBindingReady = computed(() => Boolean(qqBotProfile.value?.binding?.enabled));
const qqChannelStateText = computed(() => {
  if (qqBotProfileError.value) return "状态未知";
  if (!qqBotProfile.value?.enabled) return "未启用";
  if (!qqBotProfile.value.binding) return "未绑定";
  return qqBotProfile.value.binding.enabled ? "已绑定" : "已停用";
});
const qqChannelTagType = computed(() => {
  if (qqBotProfileError.value) return "warning";
  if (!qqBotProfile.value?.enabled || !qqBotProfile.value.binding) return "info";
  return qqBotProfile.value.binding.enabled ? "success" : "warning";
});
const qqPostingText = computed(() => {
  if (!qqBotProfile.value) return "—";
  if (qqBotProfile.value.allowPrivatePost && qqBotProfile.value.allowGroupPost) return "私聊 / 群聊";
  if (qqBotProfile.value.allowPrivatePost) return "仅私聊";
  if (qqBotProfile.value.allowGroupPost) return "仅群聊";
  return "未开启";
});
const qqBotBindCommandText = computed(() => {
  if (qqBotProfile.value?.activeBindToken) return `绑定 ${qqBotProfile.value.activeBindToken.token}`;
  return "绑定 绑定码";
});
const qqBotAddFriendUrl = computed(() => {
  return buildQqAddFriendUrl(qqBotProfile.value?.botQqId);
});
onMounted(() => {
  disposed = false;
  privateViewportQuery = window.matchMedia("(max-width: 720px)");
  privateViewportQuery.addEventListener("change", syncPrivateScrollLock);
  syncPrivateScrollLock();
  void loadPage();
  void loadQqBotProfile({ silent: true });
  void loadWechatProfile({ silent: true });
  if (route.query.wechat === "bound") {
    ElMessage.success("微信服务号绑定成功");
    router.replace({ query: { ...route.query, wechat: undefined } }).catch(() => null);
  } else if (route.query.wechat === "error") {
    ElMessage.error("微信绑定失败，请重新发起");
    router.replace({ query: { ...route.query, wechat: undefined } }).catch(() => null);
  }
});

onBeforeUnmount(() => {
  disposed = true;
  loadSeq += 1;
  qqBotProfileSeq += 1;
  qqBotAddFriendQrSeq += 1;
  wechatProfileSeq += 1;
  reviewTargetSeq += 1;
  loading.value = false;
  qqBotLoading.value = false;
  wechatLoading.value = false;
  saving.value = false;
  markingAll.value = false;
  reviewing.value = false;
  requestingManualReview.value = false;
  reviewTargetLoading.value = false;
  stopWechatQrPolling();
  disposeWechatSubscribeButton?.();
  disposeWechatSubscribeButton = null;
  privateViewportQuery?.removeEventListener("change", syncPrivateScrollLock);
  privateViewportQuery = null;
  setPrivateScrollLock(false);
});

watch(() => route.query.tab, (value) => {
  const next = normalizeMessageTab(value);
  if (tab.value !== next) tab.value = next;
  const raw = typeof value === "string" ? value : "";
  if (raw && (raw === "all" || !messageTabs.has(raw))) {
    router.replace({ query: { ...route.query, tab: undefined } }).catch(() => null);
  }
}, { immediate: true });

watch(tab, (value) => {
  syncPrivateScrollLock();
  const nextQuery = {
    ...route.query,
    tab: value === "all" ? undefined : value,
    ...(value === "private" ? {} : directMessageQueryReset()),
  };
  if ((route.query.tab || "all") === (nextQuery.tab || "all")) return;
  router.replace({ query: nextQuery }).catch(() => null);
});

function selectMobileMessageMode(value: "private" | "all" | "settings") {
  tab.value = value;
  const nextQuery = {
    ...route.query,
    tab: value === "all" ? undefined : value,
    ...directMessageQueryReset(),
  };
  router.replace({ query: nextQuery }).catch(() => null);
}

function directMessageQueryReset() {
  return {
    conversation: undefined,
    user: undefined,
    forumKind: undefined,
    forumId: undefined,
  };
}

function syncPrivateScrollLock() {
  setPrivateScrollLock(tab.value === "private" && Boolean(privateViewportQuery?.matches));
}

function setPrivateScrollLock(active: boolean) {
  document.documentElement.classList.toggle("messages-private-scroll-lock", active);
  document.body.classList.toggle("messages-private-scroll-lock", active);
}

watch(qqBotAddFriendUrl, async (value) => {
  const seq = ++qqBotAddFriendQrSeq;
  qqBotAddFriendQr.value = "";
  if (!value) return;
  try {
    const image = await QRCode.toDataURL(value, {
      width: 320,
      margin: 2,
      color: { dark: "#172033", light: "#ffffffff" },
    });
    if (!disposed && seq === qqBotAddFriendQrSeq) qqBotAddFriendQr.value = image;
  } catch {
    if (!disposed && seq === qqBotAddFriendQrSeq) qqBotAddFriendQr.value = "";
  }
}, { immediate: true });

async function reloadNoticeState() {
  if (disposed) return;
  const seq = ++loadSeq;
  const [nextList, nextSettings] = await Promise.all([
    messageApi.list(undefined, { suppressErrorMessage: true }),
    messageApi.settings({ suppressErrorMessage: true }),
  ]);
  if (disposed || seq !== loadSeq) return;
  list.value = nextList;
  settings.value = normalizeMessageSettings(nextSettings);
  pageError.value = "";
  msg.setNotices(list.value);
}

async function refreshNoticeStateAfterAction() {
  try {
    await reloadNoticeState();
  } catch (error) {
    if (disposed) return;
    ElMessage.warning(normalizeMessageActionError(error, "操作已完成，但消息列表刷新失败"));
  }
}

function filteredMessages(cat: string) {
  if (!cat) return list.value;
  return list.value.filter((n) => n.category === cat);
}

function unreadForTab(name: NoticeTab) {
  if (name === "all") return unreadCount.value;
  return list.value.filter((notice) => notice.category === name && !notice.readAt).length;
}

async function onRead(id: number) {
  if (disposed) return;
  try {
    await messageApi.read(id, { suppressErrorMessage: true });
    if (disposed) return;
    const n = list.value.find((x) => x.id === id);
    if (n) n.readAt = new Date().toISOString();
    msg.setNotices(list.value);
  } catch (error) {
    if (disposed) return;
    ElMessage.error(normalizeMessageActionError(error, "消息标记已读失败"));
  }
}

async function readAll() {
  if (disposed || !unreadCount.value || markingAll.value) return;
  markingAll.value = true;
  try {
    await messageApi.readAll({ suppressErrorMessage: true });
    if (disposed) return;
    list.value.forEach((n) => (n.readAt = new Date().toISOString()));
    ElMessage.success("已全部已读");
    msg.setNotices(list.value);
  } catch (error) {
    if (disposed) return;
    ElMessage.error(normalizeMessageActionError(error, "全部已读失败"));
  } finally {
    if (!disposed) markingAll.value = false;
  }
}

async function saveSettings() {
  if (disposed || !settings.value || saving.value) return;
  saving.value = true;
  try {
    const { id, userId, ...payload } = settings.value;
    const nextSettings = await messageApi.updateSettings(payload, { suppressErrorMessage: true });
    if (disposed) return;
    settings.value = normalizeMessageSettings(nextSettings);
    ElMessage.success("已保存");
  } catch (error) {
    if (disposed) return;
    ElMessage.error(normalizeMessageActionError(error, "设置保存失败"));
  } finally {
    if (!disposed) saving.value = false;
  }
}

function openQqBotReminderSettings() {
  router.push("/messages/qqbot-reminders");
}

async function loadQqBotProfile(opts?: { silent?: boolean }) {
  if (disposed) return;
  const seq = ++qqBotProfileSeq;
  qqBotLoading.value = true;
  qqBotProfileError.value = "";
  try {
    const profile = await authApi.qqBotProfile({ suppressErrorMessage: true });
    if (disposed || seq !== qqBotProfileSeq) return;
    qqBotProfile.value = profile;
  } catch (error) {
    if (disposed || seq !== qqBotProfileSeq) return;
    qqBotProfile.value = null;
    qqBotProfileError.value = normalizeMessageActionError(error, "QQ 私聊状态加载失败");
    if (!opts?.silent) ElMessage.error(qqBotProfileError.value);
  } finally {
    if (!disposed && seq === qqBotProfileSeq) qqBotLoading.value = false;
  }
}

function refreshQqBotProfile() {
  return loadQqBotProfile();
}

function onDirectNoticesRead(conversationId: number) {
  const readAt = new Date().toISOString();
  list.value.forEach((notice) => {
    if (
      notice.category === "direct-message"
      && Number(notice.payload?.conversationId || 0) === conversationId
      && !notice.readAt
    ) {
      notice.readAt = readAt;
    }
  });
  msg.setNotices(list.value);
}

async function loadWechatProfile(opts?: { silent?: boolean }) {
  if (disposed) return;
  const seq = ++wechatProfileSeq;
  wechatLoading.value = true;
  wechatProfileError.value = "";
  try {
    const profile = await authApi.wechatProfile({ suppressErrorMessage: true });
    if (disposed || seq !== wechatProfileSeq) return;
    wechatProfile.value = profile;
    if (profile.binding) {
      wechatQr.value = null;
      stopWechatQrPolling();
    }
    await nextTick();
    await initializeWechatSubscribeButton(profile);
  } catch (error) {
    if (disposed || seq !== wechatProfileSeq) return;
    wechatProfile.value = null;
    wechatProfileError.value = normalizeMessageActionError(error, "微信服务号状态加载失败");
    if (!opts?.silent) ElMessage.error(wechatProfileError.value);
  } finally {
    if (!disposed && seq === wechatProfileSeq) wechatLoading.value = false;
  }
}

async function initializeWechatSubscribeButton(profile: WechatProfile) {
  disposeWechatSubscribeButton?.();
  disposeWechatSubscribeButton = null;
  wechatSubscribeState.value = "";
  if (!isWechatBrowser || !profile.binding || !profile.subscriptionAvailable || !profile.subscriptionTemplateId) return;
  const container = wechatSubscribeContainer.value;
  if (!container) return;
  try {
    const config = await authApi.wechatJsSdkConfig(window.location.href, { suppressErrorMessage: true });
    if (disposed || container !== wechatSubscribeContainer.value) return;
    disposeWechatSubscribeButton = await mountWechatSubscribeButton(
      container,
      profile.subscriptionTemplateId,
      config,
      {
        onSuccess: () => {
          wechatSubscribeState.value = "已完成选择；同意后可接收下一条对应提醒。";
          ElMessage.success("微信提醒订阅状态已更新");
        },
        onError: () => {
          wechatSubscribeState.value = "微信未能打开订阅界面，请确认 JS 接口安全域名和模板配置。";
        },
      },
    );
  } catch (error) {
    if (!disposed) wechatSubscribeState.value = normalizeMessageActionError(error, "微信订阅按钮暂不可用");
  }
}

function refreshWechatProfile() {
  return loadWechatProfile();
}

async function startWechatOauthBinding() {
  if (disposed || wechatLoading.value) return;
  wechatLoading.value = true;
  try {
    const result = await authApi.createWechatOauthUrl({ suppressErrorMessage: true });
    window.location.assign(result.url);
  } catch (error) {
    if (!disposed) ElMessage.error(normalizeMessageActionError(error, "微信授权发起失败"));
    wechatLoading.value = false;
  }
}

async function createWechatQr() {
  if (disposed || wechatLoading.value) return;
  wechatLoading.value = true;
  try {
    wechatQr.value = await authApi.createWechatBindQr({ suppressErrorMessage: true });
    startWechatQrPolling();
  } catch (error) {
    if (!disposed) ElMessage.error(normalizeMessageActionError(error, "绑定二维码生成失败"));
  } finally {
    if (!disposed) wechatLoading.value = false;
  }
}

function startWechatQrPolling() {
  stopWechatQrPolling();
  const seq = ++wechatQrPollSeq;
  void pollWechatQrStatus(seq);
}

async function pollWechatQrStatus(seq: number) {
  if (disposed || seq !== wechatQrPollSeq || !wechatQr.value) return;
  if (new Date(wechatQr.value.expiresAt).getTime() <= Date.now()) {
    wechatQr.value = null;
    stopWechatQrPolling();
    return;
  }
  try {
    const profile = await authApi.wechatProfile({ suppressErrorMessage: true });
    if (disposed || seq !== wechatQrPollSeq || !wechatQr.value) return;
    if (profile.binding) {
      wechatProfile.value = profile;
      wechatProfileError.value = "";
      wechatQr.value = null;
      stopWechatQrPolling();
      ElMessage.success("微信服务号绑定成功");
      return;
    }
  } catch {
    // 下一轮继续确认，短暂网络错误不打断扫码流程。
  }
  if (seq === wechatQrPollSeq) {
    wechatQrPollTimer = setTimeout(() => void pollWechatQrStatus(seq), 1000);
  }
}

function stopWechatQrPolling() {
  wechatQrPollSeq += 1;
  if (!wechatQrPollTimer) return;
  clearTimeout(wechatQrPollTimer);
  wechatQrPollTimer = null;
}

async function unbindWechat() {
  if (disposed || wechatLoading.value) return;
  const confirmed = await ElMessageBox.confirm("确认解绑微信服务号？解绑后将不能通过微信接收提醒。", "解绑微信", { type: "warning" })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  wechatLoading.value = true;
  try {
    await authApi.deleteWechatBinding({ suppressErrorMessage: true });
    await loadWechatProfile({ silent: true });
    if (!disposed) ElMessage.success("微信服务号绑定已解绑");
  } catch (error) {
    if (!disposed) ElMessage.error(normalizeMessageActionError(error, "解绑失败"));
  } finally {
    if (!disposed) wechatLoading.value = false;
  }
}

function returnToQqBotReport() {
  if (!qqBotBindingReady.value || !qqBotBindingReturnUrl.value) {
    ElMessage.warning("请先完成 QQ 绑定并刷新状态");
    return;
  }
  window.location.assign(qqBotBindingReturnUrl.value);
}

async function refreshQqBotToken() {
  if (disposed || qqBotLoading.value) return;
  qqBotLoading.value = true;
  try {
    await authApi.createQqBotBindToken({ suppressErrorMessage: true });
    await loadQqBotProfile({ silent: true });
    if (disposed) return;
    ElMessage.success("绑定码已生成");
  } catch (error) {
    if (!disposed) ElMessage.error(normalizeMessageActionError(error, "绑定码生成失败"));
  } finally {
    if (!disposed) qqBotLoading.value = false;
  }
}

async function copyQqBotCommand() {
  if (disposed || qqBotLoading.value) return;
  if (!qqBotProfile.value?.activeBindToken) {
    ElMessage.warning("请先生成绑定码");
    return;
  }
  await copyText(`绑定 ${qqBotProfile.value.activeBindToken.token}`);
  ElMessage.success("已复制绑定指令");
}

async function unbindQqBot() {
  if (disposed || qqBotLoading.value) return;
  const confirmed = await ElMessageBox.confirm("确认解绑当前 QQ 私聊绑定？解绑后将不能通过 QQ 私聊接收提醒或投稿。", "解绑 QQ", { type: "warning" })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  qqBotLoading.value = true;
  try {
    await authApi.deleteQqBotBinding({ suppressErrorMessage: true });
    await loadQqBotProfile({ silent: true });
    if (disposed) return;
    ElMessage.success("QQ 私聊绑定已解绑");
  } catch (error) {
    if (!disposed) ElMessage.error(normalizeMessageActionError(error, "解绑失败"));
  } finally {
    if (!disposed) qqBotLoading.value = false;
  }
}

async function loadPage() {
  if (disposed) return;
  const seq = ++loadSeq;
  loading.value = true;
  pageError.value = "";
  try {
    const [nextList, nextSettings] = await Promise.all([
      messageApi.list(undefined, { suppressErrorMessage: true }),
      messageApi.settings({ suppressErrorMessage: true }),
    ]);
    if (disposed || seq !== loadSeq) return;
    list.value = nextList;
    settings.value = normalizeMessageSettings(nextSettings);
    msg.setNotices(list.value);
  } catch (error) {
    if (disposed || seq !== loadSeq) return;
    list.value = [];
    settings.value = null;
    pageError.value = normalizeMessageLoadError(error);
  } finally {
    if (!disposed && seq === loadSeq) loading.value = false;
  }
}

async function openNotification(item: any) {
  if (disposed) return;
  activeNotice.value = item;
  reviewTarget.value = null;
  detailOpen.value = true;
  const seq = ++reviewTargetSeq;
  const target = getReviewTargetFromNotice(item);
  if (!target || !auth.isMod) {
    reviewTargetLoading.value = false;
    return;
  }
  reviewTargetLoading.value = true;
  try {
    const nextTarget = await adminApi.reviewTarget(target.kind, target.id);
    if (disposed || seq !== reviewTargetSeq || activeNotice.value?.id !== item.id) return;
    reviewTarget.value = nextTarget;
  } catch {
    if (disposed || seq !== reviewTargetSeq || activeNotice.value?.id !== item.id) return;
    reviewTarget.value = null;
  } finally {
    if (!disposed && seq === reviewTargetSeq) reviewTargetLoading.value = false;
  }
}

const activeNoticeTargetLink = computed(() => resolveNoticeLink(activeNotice.value));
const canOpenActiveNoticeTarget = computed(() => Boolean(activeNoticeTargetLink.value));
const canRequestManualReviewFromNotice = computed(() => Boolean(
  auth.isLoggedIn &&
  !auth.user?.topicSubmissionLocked &&
  activeNotice.value?.payload?.type === "topic-ai-blocked" &&
  Number(activeNotice.value?.payload?.topicId) > 0
));

const canReviewActiveNotice = computed(() => {
  return Boolean(auth.isMod && reviewTarget.value?.reviewable);
});
const reviewActionLabel = computed(() => reviewTarget.value?.kind === "reply" ? "回复" : "帖子");
const reviewStateText = computed(() => {
  if (reviewTargetLoading.value) return "正在检查当前审核状态...";
  if (!reviewTarget.value) return "";
  return reviewTarget.value.reviewable
    ? `${reviewActionLabel.value}当前仍在待人工审核状态，可直接处理。`
    : `${reviewActionLabel.value}当前状态为「${reviewLabel(reviewTarget.value.aiReviewStatus)}」，不需要再次审核。`;
});

function goNoticeLink() {
  if (!activeNoticeTargetLink.value) return;
  detailOpen.value = false;
  router.push(activeNoticeTargetLink.value);
}

async function requestManualReviewFromNotice() {
  if (disposed) return;
  const topicId = Number(activeNotice.value?.payload?.topicId || 0);
  if (!topicId) return;
  requestingManualReview.value = true;
  try {
    await topicApi.requestManualReview(topicId);
    if (disposed) return;
    await auth.fetchMe();
    if (disposed) return;
    await refreshNoticeStateAfterAction();
    if (disposed) return;
    detailOpen.value = false;
    ElMessage.success("已提交人工复核申请");
  } finally {
    if (!disposed) requestingManualReview.value = false;
  }
}

async function approveFromNotice() {
  const target = reviewTarget.value;
  if (disposed || !target?.reviewable) return;
  reviewing.value = true;
  try {
    if (target.kind === "reply") {
      await adminApi.updateReply(target.id, {
        aiReviewStatus: "approved_manual",
        manualReviewNote: "管理员通过消息中心审核通过",
      });
    } else {
      await adminApi.updateTopic(target.id, {
        aiReviewStatus: "approved_manual",
        manualReviewNote: "管理员通过消息中心审核通过",
      });
    }
    if (disposed) return;
    ElMessage.success("已审核通过");
    detailOpen.value = false;
    await refreshNoticeStateAfterAction();
  } finally {
    if (!disposed) reviewing.value = false;
  }
}

async function rejectFromNotice() {
  const target = reviewTarget.value;
  if (disposed || !target?.reviewable || reviewing.value) return;
  reviewing.value = true;
  try {
    let value = "";
    try {
      ({ value } = await ElMessageBox.prompt("填写驳回说明（选填）", "人工驳回", {
        inputPlaceholder: "例如：存在明显人身攻击 / 泄露隐私信息",
      }));
    } catch {
      return;
    }
    if (disposed) return;
    if (target.kind === "reply") {
      await adminApi.updateReply(target.id, {
        aiReviewStatus: "rejected_manual",
        manualReviewNote: value || "管理员通过消息中心人工驳回",
      });
    } else {
      await adminApi.updateTopic(target.id, {
        aiReviewStatus: "rejected_manual",
        manualReviewNote: value || "管理员通过消息中心人工驳回",
      });
    }
    if (disposed) return;
    ElMessage.success("已驳回");
    detailOpen.value = false;
    await refreshNoticeStateAfterAction();
  } finally {
    if (!disposed) reviewing.value = false;
  }
}

function getReviewTargetFromNotice(item: any): { kind: "topic" | "reply"; id: number } | null {
  const type = item?.payload?.type;
  if (type === "topic-manual-review-admin" && item?.payload?.topicId) {
    return { kind: "topic", id: Number(item.payload.topicId) };
  }
  if (type === "reply-manual-review-admin" && item?.payload?.replyId) {
    return { kind: "reply", id: Number(item.payload.replyId) };
  }
  return null;
}

function reviewLabel(status?: string) {
  if (status === "manual_requested") return "申请人工审核";
  if (status === "manual_reviewing") return "人工审核中";
  if (status === "approved_manual") return "人工已通过";
  if (status === "rejected_manual") return "人工已驳回";
  if (status === "blocked_ai") return "AI 拦截";
  if (status === "auto_passed") return "自动通过";
  return "未审核";
}

function resolveNoticeLink(item: any) {
  if (item?.link) return String(item.link);
  const payload = item?.payload;
  const topicId = Number(payload?.topicId || 0);
  const replyId = Number(payload?.replyId || 0);
  if (topicId && replyId) return `/forum/topic/${topicId}#reply-${replyId}`;
  if (topicId) return `/forum/topic/${topicId}`;
  return "";
}

function formatNoticeTime(value?: string) {
  return fmtDate(value, "YYYY-MM-DD HH:mm");
}

function normalizeMessageTab(value: unknown) {
  const tabName = typeof value === "string" ? value : "all";
  return messageTabs.has(tabName) ? tabName : "all";
}

function normalizeMessageLoadError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status === 401) return "登录已过期，请重新登录";
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "消息加载失败";
  }
  return "消息加载失败，请稍后再试";
}

function normalizeMessageActionError(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
    || (error as { message?: string })?.message;
  return message || fallback;
}

function normalizeMessageSettings(value: any) {
  return {
    ...value,
    qqBotNotifyEnabled: value?.qqBotNotifyEnabled !== false,
    wechatNotifyEnabled: value?.wechatNotifyEnabled !== false,
  };
}
</script>

<style scoped>
:global(html.messages-private-scroll-lock),
:global(body.messages-private-scroll-lock) {
  overflow: hidden !important;
  overscroll-behavior: none;
}

.msg-page { display: flex; flex-direction: column; gap: 10px; }
.page-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.page-head-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.page-title { margin: 0; font-size: 22px; }
.page-sub {
  color: var(--cpu-text-secondary);
  font-size: 13px;
}
.settings-page-sub { display: none; }
.page-head-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
}
.mobile-message-modes,
.mobile-notice-filters {
  display: none;
}
.cpu-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}
.page-error {
  padding: 24px 16px;
}
.notice-detail { display: flex; flex-direction: column; gap: 12px; }
.notice-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.notice-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
.notice-title {
  margin: 0;
  font-size: 18px;
  line-height: 1.45;
  color: var(--cpu-text);
  overflow-wrap: anywhere;
}
.notice-meta {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.5;
  word-break: break-word;
}
.notice-content { margin: 0; color: var(--cpu-text-secondary); line-height: 1.75; white-space: pre-wrap; }
.review-state { font-size: 13px; color: #166534; background: #ecfdf5; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 12px; }
.review-state.done { color: var(--cpu-text-secondary); background: var(--cpu-surface-subtle); border-color: var(--cpu-border-soft); }
.notice-risk { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #92400e; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.34); border-radius: 8px; padding: 10px 12px; }
.notice-draft { border: 1px solid var(--cpu-border); border-radius: 8px; background: var(--cpu-surface-subtle); padding: 12px; }
.draft-title { font-size: 14px; font-weight: 600; color: var(--cpu-text); }
.draft-note { margin-top: 8px; font-size: 13px; color: var(--cpu-text-secondary); }

.settings h4 { margin: 8px 0 6px; color: var(--cpu-text); }
.hint { font-size: 12px; color: var(--cpu-text-secondary); margin: 0 0 10px; }
.qq-bind-guide {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 28%, var(--cpu-border-soft));
  border-radius: 10px;
  background: color-mix(in srgb, var(--cpu-primary) 8%, var(--cpu-card));
}
.private-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.private-tab-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  box-sizing: border-box;
}
.qq-bind-guide-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}
.qq-bind-guide-copy b {
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.4;
}
.qq-bind-guide-copy span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}
.qq-channel-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-card);
}
.wechat-channel-card { margin-bottom: 12px; }
.wechat-channel-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.wechat-subscribe-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, #07c160 28%, var(--cpu-border-soft));
  border-radius: 8px;
  background: color-mix(in srgb, #07c160 6%, var(--cpu-card));
}
.wechat-subscribe-card > div:first-child { display: grid; gap: 4px; }
.wechat-subscribe-card b { color: var(--cpu-text); font-size: 14px; }
.wechat-subscribe-card span,
.wechat-subscribe-card small { color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.5; }
.wechat-subscribe-button-host { min-height: 42px; }
.channel-qr-box {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-bg-soft);
}
.channel-qr-box > img,
.channel-qr-box > a > img {
  display: block;
  width: 116px;
  height: 116px;
  border-radius: 6px;
  background: #fff;
  object-fit: contain;
}
.channel-qr-box > div { display: grid; gap: 5px; min-width: 0; }
.channel-qr-box b { color: var(--cpu-text); font-size: 14px; }
.channel-qr-box span { color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.5; }
.channel-qr-link { color: var(--cpu-primary); font-size: 12px; text-decoration: none; }
.qq-channel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.qq-channel-head > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.qq-channel-head b {
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.35;
}
.qq-channel-head span,
.qq-channel-hint {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.55;
}
.qq-channel-hint {
  margin: 0;
}
.qq-channel-alert {
  margin-top: 2px;
}
.qq-channel-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.qq-channel-grid > div {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-soft);
}
.qq-channel-grid span {
  display: block;
  margin-bottom: 5px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}
.qq-channel-grid b {
  display: block;
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.qq-token-box {
  display: grid;
  gap: 5px;
  padding: 12px;
  border: 1px dashed rgba(20, 143, 123, 0.35);
  border-radius: 8px;
  background: rgba(20, 143, 123, 0.08);
}
.qq-token-box strong {
  color: var(--cpu-primary);
  font-size: 22px;
  line-height: 1.2;
  letter-spacing: 1px;
}
.qq-token-box span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.qq-channel-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.qq-channel-actions .el-button {
  margin-left: 0 !important;
}
.qq-channel-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-soft);
}
.qq-channel-toggle > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.qq-channel-toggle b {
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.35;
}
.qq-channel-toggle small {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.45;
}
.switches { display: flex; flex-direction: column; gap: 12px; }
.switch-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text);
  font-size: 14px;
}
.settings-action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 62px;
  padding: 12px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-card);
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease;
}
.settings-action-row:hover {
  border-color: rgba(20, 143, 123, 0.35);
  background: rgba(20, 143, 123, 0.08);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.05);
}
.settings-action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: rgba(20, 143, 123, 0.1);
  color: var(--cpu-primary);
}
.settings-action-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.settings-action-copy b {
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.35;
}
.settings-action-copy span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.settings-action-arrow {
  flex: 0 0 auto;
  color: var(--cpu-text-muted);
}
.save-btn {
  margin-top: 14px;
}

@media (max-width: 768px) {
  .qq-bind-guide {
    align-items: stretch;
    flex-direction: column;
  }

  .qq-bind-guide .el-button {
    width: 100%;
    margin-left: 0;
  }

  .msg-page {
    width: 100%;
    max-width: 860px;
    margin: 0 auto;
    gap: 13px;
  }

  .page-head {
    align-items: center;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--cpu-border-soft);
    border-radius: 15px;
    background: var(--cpu-card);
    box-shadow: var(--cpu-shadow-sm);
  }

  .page-title {
    font-size: 18px;
    line-height: 1.25;
  }

  .settings-page-sub { display: inline; }

  .page-head-main {
    min-width: 0;
    width: auto;
    flex: 1;
  }

  .page-head-actions {
    flex: 0 0 auto;
  }

  .page-head-actions .el-button {
    width: auto;
    margin-left: 0;
    padding-inline: 4px;
    font-size: 12px;
  }

  .cpu-card {
    border-radius: 15px;
    padding: 14px;
  }

  .messages-tabs {
    margin: 0;
    padding: 10px;
    min-width: 0;
    overflow: hidden;
    background: color-mix(in srgb, var(--cpu-surface-soft) 58%, var(--cpu-card));
  }

  .messages-tabs :deep(.el-tabs__header) {
    display: none;
  }

  .mobile-message-modes {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 5px;
    margin-top: 2px;
    padding: 4px;
    border: 1px solid var(--cpu-border-soft);
    border-radius: 11px;
    background: var(--cpu-surface-soft);
  }

  .mobile-message-modes button {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 52px;
    grid-template-columns: 24px minmax(0, 1fr);
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: 0;
    border-radius: 8px;
    background: var(--cpu-card);
    color: var(--cpu-text-secondary);
    text-align: left;
    cursor: pointer;
    box-shadow: 0 2px 7px rgba(15, 23, 42, .03);
    touch-action: manipulation;
  }

  .mobile-message-modes button.active {
    background: var(--cpu-primary);
    color: #fff;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--cpu-primary) 20%, transparent);
  }

  .mobile-message-modes button:focus-visible,
  .mobile-notice-filters button:focus-visible {
    outline: 2px solid var(--cpu-primary);
    outline-offset: 2px;
  }

  .mode-icon {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    font-size: 18px;
  }

  .mode-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1px;
  }

  .mode-copy b {
    color: inherit;
    font-size: 12px;
    line-height: 1.3;
  }

  .mode-copy small {
    overflow: hidden;
    color: inherit;
    font-size: 9px;
    line-height: 1.35;
    opacity: .72;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mode-count {
    position: absolute;
    top: 4px;
    right: 4px;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    display: grid;
    place-items: center;
    border: 2px solid var(--cpu-card);
    border-radius: 999px;
    background: #ef4444;
    color: #fff;
    font-size: 9px;
    font-weight: 750;
    line-height: 1;
    box-sizing: border-box;
  }

  .mobile-message-modes button.active .mode-count {
    border-color: var(--cpu-primary);
  }

  .mobile-notice-filters {
    display: flex;
    min-width: 0;
    gap: 5px;
    padding: 4px;
    border: 1px solid var(--cpu-border-soft);
    border-radius: 11px;
    background: var(--cpu-card);
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
    scroll-snap-type: inline proximity;
  }

  .mobile-notice-filters::-webkit-scrollbar {
    display: none;
  }

  .mobile-notice-filters button {
    display: inline-flex;
    min-width: max-content;
    min-height: 36px;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--cpu-text-secondary);
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
    scroll-snap-align: start;
    touch-action: manipulation;
  }

  .mobile-notice-filters button.active {
    background: var(--cpu-primary);
    color: #fff;
  }

  .mobile-notice-filters small {
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    background: color-mix(in srgb, var(--cpu-primary) 13%, var(--cpu-card));
    color: var(--cpu-primary);
    font-size: 9px;
    line-height: 1;
  }

  .mobile-notice-filters button.active small {
    background: rgba(255, 255, 255, .2);
    color: #fff;
  }

  .messages-tabs :deep(.el-tabs__content) {
    overflow: visible;
  }

  .switch-item {
    padding: 12px;
  }

  .qq-channel-head {
    align-items: flex-start;
  }

  .qq-channel-grid {
    grid-template-columns: 1fr;
  }

  .channel-qr-box { align-items: flex-start; }

  .settings-action-row {
    min-height: 0;
    padding: 12px;
  }

  .settings {
    display: flex;
    flex-direction: column;
  }

  .settings h4 {
    margin: 6px 2px 9px;
    font-size: 16px;
  }

  .settings :deep(.el-divider) {
    margin: 16px 0 10px;
  }

  .qq-channel-card,
  .switch-item,
  .settings-action-row {
    border-radius: 11px;
  }

  .qq-channel-card {
    background: var(--cpu-card);
    box-shadow: var(--cpu-shadow-sm);
  }

  .settings .el-button {
    width: 100%;
  }

  .notice-head {
    gap: 4px;
  }

  .notice-title {
    font-size: 17px;
  }

  :deep(.notice-dialog) {
    width: 100% !important;
    max-width: 100% !important;
    margin-top: 4dvh;
  }

  :deep(.notice-dialog .el-dialog) {
    border-radius: 16px;
    overflow: hidden;
  }

  :deep(.notice-dialog .el-dialog__header) {
    padding: 16px 16px 8px;
    margin-right: 0;
  }

  :deep(.notice-dialog .el-dialog__body) {
    padding: 10px 16px 12px;
  }

  :deep(.notice-dialog .el-dialog__footer) {
    padding: 0 16px 16px;
  }

  .notice-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 118px), 1fr));
    gap: 8px;
    width: 100%;
  }

  .notice-actions :deep(.el-button) {
    width: 100%;
    min-width: 0;
    margin-left: 0;
    padding-inline: 10px;
  }

  .notice-actions :deep(.el-button > span) {
    white-space: nowrap;
  }
}

@media (max-width: 720px) {
  .msg-page.is-private {
    height: calc(100dvh - 160px - env(safe-area-inset-bottom));
    min-height: 360px;
    gap: 8px;
    overflow: hidden;
  }

  .msg-page.is-private .page-head {
    display: flex;
    flex: 0 0 auto;
    padding: 8px;
    border-radius: 13px;
  }

  .msg-page.is-private .page-head-main,
  .msg-page.is-private .page-head-actions {
    display: none;
  }

  .msg-page.is-private .mobile-message-modes {
    margin-top: 0;
  }

  .messages-tabs.is-private {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    margin: 0;
    padding: 0;
    border-radius: 14px;
    overflow: hidden;
  }

  .messages-tabs.is-private :deep(.el-tabs__header) {
    display: none;
  }

  .messages-tabs.is-private :deep(.el-tabs__content),
  .messages-tabs.is-private :deep(.el-tab-pane) {
    min-height: 0;
    height: 100%;
  }

  .messages-tabs.is-private :deep(.el-tabs__content) {
    flex: 1;
    overflow: hidden;
  }

  :global(.layout-root.keyboard-open) .msg-page.is-private {
    height: calc(100dvh - 84px);
    min-height: 300px;
  }

  :global(.layout-root--native-shell) .msg-page.is-private {
    height: 100dvh;
  }
}

@media (max-width: 420px) {
  .page-head {
    padding: 12px;
  }

  .mobile-message-modes button {
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 4px;
    padding-inline: 6px;
  }

  .qq-channel-toggle,
  .switch-item,
  .qq-channel-actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .qq-channel-actions .el-button {
    width: 100%;
  }

  .channel-qr-box { flex-direction: column; }

  .settings-action-arrow {
    display: none;
  }
}
</style>
