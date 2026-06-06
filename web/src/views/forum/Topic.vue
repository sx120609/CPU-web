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
          <el-button v-if="canEdit" text @click="onEdit">编辑</el-button>
          <el-button v-if="canPin && !isReadOnly" text @click="onPin">{{ topic.pinned ? '取消板块置顶' : '板块置顶' }}</el-button>
          <el-button v-if="canPin && !isReadOnly" text @click="onGlobalPin">{{ topic.globalPinned ? '取消全局置顶' : '全局置顶' }}</el-button>
          <el-button v-if="canPin" text @click="onLock">{{ topic.locked ? '解锁' : '锁帖' }}</el-button>
          <el-button v-if="canEdit" text type="danger" @click="onDelete">删除</el-button>
        </div>
      </header>

      <h1 v-if="!titlelessWeiwall" class="post-title">
        <span v-if="topic.globalPinned" class="badge global-pin">全局置顶</span>
        <span v-if="topic.pinned" class="badge pin">板块置顶</span>
        <span v-if="topic.locked" class="badge lock">🔒</span>
        {{ topic.title }}
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
        <UserAvatar :size="36" class="avatar" :src="topic.author?.avatar" :name="topic.author?.nickname" alt="作者头像" />
        <div class="meta-author">
          <div class="name">
            <router-link v-if="topic.author?.id" :to="`/u/${topic.author.id}`">{{ topic.author?.nickname }}</router-link>
            <span v-else>{{ topic.author?.nickname }}</span>
            <el-tag v-if="topic.isAnonymous" size="small" type="warning" effect="plain">匿名发布</el-tag>
            <el-tag v-if="topic.metadata?.externalPlatform === 'weiwall'" size="small" type="warning">逛逛推流同步</el-tag>
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
      <div v-if="topic.metadata?.sourceUrl" class="source-bar" :class="{ wechat: topic.metadata?.externalType === 'wechat', external: topic.metadata?.externalPlatform === 'weiwall' }">
        <span class="src-icon">{{ topic.metadata?.externalPlatform === 'weiwall' ? '📮' : topic.metadata?.externalType === 'wechat' ? '💬' : '📢' }}</span>
        <span class="src-text-wrap">
          <span class="src-text">
            <template v-if="topic.metadata?.externalPlatform === 'weiwall'">
              来自 <b>{{ topic.metadata.sourceName || "逛逛推流" }}</b> · 发布于 {{ fmtDate(topic.metadata.publishedAt, 'YYYY-MM-DD') }}
            </template>
            <template v-if="topic.metadata?.externalType === 'wechat'">
              原文发布于 <b>微信公众号</b> · {{ fmtDate(topic.metadata.publishedAt, 'YYYY-MM-DD') }}
            </template>
            <template v-else-if="topic.metadata?.externalPlatform !== 'weiwall'">
              来自 <b>{{ topic.metadata.sourceName || topic.board?.name }}</b>
              · 发布于 {{ fmtDate(topic.metadata.publishedAt, 'YYYY-MM-DD') }}
            </template>
          </span>
          <span v-if="sourceNotice" class="src-notice">{{ sourceNotice }}</span>
        </span>
        <a :href="topic.metadata.sourceUrl" target="_blank" class="src-link">
          <el-icon><Link /></el-icon>
          {{ topic.metadata?.externalPlatform === 'weiwall' ? '前往逛逛推流原帖' : topic.metadata?.externalType === 'wechat' ? '前往微信阅读全文' : '在学校原站查看' }}
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
            @click="approveTopicManualReview"
          >
            人工通过
          </el-button>
          <el-button
            type="danger"
            plain
            :loading="topicAdminReviewAction === 'rejected'"
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
          <el-button type="warning" :loading="requestingTopicManualReview" @click="topicManualReviewConfirmOpen = true">申请人工复核</el-button>
        </div>
      </div>
      <div v-else-if="isOwnTopicManualReviewPending" class="topic-review-tip cpu-card topic-review-tip-pending">
        <p>这篇稿件已提交人工复核，当前仅你自己和管理员可见。请耐心等待审核结果。</p>
      </div>

      <MarkdownView :content="displayContent" class="post-body topic-markdown" clickable-images media-loading="eager" />

      <footer class="post-foot">
        <el-button :type="liked ? 'primary' : 'default'" :icon="Star" @click="onLike">
          {{ liked ? '已点赞' : '点赞' }} · {{ topic.likeCount }}
        </el-button>
        <el-button :icon="ChatLineRound" @click="openReplyDialog">回复 · {{ topic.replyCount }}</el-button>
        <el-button @click="shareDialogOpen = true">分享</el-button>
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
          <UserAvatar :size="32" class="avatar" :src="entry.item.author?.avatar" :name="entry.item.author?.nickname" alt="回复头像" />
          <div class="reply-body">
            <div class="reply-meta">
              <span class="floor">#{{ entry.item.floor }}</span>
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
            <MarkdownView :content="entry.item.content" class="reply-content topic-markdown reply-markdown" clickable-images media-loading="eager" />
            <div class="reply-actions">
              <el-button text size="small" @click="quoteReply(entry.item)">引用</el-button>
              <el-button v-if="canEditReply(entry.item)" text size="small" @click="editReply(entry.item)">编辑</el-button>
              <el-button v-if="canEditReply(entry.item)" text size="small" type="danger" @click="removeReply(entry.item)">删除</el-button>
              <el-button text size="small" @click="onLikeReply(entry.item)">👍 {{ entry.item.likeCount }}</el-button>
            </div>
          </div>
        </div>
      </template>
    </section>

    <el-dialog
      v-if="canReply"
      v-model="replyDialogOpen"
      title="回复"
      width="min(720px, calc(100vw - 24px))"
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
        <span class="cpu-muted">离开页面后会保留未发送的内容。</span>
        <div class="reply-submit-actions">
          <el-button v-if="editingReplyId" @click="cancelReplyEdit">取消编辑</el-button>
          <el-button type="primary" :loading="replying" @click="submitReply">
            {{ editingReplyId ? "保存修改" : "发布回复" }}
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
    width="min(460px, calc(100vw - 24px))"
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
      width="min(520px, calc(100vw - 24px))"
      append-to-body
      class="share-card-preview-dialog"
    >
      <img v-if="shareCardRenderedUrl" :src="shareCardRenderedUrl" alt="分享卡片大图" loading="lazy" decoding="async" fetchpriority="low" class="share-card-preview-image" />
      <p v-if="isNativeAppClient" class="share-card-tip">客户端请放大后截图保存。</p>
    </el-dialog>

    <el-dialog
      v-model="topicImageReviewDialogOpen"
      title="图片人工复核"
      width="min(920px, calc(100vw - 24px))"
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
                  @click="approveTopicImage(asset)"
                >
                  人工通过
                </el-button>
                <el-button
                  type="danger"
                  plain
                  size="small"
                  :loading="topicImageReviewSavingId === asset.id && topicImageReviewSavingAction === 'rejected'"
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
      width="min(920px, calc(100vw - 24px))"
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
                  @click="approveTopicVideo(asset)"
                >
                  人工通过
                </el-button>
                <el-button
                  type="danger"
                  plain
                  size="small"
                  :loading="topicVideoReviewSavingId === asset.id && topicVideoReviewSavingAction === 'rejected'"
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
            <div class="share-card-board">{{ topic?.board?.name || "药大拾间" }}</div>
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
            <div class="share-card-brand-host">cpu.lizmt.cn</div>
          </div>
          <div class="share-card-qr-box">
            <img :src="shareCardQrDataUrl" alt="分享二维码" loading="lazy" decoding="async" fetchpriority="low" class="share-card-qr" />
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
        <el-button type="warning" :loading="requestingReplyManualReview" @click="replyManualReviewConfirmOpen = true">申请人工复核</el-button>
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
      <el-empty description="帖子不存在或暂时不可见" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AxiosError } from "axios";
