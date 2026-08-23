<template>
  <div v-if="loading && !topic" class="topic-page topic-page-loading" aria-busy="true">
    <article class="cpu-card topic-skeleton-card">
      <el-skeleton animated>
        <template #template>
          <div class="topic-skeleton-head">
            <el-skeleton-item variant="text" class="topic-skeleton-back" />
            <div class="topic-skeleton-actions">
              <el-skeleton-item variant="button" />
              <el-skeleton-item variant="button" />
            </div>
          </div>
          <el-skeleton-item variant="h1" class="topic-skeleton-title" />
          <div class="topic-skeleton-meta">
            <el-skeleton-item variant="circle" class="topic-skeleton-avatar" />
            <div class="topic-skeleton-meta-copy">
              <el-skeleton-item variant="text" class="topic-skeleton-author" />
              <el-skeleton-item variant="text" class="topic-skeleton-submeta" />
            </div>
          </div>
          <div class="topic-skeleton-body">
            <el-skeleton-item v-for="index in 5" :key="index" variant="text" class="topic-skeleton-line" />
          </div>
        </template>
      </el-skeleton>
    </article>

    <section class="cpu-card topic-skeleton-card">
      <el-skeleton animated :rows="4" />
    </section>
  </div>

  <div v-else-if="topic" class="topic-page">
    <!-- 主帖 -->
    <article class="cpu-card main-post">
      <header class="post-head">
        <button type="button" class="board-back board-back-btn" @click="goBackFromTopic">
          <el-icon><ArrowLeft /></el-icon> {{ backLabel }}
        </button>
        <div class="actions">
          <el-button v-if="canEdit" text :disabled="isTopicActionBusy" @click="onEdit">编辑</el-button>
          <el-button v-if="canPin && !isReadOnly" text :loading="topicActionBusy === 'pin'" :disabled="isTopicActionBusy" @click="onPin">{{ topic.pinned ? '取消板块置顶' : '板块置顶' }}</el-button>
          <el-button v-if="canPin && !isReadOnly" text :loading="topicActionBusy === 'globalPin'" :disabled="isTopicActionBusy" @click="onGlobalPin">{{ topic.globalPinned ? '取消全局置顶' : '全局置顶' }}</el-button>
          <el-button v-if="canPin" text :loading="topicActionBusy === 'lock'" :disabled="isTopicActionBusy" @click="onLock">{{ topic.locked ? '解锁' : '锁帖' }}</el-button>
          <el-button v-if="canEdit" text type="danger" :loading="topicActionBusy === 'delete'" :disabled="isTopicActionBusy" @click="onDelete">删除</el-button>
        </div>
      </header>

      <h1 class="post-title">
        <span v-if="topic.globalPinned" class="badge global-pin">全局置顶</span>
        <span v-if="topic.pinned" class="badge pin">板块置顶</span>
        <span v-if="topic.locked" class="badge lock">🔒</span>
        {{ displayTopicTitle }}
      </h1>
      <div v-if="topic.tags?.length" class="topic-tags">
        <el-tag
          v-for="tag in topic.tags.slice(0, 2)"
          :key="tag.name"
          size="small"
          effect="plain"
          type="warning"
        >
          {{ tag.name }}
        </el-tag>
      </div>

      <div class="post-meta">
        <UserAvatar :size="36" class="avatar" :src="topic.author?.avatar" :name="topic.author?.nickname" :profile-frame="topic.author?.profileFrame" alt="作者头像" />
        <div class="meta-author">
          <div class="name">
            <span v-if="topic.author?.vipActive" class="vip-badge">VIP</span>
            <router-link v-if="topic.author?.id" :to="`/u/${topic.author.id}`">{{ topic.author?.nickname }}</router-link>
            <span v-else>{{ topic.author?.nickname }}</span>
            <el-tag v-if="topic.isAnonymous" size="small" type="warning" effect="plain">匿名发布</el-tag>
            <el-tag v-else-if="topic.author?.role === 'bot'" size="small" type="warning">公告同步</el-tag>
            <el-tag v-else-if="topic.author?.role === 'admin'" size="small" type="danger">管理员</el-tag>
            <UserModerationActions
              v-if="topicModerationUser"
              :user="topicModerationUser"
              display="dropdown"
              text
              label="管理"
              @updated="applyTopicAuthorModeration"
            />
          </div>
          <div v-if="topic.isAnonymous && topic.realAuthor" class="real-author-line">
            真实作者：{{ topic.realAuthor.nickname }}<template v-if="topic.realAuthor.username"> @{{ topic.realAuthor.username }}</template>
          </div>
          <div class="meta">
            发表于 {{ fmtDate(topic.createdAt) }}
            <template v-if="topic.editCount && topic.editCount > 0"> · 已编辑 {{ topic.editCount }} 次</template>
            · 热度 {{ hotScore }} · 浏览 {{ topic.viewCount }} · 回复 {{ topic.replyCount }}
          </div>
        </div>
        <div v-if="metaPrice !== undefined" class="meta-price">¥ {{ metaPrice }}</div>
      </div>

      <!-- 板块特化 metadata -->
      <div v-if="topic.metadata?.sourceUrl" class="source-bar" :class="{ wechat: topic.metadata?.externalType === 'wechat', external: topic.metadata?.externalType !== 'wechat' }">
        <span class="src-icon">{{ topic.metadata?.externalType === 'wechat' ? '💬' : '📢' }}</span>
        <span class="src-text-wrap">
          <span class="src-text">
            <template v-if="topic.metadata?.externalType === 'wechat'">
              原文发布于 <b>微信公众号</b> · {{ fmtDate(topic.metadata.publishedAt, 'YYYY-MM-DD') }}
            </template>
            <template v-else>
              来自 <b>{{ topic.metadata.sourceName || boardDisplayName }}</b>
              · 发布于 {{ fmtDate(topic.metadata.publishedAt, 'YYYY-MM-DD') }}
            </template>
          </span>
          <span v-if="sourceNotice" class="src-notice">{{ sourceNotice }}</span>
        </span>
        <a :href="topic.metadata.sourceUrl" target="_blank" rel="noopener noreferrer" class="src-link">
          <el-icon><Link /></el-icon>
          {{ topic.metadata?.externalType === 'wechat' ? '前往微信阅读全文' : '在学校原站查看' }}
        </a>
      </div>
      <div v-if="topic.metadata?.ratings" class="extra-bar ratings">
        <span>难度 <el-rate :model-value="topic.metadata.ratings.difficulty" disabled size="small" /></span>
        <span>收获 <el-rate :model-value="topic.metadata.ratings.reward" disabled size="small" /></span>
        <span>推荐 <el-rate :model-value="topic.metadata.ratings.recommend" disabled size="small" /></span>
        <span>给分 <el-rate :model-value="topic.metadata.ratings.givingScore" disabled size="small" /></span>
      </div>
      <div v-if="topic.metadata?.condition || topic.metadata?.tradeMode" class="extra-bar">
        <span v-if="topic.metadata.condition">📦 {{ topic.metadata.condition }}</span>
        <span v-if="topic.metadata.tradeMode">🤝 {{ topic.metadata.tradeMode }}</span>
      </div>

      <div v-if="topic.imageReview?.pendingCount" class="image-review-tip image-review-tip-pending">
        <span>正文中有 {{ topic.imageReview.pendingCount }} 张图片正在审核，审核通过后会自动显示。</span>
        <el-button v-if="canReviewTopicImages" link type="warning" @click="openTopicImageReviewDialog">手动复核图片</el-button>
      </div>
      <div v-else-if="topic.imageReview?.rejectedCount" class="image-review-tip image-review-tip-rejected">
        <span>正文中有 {{ topic.imageReview.rejectedCount }} 张图片未通过审核，当前已隐藏。</span>
        <el-button v-if="canReviewTopicImages" link type="danger" @click="openTopicImageReviewDialog">手动复核图片</el-button>
      </div>
      <div v-if="topic.videoReview?.manualReviewCount" class="image-review-tip image-review-tip-rejected">
        <span>正文中有 {{ topic.videoReview.manualReviewCount }} 个视频待人工复核，当前已隐藏。</span>
        <el-button v-if="canReviewTopicVideos" link type="danger" @click="openTopicVideoReviewDialog">手动复核视频</el-button>
      </div>
      <div v-else-if="topic.videoReview?.rejectedCount" class="image-review-tip image-review-tip-rejected">
        <span>正文中有 {{ topic.videoReview.rejectedCount }} 个视频未通过审核，当前已隐藏。</span>
        <el-button v-if="canReviewTopicVideos" link type="danger" @click="openTopicVideoReviewDialog">手动复核视频</el-button>
      </div>
      <div v-else-if="topic.videoReview?.pendingCount" class="image-review-tip image-review-tip-pending">
        <span>正文中有 {{ topic.videoReview.pendingCount }} 个视频正在审核，审核通过后会自动显示。</span>
        <el-button v-if="canReviewTopicVideos" link type="warning" @click="openTopicVideoReviewDialog">手动复核视频</el-button>
      </div>

      <div v-if="isOwnTopicChecking" class="topic-review-tip cpu-card topic-review-tip-pending">
        <div class="review-blocked">
          <p>帖子已经提交，正在后台审核。</p>
          <p class="cpu-muted">现在只有你自己和管理员能看到；审核通过后会自动公开，并同步出现在首页和板块列表。</p>
        </div>
      </div>
      <div v-else-if="isOwnTopicReviewFailed" class="topic-review-tip cpu-card topic-review-tip-failed">
        <div class="review-blocked">
          <p>本次审核暂时没有完成，帖子仍然只有你自己和管理员可见。</p>
          <p v-if="topic.aiReviewReason" class="cpu-muted">{{ topic.aiReviewReason }}</p>
          <p class="cpu-muted">内容已经保留，你可以直接编辑后重新提交。</p>
        </div>
      </div>

      <div v-if="canAdminReviewTopicManual" class="topic-admin-review-tip cpu-card">
        <div class="review-blocked">
          <p>这篇稿件当前处于人工复核队列，可直接在这里处理。</p>
          <p v-if="topic.aiReviewReason">AI 说明：{{ topic.aiReviewReason }}</p>
          <p class="cpu-muted">通过后会立即公开展示；驳回后会继续隐藏，并给作者发送结果通知。</p>
        </div>
        <div class="topic-review-actions">
          <el-button
            type="success"
            :loading="topicAdminReviewAction === 'approved'"
            :disabled="topicAdminReviewAction !== ''"
            @click="approveTopicManualReview"
          >
            人工通过
          </el-button>
          <el-button
            type="danger"
            plain
            :loading="topicAdminReviewAction === 'rejected'"
            :disabled="topicAdminReviewAction !== ''"
            @click="rejectTopicManualReview"
          >
            人工驳回
          </el-button>
        </div>
      </div>

      <div v-if="canRequestTopicManualReview" class="topic-review-tip cpu-card">
        <div class="review-blocked">
          <p>这篇稿件被 AI 拦截了，当前仅你自己和管理员可见。</p>
          <p v-if="topic.aiReviewReason">审核说明：{{ topic.aiReviewReason }}</p>
          <p class="cpu-muted">你可以修改后再试，或申请人工复核。复核期间暂时不能继续提交新内容。</p>
        </div>
        <div class="topic-review-actions">
          <el-button type="warning" :loading="requestingTopicManualReview" :disabled="requestingTopicManualReview" @click="topicManualReviewConfirmOpen = true">申请人工复核</el-button>
        </div>
      </div>
      <div v-else-if="isOwnTopicManualReviewPending" class="topic-review-tip cpu-card topic-review-tip-pending">
        <p>这篇稿件已提交人工复核，当前仅你自己和管理员可见。请耐心等待审核结果。</p>
      </div>

      <MarkdownView :content="displayContent" class="post-body topic-markdown" clickable-images media-loading="eager" />

      <div v-if="!topic.hidden && topic.reactions?.length" class="reaction-strip">
        <button
          v-for="reaction in topic.reactions"
          :key="reaction.key"
          type="button"
          class="reaction-chip"
          :class="{ active: reaction.active }"
          :disabled="reactionBusyKey !== ''"
          @click="toggleTopicReaction(reaction.key)"
        >
          {{ reactionEmoji(reaction.key) }} {{ reaction.count }}
        </button>
      </div>
      <div v-if="!topic.hidden && auth.user?.vipActive" class="reaction-picker">
        <button
          v-for="reaction in reactionCatalog"
          :key="reaction.key"
          type="button"
          class="reaction-picker-btn"
          :title="reaction.label"
          :disabled="reactionBusyKey !== ''"
          @click="toggleTopicReaction(reaction.key)"
        >{{ reaction.emoji }}</button>
      </div>

      <footer class="post-foot">
        <el-button :type="liked ? 'primary' : 'default'" :icon="Star" :loading="topicActionBusy === 'like'" :disabled="isTopicActionBusy || topic.hidden" @click="onLike">
          {{ liked ? '已点赞' : '点赞' }} · {{ topic.likeCount }}
        </el-button>
        <el-button :icon="ChatLineRound" :disabled="!canReply" @click="openReplyDialog">回复 · {{ topic.replyCount }}</el-button>
        <el-button :disabled="topic.hidden" @click="shareDialogOpen = true">分享</el-button>
      </footer>

    </article>

    <!-- 回复列表 -->
    <section class="replies cpu-card" ref="repliesEl">
      <h3 class="cpu-section-title">{{ topic.replyCount }} 条回复</h3>
      <div v-if="repliesLoading" class="replies-loading" aria-busy="true">
        <el-skeleton animated :rows="3" />
        <el-skeleton animated :rows="3" />
      </div>
      <el-empty v-else-if="!replies.length" description="还没有回复，来聊两句吧" />
      <template v-else>
        <div
          v-for="entry in displayReplies"
          :id="`reply-${entry.item.id}`"
          :key="entry.item.id"
          class="reply"
          :class="{ nested: entry.depth > 0 }"
          :style="{ marginLeft: `${Math.min(entry.depth, 4) * 24}px` }"
        >
          <UserAvatar :size="32" class="avatar" :src="entry.item.author?.avatar" :name="entry.item.author?.nickname" :profile-frame="entry.item.author?.profileFrame" alt="回复头像" />
          <div class="reply-body">
            <div class="reply-meta">
              <span class="floor">{{ entry.item.hidden ? "待审核" : `#${entry.item.floor}` }}</span>
              <el-tag v-if="replyReviewLabel(entry.item)" size="small" type="warning" effect="plain">{{ replyReviewLabel(entry.item) }}</el-tag>
              <router-link v-if="entry.item.author?.id" :to="`/u/${entry.item.author.id}`" class="author">{{ entry.item.author?.nickname }}</router-link>
              <span v-else class="author">{{ entry.item.author?.nickname }}</span>
              <el-tag v-if="entry.item.isAnonymous" size="small" type="warning" effect="plain">匿名</el-tag>
              <UserModerationActions
                v-if="replyModerationUser(entry.item)"
                :user="replyModerationUser(entry.item)"
                display="dropdown"
                text
                label="管理"
                @updated="applyReplyAuthorModeration(entry.item, $event)"
              />
              <span v-if="entry.item.isAnonymous && entry.item.realAuthor" class="real-author-inline">
                真实作者：{{ entry.item.realAuthor.nickname }}<template v-if="entry.item.realAuthor.username"> @{{ entry.item.realAuthor.username }}</template>
              </span>
              <span v-if="entry.parent" class="reply-parent-chip">回复 {{ entry.parent.author?.nickname || "同学" }} · #{{ entry.parent.floor }}</span>
              <span class="dot">·</span>
              <span>{{ fmtRelative(entry.item.createdAt) }}</span>
            </div>
            <MarkdownView
              :content="entry.item.content"
              class="reply-content topic-markdown reply-markdown"
              clickable-images
              compact-quotes
              media-loading="eager"
            />
            <div v-if="!entry.item.hidden && entry.item.reactions?.length" class="reaction-strip reply-reactions">
              <button
                v-for="reaction in entry.item.reactions"
                :key="reaction.key"
                type="button"
                class="reaction-chip"
                :class="{ active: reaction.active }"
                :disabled="reactionBusyKey !== ''"
                @click="toggleReplyReaction(entry.item, reaction.key)"
              >{{ reactionEmoji(reaction.key) }} {{ reaction.count }}</button>
            </div>
            <div v-if="!entry.item.hidden && auth.user?.vipActive" class="reaction-picker reply-reaction-picker">
              <button
                v-for="reaction in reactionCatalog"
                :key="reaction.key"
                type="button"
                class="reaction-picker-btn"
                :title="reaction.label"
                :disabled="reactionBusyKey !== ''"
                @click="toggleReplyReaction(entry.item, reaction.key)"
              >{{ reaction.emoji }}</button>
            </div>
            <div class="reply-actions">
              <el-button v-if="!entry.item.hidden" text size="small" @click="replyTo(entry.item)">回复</el-button>
              <el-button v-if="canEditReply(entry.item)" text size="small" @click="editReply(entry.item)">编辑</el-button>
              <el-button v-if="canEditReply(entry.item)" text size="small" type="danger" :loading="replyActionBusyId === entry.item.id" :disabled="replyActionBusyId !== null" @click="removeReply(entry.item)">删除</el-button>
              <el-button v-if="!entry.item.hidden" text size="small" :loading="replyLikeBusyId === entry.item.id" :disabled="replyLikeBusyId !== null" @click="onLikeReply(entry.item)">👍 {{ entry.item.likeCount }}</el-button>
            </div>
          </div>
        </div>
      </template>
    </section>

    <el-dialog
      v-if="canReply"
      v-model="replyDialogOpen"
      title="回复"
      width="min(720px, calc(100dvw - 24px))"
      append-to-body
      align-center
      class="reply-dialog"
    >
      <div v-if="replyParentPreview && !editingReplyId" class="reply-target-bar">
        <span>正在回复 {{ replyParentPreview.author?.nickname || "同学" }} 的 #{{ replyParentPreview.floor }} 楼</span>
        <el-button text size="small" @click="clearReplyParent">取消</el-button>
      </div>
      <div v-if="topic?.board?.anonymousEnabled" class="reply-anonymous-box" :class="{ disabled: !replyAnonymousEnabled }">
        <el-switch v-model="replyAnonymous" :disabled="!replyAnonymousEnabled" />
        <div class="reply-anonymous-copy">
          <b>匿名回复</b>
          <p>{{ replyAnonymousHint }}</p>
        </div>
      </div>
      <RichTextEditor
        ref="replyEditorRef"
        v-model="replyText"
        label="写回复"
        placeholder="写下你的回复，可以直接粘贴图片。"
        footer-text="支持排版、图片和草稿保存。"
        :max-length="REPLY_MAX"
        :draft-key="replyDraftKey"
        toolbar-mode="static"
        @draft-restored="replyText = $event"
      />
      <div class="reply-form-actions reply-dialog-actions">
        <span class="cpu-muted">{{ replying ? replySubmissionProgress : "离开页面后会保留未发送的内容。" }}</span>
        <div class="reply-submit-actions">
          <el-button v-if="editingReplyId" :disabled="replying" @click="cancelReplyEdit">取消编辑</el-button>
          <el-button type="primary" :loading="replying" :disabled="replying" @click="submitReply">
            {{ replying ? replySubmissionProgress : (editingReplyId ? "保存修改" : "发布回复") }}
          </el-button>
        </div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="shareDialogOpen"
      title="分享帖子"
      width="420px"
      append-to-body
      class="share-dialog"
    >
      <div class="share-panel">
        <p class="share-copy">分享这里收成两件事：要么复制链接，要么直接保存一张分享卡片。</p>
        <div class="share-actions">
          <el-button v-if="canUseNativeShare" type="primary" class="share-action-btn" @click="shareViaSystem">系统分享</el-button>
          <el-button class="share-action-btn" @click="copyShareDialogOpen = true">复制链接</el-button>
          <el-button type="primary" plain class="share-action-btn" @click="openShareCard">保存分享卡片</el-button>
        </div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="copyShareDialogOpen"
      title="分享链接"
      width="380px"
      append-to-body
      class="copy-share-dialog"
    >
      <div class="copy-share-panel">
        <el-button class="share-action-btn" @click="copyShareLinkOnly">只复制链接</el-button>
        <el-button type="primary" plain class="share-action-btn" @click="copyShareTitleAndLink">复制标题和链接</el-button>
      </div>
    </el-dialog>

    <el-dialog
      v-model="shareCardDialogOpen"
      title="分享卡片"
      width="min(460px, calc(100dvw - 24px))"
      append-to-body
      class="share-card-dialog"
    >
      <div class="share-card-panel">
        <div v-if="shareCardRendering" class="share-card-loading">正在生成图片…</div>
        <img
          v-else-if="shareCardRenderedUrl"
          :src="shareCardRenderedUrl"
          alt="分享卡片"
          loading="lazy"
          decoding="async"
          fetchpriority="low"
          class="share-card-image"
          @click="openShareCardImagePreview"
        />
        <p v-if="isNativeAppClient && !hasNativeSaveBridge" class="share-card-tip">客户端受 WebView 限制，建议点开图片后截图保存。</p>
        <div class="share-card-actions">
          <button v-if="!isNativeAppClient || hasNativeSaveBridge" type="button" class="share-card-save-link" :disabled="shareCardSaving" @click="saveShareCardAsPng">
            保存图片
          </button>
          <button v-else type="button" class="share-card-save-link" @click="openShareCardImagePreview">放大后截图</button>
        </div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="shareCardPreviewOpen"
      title="分享卡片预览"
      width="min(520px, calc(100dvw - 24px))"
      append-to-body
      class="share-card-preview-dialog"
    >
      <img v-if="shareCardRenderedUrl" :src="shareCardRenderedUrl" alt="分享卡片大图" loading="lazy" decoding="async" fetchpriority="low" class="share-card-preview-image" />
      <p v-if="isNativeAppClient" class="share-card-tip">客户端请放大后截图保存。</p>
    </el-dialog>

    <el-dialog
      v-model="topicImageReviewDialogOpen"
      title="图片人工复核"
      width="min(920px, calc(100dvw - 24px))"
      append-to-body
      class="topic-image-review-dialog"
    >
      <div class="topic-image-review-panel" v-loading="topicImageReviewLoading">
        <p class="topic-image-review-copy">这里只展示当前主帖正文里的本地上传图片。你可以直接查看原图，并手动决定放行或继续隐藏。</p>
        <el-empty v-if="!topicImageReviewLoading && !topicImageReviewAssets.length" description="这条帖子里没有可复核的图片" />
        <div v-else class="topic-image-review-list">
          <article v-for="asset in topicImageReviewAssets" :key="asset.id" class="topic-image-review-card">
            <a :href="asset.url" target="_blank" rel="noopener noreferrer" class="topic-image-review-preview">
              <img :src="asset.url" alt="待复核图片" loading="lazy" decoding="async" fetchpriority="low" />
            </a>
            <div class="topic-image-review-meta">
              <div class="topic-image-review-head">
                <el-tag :type="imageReviewTagType(asset.status)" effect="plain">{{ imageReviewStatusLabel(asset.status) }}</el-tag>
                <span v-if="asset.manualReviewedBy?.nickname" class="topic-image-review-auditor">
                  最近人工处理：{{ asset.manualReviewedBy.nickname }}
                </span>
              </div>
              <p v-if="asset.reason" class="topic-image-review-line">当前说明：{{ asset.reason }}</p>
              <p v-if="asset.manualReviewNote" class="topic-image-review-line">人工备注：{{ asset.manualReviewNote }}</p>
              <p v-if="asset.lastError" class="topic-image-review-line topic-image-review-error">审核异常：{{ asset.lastError }}</p>
              <p v-if="asset.detail && asset.detail !== asset.reason && asset.detail !== asset.manualReviewNote" class="topic-image-review-line">
                详细信息：{{ asset.detail }}
              </p>
              <p v-if="asset.reviewedAt || asset.manualReviewedAt" class="topic-image-review-time">
                最近处理时间：{{ fmtDate(asset.manualReviewedAt || asset.reviewedAt || "") }}
              </p>
              <div class="topic-image-review-actions">
                <el-button
                  type="success"
                  size="small"
                  :loading="topicImageReviewSavingId === asset.id && topicImageReviewSavingAction === 'approved'"
                  :disabled="topicImageReviewSavingId !== null"
                  @click="approveTopicImage(asset)"
                >
                  人工通过
                </el-button>
                <el-button
                  type="danger"
                  plain
                  size="small"
                  :loading="topicImageReviewSavingId === asset.id && topicImageReviewSavingAction === 'rejected'"
                  :disabled="topicImageReviewSavingId !== null"
                  @click="rejectTopicImage(asset)"
                >
                  继续隐藏
                </el-button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="topicVideoReviewDialogOpen"
      title="视频人工复核"
      width="min(920px, calc(100dvw - 24px))"
      append-to-body
      class="topic-video-review-dialog"
    >
      <div class="topic-video-review-panel" v-loading="topicVideoReviewLoading">
        <p class="topic-video-review-copy">这里只展示当前主帖正文里的本地上传视频。你可以直接预览视频，并手动决定放行或继续隐藏。</p>
        <el-empty v-if="!topicVideoReviewLoading && !topicVideoReviewAssets.length" description="这条帖子里没有可复核的视频" />
        <div v-else class="topic-video-review-list">
          <article v-for="asset in topicVideoReviewAssets" :key="asset.id" class="topic-video-review-card">
            <div class="topic-video-review-preview">
              <video :src="asset.url" controls preload="metadata"></video>
            </div>
            <div class="topic-video-review-meta">
              <div class="topic-video-review-head">
                <el-tag :type="videoReviewTagType(asset.status)" effect="plain">{{ videoReviewStatusLabel(asset.status) }}</el-tag>
                <span v-if="asset.manualReviewedBy?.nickname" class="topic-video-review-auditor">
                  最近人工处理：{{ asset.manualReviewedBy.nickname }}
                </span>
              </div>
              <p v-if="asset.reason" class="topic-video-review-line">当前说明：{{ asset.reason }}</p>
              <p v-if="asset.manualReviewNote" class="topic-video-review-line">人工备注：{{ asset.manualReviewNote }}</p>
              <p v-if="asset.lastError" class="topic-video-review-line topic-video-review-error">审核异常：{{ asset.lastError }}</p>
              <p v-if="asset.detail && asset.detail !== asset.reason && asset.detail !== asset.manualReviewNote" class="topic-video-review-line">
                详细信息：{{ asset.detail }}
              </p>
              <p class="topic-video-review-line">
                视频信息：{{ formatVideoResolution(asset.width, asset.height) }} · {{ formatVideoDuration(asset.durationMs) }} · {{ asset.hasAudio ? "含音轨" : "无音轨" }}
              </p>
              <p v-if="asset.transcriptStatus" class="topic-video-review-line">
                转写状态：{{ formatTranscriptStatus(asset.transcriptStatus) }}
              </p>
              <p v-if="asset.reviewedAt || asset.manualReviewedAt" class="topic-video-review-time">
                最近处理时间：{{ fmtDate(asset.manualReviewedAt || asset.reviewedAt || "") }}
              </p>
              <div class="topic-video-review-actions">
                <el-button
                  type="success"
                  size="small"
                  :loading="topicVideoReviewSavingId === asset.id && topicVideoReviewSavingAction === 'approved'"
                  :disabled="topicVideoReviewSavingId !== null"
                  @click="approveTopicVideo(asset)"
                >
                  人工通过
                </el-button>
                <el-button
                  type="danger"
                  plain
                  size="small"
                  :loading="topicVideoReviewSavingId === asset.id && topicVideoReviewSavingAction === 'rejected'"
                  :disabled="topicVideoReviewSavingId !== null"
                  @click="rejectTopicVideo(asset)"
                >
                  继续隐藏
                </el-button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </el-dialog>

    <div class="share-card-export-shell" aria-hidden="true">
      <div class="share-card-dom share-card-dom--export" ref="shareCardExportRef">
        <div class="share-card-top">
          <div class="share-card-icon" :style="{ background: shareCardAccent }">
            {{ topic?.board?.icon || "💬" }}
          </div>
          <div class="share-card-meta">
            <div class="share-card-board">{{ boardDisplayName }}</div>
            <div class="share-card-subtitle">{{ shareCardSubtitle }}</div>
            <div class="share-card-stats">{{ shareCardStats }}</div>
          </div>
        </div>
        <div class="share-card-hero" :style="{ background: shareCardSoftBg }">
          <div class="share-card-hero-orb" :style="{ background: shareCardSoftOrb }"></div>
          <div class="share-card-hero-line" :style="{ background: shareCardSoftLine }"></div>
          <h3 class="share-card-title">{{ topic?.title }}</h3>
          <p class="share-card-subcopy">{{ shareCardSubtitle }}</p>
        </div>
        <div class="share-card-bottom">
          <div class="share-card-brand">
            <div class="share-card-brand-title">药大拾间</div>
            <div class="share-card-brand-copy">扫描二维码，直接打开原帖</div>
            <div class="share-card-brand-host">cputime.cn</div>
          </div>
          <div class="share-card-qr-box">
            <img v-if="shareCardQrDataUrl" :src="shareCardQrDataUrl" alt="分享二维码" loading="lazy" decoding="async" fetchpriority="low" class="share-card-qr" />
            <div v-else class="share-card-qr share-card-qr-placeholder"></div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="auth.isLoggedIn && !topic.locked && auth.user?.status === 'muted'" class="locked-tip cpu-card">
      {{ currentMuteMessage }}
    </div>

    <el-dialog
      v-model="replyReviewBlockedOpen"
      title="回复暂未通过审核"
      width="520px"
      append-to-body
    >
      <div class="review-blocked">
        <p>这条回复暂时还没有发出。</p>
        <p v-if="blockedReplyInfo.reason">审核说明：{{ blockedReplyInfo.reason }}</p>
        <p class="cpu-muted">你可以修改后再试，或申请人工复核。复核期间暂时不能继续提交新内容。</p>
      </div>
      <template #footer>
        <el-button @click="replyReviewBlockedOpen = false">返回修改</el-button>
        <el-button type="warning" :loading="requestingReplyManualReview" :disabled="requestingReplyManualReview" @click="replyManualReviewConfirmOpen = true">申请人工复核</el-button>
      </template>
    </el-dialog>

    <ManualReviewConfirmDialog
      v-model="replyManualReviewConfirmOpen"
      subject="回复"
      @confirm="confirmReplyManualReviewRequest"
    />

    <ManualReviewConfirmDialog
      v-model="topicManualReviewConfirmOpen"
      subject="稿件"
      @confirm="confirmTopicManualReviewRequest"
    />

    <div v-if="topic.locked" class="locked-tip cpu-card">🔒 该帖已锁定，无法回复</div>
    <div v-if="!auth.isLoggedIn" class="login-tip cpu-card">
      <p><router-link to="/login">登录</router-link> 或 <router-link to="/register">注册</router-link> 后参与回复</p>
      <PrivacyPolicyNotice compact />
    </div>
  </div>

  <div v-else class="topic-page topic-page-empty">
    <section class="cpu-card topic-empty-card">
      <el-empty :description="loadError || '帖子不存在或暂时不可见'">
        <el-button v-if="loadError" type="primary" @click="load">重试</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { toPng } from "html-to-image";
