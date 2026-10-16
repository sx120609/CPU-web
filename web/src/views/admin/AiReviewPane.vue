<template>
  <div class="ai-review-pane">
    <el-alert
      v-if="configLoadError"
      type="error"
      :closable="false"
      show-icon
      class="pane-alert"
      :title="configLoadError"
    >
      <template #default>
        <el-button size="small" :loading="loadingConfig" @click="loadConfig">重试配置</el-button>
      </template>
    </el-alert>
    <el-alert
      v-if="promptDefaultsLoadError"
      type="warning"
      :closable="false"
      show-icon
      class="pane-alert"
      :title="promptDefaultsLoadError"
    >
      <template #default>
        <el-button size="small" :loading="loadingPromptDefaults" @click="loadPromptDefaults">重试默认 Prompt</el-button>
      </template>
    </el-alert>

    <p class="routing-hint">各场景用哪个服务、哪个模型，以及出故障时切到哪里，都在“服务线路”里配置；这里只管功能开关、阈值和 Prompt。</p>

    <section class="settings-card" :class="{ 'is-config-disabled': Boolean(configLoadError) }" v-loading="loadingConfig">
      <div class="section-head">
        <div>
          <h3 class="section-title">网课解题三档策略</h3>
          <p class="section-desc">用户看到的是答题模式；模型、实际推理强度和点数倍率均由服务端配置，客户端不能覆盖。</p>
        </div>
        <el-button type="primary" :loading="saving" :disabled="saving || Boolean(configLoadError)" @click="saveConfig">
          保存三档策略
        </el-button>
      </div>
      <div class="learning-tier-grid">
        <article v-for="tier in learningTierAssignments" :key="tier.key" class="learning-tier-card">
          <div>
            <strong>{{ tier.label }}</strong>
            <small>{{ tier.description }}</small>
            <small class="model-source">模型：{{ form.learningAssistantTiers[tier.key].model }}（在服务线路里修改）</small>
          </div>
          <label>
            <span>推理强度</span>
            <el-select v-model="form.learningAssistantTiers[tier.key].reasoningEffort">
              <el-option v-for="effort in reasoningEffortOptions" :key="effort.value" :label="effort.label" :value="effort.value" />
            </el-select>
          </label>
          <label>
            <span>点数倍率</span>
            <el-input-number v-model="form.learningAssistantTiers[tier.key].pointMultiplier" :min="0.1" :max="20" :step="0.1" :precision="1" />
          </label>
          <label class="learning-tier-free-toggle">
            <span>限免期间开放</span>
            <el-switch
              v-model="form.learningAssistantTiers[tier.key].freeInUnlimited"
              inline-prompt
              active-text="免费"
              inactive-text="停用"
            />
            <small>关闭后，临时免登录阶段不会向用户提供该档位。</small>
          </label>
        </article>
      </div>
    </section>

    <section class="settings-card" :class="{ 'is-config-disabled': Boolean(configLoadError) }" v-loading="loadingConfig">
      <div class="section-head">
        <div>
          <h3 class="section-title">智慧发帖 Agent</h3>
          <p class="section-desc">生成与润色分三轮分析文字及多附件，整理排版只执行单轮请求。此场景单独指定模型，不继承文字审核模型；Agent 不会自动发布。</p>
        </div>
      </div>

      <div class="ai-form">
        <div class="ai-row ai-row--switch">
          <span class="ai-label">启用智慧发帖</span>
          <el-switch v-model="form.smartPostEnabled" inline-prompt active-text="开" inactive-text="关" />
        </div>
        <div class="ai-row">
          <span class="ai-label">每额度 Token 数</span>
          <el-input-number v-model="form.smartPostTokensPerQuota" :min="256" :max="100000" :step="256" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">模型备选</span>
          <el-input v-model="form.smartPostFallbackModels" maxlength="400" placeholder="逗号分隔；主模型失败时按顺序尝试" />
        </div>
      </div>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="按上游实际返回的 Token 用量结算：达到这里配置的 Token 数扣 1 个 AI 额度，不足一档按 1 个计。Responses 优先接收原始文件；失败或输出无效会退款。"
      />
    </section>

    <section class="settings-card" :class="{ 'is-config-disabled': Boolean(configLoadError) }" v-loading="loadingConfig">
      <div class="section-head">
        <div>
          <h3 class="section-title">论坛 AI 参考回答</h3>
          <p class="section-desc">提问广场和普通板块里像提问的帖子公开后，拾间AI 检索学校事务资料、同步的学校公告和往期帖子；资料确实能回答且置信度达到门槛时，在帖子下方展示带出处的参考回答，并通知发帖人。使用拾间 AI 的服务和模型。</p>
        </div>
      </div>

      <div class="ai-form">
        <div class="ai-row ai-row--switch">
          <span class="ai-label">启用参考回答</span>
          <el-switch v-model="form.forumAiAnswerEnabled" inline-prompt active-text="开" inactive-text="关" />
        </div>
        <div class="ai-row">
          <span class="ai-label">最低置信度</span>
          <el-input-number v-model="form.forumAiAnswerMinConfidence" :min="50" :max="100" :step="5" />
        </div>
      </div>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="门槛越高展示越少、越稳。管理员在帖子页能看到未展示的原因和模型自评分，可在那里重新生成；发帖人和管理员可以关闭某条回答。"
      />
    </section>

    <section class="settings-card" :class="{ 'is-config-disabled': Boolean(configLoadError) }" v-loading="loadingConfig">
      <h3 class="section-title">药苑之声 · 歌曲审核</h3>
      <p class="section-desc">投稿始终先保存，AI异步给出选曲建议，风险投稿会提示用户“大概率不会被接受”；有建议时通过主站通知用户；用户二次确认后才进入待排期，24小时未确认自动撤回。存量未播放歌曲自动排队，也可在歌曲管理中批量重审；用户也可直接撤回投稿。</p>
      <label class="ai-row"><span class="ai-label">启用歌曲审核</span><el-switch v-model="form.songReviewEnabled" inline-prompt active-text="开" inactive-text="关" /></label>
      <label class="ai-row"><span class="ai-label">备用模型</span><el-input v-model="form.songReviewFallbackModels" maxlength="400" placeholder="逗号分隔；主模型失败后依次尝试" /></label>
      <label class="ai-row"><span class="ai-label">选曲规则</span><el-input v-model="form.songReviewRules" type="textarea" :rows="4" maxlength="6000" show-word-limit /></label>
      <p class="desc">服务和模型在“服务线路”的歌曲审核一行配置。AI核对歌词和公开来源；证据不足时请投稿人阅读建议并确认；调用失败只重试，不启动撤回倒计时。修改规则后原审核结果需重新确认。</p>
      <el-button type="primary" :loading="saving" :disabled="saving || Boolean(configLoadError)" @click="saveConfig">保存歌曲审核配置</el-button>
    </section>

    <section class="settings-card" :class="{ 'is-config-disabled': Boolean(configLoadError) }" v-loading="loadingConfig">
      <div class="section-head">
        <div>
          <h3 class="section-title">文字审核</h3>
          <p class="section-desc">帖子、回复和编辑相似度判定共用这一组配置。</p>
        </div>
      </div>

      <div class="ai-form">
        <div class="ai-row ai-row--switch">
          <span class="ai-label">启用审核</span>
          <el-switch v-model="form.aiReviewEnabled" inline-prompt active-text="开" inactive-text="关" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">模型备选</span>
          <el-input v-model="form.aiReviewFallbackModels" maxlength="400" placeholder="逗号分隔，例如 gpt-4.1, gpt-4o-mini" />
        </div>
        <div class="ai-row">
          <span class="ai-label">文字审核阈值</span>
          <el-input-number v-model="form.aiReviewThreshold" :min="0" :max="100" />
        </div>
        <div class="ai-row">
          <span class="ai-label">编辑相似度下限</span>
          <el-input-number v-model="aiEditSimilarityPercent" :min="0" :max="100" />
        </div>
      </div>

      <div class="prompt-card">
        <button data-cpu-button="text" type="button" class="sub-toggle" :class="{ expanded: textPromptsExpanded }" @click="textPromptsExpanded = !textPromptsExpanded">
          <div>
            <div class="card-title">文字审核 Prompt</div>
            <div class="desc">支持按帖子、回复和编辑相似度分别配置提示词。</div>
          </div>
          <span class="toggle-arrow" aria-hidden="true">▾</span>
        </button>
        <div class="prompt-actions">
        <el-button text :disabled="loadingPromptDefaults || Boolean(configLoadError)" @click="resetTextPrompts">重置文字 Prompt</el-button>
        </div>
        <div v-if="textPromptsExpanded" class="prompt-grid">
          <div class="ai-row ai-row--stretch">
            <span class="ai-label">帖子审核 System Prompt</span>
            <el-input v-model="form.aiTopicReviewSystemPrompt" type="textarea" :rows="3" />
          </div>
          <div class="ai-row ai-row--stretch">
            <span class="ai-label">帖子审核 User Prompt</span>
            <el-input v-model="form.aiTopicReviewUserPrompt" type="textarea" :rows="6" />
          </div>
          <div class="ai-row ai-row--stretch">
            <span class="ai-label">回复审核 System Prompt</span>
            <el-input v-model="form.aiReplyReviewSystemPrompt" type="textarea" :rows="3" />
          </div>
          <div class="ai-row ai-row--stretch">
            <span class="ai-label">回复审核 User Prompt</span>
            <el-input v-model="form.aiReplyReviewUserPrompt" type="textarea" :rows="6" />
          </div>
          <div class="ai-row ai-row--stretch">
            <span class="ai-label">编辑相似度 System Prompt</span>
            <el-input v-model="form.aiEditSimilaritySystemPrompt" type="textarea" :rows="3" />
          </div>
          <div class="ai-row ai-row--stretch">
            <span class="ai-label">编辑相似度 User Prompt</span>
            <el-input v-model="form.aiEditSimilarityUserPrompt" type="textarea" :rows="6" />
          </div>
        </div>
      </div>
    </section>

    <section class="settings-card" :class="{ 'is-config-disabled': Boolean(configLoadError) }" v-loading="loadingConfig">
      <div class="section-head">
        <div>
          <h3 class="section-title">QQ群广告过滤</h3>
          <p class="section-desc">用于 QQ 用户群的实时广告过滤。命中后会尝试自动撤回消息，适合处理引流、招代理、兼职刷单和营销灌水。</p>
        </div>
      </div>

      <div class="ai-form">
        <div class="ai-row ai-row--switch">
          <span class="ai-label">启用广告过滤</span>
          <el-switch v-model="form.qqGroupAdReviewEnabled" inline-prompt active-text="开" inactive-text="关" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">模型备选</span>
          <el-input v-model="form.qqGroupAdReviewFallbackModels" maxlength="400" placeholder="逗号分隔，例如 gpt-4.1, gpt-4o-mini" />
        </div>
        <div class="ai-row">
          <span class="ai-label">拦截阈值</span>
          <el-input-number v-model="form.qqGroupAdReviewThreshold" :min="0" :max="100" />
        </div>
        <div class="ai-row ai-row--switch">
          <span class="ai-label">高峰增强模式</span>
          <el-switch v-model="form.qqGroupAdReviewPeakEnabled" inline-prompt active-text="开" inactive-text="关" />
        </div>
        <div class="ai-row">
          <span class="ai-label">高峰开始</span>
          <el-time-picker
            v-model="form.qqGroupAdReviewPeakStart"
            format="HH:mm"
            value-format="HH:mm"
            placeholder="00:30"
            :clearable="false"
          />
        </div>
        <div class="ai-row">
          <span class="ai-label">高峰结束</span>
          <el-time-picker
            v-model="form.qqGroupAdReviewPeakEnd"
            format="HH:mm"
            value-format="HH:mm"
            placeholder="08:30"
            :clearable="false"
          />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">高峰模型服务</span>
          <el-select
            v-model="form.qqGroupAdReviewPeakServiceId"
            placeholder="选择模型提供商"
            @change="loadPeakModels"
          >
            <el-option
              v-for="service in form.aiServices"
              :key="`qq-group-ad-peak-service-${service.id}`"
              :label="service.name"
              :value="service.id"
            />
          </el-select>
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">高峰强模型</span>
          <el-select
            v-model="form.qqGroupAdReviewPeakModel"
            filterable
            allow-create
            clearable
            default-first-option
            placeholder="留空则沿用普通广告模型"
            @focus="loadPeakModels"
          >
            <el-option
              v-for="model in peakModelOptions()"
              :key="`qq-group-ad-peak-${model}`"
              :label="model"
              :value="model"
            />
          </el-select>
        </div>
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          title="按北京时间生效，支持跨午夜时段。增强模式会跳过本地快速放行、启用昵称冒充与导流组合风控，并切换到所选服务和高峰模型；白名单仍不进入普通广告审核。"
        />
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="群消息带图片时会优先使用“图片审核”模型；请配置支持视觉输入的模型。Spark/Codex 文本模型不会接收图片。"
        />
      </div>

      <div class="prompt-card">
        <button data-cpu-button="text" type="button" class="sub-toggle" :class="{ expanded: qqGroupAdPromptsExpanded }" @click="qqGroupAdPromptsExpanded = !qqGroupAdPromptsExpanded">
          <div>
            <div class="card-title">QQ群广告过滤 Prompt</div>
            <div class="desc">可单独配置实时广告过滤的系统提示词和用户提示词。</div>
          </div>
          <span class="toggle-arrow" aria-hidden="true">▾</span>
        </button>
        <div class="prompt-actions">
          <el-button text :disabled="loadingPromptDefaults || Boolean(configLoadError)" @click="resetQqGroupAdPrompts">重置广告过滤 Prompt</el-button>
        </div>
        <div v-if="qqGroupAdPromptsExpanded" class="prompt-grid">
          <div class="ai-row ai-row--stretch">
            <span class="ai-label">广告过滤 System Prompt</span>
            <el-input v-model="form.qqGroupAdReviewSystemPrompt" type="textarea" :rows="4" />
          </div>
          <div class="ai-row ai-row--stretch">
            <span class="ai-label">广告过滤 User Prompt</span>
            <el-input v-model="form.qqGroupAdReviewUserPrompt" type="textarea" :rows="6" />
          </div>
        </div>
      </div>

      <div class="actions-row cpu-button-row">
        <el-button type="primary" :loading="saving" :disabled="saving || Boolean(configLoadError)" @click="saveConfig">保存审核配置</el-button>
        <el-button plain :disabled="loadingPromptDefaults || Boolean(configLoadError)" @click="resetAllPrompts">重置全部 Prompt</el-button>
      </div>
    </section>

    <section class="settings-card" :class="{ 'is-config-disabled': Boolean(configLoadError) }" v-loading="loadingConfig">
      <div class="section-head">
        <div>
          <h3 class="section-title">图片审核</h3>
          <p class="section-desc">图片走异步审核，发布后先占位；低于阈值自动通过，达到阈值就隐藏等待人工处理。</p>
        </div>
      </div>

      <div class="ai-form">
        <div class="ai-row ai-row--switch">
          <span class="ai-label">启用图片审核</span>
          <el-switch v-model="form.imageReviewEnabled" inline-prompt active-text="开" inactive-text="关" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">模型备选</span>
          <el-input v-model="form.imageReviewFallbackModels" maxlength="400" placeholder="逗号分隔，例如 gpt-4.1, gpt-4o-mini" />
        </div>
        <div class="ai-row">
          <span class="ai-label">并发请求数</span>
          <el-input-number v-model="form.imageReviewConcurrency" :min="1" :max="8" />
        </div>
        <div class="ai-row">
          <span class="ai-label">单次请求图片数</span>
          <el-input-number v-model="form.imageReviewRequestGroupSize" :min="1" :max="6" />
        </div>
        <div class="ai-row">
          <span class="ai-label">图片审核阈值</span>
          <el-input-number v-model="form.imageReviewThreshold" :min="0" :max="100" />
        </div>
      </div>

      <div class="prompt-card">
        <button data-cpu-button="text" type="button" class="sub-toggle" :class="{ expanded: imagePromptsExpanded }" @click="imagePromptsExpanded = !imagePromptsExpanded">
          <div>
            <div class="card-title">图片审核 Prompt</div>
            <div class="desc">可单独配置图片审核系统提示词和用户提示词。</div>
          </div>
          <span class="toggle-arrow" aria-hidden="true">▾</span>
        </button>
        <div class="prompt-actions">
        <el-button text :disabled="loadingPromptDefaults || Boolean(configLoadError)" @click="resetImagePrompts">重置图片 Prompt</el-button>
        </div>
        <div v-if="imagePromptsExpanded" class="prompt-grid">
          <div class="ai-row ai-row--stretch">
            <span class="ai-label">图片审核 System Prompt</span>
            <el-input v-model="form.imageReviewSystemPrompt" type="textarea" :rows="4" />
          </div>
          <div class="ai-row ai-row--stretch">
            <span class="ai-label">图片审核 User Prompt</span>
            <el-input v-model="form.imageReviewUserPrompt" type="textarea" :rows="5" />
          </div>
        </div>
      </div>

      <div class="actions-row cpu-button-row">
        <el-button type="primary" :loading="saving" :disabled="saving || Boolean(configLoadError)" @click="saveConfig">保存审核配置</el-button>
        <el-button plain :disabled="loadingPromptDefaults || Boolean(configLoadError)" @click="resetAllPrompts">重置全部 Prompt</el-button>
        <el-button plain :loading="sweepingImages" :disabled="sweepingImages" @click="sweepForumImages">一键补扫全站图片</el-button>
      </div>
      <p v-if="lastImageSweepSummary" class="actions-note">{{ lastImageSweepSummary }}</p>
    </section>

    <section class="settings-card" :class="{ 'is-config-disabled': Boolean(configLoadError) }" v-loading="loadingConfig">
      <div class="section-head">
        <div>
          <h3 class="section-title">视频审核</h3>
          <p class="section-desc">视频会抽关键帧、尝试转写音轨，并结合正文上下文异步判定；可单独配置启停、模型、阈值和 Prompt，这里也继续处理待人工复核的视频。</p>
        </div>
      </div>

      <div class="ai-form">
        <div class="ai-row ai-row--switch">
          <span class="ai-label">启用视频审核</span>
          <el-switch v-model="form.videoReviewEnabled" inline-prompt active-text="开" inactive-text="关" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">模型备选</span>
          <el-input v-model="form.videoReviewFallbackModels" maxlength="400" placeholder="逗号分隔，例如 gpt-4.1, gpt-4o-mini" />
        </div>
        <div class="ai-row">
          <span class="ai-label">并发请求数</span>
          <el-input-number v-model="form.videoReviewConcurrency" :min="1" :max="2" />
        </div>
        <div class="ai-row">
          <span class="ai-label">视频审核阈值</span>
          <el-input-number v-model="form.videoReviewThreshold" :min="0" :max="100" />
        </div>
      </div>

      <div class="prompt-card">
        <button data-cpu-button="text" type="button" class="sub-toggle" :class="{ expanded: videoPromptsExpanded }" @click="videoPromptsExpanded = !videoPromptsExpanded">
          <div>
            <div class="card-title">视频审核 Prompt</div>
            <div class="desc">可单独配置视频审核系统提示词和用户提示词。</div>
          </div>
          <span class="toggle-arrow" aria-hidden="true">▾</span>
        </button>
        <div class="prompt-actions">
        <el-button text :disabled="loadingPromptDefaults || Boolean(configLoadError)" @click="resetVideoPrompts">重置视频 Prompt</el-button>
        </div>
        <div v-if="videoPromptsExpanded" class="prompt-grid">
          <div class="ai-row ai-row--stretch">
            <span class="ai-label">视频审核 System Prompt</span>
            <el-input v-model="form.videoReviewSystemPrompt" type="textarea" :rows="4" />
          </div>
          <div class="ai-row ai-row--stretch">
            <span class="ai-label">视频审核 User Prompt</span>
            <el-input v-model="form.videoReviewUserPrompt" type="textarea" :rows="6" />
          </div>
        </div>
      </div>

      <div class="actions-row cpu-button-row">
        <el-button type="primary" :loading="saving" :disabled="saving || Boolean(configLoadError)" @click="saveConfig">保存审核配置</el-button>
        <el-button plain :disabled="loadingPromptDefaults || Boolean(configLoadError)" @click="resetAllPrompts">重置全部 Prompt</el-button>
        <el-button plain :loading="sweepingVideos" :disabled="sweepingVideos" @click="sweepForumVideos">一键补扫全站视频</el-button>
      </div>
      <p v-if="lastVideoSweepSummary" class="actions-note">{{ lastVideoSweepSummary }}</p>

      <div class="filters">
        <el-select v-model="videoFilters.status" placeholder="视频状态" style="width: 160px" @change="loadVideos">
          <el-option label="待人工" value="manual_review" />
          <el-option label="审核中" value="pending" />
          <el-option label="审核异常" value="error" />
          <el-option label="已驳回" value="rejected" />
          <el-option label="已通过" value="approved" />
        </el-select>
        <el-button plain :loading="loadingVideos" :disabled="loadingVideos" @click="loadVideos">刷新</el-button>
      </div>
      <el-alert
        v-if="videosLoadError"
        type="error"
        :closable="false"
        show-icon
        class="pane-alert"
        :title="videosLoadError"
      >
        <template #default>
          <el-button size="small" :loading="loadingVideos" @click="loadVideos">重试</el-button>
        </template>
      </el-alert>

      <div class="admin-table-scroll">
        <el-table :data="videoRows" v-loading="loadingVideos" size="small" class="admin-table admin-table--videos">
          <el-table-column prop="createdAt" label="入队时间" width="170">
            <template #default="{ row }">{{ fmtDate(row.createdAt, "YYYY-MM-DD HH:mm:ss") }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="videoStatusTagType(row.status)" effect="plain">{{ videoStatusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="targetLabel" label="目标" min-width="180">
            <template #default="{ row }">
              <a v-if="row.targetUrl" :href="row.targetUrl" target="_blank" rel="noopener noreferrer">{{ row.targetLabel }}</a>
              <span v-else>{{ row.targetLabel }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="url" label="视频" min-width="220" show-overflow-tooltip />
          <el-table-column label="信息" min-width="160">
            <template #default="{ row }">
              {{ row.durationMs ? `${Math.round(row.durationMs / 1000)} 秒` : "时长未知" }}
              <span v-if="row.width && row.height"> · {{ row.width }}x{{ row.height }}</span>
              <span> · {{ row.hasAudio ? "有音轨" : "无音轨" }}</span>
            </template>
          </el-table-column>
          <el-table-column label="原因 / 异常" min-width="260" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.reason || row.lastError || row.detail || "-" }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180">
            <template #default="{ row }">
              <div class="table-actions cpu-button-row">
                <el-button size="small" type="success" plain :loading="isVideoReviewBusy(row)" :disabled="loadingVideos || isVideoReviewBusy(row)" @click="approveVideo(row)">通过</el-button>
                <el-button size="small" type="danger" plain :loading="isVideoReviewBusy(row)" :disabled="loadingVideos || isVideoReviewBusy(row)" @click="rejectVideo(row)">驳回</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <section class="settings-card">
      <div class="section-head">
        <div>
          <h3 class="section-title">审核日志</h3>
          <p class="section-desc">用来确认请求是否真的走到了 AI，以及返回是成功还是失败。</p>
        </div>
      </div>

      <div class="filters">
        <el-select v-model="filters.kind" clearable placeholder="类型" style="width: 150px" @change="loadLogs">
          <el-option v-for="item in logSceneOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="filters.status" clearable placeholder="状态" style="width: 140px" @change="loadLogs">
          <el-option label="开始" value="started" />
          <el-option label="成功" value="success" />
          <el-option label="失败" value="error" />
        </el-select>
        <el-button plain :loading="loadingLogs" :disabled="loadingLogs" @click="loadLogs">刷新</el-button>
      </div>
      <el-alert
        v-if="logsLoadError"
        type="error"
        :closable="false"
        show-icon
        class="pane-alert"
        :title="logsLoadError"
      >
        <template #default>
          <el-button size="small" :loading="loadingLogs" @click="loadLogs">重试</el-button>
        </template>
      </el-alert>

      <div class="admin-table-scroll">
        <el-table :data="logs" v-loading="loadingLogs" size="small" class="admin-table admin-table--logs">
          <el-table-column prop="startedAt" label="时间" width="170">
            <template #default="{ row }">{{ fmtDate(row.startedAt, "YYYY-MM-DD HH:mm:ss") }}</template>
          </el-table-column>
          <el-table-column label="类型" width="130">
            <template #default="{ row }">{{ aiLogSceneLabel(row.kind) }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column prop="model" label="模型" min-width="140" />
          <el-table-column prop="targetLabel" label="目标" min-width="180" />
          <el-table-column prop="requestSummary" label="请求摘要" min-width="240" show-overflow-tooltip />
          <el-table-column prop="responseSummary" label="返回摘要" min-width="240" show-overflow-tooltip />
          <el-table-column prop="errorMessage" label="错误" min-width="220" show-overflow-tooltip />
        </el-table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { aiLogSceneLabel, aiLogSceneOptions } from "../../../../server/src/shared/aiLogScenes";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  adminApi,
  type AiReviewLogRow,
  type ForumImageSweepResult,
  type ForumVideoQueueRow,
  type ForumVideoSweepResult,
  type SiteConfig,
  type SitePromptDefaults,
} from "@/api/admin";
import { fmtDate } from "@/utils/format";

