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

    <section class="settings-card provider-card" :class="{ 'is-config-disabled': Boolean(configLoadError) }" v-loading="loadingConfig">
      <div class="section-head">
        <div>
          <h3 class="section-title">AI 服务池</h3>
          <p class="section-desc">每个服务只填写一次地址和密钥，再把拾间 AI、QQ群广告、图片审核、视频审核分别路由到需要的厂家。</p>
        </div>
        <div class="provider-actions">
          <el-button :loading="loadingModels" :disabled="!selectedAiService?.apiUrl.trim()" @click="loadModels">
            刷新模型列表
          </el-button>
          <el-button type="primary" :loading="saving" :disabled="saving || Boolean(configLoadError)" @click="saveConfig">
            保存 AI 配置
          </el-button>
        </div>
      </div>

      <div class="service-pool">
        <div class="service-pool-head">
          <div>
            <h4 class="card-title">服务厂家配置</h4>
            <p class="desc">地址和 API Key 只在这里维护。Ollama 的 API Key 可以留空，地址填写运行服务端机器能够访问的地址。</p>
          </div>
          <el-button type="primary" plain @click="addAiService">添加服务</el-button>
        </div>
        <article v-for="(service, index) in form.aiServices" :key="service.id" class="service-card">
          <div class="service-card-head">
            <span class="service-index">服务 {{ index + 1 }}</span>
            <el-button
              text
              type="danger"
              :disabled="form.aiServices.length <= 1"
              @click="removeAiService(service.id)"
            >
              删除
            </el-button>
          </div>
          <div class="service-grid">
            <label class="ai-row">
              <span class="ai-label">服务名称</span>
              <el-input v-model="service.name" maxlength="80" placeholder="例如：本地 Ollama" />
            </label>
            <label class="ai-row">
              <span class="ai-label">服务厂家 / 协议</span>
              <el-select v-model="service.provider" filterable allow-create default-first-option @change="handleServiceProviderChange(service)">
                <el-option v-for="option in serviceProviderOptions" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
            </label>
            <label class="ai-row ai-row--stretch">
              <span class="ai-label">API 地址</span>
              <el-input
                v-model="service.apiUrl"
                maxlength="240"
                :placeholder="service.provider.toLowerCase() === 'ollama' ? 'http://127.0.0.1:11434' : '支持 /v1/responses 或 /v1/chat/completions'"
              />
            </label>
            <label class="ai-row ai-row--stretch">
              <span class="ai-label">API Key</span>
              <el-input
                v-model="service.apiKey"
                maxlength="240"
                show-password
                :placeholder="service.provider.toLowerCase() === 'ollama' ? 'Ollama 可留空' : 'sk-...'"
              />
            </label>
          </div>
          <small class="field-note">
            {{ service.provider.toLowerCase() === "ollama"
              ? "Ollama 会使用 /v1/chat/completions；模型名称填写本机已安装的 tag，例如 qwen3:8b。"
              : "服务端会根据地址自动识别 Responses 或 Chat Completions 协议。" }}
          </small>
        </article>
      </div>

      <div class="service-routing">
        <div>
          <h4 class="card-title">识别场景路由</h4>
          <p class="desc">同一个服务可以被多个场景复用；每个场景的模型仍然单独配置。</p>
        </div>
        <div class="routing-grid">
          <label v-for="item in serviceAssignments" :key="item.key" class="ai-row">
            <span class="ai-label">{{ item.label }}</span>
            <el-select v-model="form[item.key]">
              <el-option v-for="service in form.aiServices" :key="`${item.key}-${service.id}`" :label="service.name" :value="service.id" />
            </el-select>
          </label>
        </div>
      </div>

      <el-alert
        v-if="isOllamaProvider"
        type="success"
        :closable="false"
        show-icon
        title="当前拾间 AI / 文字审核使用 Ollama：地址填写 http://127.0.0.1:11434，模型填写已通过 ollama pull 安装的名称，例如 qwen3:8b。"
      />

      <el-alert
        type="info"
        :closable="false"
        show-icon
        :title="modelCatalogSummary"
      />

      <div class="model-grid">
        <label v-for="item in modelAssignments" :key="item.key" class="model-field">
          <span>{{ item.label }}</span>
          <small>{{ item.description }}</small>
          <el-select
            v-model="form[item.key]"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入模型 ID"
          >
            <el-option v-for="model in modelOptions" :key="`${item.key}-${model}`" :label="model" :value="model" />
          </el-select>
        </label>
      </div>

      <div class="learning-tier-panel">
        <div class="section-head learning-tier-head">
          <div>
            <h4 class="card-title">网课解题三档策略</h4>
            <p class="section-desc">用户看到的是答题模式；模型、实际推理强度和点数倍率均由服务端配置，客户端不能覆盖。</p>
          </div>
        </div>
        <div class="learning-tier-grid">
          <article v-for="tier in learningTierAssignments" :key="tier.key" class="learning-tier-card">
            <div>
              <strong>{{ tier.label }}</strong>
              <small>{{ tier.description }}</small>
            </div>
            <label>
              <span>模型</span>
              <el-select v-model="form.learningAssistantTiers[tier.key].model" filterable allow-create default-first-option>
                <el-option v-for="model in modelOptions" :key="`${tier.key}-${model}`" :label="model" :value="model" />
              </el-select>
            </label>
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
      </div>
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
        <button type="button" class="sub-toggle" :class="{ expanded: textPromptsExpanded }" @click="textPromptsExpanded = !textPromptsExpanded">
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
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="群消息带图片时会优先使用“图片审核”模型；请配置支持视觉输入的模型。Spark/Codex 文本模型不会接收图片。"
        />
      </div>

      <div class="prompt-card">
        <button type="button" class="sub-toggle" :class="{ expanded: qqGroupAdPromptsExpanded }" @click="qqGroupAdPromptsExpanded = !qqGroupAdPromptsExpanded">
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

      <div class="actions-row">
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
        <button type="button" class="sub-toggle" :class="{ expanded: imagePromptsExpanded }" @click="imagePromptsExpanded = !imagePromptsExpanded">
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

      <div class="actions-row">
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
        <button type="button" class="sub-toggle" :class="{ expanded: videoPromptsExpanded }" @click="videoPromptsExpanded = !videoPromptsExpanded">
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

      <div class="actions-row">
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
              <div class="table-actions">
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
          <el-option label="帖子" value="topic" />
          <el-option label="回复" value="reply" />
          <el-option label="编辑相似度" value="topic-edit" />
          <el-option label="QQ群广告" value="qqbot-group-ad" />
          <el-option label="图片" value="image" />
          <el-option label="视频" value="video" />
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
          <el-table-column prop="kind" label="类型" width="110" />
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
import { ElMessage, ElMessageBox } from "element-plus";
import {
  adminApi,
  type AiReviewLogRow,
  type ForumImageSweepResult,
  type ForumVideoQueueRow,
  type ForumVideoSweepResult,
  type AiServiceConfig,
  type SiteConfig,
  type SitePromptDefaults,
} from "@/api/admin";
import { fmtDate } from "@/utils/format";