import QRCode from "qrcode";
import { ArrowLeft, Star, ChatLineRound, Link } from "@element-plus/icons-vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import UserModerationActions from "@/components/common/UserModerationActions.vue";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";
import MarkdownView from "@/components/forum/MarkdownView.vue";
import RichTextEditor from "@/components/forum/RichTextEditor.vue";
import ManualReviewConfirmDialog from "@/components/forum/ManualReviewConfirmDialog.vue";
import { topicApi, replyApi, likeApi, reactionApi, type Topic, type Reply, type ForumReaction, type ReplySubmissionResponse } from "@/api/topic";
import { adminApi, type ForumImageReviewAsset, type ForumVideoReviewAsset } from "@/api/admin";
import { useAuthStore } from "@/stores/auth";
import { fmtDate, fmtRelative } from "@/utils/format";
import { forumCacheScope, readForumTopic, writeForumTopic } from "@/utils/forumCache";
import { copyText } from "@/utils/userGroup";
import { isAndroidNativeApp, isHarmonyNativeApp } from "@/utils/clientInfo";
import { getNativeBridge, hasNativeImageSaveBridge } from "@/utils/nativeBridge";
import {
  createForumSubmissionId,
  getForumRequestMessage,
  isAmbiguousForumSubmissionError,
  reconcileForumSubmission,
  waitForForumSubmissionResult,
} from "@/utils/forumSubmission";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const topic = ref<Topic | null>(null);
const replies = ref<Reply[]>([]);
const loading = ref(false);
const repliesLoading = ref(false);
const loadError = ref("");
const replying = ref(false);
const replySubmissionProgress = ref("");
const pendingReplySubmission = ref<{ fingerprint: string; submissionId: string } | null>(null);
let pendingReplyMonitorSeq = 0;
const replyText = ref("");
const replyAnonymous = ref(false);
const replyDialogOpen = ref(false);
const editingReplyId = ref<number | null>(null);
const replyParentId = ref<number | null>(null);
const shareDialogOpen = ref(false);
const copyShareDialogOpen = ref(false);
const shareCardDialogOpen = ref(false);
const shareCardSaving = ref(false);
const shareCardRendering = ref(false);
const shareCardRenderedUrl = ref("");
const shareCardQrDataUrl = ref("");
const shareCardPreviewOpen = ref(false);
const topicImageReviewDialogOpen = ref(false);
const topicImageReviewLoading = ref(false);
const topicImageReviewSavingId = ref<number | null>(null);
const topicImageReviewSavingAction = ref<"approved" | "rejected" | "">("");
const topicImageReviewAssets = ref<ForumImageReviewAsset[]>([]);
const topicVideoReviewDialogOpen = ref(false);
const topicVideoReviewLoading = ref(false);
const topicVideoReviewSavingId = ref<number | null>(null);
const topicVideoReviewSavingAction = ref<"approved" | "rejected" | "">("");
const topicVideoReviewAssets = ref<ForumVideoReviewAsset[]>([]);
const replyReviewBlockedOpen = ref(false);
const requestingReplyManualReview = ref(false);
const replyManualReviewConfirmOpen = ref(false);
const requestingTopicManualReview = ref(false);
const topicManualReviewConfirmOpen = ref(false);
const topicAdminReviewAction = ref<"" | "approved" | "rejected">("");
type TopicAction = "" | "like" | "pin" | "globalPin" | "lock" | "delete";
const topicActionBusy = ref<TopicAction>("");
const replyActionBusyId = ref<number | null>(null);
const replyLikeBusyId = ref<number | null>(null);
const blockedReplyId = ref<number | null>(null);
const blockedReplyInfo = reactive<{ reason: string; riskScore: number | null }>({
  reason: "",
  riskScore: null,
});
const liked = ref(false);
const reactionBusyKey = ref("");
const reactionCatalog = [
  { key: "vip-crown", emoji: "👑", label: "王者" },
  { key: "sparkles", emoji: "✨", label: "闪耀" },
  { key: "fire", emoji: "🔥", label: "太燃了" },
  { key: "hug", emoji: "🫶", label: "抱抱" },
  { key: "rocket", emoji: "🚀", label: "起飞" },
];
let loadSeq = 0;
let shareCardQrSeq = 0;
let topicReviewPollSeq = 0;
let topicReviewPollTimer: ReturnType<typeof setTimeout> | null = null;
const repliesEl = ref<HTMLElement | null>(null);
const replyEditorRef = ref<InstanceType<typeof RichTextEditor> | null>(null);
const shareCardExportRef = ref<HTMLElement | null>(null);
const REPLY_MAX = 10000;
const isTopicActionBusy = computed(() => topicActionBusy.value !== "");