const loadingConfig = ref(false);
const loadingLogs = ref(false);
const saving = ref(false);
const sweepingImages = ref(false);
const sweepingVideos = ref(false);
const loadingVideos = ref(false);
const videoReviewBusyId = ref<number | null>(null);
const loadingPromptDefaults = ref(false);
const configLoadError = ref("");
const promptDefaultsLoadError = ref("");
const logsLoadError = ref("");
const videosLoadError = ref("");
const textPromptsExpanded = ref(false);
const qqGroupAdPromptsExpanded = ref(false);
const imagePromptsExpanded = ref(false);
const videoPromptsExpanded = ref(false);
const logs = ref<AiReviewLogRow[]>([]);
const lastImageSweepSummary = ref("");
const lastVideoSweepSummary = ref("");
const videoRows = ref<ForumVideoQueueRow[]>([]);
const promptDefaults = ref<SitePromptDefaults | null>(null);
const peakModels = ref<Record<string, string[]>>({});
let configLoadSeq = 0;
let promptDefaultsLoadSeq = 0;
let logsLoadSeq = 0;
let videosLoadSeq = 0;
const filters = reactive({ kind: "", status: "", page: 1, size: 20 });
// 场景清单和服务端写日志用的是同一份。
const logSceneOptions = computed(() => aiLogSceneOptions([filters.kind, ...logs.value.map((row) => row.kind)]));
const videoFilters = reactive<{ status: "" | "pending" | "manual_review" | "rejected" | "approved" | "error"; page: number; size: number }>({
  status: "manual_review",
  page: 1,
  size: 20,
});
const learningTierAssignments = [
  { key: "low", label: "快速判断", description: "常规题目与快速作答" },
  { key: "high", label: "深入分析", description: "计算题与复杂推导" },
  { key: "max", label: "挑战难题", description: "高难题与多步骤核验" },
] as const;
const reasoningEffortOptions = [
  { value: "low", label: "low（低）" },
  { value: "medium", label: "medium（中）" },
  { value: "high", label: "high（高）" },
  { value: "xhigh", label: "xhigh（超高）" },
  { value: "max", label: "max（最高）" },
] as const;
const form = reactive<SiteConfig>({
  siteOrigin: "",
  siteFilingNumber: "",
  assistantModel: "gpt-5.6-terra",
  learningAssistantModel: "gpt-5.6-terra",
  learningAssistantTiers: {
    low: { model: "gpt-5.6-terra", reasoningEffort: "low", pointMultiplier: 1, freeInUnlimited: true },
    high: { model: "gpt-5.6-terra", reasoningEffort: "high", pointMultiplier: 1.5, freeInUnlimited: true },
    max: { model: "gpt-5.6-terra", reasoningEffort: "max", pointMultiplier: 2, freeInUnlimited: false },
  },
  learningAssistantAccessMode: "guest-unlimited",
  learningPlatforms: {
    chaoxing: true,
    zhihuishu: true,
    icve: true,
    zjy: true,
    icourse: true,
    yuketang: true,
    weban: true,
  },
  aiServices: [{
    id: "default-main",
    name: "默认 AI 服务",
    provider: "deepseek",
    apiUrl: "https://api.deepseek.com/chat/completions",
    apiKey: "",
    assistantContextMaxMessages: 0,
    assistantContextMaxCharsPerMessage: 0,
  }],
  aiServiceFallbacks: {
    assistant: [],
    "learning-assistant": [],
    "smart-post": [],
    "song-review": [],
    "text-review": [],
    "qq-group-ad": [],
    "image-review": [],
    "video-review": [],
  },
  assistantServiceId: "default-main",
  learningAssistantServiceId: "default-main",
  smartPostServiceId: "default-main",
  songReviewServiceId: "default-main",
  songReviewEnabled: false,
  songReviewModel: "deepseek-v4-flash",
  songReviewFallbackModels: "",
  songReviewRules: "仅支持中文歌曲，包括粤语、闽南语等。禁止DJ、rap、喊麦、现场live版、含有违规内容、政治敏感以及演唱歌手舆论较大的歌曲。",
  smartPostEnabled: true,
  smartPostModel: "gpt-5.6-sol",
  smartPostFallbackModels: "",
  smartPostTokensPerQuota: 4000,
  forumAiAnswerEnabled: true,
  forumAiAnswerMinConfidence: 75,
  aiReviewServiceId: "default-main",
  aiReviewEnabled: false,
  aiReviewProvider: "deepseek",
  aiReviewApiUrl: "https://api.deepseek.com/chat/completions",
  aiReviewModel: "deepseek-v4-flash",
  aiReviewFallbackModels: "",
  aiReviewApiKey: "",
  qqGroupAdReviewServiceId: "default-main",
  qqGroupAdReviewEnabled: false,
  qqGroupAdReviewProvider: "deepseek",
  qqGroupAdReviewApiUrl: "https://api.deepseek.com/chat/completions",
  qqGroupAdReviewModel: "deepseek-v4-flash",
  qqGroupAdReviewFallbackModels: "",
  qqGroupAdReviewApiKey: "",
  qqGroupAdReviewPeakEnabled: true,
  qqGroupAdReviewPeakStart: "00:30",
  qqGroupAdReviewPeakEnd: "08:30",
  qqGroupAdReviewPeakServiceId: "default-main",
  qqGroupAdReviewPeakModel: "",
  qqGroupAdReviewSystemPrompt: "",
  qqGroupAdReviewUserPrompt: "",
  imageReviewServiceId: "default-main",
  imageReviewProvider: "deepseek",
  imageReviewEnabled: false,
  imageReviewApiUrl: "https://api.openai.com/v1/chat/completions",
  imageReviewModel: "gpt-4o-mini",
  imageReviewFallbackModels: "",
  imageReviewApiKey: "",
  imageReviewSystemPrompt: "",
  imageReviewUserPrompt: "",
  imageReviewConcurrency: 2,
  imageReviewRequestGroupSize: 3,
  videoReviewServiceId: "default-main",
  videoReviewProvider: "deepseek",
  videoReviewEnabled: false,
  videoReviewApiUrl: "https://api.openai.com/v1/chat/completions",
  videoReviewModel: "gpt-4o-mini",
  videoReviewFallbackModels: "",
  videoReviewApiKey: "",
  videoReviewSystemPrompt: "",
  videoReviewUserPrompt: "",
  videoReviewConcurrency: 1,
  aiReviewThreshold: 24,
  qqGroupAdReviewThreshold: 85,
  imageReviewThreshold: 36,
  videoReviewThreshold: 36,
  aiEditSimilarityThreshold: 0,
  aiTopicReviewSystemPrompt: "",
  aiTopicReviewUserPrompt: "",
  aiReplyReviewSystemPrompt: "",
  aiReplyReviewUserPrompt: "",
  aiEditSimilaritySystemPrompt: "",
  aiEditSimilarityUserPrompt: "",
  anonymousMinReputation: 0,
  accountAgeDaysPerStep: 14,
  accountAgePointsPerStep: 2,
  accountAgePointsCap: 36,
  postPointsPerTopic: 4,
  postPointsCap: 48,
  replyPointsPerReply: 2,
  replyPointsCap: 48,
  forumEnabledBonus: 0,
  anonymousTiers: [],
  reputationLevels: [],
  assistantDailyQuotas: [],
});

