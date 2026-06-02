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
            @keyup.enter="saveSiteConfig"
          />
          <el-button type="primary" :loading="savingConfig" @click="saveSiteConfig">保存</el-button>
        </div>
      </div>

      <div class="site-config storage-config">
        <div class="config-copy storage-copy">
          <div class="card-title">媒体存储（世纪互联 OneDrive / SharePoint）</div>
          <div class="desc">
            参考 AList 的接入方式：先在 Azure 中国创建 Web 应用，回调地址填这里显示的 URL，再在后台保存应用信息并点击登录授权。
            授权成功后会自动解析你填写的 SharePoint 站点，并列出可选文档库。
          </div>
          <div class="summary-row storage-status-row">
            <span class="summary-pill">当前后端：{{ mediaStorageProvider === "onedrive-cn" ? "世纪互联 OneDrive" : "本地磁盘" }}</span>
            <span class="summary-pill">{{ oneDriveChinaClientSecretConfigured ? "已保存密钥" : "未保存密钥" }}</span>
            <span class="summary-pill">{{ oneDriveChinaRefreshTokenConfigured ? "已完成授权" : "未授权" }}</span>
            <span class="summary-pill" v-if="oneDriveChinaDriveName">文档库：{{ oneDriveChinaDriveName }}</span>
          </div>
          <div class="storage-meta">
            <div><b>回调地址：</b><code>{{ oneDriveCallbackUrl }}</code></div>
            <div v-if="oneDriveChinaSharepointHost"><b>已解析站点：</b>{{ oneDriveChinaSharepointHost }}{{ oneDriveChinaSharepointPath }}</div>
            <div v-if="oneDriveChinaLastError" class="storage-error"><b>最近错误：</b>{{ oneDriveChinaLastError }}</div>
          </div>
        </div>
        <div class="storage-form">
          <div class="storage-grid">
            <div class="storage-field">
              <span class="field-label">存储后端</span>
              <el-select v-model="mediaStorageProvider">
                <el-option label="本地磁盘" value="local" />
                <el-option label="世纪互联 OneDrive / SharePoint" value="onedrive-cn" />
              </el-select>
            </div>
            <div class="storage-field">
              <span class="field-label">远端前缀</span>
              <el-input v-model="mediaStorageRemotePrefixesInput" placeholder="forum" />
            </div>
            <div class="storage-field">
              <span class="field-label">Azure 应用 ID</span>
              <el-input v-model="oneDriveChinaClientId" maxlength="120" placeholder="Application (client) ID" />
            </div>
            <div class="storage-field">
              <span class="field-label">Azure 应用密钥</span>
              <el-input v-model="oneDriveChinaClientSecretInput" maxlength="240" show-password :placeholder="oneDriveChinaClientSecretConfigured ? '留空表示继续使用已保存密钥' : 'Client Secret'" />
            </div>
            <div class="storage-field storage-field-wide">
              <span class="field-label">SharePoint 地址</span>
              <el-input v-model="oneDriveChinaSharepointUrl" maxlength="500" placeholder="https://tenant.sharepoint.cn/sites/media" />
            </div>
            <div class="storage-field">
              <span class="field-label">远端根目录</span>
              <el-input v-model="oneDriveChinaRootPath" maxlength="240" placeholder="cpu-web-media" />
            </div>
          </div>

          <div class="storage-actions">
            <el-button type="primary" :loading="savingMediaStorage" @click="saveMediaStorageConfig">保存媒体存储配置</el-button>
            <el-button :loading="authorizingOneDriveChina" @click="startOneDriveChinaAuth">登录授权</el-button>
            <el-button :disabled="!oneDriveChinaRefreshTokenConfigured" :loading="loadingOneDriveChinaDrives" @click="loadOneDriveChinaDrives">刷新文档库</el-button>
            <el-button :disabled="!oneDriveChinaRefreshTokenConfigured" @click="clearOneDriveChinaAuth">清除授权</el-button>
          </div>

          <div v-if="oneDriveChinaDriveOptions.length" class="storage-drive-box">
            <div class="storage-drive-row">
              <el-select v-model="oneDriveChinaDriveId" class="drive-select" placeholder="选择要写入的 SharePoint 文档库">
                <el-option v-for="item in oneDriveChinaDriveOptions" :key="item.id" :label="item.name" :value="item.id" />
              </el-select>
              <el-button type="primary" plain :loading="savingOneDriveChinaDrive" @click="saveOneDriveChinaDriveSelection">保存文档库</el-button>
            </div>
            <div class="desc">
              当前站点：{{ oneDriveChinaSiteName || "未解析" }}。如果你粘贴的是文档库或列表页面 URL，系统会自动向上回退并转换成可用的站点路径。
            </div>
          </div>
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
            <span class="summary-pill">论坛加成 {{ forumEnabledBonus }}</span>
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
              <span class="field-label">论坛资历加成</span>
              <el-input-number v-model="forumEnabledBonus" :min="0" :max="9999" />
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
            <el-button type="primary" :loading="savingConfig" @click="saveTrustConfig">保存匿名与信誉规则</el-button>
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
                <span class="icon">{{ f.icon }}</span> {{ f.title }}
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
              @change="(v: boolean | string | number) => toggle(f.key, Boolean(v))"
            />
          </div>
          <div class="paths">影响入口：<code>{{ f.paths.join(" · ") }}</code></div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useRoute, useRouter } from "vue-router";