const metaPrice = computed(() => topic.value?.metadata?.price);
const hotScore = computed(() => Math.round((topic.value?.likeCount ?? 0) * 5 + (topic.value?.replyCount ?? 0) * 3 + (topic.value?.viewCount ?? 0) * 0.03));
const boardDisplayName = computed(() => topic.value?.board?.name || "药大拾间");
const displayTopicTitle = computed(() => topic.value?.title || "");
const isReadOnly = computed(() => topic.value?.board?.readOnly);
const topicModerationUser = computed(() => {
  if (topic.value?.realAuthor) return topic.value.realAuthor as any;
  if (topic.value?.author?.id) return topic.value.author as any;
  return null;
});
const canReply = computed(() =>
  auth.isLoggedIn && !topic.value?.hidden && !topic.value?.locked && auth.user?.status !== "muted"
);
const replyParentPreview = computed(() => replies.value.find((item) => item.id === replyParentId.value) ?? null);
const displayReplies = computed(() => {
  const byId = new Map(replies.value.map((item) => [item.id, item] as const));
  const children = new Map<number, Reply[]>();
  const roots: Reply[] = [];
  for (const reply of replies.value) {
    const parentId = Number(reply.parentReplyId ?? 0) || 0;
    if (!parentId || !byId.has(parentId) || parentId === reply.id) {
      roots.push(reply);
      continue;
    }
    const list = children.get(parentId) ?? [];
    list.push(reply);
    children.set(parentId, list);
  }
  const sortByFloor = (list: Reply[]) => list.sort((a, b) => (a.floor || 0) - (b.floor || 0) || a.id - b.id);
  sortByFloor(roots);
  children.forEach((list) => sortByFloor(list));
  const flattened: Array<{ item: Reply; depth: number; parent: Reply | null }> = [];
  const walk = (reply: Reply, depth: number, parent: Reply | null) => {
    flattened.push({ item: reply, depth, parent });
    for (const child of children.get(reply.id) ?? []) {
      walk(child, depth + 1, reply);
    }
  };
  for (const root of roots) walk(root, 0, null);
  return flattened;
});
const replyAnonymousEnabled = computed(() => {
  const anonymousState = auth.user?.anonymousState;
  const ownAnonymousTopic = Boolean(
    topic.value?.isAnonymous &&
    topic.value?.realAuthor?.id === auth.user?.id
  );
  const ownAnonymousReplyInTopic = Boolean(
    replies.value.some((item) => item.isAnonymous && item.realAuthor?.id === auth.user?.id)
  );
  return Boolean(
    topic.value?.board?.anonymousEnabled &&
    (
      ownAnonymousTopic ||
      ownAnonymousReplyInTopic ||
      (
        anonymousState?.eligible &&
        !anonymousState?.frozen &&
        (anonymousState?.availableCredits ?? 0) > 0
      )
    )
  );
});
const replyAnonymousHint = computed(() => {
  const anonymousState = auth.user?.anonymousState;
  if (!topic.value?.board?.anonymousEnabled) return "当前板块暂不支持匿名回复。";
  if (topic.value?.isAnonymous && topic.value?.realAuthor?.id === auth.user?.id) {
    return "这是你的匿名主帖，在这里继续匿名回复不会消耗匿名积分。";
  }
  if (replies.value.some((item) => item.isAnonymous && item.realAuthor?.id === auth.user?.id)) {
    return "你已经在这条帖子里匿名回复过，后续继续匿名不会再消耗匿名积分。";
  }
  if (!anonymousState?.eligible) return `信誉值达到 ${anonymousState?.minReputation ?? 30} 后才能匿名回复。`;
  if (anonymousState?.frozen) return "你的匿名积分当前已被冻结，请联系管理员处理。";
  if ((anonymousState?.availableCredits ?? 0) <= 0) return "本周匿名积分已用完，下周会自动刷新。";
  return `本周还剩 ${anonymousState?.availableCredits ?? 0} / ${anonymousState?.weeklyQuota ?? 0} 点匿名积分。`;
});
const canEdit = computed(() =>
  topic.value?.board?.type !== "market" && (
    auth.user?.id === topic.value?.authorId ||
    auth.isAdmin ||
    (auth.isMod && !isReadOnly.value)
  )
);
const canRequestTopicManualReview = computed(() => Boolean(
  auth.isLoggedIn &&
  auth.user?.id === topic.value?.authorId &&
  topic.value?.hidden &&
  topic.value?.aiReviewStatus === "blocked_ai"
));
const isOwnTopicChecking = computed(() => Boolean(
  auth.isLoggedIn &&
  auth.user?.id === topic.value?.authorId &&
  topic.value?.hidden &&
  topic.value?.aiReviewStatus === "checking"
));
const isOwnTopicReviewFailed = computed(() => Boolean(
  auth.isLoggedIn &&
  auth.user?.id === topic.value?.authorId &&
  topic.value?.hidden &&
  topic.value?.aiReviewStatus === "review_failed"
));
const canAdminReviewTopicManual = computed(() => Boolean(
  auth.isMod &&
  topic.value?.hidden &&
  ["manual_requested", "manual_reviewing"].includes(String(topic.value?.aiReviewStatus || ""))
));
const isOwnTopicManualReviewPending = computed(() => Boolean(
  auth.isLoggedIn &&
  auth.user?.id === topic.value?.authorId &&
  topic.value?.hidden &&
  ["manual_requested", "manual_reviewing"].includes(String(topic.value?.aiReviewStatus || ""))
));
const canPin = computed(() => auth.isMod);
const canReviewTopicImages = computed(() => (
  auth.isMod &&
  (((topic.value?.imageReview?.pendingCount ?? 0) > 0) || ((topic.value?.imageReview?.rejectedCount ?? 0) > 0))
));
const canReviewTopicVideos = computed(() => (
  auth.isMod &&
  (
    ((topic.value?.videoReview?.pendingCount ?? 0) > 0)
    || ((topic.value?.videoReview?.manualReviewCount ?? 0) > 0)
    || ((topic.value?.videoReview?.rejectedCount ?? 0) > 0)
  )
));
const replyDraftKey = computed(() => topic.value?.id ? `cpu-reply-draft-${topic.value.id}` : "");
const currentMuteMessage = computed(() => auth.user?.mutedUntil ? `你已被禁言至 ${fmtDate(auth.user.mutedUntil)}` : "你当前已被禁言，暂时无法回复");
const shareLandingUrl = computed(() => topic.value ? new URL(`/share/topic/${topic.value.id}`, window.location.origin).toString() : "");
const shareSummary = computed(() => {
  const raw = stripTextForShare(displayContent.value || topic.value?.content || "");
  return raw ? raw.slice(0, 80) : `来自 ${boardDisplayName.value} 的帖子`;
});
const canUseNativeShare = computed(() => (
  isIosDevice() &&
  typeof navigator !== "undefined" &&
  typeof navigator.share === "function"
));
const isNativeAppClient = computed(() => typeof navigator !== "undefined" && (isAndroidNativeApp() || isHarmonyNativeApp()));
const hasNativeSaveBridge = computed(() => hasNativeImageSaveBridge());
const shareCardDownloadName = computed(() => {
  const safeTitle = (topic.value?.title || "分享卡片").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  return `${safeTitle || "分享卡片"}-cpu-share.png`;
});
const shareCardAccent = computed(() => topic.value?.board?.color || "#168776");
const shareCardSoftBg = computed(() => `linear-gradient(135deg, ${hexToRgba(shareCardAccent.value, 0.08)} 0%, #f7fbff 100%)`);
const shareCardSoftOrb = computed(() => hexToRgba(shareCardAccent.value, 0.13));
const shareCardSoftLine = computed(() => hexToRgba(shareCardAccent.value, 0.22));
const shareCardSubtitle = computed(() => {
  const board = boardDisplayName.value;
  const author = topic.value?.author?.nickname || "同学";
  return `${board} · ${author}`;
});
const shareCardStats = computed(() => `${topic.value?.replyCount ?? 0} 条回复 · ${topic.value?.viewCount ?? 0} 浏览`);
const displayContent = computed(() => {
  const content = topic.value?.content ?? "";
  if (!topic.value?.metadata?.sourceUrl) return content;
  return stripCrawlerSourceHeader(content);
});
const sourceNotice = computed(() => {
  if (!topic.value?.metadata?.sourceUrl) return "";
  if (topic.value?.metadata?.externalType === "wechat") {
    return "微信文章可能无法在站内完整展示，建议前往微信阅读全文。";
  }
  const compact = displayContent.value.replace(/\s/g, "");
  if (!compact || /未能提取正文|正文为微信公众号文章/.test(displayContent.value)) {
    return "如果正文为空、排版异常或无法查看正常内容，建议前往学校原站查看。";
  }
  return "如遇正文缺失、附件打不开或排版异常，可前往学校原站查看。";
});