const aiEditSimilarityPercent = computed({
  get: () => Math.round((form.aiEditSimilarityThreshold ?? 0) * 100),
  set: (value: number) => {
    form.aiEditSimilarityThreshold = value / 100;
  },
});
onMounted(async () => {
  await Promise.all([loadConfig(), loadLogs(), loadPromptDefaults(), loadVideos()]);
});

async function loadConfig() {
  const seq = ++configLoadSeq;
  loadingConfig.value = true;
  configLoadError.value = "";
  try {
    const config = await adminApi.siteConfig({ suppressErrorMessage: true });
    if (seq === configLoadSeq) Object.assign(form, config);
  } catch (error) {
    if (seq === configLoadSeq) {
      configLoadError.value = requestMessage(error) || "审核配置加载失败，请稍后重试";
    }
  } finally {
    if (seq === configLoadSeq) loadingConfig.value = false;
  }
}

/** 高峰模型下拉里列出所选服务的模型目录；读不到时仍可手动输入。 */
async function loadPeakModels() {
  const service = form.aiServices.find((item) => item.id === form.qqGroupAdReviewPeakServiceId);
  if (!service?.apiUrl.trim() || peakModels.value[service.id]) return;
  const [probe] = await adminApi.probeAiServices(
    [{ id: service.id, provider: service.provider, apiUrl: service.apiUrl, apiKey: service.apiKey }],
    { timeout: 45_000, suppressErrorMessage: true, preserveResponseCache: true },
  ).catch(() => []);
  if (probe?.ok) peakModels.value = { ...peakModels.value, [service.id]: probe.models };
}