import { adminApi, type MediaStorageConfig, type OneDriveChinaDriveOption } from "@/api/admin";
import { useSiteStore } from "@/stores/site";

type FKey = "forum" | "market" | "coursereview" | "electric" | "sponsor";

const site = useSiteStore();
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const configLoading = ref(false);
const savingConfig = ref(false);
const savingMediaStorage = ref(false);
const authorizingOneDriveChina = ref(false);
const loadingOneDriveChinaDrives = ref(false);
const savingOneDriveChinaDrive = ref(false);
const pendingKey = ref<FKey | null>(null);
const aiConfigExpanded = ref(false);
const aiPromptsExpanded = ref(false);
const trustConfigExpanded = ref(false);
const siteOrigin = ref("");
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
const forumEnabledBonus = ref(6);
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
const mediaStorageProvider = ref<"local" | "onedrive-cn">("local");
const mediaStorageRemotePrefixesInput = ref("forum");
const oneDriveChinaClientId = ref("");
const oneDriveChinaClientSecretInput = ref("");
const oneDriveChinaClientSecretConfigured = ref(false);
const oneDriveChinaSharepointUrl = ref("");
const oneDriveChinaSharepointHost = ref("");
const oneDriveChinaSharepointPath = ref("/");
const oneDriveChinaSiteId = ref("");
const oneDriveChinaSiteName = ref("");
const oneDriveChinaDriveId = ref("");
const oneDriveChinaDriveName = ref("");
const oneDriveChinaRootPath = ref("");
const oneDriveChinaRefreshTokenConfigured = ref(false);
const oneDriveChinaAuthorizedAt = ref("");
const oneDriveChinaLastError = ref("");
const oneDriveChinaDriveOptions = ref<OneDriveChinaDriveOption[]>([]);
const features = reactive<{ forum: boolean; market: boolean; coursereview: boolean; electric: boolean; sponsor: boolean }>({
  forum: true, market: true, coursereview: true, electric: true, sponsor: true,
});
const enabledFeatureCount = computed(() => featureMeta.filter((item) => features[item.key]).length);
const oneDriveCallbackUrl = computed(() => `${(siteOrigin.value || window.location.origin).replace(/\/+$/, "")}/api/storage/onedrive-cn/callback`);