const loadingConfig = ref(false);
const loadingModels = ref(false);
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
const modelOptions = ref<string[]>([]);
const modelCatalogEndpoint = ref("");
let configLoadSeq = 0;
let promptDefaultsLoadSeq = 0;
let logsLoadSeq = 0;
let videosLoadSeq = 0;
const filters = reactive({ kind: "", status: "", page: 1, size: 20 });
const videoFilters = reactive<{ status: "" | "pending" | "manual_review" | "rejected" | "approved" | "error"; page: number; size: number }>({
  status: "manual_review",
  page: 1,
  size: 20,
});
const modelAssignments = [
  { key: "assistantModel", label: "拾间 AI", description: "站内问答与校园服务咨询" },
  { key: "aiReviewModel", label: "文字审核", description: "帖子、回复与编辑相似度" },
  { key: "qqGroupAdReviewModel", label: "QQ群广告过滤", description: "群消息广告与引流识别" },
  { key: "imageReviewModel", label: "图片审核", description: "论坛图片安全审核" },
  { key: "videoReviewModel", label: "视频审核", description: "关键帧、音轨与上下文审核" },
] as const;
const serviceAssignments = [
  { key: "aiReviewServiceId", label: "拾间 AI / 文字审核" },
  { key: "qqGroupAdReviewServiceId", label: "QQ群广告过滤" },
  { key: "imageReviewServiceId", label: "图片审核" },
  { key: "videoReviewServiceId", label: "视频审核" },
] as const;
const serviceProviderOptions = [
  { value: "deepseek", label: "DeepSeek 兼容接口" },
  { value: "openai", label: "OpenAI 兼容接口" },
  { value: "ollama", label: "Ollama" },
] as const;
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
const DEFAULT_REMOTE_AI_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_OLLAMA_ADDRESS = "http://127.0.0.1:11434";
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
  }],
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
  anonymousMinReputation: 30,
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