function peakModelOptions() {
  return Array.from(new Set([
    ...(peakModels.value[form.qqGroupAdReviewPeakServiceId] || []),
    form.qqGroupAdReviewPeakModel,
  ].filter(Boolean)));
}

async function loadPromptDefaults() {
  const seq = ++promptDefaultsLoadSeq;
  loadingPromptDefaults.value = true;
  promptDefaultsLoadError.value = "";
  try {
    const defaults = await adminApi.sitePromptDefaults({ suppressErrorMessage: true });
    if (seq === promptDefaultsLoadSeq) promptDefaults.value = defaults;
  } catch (error) {
    if (seq === promptDefaultsLoadSeq) {
      promptDefaults.value = null;
      promptDefaultsLoadError.value = requestMessage(error) || "默认 Prompt 加载失败，重置功能暂不可用";
    }
  } finally {
    if (seq === promptDefaultsLoadSeq) loadingPromptDefaults.value = false;
  }
}

async function saveConfig() {
  if (saving.value || configLoadError.value) return;
  saving.value = true;
  try {
    // 服务、线路和各场景的模型由“服务线路”保存，这里不带，免得用这一页加载时的旧值盖掉那边的改动。
    Object.assign(form, await adminApi.updateSiteConfig({
      learningAssistantTiers: form.learningAssistantTiers,
      songReviewEnabled: form.songReviewEnabled,
      songReviewFallbackModels: form.songReviewFallbackModels,
      songReviewRules: form.songReviewRules,
      smartPostEnabled: form.smartPostEnabled,
      smartPostFallbackModels: form.smartPostFallbackModels,
      smartPostTokensPerQuota: form.smartPostTokensPerQuota,
      forumAiAnswerEnabled: form.forumAiAnswerEnabled,
      forumAiAnswerMinConfidence: form.forumAiAnswerMinConfidence,
      aiReviewEnabled: form.aiReviewEnabled,
      aiReviewFallbackModels: form.aiReviewFallbackModels,
      qqGroupAdReviewEnabled: form.qqGroupAdReviewEnabled,
      qqGroupAdReviewFallbackModels: form.qqGroupAdReviewFallbackModels,
      qqGroupAdReviewPeakEnabled: form.qqGroupAdReviewPeakEnabled,
      qqGroupAdReviewPeakStart: form.qqGroupAdReviewPeakStart,
      qqGroupAdReviewPeakEnd: form.qqGroupAdReviewPeakEnd,
      qqGroupAdReviewPeakServiceId: form.qqGroupAdReviewPeakServiceId,
      qqGroupAdReviewPeakModel: form.qqGroupAdReviewPeakModel,
      qqGroupAdReviewSystemPrompt: form.qqGroupAdReviewSystemPrompt,
      qqGroupAdReviewUserPrompt: form.qqGroupAdReviewUserPrompt,
      imageReviewEnabled: form.imageReviewEnabled,
      imageReviewFallbackModels: form.imageReviewFallbackModels,
      imageReviewSystemPrompt: form.imageReviewSystemPrompt,
      imageReviewUserPrompt: form.imageReviewUserPrompt,
      imageReviewConcurrency: form.imageReviewConcurrency,
      imageReviewRequestGroupSize: form.imageReviewRequestGroupSize,
      videoReviewEnabled: form.videoReviewEnabled,
      videoReviewFallbackModels: form.videoReviewFallbackModels,
      videoReviewSystemPrompt: form.videoReviewSystemPrompt,
      videoReviewUserPrompt: form.videoReviewUserPrompt,
      videoReviewConcurrency: form.videoReviewConcurrency,
      aiReviewThreshold: form.aiReviewThreshold,
      qqGroupAdReviewThreshold: form.qqGroupAdReviewThreshold,
      imageReviewThreshold: form.imageReviewThreshold,
      videoReviewThreshold: form.videoReviewThreshold,
      aiEditSimilarityThreshold: form.aiEditSimilarityThreshold,
      aiTopicReviewSystemPrompt: form.aiTopicReviewSystemPrompt,
      aiTopicReviewUserPrompt: form.aiTopicReviewUserPrompt,
      aiReplyReviewSystemPrompt: form.aiReplyReviewSystemPrompt,
      aiReplyReviewUserPrompt: form.aiReplyReviewUserPrompt,
      aiEditSimilaritySystemPrompt: form.aiEditSimilaritySystemPrompt,
      aiEditSimilarityUserPrompt: form.aiEditSimilarityUserPrompt,
    }));
    ElMessage.success("功能与审核配置已保存");
  } finally {
    saving.value = false;
  }
}