const isAnnouncementTopic = computed(() => topic.value?.board?.type === "announce");
const backTargetFromQuery = computed(() => {
  const text = String(route.query.from ?? "").trim();
  return text.startsWith("/") ? text : "";
});
const backLabel = computed(() => {
  if (backTargetFromQuery.value.includes("/forum/latest")) return "返回最新";
  if (backTargetFromQuery.value.includes("/forum/hot")) return "返回热榜";
  if (isAnnouncementTopic.value) return "返回上页";
  return "返回最新";
});

function goBackFromTopic() {
  if (backTargetFromQuery.value) {
    router.push(backTargetFromQuery.value);
    return;
  }
  if (isAnnouncementTopic.value) {
    if (window.history.length > 1) router.back();
    else router.replace("/announcements");
    return;
  }
  router.push({ name: "forum-latest" });
}

function renderLocalQrDataUrl(value: string, width: number) {
  return QRCode.toDataURL(value, {
    width,
    margin: 1,
    color: {
      dark: "#172033",
      light: "#ffffffff",
    },
  });
}

watch(() => route.params.id, () => {
  pendingReplyMonitorSeq += 1;
  topicReviewPollSeq += 1;
  clearTopicReviewPollTimer();
  void load();
}, { immediate: true });

onBeforeUnmount(() => {
  pendingReplyMonitorSeq += 1;
  topicReviewPollSeq += 1;
  clearTopicReviewPollTimer();
});