import { ElMessage, ElMessageBox } from "element-plus";
import { toPng } from "html-to-image";
import { ArrowLeft, Star, ChatLineRound, Link } from "@element-plus/icons-vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import UserModerationActions from "@/components/common/UserModerationActions.vue";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";
import MarkdownView from "@/components/forum/MarkdownView.vue";
import RichTextEditor from "@/components/forum/RichTextEditor.vue";
import ManualReviewConfirmDialog from "@/components/forum/ManualReviewConfirmDialog.vue";
import { topicApi, replyApi, likeApi, type Topic, type Reply } from "@/api/topic";
import { adminApi, type ForumImageReviewAsset, type ForumVideoReviewAsset } from "@/api/admin";
import { useAuthStore } from "@/stores/auth";
import { fmtDate, fmtRelative } from "@/utils/format";
import { copyText } from "@/utils/userGroup";
import { isAndroidNativeApp, isHarmonyNativeApp } from "@/utils/clientInfo";
import { getNativeBridge, hasNativeImageSaveBridge } from "@/utils/nativeBridge";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const topic = ref<Topic | null>(null);
const replies = ref<Reply[]>([]);
const loading = ref(false);
const repliesLoading = ref(false);
const replying = ref(false);
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
const blockedReplyId = ref<number | null>(null);
const blockedReplyInfo = reactive<{ reason: string; riskScore: number | null }>({
  reason: "",
  riskScore: null,
});
const liked = ref(false);
const repliesEl = ref<HTMLElement | null>(null);
const replyEditorRef = ref<InstanceType<typeof RichTextEditor> | null>(null);
const shareCardExportRef = ref<HTMLElement | null>(null);
const REPLY_MAX = 10000;

