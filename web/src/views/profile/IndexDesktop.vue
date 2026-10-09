<template>
  <div class="profile" v-loading="profileLoading && !user">
    <div v-if="profileLoadError" class="cpu-card profile-load-error">
      <el-empty :description="profileLoadError">
        <el-button type="primary" :loading="profileLoading" @click="loadProfilePage">重试</el-button>
      </el-empty>
    </div>

    <div class="profile-layout">
    <aside class="profile-side">
    <div class="cpu-card profile-card" :class="[profileThemeClass, profileFrameClass]">
      <UserAvatar :size="80" class="avatar" :src="avatarDisplayUrl" :name="user?.nickname" :seed="user?.id" :profile-frame="user?.profileFrame" alt="用户头像" />
      <div class="avatar-actions cpu-button-row">
        <el-button size="small" plain :loading="avatarSaving" :disabled="avatarSaving" @click="pickAvatar">上传头像</el-button>
        <el-button v-if="user?.avatar" size="small" text :loading="avatarSaving" :disabled="avatarSaving" @click="removeAvatar">移除头像</el-button>
        <el-button v-if="avatarPreviewFailed" size="small" plain :loading="avatarSaving" @click="retryAvatarPreview">重新加载头像</el-button>
      </div>
      <p v-if="avatarPreviewFailed" class="avatar-preview-note">头像已保存，预览暂时加载失败，无需重新上传。</p>
      <h3 class="name">
        <span class="name-primary">
          <DisplayNickname :name="user?.nickname || '药大同学'" />
          <UserVerificationBadge :verification="user?.verification" />
        </span>
        <span class="identity-tags">
          <el-tag v-if="user?.vipActive" class="vip-tag" type="warning" effect="dark">VIP</el-tag>
          <el-tag v-if="user?.role === 'admin'" size="small" type="danger">管理员</el-tag>
          <el-tag v-else-if="user?.role === 'mod' && !auth.forumHidden" size="small">论坛管理员</el-tag>
          <el-tag v-if="user?.reputationLevel && !auth.forumHidden" size="small" type="warning" effect="plain">
            Lv.{{ user.reputationLevel.level }} {{ user.reputationLevel.name }}
          </el-tag>
        </span>
      </h3>
      <p class="account-note">{{ user?.studentSso ? "学号仅用于登录和身份校验，不会公开展示" : "登录账号仅自己可见，不会公开展示" }}</p>
      <p v-if="nicknameReviewText" class="nickname-review-note" :class="`is-${user?.nicknameReview?.status}`">{{ nicknameReviewText }}</p>
      <el-alert v-if="user?.profileReview?.reason" :title="user.profileReview.reason" :type="user.profileReview.status === 'rejected' ? 'warning' : 'info'" :closable="false" />
      <p v-if="user?.verification" class="verification-copy">拾间认证：{{ user.verification.label }}</p>
      <p class="bio">{{ user?.bio || "这个人很懒，什么都没写" }}</p>
      <ul class="kv">
        <li><span>院系</span><span>{{ user?.college || "—" }}</span></li>
        <li><span>入学</span><span>{{ user?.enrollYear || "—" }}</span></li>
        <li v-if="!auth.forumHidden"><span>发帖</span><span>{{ user?.postCount }}</span></li>
        <li v-if="!auth.forumHidden"><span>回复</span><span>{{ user?.replyCount }}</span></li>
        <li v-if="!auth.forumHidden"><span>声望</span><span>{{ user?.reputation }}</span></li>
        <li v-if="!commerceHidden && (user?.sponsorAmount ?? 0) > 0"><span>赞助</span><span class="sponsor-total">¥{{ formatMoney(user?.sponsorAmount) }}</span></li>
      </ul>
      <div class="profile-actions cpu-button-row">
        <el-button type="primary" plain :disabled="saving || logoutBusy" @click="editing = true">编辑资料</el-button>
        <el-button plain @click="router.push('/profile/privacy')">账号与隐私</el-button>
        <el-button plain @click="router.push('/profile/storage')">存储与缓存</el-button>
        <el-button v-if="!inWechat" plain @click="wechatFollowOpen = true">关注服务号</el-button>
        <el-button plain :disabled="saving || logoutBusy" @click="router.push('/profile/verification')">拾间认证</el-button>
        <el-button v-if="!commerceHidden" type="warning" plain :disabled="saving || logoutBusy" @click="router.push('/vip')">VIP 中心</el-button>
        <el-button v-if="!user?.studentSso" plain :disabled="savingPw || logoutBusy" @click="passwordDialog = true">修改密码</el-button>
        <el-button type="danger" plain :loading="logoutBusy" :disabled="logoutBusy" @click="onLogout">退出登录</el-button>
      </div>
      <p class="profile-legal"><a href="/privacy.html">隐私政策</a><span aria-hidden="true">·</span><a href="/terms.html">用户协议</a><span aria-hidden="true">·</span><a href="https://status.cputime.cn" target="_blank" rel="noopener noreferrer">服务状态</a></p>
    </div>
    </aside>

    <div class="profile-main">

    <div v-if="user?.vipActive" id="vip-style" class="cpu-card vip-style-card">
      <div>
        <h3 class="cpu-section-title">VIP 个性化资料</h3>
        <p class="vip-style-copy">选择个人主页主题和头像框，论坛里也会同步展示你的 VIP 身份。</p>
      </div>
      <div class="vip-style-group">
        <span class="vip-style-label">主页主题</span>
        <div class="vip-style-options">
          <button data-cpu-button="media"
            v-for="item in vipThemeOptions"
            :key="item.value"
            type="button"
            class="vip-style-option"
            :class="[`vip-theme-${item.value}`, { active: user?.profileTheme === item.value }]"
            :aria-pressed="user?.profileTheme === item.value"
            :disabled="vipStyleSaving"
            @click="saveVipDecoration('profileTheme', item.value)"
          >{{ item.label }}</button>
        </div>
      </div>
      <div class="vip-style-group">
        <span class="vip-style-label">头像框</span>
        <div class="vip-style-options">
          <button data-cpu-button="media"
            v-for="item in vipFrameOptions"
            :key="item.value"
            type="button"
            class="vip-style-option"
            :class="[{ active: user?.profileFrame === item.value }, `vip-frame-${item.value}`]"
            :aria-pressed="user?.profileFrame === item.value"
            :disabled="vipStyleSaving"
            @click="saveVipDecoration('profileFrame', item.value)"
          >{{ item.label }}</button>
        </div>
      </div>
    </div>

    <div class="cpu-card appearance-card">
      <div class="appearance-copy">
        <h3 class="cpu-section-title">外观偏好</h3>
        <p>当前为{{ appearance.modeLabel }}，{{ appearance.isDark ? "正在使用深色界面。" : "正在使用浅色界面。" }}</p>
      </div>
      <div class="appearance-options" role="radiogroup" aria-label="外观模式">
        <button data-cpu-button="option"
          v-for="item in appearanceOptions"
          :key="item.value"
          type="button"
          :class="{ active: appearance.mode === item.value }"
          :aria-checked="appearance.mode === item.value"
          role="radio"
          @click="appearance.setMode(item.value)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </button>
      </div>
    </div>

    <div class="cpu-card wechat-bind-card">
      <div>
        <h3 class="cpu-section-title">绑定微信服务号</h3>
        <p>绑定后可通过微信接收已开启的站内通知。</p>
        <strong>{{ wechatBindingStateText }}</strong>
      </div>
      <div class="wechat-bind-actions cpu-button-row">
        <el-button type="primary" @click="openWechatBinding">
          <el-icon><Bell /></el-icon>
          {{ wechatProfile?.binding ? "管理微信通知" : "去绑定微信" }}
        </el-button>
        <el-button plain :loading="wechatProfileLoading" @click="refreshWechatBinding">刷新状态</el-button>
      </div>
    </div>

    <div v-if="assistantEntryVisible" class="cpu-card assistant-quota-card">
      <div class="assistant-quota-title">
        <div>
          <h3 class="cpu-section-title">拾间 AI 额度</h3>
          <p v-if="assistantQuota"><template v-if="!auth.forumHidden">Lv.{{ assistantQuota.level }} {{ assistantQuota.levelName }} · </template>每日重置</p>
          <p v-else>今日对话额度与 AI 点数</p>
        </div>
      </div>

      <el-skeleton v-if="assistantQuotaLoading && !assistantQuota" class="assistant-quota-loading" :rows="0" animated />
      <div v-else-if="assistantQuota" class="assistant-quota-stats">
        <div class="assistant-quota-stat assistant-quota-stat--primary">
          <span>今日额度</span>
          <b>{{ assistantQuota.remaining }}<small>/{{ assistantQuota.dailyQuota }}</small></b>
        </div>
        <div class="assistant-quota-stat">
          <span>AI 点数</span>
          <b>{{ assistantQuota.points }}</b>
        </div>
      </div>
      <div v-else class="assistant-quota-error">
        <span>{{ assistantQuotaError || "暂时无法加载" }}</span>
        <el-button text type="primary" :loading="assistantQuotaLoading" @click="loadAssistantQuota">重试</el-button>
      </div>

      <el-button class="assistant-quota-open" text type="primary" aria-label="打开拾间 AI" @click="router.push('/search')">
        <span class="assistant-quota-open-label">打开</span>
        <el-icon><ArrowRight /></el-icon>
      </el-button>
    </div>

    <div id="sponsor" v-if="!commerceHidden && (site.features.sponsor || (user?.sponsorAmount ?? 0) > 0)" class="cpu-card sponsor-card">
      <div class="sponsor-main">
        <div class="sponsor-copy">
          <h3 class="cpu-section-title">{{ sponsorOptions.title || "赞助本站" }}</h3>
          <p>{{ sponsorOptions.description || "赞助会通过易支付完成，成功后金额会展示在你的个人资料里。" }}</p>
          <p v-if="sponsorOptions.assistantPointsPerYuan > 0" class="sponsor-points-hint">
            每赞助 ¥1 可获得 {{ sponsorOptions.assistantPointsPerYuan }} 个 AI 点数。
          </p>
          <strong>已赞助 ¥{{ formatMoney(user?.sponsorAmount) }}</strong>
          <div class="sponsor-actions">
            <el-button v-if="sponsorOptions.wallEnabled" plain @click="router.push('/sponsor')">查看计划与鸣谢</el-button>
          </div>
        </div>

        <div class="sponsor-panel">
          <template v-if="site.features.sponsor">
            <div v-if="sponsorOptions.enabled" class="sponsor-form">
              <div class="sponsor-category-grid" role="radiogroup" aria-label="赞助类别">
                <button data-cpu-button="option"
                  v-for="category in sponsorOptions.categories"
                  :key="category.id"
                  type="button"
                  class="sponsor-category"
                  :class="{ active: sponsorCategoryId === category.id, ended: !category.accepting }"
                  role="radio"
                  :aria-checked="sponsorCategoryId === category.id"
                  :disabled="sponsorSubmitting || !category.accepting"
                  @click="sponsorCategoryId = category.id"
                >
                  <span class="sponsor-category-head">
                    <b>{{ category.title }}</b>
                    <em v-if="category.goalReached">已达成</em>
                    <em v-else-if="category.featured">当前计划</em>
                    <em v-else-if="!category.accepting">已结束</em>
                  </span>
                  <span class="sponsor-category-desc">{{ category.description }}</span>
                  <template v-if="category.goalAmount">
                    <span class="sponsor-category-progress-copy">
                      已筹 ¥{{ category.raisedAmount }} / ¥{{ category.goalAmount }}
                    </span>
                    <span class="sponsor-category-progress" aria-hidden="true">
                      <i :style="{ width: `${category.progressPercent ?? 0}%` }"></i>
                    </span>
                  </template>
                  <span class="sponsor-category-meta">
                    {{ category.supporterCount }} 人支持
                    <template v-if="category.deadline"> · 截止 {{ category.deadline }}</template>
                  </span>
                </button>
              </div>

              <div class="amount-grid">
                <button data-cpu-button="option"
                  v-for="amount in sponsorOptions.amounts"
                  :key="amount"
                  type="button"
                  :class="{ active: sponsorAmount === String(amount) }"
                  :disabled="sponsorSubmitting"
                  @click="sponsorAmount = String(amount)"
                >
                  ¥{{ amount }}
                </button>
              </div>

              <div class="sponsor-pay-row">
                <el-input v-model="sponsorAmount" placeholder="自定义金额" maxlength="8" class="sponsor-money-input" :disabled="sponsorSubmitting">
                  <template #prepend>¥</template>
                </el-input>
                <el-select v-model="sponsorPayType" class="sponsor-pay-select" :disabled="sponsorSubmitting">
                  <el-option v-for="item in enabledPayTypes" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
                <el-button class="sponsor-submit-btn" type="primary" :loading="sponsorSubmitting" :disabled="sponsorSubmitting" @click="openSponsorConfirm">去支付</el-button>
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
            <span>{{ order.categoryTitle || "支持药大拾间" }} · {{ payTypeLabels[order.payType as PayType] || order.payType }} · 已支付</span>
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
      modal-class="cpu-overlay-above-native-bar"
      append-to-body
      :close-on-click-modal="!sponsorSubmitting"
      :close-on-press-escape="!sponsorSubmitting"
      :show-close="!sponsorSubmitting"
    >
      <div class="sponsor-confirm">
        <div class="sponsor-confirm-summary">
          <span>赞助金额</span>
          <b>¥{{ formatMoney(sponsorAmount) }}</b>
        </div>
        <div class="sponsor-confirm-line">
          <span>赞助类别</span>
          <strong>{{ selectedSponsorCategory?.title || "支持药大拾间" }}</strong>
        </div>
        <div class="sponsor-confirm-line">
          <span>支付方式</span>
          <strong>{{ payTypeLabels[sponsorPayType] || sponsorPayType }}</strong>
        </div>
        <div class="sponsor-confirm-field">
          <span>展示方式</span>
          <div class="sponsor-display-tabs" role="radiogroup" aria-label="展示方式">
            <button data-cpu-button="option"
              v-for="item in sponsorDisplayOptions"
              :key="item.value"
              type="button"
              :class="{ active: sponsorDisplayMode === item.value }"
              role="radio"
              :aria-checked="sponsorDisplayMode === item.value"
              :disabled="sponsorSubmitting"
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
          :disabled="sponsorSubmitting"
        />
      </div>
      <template #footer>
        <el-button :disabled="sponsorSubmitting" @click="sponsorConfirmOpen = false">取消</el-button>
        <el-button type="primary" :loading="sponsorSubmitting" :disabled="sponsorSubmitting" @click="submitSponsor">确认并支付</el-button>
      </template>
    </el-dialog>

    <div class="cpu-card trust-card" v-if="user && !auth.forumHidden">
      <div class="trust-head">
        <div class="trust-copy">
          <h3 class="cpu-section-title">信誉与匿名</h3>
          <p class="trust-sub">信誉值由注册时长、发帖数量、回复数量等因素共同决定，按周发放匿名积分。</p>
          <div class="trust-inline-summary">
            <span v-if="user.reputationLevel">Lv.{{ user.reputationLevel.level }} {{ user.reputationLevel.name }}</span>
            <span>状态 {{ anonymousStatusText }}</span>
            <span>本周 {{ user.anonymousState?.weeklyQuota ?? 0 }} 点</span>
          </div>
        </div>
        <div class="trust-score">{{ user.reputation }}</div>
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

      <div class="trust-section">
        <div class="trust-section-head">
          <div>
            <div class="trust-section-title">得分详情</div>
            <p class="trust-section-tip">需要时再展开查看各项贡献和升级进度。</p>
          </div>
          <el-button text type="primary" @click="trustDetailsOpen = !trustDetailsOpen">
            {{ trustDetailsOpen ? "收起" : "点击展开" }}
          </el-button>
        </div>
        <div v-if="trustDetailsOpen" class="trust-section-body">
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
          </div>

          <div class="trust-progress-list">
            <p v-if="user.anonymousState?.nextTier" class="trust-next">
              距离下一档匿名额度还差 {{ user.anonymousState.nextTier.need }} 点信誉值，达到后每周可得 {{ user.anonymousState.nextTier.weeklyQuota }} 点。
            </p>
            <p v-if="user.reputationLevel?.nextLevel" class="trust-next">
              距离下一信誉等级还差 {{ user.reputationLevel.nextLevel.need }} 点，达到后将升级为 Lv.{{ user.reputationLevel.nextLevel.level }} {{ user.reputationLevel.nextLevel.name }}。
            </p>
          </div>
        </div>
      </div>

      <div class="trust-section">
        <div class="trust-section-head">
          <div>
            <div class="trust-section-title">支持匿名的板块</div>
            <p class="trust-section-tip">{{ anonymousBoards.length }} 个板块支持匿名发帖或回复。</p>
          </div>
          <el-button text type="primary" @click="anonymousBoardsOpen = !anonymousBoardsOpen">
            {{ anonymousBoardsOpen ? "收起" : "点击展开" }}
          </el-button>
        </div>
        <div v-if="anonymousBoardsOpen" class="trust-section-body">
          <div class="anonymous-board-tags">
            <el-tag v-for="board in anonymousBoards" :key="board.slug" effect="plain">
              <AppIcon :legacy="board.icon" name="forum" /> {{ board.name }}
            </el-tag>
            <span v-if="!anonymousBoards.length" class="cpu-muted">当前还没有开放匿名的板块</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!auth.forumHidden" class="cpu-card">
      <h3 class="cpu-section-title">我发布的帖子</h3>
      <el-skeleton v-if="!profileSnapshotReady" :rows="2" animated />
      <el-empty v-else-if="!myTopics.length" description="还没有发过帖子" />
      <template v-else>
        <div
          v-for="t in myTopics"
          :key="t.id"
          class="topic-line"
          role="button"
          tabindex="0"
          @click="openMyTopic(t.id)"
          @keydown.enter.prevent="openMyTopic(t.id)"
          @keydown.space.prevent="openMyTopic(t.id)"
        >
          <span class="tag" :style="{ background: t.board?.color || '#168776' }">{{ t.board?.name }}</span>
          <span v-if="t.isAnonymous" class="anon-tag">匿名</span>
          <span v-if="topicReviewLabel(t)" class="review-tag">{{ topicReviewLabel(t) }}</span>
          <span class="title">{{ t.title }}</span>
          <span class="meta">{{ fmtRelative(t.createdAt) }}</span>
        </div>
      </template>
    </div>
    </div>
    </div>

    <el-dialog v-model="editing" title="编辑资料" width="420" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving" modal-class="cpu-overlay-above-native-bar">
      <el-form label-position="top" :model="editForm">
        <el-form-item label="昵称（AI 异步审核）">
          <el-input v-model="editForm.nickname" maxlength="20" show-word-limit :disabled="saving" />
          <p class="field-help">修改后旧昵称继续显示，AI 审核通过后自动生效。</p>
        </el-form-item>
        <el-form-item label="一句话签名">
          <el-input v-model="editForm.bio" type="textarea" :rows="3" maxlength="120" show-word-limit :disabled="saving" />
        </el-form-item>
        <el-form-item label="院系">
          <el-input v-model="editForm.college" maxlength="40" :disabled="saving" />
        </el-form-item>
        <el-form-item label="入学年份">
          <el-input-number v-model="editForm.enrollYear" :min="2010" :max="2030" style="width:100%" :disabled="saving" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="editing = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="passwordDialog" title="修改密码" width="420" :close-on-click-modal="false" :close-on-press-escape="!savingPw" :show-close="!savingPw" modal-class="cpu-overlay-above-native-bar">
      <el-form label-position="top" :model="pwForm" @keyup.enter="savePassword">
        <el-form-item label="原密码" required>
          <el-input v-model="pwForm.oldPassword" type="password" show-password autocomplete="current-password" :disabled="savingPw" />
        </el-form-item>
        <el-form-item label="新密码（至少 6 位）" required>
          <el-input v-model="pwForm.newPassword" type="password" show-password autocomplete="new-password" maxlength="64" :disabled="savingPw" />
        </el-form-item>
        <el-form-item label="再次输入新密码" required>
          <el-input v-model="pwForm.confirm" type="password" show-password autocomplete="new-password" maxlength="64" :disabled="savingPw" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="savingPw" @click="passwordDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingPw" :disabled="savingPw" @click="savePassword">保存</el-button>
      </template>
    </el-dialog>

    <input
      ref="avatarInputRef"
      class="hidden-file-input"
      type="file"
      accept="image/*"
      :disabled="avatarSaving"
      @change="onAvatarChange"
    />

    <WechatFollowDialog v-model="wechatFollowOpen" />
  </div>
