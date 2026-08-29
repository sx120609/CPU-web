<template>
  <div class="features-pane">
    <el-alert type="warning" :closable="false" show-icon class="warn">
      <template #title>
        紧急下架开关 —— 默认全开
      </template>
      <div style="font-size:13px;line-height:1.7;margin-top:4px">
        关闭某项后：导航栏入口会立刻消失，普通用户访问对应路由会被引导回首页，发帖接口拒绝写入。
        <b>已发布的内容不会被删除</b>（关闭只是不可见、不可发新）。<br>
        admin / mod 角色仍能进入这些路由查看历史内容，便于在敏感期间复审 / 清理。
      </div>
    </el-alert>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="pane-alert"
      :title="loadError"
    >
      <template #default>
        <el-button size="small" :loading="loading || configLoading" @click="reload">重试</el-button>
      </template>
    </el-alert>

    <section class="settings-card" v-loading="configLoading">
      <div class="section-head">
        <div>
          <h3 class="section-title">基础配置</h3>
          <p class="section-desc">把常用配置单独放前面，避免一进来就被大段 AI 表单淹没。</p>
        </div>
      </div>

      <div class="site-config">
        <div class="config-copy">
          <div class="card-title">网站域名</div>
          <div class="desc">用于生成 iOS / Android 小组件 API 地址。留空时会回退到当前请求的 Host，开发环境可能显示 127.0.0.1。</div>
        </div>
        <div class="config-form">
          <el-input
            v-model="siteOrigin"
            clearable
            maxlength="240"
            placeholder="https://cpu.example.com"
            :disabled="savingConfig || configLoading || Boolean(loadError)"
            @keyup.enter="saveSiteConfig"
          />
          <el-button type="primary" :loading="savingConfig" :disabled="savingConfig || configLoading || Boolean(loadError)" @click="saveSiteConfig">保存</el-button>
        </div>
      </div>

      <div class="site-config">
        <div class="config-copy">
          <div class="card-title">备案号</div>
          <div class="desc">显示在全站底部。通常填写类似“苏 ICP 备 2024000000 号-1”的备案编号，留空则不显示。</div>
        </div>
        <div class="config-form">
          <el-input
            v-model="siteFilingNumber"
            clearable
            maxlength="120"
            placeholder="苏ICP备2024000000号-1"
            :disabled="savingConfig || configLoading || Boolean(loadError)"
            @keyup.enter="saveSiteConfig"
          />
          <el-button type="primary" :loading="savingConfig" :disabled="savingConfig || configLoading || Boolean(loadError)" @click="saveSiteConfig">保存</el-button>
        </div>
      </div>

      <button type="button" class="section-toggle" :class="{ expanded: trustConfigExpanded }" @click="trustConfigExpanded = !trustConfigExpanded">
        <div class="section-toggle-copy">
          <div class="section-toggle-top">
            <h3 class="section-title">匿名与信誉规则</h3>
            <span class="toggle-pill on">5 级规则</span>
          </div>
          <p class="section-desc">默认收起。需要时再展开调整匿名门槛、周额度、信誉积分公式和等级门槛，避免基础配置区太长。</p>
          <div class="summary-row">
            <span class="summary-pill">匿名门槛 {{ anonymousMinReputation }}</span>
            <span class="summary-pill">Lv.5 {{ reputationLevels[4]?.minReputation ?? 0 }}</span>
          </div>
        </div>
        <span class="toggle-arrow" aria-hidden="true">▾</span>
      </button>

      <div v-if="trustConfigExpanded" class="site-config trust-config">
        <div class="config-copy">
          <div class="card-title">匿名与信誉规则</div>
          <div class="desc">匿名最低信誉、周额度档位、信誉积分公式和 5 级信誉等级都可以在这里调整。匿名楼主在自己的匿名帖下匿名回复时会自动免扣点。</div>
        </div>
        <div class="trust-config-form">
          <div class="trust-grid">
            <div class="trust-field">
              <span class="field-label">匿名最低信誉</span>
              <el-input-number v-model="anonymousMinReputation" :min="0" :max="9999" />
            </div>
            <div class="trust-field">
              <span class="field-label">注册步长（天）</span>
              <el-input-number v-model="accountAgeDaysPerStep" :min="1" :max="3650" />
            </div>
            <div class="trust-field">
              <span class="field-label">注册每档积分</span>
              <el-input-number v-model="accountAgePointsPerStep" :min="0" :max="999" />
            </div>
            <div class="trust-field">
              <span class="field-label">注册积分上限</span>
              <el-input-number v-model="accountAgePointsCap" :min="0" :max="9999" />
            </div>
            <div class="trust-field">
              <span class="field-label">每帖积分</span>
              <el-input-number v-model="postPointsPerTopic" :min="0" :max="999" />
            </div>
            <div class="trust-field">
              <span class="field-label">发帖积分上限</span>
              <el-input-number v-model="postPointsCap" :min="0" :max="9999" />
            </div>
            <div class="trust-field">
              <span class="field-label">每回复积分</span>
              <el-input-number v-model="replyPointsPerReply" :min="0" :max="999" />
            </div>
            <div class="trust-field">
              <span class="field-label">回复积分上限</span>
              <el-input-number v-model="replyPointsCap" :min="0" :max="9999" />
            </div>
          </div>

          <div class="trust-subcard">
            <div class="subcard-title">匿名周额度档位</div>
            <div class="tier-grid">
              <div v-for="(tier, index) in anonymousTiers" :key="`tier-${index}`" class="tier-row">
                <span class="field-label">档位 {{ index + 1 }}</span>
                <el-input-number v-model="tier.reputation" :min="0" :max="9999" />
                <span class="field-inline-label">周额度</span>
                <el-input-number v-model="tier.quota" :min="0" :max="999" />
              </div>
            </div>
          </div>

          <div class="trust-subcard">
            <div class="subcard-title">信誉等级（5 级）</div>
            <div class="level-grid">
              <div v-for="(level, index) in reputationLevels" :key="`level-${index}`" class="level-row">
                <span class="field-label">Lv.{{ index + 1 }}</span>
                <el-input v-model="level.name" maxlength="20" placeholder="等级名称" />
                <span class="field-inline-label">门槛</span>
                <el-input-number v-model="level.minReputation" :min="0" :max="9999" />
              </div>
            </div>
          </div>

          <div class="actions-row">
            <el-button type="primary" :loading="savingConfig" :disabled="savingConfig || configLoading || Boolean(loadError)" @click="saveTrustConfig">保存匿名与信誉规则</el-button>
          </div>
        </div>
      </div>
    </section>

    <section class="settings-card" v-loading="loading">
      <div class="section-head">
        <div>
          <h3 class="section-title">功能开启 / 关闭</h3>
          <p class="section-desc">按模块开关，移动端下改成卡片堆叠，开关和说明不会再挤成一团。</p>
        </div>
        <div class="section-meta">当前开启 {{ enabledFeatureCount }} / {{ featureMeta.length }}</div>
      </div>

      <div class="feature-grid">
        <div v-for="f in featureMeta" :key="f.key" class="feature-row">
          <div class="feature-head">
            <div class="left">
              <div class="card-title">
                <span class="icon"><AppIcon :name="f.icon" /></span> {{ f.title }}
              </div>
              <div class="desc">{{ f.desc }}</div>
            </div>
            <el-switch
              :model-value="features[f.key]"
              :loading="pendingKey === f.key"
              size="large"
              inline-prompt
              active-text="开"
              inactive-text="关"
              :disabled="loading || Boolean(loadError) || pendingKey !== null"
              @change="(v: boolean | string | number) => toggle(f.key, Boolean(v))"
            />
          </div>
          <div class="paths">影响入口：<code>{{ f.paths.join(" · ") }}</code></div>
        </div>
      </div>
    </section>

    <section class="settings-card" v-loading="configLoading">
      <div class="section-head">
        <div>
          <h3 class="section-title">桌面端网课平台</h3>
          <p class="section-desc">可以单独暂停某个平台。关闭后客户端入口会标记为“暂时停用”，并阻止打开页面、注入助手与调用解题 AI。</p>
        </div>
        <div class="section-meta">当前开放 {{ enabledLearningPlatformCount }} / {{ learningPlatformMeta.length }}</div>
      </div>

      <div class="feature-grid">
        <div v-for="platform in learningPlatformMeta" :key="platform.key" class="feature-row">
          <div class="feature-head">
            <div class="left">
              <div class="card-title"><span class="icon"><AppIcon name="course" /></span> {{ platform.title }}</div>
              <div class="desc">{{ platform.desc }}</div>
            </div>
            <el-switch
              :model-value="learningPlatforms[platform.key]"
              :loading="pendingLearningPlatformKey === platform.key"
              size="large"
              inline-prompt
              active-text="开"
              inactive-text="关"
              :disabled="configLoading || Boolean(loadError) || pendingLearningPlatformKey !== null"
              @change="(v: boolean | string | number) => toggleLearningPlatform(platform.key, Boolean(v))"
            />
          </div>
          <div class="paths">影响范围：<code>客户端入口 · 页面注入 · AI 解题</code></div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi, type LearningPlatformAvailability } from "@/api/admin";
