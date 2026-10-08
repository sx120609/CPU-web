<template>
  <div class="me-m" v-loading="profileLoading && !user">
    <p v-if="profileLoadError" class="me-m-warning" role="status">
      <span>{{ profileLoadError }}</span>
      <button data-cpu-button="surface" type="button" :disabled="profileLoading" @click="loadProfilePage">重试</button>
    </p>

    <section class="me-m-card me-m-hero" :class="profileThemeClass" aria-labelledby="me-m-name">
      <div class="me-m-hero-main">
        <button
          data-cpu-button="media"
          type="button"
          class="me-m-avatar"
          aria-label="更换头像"
          :disabled="avatarSaving"
          @click="avatarSheetOpen = true"
        >
          <UserAvatar :size="64" :src="avatarDisplayUrl" :name="user?.nickname" :seed="user?.id" :profile-frame="user?.profileFrame" alt="用户头像" />
          <span class="me-m-avatar-badge" aria-hidden="true"><el-icon><Camera /></el-icon></span>
        </button>
        <div class="me-m-identity">
          <h1 id="me-m-name" class="me-m-name">
            <span class="name-primary">
              <DisplayNickname :name="user?.nickname || '药大同学'" />
              <UserVerificationBadge :verification="user?.verification" />
            </span>
          </h1>
          <p class="me-m-meta">{{ identityMetaText }}</p>
          <span v-if="identityTags.length" class="identity-tags">
            <em v-for="tag in identityTags" :key="tag.label" :class="`is-${tag.tone}`">{{ tag.label }}</em>
          </span>
        </div>
        <button data-cpu-button="surface" type="button" class="me-m-edit" :disabled="saving || logoutBusy" @click="editing = true">
          <el-icon aria-hidden="true"><EditPen /></el-icon>编辑
        </button>
      </div>

      <p class="me-m-bio">{{ user?.bio || "这个人很懒，什么都没写" }}</p>
      <p v-if="nicknameReviewText" class="me-m-note" :class="`is-${user?.nicknameReview?.status}`">{{ nicknameReviewText }}</p>
      <p v-if="user?.profileReview?.reason" class="me-m-note" :class="user.profileReview.status === 'rejected' ? 'is-rejected' : ''">{{ user.profileReview.reason }}</p>
      <p v-if="avatarPreviewFailed" class="me-m-note">
        头像已保存，预览暂时加载失败，无需重新上传。
        <button data-cpu-button="text" type="button" :disabled="avatarSaving" @click="retryAvatarPreview">重新加载头像</button>
      </p>

      <dl v-if="heroStats.length" class="me-m-stats" :style="{ '--count': heroStats.length }">
        <div v-for="stat in heroStats" :key="stat.label">
          <dt>{{ stat.label }}</dt>
          <dd :class="{ 'is-gold': stat.gold }">{{ stat.value }}</dd>
        </div>
      </dl>
    </section>

    <div v-if="assistantEntryVisible" class="me-m-card me-m-quota">
      <button data-cpu-button="surface" type="button" class="me-m-quota-open" aria-label="打开拾间 AI" @click="router.push('/search')">
        <span class="me-m-tile" style="--tone: #7c3aed" aria-hidden="true"><el-icon><MagicStick /></el-icon></span>
        <span class="me-m-quota-copy">
          <b>拾间 AI</b>
          <small v-if="assistantQuota"><template v-if="!auth.forumHidden">Lv.{{ assistantQuota.level }} {{ assistantQuota.levelName }} · </template>每日重置</small>
          <small v-else-if="assistantQuotaLoading">正在加载额度…</small>
          <small v-else>{{ assistantQuotaError || "暂时无法加载" }}</small>
        </span>
        <span v-if="assistantQuota" class="me-m-quota-stats">
          <span><b>{{ assistantQuota.remaining }}<small>/{{ assistantQuota.dailyQuota }}</small></b><small>今日额度</small></span>
          <span><b>{{ assistantQuota.points }}</b><small>AI 点数</small></span>
        </span>
        <el-icon class="me-m-arrow" aria-hidden="true"><ArrowRight /></el-icon>
      </button>
      <button
        v-if="!assistantQuota && !assistantQuotaLoading"
        data-cpu-button="surface"
        type="button"
        class="me-m-quota-retry"
        @click="loadAssistantQuota"
      >重试</button>
    </div>

    <section v-if="!commerceHidden" class="me-m-vip" :class="{ 'is-active': user?.vipActive }" aria-label="VIP">
      <button data-cpu-button="surface" type="button" class="me-m-vip-entry" @click="router.push('/vip')">
        <span class="me-m-vip-mark" aria-hidden="true"><el-icon><StarFilled /></el-icon></span>
        <span class="me-m-vip-copy">
          <b>VIP 中心</b>
          <small>{{ user?.vipActive ? "已开通，可设置主页主题和头像框" : "查看 VIP 权益" }}</small>
        </span>
        <el-icon class="me-m-arrow" aria-hidden="true"><ArrowRight /></el-icon>
      </button>
      <div v-if="user?.vipActive" class="me-m-vip-style">
        <span id="vip-style" class="me-m-anchor" aria-hidden="true" />
        <div class="me-m-vip-group">
          <span>主页主题</span>
          <div class="me-m-chips" role="radiogroup" aria-label="主页主题">
            <button
              v-for="item in vipThemeOptions"
              :key="item.value"
              data-cpu-button="surface"
              type="button"
              role="radio"
              :class="[`vip-theme-${item.value}`, { active: user?.profileTheme === item.value }]"
              :aria-checked="user?.profileTheme === item.value"
              :disabled="vipStyleSaving"
              @click="saveVipDecoration('profileTheme', item.value)"
            >{{ item.label }}</button>
          </div>
        </div>
        <div class="me-m-vip-group">
          <span>头像框</span>
          <div class="me-m-chips" role="radiogroup" aria-label="头像框">
            <button
              v-for="item in vipFrameOptions"
              :key="item.value"
              data-cpu-button="surface"
              type="button"
              role="radio"
              :class="[`vip-frame-${item.value}`, { active: user?.profileFrame === item.value }]"
              :aria-checked="user?.profileFrame === item.value"
              :disabled="vipStyleSaving"
              @click="saveVipDecoration('profileFrame', item.value)"
            >{{ item.label }}</button>
          </div>
        </div>
      </div>
    </section>

    <section class="me-m-section" aria-labelledby="me-m-account-title">
      <h2 id="me-m-account-title" class="me-m-section-title">账号与安全</h2>
      <div class="me-m-card me-m-list">
        <ProfileRowMobile :icon="Lock" title="账号与隐私" tone="#0f766e" @click="router.push('/profile/privacy')" />
        <ProfileRowMobile
          :icon="CircleCheck"
          title="拾间认证"
          tone="#0969da"
          :value="user?.verification?.label || '未认证'"
          :class="{ 'is-verified': user?.verification }"
          @click="router.push('/profile/verification')"
        />
        <ProfileRowMobile v-if="!user?.studentSso" :icon="Key" title="修改密码" tone="#64748b" @click="passwordDialog = true" />
        <ProfileRowMobile :icon="Bell" title="微信服务号通知" tone="#16a34a" :value="wechatBindingStateText" @click="openWechatBinding" />
        <ProfileRowMobile :icon="Message" title="消息中心" tone="#2563eb" :badge="messages.unreadCount || ''" @click="router.push('/messages')" />
      </div>
    </section>

    <section class="me-m-section" aria-labelledby="me-m-appearance-title">
      <h2 id="me-m-appearance-title" class="me-m-section-title">外观</h2>
      <div class="me-m-segmented" role="radiogroup" aria-label="外观模式">
        <button
          v-for="item in appearanceOptions"
          :key="item.value"
          data-cpu-button="option"
          type="button"
          role="radio"
          :class="{ active: appearance.mode === item.value }"
          :aria-checked="appearance.mode === item.value"
          @click="appearance.setMode(item.value)"
        >
          <el-icon aria-hidden="true"><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </button>
      </div>
    </section>

    <section v-if="user && !auth.forumHidden" class="me-m-section" aria-labelledby="me-m-community-title">
      <h2 id="me-m-community-title" class="me-m-section-title">社区</h2>
      <div class="me-m-card me-m-list">
        <ProfileRowMobile
          :icon="Medal"
          title="信誉与匿名"
          tone="#7c3aed"
          :description="`匿名状态 ${anonymousStatusText} · 本周 ${user.anonymousState?.weeklyQuota ?? 0} 点`"
          :value="`${user.reputation} 信誉值`"
          @click="trustSheetOpen = true"
        />
      </div>
    </section>

    <section v-if="sponsorVisible" class="me-m-section" aria-labelledby="me-m-sponsor-title">
      <span id="sponsor" class="me-m-anchor" aria-hidden="true" />
      <header class="me-m-section-head">
        <h2 id="me-m-sponsor-title" class="me-m-section-title">{{ sponsorOptions.title || "赞助本站" }}</h2>
        <router-link v-if="sponsorOptions.wallEnabled" to="/sponsor">计划与鸣谢<el-icon aria-hidden="true"><ArrowRight /></el-icon></router-link>
      </header>
      <div class="me-m-card me-m-sponsor">
        <div class="me-m-sponsor-summary">
          <div>
            <small>已赞助</small>
            <b>¥{{ formatMoney(user?.sponsorAmount) }}</b>
          </div>
          <el-button
            v-if="sponsorFormAvailable"
            :type="sponsorFormOpen ? 'default' : 'primary'"
            round
            :disabled="sponsorSubmitting"
            @click="sponsorFormOpen = !sponsorFormOpen"
          >{{ sponsorFormOpen ? "收起" : "去赞助" }}</el-button>
        </div>
        <p class="me-m-sponsor-copy">{{ sponsorOptions.description || "赞助会通过易支付完成，成功后金额会展示在你的个人资料里。" }}</p>
        <p v-if="sponsorOptions.assistantPointsPerYuan > 0" class="me-m-sponsor-copy is-accent">
          每赞助 ¥1 可获得 {{ sponsorOptions.assistantPointsPerYuan }} 个 AI 点数。
        </p>
        <p v-if="!site.features.sponsor" class="me-m-sponsor-closed">赞助入口当前已关闭，已完成的赞助金额仍会保留展示。</p>
        <p v-else-if="!sponsorOptions.enabled" class="me-m-sponsor-closed">赞助支付暂不可用，请稍后再试。</p>

        <div v-if="sponsorFormAvailable && sponsorFormOpen" class="me-m-sponsor-form">
          <div class="me-m-sponsor-categories" role="radiogroup" aria-label="赞助类别">
            <button
              v-for="category in sponsorOptions.categories"
              :key="category.id"
              data-cpu-button="surface"
              type="button"
              role="radio"
              class="me-m-sponsor-category"
              :class="{ active: sponsorCategoryId === category.id, ended: !category.accepting }"
              :aria-checked="sponsorCategoryId === category.id"
              :disabled="sponsorSubmitting || !category.accepting"
              @click="sponsorCategoryId = category.id"
            >
              <span class="me-m-sponsor-category-head">
                <b>{{ category.title }}</b>
                <em v-if="category.goalReached">已达成</em>
                <em v-else-if="category.featured">当前计划</em>
                <em v-else-if="!category.accepting">已结束</em>
              </span>
              <span v-if="category.description" class="me-m-sponsor-category-desc">{{ category.description }}</span>
              <span v-if="category.goalAmount" class="me-m-sponsor-progress" aria-hidden="true">
                <i :style="{ width: `${category.progressPercent ?? 0}%` }"></i>
              </span>
              <span class="me-m-sponsor-category-meta">
                <template v-if="category.goalAmount">已筹 ¥{{ category.raisedAmount }} / ¥{{ category.goalAmount }} · </template>
                {{ category.supporterCount }} 人支持
                <template v-if="category.deadline"> · 截止 {{ category.deadline }}</template>
              </span>
            </button>
          </div>

          <div class="me-m-amounts">
            <button
              v-for="amount in sponsorOptions.amounts"
              :key="amount"
              data-cpu-button="option"
              type="button"
              :class="{ active: sponsorAmount === String(amount) }"
              :disabled="sponsorSubmitting"
              @click="sponsorAmount = String(amount)"
            >¥{{ amount }}</button>
          </div>

          <div class="me-m-sponsor-pay">
            <el-input v-model="sponsorAmount" placeholder="自定义金额" maxlength="8" inputmode="decimal" :disabled="sponsorSubmitting">
              <template #prepend>¥</template>
            </el-input>
            <el-select v-model="sponsorPayType" :disabled="sponsorSubmitting" aria-label="支付方式">
              <el-option v-for="item in enabledPayTypes" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </div>
          <el-button type="primary" size="large" class="me-m-block-btn" :loading="sponsorSubmitting" :disabled="sponsorSubmitting" @click="openSponsorConfirm">去支付</el-button>
        </div>

        <div v-if="sponsorOrders.length" class="me-m-sponsor-history">
          <h3>我的赞助记录</h3>
          <div v-for="order in sponsorOrders" :key="order.outTradeNo" class="me-m-sponsor-order">
            <div>
              <b>{{ order.categoryTitle || "支持药大拾间" }}</b>
              <small>{{ payTypeLabels[order.payType as PayType] || order.payType }} · {{ fmtDate(order.paidAt || order.createdAt, "MM-DD HH:mm") }}</small>
            </div>
            <strong>¥{{ order.amount }}</strong>
          </div>
        </div>
      </div>
    </section>

    <section v-if="!auth.forumHidden" class="me-m-section" aria-labelledby="me-m-topics-title">
      <header class="me-m-section-head">
        <h2 id="me-m-topics-title" class="me-m-section-title">我发布的帖子</h2>
        <span v-if="myTopics.length">{{ myTopics.length }} 篇</span>
      </header>
      <div class="me-m-card me-m-topics">
        <el-skeleton v-if="!profileSnapshotReady" class="me-m-topics-loading" :rows="2" animated />
        <div v-else-if="!myTopics.length" class="me-m-topics-empty">
          <span>还没有发过帖子</span>
          <router-link v-if="auth.canAccessForum && site.features.forum" to="/post">去发帖</router-link>
        </div>
        <template v-else>
          <button
            v-for="t in myTopics"
            :key="t.id"
            data-cpu-button="surface"
            type="button"
            class="me-m-topic"
            @click="openMyTopic(t.id)"
          >
            <span class="me-m-topic-title">{{ t.title }}</span>
            <span class="me-m-topic-meta">
              <i :style="{ '--board': t.board?.color || '#168776' }">{{ t.board?.name }}</i>
              <em v-if="t.isAnonymous" class="is-anon">匿名</em>
              <em v-if="topicReviewLabel(t)" class="is-review">{{ topicReviewLabel(t) }}</em>
              <time>{{ fmtRelative(t.createdAt) }}</time>
            </span>
          </button>
        </template>
      </div>
    </section>

    <section class="me-m-section" aria-labelledby="me-m-more-title">
      <h2 id="me-m-more-title" class="me-m-section-title">更多</h2>
      <div class="me-m-card me-m-list">
        <ProfileRowMobile v-if="auth.canAccessModuleAdmin" :icon="Tools" title="管理后台" tone="#dc2626" @click="router.push('/admin')" />
        <ProfileRowMobile :icon="Coin" title="存储与缓存" tone="#0891b2" @click="router.push('/profile/storage')" />
        <ProfileRowMobile :icon="Download" title="客户端下载" tone="#2563eb" @click="router.push('/download')" />
        <ProfileRowMobile :icon="Medal" title="致谢" tone="#b45309" @click="router.push('/thanks')" />
      </div>
    </section>

    <footer class="me-m-foot">
      <el-button type="danger" plain size="large" class="me-m-block-btn" :loading="logoutBusy" :disabled="logoutBusy" @click="onLogout">退出登录</el-button>
      <p>{{ user?.studentSso ? "学号仅用于登录和身份校验，不会公开展示" : "登录账号仅自己可见，不会公开展示" }}</p>
      <p><a href="/privacy.html">隐私政策</a> · <a href="/terms.html">用户协议</a></p>
    </footer>

    <el-drawer v-model="avatarSheetOpen" direction="btt" size="auto" title="头像" class="me-m-sheet cpu-sheet-above-native-bar" append-to-body>
      <p class="me-m-sheet-copy">新头像会先提交审核，通过后公开显示。</p>
      <div class="me-m-sheet-actions">
        <el-button type="primary" size="large" :loading="avatarSaving" :disabled="avatarSaving" @click="chooseAvatar">上传头像</el-button>
        <el-button v-if="avatarPreviewFailed" size="large" plain :loading="avatarSaving" @click="retryAvatarPreview">重新加载头像</el-button>
        <el-button v-if="user?.avatar" size="large" type="danger" plain :loading="avatarSaving" :disabled="avatarSaving" @click="dropAvatar">移除头像</el-button>
      </div>
    </el-drawer>

    <el-drawer v-if="user && !auth.forumHidden" v-model="trustSheetOpen" direction="btt" size="auto" title="信誉与匿名" class="me-m-sheet cpu-sheet-above-native-bar" append-to-body>
      <div class="me-m-trust">
        <div class="me-m-trust-head">
          <div>
            <b v-if="user.reputationLevel">Lv.{{ user.reputationLevel.level }} {{ user.reputationLevel.name }}</b>
            <p>信誉值由注册时长、发帖数量、回复数量等因素共同决定，按周发放匿名积分。</p>
          </div>
          <strong>{{ user.reputation }}</strong>
        </div>
        <dl class="me-m-trust-grid">
          <div><dt>本周额度</dt><dd>{{ user.anonymousState?.weeklyQuota ?? 0 }}</dd></div>
          <div><dt>剩余积分</dt><dd>{{ user.anonymousState?.availableCredits ?? 0 }}</dd></div>
          <div><dt>状态</dt><dd>{{ anonymousStatusText }}</dd></div>
          <div><dt>下次刷新</dt><dd>{{ anonymousResetText }}</dd></div>
        </dl>
        <h3>得分详情</h3>
        <ul class="me-m-trust-rows">
          <li><span>注册时长贡献</span><b>{{ user.reputationBreakdown?.agePoints ?? 0 }}</b></li>
          <li><span>发帖贡献</span><b>{{ user.reputationBreakdown?.postPoints ?? 0 }}</b></li>
          <li><span>回复贡献</span><b>{{ user.reputationBreakdown?.replyPoints ?? 0 }}</b></li>
        </ul>
        <p v-if="user.anonymousState?.nextTier" class="me-m-trust-next">
          距离下一档匿名额度还差 {{ user.anonymousState.nextTier.need }} 点信誉值，达到后每周可得 {{ user.anonymousState.nextTier.weeklyQuota }} 点。
        </p>
        <p v-if="user.reputationLevel?.nextLevel" class="me-m-trust-next">
          距离下一信誉等级还差 {{ user.reputationLevel.nextLevel.need }} 点，达到后将升级为 Lv.{{ user.reputationLevel.nextLevel.level }} {{ user.reputationLevel.nextLevel.name }}。
        </p>
        <h3>支持匿名的板块</h3>
        <div class="me-m-trust-boards">
          <span v-for="board in anonymousBoards" :key="board.slug"><AppIcon :legacy="board.icon" name="forum" /> {{ board.name }}</span>
          <span v-if="!anonymousBoards.length" class="is-empty">当前还没有开放匿名的板块</span>
        </div>
      </div>
    </el-drawer>

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
      <div class="me-m-confirm">
        <div class="me-m-confirm-amount">
          <span>赞助金额</span>
          <b>¥{{ formatMoney(sponsorAmount) }}</b>
        </div>
        <div class="me-m-confirm-line">
          <span>赞助类别</span>
          <strong>{{ selectedSponsorCategory?.title || "支持药大拾间" }}</strong>
        </div>
        <div class="me-m-confirm-line">
          <span>支付方式</span>
          <strong>{{ payTypeLabels[sponsorPayType] || sponsorPayType }}</strong>
        </div>
        <span class="me-m-confirm-label">展示方式</span>
        <div class="me-m-segmented is-compact" role="radiogroup" aria-label="展示方式">
          <button
            v-for="item in sponsorDisplayOptions"
            :key="item.value"
            data-cpu-button="option"
            type="button"
            role="radio"
            :class="{ active: sponsorDisplayMode === item.value }"
            :aria-checked="sponsorDisplayMode === item.value"
            :disabled="sponsorSubmitting"
            @click="sponsorDisplayMode = item.value"
          >{{ item.label }}</button>
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

    <el-dialog v-model="editing" title="编辑资料" width="420" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving" modal-class="cpu-overlay-above-native-bar" append-to-body>
      <el-form label-position="top" :model="editForm">
        <el-form-item label="昵称（AI 异步审核）">
          <el-input v-model="editForm.nickname" maxlength="20" show-word-limit :disabled="saving" />
          <p class="me-m-field-help">修改后旧昵称继续显示，AI 审核通过后自动生效。</p>
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

    <el-dialog v-model="passwordDialog" title="修改密码" width="420" :close-on-click-modal="false" :close-on-press-escape="!savingPw" :show-close="!savingPw" modal-class="cpu-overlay-above-native-bar" append-to-body>
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
      class="me-m-file"
      type="file"
      accept="image/*"
      :disabled="avatarSaving"
      @change="onAvatarChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  ArrowRight,
  Bell,
  Camera,
  CircleCheck,
  Coin,
  Download,
  EditPen,
  Key,
  Lock,
  MagicStick,
  Medal,
  Message,
  StarFilled,
  Tools,
} from "@element-plus/icons-vue";
import type { PayType } from "@/api/payments";
import AppIcon from "@/components/common/AppIcon.vue";
import DisplayNickname from "@/components/common/DisplayNickname.vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import UserVerificationBadge from "@/components/common/UserVerificationBadge.vue";
import { useMessageStore } from "@/stores/message";
import { fmtDate, fmtRelative } from "@/utils/format";
import ProfileRowMobile from "./components/ProfileRowMobile.vue";
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
  route,
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
  sponsorVisible,
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
  wechatBindingStateText,
  passwordDialog,
  savingPw,
  pwForm,
  anonymousStatusText,
  anonymousResetText,
  profileThemeClass,
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
  pickAvatar,
  onAvatarChange,
  removeAvatar,
  retryAvatarPreview,
  openMyTopic,
} = useInjectedProfilePage();