watch(replyAnonymousEnabled, (enabled) => {
  if (!enabled) replyAnonymous.value = false;
}, { immediate: true });

watch(shareLandingUrl, async (url) => {
  const seq = ++shareCardQrSeq;
  shareCardQrDataUrl.value = "";
  shareCardRenderedUrl.value = "";
  if (!url) return;
  try {
    const dataUrl = await renderLocalQrDataUrl(url, 220);
    if (seq === shareCardQrSeq) shareCardQrDataUrl.value = dataUrl;
  } catch (error) {
    console.warn("[topic] failed to render share card QR code", error);
    if (seq === shareCardQrSeq) shareCardQrDataUrl.value = "";
  }
}, { immediate: true });

watch(replyDialogOpen, (open) => {
  if (!open && !replying.value) {
    replyAnonymous.value = false;
    editingReplyId.value = null;
    replyParentId.value = null;
  }
});

function clearTopicReviewPollTimer() {
  if (topicReviewPollTimer !== null) {
    clearTimeout(topicReviewPollTimer);
    topicReviewPollTimer = null;
  }
}

function scheduleTopicReviewPoll() {
  clearTopicReviewPollTimer();
  if (!topic.value?.hidden || topic.value.aiReviewStatus !== "checking") return;
  const id = topic.value.id;
  const seq = topicReviewPollSeq;
  topicReviewPollTimer = setTimeout(async () => {
    topicReviewPollTimer = null;
    try {
      const latest = await topicApi.detail(id, { cacheTtlMs: 0, suppressErrorMessage: true });
      if (seq !== topicReviewPollSeq || Number(route.params.id) !== id) return;
      const previousStatus = topic.value?.aiReviewStatus;
      topic.value = latest;
      writeForumTopic(forumCacheScope(auth.user), id, { topic: latest, replies: replies.value });
      if (latest.hidden && latest.aiReviewStatus === "checking") {
        scheduleTopicReviewPoll();
        return;
      }
      if (previousStatus === "checking" && !latest.hidden) {
        ElMessage.success("审核已通过，帖子现在已经公开");
      } else if (latest.aiReviewStatus === "blocked_ai") {
        ElMessage.warning("帖子暂未通过审核，你可以修改内容或申请人工复核");
      } else if (latest.aiReviewStatus === "review_failed") {
        ElMessage.error("审核服务暂时未能完成处理，帖子内容已经保留");
      }
    } catch {
      if (seq === topicReviewPollSeq && topic.value?.hidden && topic.value.aiReviewStatus === "checking") {
        scheduleTopicReviewPoll();
      }
    }
  }, 1_200);
}

async function load() {
  const seq = ++loadSeq;
  const id = Number(route.params.id);
  loadError.value = "";
  liked.value = false;
  if (!Number.isFinite(id) || id <= 0) {
    topic.value = null;
    replies.value = [];
    loadError.value = "帖子不存在或已被删除";
    loading.value = false;
    repliesLoading.value = false;
    return;
  }
  const scope = forumCacheScope(auth.user);
  const cached = readForumTopic(scope, id);
  topic.value = cached?.topic ?? null;
  replies.value = cached?.replies ?? [];
  loading.value = !cached;
  repliesLoading.value = !cached;
  try {
    const topicPromise = topicApi.detail(id, { suppressErrorMessage: true });
    const repliesPromise = topicApi.replies(id, { suppressErrorMessage: true })
      .catch((error: unknown) => {
        if ((error as { response?: { status?: number } })?.response?.status === 403) {
          router.replace({ name: "forum", query: { redirect: route.fullPath } });
        }
        return [];
      });
    const [nextTopic, nextReplies] = await Promise.all([topicPromise, repliesPromise]);
    if (seq !== loadSeq) return;
    topic.value = nextTopic;
    replies.value = nextReplies;
    scheduleTopicReviewPoll();
    restorePendingReplySubmission();
    if (pendingReplySubmission.value) void monitorPendingReplySubmission(pendingReplySubmission.value.submissionId);
    // 我是否赞过
    if (auth.isLoggedIn) {
      try {
        const mine = await likeApi.mine([id], nextReplies.map((r) => r.id), { suppressErrorMessage: true });
        if (seq !== loadSeq) return;
        liked.value = mine.topics.includes(id);
        // 标记每条回复 liked
        const set = new Set(mine.replies);
        nextReplies.forEach((r: any) => (r._liked = set.has(r.id)));
        const reactionMine = await reactionApi.mine([id], nextReplies.map((r) => r.id), { suppressErrorMessage: true });
        const topicKeys = new Set(reactionMine.topics[String(id)] ?? []);
        if (topic.value?.reactions) topic.value.reactions = topic.value.reactions.map((item) => ({ ...item, active: topicKeys.has(item.key) }));
        nextReplies.forEach((r: any) => {
          const keys = new Set(reactionMine.replies[String(r.id)] ?? []);
          r.reactions = (r.reactions ?? []).map((item: ForumReaction) => ({ ...item, active: keys.has(item.key) }));
        });
      } catch {
        if (seq === loadSeq) liked.value = false;
      }
    }
    if (topic.value) writeForumTopic(scope, id, { topic: topic.value, replies: nextReplies });
  } catch (error) {
    if (seq !== loadSeq) return;
    if ((error as { response?: { status?: number } })?.response?.status === 403) {
      router.replace({ name: "forum", query: { redirect: route.fullPath } });
      return;
    }
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (!cached || status === 404) {
      loadError.value = normalizeTopicLoadError(error);
      topic.value = null;
      replies.value = [];
    }
  } finally {
    if (seq === loadSeq) {
      loading.value = false;
      repliesLoading.value = false;
    }
  }
}