</template>

<script setup lang="ts">
import { ArrowRight, Bell } from "@element-plus/icons-vue";
import type { PayType } from "@/api/payments";
import UserAvatar from "@/components/common/UserAvatar.vue";
import AppIcon from "@/components/common/AppIcon.vue";
import DisplayNickname from "@/components/common/DisplayNickname.vue";
import UserVerificationBadge from "@/components/common/UserVerificationBadge.vue";
import { fmtDate, fmtRelative } from "@/utils/format";
import { isWechatBrowser } from "@/utils/wechatBridge";
import WechatFollowDialog from "./components/WechatFollowDialog.vue";
import {
  appearanceOptions,
  formatMoney,
  payTypeLabels,
  sponsorDisplayOptions,
  topicReviewLabel,
  useInjectedProfilePage,
  vipFrameOptions,
  vipThemeOptions,
} from "./profilePage";

const {
  commerceHidden,
  auth,
  site,
  appearance,
  router,
  user,
  assistantEntryVisible,
  myTopics,
  anonymousBoards,
  editing,
  editForm,
  saving,
  logoutBusy,
  avatarSaving,
  avatarPreviewFailed,
  avatarDisplayUrl,
  avatarInputRef,
  vipStyleSaving,
  trustDetailsOpen,
  anonymousBoardsOpen,
  sponsorOptions,
  sponsorSubmitting,
  sponsorAmount,
  sponsorPayType,
  sponsorCategoryId,
  sponsorMessage,
  sponsorDisplayMode,
  sponsorConfirmOpen,
  sponsorOrders,
  enabledPayTypes,
  selectedSponsorCategory,
  profileLoading,
  profileLoadError,
  profileSnapshotReady,
  assistantQuota,
  assistantQuotaLoading,
  assistantQuotaError,
  wechatProfile,
  wechatProfileLoading,
  wechatBindingStateText,
  passwordDialog,
  savingPw,
  pwForm,
  anonymousStatusText,
  anonymousResetText,
  profileThemeClass,
  profileFrameClass,
  nicknameReviewText,
  loadProfilePage,
  loadAssistantQuota,
  saveEdit,
  saveVipDecoration,
  openSponsorConfirm,
  submitSponsor,
  savePassword,
  onLogout,
  openWechatBinding,
  refreshWechatBinding,
  pickAvatar,
  onAvatarChange,
  removeAvatar,
  retryAvatarPreview,
  openMyTopic,
} = useInjectedProfilePage();
const wechatFollowOpen = ref(false);
const inWechat = isWechatBrowser();
</script>