const messages = useMessageStore();
const avatarSheetOpen = ref(false);
const trustSheetOpen = ref(false);
const sponsorFormOpen = ref(route.hash === "#sponsor" || Boolean(route.query.sponsorCategory));
const sponsorFormAvailable = computed(() => site.features.sponsor && sponsorOptions.enabled);

const identityMetaText = computed(() => {
  const college = user.value?.college || "院系未填写";
  return user.value?.enrollYear ? `${college} · ${user.value.enrollYear} 级` : college;
});

const identityTags = computed(() => {
  const current = user.value;
  if (!current) return [];
  const tags: Array<{ label: string; tone: "vip" | "admin" | "mod" | "level" }> = [];
  if (current.vipActive) tags.push({ label: "VIP", tone: "vip" });
  if (current.role === "admin") tags.push({ label: "管理员", tone: "admin" });
  else if (current.role === "mod" && !auth.forumHidden) tags.push({ label: "论坛管理员", tone: "mod" });
  if (current.reputationLevel && !auth.forumHidden) tags.push({ label: `Lv.${current.reputationLevel.level} ${current.reputationLevel.name}`, tone: "level" });
  return tags;
});

const heroStats = computed(() => {
  const current = user.value;
  if (!current) return [];
  const stats: Array<{ label: string; value: string | number; gold?: boolean }> = [];
  if (!auth.forumHidden) {
    stats.push({ label: "发帖", value: current.postCount ?? 0 });
    stats.push({ label: "回复", value: current.replyCount ?? 0 });
    stats.push({ label: "声望", value: current.reputation ?? 0 });
  }
  if (!commerceHidden && (current.sponsorAmount ?? 0) > 0) {
    stats.push({ label: "赞助", value: `¥${formatMoney(current.sponsorAmount)}`, gold: true });
  }
  return stats;
});