async function loadTopicDetail(id: number) {
  try {
    return await topicApi.detail(id, { suppressErrorMessage: true });
  } catch (error) {
    if ((error as { response?: { status?: number } })?.response?.status === 403) {
      router.replace({ name: "forum", query: { redirect: route.fullPath } });
      return null;
    }
    ElMessage.error(normalizeTopicLoadError(error));
    return null;
  }
}

function normalizeTopicLoadError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status === 404) return "帖子不存在或已被删除";
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "帖子加载失败";
  }
  return "帖子加载失败，请稍后再试";
}

async function onLike() {
  if (topicActionBusy.value) return;
  if (topic.value?.hidden) return;
  if (!auth.isLoggedIn) { router.push({ name: "login", query: { redirect: route.fullPath } }); return; }
  topicActionBusy.value = "like";
  try {
    const r = await likeApi.toggleTopic(topic.value!.id);
    liked.value = r.liked;
    if (topic.value) topic.value.likeCount = r.likeCount;
  } finally {
    topicActionBusy.value = "";
  }
}

async function onLikeReply(reply: any) {
  if (replyLikeBusyId.value !== null) return;
  if (!auth.isLoggedIn) { router.push({ name: "login", query: { redirect: route.fullPath } }); return; }
  replyLikeBusyId.value = reply.id;
  try {
    const r = await likeApi.toggleReply(reply.id);
    reply.likeCount = r.likeCount;
    reply._liked = r.liked;
  } finally {
    replyLikeBusyId.value = null;
  }
}

function replyTo(r: Reply) {
  if (!openReplyDialog()) return;
  replyParentId.value = r.id;
}

function reactionEmoji(key: string) {
  return reactionCatalog.find((item) => item.key === key)?.emoji || "✨";
}

function replyReviewLabel(reply: Reply) {
  if (!reply.hidden) return "";
  const status = String(reply.aiReviewStatus || "");
  if (status === "checking") return "审核中 · 仅自己可见";
  if (status === "review_failed") return "审核暂未完成";
  if (["manual_requested", "manual_reviewing"].includes(status)) return "人工复核中";
  if (status === "blocked_ai") return "暂未通过审核";
  if (status === "rejected_manual") return "人工复核未通过";
  return "仅自己可见";
}

async function toggleTopicReaction(key: string) {
  if (!topic.value || reactionBusyKey.value) return;
  if (!auth.user?.vipActive) {
    ElMessage.info("VIP 用户才能使用专属表情");
    return;
  }
  reactionBusyKey.value = `topic:${key}`;
  try {
    topic.value.reactions = await reactionApi.toggleTopic(topic.value.id, key).then((result) => result.reactions);
  } finally {
    reactionBusyKey.value = "";
  }
}

async function toggleReplyReaction(reply: Reply, key: string) {
  if (reactionBusyKey.value) return;
  if (!auth.user?.vipActive) {
    ElMessage.info("VIP 用户才能使用专属表情");
    return;
  }
  reactionBusyKey.value = `reply:${reply.id}:${key}`;
  try {
    reply.reactions = await reactionApi.toggleReply(reply.id, key).then((result) => result.reactions);
  } finally {
    reactionBusyKey.value = "";
  }
}

function clearReplyParent() {
  replyParentId.value = null;
}

function canEditReply(reply: Reply) {
  return Boolean(
    auth.user &&
    (
      auth.user.id === reply.authorId ||
      auth.isAdmin ||
      auth.isMod
    )
  );
}

function editReply(reply: Reply) {
  if (!canEditReply(reply)) return;
  editingReplyId.value = reply.id;
  replyParentId.value = null;
  replyText.value = reply.content;
  replyAnonymous.value = false;
  replyDialogOpen.value = true;
}

function cancelReplyEdit() {
  editingReplyId.value = null;
  replyParentId.value = null;
  replyText.value = "";
}

function openReplyDialog() {
  if (!auth.isLoggedIn) {
    router.push({ name: "login", query: { redirect: route.fullPath } });
    return false;
  }
  if (topic.value?.locked) {
    ElMessage.warning("该帖已锁定，无法回复");
    return false;
  }
  if (topic.value?.hidden) {
    ElMessage.info("帖子通过审核后才能回复");
    return false;
  }
  if (auth.user?.status === "muted") {
    ElMessage.warning(currentMuteMessage.value);
    return false;
  }
  replyDialogOpen.value = true;
  return true;
}

function replySubmissionFingerprint() {
  return JSON.stringify({
    topicId: topic.value?.id,
    content: replyText.value,
    parentReplyId: replyParentId.value || null,
    anonymous: replyAnonymous.value,
  });
}

function getReplySubmissionId(fingerprint: string) {
  if (pendingReplySubmission.value?.fingerprint === fingerprint) {
    return pendingReplySubmission.value.submissionId;
  }
  const submissionId = createForumSubmissionId("reply");
  pendingReplySubmission.value = { fingerprint, submissionId };
  persistPendingReplySubmission();
  return submissionId;
}

function pendingReplyStorageKey() {
  return `cpu-forum-pending-reply-${Number(route.params.id) || 0}`;
}

function persistPendingReplySubmission() {
  try {
    if (pendingReplySubmission.value) {
      localStorage.setItem(pendingReplyStorageKey(), JSON.stringify(pendingReplySubmission.value));
    } else {
      localStorage.removeItem(pendingReplyStorageKey());
    }
  } catch {
    // Storage may be unavailable; the server still reports completion through notifications.
  }
}

function restorePendingReplySubmission() {
  try {
    const parsed = JSON.parse(localStorage.getItem(pendingReplyStorageKey()) || "null");
    pendingReplySubmission.value = parsed
      && typeof parsed.fingerprint === "string"
      && typeof parsed.submissionId === "string"
      ? parsed
      : null;
  } catch {
    pendingReplySubmission.value = null;
  }
}

function clearPendingReplySubmission() {
  pendingReplySubmission.value = null;
  persistPendingReplySubmission();
}

function pendingReplyStillMatchesCurrentDraft() {
  return pendingReplySubmission.value?.fingerprint === replySubmissionFingerprint();
}

async function monitorPendingReplySubmission(submissionId: string) {
  const seq = ++pendingReplyMonitorSeq;
  const result = await waitForForumSubmissionResult(
    () => replyApi.submissionStatus(submissionId),
    { attempts: 180, intervalMs: 1_000 },
  ).catch(() => null);
  if (seq !== pendingReplyMonitorSeq) return;
  if (!result) {
    ElMessage.info("回复仍在后台审核，完成后会通过站内通知告知结果");
    return;
  }
  await handleReplySubmissionResult(result);
}

async function handleReplySubmissionResult(r: ReplySubmissionResponse) {
  if (replyAnonymous.value) await auth.fetchMe();
  if (r.submissionResult?.status === "pending") {
    replyDialogOpen.value = false;
    const existingIndex = replies.value.findIndex((item) => item.id === r.id);
    if (existingIndex >= 0) replies.value[existingIndex] = { ...replies.value[existingIndex], ...r } as Reply;
    else replies.value.push({ ...r, _liked: false } as Reply);
    ElMessage.success("回复已提交后台审核，可以继续浏览；完成后会通知你");
    const submissionId = r.submissionId || pendingReplySubmission.value?.submissionId;
    if (submissionId) void monitorPendingReplySubmission(submissionId);
    return;
  }
  if (r.submissionResult?.status === "failed") {
    replyDialogOpen.value = false;
    ElMessage.error(r.submissionResult.reason || "审核服务暂时不可用，回复草稿已保留，请稍后重试");
    return;
  }
  if (r.submissionResult?.status === "blocked_ai") {
    clearPendingReplySubmission();
    blockedReplyId.value = r.id ?? null;
    blockedReplyInfo.reason = r.submissionResult.reason || "检测到较高风险内容";
    blockedReplyInfo.riskScore = r.submissionResult.riskScore ?? null;
    replyReviewBlockedOpen.value = true;
    ElMessage.warning("回复暂未通过审核");
    return;
  }
  const shouldClearCurrentDraft = pendingReplyStillMatchesCurrentDraft();
  clearPendingReplySubmission();
  const existingIndex = replies.value.findIndex((item) => item.id === r.id);
  const wasHidden = existingIndex >= 0 && Boolean(replies.value[existingIndex]?.hidden);
  if (existingIndex >= 0) replies.value[existingIndex] = { ...replies.value[existingIndex], ...r } as any;
  else replies.value.push({ ...r, _liked: false } as any);
  if (shouldClearCurrentDraft) {
    replyText.value = "";
    replyAnonymous.value = false;
    replyParentId.value = null;
    replyDialogOpen.value = false;
    replyEditorRef.value?.clearDraft();
  }
  if (topic.value && (existingIndex < 0 || wasHidden)) topic.value.replyCount += 1;
  ElMessage.success(r.submissionResult?.replayed ? "已确认回复发布成功" : "回复已发布");
  if (!shouldClearCurrentDraft) ElMessage.info("此前提交的回复已发布；当前新草稿已保留");
  nextTick(() => repliesEl.value?.scrollIntoView({ behavior: "smooth", block: "end" }));
}