const featureMeta: { key: FKey; icon: string; title: string; desc: string; paths: string[] }[] = [
  {
    key: "forum", icon: "💬", title: "论坛（通用板块 + 发帖）",
    desc: "灌水广场 / 校园生活 / 新生入学 / 提问广场等通用板块的可见与发帖。",
    paths: ["/forum", "/post", "/forum/topic/:id"],
  },
  {
    key: "market", icon: "🛒", title: "二手市场",
    desc: "二手交易板块。涉及个人交易，是常见举报对象。",
    paths: ["/market", "boards type=market"],
  },
  {
    key: "coursereview", icon: "📊", title: "课程点评",
    desc: "评老师 / 课程的板块。",
    paths: ["/coursereview", "/coursereview/:id"],
  },
  {
    key: "electric", icon: "💡", title: "宿舍电费查询",
    desc: "首页与校园服务页的电费快捷卡片；如果隧道不通、不想暴露这个功能时关掉。",
    paths: ["/api/services/dorm-electric", "首页电费卡片"],
  },
  {
    key: "sponsor", icon: "💳", title: "赞助入口",
    desc: "个人中心的赞助入口和下单接口。关闭后不影响已完成赞助金额展示。",
    paths: ["/profile", "/api/payments/sponsor/orders"],
  },
];

onMounted(reload);

async function reload() {
  loading.value = true;
  configLoading.value = true;
  try {
    const [r, config, mediaStorage] = await Promise.all([adminApi.features(), adminApi.siteConfig(), adminApi.mediaStorageConfig()]);
    Object.assign(features, r);
    site.apply(r);
    siteOrigin.value = config.siteOrigin;
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
    forumEnabledBonus.value = config.forumEnabledBonus;
    anonymousTiers.value = (config.anonymousTiers ?? []).map((item) => ({ ...item }));
    reputationLevels.value = (config.reputationLevels ?? []).map((item) => ({ ...item }));
    applyMediaStorageConfig(mediaStorage);
    await handleStorageAuthQuery();
  } finally {
    loading.value = false;
    configLoading.value = false;
  }
}

async function saveSiteConfig() {
  savingConfig.value = true;
  try {
    const config = await adminApi.updateSiteConfig({ siteOrigin: siteOrigin.value });
    siteOrigin.value = config.siteOrigin;
    ElMessage.success(config.siteOrigin ? "网站域名已保存" : "已清空网站域名");
  } finally {
    savingConfig.value = false;
  }
}

function applyMediaStorageConfig(config: MediaStorageConfig) {
  mediaStorageProvider.value = config.mediaStorageProvider;
  mediaStorageRemotePrefixesInput.value = (config.mediaStorageRemotePrefixes ?? []).join(", ");
  oneDriveChinaClientId.value = config.oneDriveChinaClientId;
  oneDriveChinaClientSecretInput.value = "";
  oneDriveChinaClientSecretConfigured.value = config.oneDriveChinaClientSecretConfigured;
  oneDriveChinaSharepointUrl.value = config.oneDriveChinaSharepointUrl;
  oneDriveChinaSharepointHost.value = config.oneDriveChinaSharepointHost;
  oneDriveChinaSharepointPath.value = config.oneDriveChinaSharepointPath || "/";
  oneDriveChinaSiteId.value = config.oneDriveChinaSiteId;
  oneDriveChinaSiteName.value = config.oneDriveChinaSiteName;
  oneDriveChinaDriveId.value = config.oneDriveChinaDriveId;
  oneDriveChinaDriveName.value = config.oneDriveChinaDriveName;
  oneDriveChinaRootPath.value = config.oneDriveChinaRootPath;
  oneDriveChinaRefreshTokenConfigured.value = config.oneDriveChinaRefreshTokenConfigured;
  oneDriveChinaAuthorizedAt.value = config.oneDriveChinaAuthorizedAt;
  oneDriveChinaLastError.value = config.oneDriveChinaLastError;
}