function applyPromptDefaults(scope: "text" | "qq-group-ad" | "image" | "video" | "all") {
  if (!promptDefaults.value) {
    ElMessage.warning(promptDefaultsLoadError.value || "默认 Prompt 暂不可用");
    return;
  }
  const defaults = promptDefaults.value;
  if (scope === "text" || scope === "all") {
    form.aiTopicReviewSystemPrompt = defaults.aiTopicReviewSystemPrompt;
    form.aiTopicReviewUserPrompt = defaults.aiTopicReviewUserPrompt;
    form.aiReplyReviewSystemPrompt = defaults.aiReplyReviewSystemPrompt;
    form.aiReplyReviewUserPrompt = defaults.aiReplyReviewUserPrompt;
    form.aiEditSimilaritySystemPrompt = defaults.aiEditSimilaritySystemPrompt;
    form.aiEditSimilarityUserPrompt = defaults.aiEditSimilarityUserPrompt;
  }
  if (scope === "qq-group-ad" || scope === "all") {
    form.qqGroupAdReviewSystemPrompt = defaults.qqGroupAdReviewSystemPrompt;
    form.qqGroupAdReviewUserPrompt = defaults.qqGroupAdReviewUserPrompt;
  }
  if (scope === "image" || scope === "all") {
    form.imageReviewSystemPrompt = defaults.imageReviewSystemPrompt;
    form.imageReviewUserPrompt = defaults.imageReviewUserPrompt;
  }
  if (scope === "video" || scope === "all") {
    form.videoReviewSystemPrompt = defaults.videoReviewSystemPrompt;
    form.videoReviewUserPrompt = defaults.videoReviewUserPrompt;
  }
  const scopeLabel = scope === "text"
    ? "文字"
    : scope === "qq-group-ad"
      ? "QQ群广告过滤"
      : scope === "image"
        ? "图片"
        : scope === "video"
          ? "视频"
          : "全部";
  ElMessage.success(scope === "all" ? "已恢复全部默认 Prompt，记得保存审核配置" : `已恢复${scopeLabel}默认 Prompt，记得保存审核配置`);
}