// 赞助墙与 VIP 中心通过锚点跳回本页；移动端在对应区块渲染后再滚动，并展开赞助表单。
let handledHash = "";
watch(
  [() => route.hash, sponsorVisible, () => Boolean(user.value?.vipActive)],
  async ([hash]) => {
    if (!hash || hash === handledHash) return;
    if (hash === "#sponsor") sponsorFormOpen.value = true;
    await nextTick();
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    handledHash = hash;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  },
  { immediate: true, flush: "post" },
);

watch(() => route.query.sponsorCategory, (category) => {
  if (category) sponsorFormOpen.value = true;
});

function chooseAvatar() {
  avatarSheetOpen.value = false;
  pickAvatar();
}

async function dropAvatar() {
  await removeAvatar();
  avatarSheetOpen.value = false;
}
</script>

<style scoped>
.me-m {
  --me-m-tile-fill: 11%;
  --me-m-tile-ink: 100%;
  display: flex;
  min-width: 0;
  max-width: 720px;
  min-height: 240px;
  margin: 0 auto;
  flex-direction: column;
  gap: 14px;
  color: var(--cpu-text);
}
.me-m button,
.me-m a { -webkit-tap-highlight-color: transparent; }
.me-m :is(button, a):focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }

.me-m-card {
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.me-m-list { overflow: hidden; }
.me-m-tile {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  background: color-mix(in srgb, var(--tone, var(--cpu-primary)) var(--me-m-tile-fill), var(--cpu-card));
  color: color-mix(in srgb, var(--tone, var(--cpu-primary)) var(--me-m-tile-ink), var(--cpu-text));
  font-size: var(--cpu-fs-xl);
}
.me-m-arrow { flex: 0 0 auto; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.me-m-block-btn { width: 100%; margin: 0 !important; }

.me-m-warning {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  padding: 8px 8px 8px 12px;
  border: 1px solid var(--cpu-accent-soft);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-accent-soft);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  line-height: 1.5;
}
.me-m-warning button,
.me-m-quota-retry,
.me-m-note button {
  border: 0;
  background: transparent;
  color: var(--cpu-primary);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.me-m-warning button { min-height: 30px; flex: 0 0 auto; padding: 0 10px; border-radius: var(--cpu-radius-m); }

/* 资料卡：VIP 主题只染卡片顶部，头像框由头像组件自己绘制。 */
.me-m-hero {
  --me-theme: var(--cpu-primary);
  padding: 16px 14px 12px;
  background: linear-gradient(165deg, color-mix(in srgb, var(--me-theme) 13%, var(--cpu-card)), var(--cpu-card) 62%);
}
.me-m-hero.profile-theme-mint { --me-theme: #10b981; }
.me-m-hero.profile-theme-sunset { --me-theme: #f97316; }
.me-m-hero.profile-theme-ocean { --me-theme: #3b82f6; }
.me-m-hero.profile-theme-lavender { --me-theme: #8b5cf6; }
.me-m-hero-main { display: flex; align-items: flex-start; gap: 12px; }
.me-m-avatar {
  position: relative;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}
.me-m-avatar :deep(.user-avatar) { font-size: var(--cpu-fs-xl); font-weight: 500; }
.me-m-avatar-badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 2px solid var(--cpu-card);
  border-radius: 50%;
  background: var(--cpu-primary);
  color: #fff;
  font-size: var(--cpu-fs-xs);
}
.me-m-identity { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; padding-top: 2px; }
.me-m-name { min-width: 0; margin: 0; font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.35; }
.name-primary { display: inline-flex; max-width: 100%; align-items: center; gap: 5px; }
.name-primary :deep(.display-nickname) { min-width: 0; overflow-wrap: anywhere; }
.me-m-meta { margin: 0; overflow: hidden; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); text-overflow: ellipsis; white-space: nowrap; }
.identity-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 3px; }
.identity-tags em {
  --tag: var(--cpu-primary);
  padding: 1px 7px;
  border-radius: var(--cpu-radius-pill);
  background: color-mix(in srgb, var(--tag) 13%, var(--cpu-card));
  color: color-mix(in srgb, var(--tag) 82%, var(--cpu-text));
  font-size: var(--cpu-fs-xs);
  font-style: normal;
  font-weight: 500;
  line-height: 18px;
}
.identity-tags em.is-vip { --tag: #d97706; letter-spacing: .06em; font-weight: 700; }
.identity-tags em.is-admin { --tag: var(--cpu-danger); }
.identity-tags em.is-mod { --tag: #2563eb; }
.identity-tags em.is-level { --tag: #7c3aed; }
.me-m-edit {
  display: inline-flex;
  min-height: 32px;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 0 11px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-card);
  color: var(--cpu-text);
  font: inherit;
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
  cursor: pointer;
}
.me-m-edit:active { background: var(--cpu-surface-soft); }
.me-m-bio { margin: 12px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.6; overflow-wrap: anywhere; }
.me-m-note { margin: 8px 0 0; padding: 7px 10px; border-radius: var(--cpu-radius-m); background: var(--cpu-primary-soft); color: var(--cpu-primary); font-size: var(--cpu-fs-xs); line-height: 1.55; }
.me-m-note.is-rejected,
.me-m-note.is-review_failed { background: var(--cpu-danger-soft); color: var(--cpu-danger); }
.me-m-note button { padding: 0 0 0 4px; font-size: var(--cpu-fs-xs); }

.me-m-stats {
  display: grid;
  grid-template-columns: repeat(var(--count), minmax(0, 1fr));
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--cpu-border-soft);
}
.me-m-stats > div { display: flex; min-width: 0; flex-direction: column-reverse; align-items: center; gap: 1px; }
.me-m-stats > div + div { border-left: 1px solid var(--cpu-border-soft); }
.me-m-stats dt { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.me-m-stats dd { margin: 0; overflow: hidden; color: var(--cpu-text); font-size: var(--cpu-fs-l); font-weight: 700; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
.me-m-stats dd.is-gold { color: var(--cpu-warn); }

.me-m-quota { display: flex; align-items: center; overflow: hidden; }
.me-m-quota-open {
  display: flex;
  min-width: 0;
  min-height: 62px;
  flex: 1;
  align-items: center;
  gap: 11px;
  padding: 10px 12px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.me-m-quota-open:active { background: var(--cpu-surface-soft); }
.me-m-quota-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.me-m-quota-copy b { font-size: var(--cpu-fs-m); font-weight: 500; }
.me-m-quota-copy small { overflow: hidden; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); text-overflow: ellipsis; white-space: nowrap; }
.me-m-quota-stats { display: flex; flex: 0 0 auto; gap: 14px; }
.me-m-quota-stats > span { display: flex; flex-direction: column; align-items: flex-end; }
.me-m-quota-stats b { color: var(--cpu-text); font-size: var(--cpu-fs-l); font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.2; }
.me-m-quota-stats > span:first-child b { color: var(--cpu-primary); }
.me-m-quota-stats b small { margin-left: 1px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); font-weight: 500; }
.me-m-quota-stats > span > small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.me-m-quota-retry { min-height: 44px; flex: 0 0 auto; padding: 0 14px; border-left: 1px solid var(--cpu-border-soft); }

.me-m-vip {
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-accent-soft);
  box-shadow: var(--cpu-shadow-sm);
}
.me-m-vip-entry {
  display: flex;
  width: 100%;
  min-height: 58px;
  align-items: center;
  gap: 11px;
  padding: 10px 12px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.me-m-vip-mark {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  background: linear-gradient(135deg, #fbbf24, #d97706);
  color: #fff;
  font-size: var(--cpu-fs-xl);
}
.me-m-vip-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.me-m-vip-copy b { color: var(--cpu-accent); font-size: var(--cpu-fs-m); font-weight: 700; }
.me-m-vip-copy small { overflow: hidden; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); text-overflow: ellipsis; white-space: nowrap; }
.me-m-vip-style { position: relative; display: flex; flex-direction: column; gap: 10px; padding: 11px 12px 13px; border-top: 1px dashed var(--cpu-border-soft); }
.me-m-vip-group { display: flex; align-items: center; gap: 10px; }
.me-m-vip-group > span { width: 52px; flex: 0 0 auto; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); }
.me-m-chips { display: flex; min-width: 0; flex-wrap: wrap; gap: 6px; }
.me-m-chips button {
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text);
  font: inherit;
  font-size: var(--cpu-fs-xs);
  cursor: pointer;
}
.me-m-chips button.active { border-color: var(--vip-theme-accent, #d97706); box-shadow: 0 0 0 2px var(--vip-theme-ring, rgba(217, 119, 6, .16)); font-weight: 700; }
.me-m-chips button:disabled { cursor: not-allowed; opacity: .62; }
.vip-theme-mint { --vip-theme-accent: #047857; --vip-theme-ring: rgba(4, 120, 87, .16); }
.vip-theme-sunset { --vip-theme-accent: #c2410c; --vip-theme-ring: rgba(194, 65, 12, .16); }
.vip-theme-ocean { --vip-theme-accent: #1d4ed8; --vip-theme-ring: rgba(29, 78, 216, .16); }
.vip-theme-lavender { --vip-theme-accent: #6d28d9; --vip-theme-ring: rgba(109, 40, 217, .16); }
.me-m-chips button[class*="vip-theme-"] {
  border-color: color-mix(in srgb, var(--vip-theme-accent) 30%, var(--cpu-card));
  background: color-mix(in srgb, var(--vip-theme-accent) 9%, var(--cpu-card));
  color: color-mix(in srgb, var(--vip-theme-accent) 88%, var(--cpu-text));
}
.vip-frame-gold { --vip-theme-accent: #d4a017; }
.vip-frame-neon { --vip-theme-accent: #8b5cf6; }
.vip-frame-campus { --vip-theme-accent: #168776; }

.me-m-section { position: relative; display: flex; min-width: 0; flex-direction: column; gap: 8px; }
/* 锚点上移到顶栏以下，路由的哈希滚动和页面内滚动都不会把区块标题压在顶栏下面。 */
.me-m-anchor { position: absolute; top: -76px; left: 0; width: 1px; height: 1px; pointer-events: none; }
.me-m-section-title { margin: 0; padding: 0 4px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); font-weight: 500; line-height: 1.4; }
.me-m-section-head { display: flex; min-height: 22px; align-items: center; justify-content: space-between; gap: 12px; padding-right: 2px; }
.me-m-section-head > span { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.me-m-section-head a {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 1px;
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
  text-decoration: none;
}
.me-m-list :deep(.is-verified .me-row-m-value) { color: #0969da; font-weight: 500; }

.me-m-segmented {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.me-m-segmented button {
  --cpu-button-radius: 10px;
  display: inline-flex;
  min-width: 0;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 4px;
  font: inherit;
  font-size: var(--cpu-fs-s);
  white-space: nowrap;
  cursor: pointer;
}
.me-m-segmented button.active { font-weight: 500; }
.me-m-segmented button:disabled { cursor: not-allowed; opacity: .62; }
.me-m-segmented.is-compact { border-radius: var(--cpu-radius-m); box-shadow: none; }
.me-m-segmented.is-compact button { --cpu-button-radius: 7px; min-height: 34px; font-size: var(--cpu-fs-xs); }

.me-m-sponsor { display: flex; flex-direction: column; gap: 6px; padding: 14px; }
.me-m-sponsor-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.me-m-sponsor-summary > div { display: flex; flex-direction: column; }
.me-m-sponsor-summary small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.me-m-sponsor-summary b { color: var(--cpu-primary); font-size: var(--cpu-fs-xl); font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.25; }
.me-m-sponsor-summary .el-button { min-width: 86px; margin: 0; }
.me-m-sponsor-copy { margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.me-m-sponsor-copy.is-accent { color: var(--cpu-text-secondary); }
.me-m-sponsor-closed { margin: 4px 0 0; padding: 8px 10px; border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.55; }

.me-m-sponsor-form { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; padding-top: 12px; border-top: 1px dashed var(--cpu-border-soft); }
.me-m-sponsor-categories { display: flex; flex-direction: column; gap: 8px; }
.me-m-sponsor-category {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  padding: 11px 12px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-surface);
  color: var(--cpu-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.me-m-sponsor-category.active {
  border-color: var(--cpu-primary);
  background: var(--cpu-primary-soft);
  box-shadow: inset 0 0 0 1px var(--cpu-primary-soft);
}
.me-m-sponsor-category.ended { cursor: not-allowed; opacity: .66; }
.me-m-sponsor-category:not(:disabled):active { background: var(--cpu-surface-soft); }
.me-m-sponsor-category-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.me-m-sponsor-category-head b { min-width: 0; font-size: var(--cpu-fs-m); font-weight: 500; line-height: 1.4; }
.me-m-sponsor-category-head em {
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xs);
  font-style: normal;
  font-weight: 700;
  line-height: 18px;
}
.me-m-sponsor-category-desc { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.55; }
.me-m-sponsor-category-meta { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.me-m-sponsor-progress { display: block; height: 5px; overflow: hidden; border-radius: var(--cpu-radius-pill); background: var(--cpu-border-soft); }
.me-m-sponsor-progress i { display: block; height: 100%; border-radius: inherit; background: var(--cpu-primary); }

.me-m-amounts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.me-m-amounts button {
  --cpu-button-radius: 10px;
  --cpu-button-fill: var(--cpu-surface-soft);
  --cpu-button-ink: var(--cpu-text);
  min-height: 40px;
  font: inherit;
  font-size: var(--cpu-fs-m);
  font-weight: 700;
  cursor: pointer;
}
.me-m-amounts button.active { --cpu-button-fill: var(--cpu-primary-soft); --cpu-button-ink: var(--cpu-button-primary); }
.me-m-amounts button:disabled { cursor: not-allowed; opacity: .62; }
.me-m-sponsor-pay { display: grid; grid-template-columns: minmax(0, 1fr) 112px; gap: 8px; }
.me-m-sponsor-pay :deep(.el-input__wrapper),
.me-m-sponsor-pay :deep(.el-input-group__prepend),
.me-m-sponsor-pay :deep(.el-select__wrapper) { min-height: 40px; }
/* 16px 以下 iOS 会在聚焦时放大页面 */
.me-m-sponsor-pay :deep(.el-input__inner) { font-size: var(--cpu-fs-l); }

.me-m-sponsor-history { margin-top: 8px; padding-top: 10px; border-top: 1px dashed var(--cpu-border-soft); }
.me-m-sponsor-history h3 { margin: 0 0 2px; font-size: var(--cpu-fs-s); font-weight: 500; }
.me-m-sponsor-order { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; }
.me-m-sponsor-order + .me-m-sponsor-order { border-top: 1px solid var(--cpu-border-soft); }
.me-m-sponsor-order > div { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
.me-m-sponsor-order b { overflow: hidden; font-size: var(--cpu-fs-s); font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.me-m-sponsor-order small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.me-m-sponsor-order strong { flex: 0 0 auto; color: var(--cpu-warn); font-size: var(--cpu-fs-m); font-variant-numeric: tabular-nums; }

.me-m-topics { overflow: hidden; }
.me-m-topics-loading { padding: 14px; }
.me-m-topics-empty { display: flex; min-height: 64px; align-items: center; justify-content: center; gap: 10px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.me-m-topics-empty a { color: var(--cpu-primary); font-weight: 500; text-decoration: none; }
.me-m-topic {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 6px;
  padding: 11px 13px;
  border: 0;
  border-bottom: 1px solid var(--cpu-border-soft);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.me-m-topic:last-child { border-bottom: 0; }
.me-m-topic:active { background: var(--cpu-surface-soft); }
.me-m-topic-title {
  display: -webkit-box;
  overflow: hidden;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.me-m-topic-meta { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.me-m-topic-meta i {
  padding: 0 6px;
  border-radius: var(--cpu-radius-s);
  background: color-mix(in srgb, var(--board) 14%, var(--cpu-card));
  color: color-mix(in srgb, var(--board) 85%, var(--cpu-text));
  font-style: normal;
  font-weight: 500;
  line-height: 18px;
}
.me-m-topic-meta em { font-style: normal; font-weight: 500; }
.me-m-topic-meta em.is-anon { color: var(--cpu-text-secondary); }
.me-m-topic-meta em.is-review { padding: 0 6px; border-radius: var(--cpu-radius-pill); background: var(--cpu-accent-soft); color: var(--cpu-accent); line-height: 18px; }
.me-m-topic-meta time { margin-left: auto; }

.me-m-foot { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px 0 8px; }
.me-m-foot .el-button { margin-bottom: 6px !important; border-radius: var(--cpu-radius-l); }
.me-m-foot p { margin: 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.6; text-align: center; }
.me-m-foot a { color: var(--cpu-text-secondary); text-decoration: none; }

.me-m-file { display: none; }

:global(.me-m-sheet.el-drawer) { height: auto !important; max-height: min(92dvh, 640px); border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom); }
:global(.me-m-sheet .el-drawer__header) { margin-bottom: 0; }
:global(.me-m-sheet .el-drawer__body) { padding-top: 12px; }
.me-m-sheet-copy { margin: 0 0 14px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.6; }
.me-m-sheet-actions { display: flex; flex-direction: column; gap: 8px; }
.me-m-sheet-actions .el-button { width: 100%; margin: 0; }

.me-m-trust { display: flex; flex-direction: column; gap: 10px; padding-bottom: 6px; }
.me-m-trust-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.me-m-trust-head b { font-size: var(--cpu-fs-m); font-weight: 700; }
.me-m-trust-head p { margin: 3px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.me-m-trust-head strong {
  min-width: 64px;
  flex: 0 0 auto;
  padding: 8px 12px;
  border-radius: var(--cpu-radius-l);
  background: linear-gradient(135deg, #4c1d95, #7c3aed);
  color: #fff;
  font-size: var(--cpu-fs-xl);
  font-weight: 700;
  text-align: center;
}
.me-m-trust-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 0; }
.me-m-trust-grid > div { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 6px; padding: 9px 11px; border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); }
.me-m-trust-grid dt { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); white-space: nowrap; }
.me-m-trust-grid dd { min-width: 0; margin: 0; overflow: hidden; font-size: var(--cpu-fs-m); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.me-m-trust h3 { margin: 4px 0 0; font-size: var(--cpu-fs-s); font-weight: 500; }
.me-m-trust-rows { margin: 0; padding: 0; list-style: none; }
.me-m-trust-rows li { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px dashed var(--cpu-border-soft); font-size: var(--cpu-fs-s); }
.me-m-trust-rows li span { color: var(--cpu-text-secondary); }
.me-m-trust-next { margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 1.6; }
.me-m-trust-boards { display: flex; flex-wrap: wrap; gap: 6px; }
.me-m-trust-boards span {
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  gap: 4px;
  padding: 0 9px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
}
.me-m-trust-boards span.is-empty { border: 0; padding: 0; color: var(--cpu-text-muted); }

.me-m-confirm { display: flex; flex-direction: column; gap: 10px; }
.me-m-confirm-amount { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); }
.me-m-confirm-amount span,
.me-m-confirm-line span,
.me-m-confirm-label { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.me-m-confirm-amount b { color: var(--cpu-primary); font-size: var(--cpu-fs-xl); }
.me-m-confirm-line { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.me-m-confirm-line strong { min-width: 0; overflow: hidden; color: var(--cpu-text); text-overflow: ellipsis; white-space: nowrap; }
.me-m-field-help { width: 100%; margin: 6px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); line-height: 1.5; }

:global(html[data-theme="dark"] .me-m) {
  --me-m-tile-fill: 20%;
  --me-m-tile-ink: 46%;
}
:global(html[data-theme="dark"] .me-m-vip-copy b) { color: #fcd34d; }

@media (max-width: 360px) {
  .me-m-quota-stats { gap: 10px; }
  .me-m-quota-stats b { font-size: var(--cpu-fs-m); }
  .me-m-amounts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