async function persistMediaStorageConfig(silent = false) {
  savingMediaStorage.value = true;
  try {
    const config = await adminApi.updateMediaStorageConfig({
      mediaStorageProvider: mediaStorageProvider.value,
      mediaStorageRemotePrefixes: mediaStorageRemotePrefixesInput.value,
      oneDriveChinaClientId: oneDriveChinaClientId.value,
      oneDriveChinaClientSecret: oneDriveChinaClientSecretInput.value || undefined,
      oneDriveChinaSharepointUrl: oneDriveChinaSharepointUrl.value,
      oneDriveChinaRootPath: oneDriveChinaRootPath.value,
    });
    applyMediaStorageConfig(config);
    if (!silent) ElMessage.success("媒体存储配置已保存");
  } finally {
    savingMediaStorage.value = false;
  }
}

async function saveMediaStorageConfig() {
  await persistMediaStorageConfig(false);
}

async function startOneDriveChinaAuth() {
  authorizingOneDriveChina.value = true;
  try {
    await persistMediaStorageConfig(true);
    const result = await adminApi.beginOneDriveChinaAuth();
    window.location.assign(result.authorizeUrl);
  } finally {
    authorizingOneDriveChina.value = false;
  }
}

async function fetchOneDriveChinaDrives(silent = false) {
  loadingOneDriveChinaDrives.value = true;
  try {
    const result = await adminApi.oneDriveChinaDrives();
    oneDriveChinaSiteId.value = result.siteId;
    oneDriveChinaSiteName.value = result.siteName;
    oneDriveChinaSharepointUrl.value = result.sharepointUrl;
    oneDriveChinaSharepointHost.value = result.sharepointHost;
    oneDriveChinaSharepointPath.value = result.sharepointPath || "/";
    oneDriveChinaDriveId.value = result.selectedDriveId;
    oneDriveChinaDriveName.value = result.selectedDriveName;
    oneDriveChinaDriveOptions.value = result.list;
    if (!silent) ElMessage.success(result.list.length ? "文档库已刷新" : "当前站点下没有可用文档库");
  } finally {
    loadingOneDriveChinaDrives.value = false;
  }
}

async function loadOneDriveChinaDrives() {
  await fetchOneDriveChinaDrives(false);
}

async function saveOneDriveChinaDriveSelection() {
  if (!oneDriveChinaDriveId.value) {
    ElMessage.warning("请先选择文档库");
    return;
  }
  savingOneDriveChinaDrive.value = true;
  try {
    const result = await adminApi.saveOneDriveChinaDrive(oneDriveChinaDriveId.value);
    oneDriveChinaDriveName.value = result.driveName;
    ElMessage.success("文档库选择已保存");
  } finally {
    savingOneDriveChinaDrive.value = false;
  }
}