import { useSiteStore } from "@/stores/site";
import AppIcon from "@/components/common/AppIcon.vue";

type FKey = "forum" | "market" | "coursereview" | "electric" | "sponsor";
type LearningPlatformKey = keyof LearningPlatformAvailability;

const site = useSiteStore();
const loading = ref(false);
const configLoading = ref(false);
const loadError = ref("");
const savingConfig = ref(false);
const pendingKey = ref<FKey | null>(null);
const pendingLearningPlatformKey = ref<LearningPlatformKey | null>(null);
const aiConfigExpanded = ref(false);
const aiPromptsExpanded = ref(false);
const trustConfigExpanded = ref(false);
const siteOrigin = ref("");
const siteFilingNumber = ref("");
const aiReviewEnabled = ref(false);
const aiReviewProvider = ref("deepseek");
const aiReviewModel = ref("deepseek-v4-flash");
const aiReviewApiKey = ref("");
const imageReviewEnabled = ref(false);
const imageReviewApiUrl = ref("https://api.openai.com/v1/chat/completions");
const imageReviewModel = ref("gpt-4o-mini");
const imageReviewApiKey = ref("");
const imageReviewSystemPrompt = ref("");
const imageReviewUserPrompt = ref("");
const aiReviewThreshold = ref(24);
const aiEditSimilarityPercent = ref(0);
const aiTopicReviewSystemPrompt = ref("");
const aiTopicReviewUserPrompt = ref("");
const aiReplyReviewSystemPrompt = ref("");
const aiReplyReviewUserPrompt = ref("");
const aiEditSimilaritySystemPrompt = ref("");
const aiEditSimilarityUserPrompt = ref("");
const anonymousMinReputation = ref(30);
const accountAgeDaysPerStep = ref(14);
const accountAgePointsPerStep = ref(2);
const accountAgePointsCap = ref(36);
const postPointsPerTopic = ref(4);
const postPointsCap = ref(48);
const replyPointsPerReply = ref(2);
const replyPointsCap = ref(48);
const anonymousTiers = ref([
  { reputation: 30, quota: 1 },
  { reputation: 60, quota: 2 },
  { reputation: 90, quota: 3 },
  { reputation: 120, quota: 4 },
]);
const reputationLevels = ref([
  { level: 1, name: "初来乍到", minReputation: 0 },
  { level: 2, name: "渐入佳境", minReputation: 30 },
  { level: 3, name: "活跃同学", minReputation: 60 },
  { level: 4, name: "资深成员", minReputation: 90 },
  { level: 5, name: "校园传说", minReputation: 120 },
]);
const features = reactive<{ forum: boolean; market: boolean; coursereview: boolean; electric: boolean; sponsor: boolean }>({
  forum: true, market: true, coursereview: true, electric: true, sponsor: true,
});
const learningPlatforms = reactive<LearningPlatformAvailability>({
  chaoxing: true,
  zhihuishu: true,
  icve: true,
  zjy: true,
  icourse: true,
  yuketang: true,
  weban: true,
});
const enabledFeatureCount = computed(() => featureMeta.filter((item) => features[item.key]).length);
const enabledLearningPlatformCount = computed(() => learningPlatformMeta.filter((item) => learningPlatforms[item.key]).length);
let featureLoadSeq = 0;