const selectedAiService = computed<AiServiceConfig | null>(() => (
  form.aiServices.find((service) => service.id === form.aiReviewServiceId)
  || form.aiServices[0]
  || null
));
const isOllamaProvider = computed(() => selectedAiService.value?.provider.trim().toLowerCase() === "ollama");
const aiEditSimilarityPercent = computed({
  get: () => Math.round((form.aiEditSimilarityThreshold ?? 0) * 100),
  set: (value: number) => {
    form.aiEditSimilarityThreshold = value / 100;
  },
});
const modelCatalogSummary = computed(() => {
  if (loadingModels.value) return isOllamaProvider.value
    ? "正在从 Ollama 读取模型列表…"
    : "正在从上游 /model 接口读取模型列表…";
  if (modelOptions.value.length) {
    const source = modelCatalogEndpoint.value ? ` · ${modelCatalogEndpoint.value}` : "";
    return `已读取 ${modelOptions.value.length} 个模型${source}；下拉列表之外仍可手动填写模型 ID。`;
  }
  return isOllamaProvider.value
    ? "点击“刷新模型列表”会由服务端读取 Ollama 的 /v1/models（必要时回退到 /api/tags）；也可以直接填写模型 ID。"
    : "点击“刷新模型列表”会由服务端代为请求上游 /model 接口，浏览器不会直接连接上游。";
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
    if (seq === configLoadSeq) {
      Object.assign(form, config);
      ensureAiServices();
      mergeModelOptions();
    }
  } catch (error) {
    if (seq === configLoadSeq) {
      configLoadError.value = requestMessage(error) || "审核配置加载失败，请稍后重试";
    }
  } finally {
    if (seq === configLoadSeq) loadingConfig.value = false;
  }
}

function mergeModelOptions(models: string[] = []) {
  const configured = modelAssignments.map((item) => String(form[item.key] || ""));
  const learningModels = learningTierAssignments.map((item) => form.learningAssistantTiers[item.key].model);
  const fallbackModels = [
    form.aiReviewFallbackModels,
    form.qqGroupAdReviewFallbackModels,
    form.imageReviewFallbackModels,
    form.videoReviewFallbackModels,
  ].flatMap((value) => String(value || "").split(/[\s,]+/));
  modelOptions.value = Array.from(new Set([
    ...models,
    ...configured,
    ...learningModels,
    ...fallbackModels,
  ].map((model) => model.trim()).filter(Boolean)));
}

function ensureAiServices() {
  if (!Array.isArray(form.aiServices) || !form.aiServices.length) {
    form.aiServices.splice(0, form.aiServices.length, {
      id: "default-main",
      name: "默认 AI 服务",
      provider: "deepseek",
      apiUrl: DEFAULT_REMOTE_AI_URL,
      apiKey: "",
    });
  }
  const seen = new Set<string>();
  form.aiServices.forEach((service, index) => {
    const fallbackId = `service-${index + 1}`;
    let id = String(service.id || fallbackId).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 48) || fallbackId;
    while (seen.has(id)) id = `${id.slice(0, 42)}-${index + 1}`;
    service.id = id;
    service.name = String(service.name || `AI 服务 ${index + 1}`).trim();
    service.provider = String(service.provider || "deepseek").trim() || "deepseek";
    service.apiUrl = String(service.apiUrl || "").trim();
    service.apiKey = String(service.apiKey || "").trim();
    seen.add(id);
  });
  for (const item of serviceAssignments) {
    if (!form.aiServices.some((service) => service.id === form[item.key])) {
      form[item.key] = form.aiServices[0].id;
    }
  }
}

function handleServiceProviderChange(service: AiServiceConfig) {
  const normalizedProvider = service.provider.trim().toLowerCase();
  const currentUrl = service.apiUrl.trim();
  if (normalizedProvider === "ollama" && (!currentUrl || currentUrl === DEFAULT_REMOTE_AI_URL)) {
    service.apiUrl = DEFAULT_OLLAMA_ADDRESS;
  } else if (normalizedProvider !== "ollama" && currentUrl === DEFAULT_OLLAMA_ADDRESS) {
    service.apiUrl = DEFAULT_REMOTE_AI_URL;
  }
}

function addAiService() {
  const service: AiServiceConfig = {
    id: `service-${Date.now()}`,
    name: `AI 服务 ${form.aiServices.length + 1}`,
    provider: "deepseek",
    apiUrl: DEFAULT_REMOTE_AI_URL,
    apiKey: "",
  };
  form.aiServices.push(service);
}

function removeAiService(serviceId: string) {
  if (form.aiServices.length <= 1) return;
  const index = form.aiServices.findIndex((service) => service.id === serviceId);
  if (index < 0) return;
  const fallbackId = form.aiServices[index === 0 ? 1 : 0].id;
  form.aiServices.splice(index, 1);
  for (const item of serviceAssignments) {
    if (form[item.key] === serviceId) form[item.key] = fallbackId;
  }
}

function serviceForScene(serviceId: string) {
  return form.aiServices.find((service) => service.id === serviceId) || form.aiServices[0] || null;
}