async function resetTextPrompts() {
  if (!promptDefaults.value) await loadPromptDefaults();
  applyPromptDefaults("text");
}

async function resetImagePrompts() {
  if (!promptDefaults.value) await loadPromptDefaults();
  applyPromptDefaults("image");
}

async function resetQqGroupAdPrompts() {
  if (!promptDefaults.value) await loadPromptDefaults();
  applyPromptDefaults("qq-group-ad");
}

async function resetVideoPrompts() {
  if (!promptDefaults.value) await loadPromptDefaults();
  applyPromptDefaults("video");
}

async function resetAllPrompts() {
  if (!promptDefaults.value) await loadPromptDefaults();
  applyPromptDefaults("all");
}

async function loadLogs() {
  if (loadingLogs.value) return;
  const seq = ++logsLoadSeq;
  loadingLogs.value = true;
  logsLoadError.value = "";
  try {
    const result = await adminApi.aiReviewLogs(filters, { suppressErrorMessage: true });
    if (seq !== logsLoadSeq) return;
    logs.value = result.list;
  } catch (error) {
    if (seq !== logsLoadSeq) return;
    logs.value = [];
    logsLoadError.value = requestMessage(error) || "审核日志加载失败，请稍后重试";
  } finally {
    if (seq === logsLoadSeq) loadingLogs.value = false;
  }
}