const featureMeta: { key: FKey; icon: string; title: string; desc: string; paths: string[] }[] = [
  {
    key: "forum", icon: "forum", title: "论坛（通用板块 + 发帖）",
    desc: "灌水广场 / 校园生活 / 新生入学 / 提问广场等通用板块的可见与发帖。",
    paths: ["/forum", "/post", "/forum/topic/:id"],
  },
  {
    key: "market", icon: "market", title: "二手交流（论坛板块）",
    desc: "闲置、求购和经验交流帖；只提供论坛发帖与回复，不提供站内交易。",
    paths: ["/market", "boards type=market"],
  },
  {
    key: "coursereview", icon: "chart", title: "课程点评",
    desc: "评老师 / 课程的板块。",
    paths: ["/coursereview", "/coursereview/:id"],
  },
  {
    key: "electric", icon: "electric", title: "宿舍电费查询",
    desc: "首页与校园服务页的电费快捷卡片；如果隧道不通、不想暴露这个功能时关掉。",
    paths: ["/api/services/dorm-electric", "首页电费卡片"],
  },
  {
    key: "sponsor", icon: "card", title: "赞助入口",
    desc: "个人中心的赞助入口和下单接口。关闭后不影响已完成赞助金额展示。",
    paths: ["/profile", "/api/payments/sponsor/orders"],
  },
];

