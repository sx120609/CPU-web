<template>
  <div class="topic-page" v-if="topic" v-loading="loading">
    <!-- 主帖 -->
    <article class="cpu-card main-post">
      <header class="post-head">
        <router-link :to="`/forum/b/${topic.board?.slug}`" class="board-back">
          <el-icon><ArrowLeft /></el-icon> {{ topic.board?.name }}
        </router-link>
        <div class="actions">
          <el-button v-if="canEdit" text @click="onEdit">编辑</el-button>
          <el-button v-if="canPin && !isReadOnly" text @click="onPin">{{ topic.pinned ? '取消置顶' : '置顶' }}</el-button>
          <el-button v-if="canPin" text @click="onLock">{{ topic.locked ? '解锁' : '锁帖' }}</el-button>
          <el-button v-if="canEdit" text type="danger" @click="onDelete">删除</el-button>
        </div>
      </header>

      <h1 class="post-title">
        <span v-if="topic.pinned" class="badge pin">置顶</span>
        <span v-if="topic.locked" class="badge lock">🔒</span>
        {{ topic.title }}
      </h1>

      <div class="post-meta">
        <UserAvatar :size="36" class="avatar" :src="topic.author?.avatar" :name="topic.author?.nickname" alt="作者头像" />
        <div class="meta-author">
          <div class="name">
            <router-link v-if="topic.author?.id" :to="`/u/${topic.author.id}`">{{ topic.author?.nickname }}</router-link>
            <el-tag v-if="topic.author?.role === 'bot'" size="small" type="warning">系统同步</el-tag>
            <el-tag v-else-if="topic.author?.role === 'admin'" size="small" type="danger">管理员</el-tag>
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
      <div v-if="topic.metadata?.sourceUrl" class="source-bar" :class="{ wechat: topic.metadata?.externalType === 'wechat' }">
        <span class="src-icon">{{ topic.metadata?.externalType === 'wechat' ? '💬' : '📢' }}</span>
        <span class="src-text-wrap">
          <span class="src-text">
            <template v-if="topic.metadata?.externalType === 'wechat'">
              原文发布于 <b>微信公众号</b> · {{ fmtDate(topic.metadata.publishedAt, 'YYYY-MM-DD') }}
            </template>
            <template v-else>
              来自 <b>{{ topic.metadata.sourceName || topic.board?.name }}</b>
              · 发布于 {{ fmtDate(topic.metadata.publishedAt, 'YYYY-MM-DD') }}
            </template>
          </span>
          <span v-if="sourceNotice" class="src-notice">{{ sourceNotice }}</span>
        </span>
        <a :href="topic.metadata.sourceUrl" target="_blank" class="src-link">
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

      <MarkdownView :content="displayContent" class="post-body" />

      <footer class="post-foot">
        <el-button :type="liked ? 'primary' : 'default'" :icon="Star" @click="onLike">
          {{ liked ? '已点赞' : '点赞' }} · {{ topic.likeCount }}
        </el-button>
        <el-button :icon="ChatLineRound" @click="scrollToReply">回复 · {{ topic.replyCount }}</el-button>
      </footer>
    </article>

    <!-- 回复列表 -->
    <section class="replies cpu-card" ref="repliesEl">
      <h3 class="cpu-section-title">{{ topic.replyCount }} 条回复</h3>
      <el-empty v-if="!replies.length" description="还没有回复，沙发坐等" />
      <div v-for="r in replies" :key="r.id" class="reply">
        <UserAvatar :size="32" class="avatar" :src="r.author?.avatar" :name="r.author?.nickname" alt="回复头像" />
        <div class="reply-body">
          <div class="reply-meta">
            <span class="floor">#{{ r.floor }}</span>
            <router-link v-if="r.author?.id" :to="`/u/${r.author.id}`" class="author">{{ r.author?.nickname }}</router-link>
            <span class="dot">·</span>
            <span>{{ fmtRelative(r.createdAt) }}</span>
          </div>
          <MarkdownView :content="r.content" class="reply-content" />
          <div class="reply-actions">
            <el-button text size="small" @click="quoteReply(r)">引用</el-button>
            <el-button text size="small" @click="onLikeReply(r)">👍 {{ r.likeCount }}</el-button>
          </div>
        </div>
      </div>
    </section>

    <!-- 回复表单 -->
    <section class="cpu-card reply-form" v-if="auth.isLoggedIn && !topic.locked">
      <h3 class="cpu-section-title">回复</h3>
      <RichTextEditor
        ref="replyEditorRef"
        v-model="replyText"
        label="写回复"
        placeholder="写下你的回复，可以直接粘贴图片。"
        footer-text="回复也支持排版、图片和草稿自动保存。"
        :max-length="REPLY_MAX"
        :draft-key="replyDraftKey"
        @draft-restored="replyText = $event"
      />
      <div class="reply-form-actions">
        <span class="cpu-muted">离开页面后会自动保留未发布草稿。</span>
        <el-button type="primary" :loading="replying" @click="submitReply">
          发布回复
        </el-button>
      </div>
    </section>

    <el-dialog
      v-model="replyReviewBlockedOpen"
      title="回复未通过 AI 初审"
      width="520px"
      append-to-body
    >
      <div class="review-blocked">
        <p>这条回复暂未发送。</p>
        <p v-if="blockedReplyInfo.reason">原因：{{ blockedReplyInfo.reason }}</p>
        <p v-if="blockedReplyInfo.riskScore !== null">风险分：{{ blockedReplyInfo.riskScore }}</p>
        <p class="cpu-muted">你可以修改后重试，或者申请人工审核。申请后，在审核完成前不能继续投递新稿件。</p>
      </div>
      <template #footer>
        <el-button @click="replyReviewBlockedOpen = false">返回修改</el-button>
        <el-button type="warning" :loading="requestingReplyManualReview" @click="replyManualReviewConfirmOpen = true">申请人工审核</el-button>
      </template>
    </el-dialog>

    <ManualReviewConfirmDialog
      v-model="replyManualReviewConfirmOpen"
      subject="回复"
      @confirm="confirmReplyManualReviewRequest"
    />

    <div v-if="topic.locked" class="locked-tip cpu-card">🔒 该帖已锁定，无法回复</div>
    <div v-if="!auth.isLoggedIn" class="login-tip cpu-card">
      <router-link to="/login">登录</router-link> 或 <router-link to="/register">注册</router-link> 后参与回复
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, Star, ChatLineRound, Link } from "@element-plus/icons-vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import MarkdownView from "@/components/forum/MarkdownView.vue";
import RichTextEditor from "@/components/forum/RichTextEditor.vue";
import ManualReviewConfirmDialog from "@/components/forum/ManualReviewConfirmDialog.vue";
import { topicApi, replyApi, likeApi, type Topic, type Reply } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";
import { fmtDate, fmtRelative } from "@/utils/format";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const topic = ref<Topic | null>(null);
const replies = ref<Reply[]>([]);
const loading = ref(false);
const replying = ref(false);
const replyText = ref("");
const replyReviewBlockedOpen = ref(false);
const requestingReplyManualReview = ref(false);
const replyManualReviewConfirmOpen = ref(false);
const blockedReplyId = ref<number | null>(null);
const blockedReplyInfo = reactive<{ reason: string; riskScore: number | null }>({
  reason: "",
  riskScore: null,
});
const liked = ref(false);
const repliesEl = ref<HTMLElement | null>(null);
const replyEditorRef = ref<InstanceType<typeof RichTextEditor> | null>(null);
const REPLY_MAX = 10000;