async function sweepForumImages() {
  if (sweepingImages.value) return;
  sweepingImages.value = true;
  try {
    const result = await adminApi.sweepForumImages();
    lastImageSweepSummary.value = buildImageSweepSummary(result);
    ElMessage.success(result.moderationTriggered ? "已开始全站图片补扫并触发审核" : "已完成全站图片补扫");
    await loadLogs();
  } finally {
    sweepingImages.value = false;
  }
}

async function loadVideos() {
  if (loadingVideos.value) return;
  const seq = ++videosLoadSeq;
  loadingVideos.value = true;
  videosLoadError.value = "";
  try {
    const result = await adminApi.forumVideos({
      status: videoFilters.status || undefined,
      page: videoFilters.page,
      size: videoFilters.size,
    }, { suppressErrorMessage: true });
    if (seq !== videosLoadSeq) return;
    videoRows.value = result.list;
  } catch (error) {
    if (seq !== videosLoadSeq) return;
    videoRows.value = [];
    videosLoadError.value = requestMessage(error) || "视频审核队列加载失败，请稍后重试";
  } finally {
    if (seq === videosLoadSeq) loadingVideos.value = false;
  }
}

async function sweepForumVideos() {
  if (sweepingVideos.value) return;
  sweepingVideos.value = true;
  try {
    const result = await adminApi.sweepForumVideos();
    lastVideoSweepSummary.value = buildVideoSweepSummary(result);
    ElMessage.success(result.moderationTriggered ? "已开始全站视频补扫并触发审核" : "已完成全站视频补扫");
    await Promise.all([loadLogs(), loadVideos()]);
  } finally {
    sweepingVideos.value = false;
  }
}