const learningPlatformMeta: Array<{ key: LearningPlatformKey; title: string; desc: string }> = [
  { key: "chaoxing", title: "超星学习通", desc: "继续使用药大拾间专用学习通助手。" },
  { key: "zhihuishu", title: "知到智慧树", desc: "共享课、视频与作业。" },
  { key: "icve", title: "智慧职教 / MOOC", desc: "职教课程、视频与测验。" },
  { key: "zjy", title: "职教云", desc: "职教云课程与作业。" },
  { key: "icourse", title: "中国大学 MOOC", desc: "课程视频、测验与作业。" },
  { key: "yuketang", title: "雨课堂", desc: "课程、视频与课堂任务。" },
  { key: "weban", title: "安全微伴", desc: "安全教育课程与考试。" },
];

onMounted(reload);

async function reload() {
  const seq = ++featureLoadSeq;
  loading.value = true;
  configLoading.value = true;
  loadError.value = "";
  try {
    const [r, config] = await Promise.all([
      adminApi.features({ suppressErrorMessage: true }),
      adminApi.siteConfig({ suppressErrorMessage: true }),
    ]);
    if (seq !== featureLoadSeq) return;
    Object.assign(features, r);
    site.apply(r);
    siteOrigin.value = config.siteOrigin;
    siteFilingNumber.value = config.siteFilingNumber;
    Object.assign(learningPlatforms, config.learningPlatforms);
    aiReviewEnabled.value = config.aiReviewEnabled;
    aiReviewProvider.value = config.aiReviewProvider;
    aiReviewModel.value = config.aiReviewModel;
    aiReviewApiKey.value = config.aiReviewApiKey;
    imageReviewEnabled.value = config.imageReviewEnabled;
    imageReviewApiUrl.value = config.imageReviewApiUrl;
    imageReviewModel.value = config.imageReviewModel;
    imageReviewApiKey.value = config.imageReviewApiKey;
    imageReviewSystemPrompt.value = config.imageReviewSystemPrompt ?? "";
    imageReviewUserPrompt.value = config.imageReviewUserPrompt ?? "";
    aiReviewThreshold.value = config.aiReviewThreshold;
    aiEditSimilarityPercent.value = Math.round((config.aiEditSimilarityThreshold ?? 0) * 100);
    aiTopicReviewSystemPrompt.value = config.aiTopicReviewSystemPrompt ?? "";
    aiTopicReviewUserPrompt.value = config.aiTopicReviewUserPrompt ?? "";
    aiReplyReviewSystemPrompt.value = config.aiReplyReviewSystemPrompt ?? "";
    aiReplyReviewUserPrompt.value = config.aiReplyReviewUserPrompt ?? "";
    aiEditSimilaritySystemPrompt.value = config.aiEditSimilaritySystemPrompt ?? "";
    aiEditSimilarityUserPrompt.value = config.aiEditSimilarityUserPrompt ?? "";
    anonymousMinReputation.value = config.anonymousMinReputation;
    accountAgeDaysPerStep.value = config.accountAgeDaysPerStep;
    accountAgePointsPerStep.value = config.accountAgePointsPerStep;
    accountAgePointsCap.value = config.accountAgePointsCap;
    postPointsPerTopic.value = config.postPointsPerTopic;
    postPointsCap.value = config.postPointsCap;
    replyPointsPerReply.value = config.replyPointsPerReply;
    replyPointsCap.value = config.replyPointsCap;
    anonymousTiers.value = (config.anonymousTiers ?? []).map((item) => ({ ...item }));
    reputationLevels.value = (config.reputationLevels ?? []).map((item) => ({ ...item }));
  } catch (error) {
    if (seq === featureLoadSeq) {
      loadError.value = requestMessage(error) || "功能开关配置加载失败，请稍后重试";
    }
  } finally {
    if (seq === featureLoadSeq) {
      loading.value = false;
      configLoading.value = false;
    }
  }
}