const metaPrice = computed(() => topic.value?.metadata?.price);
const hotScore = computed(() => Math.round((topic.value?.likeCount ?? 0) * 5 + (topic.value?.replyCount ?? 0) * 3 + (topic.value?.viewCount ?? 0) * 0.03));
const isReadOnly = computed(() => topic.value?.board?.readOnly);
const topicModerationUser = computed(() => {
  if (topic.value?.realAuthor) return topic.value.realAuthor as any;
  if (topic.value?.author?.id) return topic.value.author as any;
  return null;
});
const canReply = computed(() =>
  auth.isLoggedIn && !topic.value?.locked && auth.user?.status !== "muted"
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
  auth.user?.id === topic.value?.authorId ||
  auth.isAdmin ||
  (auth.isMod && !isReadOnly.value)
);
const canRequestTopicManualReview = computed(() => Boolean(
  auth.isLoggedIn &&
  auth.user?.id === topic.value?.authorId &&
  topic.value?.hidden &&
  topic.value?.aiReviewStatus === "blocked_ai"
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
  return raw ? raw.slice(0, 80) : `来自 ${topic.value?.board?.name || "药大拾间"} 的帖子`;
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
  const board = topic.value?.board?.name || "药大拾间";
  const author = topic.value?.author?.nickname || "同学";
  return `${board} · ${author}`;
});
const shareCardStats = computed(() => `${topic.value?.replyCount ?? 0} 条回复 · ${topic.value?.viewCount ?? 0} 浏览`);
const shareCardQrDataUrl = computed(() => {
  if (!topic.value) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(shareLandingUrl.value)}`;
});
const displayContent = computed(() => {
  const content = topic.value?.content ?? "";
  if (!topic.value?.metadata?.sourceUrl) return content;
  return stripCrawlerSourceHeader(content);
});
const sourceNotice = computed(() => {
  if (!topic.value?.metadata?.sourceUrl) return "";
  if (topic.value?.metadata?.externalPlatform === "weiwall") {
    return "这是逛逛推流镜像内容，不参与本站热榜和最新流；如遇评论未补齐或正文异常，可前往原帖查看。";
  }
  if (topic.value?.metadata?.externalType === "wechat") {
    return "微信文章可能无法在站内完整展示，建议前往微信阅读全文。";
  }
  const compact = displayContent.value.replace(/\s/g, "");
  if (!compact || /未能提取正文|正文为微信公众号文章/.test(displayContent.value)) {
    return "如果正文为空、排版异常或无法查看正常内容，建议前往学校原站查看。";
  }
  return "如遇正文缺失、附件打不开或排版异常，可前往学校原站查看。";
});

const isCampusWallTopic = computed(() => topic.value?.board?.slug === "campus-wall" || topic.value?.metadata?.externalPlatform === "weiwall");
const isAnnouncementTopic = computed(() => topic.value?.board?.type === "announce");
const titlelessWeiwall = computed(() => isCampusWallTopic.value && (!topic.value?.title || topic.value?.title === "none"));
const backLabel = computed(() => {
  if (isCampusWallTopic.value) return "返回逛逛推流";
  if (isAnnouncementTopic.value) return "返回上页";
  return "返回最新";
});

function goBackFromTopic() {
  if (isCampusWallTopic.value) {
    router.push("/forum/b/campus-wall");
    return;
  }
  if (isAnnouncementTopic.value) {
    if (window.history.length > 1) router.back();
    else router.replace("/announcements");
    return;
  }
  router.push({ name: "forum-latest" });
}

onMounted(async () => { await load(); });

watch(replyAnonymousEnabled, (enabled) => {
  if (!enabled) replyAnonymous.value = false;
}, { immediate: true });

watch(replyDialogOpen, (open) => {
  if (!open && !replying.value) {
    replyAnonymous.value = false;
    editingReplyId.value = null;
    replyParentId.value = null;
  }
});

async function load() {
  loading.value = true;
  repliesLoading.value = true;
  replies.value = [];
  liked.value = false;
  try {
    const id = Number(route.params.id);
    const topicPromise = loadTopicDetail(id)
      .then((result) => {
        topic.value = result;
        return result;
      })
      .finally(() => {
        loading.value = false;
      });
    const repliesPromise = topicApi.replies(id)
      .catch((error: AxiosError) => {
        if (error.response?.status === 403) {
          router.replace({ name: "forum", query: { redirect: route.fullPath } });
        }
        return [];
      })
      .then((result) => {
        replies.value = result;
        return result;
      })
      .finally(() => {
        repliesLoading.value = false;
      });
    const [nextTopic, nextReplies] = await Promise.all([topicPromise, repliesPromise]);
    if (!nextTopic) {
      replies.value = [];
      return;
    }
    // 我是否赞过
    if (auth.isLoggedIn) {
      const mine = await likeApi.mine([id], nextReplies.map((r) => r.id));
      liked.value = mine.topics.includes(id);
      // 标记每条回复 liked
      const set = new Set(mine.replies);
      nextReplies.forEach((r: any) => (r._liked = set.has(r.id)));
    }
  } finally {
    loading.value = false;
    repliesLoading.value = false;
  }
}

async function loadTopicDetail(id: number) {
  return topicApi.detail(id).catch((error: AxiosError) => {
    if (error.response?.status === 403) {
      router.replace({ name: "forum", query: { redirect: route.fullPath } });
    }
    return null;
  });
}

async function onLike() {
  if (!auth.isLoggedIn) { router.push({ name: "login", query: { redirect: route.fullPath } }); return; }
  const r = await likeApi.toggleTopic(topic.value!.id);
  liked.value = r.liked;
  if (topic.value) topic.value.likeCount = r.likeCount;
}

async function onLikeReply(reply: any) {
  if (!auth.isLoggedIn) { router.push({ name: "login", query: { redirect: route.fullPath } }); return; }
  const r = await likeApi.toggleReply(reply.id);
  reply.likeCount = r.likeCount;
  reply._liked = r.liked;
}

function quoteReply(r: Reply) {
  if (!openReplyDialog()) return;
  replyParentId.value = r.id;
  const quoted = `<blockquote><p>@${escapeHtml(r.author?.nickname || "同学")} 在 #${r.floor} 楼：</p>${r.content}</blockquote><p><br></p>`;
  replyText.value = `${replyText.value || ""}${quoted}`;
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
  if (auth.user?.status === "muted") {
    ElMessage.warning(currentMuteMessage.value);
    return false;
  }
  replyDialogOpen.value = true;
  return true;
}