async function loadModels() {
  const service = selectedAiService.value;
  if (loadingModels.value || !service?.apiUrl.trim()) return;
  loadingModels.value = true;
  try {
    const catalog = await adminApi.aiModels({
      provider: service.provider,
      apiUrl: service.apiUrl.trim(),
      apiKey: service.apiKey.trim(),
    });
    modelCatalogEndpoint.value = catalog.endpoint;
    mergeModelOptions(catalog.models);
    ElMessage.success(`已从上游读取 ${catalog.models.length} 个模型`);
  } catch (error) {
    ElMessage.error(requestMessage(error) || "上游模型列表读取失败");
  } finally {
    loadingModels.value = false;
  }
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
    ensureAiServices();
    const mainService = serviceForScene(form.aiReviewServiceId) as AiServiceConfig;
    const qqService = serviceForScene(form.qqGroupAdReviewServiceId) as AiServiceConfig;
    const imageService = serviceForScene(form.imageReviewServiceId) as AiServiceConfig;
    const videoService = serviceForScene(form.videoReviewServiceId) as AiServiceConfig;
    Object.assign(form, await adminApi.updateSiteConfig({
      assistantModel: form.assistantModel,
      learningAssistantTiers: form.learningAssistantTiers,
      aiServices: form.aiServices.map((service) => ({ ...service })),
      aiReviewServiceId: mainService.id,
      aiReviewEnabled: form.aiReviewEnabled,
      aiReviewProvider: mainService.provider,
      aiReviewApiUrl: mainService.apiUrl,
      aiReviewModel: form.aiReviewModel,
      aiReviewFallbackModels: form.aiReviewFallbackModels,
      aiReviewApiKey: mainService.apiKey,
      qqGroupAdReviewServiceId: qqService.id,
      qqGroupAdReviewEnabled: form.qqGroupAdReviewEnabled,
      qqGroupAdReviewProvider: qqService.provider,
      qqGroupAdReviewApiUrl: qqService.apiUrl,
      qqGroupAdReviewModel: form.qqGroupAdReviewModel,
      qqGroupAdReviewFallbackModels: form.qqGroupAdReviewFallbackModels,
      qqGroupAdReviewApiKey: qqService.apiKey,
      qqGroupAdReviewSystemPrompt: form.qqGroupAdReviewSystemPrompt,
      qqGroupAdReviewUserPrompt: form.qqGroupAdReviewUserPrompt,
      imageReviewServiceId: imageService.id,
      imageReviewProvider: imageService.provider,
      imageReviewEnabled: form.imageReviewEnabled,
      imageReviewApiUrl: imageService.apiUrl,
      imageReviewModel: form.imageReviewModel,
      imageReviewFallbackModels: form.imageReviewFallbackModels,
      imageReviewApiKey: imageService.apiKey,
      imageReviewSystemPrompt: form.imageReviewSystemPrompt,
      imageReviewUserPrompt: form.imageReviewUserPrompt,
      imageReviewConcurrency: form.imageReviewConcurrency,
      imageReviewRequestGroupSize: form.imageReviewRequestGroupSize,
      videoReviewServiceId: videoService.id,
      videoReviewProvider: videoService.provider,
      videoReviewEnabled: form.videoReviewEnabled,
      videoReviewApiUrl: videoService.apiUrl,
      videoReviewModel: form.videoReviewModel,
      videoReviewFallbackModels: form.videoReviewFallbackModels,
      videoReviewApiKey: videoService.apiKey,
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
    ensureAiServices();
    mergeModelOptions();
    ElMessage.success("AI 服务、模型与审核配置已保存");
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

.provider-card {
  border-color: var(--el-color-primary-light-7);
  background: var(--el-bg-color);
}

.provider-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.provider-form {
  background: var(--el-fill-color-extra-light);
  border-color: var(--el-border-color-lighter);
}

.service-pool,
.service-routing {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  background: var(--cpu-surface);
  border: 1px solid var(--cpu-border-soft);
}

.service-pool-head,
.service-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.service-card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-card);
}

.service-index {
  color: var(--cpu-text);
  font-size: 14px;
  font-weight: 700;
}

.service-grid,
.routing-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.routing-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.model-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.model-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-blank);
}

.model-field > span {
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 700;
}

.model-field > small {
  min-height: 34px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.learning-tier-panel {
  display: grid;
  gap: 12px;
  padding-top: 4px;
}

.learning-tier-head {
  align-items: end;
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

  .service-grid,
  .routing-grid {
    grid-template-columns: 1fr;
  }

  .model-grid {
    grid-template-columns: 1fr;
  }

  .learning-tier-grid {
    grid-template-columns: 1fr;
  }

  .provider-actions,
  .provider-actions :deep(.el-button) {
    width: 100%;
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