function buildVideoSweepSummary(result: ForumVideoSweepResult) {
  const parts = [
    `已扫描 ${result.scannedTopics} 帖 / ${result.scannedReplies} 条回复`,
    `发现 ${result.uniqueVideoUrls} 条视频`,
  ];
  if (result.createdAssets) parts.push(`新增 ${result.createdAssets} 条视频资产`);
  if (result.requeuedAssets) parts.push(`重新入队 ${result.requeuedAssets} 条`);
  if (result.pendingAfterScan) parts.push(`待处理 ${result.pendingAfterScan} 条`);
  return parts.join("，");
}

function isVideoReviewBusy(row: unknown) {
  return videoReviewBusyId.value === (row as ForumVideoQueueRow).id;
}

async function approveVideo(row: unknown) {
  const video = row as ForumVideoQueueRow;
  if (videoReviewBusyId.value !== null) return;
  videoReviewBusyId.value = video.id;
  try {
    const confirmed = await ElMessageBox.confirm("确认将这条视频人工审核通过并恢复展示？", "人工通过", {
      type: "warning",
      confirmButtonText: "通过",
      cancelButtonText: "取消",
    }).then(() => true).catch(() => false);
    if (!confirmed) return;
    await adminApi.updateForumVideo(video.id, { status: "approved" });
    ElMessage.success("视频已人工审核通过");
    await loadVideos();
  } finally {
    videoReviewBusyId.value = null;
  }
}

async function rejectVideo(row: unknown) {
  const video = row as ForumVideoQueueRow;
  if (videoReviewBusyId.value !== null) return;
  videoReviewBusyId.value = video.id;
  try {
    const { value } = await ElMessageBox.prompt("可选填写人工驳回备注，留空会保留当前审核说明。", "继续隐藏", {
      inputPlaceholder: "例如：画面中可识别隐私信息较多，不适合公开展示",
    }).catch(() => ({ value: null }));
    if (value === null) return;
    await adminApi.updateForumVideo(video.id, {
      status: "rejected",
      manualReviewNote: value || undefined,
    });
    ElMessage.success("视频已维持隐藏");
    await loadVideos();
  } finally {
    videoReviewBusyId.value = null;
  }
}

function videoStatusLabel(status?: string) {
  if (status === "approved") return "已通过";
  if (status === "rejected") return "已驳回";
  if (status === "manual_review") return "待人工";
  if (status === "error") return "审核异常";
  return "审核中";
}

function videoStatusTagType(status?: string) {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "manual_review") return "warning";
  if (status === "error") return "info";
  return undefined;
}

function buildImageSweepSummary(result: ForumImageSweepResult) {
  const parts = [
    `已扫描 ${result.scannedTopics} 帖 / ${result.scannedReplies} 条回复`,
    `发现 ${result.uniqueImageUrls} 张图片`,
  ];
  if (result.createdAssets) parts.push(`补登记 ${result.createdAssets} 张`);
  if (result.requeuedAssets) parts.push(`重新入队 ${result.requeuedAssets} 张`);
  if (result.skippedAssets) parts.push(`跳过 ${result.skippedAssets} 张`);
  if (!result.reviewEnabled) parts.push("图片审核当前未启用");
  else if (result.moderationTriggered) parts.push(`后台已开始审核，当前待审 ${result.pendingAfterScan} 张`);
  else parts.push("当前没有待审图片");
  return parts.join("，");
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.ai-review-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.routing-hint {
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.learning-tier-card .model-source {
  color: var(--cpu-text-muted);
}

.learning-tier-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.learning-tier-card {
  min-width: 0;
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-extra-light);
}

.learning-tier-card > div {
  display: grid;
  gap: 4px;
}

.learning-tier-card strong,
.learning-tier-card label > span {
  color: var(--el-text-color-primary);
}

.learning-tier-card small,
.learning-tier-card label > span {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.learning-tier-card label {
  display: grid;
  gap: 5px;
}

.learning-tier-free-toggle {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  padding-top: 10px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.learning-tier-free-toggle > small {
  grid-column: 1 / -1;
  line-height: 1.55;
}

.settings-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 16px;
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--cpu-text);
}

.section-desc {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--cpu-text-secondary);
}

.ai-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  background: var(--cpu-surface);
  border: 1px solid var(--cpu-border-soft);
}

.ai-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ai-row--switch {
  justify-content: space-between;
}

.ai-row--stretch {
  grid-column: 1 / -1;
}

.ai-label {
  font-size: 12px;
  color: var(--cpu-text-secondary);
}

.field-note {
  color: var(--cpu-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.prompt-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: 14px;
  background: var(--cpu-surface-soft);
  border: 1px dashed var(--cpu-border);
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: -4px;
}

.prompt-grid {
  display: grid;
  gap: 12px;
}

.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--cpu-text);
}

.desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--cpu-text-secondary);
  line-height: 1.6;
}

.sub-toggle {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
  cursor: pointer;
}

.toggle-arrow {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 18px;
  color: var(--cpu-text-secondary);
  transition: transform 0.2s ease;
}

.sub-toggle.expanded .toggle-arrow {
  transform: rotate(180deg);
}

.actions-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.actions-note {
  margin: -4px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--cpu-text-secondary);
}

.filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.pane-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.settings-card.is-config-disabled .ai-form,
.settings-card.is-config-disabled .prompt-card {
  pointer-events: none;
  opacity: 0.62;
}

.admin-table-scroll {
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
}

.admin-table-scroll :deep(.admin-table) {
  min-width: 1120px;
}

.admin-table-scroll :deep(.admin-table--logs) {
  min-width: 1360px;
}

.table-actions {
  display: flex;
  gap: 8px;
}

.status-pill {
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.status-started {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-dark-2);
}

.status-success {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-dark-2);
}

.status-error {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-dark-2);
}

@media (max-width: 768px) {
  .settings-card {
    padding: 14px;
    border-radius: 14px;
  }

  .ai-form {
    grid-template-columns: 1fr;
    padding: 14px;
  }

  .learning-tier-grid {
    grid-template-columns: 1fr;
  }

  .filters {
    flex-direction: column;
  }

  .filters :deep(.el-select),
  .filters :deep(.el-button) {
    width: 100%;
  }

  .table-actions {
    flex-direction: column;
  }

  .actions-row {
    justify-content: stretch;
  }

  .actions-row :deep(.el-button) {
    width: 100%;
  }

}
</style>