async function submitReply() {
  if (replying.value) return;
  if (!auth.isLoggedIn) { router.push({ name: "login", query: { redirect: route.fullPath } }); return; }
  if (auth.user?.status === "muted") { ElMessage.warning(currentMuteMessage.value); return; }
  if (replyEditorRef.value?.isContentEmpty()) { ElMessage.warning("请填写回复内容"); return; }
  if (replyText.value.length > REPLY_MAX) { ElMessage.warning("回复内容过长，请精简后再发布"); return; }
  replying.value = true;
  replySubmissionProgress.value = "正在进行内容审核…";
  try {
    if (editingReplyId.value) {
      const editingId = editingReplyId.value;
      try {
        const updated = await replyApi.update(editingId, { content: replyText.value });
        const idx = replies.value.findIndex((item) => item.id === editingId);
        if (idx >= 0) replies.value[idx] = { ...replies.value[idx], ...updated } as any;
        replyText.value = "";
        replyAnonymous.value = false;
        replyDialogOpen.value = false;
        editingReplyId.value = null;
        replyEditorRef.value?.clearDraft();
        ElMessage.success("回复已修改");
      } catch (error) {
        if (!isAmbiguousForumSubmissionError(error)) {
          ElMessage.error(getForumRequestMessage(error) || "保存回复失败，请稍后重试");
          return;
        }
        replySubmissionProgress.value = "连接中断，正在确认保存结果…";
        const currentReplies = topic.value
          ? await topicApi.replies(topic.value.id, { cacheTtlMs: 0, suppressErrorMessage: true }).catch(() => [])
          : [];
        const saved = currentReplies.find((item) => item.id === editingId && item.content === replyText.value);
        if (saved) {
          const idx = replies.value.findIndex((item) => item.id === editingId);
          if (idx >= 0) replies.value[idx] = { ...replies.value[idx], ...saved } as any;
          replyText.value = "";
          replyDialogOpen.value = false;
          editingReplyId.value = null;
          replyEditorRef.value?.clearDraft();
          ElMessage.success("已确认回复修改成功");
          return;
        }
        ElMessage.warning("暂未确认保存结果，回复内容仍保留，可稍后重试");
      }
      return;
    }

    const submissionId = getReplySubmissionId(replySubmissionFingerprint());
    let result: ReplySubmissionResponse | null = null;
    try {
      result = await replyApi.create({
        topicId: topic.value!.id,
        content: replyText.value,
        parentReplyId: replyParentId.value || undefined,
        anonymous: replyAnonymous.value,
        submissionId,
      });
    } catch (error) {
      if (!isAmbiguousForumSubmissionError(error)) {
        clearPendingReplySubmission();
        ElMessage.error(getForumRequestMessage(error) || "回复发布失败，请检查内容后重试");
        return;
      }
      replySubmissionProgress.value = "连接中断，正在确认是否已发布…";
      result = await reconcileForumSubmission(() => replyApi.submissionStatus(submissionId));
      if (!result) {
        ElMessage.warning("暂未确认回复结果，内容已保留；再次发布也不会产生重复回复");
        return;
      }
    }
    await handleReplySubmissionResult(result);
  } finally {
    replying.value = false;
    replySubmissionProgress.value = "";
  }
}

async function removeReply(reply: Reply) {
  if (replyActionBusyId.value !== null) return;
  if (!canEditReply(reply)) return;
  replyActionBusyId.value = reply.id;
  try {
    const confirmed = await ElMessageBox.confirm("确认删除这条回复？", "提示", { type: "warning" })
      .then(() => true)
      .catch(() => false);
    if (!confirmed) return;
    await replyApi.remove(reply.id);
    replies.value = replies.value.filter((item) => item.id !== reply.id);
    if (topic.value && topic.value.replyCount > 0) topic.value.replyCount -= 1;
    if (editingReplyId.value === reply.id) {
      editingReplyId.value = null;
      replyText.value = "";
      replyDialogOpen.value = false;
    }
    ElMessage.success("已删除回复");
  } finally {
    replyActionBusyId.value = null;
  }
}

async function confirmReplyManualReviewRequest() {
  if (!blockedReplyId.value || requestingReplyManualReview.value) return;
  requestingReplyManualReview.value = true;
  try {
    await replyApi.requestManualReview(blockedReplyId.value);
    await auth.fetchMe();
    replyEditorRef.value?.clearDraft();
    replyText.value = "";
    replyAnonymous.value = false;
    replyDialogOpen.value = false;
    replyReviewBlockedOpen.value = false;
    ElMessage.success("已提交回复人工复核申请");
  } finally {
    requestingReplyManualReview.value = false;
  }
}

async function confirmTopicManualReviewRequest() {
  if (!topic.value?.id || !canRequestTopicManualReview.value || requestingTopicManualReview.value) return;
  requestingTopicManualReview.value = true;
  try {
    await topicApi.requestManualReview(topic.value.id);
    await auth.fetchMe();
    topic.value.aiReviewStatus = "manual_requested";
    topicManualReviewConfirmOpen.value = false;
    ElMessage.success("已提交人工复核申请");
  } finally {
    requestingTopicManualReview.value = false;
  }
}

async function approveTopicManualReview() {
  if (!topic.value?.id || !canAdminReviewTopicManual.value || topicAdminReviewAction.value) return;
  topicAdminReviewAction.value = "approved";
  const confirmed = await ElMessageBox.confirm("确认将这篇稿件人工审核通过并公开展示？", "人工通过", {
    type: "warning",
    confirmButtonText: "通过",
    cancelButtonText: "取消",
  }).then(() => true).catch(() => false);
  if (!confirmed) {
    topicAdminReviewAction.value = "";
    return;
  }
  try {
    await adminApi.updateTopic(topic.value.id, {
      aiReviewStatus: "approved_manual",
      manualReviewNote: "管理员在稿件页人工审核通过",
    });
    await refreshTopicAfterAdminReview();
    ElMessage.success("稿件已人工审核通过");
  } finally {
    topicAdminReviewAction.value = "";
  }
}

async function rejectTopicManualReview() {
  if (!topic.value?.id || !canAdminReviewTopicManual.value || topicAdminReviewAction.value) return;
  topicAdminReviewAction.value = "rejected";
  const { value } = await ElMessageBox.prompt("填写驳回说明（选填）", "人工驳回", {
    inputPlaceholder: "例如：仍存在明显人身攻击 / 隐私泄露 / 引流信息",
  }).catch(() => ({ value: null }));
  if (value === null) {
    topicAdminReviewAction.value = "";
    return;
  }
  try {
    await adminApi.updateTopic(topic.value.id, {
      aiReviewStatus: "rejected_manual",
      manualReviewNote: value || "管理员在稿件页人工驳回",
    });
    await refreshTopicAfterAdminReview();
    ElMessage.success("稿件已人工驳回");
  } finally {
    topicAdminReviewAction.value = "";
  }
}

async function openTopicImageReviewDialog() {
  if (!topic.value?.id || !auth.isMod) return;
  topicImageReviewDialogOpen.value = true;
  await loadTopicImageReviewAssets();
}

async function loadTopicImageReviewAssets() {
  if (!topic.value?.id || !auth.isMod) return;
  topicImageReviewLoading.value = true;
  try {
    const response = await adminApi.reviewTargetImages("topic", topic.value.id);
    topicImageReviewAssets.value = response.list;
  } finally {
    topicImageReviewLoading.value = false;
  }
}

async function refreshTopicAfterImageReview() {
  if (!topic.value?.id) return;
  const nextTopic = await loadTopicDetail(topic.value.id);
  if (nextTopic) topic.value = nextTopic;
}

async function openTopicVideoReviewDialog() {
  if (!topic.value?.id || !auth.isMod) return;
  topicVideoReviewDialogOpen.value = true;
  await loadTopicVideoReviewAssets();
}

async function loadTopicVideoReviewAssets() {
  if (!topic.value?.id || !auth.isMod) return;
  topicVideoReviewLoading.value = true;
  try {
    const response = await adminApi.reviewTargetVideos("topic", topic.value.id);
    topicVideoReviewAssets.value = response.list;
  } finally {
    topicVideoReviewLoading.value = false;
  }
}

async function refreshTopicAfterVideoReview() {
  if (!topic.value?.id) return;
  const nextTopic = await loadTopicDetail(topic.value.id);
  if (nextTopic) topic.value = nextTopic;
}

async function refreshTopicAfterAdminReview() {
  if (!topic.value?.id) return;
  const nextTopic = await loadTopicDetail(topic.value.id);
  if (nextTopic) topic.value = nextTopic;
}

async function approveTopicImage(asset: ForumImageReviewAsset) {
  if (topicImageReviewSavingId.value !== null) return;
  topicImageReviewSavingId.value = asset.id;
  topicImageReviewSavingAction.value = "approved";
  const confirmed = await ElMessageBox.confirm("确认将这张图片人工审核通过并恢复展示？", "人工通过", {
    type: "warning",
    confirmButtonText: "通过",
    cancelButtonText: "取消",
  }).then(() => true).catch(() => false);
  if (!confirmed) {
    topicImageReviewSavingId.value = null;
    topicImageReviewSavingAction.value = "";
    return;
  }
  try {
    await adminApi.updateForumImage(asset.id, { status: "approved" });
    await Promise.all([
      refreshTopicAfterImageReview(),
      loadTopicImageReviewAssets(),
    ]);
    ElMessage.success("图片已人工审核通过");
  } finally {
    topicImageReviewSavingId.value = null;
    topicImageReviewSavingAction.value = "";
  }
}

async function rejectTopicImage(asset: ForumImageReviewAsset) {
  if (topicImageReviewSavingId.value !== null) return;
  topicImageReviewSavingId.value = asset.id;
  topicImageReviewSavingAction.value = "rejected";
  const { value } = await ElMessageBox.prompt("可选填写人工驳回备注，留空会保留当前审核说明。", "继续隐藏", {
    inputPlaceholder: "例如：群二维码和群号可直接识别，不适合公开展示",
  }).catch(() => ({ value: null }));
  if (value === null) {
    topicImageReviewSavingId.value = null;
    topicImageReviewSavingAction.value = "";
    return;
  }
  try {
    await adminApi.updateForumImage(asset.id, {
      status: "rejected",
      manualReviewNote: value || undefined,
    });
    await Promise.all([
      refreshTopicAfterImageReview(),
      loadTopicImageReviewAssets(),
    ]);
    ElMessage.success("图片已维持隐藏");
  } finally {
    topicImageReviewSavingId.value = null;
    topicImageReviewSavingAction.value = "";
  }
}