async function saveSiteConfig() {
  if (savingConfig.value || loadError.value) return;
  savingConfig.value = true;
  try {
    const config = await adminApi.updateSiteConfig({
      siteOrigin: siteOrigin.value.trim(),
      siteFilingNumber: siteFilingNumber.value.trim(),
    });
    siteOrigin.value = config.siteOrigin;
    siteFilingNumber.value = config.siteFilingNumber;
    site.applyConfig({
      siteOrigin: config.siteOrigin,
      siteFilingNumber: config.siteFilingNumber,
    });
    ElMessage.success(config.siteOrigin || config.siteFilingNumber ? "基础配置已保存" : "已清空网站域名和备案号");
  } finally {
    savingConfig.value = false;
  }
}

async function saveAiReviewConfig() {
  if (savingConfig.value || loadError.value) return;
  savingConfig.value = true;
  try {
    const config = await adminApi.updateSiteConfig({
      aiReviewEnabled: aiReviewEnabled.value,
      aiReviewProvider: aiReviewProvider.value,
      aiReviewModel: aiReviewModel.value,
      aiReviewApiKey: aiReviewApiKey.value,
      imageReviewEnabled: imageReviewEnabled.value,
      imageReviewApiUrl: imageReviewApiUrl.value,
      imageReviewModel: imageReviewModel.value,
      imageReviewApiKey: imageReviewApiKey.value,
      imageReviewSystemPrompt: imageReviewSystemPrompt.value,
      imageReviewUserPrompt: imageReviewUserPrompt.value,
      aiReviewThreshold: aiReviewThreshold.value,
      aiEditSimilarityThreshold: aiEditSimilarityPercent.value / 100,
      aiTopicReviewSystemPrompt: aiTopicReviewSystemPrompt.value,
      aiTopicReviewUserPrompt: aiTopicReviewUserPrompt.value,
      aiReplyReviewSystemPrompt: aiReplyReviewSystemPrompt.value,
      aiReplyReviewUserPrompt: aiReplyReviewUserPrompt.value,
      aiEditSimilaritySystemPrompt: aiEditSimilaritySystemPrompt.value,
      aiEditSimilarityUserPrompt: aiEditSimilarityUserPrompt.value,
    });
    aiReviewEnabled.value = config.aiReviewEnabled;
    aiReviewProvider.value = config.aiReviewProvider;
    aiReviewModel.value = config.aiReviewModel;
    aiReviewApiKey.value = config.aiReviewApiKey;
    imageReviewEnabled.value = config.imageReviewEnabled;
    imageReviewApiUrl.value = config.imageReviewApiUrl;
    imageReviewModel.value = config.imageReviewModel;
    imageReviewApiKey.value = config.imageReviewApiKey;
    imageReviewSystemPrompt.value = config.imageReviewSystemPrompt ?? "";
    imageReviewUserPrompt.value = config.imageReviewUserPrompt ?? "";
    aiReviewThreshold.value = config.aiReviewThreshold;
    aiEditSimilarityPercent.value = Math.round((config.aiEditSimilarityThreshold ?? 0) * 100);
    aiTopicReviewSystemPrompt.value = config.aiTopicReviewSystemPrompt ?? "";
    aiTopicReviewUserPrompt.value = config.aiTopicReviewUserPrompt ?? "";
    aiReplyReviewSystemPrompt.value = config.aiReplyReviewSystemPrompt ?? "";
    aiReplyReviewUserPrompt.value = config.aiReplyReviewUserPrompt ?? "";
    aiEditSimilaritySystemPrompt.value = config.aiEditSimilaritySystemPrompt ?? "";
    aiEditSimilarityUserPrompt.value = config.aiEditSimilarityUserPrompt ?? "";
    ElMessage.success("AI 审核配置已保存");
  } finally {
    savingConfig.value = false;
  }
}

