<template>
  <div class="ai-review-pane">
    <section class="settings-card" v-loading="loadingConfig">
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
        <div class="ai-row">
          <span class="ai-label">Provider</span>
          <el-input v-model="form.aiReviewProvider" maxlength="40" placeholder="deepseek" />
        </div>
        <div class="ai-row">
          <span class="ai-label">模型</span>
          <el-input v-model="form.aiReviewModel" maxlength="80" placeholder="deepseek-v4-flash" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">模型备选</span>
          <el-input v-model="form.aiReviewFallbackModels" maxlength="400" placeholder="逗号分隔，例如 gpt-4.1, gpt-4o-mini" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">API Key</span>
          <el-input v-model="form.aiReviewApiKey" maxlength="240" show-password placeholder="sk-..." />
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
          <el-button text :disabled="loadingPromptDefaults" @click="resetTextPrompts">重置文字 Prompt</el-button>
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

    <section class="settings-card" v-loading="loadingConfig">
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
        <div class="ai-row">
          <span class="ai-label">图片模型</span>
          <el-input v-model="form.imageReviewModel" maxlength="80" placeholder="gpt-4o-mini" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">模型备选</span>
          <el-input v-model="form.imageReviewFallbackModels" maxlength="400" placeholder="逗号分隔，例如 gpt-4.1, gpt-4o-mini" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">图片审核 API 地址</span>
          <el-input v-model="form.imageReviewApiUrl" maxlength="240" placeholder="https://api.openai.com/v1/chat/completions" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">图片审核 API Key</span>
          <el-input v-model="form.imageReviewApiKey" maxlength="240" show-password placeholder="sk-..." />
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
          <el-button text :disabled="loadingPromptDefaults" @click="resetImagePrompts">重置图片 Prompt</el-button>
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
        <el-button type="primary" :loading="saving" @click="saveConfig">保存审核配置</el-button>
        <el-button plain :disabled="loadingPromptDefaults" @click="resetAllPrompts">重置全部 Prompt</el-button>
        <el-button plain :loading="sweepingImages" @click="sweepForumImages">一键补扫全站图片</el-button>
      </div>
      <p v-if="lastImageSweepSummary" class="actions-note">{{ lastImageSweepSummary }}</p>
    </section>

    <section class="settings-card" v-loading="loadingConfig">
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
        <div class="ai-row">
          <span class="ai-label">视频模型</span>
          <el-input v-model="form.videoReviewModel" maxlength="80" placeholder="gpt-4o-mini" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">模型备选</span>
          <el-input v-model="form.videoReviewFallbackModels" maxlength="400" placeholder="逗号分隔，例如 gpt-4.1, gpt-4o-mini" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">视频审核 API 地址</span>
          <el-input v-model="form.videoReviewApiUrl" maxlength="240" placeholder="https://api.openai.com/v1/chat/completions" />
        </div>
        <div class="ai-row ai-row--stretch">
          <span class="ai-label">视频审核 API Key</span>
          <el-input v-model="form.videoReviewApiKey" maxlength="240" show-password placeholder="sk-..." />
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
          <el-button text :disabled="loadingPromptDefaults" @click="resetVideoPrompts">重置视频 Prompt</el-button>
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
        <el-button type="primary" :loading="saving" @click="saveConfig">保存审核配置</el-button>
        <el-button plain :disabled="loadingPromptDefaults" @click="resetAllPrompts">重置全部 Prompt</el-button>
        <el-button plain :loading="sweepingVideos" @click="sweepForumVideos">一键补扫全站视频</el-button>
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
        <el-button plain :loading="loadingVideos" @click="loadVideos">刷新</el-button>
      </div>

      <el-table :data="videoRows" v-loading="loadingVideos" size="small" class="admin-table">
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
            <a v-if="row.targetUrl" :href="row.targetUrl" target="_blank" rel="noreferrer">{{ row.targetLabel }}</a>
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
              <el-button size="small" type="success" plain @click="approveVideo(row)">通过</el-button>
              <el-button size="small" type="danger" plain @click="rejectVideo(row)">驳回</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
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
          <el-option label="图片" value="image" />
          <el-option label="视频" value="video" />
        </el-select>
        <el-select v-model="filters.status" clearable placeholder="状态" style="width: 140px" @change="loadLogs">
          <el-option label="开始" value="started" />
          <el-option label="成功" value="success" />
          <el-option label="失败" value="error" />
        </el-select>
        <el-button plain :loading="loadingLogs" @click="loadLogs">刷新</el-button>
      </div>

      <el-table :data="logs" v-loading="loadingLogs" size="small" class="admin-table">
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
const loadingPromptDefaults = ref(false);
const textPromptsExpanded = ref(false);
const imagePromptsExpanded = ref(false);
const videoPromptsExpanded = ref(false);
const logs = ref<AiReviewLogRow[]>([]);
const lastImageSweepSummary = ref("");
const lastVideoSweepSummary = ref("");
const videoRows = ref<ForumVideoQueueRow[]>([]);
const promptDefaults = ref<SitePromptDefaults | null>(null);
const filters = reactive({ kind: "", status: "", page: 1, size: 20 });
const videoFilters = reactive<{ status: "" | "pending" | "manual_review" | "rejected" | "approved" | "error"; page: number; size: number }>({
  status: "manual_review",
  page: 1,
  size: 20,
});
const form = reactive<SiteConfig>({
  siteOrigin: "",
  aiReviewEnabled: false,
  aiReviewProvider: "deepseek",
  aiReviewModel: "deepseek-v4-flash",
  aiReviewFallbackModels: "",
  aiReviewApiKey: "",
  imageReviewEnabled: false,
  imageReviewApiUrl: "https://api.openai.com/v1/chat/completions",
  imageReviewModel: "gpt-4o-mini",
  imageReviewFallbackModels: "",
  imageReviewApiKey: "",
  imageReviewSystemPrompt: "",
  imageReviewUserPrompt: "",
  imageReviewConcurrency: 2,
  imageReviewRequestGroupSize: 3,
  videoReviewEnabled: false,
  videoReviewApiUrl: "https://api.openai.com/v1/chat/completions",
  videoReviewModel: "gpt-4o-mini",
  videoReviewFallbackModels: "",
  videoReviewApiKey: "",
  videoReviewSystemPrompt: "",
  videoReviewUserPrompt: "",
  videoReviewConcurrency: 1,
  aiReviewThreshold: 24,
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
  forumEnabledBonus: 6,
  anonymousTiers: [],
  reputationLevels: [],
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
  loadingConfig.value = true;
  try {
    Object.assign(form, await adminApi.siteConfig());
  } finally {
    loadingConfig.value = false;
  }
}

async function loadPromptDefaults() {
  loadingPromptDefaults.value = true;
  try {
    promptDefaults.value = await adminApi.sitePromptDefaults();
  } finally {
    loadingPromptDefaults.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    Object.assign(form, await adminApi.updateSiteConfig({
      aiReviewEnabled: form.aiReviewEnabled,
      aiReviewProvider: form.aiReviewProvider,
      aiReviewModel: form.aiReviewModel,
      aiReviewFallbackModels: form.aiReviewFallbackModels,
      aiReviewApiKey: form.aiReviewApiKey,
      imageReviewEnabled: form.imageReviewEnabled,
      imageReviewApiUrl: form.imageReviewApiUrl,
      imageReviewModel: form.imageReviewModel,
      imageReviewFallbackModels: form.imageReviewFallbackModels,
      imageReviewApiKey: form.imageReviewApiKey,
      imageReviewSystemPrompt: form.imageReviewSystemPrompt,
      imageReviewUserPrompt: form.imageReviewUserPrompt,
      imageReviewConcurrency: form.imageReviewConcurrency,
      imageReviewRequestGroupSize: form.imageReviewRequestGroupSize,
      videoReviewEnabled: form.videoReviewEnabled,
      videoReviewApiUrl: form.videoReviewApiUrl,
      videoReviewModel: form.videoReviewModel,
      videoReviewFallbackModels: form.videoReviewFallbackModels,
      videoReviewApiKey: form.videoReviewApiKey,
      videoReviewSystemPrompt: form.videoReviewSystemPrompt,
      videoReviewUserPrompt: form.videoReviewUserPrompt,
      videoReviewConcurrency: form.videoReviewConcurrency,
      aiReviewThreshold: form.aiReviewThreshold,
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
    ElMessage.success("审核配置已保存");
  } finally {
    saving.value = false;
  }
}

function applyPromptDefaults(scope: "text" | "image" | "video" | "all") {
  if (!promptDefaults.value) return;
  const defaults = promptDefaults.value;
  if (scope === "text" || scope === "all") {
    form.aiTopicReviewSystemPrompt = defaults.aiTopicReviewSystemPrompt;
    form.aiTopicReviewUserPrompt = defaults.aiTopicReviewUserPrompt;
    form.aiReplyReviewSystemPrompt = defaults.aiReplyReviewSystemPrompt;
    form.aiReplyReviewUserPrompt = defaults.aiReplyReviewUserPrompt;
    form.aiEditSimilaritySystemPrompt = defaults.aiEditSimilaritySystemPrompt;
    form.aiEditSimilarityUserPrompt = defaults.aiEditSimilarityUserPrompt;
  }
  if (scope === "image" || scope === "all") {
    form.imageReviewSystemPrompt = defaults.imageReviewSystemPrompt;
    form.imageReviewUserPrompt = defaults.imageReviewUserPrompt;
  }
  if (scope === "video" || scope === "all") {
    form.videoReviewSystemPrompt = defaults.videoReviewSystemPrompt;
    form.videoReviewUserPrompt = defaults.videoReviewUserPrompt;
  }
  const scopeLabel = scope === "text" ? "文字" : scope === "image" ? "图片" : scope === "video" ? "视频" : "全部";
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

async function resetVideoPrompts() {
  if (!promptDefaults.value) await loadPromptDefaults();
  applyPromptDefaults("video");
}

async function resetAllPrompts() {
  if (!promptDefaults.value) await loadPromptDefaults();
  applyPromptDefaults("all");
}

async function loadLogs() {
  loadingLogs.value = true;
  try {
    const result = await adminApi.aiReviewLogs(filters);
    logs.value = result.list;
  } finally {
    loadingLogs.value = false;
  }
}

async function sweepForumImages() {
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
  loadingVideos.value = true;
  try {
    const result = await adminApi.forumVideos({
      status: videoFilters.status || undefined,
      page: videoFilters.page,
      size: videoFilters.size,
    });
    videoRows.value = result.list;
  } finally {
    loadingVideos.value = false;
  }
}

async function sweepForumVideos() {
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

async function approveVideo(row: ForumVideoQueueRow) {
  await ElMessageBox.confirm("确认将这条视频人工审核通过并恢复展示？", "人工通过", {
    type: "warning",
    confirmButtonText: "通过",
    cancelButtonText: "取消",
  });
  await adminApi.updateForumVideo(row.id, { status: "approved" });
  ElMessage.success("视频已人工审核通过");
  await loadVideos();
}

async function rejectVideo(row: ForumVideoQueueRow) {
  const { value } = await ElMessageBox.prompt("可选填写人工驳回备注，留空会保留当前审核说明。", "继续隐藏", {
    inputPlaceholder: "例如：画面中可识别隐私信息较多，不适合公开展示",
  }).catch(() => ({ value: null }));
  if (value === null) return;
  await adminApi.updateForumVideo(row.id, {
    status: "rejected",
    manualReviewNote: value || undefined,
  });
  ElMessage.success("视频已维持隐藏");
  await loadVideos();
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
</script>

<style scoped>
.ai-review-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.settings-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border: 1px solid #e7edf5;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.04);
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
  color: #111827;
}

.section-desc {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: #667085;
}

.ai-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  background: #ffffff;
  border: 1px solid #edf2f7;
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
  color: #6b7280;
}

.prompt-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: 14px;
  background: #fcfdff;
  border: 1px dashed #d7e2f0;
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
  color: #1f2937;
}

.desc {
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
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
  color: #64748b;
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
  color: #667085;
}

.filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
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
  background: #fff7ed;
  color: #c2410c;
}

.status-success {
  background: #ecfdf5;
  color: #166534;
}

.status-error {
  background: #fef2f2;
  color: #b91c1c;
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