const metaPrice = computed(() => topic.value?.metadata?.price);
const hotScore = computed(() => Math.round((topic.value?.likeCount ?? 0) * 5 + (topic.value?.replyCount ?? 0) * 3 + (topic.value?.viewCount ?? 0) * 0.03));
const isReadOnly = computed(() => topic.value?.board?.readOnly);
const canEdit = computed(() => auth.user?.id === topic.value?.authorId || auth.isAdmin);
const canPin = computed(() => auth.isMod);
const replyDraftKey = computed(() => topic.value?.id ? `cpu-reply-draft-${topic.value.id}` : "");
const replyIsEmpty = computed(() => replyEditorRef.value?.isContentEmpty() ?? !replyText.value.trim());
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

onMounted(async () => { await load(); });

async function load() {
  loading.value = true;
  try {
    const id = Number(route.params.id);
    topic.value = await topicApi.detail(id);
    replies.value = await topicApi.replies(id);
    // 我是否赞过
    if (auth.isLoggedIn) {
      const mine = await likeApi.mine([id], replies.value.map((r) => r.id));
      liked.value = mine.topics.includes(id);
      // 标记每条回复 liked
      const set = new Set(mine.replies);
      replies.value.forEach((r: any) => (r._liked = set.has(r.id)));
    }
  } finally { loading.value = false; }
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
  const quoted = `<blockquote><p>@${escapeHtml(r.author?.nickname || "同学")} 在 #${r.floor} 楼：</p>${r.content}</blockquote><p><br></p>`;
  replyText.value = `${replyText.value || ""}${quoted}`;
}