async function saveTrustConfig() {
  if (savingConfig.value || loadError.value) return;
  savingConfig.value = true;
  try {
    const config = await adminApi.updateSiteConfig({
      anonymousMinReputation: anonymousMinReputation.value,
      accountAgeDaysPerStep: accountAgeDaysPerStep.value,
      accountAgePointsPerStep: accountAgePointsPerStep.value,
      accountAgePointsCap: accountAgePointsCap.value,
      postPointsPerTopic: postPointsPerTopic.value,
      postPointsCap: postPointsCap.value,
      replyPointsPerReply: replyPointsPerReply.value,
      replyPointsCap: replyPointsCap.value,
      forumEnabledBonus: 0,
      anonymousTiers: anonymousTiers.value.map((item) => ({
        reputation: Number(item.reputation || 0),
        quota: Number(item.quota || 0),
      })),
      reputationLevels: reputationLevels.value.map((item, index) => ({
        level: index + 1,
        name: item.name,
        minReputation: Number(item.minReputation || 0),
      })),
    });
    anonymousMinReputation.value = config.anonymousMinReputation;
    accountAgeDaysPerStep.value = config.accountAgeDaysPerStep;
    accountAgePointsPerStep.value = config.accountAgePointsPerStep;
    accountAgePointsCap.value = config.accountAgePointsCap;
    postPointsPerTopic.value = config.postPointsPerTopic;
    postPointsCap.value = config.postPointsCap;
    replyPointsPerReply.value = config.replyPointsPerReply;
    replyPointsCap.value = config.replyPointsCap;
    anonymousTiers.value = (config.anonymousTiers ?? []).map((item) => ({ ...item }));
    reputationLevels.value = (config.reputationLevels ?? []).map((item) => ({ ...item }));
    ElMessage.success("匿名与信誉规则已保存");
  } finally {
    savingConfig.value = false;
  }
}

async function toggle(key: FKey, on: boolean) {
  if (pendingKey.value !== null || loading.value || loadError.value) {
    features[key] = !on;
    return;
  }
  pendingKey.value = key;
  if (!on) {
    const confirmed = await ElMessageBox.confirm(
      `确认关闭「${featureMeta.find((m) => m.key === key)?.title || key}」？\n` +
        `普通用户立刻看不到对应入口，无法发新内容。已发布内容会保留。`,
      "确认关闭",
      { type: "warning", confirmButtonText: "关闭", cancelButtonText: "取消" }
    ).then(() => true).catch(() => false);
    if (!confirmed) {
      features[key] = !on;
      pendingKey.value = null;
      return;
    }
  }
  try {
    const r = await adminApi.updateFeatures({ [key]: on });
    Object.assign(features, r);
    site.apply(r);
    ElMessage.success(on ? "已开启" : "已关闭");
  } catch {
    features[key] = !on;
  } finally { pendingKey.value = null; }
}