<style scoped>
.profile { display: flex; max-width: 1180px; margin: 0 auto; flex-direction: column; gap: 16px; }
/* 左侧固定个人卡片，右侧是各项设置。 */
.profile-layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); align-items: start; gap: 20px; }
.profile-side { position: sticky; top: 88px; min-width: 0; }
.profile-main { display: flex; min-width: 0; flex-direction: column; gap: 16px; }
.cpu-card { background: var(--cpu-card); border-radius: var(--cpu-radius-l); padding: 20px 24px; }
.profile-legal { display: flex; justify-content: center; gap: 8px; margin: 14px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.profile-legal a { color: var(--cpu-text-secondary); text-decoration: none; }
.profile-legal a:hover { color: var(--cpu-primary); }
@media (max-width: 1000px) {
  .profile-layout { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .profile-side { position: static; }
}

.profile-card { padding: 24px 20px 18px; text-align: center; }
.profile-card.profile-theme-mint { background: linear-gradient(135deg, #ecfdf5, #ffffff); }
.profile-card.profile-theme-sunset { background: linear-gradient(135deg, #fff7ed, #ffffff); }
.profile-card.profile-theme-ocean { background: linear-gradient(135deg, #eff6ff, #ffffff); }
.profile-card.profile-theme-lavender { background: linear-gradient(135deg, #f5f3ff, #ffffff); }
:global(html[data-theme="dark"] .profile-card.profile-theme-mint) { background: linear-gradient(135deg, rgba(16, 185, 129, .18), var(--cpu-card) 72%); }
:global(html[data-theme="dark"] .profile-card.profile-theme-sunset) { background: linear-gradient(135deg, rgba(249, 115, 22, .16), var(--cpu-card) 72%); }
:global(html[data-theme="dark"] .profile-card.profile-theme-ocean) { background: linear-gradient(135deg, rgba(59, 130, 246, .18), var(--cpu-card) 72%); }
:global(html[data-theme="dark"] .profile-card.profile-theme-lavender) { background: linear-gradient(135deg, rgba(139, 92, 246, .18), var(--cpu-card) 72%); }
.profile-card.profile-frame-gold { border: 2px solid #f5c451; }
.profile-card.profile-frame-neon { border: 2px solid #8b5cf6; box-shadow: 0 0 18px rgba(139, 92, 246, .24); }
.profile-card.profile-frame-campus { border: 2px solid var(--cpu-primary); }
.profile-load-error {
  padding: 12px 18px;
}
.profile-load-error :deep(.el-empty) { padding: 4px 0; }
.profile-load-error :deep(.el-empty__image) { display: none; }
.profile-load-error :deep(.el-empty__description) { margin-top: 0; }
.avatar { font-size: 28px; font-weight: 500; }
.avatar-preview-note { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); }
.avatar-actions {
  margin-top: 10px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.name {
  min-width: 0;
  margin: 12px 0 4px;
  font-size: var(--cpu-fs-xl);
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.name-primary,
.identity-tags {
  min-width: 0;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
}
.name-primary :deep(.display-nickname) { min-width: 0; overflow-wrap: anywhere; }
.vip-tag { letter-spacing: .08em; font-weight: 700; }
.account-note { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); margin: 0 0 8px; }
.nickname-review-note { max-width: 560px; margin: -2px auto 8px; color: var(--cpu-primary); font-size: var(--cpu-fs-xs); line-height: 1.55; }
.nickname-review-note.is-rejected, .nickname-review-note.is-review_failed { color: var(--el-color-danger); }
.field-help { width: 100%; margin: 6px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.5; }
.verification-copy { margin: -2px 0 8px; color: #0969da; font-size: var(--cpu-fs-xs); font-weight: 500; }
.bio { font-size: var(--cpu-fs-s); color: var(--cpu-text-secondary); margin: 0 0 16px; }

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
  font-size: var(--cpu-fs-s);
  border-bottom: 1px dashed var(--cpu-border-soft);
}
.kv li:last-child { border-bottom: none; }
.kv li span:first-child { color: var(--cpu-text-secondary); }
.kv li span:last-child { color: var(--cpu-text); font-weight: 500; }
.sponsor-total { color: var(--cpu-warn) !important; }

.profile-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.profile-actions .el-button { min-width: 0; margin-left: 0 !important; }
.profile-actions .el-button:first-child:nth-last-child(odd) { grid-column: 1 / -1; }

.vip-style-card { display: flex; flex-direction: column; gap: 14px; }
.vip-style-copy { margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.vip-style-group { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.vip-style-label { min-width: 70px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.vip-style-options { display: flex; gap: 8px; flex-wrap: wrap; }
.vip-style-option { border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-pill); padding: 7px 13px; background: var(--cpu-surface-soft); color: var(--cpu-text); cursor: pointer; font: inherit; font-size: var(--cpu-fs-xs); }
.vip-style-option.active { border-color: var(--vip-theme-accent, var(--cpu-gold)); box-shadow: 0 0 0 2px var(--vip-theme-ring, rgba(245, 158, 11, .16)); font-weight: 700; }
.vip-theme-mint { --vip-theme-accent: #047857; --vip-theme-ring: rgba(4, 120, 87, .16); border-color: var(--cpu-primary-soft); background: var(--cpu-primary-soft); color: var(--cpu-primary); }
.vip-theme-sunset { --vip-theme-accent: #c2410c; --vip-theme-ring: rgba(194, 65, 12, .16); border-color: var(--cpu-accent-soft); background: var(--cpu-accent-soft); color: var(--cpu-accent); }
.vip-theme-ocean { --vip-theme-accent: #1d4ed8; --vip-theme-ring: rgba(29, 78, 216, .16); border-color: var(--cpu-border-soft); background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); }
.vip-theme-lavender { --vip-theme-accent: #6d28d9; --vip-theme-ring: rgba(109, 40, 217, .16); border-color: var(--cpu-border-soft); background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); }
:global(html[data-theme="dark"] .vip-theme-mint) { --vip-theme-accent: #6ee7b7; --vip-theme-ring: rgba(110, 231, 183, .2); border-color: rgba(52, 211, 153, .42); background: rgba(16, 185, 129, .16); color: #6ee7b7; }
:global(html[data-theme="dark"] .vip-theme-sunset) { --vip-theme-accent: #fdba74; --vip-theme-ring: rgba(253, 186, 116, .2); border-color: rgba(251, 146, 60, .44); background: rgba(249, 115, 22, .16); color: #fdba74; }
:global(html[data-theme="dark"] .vip-theme-ocean) { --vip-theme-accent: #93c5fd; --vip-theme-ring: rgba(147, 197, 253, .2); border-color: rgba(96, 165, 250, .44); background: rgba(59, 130, 246, .16); color: #93c5fd; }
:global(html[data-theme="dark"] .vip-theme-lavender) { --vip-theme-accent: #c4b5fd; --vip-theme-ring: rgba(196, 181, 253, .2); border-color: rgba(167, 139, 250, .44); background: rgba(139, 92, 246, .16); color: #c4b5fd; }
.vip-frame-gold { border-color: #f5c451; }
.vip-frame-neon { border-color: #8b5cf6; }
.vip-frame-campus { border-color: var(--cpu-primary); }

.assistant-quota-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "title open"
    "stats stats";
  align-items: center;
  gap: 12px 16px;
}
.assistant-quota-title {
  grid-area: title;
  min-width: 0;
}
.assistant-quota-title .cpu-section-title {
  margin: 0;
}
.assistant-quota-title p {
  margin: 3px 0 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
}
.assistant-quota-stats {
  grid-area: stats;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid var(--cpu-border-soft);
}
.assistant-quota-stat {
  min-width: 82px;
  padding: 0 13px 0 0;
  text-align: left;
}
.assistant-quota-stat + .assistant-quota-stat {
  padding-left: 18px;
  border-left: 1px solid var(--cpu-border-soft);
}
.assistant-quota-stat span {
  display: block;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  line-height: 1.2;
}
.assistant-quota-stat b {
  display: block;
  margin-top: 2px;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-l);
  line-height: 1.15;
}
.assistant-quota-stat--primary b {
  color: var(--cpu-primary);
}
.assistant-quota-stat b small {
  margin-left: 2px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
}
.assistant-quota-open {
  grid-area: open;
  min-width: 58px;
  margin: 0 !important;
}
.assistant-quota-open :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.assistant-quota-loading {
  grid-area: stats;
  width: 176px;
}
.assistant-quota-error {
  grid-area: stats;
  display: flex;
  min-width: 150px;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
}

.appearance-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.appearance-copy {
  min-width: 0;
}
.appearance-copy p {
  margin: 4px 0 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.6;
}
.appearance-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  min-width: min(360px, 100%);
  padding: 4px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface-soft);
}
.appearance-options button {
  display: inline-flex;
  min-width: 0;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: var(--cpu-radius-m);
  background: transparent;
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: var(--cpu-fs-s);
  font-weight: 500;
}
.appearance-options button.active {
  color: #05201c;
  background: var(--cpu-primary);
}
.appearance-options button:not(.active):hover {
  color: var(--cpu-primary);
  background: rgba(20, 143, 123, 0.1);
}

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
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.6;
}
.sponsor-copy strong {
  display: block;
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xl);
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
.sponsor-category-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.sponsor-category {
  appearance: none;
  min-width: 0;
  padding: 13px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-surface);
  color: var(--cpu-text);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}
.sponsor-category:not(:disabled):hover {
  border-color: var(--cpu-primary);
  transform: translateY(-1px);
}
.sponsor-category.active {
  border-color: var(--cpu-primary);
  background: var(--cpu-primary-soft);
  box-shadow: inset 0 0 0 1px var(--cpu-primary-soft);
}
.sponsor-category.ended {
  opacity: 0.66;
  cursor: not-allowed;
}
.sponsor-category-head,
.sponsor-category-meta,
.sponsor-category-progress-copy,
.sponsor-category-desc {
  display: block;
}
.sponsor-category-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.sponsor-category-head b {
  min-width: 0;
  font-size: var(--cpu-fs-m);
  line-height: 1.4;
}
.sponsor-category-head em {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xs);
  font-style: normal;
  font-weight: 700;
}
.sponsor-category-desc {
  min-height: 38px;
  margin-top: 6px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  line-height: 1.55;
}
.sponsor-category-progress-copy,
.sponsor-category-meta {
  margin-top: 8px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}
.sponsor-category-progress {
  display: block;
  height: 5px;
  margin-top: 5px;
  overflow: hidden;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-border-soft);
}
.sponsor-category-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--cpu-primary);
}
.amount-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.amount-grid button {
  height: 38px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-surface);
  color: var(--cpu-text);
  font-weight: 700;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}
.amount-grid button:not(:disabled):hover {
  border-color: var(--cpu-primary);
  color: var(--cpu-primary);
}
.amount-grid button:disabled,
.sponsor-display-tabs button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}
.amount-grid button.active {
  border-color: var(--cpu-primary);
  background: rgba(20, 143, 123, 0.12);
  color: var(--cpu-primary);
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
  background: var(--cpu-surface);
  min-height: 40px;
}
.sponsor-history {
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px dashed var(--cpu-border-soft);
}
.sub-title {
  font-size: var(--cpu-fs-s);
  font-weight: 700;
  color: var(--cpu-text);
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
  color: var(--cpu-warn);
}
.sponsor-order-row span {
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
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
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-surface-soft);
  border: 1px solid var(--cpu-border-soft);
}
.sponsor-confirm-summary span,
.sponsor-confirm-line span,
.sponsor-confirm-field > span {
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}
.sponsor-confirm-summary b {
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xl);
}
.sponsor-confirm-line strong {
  color: var(--cpu-text);
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
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-surface);
}
.sponsor-display-tabs button {
  appearance: none;
  min-width: 0;
  width: 100%;
  height: 36px;
  padding: 0 8px;
  border: 0;
  border-right: 1px solid var(--cpu-border);
  background: var(--cpu-surface);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.sponsor-display-tabs button:last-child {
  border-right: 0;
}
.sponsor-display-tabs button.active {
  background: var(--cpu-primary);
  color: #05201c;
}
.sponsor-display-tabs button:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid rgba(22, 135, 118, 0.35);
  outline-offset: -2px;
}
.sponsor-display-tabs button:disabled {
  background: var(--cpu-surface-soft);
}
.sponsor-display-tabs button.active:disabled {
  background: var(--cpu-primary);
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

.trust-copy {
  flex: 1;
  min-width: 0;
}

.trust-sub {
  margin: 4px 0 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.6;
}

.trust-inline-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.trust-inline-summary span {
  padding: 5px 10px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  line-height: 1;
}

.trust-score {
  min-width: 72px;
  text-align: center;
  padding: 10px 14px;
  border-radius: var(--cpu-radius-l);
  background: linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%);
  color: #fff;
  font-size: var(--cpu-fs-xl);
  font-weight: 700;
}

.trust-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.trust-item {
  padding: 12px 14px;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface-soft);
}

.trust-item span {
  display: block;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  margin-bottom: 6px;
}

.trust-item b {
  color: var(--cpu-text);
  font-size: var(--cpu-fs-l);
}

.trust-section {
  padding: 14px;
  border-radius: var(--cpu-radius-l);
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-soft);
}

.trust-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.trust-section-title {
  color: var(--cpu-text);
  font-size: var(--cpu-fs-m);
  font-weight: 500;
}

.trust-section-tip {
  margin: 4px 0 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  line-height: 1.6;
}

.trust-section-body {
  margin-top: 12px;
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
  border-bottom: 1px dashed var(--cpu-border-soft);
  font-size: var(--cpu-fs-s);
}

.trust-row span {
  color: var(--cpu-text-secondary);
}

.trust-row b {
  color: var(--cpu-text);
}

.trust-next {
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.6;
}

.trust-progress-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.anonymous-board-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wechat-bind-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.wechat-bind-card p {
  margin: 4px 0 8px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.6;
}
.wechat-bind-card strong {
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xl);
  letter-spacing: 0;
}
.wechat-bind-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.wechat-bind-actions .el-button {
  margin-left: 0 !important;
}

.topic-line {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px dashed var(--cpu-border-soft);
  cursor: pointer;
  border-radius: var(--cpu-radius-s);
  min-width: 0;
  overflow: hidden;
}
.topic-line:last-child { border-bottom: none; }
.topic-line:hover { background: var(--cpu-surface-soft); }
.topic-line:focus-visible {
  outline: 2px solid rgba(22, 135, 118, 0.35);
  outline-offset: 2px;
  background: var(--cpu-surface-soft);
}
.tag { color: #fff; font-size: var(--cpu-fs-xs); padding: 2px 6px; border-radius: var(--cpu-radius-s); flex-shrink: 0; }
.anon-tag { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); font-weight: 500; }
.review-tag { color: var(--cpu-accent); background: var(--cpu-accent-soft); border: 1px solid var(--cpu-accent-soft); border-radius: var(--cpu-radius-pill); padding: 2px 7px; font-size: var(--cpu-fs-xs); font-weight: 500; flex-shrink: 0; }
.title { font-size: var(--cpu-fs-m); flex: 1; min-width: 0; overflow-wrap: anywhere; }
.meta { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); flex-shrink: 0; }

.cpu-section-title { font-size: var(--cpu-fs-l); font-weight: 500; margin: 0 0 12px; }
.hidden-file-input { display: none; }
</style>