async function submitReply() {
  if (!auth.isLoggedIn) { router.push({ name: "login", query: { redirect: route.fullPath } }); return; }
  if (auth.user?.status === "muted") { ElMessage.warning(currentMuteMessage.value); return; }
  if (replyEditorRef.value?.isContentEmpty()) { ElMessage.warning("请填写回复内容"); return; }
  if (replyText.value.length > REPLY_MAX) { ElMessage.warning("回复内容过长，请精简后再发布"); return; }
  replying.value = true;
  try {
    if (editingReplyId.value) {
      const updated = await replyApi.update(editingReplyId.value, { content: replyText.value });
      const idx = replies.value.findIndex((item) => item.id === editingReplyId.value);
      if (idx >= 0) replies.value[idx] = { ...replies.value[idx], ...updated } as any;
      replyText.value = "";
      replyAnonymous.value = false;
      replyDialogOpen.value = false;
      editingReplyId.value = null;
      replyEditorRef.value?.clearDraft();
      ElMessage.success("回复已修改");
      return;
    }
    const r = await replyApi.create({
      topicId: topic.value!.id,
      content: replyText.value,
      parentReplyId: replyParentId.value || undefined,
      anonymous: replyAnonymous.value,
    });
    if (replyAnonymous.value) await auth.fetchMe();
    if ((r as any).submissionResult?.status === "blocked_ai") {
      blockedReplyId.value = (r as any).id ?? null;
      blockedReplyInfo.reason = (r as any).submissionResult.reason || "检测到较高风险内容";
      blockedReplyInfo.riskScore = (r as any).submissionResult.riskScore ?? null;
      replyReviewBlockedOpen.value = true;
      ElMessage.warning("回复暂未通过审核");
      return;
    }
    replies.value.push({ ...r, _liked: false } as any);
    replyText.value = "";
    replyAnonymous.value = false;
    replyParentId.value = null;
    replyDialogOpen.value = false;
    replyEditorRef.value?.clearDraft();
    if (topic.value) topic.value.replyCount += 1;
    ElMessage.success("已发布");
    nextTick(() => repliesEl.value?.scrollIntoView({ behavior: "smooth", block: "end" }));
  } finally { replying.value = false; }
}

async function removeReply(reply: Reply) {
  if (!canEditReply(reply)) return;
  await ElMessageBox.confirm("确认删除这条回复？", "提示", { type: "warning" });
  await replyApi.remove(reply.id);
  replies.value = replies.value.filter((item) => item.id !== reply.id);
  if (topic.value && topic.value.replyCount > 0) topic.value.replyCount -= 1;
  if (editingReplyId.value === reply.id) {
    editingReplyId.value = null;
    replyText.value = "";
    replyDialogOpen.value = false;
  }
  ElMessage.success("已删除回复");
}