async function toggleLearningPlatform(key: LearningPlatformKey, on: boolean) {
  if (pendingLearningPlatformKey.value !== null || configLoading.value || loadError.value) {
    learningPlatforms[key] = !on;
    return;
  }
  pendingLearningPlatformKey.value = key;
  if (!on) {
    const title = learningPlatformMeta.find((item) => item.key === key)?.title || key;
    const confirmed = await ElMessageBox.confirm(
      `确认暂时停用「${title}」？\n客户端将不再允许打开或运行这个平台的助手。`,
      "确认停用平台",
      { type: "warning", confirmButtonText: "停用", cancelButtonText: "取消" }
    ).then(() => true).catch(() => false);
    if (!confirmed) {
      learningPlatforms[key] = !on;
      pendingLearningPlatformKey.value = null;
      return;
    }
  }
  try {
    const config = await adminApi.updateSiteConfig({
      learningPlatforms: { ...learningPlatforms, [key]: on },
    });
    Object.assign(learningPlatforms, config.learningPlatforms);
    ElMessage.success(on ? "平台已开放" : "平台已停用");
  } catch {
    learningPlatforms[key] = !on;
  } finally {
    pendingLearningPlatformKey.value = null;
  }
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.features-pane { display: flex; flex-direction: column; gap: 14px; }
.warn :deep(.el-alert__title) { font-size: 14px; }
.pane-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
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
.section-meta {
  flex-shrink: 0;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(54, 208, 183, 0.14);
  color: var(--cpu-primary-light);
  font-size: 12px;
  font-weight: 600;
}
.site-config {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-surface);
}
.config-copy {
  flex: 1;
  min-width: 0;
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--cpu-text);
}
.config-form {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(520px, 52%);
}
.trust-config {
  align-items: flex-start;
}
.trust-config-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(760px, 100%);
}
.trust-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.trust-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-subtle);
}
.trust-subcard {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  background: var(--cpu-surface-subtle);
  border: 1px dashed var(--cpu-border);
}
.subcard-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--cpu-text);
}
.tier-grid,
.level-grid {
  display: grid;
  gap: 10px;
}
.tier-row,
.level-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.field-label {
  font-size: 12px;
  color: var(--cpu-text-secondary);
}
.field-inline-label {
  font-size: 12px;
  color: var(--cpu-text-muted);
}

.section-toggle,
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
.section-toggle-copy {
  flex: 1;
  min-width: 0;
}
.section-toggle-top {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.toggle-pill {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.toggle-pill.on {
  background: rgba(54, 208, 183, 0.16);
  color: var(--cpu-primary-light);
}
.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.summary-pill {
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--cpu-surface-subtle);
  border: 1px solid var(--cpu-border-soft);
  color: var(--cpu-text-secondary);
  font-size: 12px;
}
.toggle-arrow {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 18px;
  color: var(--cpu-text-muted);
  transition: transform 0.2s ease;
}
.section-toggle.expanded .toggle-arrow,
.sub-toggle.expanded .toggle-arrow {
  transform: rotate(180deg);
}
.ai-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
.prompt-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: 14px;
  background: var(--cpu-surface-subtle);
  border: 1px dashed var(--cpu-border);
}
.prompt-grid {
  display: grid;
  gap: 12px;
}
.actions-row {
  display: flex;
  justify-content: flex-end;
}
.config-form :deep(.el-input) {
  flex: 1;
}
.feature-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.feature-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-surface);
  min-width: 0;
}
.feature-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.left { flex: 1; min-width: 0; }
.icon { margin-right: 4px; }
.desc { font-size: 12px; color: var(--cpu-text-secondary); margin-top: 4px; line-height: 1.6; }
.paths { font-size: 11px; color: var(--cpu-text-muted); }
.paths code { background: var(--cpu-surface-subtle); padding: 1px 5px; border-radius: 3px; }

@media (max-width: 960px) {
  .feature-grid { grid-template-columns: 1fr; }
}

@media (max-width: 768px) {
  .settings-card {
    gap: 14px;
    padding: 14px;
    border-radius: 14px;
  }
  .section-head,
  .site-config,
  .feature-head {
    align-items: stretch;
    flex-direction: column;
  }
  .site-config,
  .feature-row,
  .ai-form,
  .prompt-card {
    padding: 14px;
  }
  .config-form {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }
  .ai-form {
    grid-template-columns: 1fr;
  }
  .trust-grid {
    grid-template-columns: 1fr;
  }
  .tier-row,
  .level-row {
    align-items: stretch;
    flex-direction: column;
  }
  .feature-head :deep(.el-switch),
  .ai-row--switch :deep(.el-switch),
  .actions-row :deep(.el-button) {
    align-self: flex-start;
  }
  .section-toggle,
  .sub-toggle {
    gap: 10px;
  }
  .summary-row {
    gap: 6px;
  }
  .summary-pill,
  .section-meta {
    font-size: 11px;
  }
  .paths code {
    display: inline;
    white-space: normal;
    word-break: break-all;
  }
  .actions-row {
    justify-content: stretch;
  }
  .actions-row :deep(.el-button) {
    width: 100%;
  }
}
</style>