async function clearOneDriveChinaAuth() {
  try {
    await ElMessageBox.confirm(
      "确认清除当前世纪互联 OneDrive / SharePoint 授权吗？已保存的应用 ID、密钥和 SharePoint 地址会保留，但 refresh token 与已解析文档库会被清空。",
      "清除授权",
      { type: "warning", confirmButtonText: "清除", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  await adminApi.clearOneDriveChinaAuthorization();
  oneDriveChinaRefreshTokenConfigured.value = false;
  oneDriveChinaAuthorizedAt.value = "";
  oneDriveChinaDriveId.value = "";
  oneDriveChinaDriveName.value = "";
  oneDriveChinaSiteId.value = "";
  oneDriveChinaSiteName.value = "";
  oneDriveChinaDriveOptions.value = [];
  ElMessage.success("已清除世纪互联 OneDrive 授权");
}

async function handleStorageAuthQuery() {
  const status = typeof route.query.storageAuth === "string" ? route.query.storageAuth : "";
  const message = typeof route.query.storageAuthMessage === "string" ? route.query.storageAuthMessage : "";
  if (!status) return;
  if (status === "success") {
    ElMessage.success("世纪互联 OneDrive 授权成功");
    await reloadMediaStorageOnly();
    await fetchOneDriveChinaDrives(true).catch(() => null);
  } else {
    ElMessage.error(message || "世纪互联 OneDrive 授权失败");
    await reloadMediaStorageOnly();
  }
  const nextQuery = { ...route.query } as Record<string, any>;
  delete nextQuery.storageAuth;
  delete nextQuery.storageAuthMessage;
  router.replace({ query: nextQuery }).catch(() => null);
}

async function reloadMediaStorageOnly() {
  applyMediaStorageConfig(await adminApi.mediaStorageConfig());
}

async function saveAiReviewConfig() {
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
      forumEnabledBonus: forumEnabledBonus.value,
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
    forumEnabledBonus.value = config.forumEnabledBonus;
    anonymousTiers.value = (config.anonymousTiers ?? []).map((item) => ({ ...item }));
    reputationLevels.value = (config.reputationLevels ?? []).map((item) => ({ ...item }));
    ElMessage.success("匿名与信誉规则已保存");
  } finally {
    savingConfig.value = false;
  }
}

async function toggle(key: FKey, on: boolean) {
  if (!on) {
    try {
      await ElMessageBox.confirm(
        `确认关闭「${featureMeta.find((m) => m.key === key)?.title}」？\n` +
        `普通用户立刻看不到对应入口，无法发新内容。已发布内容会保留。`,
        "确认关闭",
        { type: "warning", confirmButtonText: "关闭", cancelButtonText: "取消" }
      );
    } catch {
      // 用户取消 —— 强制还原 switch 状态
      features[key] = !on;
      return;
    }
  }
  pendingKey.value = key;
  try {
    const r = await adminApi.updateFeatures({ [key]: on });
    Object.assign(features, r);
    site.apply(r);
    ElMessage.success(on ? "已开启" : "已关闭");
  } catch {
    features[key] = !on;
  } finally { pendingKey.value = null; }
}
</script>

<style scoped>
.features-pane { display: flex; flex-direction: column; gap: 14px; }
.warn :deep(.el-alert__title) { font-size: 14px; }
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
.section-meta {
  flex-shrink: 0;
  padding: 8px 12px;
  border-radius: 999px;
  background: #eef6ff;
  color: #2454a6;
  font-size: 12px;
  font-weight: 600;
}
.site-config {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid #edf2f7;
  border-radius: 14px;
  background: #ffffff;
}
.config-copy {
  flex: 1;
  min-width: 0;
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: #1f2937;
}
.config-form {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(520px, 52%);
}
.storage-config {
  align-items: flex-start;
}
.storage-copy {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.storage-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #475467;
}
.storage-error {
  color: #c2410c;
}
.storage-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(760px, 100%);
}
.storage-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.storage-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.storage-field-wide {
  grid-column: 1 / -1;
}
.storage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.storage-drive-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 14px;
  background: #fcfdff;
  border: 1px dashed #d7e2f0;
}
.storage-drive-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.drive-select {
  flex: 1;
}
.storage-status-row {
  margin-top: 0;
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
  border: 1px solid #edf2f7;
  background: #fff;
}
.trust-subcard {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  background: #fcfdff;
  border: 1px dashed #d7e2f0;
}
.subcard-title {
  font-size: 14px;
  font-weight: 700;
  color: #1f2937;
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
  color: #6b7280;
}
.field-inline-label {
  font-size: 12px;
  color: #9ca3af;
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
  background: #f3f4f6;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
}
.toggle-pill.on {
  background: #e8fff1;
  color: #0f8a4b;
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
  background: #f7f9fc;
  border: 1px solid #e9eef5;
  color: #4b5563;
  font-size: 12px;
}
.toggle-arrow {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 18px;
  color: #64748b;
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
  border: 1px solid #eef2f7;
  border-radius: 14px;
  background: #fff;
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
.desc { font-size: 12px; color: #6b7280; margin-top: 4px; line-height: 1.6; }
.paths { font-size: 11px; color: #9ca3af; }
.paths code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; }

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
  .storage-grid {
    grid-template-columns: 1fr;
  }
  .storage-drive-row {
    flex-direction: column;
    align-items: stretch;
  }
  .drive-select {
    width: 100%;
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