async function confirmReplyManualReviewRequest() {
  if (!blockedReplyId.value) return;
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
  if (!topic.value?.id || !canRequestTopicManualReview.value) return;
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
  if (!topic.value?.id || !canAdminReviewTopicManual.value) return;
  await ElMessageBox.confirm("确认将这篇稿件人工审核通过并公开展示？", "人工通过", {
    type: "warning",
    confirmButtonText: "通过",
    cancelButtonText: "取消",
  });
  topicAdminReviewAction.value = "approved";
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
  if (!topic.value?.id || !canAdminReviewTopicManual.value) return;
  const { value } = await ElMessageBox.prompt("填写驳回说明（选填）", "人工驳回", {
    inputPlaceholder: "例如：仍存在明显人身攻击 / 隐私泄露 / 引流信息",
  }).catch(() => ({ value: null }));
  if (value === null) return;
  topicAdminReviewAction.value = "rejected";
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
  await ElMessageBox.confirm("确认将这张图片人工审核通过并恢复展示？", "人工通过", {
    type: "warning",
    confirmButtonText: "通过",
    cancelButtonText: "取消",
  });
  topicImageReviewSavingId.value = asset.id;
  topicImageReviewSavingAction.value = "approved";
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
  const { value } = await ElMessageBox.prompt("可选填写人工驳回备注，留空会保留当前审核说明。", "继续隐藏", {
    inputPlaceholder: "例如：群二维码和群号可直接识别，不适合公开展示",
  }).catch(() => ({ value: null }));
  if (value === null) return;
  topicImageReviewSavingId.value = asset.id;
  topicImageReviewSavingAction.value = "rejected";
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
  await ElMessageBox.confirm("确认将这个视频人工审核通过并恢复展示？", "人工通过", {
    type: "warning",
    confirmButtonText: "通过",
    cancelButtonText: "取消",
  });
  topicVideoReviewSavingId.value = asset.id;
  topicVideoReviewSavingAction.value = "approved";
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
  const { value } = await ElMessageBox.prompt("可选填写人工驳回备注，留空会保留当前审核说明。", "继续隐藏", {
    inputPlaceholder: "例如：画面中存在可识别隐私信息，不适合公开展示",
  }).catch(() => ({ value: null }));
  if (value === null) return;
  topicVideoReviewSavingId.value = asset.id;
  topicVideoReviewSavingAction.value = "rejected";
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

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  router.push({ name: "edit-post", params: { id: topic.value!.id } });
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
  await topicApi.update(topic.value!.id, { pinned: !topic.value!.pinned });
  topic.value!.pinned = !topic.value!.pinned;
}
async function onGlobalPin() {
  await topicApi.update(topic.value!.id, { globalPinned: !topic.value!.globalPinned });
  topic.value!.globalPinned = !topic.value!.globalPinned;
}
async function onLock() {
  await topicApi.update(topic.value!.id, { locked: !topic.value!.locked });
  topic.value!.locked = !topic.value!.locked;
}
async function onDelete() {
  await ElMessageBox.confirm("确认删除此帖？此操作不可撤销", "提示", { type: "warning" });
  await topicApi.remove(topic.value!.id);
  ElMessage.success("已删除");
  if (isCampusWallTopic.value) {
    router.replace("/forum/b/campus-wall");
    return;
  }
  if (isAnnouncementTopic.value) {
    if (window.history.length > 1) router.back();
    else router.replace("/announcements");
    return;
  }
  router.replace({ name: "forum-latest" });
}
</script>

<style scoped lang="scss">
.topic-page { display: flex; flex-direction: column; gap: 16px; }

.cpu-card { background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

.topic-page-loading,
.topic-page-empty {
  min-height: 360px;
}

.topic-skeleton-card {
  .el-skeleton {
    width: 100%;
  }
}

.topic-skeleton-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.topic-skeleton-back {
  width: 120px;
}

.topic-skeleton-actions {
  display: flex;
  gap: 10px;
}

.topic-skeleton-title {
  width: min(100%, 480px);
  height: 30px;
  margin-bottom: 18px;
}

.topic-skeleton-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}