async function approveTopicVideo(asset: ForumVideoReviewAsset) {
  if (topicVideoReviewSavingId.value !== null) return;
  topicVideoReviewSavingId.value = asset.id;
  topicVideoReviewSavingAction.value = "approved";
  const confirmed = await ElMessageBox.confirm("确认将这个视频人工审核通过并恢复展示？", "人工通过", {
    type: "warning",
    confirmButtonText: "通过",
    cancelButtonText: "取消",
  }).then(() => true).catch(() => false);
  if (!confirmed) {
    topicVideoReviewSavingId.value = null;
    topicVideoReviewSavingAction.value = "";
    return;
  }
  try {
    await adminApi.updateForumVideo(asset.id, { status: "approved" });
    await Promise.all([
      refreshTopicAfterVideoReview(),
      loadTopicVideoReviewAssets(),
    ]);
    ElMessage.success("视频已人工审核通过");
  } finally {
    topicVideoReviewSavingId.value = null;
    topicVideoReviewSavingAction.value = "";
  }
}

async function rejectTopicVideo(asset: ForumVideoReviewAsset) {
  if (topicVideoReviewSavingId.value !== null) return;
  topicVideoReviewSavingId.value = asset.id;
  topicVideoReviewSavingAction.value = "rejected";
  const { value } = await ElMessageBox.prompt("可选填写人工驳回备注，留空会保留当前审核说明。", "继续隐藏", {
    inputPlaceholder: "例如：画面中存在可识别隐私信息，不适合公开展示",
  }).catch(() => ({ value: null }));
  if (value === null) {
    topicVideoReviewSavingId.value = null;
    topicVideoReviewSavingAction.value = "";
    return;
  }
  try {
    await adminApi.updateForumVideo(asset.id, {
      status: "rejected",
      manualReviewNote: value || undefined,
    });
    await Promise.all([
      refreshTopicAfterVideoReview(),
      loadTopicVideoReviewAssets(),
    ]);
    ElMessage.success("视频已维持隐藏");
  } finally {
    topicVideoReviewSavingId.value = null;
    topicVideoReviewSavingAction.value = "";
  }
}

function imageReviewStatusLabel(status?: string) {
  if (status === "approved") return "已通过";
  if (status === "rejected") return "已驳回";
  if (status === "error") return "审核异常";
  return "审核中";
}

function imageReviewTagType(status?: string) {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "error") return "warning";
  return "info";
}

function videoReviewStatusLabel(status?: string) {
  if (status === "approved") return "已通过";
  if (status === "manual_review") return "待人工";
  if (status === "rejected") return "已驳回";
  if (status === "error") return "审核异常";
  return "审核中";
}

function videoReviewTagType(status?: string) {
  if (status === "approved") return "success";
  if (status === "manual_review") return "warning";
  if (status === "rejected") return "danger";
  if (status === "error") return "warning";
  return "info";
}

function formatVideoDuration(durationMs?: number | null) {
  if (!durationMs || durationMs <= 0) return "时长未知";
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatVideoResolution(width?: number | null, height?: number | null) {
  if (!width || !height) return "分辨率未知";
  return `${width} × ${height}`;
}

function formatTranscriptStatus(status?: string | null) {
  if (status === "ready") return "已转写";
  if (status === "missing_audio") return "无音轨";
  if (status === "skipped") return "已跳过";
  if (status === "error") return "转写失败";
  if (status === "processing") return "转写中";
  return status || "未知";
}

function stripTextForShare(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function shareViaSystem() {
  if (!topic.value || typeof navigator === "undefined" || typeof navigator.share !== "function") return;
  try {
    await navigator.share({
      title: topic.value.title,
      text: shareSummary.value,
      url: shareLandingUrl.value,
    });
    shareDialogOpen.value = false;
  } catch (error: any) {
    if (error?.name === "AbortError") return;
    ElMessage.error("系统分享暂时不可用，请改用复制链接");
  }
}

async function copyShareLinkOnly() {
  if (!shareLandingUrl.value) return;
  await copyText(shareLandingUrl.value);
  copyShareDialogOpen.value = false;
  ElMessage.success("已复制分享链接");
}

async function copyShareTitleAndLink() {
  if (!topic.value || !shareLandingUrl.value) return;
  await copyText(`${topic.value.title}\n${shareLandingUrl.value}`);
  copyShareDialogOpen.value = false;
  ElMessage.success("已复制标题和链接");
}

function openShareCard() {
  shareCardDialogOpen.value = true;
  void ensureShareCardRendered();
}

function openShareCardImagePreview() {
  if (!shareCardRenderedUrl.value) return;
  shareCardPreviewOpen.value = true;
}

async function ensureShareCardQrCode() {
  if (shareCardQrDataUrl.value) return shareCardQrDataUrl.value;
  const url = shareLandingUrl.value;
  if (!url) return "";
  const seq = ++shareCardQrSeq;
  try {
    const dataUrl = await renderLocalQrDataUrl(url, 220);
    if (seq !== shareCardQrSeq || url !== shareLandingUrl.value) return "";
    shareCardQrDataUrl.value = dataUrl;
    return dataUrl;
  } catch (error) {
    console.warn("[topic] failed to render share card QR code", error);
    return "";
  }
}

async function saveShareCardAsPng() {
  const dataUrl = await ensureShareCardRendered();
  if (!dataUrl) return;
  shareCardSaving.value = true;
  try {
    const nativeBridge = getNativeBridge();
    if (typeof nativeBridge?.saveImage === "function") {
      const ok = nativeBridge.saveImage(dataUrl, shareCardDownloadName.value);
      if (ok !== false) {
        ElMessage.success("图片已开始保存");
        return;
      }
    }
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = shareCardDownloadName.value;
    document.body.appendChild(link);
    link.click();
    link.remove();
    ElMessage.success("图片已开始保存");
  } catch {
    ElMessage.error("保存图片失败，请稍后重试");
  } finally {
    shareCardSaving.value = false;
  }
}

async function ensureShareCardRendered() {
  const exportNode = shareCardExportRef.value;
  if (!exportNode) return "";
  shareCardRendering.value = true;
  try {
    const qrDataUrl = await ensureShareCardQrCode();
    if (!qrDataUrl) {
      ElMessage.error("生成分享二维码失败，请稍后重试");
      return "";
    }
    await nextTick();
    const width = 720;
    const height = Math.ceil(exportNode.scrollHeight);
    const dataUrl = await toPng(exportNode, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      canvasWidth: width,
      canvasHeight: height,
      width,
      height,
    });
    shareCardRenderedUrl.value = dataUrl;
    return dataUrl;
  } catch {
    ElMessage.error("生成分享卡片失败，请稍后重试");
    return "";
  } finally {
    shareCardRendering.value = false;
  }
}

function stripCrawlerSourceHeader(content: string) {
  return content.replace(
    /^>\s*📢\s+\*\*.*?\*\*\s*·\s*发布于\s*\d{4}-\d{2}-\d{2}\s*\n>\s*\n>\s*🔗\s*\[.*?\]\([^)]+\)\s*\n\s*---\s*\n+/s,
    ""
  ).trim();
}

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes("iphone")
    || ua.includes("ipad")
    || ua.includes("ipod")
    || (ua.includes("macintosh") && navigator.maxTouchPoints > 1);
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) return `rgba(22, 135, 118, ${alpha})`;
  const raw = normalized.slice(1);
  const full = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function onEdit() {
  if (isTopicActionBusy.value) return;
  router.push({ name: "edit-post", params: { id: topic.value!.id } });
}

async function runTopicAction(action: TopicAction, task: () => Promise<void>) {
  if (!action || topicActionBusy.value) return;
  topicActionBusy.value = action;
  try {
    await task();
  } finally {
    topicActionBusy.value = "";
  }
}

function applyTopicAuthorModeration(patch: Record<string, unknown>) {
  if (topic.value?.realAuthor) Object.assign(topic.value.realAuthor, patch);
  else if (topic.value?.author) Object.assign(topic.value.author, patch);
}

function replyModerationUser(reply: any) {
  if (reply?.realAuthor) return reply.realAuthor as any;
  if (reply?.author?.id) return reply.author as any;
  return null;
}

function applyReplyAuthorModeration(reply: any, patch: Record<string, unknown>) {
  if (reply?.realAuthor) Object.assign(reply.realAuthor, patch);
  else if (reply?.author) Object.assign(reply.author, patch);
}

async function onPin() {
  await runTopicAction("pin", async () => {
    if (!topic.value) return;
    const nextPinned = !topic.value.pinned;
    await topicApi.update(topic.value.id, { pinned: nextPinned });
    topic.value.pinned = nextPinned;
  });
}
async function onGlobalPin() {
  await runTopicAction("globalPin", async () => {
    if (!topic.value) return;
    const nextGlobalPinned = !topic.value.globalPinned;
    await topicApi.update(topic.value.id, { globalPinned: nextGlobalPinned });
    topic.value.globalPinned = nextGlobalPinned;
  });
}
async function onLock() {
  await runTopicAction("lock", async () => {
    if (!topic.value) return;
    const nextLocked = !topic.value.locked;
    await topicApi.update(topic.value.id, { locked: nextLocked });
    topic.value.locked = nextLocked;
  });
}
async function onDelete() {
  await runTopicAction("delete", async () => {
    if (!topic.value) return;
    const confirmed = await ElMessageBox.confirm("确认删除此帖？此操作不可撤销", "提示", { type: "warning" })
      .then(() => true)
      .catch(() => false);
    if (!confirmed) return;
    await topicApi.remove(topic.value.id);
    ElMessage.success("已删除");
    if (isAnnouncementTopic.value) {
      if (window.history.length > 1) router.back();
      else router.replace("/announcements");
      return;
    }
    router.replace({ name: "forum-latest" });
  });
}
</script>

<style scoped lang="scss" src="./styles/topic-base.scss"></style>
<style scoped lang="scss" src="./styles/topic-main-post.scss"></style>
<style scoped lang="scss" src="./styles/topic-replies.scss"></style>
<style scoped lang="scss" src="./styles/topic-review-reply.scss"></style>
<style scoped lang="scss" src="./styles/topic-share.scss"></style>
<style scoped lang="scss" src="./styles/topic-state.scss"></style>
<style scoped lang="scss" src="./styles/topic-responsive.scss"></style>