async function submitReply() {
  if (!auth.isLoggedIn) { router.push({ name: "login", query: { redirect: route.fullPath } }); return; }
  if (replyEditorRef.value?.isContentEmpty()) { ElMessage.warning("请填写回复内容"); return; }
  if (replyText.value.length > REPLY_MAX) { ElMessage.warning("回复内容过长，请精简后再发布"); return; }
  replying.value = true;
  try {
    const r = await replyApi.create({ topicId: topic.value!.id, content: replyText.value });
    if ((r as any).submissionResult?.status === "blocked_ai") {
      blockedReplyId.value = (r as any).id ?? null;
      blockedReplyInfo.reason = (r as any).submissionResult.reason || "检测到较高风险内容";
      blockedReplyInfo.riskScore = (r as any).submissionResult.riskScore ?? null;
      replyReviewBlockedOpen.value = true;
      ElMessage.warning("回复未通过 AI 审核");
      return;
    }
    replies.value.push({ ...r, _liked: false } as any);
    replyText.value = "";
    replyEditorRef.value?.clearDraft();
    if (topic.value) topic.value.replyCount += 1;
    ElMessage.success("已发布");
    nextTick(() => repliesEl.value?.scrollIntoView({ behavior: "smooth", block: "end" }));
  } finally { replying.value = false; }
}

async function confirmReplyManualReviewRequest() {
  if (!blockedReplyId.value) return;
  requestingReplyManualReview.value = true;
  try {
    await replyApi.requestManualReview(blockedReplyId.value);
    await auth.fetchMe();
    replyEditorRef.value?.clearDraft();
    replyText.value = "";
    replyReviewBlockedOpen.value = false;
    ElMessage.success("已提交回复人工审核申请");
  } finally {
    requestingReplyManualReview.value = false;
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function scrollToReply() {
  repliesEl.value?.scrollIntoView({ behavior: "smooth", block: "end" });
}

function stripCrawlerSourceHeader(content: string) {
  return content.replace(
    /^>\s*📢\s+\*\*.*?\*\*\s*·\s*发布于\s*\d{4}-\d{2}-\d{2}\s*\n>\s*\n>\s*🔗\s*\[.*?\]\([^)]+\)\s*\n\s*---\s*\n+/s,
    ""
  ).trim();
}

function onEdit() {
  router.push({ name: "edit-post", params: { id: topic.value!.id } });
}

async function onPin() {
  await topicApi.update(topic.value!.id, { pinned: !topic.value!.pinned });
  topic.value!.pinned = !topic.value!.pinned;
}
async function onLock() {
  await topicApi.update(topic.value!.id, { locked: !topic.value!.locked });
  topic.value!.locked = !topic.value!.locked;
}
async function onDelete() {
  await ElMessageBox.confirm("确认删除此帖？此操作不可撤销", "提示", { type: "warning" });
  await topicApi.remove(topic.value!.id);
  ElMessage.success("已删除");
  router.replace(`/forum/b/${topic.value!.board?.slug}`);
}
</script>

<style scoped lang="scss">
.topic-page { display: flex; flex-direction: column; gap: 16px; }

.cpu-card { background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

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
  .actions { display: flex; gap: 4px; }

  .post-title {
    margin: 8px 0 12px;
    font-size: 24px;
    color: #1f2937;
    line-height: 1.4;
  }

  .badge {
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 4px;
    margin-right: 6px;
    vertical-align: middle;
  }
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

  .post-foot {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px dashed #e5e7eb;
    display: flex;
    gap: 8px;
  }
}

.replies {
  .reply {
    display: flex;
    gap: 12px;
    padding: 14px 0;
    border-bottom: 1px dashed #f1f5f9;
  }
  .reply:last-child { border-bottom: none; }
  .avatar { background: var(--cpu-primary); color: #fff; font-weight: 600; flex-shrink: 0; }
  .reply-body { flex: 1; min-width: 0; }
  .reply-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 4px;
  }
  .floor { color: #9ca3af; }
  .author { color: var(--cpu-primary); text-decoration: none; font-weight: 500; }
  .dot { color: #d1d5db; }
  .reply-content { font-size: 14px; }
  .reply-actions {
    margin-top: 6px;
    display: flex;
    gap: 4px;
  }
}

.reply-form-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
}

.locked-tip, .login-tip {
  text-align: center;
  color: #6b7280;
  font-size: 14px;
  padding: 24px;
  a { color: var(--cpu-primary); margin: 0 4px; }
}

.review-blocked p {
  margin: 0 0 10px;
  line-height: 1.7;
  color: #374151;
}

.review-blocked p:last-child {
  margin-bottom: 0;
}

.cpu-section-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.cpu-muted { font-size: 12px; color: #9ca3af; }

@media (max-width: 700px) {
  .topic-page {
    gap: 12px;
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
      grid-template-columns: 1fr 1fr;
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

  .reply-form-actions .el-button {
    width: 100%;
  }
}
</style>