.topic-skeleton-avatar {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.topic-skeleton-meta-copy {
  flex: 1;
}

.topic-skeleton-author {
  width: 160px;
  margin-bottom: 8px;
}

.topic-skeleton-submeta {
  width: min(100%, 280px);
}

.topic-skeleton-body {
  display: grid;
  gap: 10px;
}

.topic-skeleton-line:last-child {
  width: 72%;
}

.main-post {
  .post-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .board-back {
    display: flex; align-items: center; gap: 4px;
    color: var(--cpu-primary);
    font-size: 14px;
    text-decoration: none;
  }
  .board-back-btn {
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
  }
  .actions { display: flex; gap: 4px; }

  .post-title {
    margin: 8px 0 12px;
    font-size: 24px;
    color: #1f2937;
    line-height: 1.4;
  }

  .topic-tags {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin: -4px 0 12px;
  }

  .badge {
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 4px;
    margin-right: 6px;
    vertical-align: middle;
  }
  .global-pin { background: #fef3c7; color: #b45309; }
  .pin { background: #fee2e2; color: #dc2626; }
  .lock { background: #f3f4f6; color: #6b7280; }

  .post-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
    .avatar { background: var(--cpu-primary); color: #fff; font-weight: 600; }
    .meta-author { flex: 1; }
    .name { font-size: 14px; font-weight: 500; color: #1f2937; display: flex; gap: 6px; align-items: center; }
    .name a { color: var(--cpu-primary); text-decoration: none; }
    .real-author-line { font-size: 12px; color: #6b7280; margin-top: 2px; }
    .meta { font-size: 12px; color: #9ca3af; margin-top: 2px; }
    .meta-price { font-size: 22px; color: #ef4444; font-weight: 700; }
  }

  .extra-bar {
    display: flex; gap: 16px; flex-wrap: wrap;
    background: #f9fafb;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
    color: #4b5563;
    margin-bottom: 14px;
    a { color: var(--cpu-primary); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
  }
  .extra-bar.ratings { background: #ecfdf5; }

  .source-bar {
    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
    border-left: 4px solid #d97706;
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
    font-size: 13px;
    color: #92400e;
  }
  .source-bar.wechat {
    background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%);
    border-left-color: #22c55e;
    color: #166534;
  }
  .source-bar.wechat .src-link { color: #166534 !important; border-color: #bbf7d0; }
  .source-bar.wechat .src-link:hover { background: #dcfce7; }
  .source-bar.wechat .src-text b { color: #15803d; }
  .src-icon { font-size: 18px; }
  .src-text-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .src-text { display: block; }
  .src-text b { color: #b45309; }
  .src-notice {
    display: block;
    font-size: 12px;
    line-height: 1.45;
    color: #a16207;
  }
  .source-bar.wechat .src-notice { color: #15803d; }
  .src-link {
    background: #fff;
    color: #b45309 !important;
    padding: 6px 12px;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid #fde68a;
    transition: background 0.15s;
  }
  .src-link:hover {
    background: #fef3c7;
  }

.post-body { padding: 4px 0; }

.image-review-tip {
  margin-top: 12px;
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.image-review-tip-pending {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  color: #9a3412;
}

.image-review-tip-rejected {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
}

.topic-review-tip {
  margin-top: 12px;
}

.topic-admin-review-tip {
  margin-top: 12px;
  border: 1px solid #bbf7d0;
  background: #f0fdf4;
}

.topic-review-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.topic-review-tip-pending {
  border: 1px solid #fed7aa;
  background: #fff7ed;
  color: #9a3412;
}

.post-foot {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px dashed #e5e7eb;
    display: flex;
    gap: 8px;
  }
}

.replies {
  .replies-loading {
    display: grid;
    gap: 16px;
  }

  .reply {
    display: flex;
    gap: 12px;
    padding: 14px 0;
    border-bottom: 1px dashed #f1f5f9;
    scroll-margin-top: 96px;
  }
  .reply.nested {
    position: relative;
    padding-left: 12px;
  }
  .reply.nested::before {
    content: "";
    position: absolute;
    left: 0;
    top: 16px;
    bottom: 16px;
    width: 3px;
    border-radius: 999px;
    background: linear-gradient(180deg, #cbd5e1 0%, #e2e8f0 100%);
  }
  .reply:target {
    border-radius: 14px;
    padding-inline: 12px;
    margin-inline: -12px;
    background: linear-gradient(180deg, #fffaf0 0%, #ffffff 100%);
    box-shadow: 0 0 0 1px #fde68a inset;
  }
  .reply:last-child { border-bottom: none; }
  .avatar { background: var(--cpu-primary); color: #fff; font-weight: 600; flex-shrink: 0; }
  .reply-body { flex: 1; min-width: 0; }
  .reply-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 4px;
  }
  .floor { color: #9ca3af; }
  .author { color: var(--cpu-primary); text-decoration: none; font-weight: 500; }
  .real-author-inline { color: #6b7280; }
  .reply-parent-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    color: #475569;
  }
  .dot { color: #d1d5db; }
  .reply-content { font-size: 14px; }
  .reply-actions {
    margin-top: 6px;
    display: flex;
    gap: 4px;
  }
}

.reply-target-bar {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #bfdbfe;
  background: linear-gradient(180deg, #eff6ff 0%, #f8fbff 100%);
  color: #1d4ed8;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.topic-image-review-panel {
  min-height: 160px;
}

.topic-video-review-panel {
  min-height: 160px;
}

.topic-image-review-copy {
  margin: 0 0 14px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}

.topic-video-review-copy {
  margin: 0 0 14px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}

.topic-image-review-list {
  display: grid;
  gap: 14px;
}

.topic-video-review-list {
  display: grid;
  gap: 14px;
}

.topic-image-review-card {
  display: grid;
  grid-template-columns: minmax(180px, 240px) 1fr;
  gap: 16px;
  padding: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #fff;
}

.topic-video-review-card {
  display: grid;
  grid-template-columns: minmax(220px, 300px) 1fr;
  gap: 16px;
  padding: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #fff;
}

.topic-image-review-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  overflow: hidden;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  padding: 10px;
  min-height: 220px;
}

.topic-video-review-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  overflow: hidden;
  background: #020617;
  border: 1px solid #e5e7eb;
  min-height: 220px;
}

.topic-image-review-preview img {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: min(70vh, 560px);
  object-fit: contain;
}

.topic-video-review-preview video {
  display: block;
  width: 100%;
  max-height: min(70vh, 560px);
  background: #000;
}

:deep(.topic-image-review-dialog .el-dialog__body) {
  max-height: calc(100vh - 180px);
  overflow-y: auto;
  display: block;
}

:deep(.topic-video-review-dialog .el-dialog__body) {
  max-height: calc(100vh - 180px);
  overflow-y: auto;
  display: block;
}

.topic-image-review-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.topic-video-review-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.topic-image-review-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.topic-video-review-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.topic-image-review-auditor,
.topic-image-review-time {
  color: #6b7280;
  font-size: 12px;
}

.topic-video-review-auditor,
.topic-video-review-time {
  color: #6b7280;
  font-size: 12px;
}

.topic-image-review-line {
  margin: 0;
  color: #111827;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.topic-video-review-line {
  margin: 0;
  color: #111827;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.topic-image-review-error {
  color: #b45309;
}

.topic-video-review-error {
  color: #b45309;
}

.topic-image-review-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: 6px;
}

.topic-video-review-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: 6px;
}

.reply-form-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
}

.reply-submit-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.reply-anonymous-box {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #ebe8ff;
  border-radius: 12px;
  background: linear-gradient(180deg, #faf7ff 0%, #ffffff 100%);
  margin-bottom: 14px;
}

.reply-anonymous-box.disabled {
  opacity: 0.78;
}

.reply-anonymous-copy {
  min-width: 0;
}

.reply-anonymous-copy b {
  display: block;
  font-size: 14px;
  color: #4c1d95;
  margin-bottom: 4px;
}

.reply-anonymous-copy p {
  margin: 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}

.reply-dialog-actions {
  margin-top: 16px;
}

:deep(.reply-dialog .el-dialog__body) {
  padding-top: 12px;
}

:deep(.reply-dialog .rich-editor) {
  margin-top: 0;
}

:deep(.reply-dialog .rich-editor.toolbar-static) {
  border-radius: 20px;
  box-shadow: none;
  border-color: #e8edf3;
}

:deep(.reply-dialog .rich-editor.toolbar-static .editor-toolbar) {
  border-radius: 20px 20px 0 0;
}

:deep(.reply-dialog .rich-editor.toolbar-static .editor-surface) {
  background: #fff;
}

:deep(.reply-dialog .rich-editor.toolbar-static .editor-foot) {
  border-radius: 0 0 20px 20px;
}

.share-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 340px;
  margin: 0 auto;
}

.copy-share-panel,
.share-card-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 340px;
  margin: 0 auto;
  width: 100%;
}

.share-copy {
  margin: 0;
  color: #667085;
  font-size: 13px;
  line-height: 1.6;
}

.share-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  width: 100%;
}

.share-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  width: 100%;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
}

.share-card-image {
  width: 100%;
  border-radius: 22px;
  border: 1px solid #e6edf5;
  background: #fff;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
}

.share-card-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.share-card-save-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  width: 100%;
  padding: 0 14px;
  border: none;
  border-radius: 14px;
  background: var(--cpu-primary);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.copy-share-panel .share-action-btn,
.share-panel .share-action-btn,
.share-card-actions .share-card-save-link {
  box-sizing: border-box;
  box-shadow: none;
}

.share-actions :deep(.el-button),
.copy-share-panel :deep(.el-button) {
  margin-left: 0 !important;
}

.share-panel .share-action-btn {
  background: #f8fafc;
  border-color: #dbe5ee;
  color: #344054;
}

.share-panel :deep(.el-button--primary.share-action-btn) {
  background: var(--cpu-primary);
  border-color: var(--cpu-primary);
  color: #fff;
}

.share-panel :deep(.el-button--primary.is-plain.share-action-btn),
.copy-share-panel :deep(.el-button--primary.is-plain.share-action-btn) {
  background: #ecfdf5;
  border-color: #cce9df;
  color: #0f766e;
}

.copy-share-panel .share-action-btn {
  background: #fff;
  border-color: #dbe5ee;
  color: #344054;
}

.share-card-save-link:disabled {
  opacity: 0.66;
  cursor: wait;
}

.share-card-dom {
  width: 100%;
  max-width: 100%;
  padding: 24px;
  border-radius: 24px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
  border: 1px solid #e7eef7;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
  box-sizing: border-box;
}

.share-card-dom--export {
  width: 720px;
  border-radius: 0;
  box-shadow: none;
  border: none;
}

.share-card-export-shell {
  position: fixed;
  left: -99999px;
  top: -99999px;
  width: 720px;
  pointer-events: none;
  opacity: 0;
}

.share-card-loading {
  min-height: 240px;
  display: grid;
  place-items: center;
  color: #667085;
  font-size: 14px;
}

.share-card-tip {
  margin: 0;
  color: #b45309;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}

.share-card-preview-image {
  width: 100%;
  display: block;
  border-radius: 18px;
  border: 1px solid #e6edf5;
  background: #fff;
}

.share-card-top {
  display: flex;
  align-items: center;
  gap: 14px;
}

.share-card-icon {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 34px;
  flex-shrink: 0;
}

.share-card-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.share-card-board {
  font-size: 20px;
  font-weight: 800;
  color: #111827;
}

.share-card-subtitle,
.share-card-stats {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.5;
}

.share-card-hero {
  position: relative;
  margin-top: 18px;
  min-height: 260px;
  padding: 26px 22px;
  border-radius: 24px;
  overflow: hidden;
}

.share-card-hero-orb {
  position: absolute;
  right: 26px;
  top: 18px;
  width: 126px;
  height: 126px;
  border-radius: 999px;
}

.share-card-hero-line {
  width: 88px;
  height: 10px;
  border-radius: 999px;
  margin-bottom: 22px;
}

.share-card-title {
  position: relative;
  margin: 0;
  font-size: 48px;
  line-height: 1.5;
  font-weight: 850;
  color: #172033;
  word-break: break-word;
}

.share-card-subcopy {
  position: relative;
  margin: 18px 0 0;
  font-size: 16px;
  line-height: 1.5;
  color: #667085;
}

.share-card-bottom {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #e9eef5;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
}

.share-card-brand {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.share-card-brand-title {
  font-size: 34px;
  line-height: 1.5;
  font-weight: 850;
  color: #172033;
}

.share-card-brand-copy {
  font-size: 16px;
  line-height: 1.5;
  color: #667085;
}

.share-card-brand-host {
  font-size: 14px;
  line-height: 1.5;
  color: #9ca3af;
}

.share-card-qr-box {
  width: 132px;
  height: 132px;
  padding: 10px;
  border-radius: 20px;
  background: #fff;
  border: 1px solid #e2e8f0;
  flex-shrink: 0;
  box-sizing: border-box;
}

.share-card-qr {
  width: 100%;
  height: 100%;
  display: block;
}

:deep(.share-dialog .el-dialog),
:deep(.copy-share-dialog .el-dialog),
:deep(.share-card-dialog .el-dialog) {
  border-radius: 22px;
}

:deep(.share-card-dialog .el-dialog__body) {
  padding-top: 14px;
}

.locked-tip, .login-tip {
  text-align: center;
  color: #6b7280;
  font-size: 14px;
  padding: 24px;
  a { color: var(--cpu-primary); margin: 0 4px; }
  p { margin: 0; }
}

.review-blocked p {
  margin: 0 0 10px;
  line-height: 1.7;
  color: #374151;
}

.review-blocked p:last-child {
  margin-bottom: 0;
}

:deep(.reply-dialog .el-dialog) {
  border-radius: 18px;
}

.cpu-section-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.cpu-muted { font-size: 12px; color: #9ca3af; }

@media (max-width: 700px) {
  .topic-page {
    gap: 12px;
  }

  .topic-skeleton-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .topic-skeleton-actions {
    width: 100%;
  }

  .cpu-card {
    border-radius: 10px;
    padding: 14px;
  }

  .main-post {
    .post-head {
      align-items: flex-start;
      gap: 8px;
      flex-direction: column;
    }

    .actions {
      width: 100%;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .actions::-webkit-scrollbar {
      display: none;
    }

    .post-title {
      font-size: 20px;
      line-height: 1.45;
      word-break: break-word;
    }

    .post-meta {
      align-items: flex-start;
      gap: 10px;
      flex-wrap: wrap;

      .meta-author {
        min-width: 0;
      }

      .name,
      .meta {
        flex-wrap: wrap;
        line-height: 1.5;
      }

      .meta-price {
        width: 100%;
        font-size: 20px;
      }
    }

    .source-bar {
      align-items: flex-start;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
    }

    .src-link {
      width: 100%;
      justify-content: center;
    }

    .extra-bar {
      gap: 8px;
      padding: 10px 12px;
    }

    .post-foot {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .replies {
    .reply {
      gap: 10px;
      padding: 12px 0;
    }

    .reply-meta {
      flex-wrap: wrap;
      line-height: 1.5;
    }
  }

  .reply-form-actions {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .reply-submit-actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .reply-form-actions .el-button,
  .reply-submit-actions .el-button {
    width: 100%;
  }

  .share-actions {
    grid-template-columns: 1fr;
  }

  .share-card-actions {
    grid-template-columns: 1fr;
  }

  .topic-image-review-card {
    grid-template-columns: 1fr;
  }

  .topic-video-review-card {
    grid-template-columns: 1fr;
  }

  .reply-anonymous-box {
    padding: 12px;
  }

  :deep(.reply-dialog .rich-editor.toolbar-static) {
    border-radius: 16px;
  }

  :deep(.reply-dialog .rich-editor.toolbar-static .editor-toolbar) {
    border-radius: 16px 16px 0 0;
    padding: 8px 8px 6px;
  }

  :deep(.reply-dialog .rich-editor.toolbar-static .editor-foot) {
    border-radius: 0 0 16px 16px;
  }

  :deep(.reply-dialog .rich-editor.toolbar-static .toolbar-head) {
    display: none;
  }

  :deep(.reply-dialog .rich-editor.toolbar-static .toolbar-scroll) {
    gap: 6px;
  }

  :deep(.reply-dialog .rich-editor.toolbar-static .toolbar-group) {
    flex: 0 1 auto;
    gap: 4px;
    padding: 6px;
    border-radius: 10px;
  }

  :deep(.reply-dialog .rich-editor.toolbar-static .toolbar-group + .toolbar-group) {
    padding-left: 6px;
  }

  :deep(.reply-dialog .rich-editor.toolbar-static .editor-toolbar button) {
    min-height: 32px;
    padding: 0 8px;
    border-radius: 8px;
    font-size: 11px;
  }

  :deep(.reply-dialog .rich-editor.toolbar-static .size-btn),
  :deep(.reply-dialog .rich-editor.toolbar-static .align-btn) {
    min-width: 32px;
    padding: 0 7px !important;
  }

  :deep(.reply-dialog .rich-editor.toolbar-static .size-label) {
    font-size: 11px;
  }

  :deep(.reply-dialog) {
    width: calc(100vw - 16px) !important;
  }

  :deep(.reply-dialog .el-dialog) {
    margin: 0 auto;
    border-radius: 16px;
  }
}
</style>
