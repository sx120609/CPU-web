<template>
  <div class="profile">
    <div class="cpu-card profile-card">
      <UserAvatar :size="80" class="avatar" :src="user?.avatar" :name="user?.nickname" alt="用户头像" />
      <div class="avatar-actions">
        <el-button size="small" plain :loading="avatarSaving" @click="pickAvatar">上传头像</el-button>
        <el-button v-if="user?.avatar" size="small" text :loading="avatarSaving" @click="removeAvatar">移除头像</el-button>
      </div>
      <h3 class="name">
        {{ user?.nickname }}
        <el-tag v-if="user?.role === 'admin'" size="small" type="danger">管理员</el-tag>
        <el-tag v-else-if="user?.role === 'mod'" size="small">论坛管理员</el-tag>
        <el-tag v-if="user?.reputationLevel" size="small" type="warning" effect="plain">
          Lv.{{ user.reputationLevel.level }} {{ user.reputationLevel.name }}
        </el-tag>
      </h3>
      <p class="account-note">{{ user?.studentSso ? "学号仅用于登录和身份校验，不会公开展示" : "登录账号仅自己可见，不会公开展示" }}</p>
      <p class="bio">{{ user?.bio || "这个人很懒，什么都没写" }}</p>
      <ul class="kv">
        <li><span>院系</span><span>{{ user?.college || "—" }}</span></li>
        <li><span>入学</span><span>{{ user?.enrollYear || "—" }}</span></li>
        <li><span>发帖</span><span>{{ user?.postCount }}</span></li>
        <li><span>回复</span><span>{{ user?.replyCount }}</span></li>
        <li><span>声望</span><span>{{ user?.reputation }}</span></li>
      </ul>
      <div class="profile-actions">
        <el-button type="primary" plain @click="editing = true">编辑资料</el-button>
        <el-button v-if="!user?.studentSso" plain @click="passwordDialog = true">修改密码</el-button>
        <el-button type="danger" plain @click="onLogout">退出登录</el-button>
      </div>
    </div>

    <div class="cpu-card trust-card" v-if="user">
      <div class="trust-head">
        <div>
          <h3 class="cpu-section-title">信誉与匿名</h3>
          <p class="trust-sub">信誉值由注册时长、发帖数量、回复数量等因素共同决定，按周发放匿名积分。</p>
        </div>
        <div class="trust-score">{{ user.reputation }}</div>
      </div>

      <div v-if="user.reputationLevel" class="trust-level-row">
        当前等级：Lv.{{ user.reputationLevel.level }} {{ user.reputationLevel.name }}
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
        <div class="trust-row">
          <span>论坛资历加成</span>
          <b>{{ user.reputationBreakdown?.forumPoints ?? 0 }}</b>
        </div>
      </div>

      <p v-if="user.anonymousState?.nextTier" class="trust-next">
        距离下一档匿名额度还差 {{ user.anonymousState.nextTier.need }} 点信誉值，达到后每周可得 {{ user.anonymousState.nextTier.weeklyQuota }} 点。
      </p>
      <p v-if="user.reputationLevel?.nextLevel" class="trust-next">
        距离下一信誉等级还差 {{ user.reputationLevel.nextLevel.need }} 点，达到后将升级为 Lv.{{ user.reputationLevel.nextLevel.level }} {{ user.reputationLevel.nextLevel.name }}。
      </p>

      <div class="anonymous-boards">
        <span class="anonymous-boards-label">支持匿名的板块</span>
        <div class="anonymous-board-tags">
          <el-tag v-for="board in anonymousBoards" :key="board.slug" effect="plain">
            {{ board.icon || "💬" }} {{ board.name }}
          </el-tag>
          <span v-if="!anonymousBoards.length" class="cpu-muted">当前还没有开放匿名的板块</span>
        </div>
      </div>
    </div>

    <div class="cpu-card user-group-card">
      <div>
        <h3 class="cpu-section-title">加入用户 QQ 群</h3>
        <p>遇到课表显示问题，或想反馈建议，可以加入用户群。</p>
        <strong>{{ USER_QQ_GROUP }}</strong>
      </div>
      <div class="user-group-actions">
        <el-button type="primary" @click="joinUserGroup">
          <el-icon><ChatDotRound /></el-icon>
          加入群聊
        </el-button>
        <el-button plain @click="copyUserGroup">
          <el-icon><CopyDocument /></el-icon>
          复制群号
        </el-button>
      </div>
    </div>

    <div class="cpu-card">
      <h3 class="cpu-section-title">我发布的帖子</h3>
      <el-empty v-if="!myTopics.length" description="还没有发过帖子" />
      <div v-for="t in myTopics" :key="t.id" class="topic-line" @click="$router.push(`/forum/topic/${t.id}`)">
        <span class="tag" :style="{ background: t.board?.color || '#168776' }">{{ t.board?.name }}</span>
        <span v-if="t.isAnonymous" class="anon-tag">匿名</span>
        <span class="title">{{ t.title }}</span>
        <span class="meta">{{ fmtRelative(t.createdAt) }}</span>
      </div>
    </div>

    <el-dialog v-model="editing" title="编辑资料" width="420">
      <el-form label-position="top" :model="editForm">
        <el-form-item label="昵称">
          <el-input v-model="editForm.nickname" maxlength="20" show-word-limit />
        </el-form-item>
        <el-form-item label="一句话签名">
          <el-input v-model="editForm.bio" type="textarea" :rows="3" maxlength="120" show-word-limit />
        </el-form-item>
        <el-form-item label="院系">
          <el-input v-model="editForm.college" maxlength="40" />
        </el-form-item>
        <el-form-item label="入学年份">
          <el-input-number v-model="editForm.enrollYear" :min="2010" :max="2030" style="width:100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editing = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="passwordDialog" title="修改密码" width="420" :close-on-click-modal="false">
      <el-form label-position="top" :model="pwForm" @keyup.enter="savePassword">
        <el-form-item label="原密码" required>
          <el-input v-model="pwForm.oldPassword" type="password" show-password autocomplete="current-password" />
        </el-form-item>
        <el-form-item label="新密码（至少 6 位）" required>
          <el-input v-model="pwForm.newPassword" type="password" show-password autocomplete="new-password" maxlength="64" />
        </el-form-item>
        <el-form-item label="再次输入新密码" required>
          <el-input v-model="pwForm.confirm" type="password" show-password autocomplete="new-password" maxlength="64" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingPw" @click="savePassword">保存</el-button>
      </template>
    </el-dialog>

    <input
      ref="avatarInputRef"
      class="hidden-file-input"
      type="file"
      accept="image/*"
      @change="onAvatarChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ChatDotRound, CopyDocument } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { authApi } from "@/api/auth";
import { boardApi, type Board } from "@/api/board";
import { request } from "@/api/request";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { fmtDate, fmtRelative } from "@/utils/format";
import { compressImageFile, normalizeImageUploadError } from "@/utils/imageUpload";
import { copyText, openUserGroup, USER_QQ_GROUP } from "@/utils/userGroup";

const auth = useAuthStore();
const router = useRouter();
const user = computed(() => auth.user);
const myTopics = ref<any[]>([]);
const boards = ref<Board[]>([]);
const editing = ref(false);
const saving = ref(false);
const avatarSaving = ref(false);
const avatarInputRef = ref<HTMLInputElement | null>(null);

const editForm = reactive({ nickname: "", bio: "", college: "", enrollYear: undefined as any });

const passwordDialog = ref(false);
const savingPw = ref(false);
const pwForm = reactive({ oldPassword: "", newPassword: "", confirm: "" });
const anonymousBoards = computed(() => boards.value.filter((board) => board.anonymousEnabled));
const anonymousStatusText = computed(() => {
  const state = user.value?.anonymousState;
  if (!state) return "—";
  if (state.frozen) return "已冻结";
  if (!state.eligible) return `未达门槛（${state.minReputation}）`;
  return "可用";
});
const anonymousResetText = computed(() => {
  const nextResetAt = user.value?.anonymousState?.nextResetAt;
  return nextResetAt ? fmtDate(nextResetAt, "MM-DD HH:mm") : "—";
});

watch(passwordDialog, (v) => {
  if (!v) { pwForm.oldPassword = ""; pwForm.newPassword = ""; pwForm.confirm = ""; }
});

onMounted(async () => {
  if (!auth.user) await auth.fetchMe();
  if (!auth.user) return;
  const [topicList, boardList] = await Promise.all([
    request.get<any[]>(`/user/${auth.user.id}/topics`),
    boardApi.list(),
  ]);
  myTopics.value = topicList;
  boards.value = boardList;
});

watch(editing, (v) => {
  if (v && user.value) {
    editForm.nickname = user.value.nickname;
    editForm.bio = user.value.bio || "";
    editForm.college = user.value.college || "";
    editForm.enrollYear = user.value.enrollYear ?? undefined;
  }
});

async function saveEdit() {
  saving.value = true;
  try {
    const u = await authApi.updateMe(editForm as any);
    auth.user = u;
    ElMessage.success("已保存");
    editing.value = false;
  } finally { saving.value = false; }
}

async function savePassword() {
  if (pwForm.newPassword.length < 6) { ElMessage.warning("新密码至少 6 位"); return; }
  if (pwForm.newPassword !== pwForm.confirm) { ElMessage.warning("两次输入的新密码不一致"); return; }
  if (pwForm.newPassword === pwForm.oldPassword) { ElMessage.warning("新密码不能与原密码相同"); return; }
  savingPw.value = true;
  try {
    await authApi.changePassword(pwForm.oldPassword, pwForm.newPassword);
    ElMessage.success("密码已修改");
    passwordDialog.value = false;
  } finally { savingPw.value = false; }
}

async function onLogout() {
  await ElMessageBox.confirm("确认退出登录？", "提示");
  await auth.logout();
  router.push("/login");
}

async function copyUserGroup() {
  await copyText(USER_QQ_GROUP);
  ElMessage.success(`已复制QQ群号 ${USER_QQ_GROUP}`);
}

function joinUserGroup() {
  openUserGroup();
}

function pickAvatar() {
  avatarInputRef.value?.click();
}

async function onAvatarChange(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const file = target?.files?.[0];
  if (!file) return;

  avatarSaving.value = true;
  try {
    const avatar = await compressImageFile(file, {
      maxWidth: 320,
      maxHeight: 320,
      quality: 0.78,
      mimeType: "image/jpeg",
      maxBytes: 140 * 1024,
    });
    await auth.updateProfile({ avatar });
    ElMessage.success("头像已更新");
  } catch (error) {
    ElMessage.error(normalizeImageUploadError(error, "头像上传失败，请稍后重试"));
  } finally {
    avatarSaving.value = false;
    if (target) target.value = "";
  }
}

async function removeAvatar() {
  avatarSaving.value = true;
  try {
    await auth.updateProfile({ avatar: null });
    ElMessage.success("头像已移除");
  } finally {
    avatarSaving.value = false;
  }
}
</script>

<style scoped>
.profile { display: flex; flex-direction: column; gap: 16px; }
.cpu-card { background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

.profile-card { text-align: center; }
.avatar { font-size: 28px; font-weight: 600; }
.avatar-actions {
  margin-top: 10px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.name {
  margin: 12px 0 4px;
  font-size: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}
.account-note { font-size: 12px; color: #9ca3af; margin: 0 0 8px; }
.bio { font-size: 13px; color: #6b7280; margin: 0 0 16px; }

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
  font-size: 13px;
  border-bottom: 1px dashed #f1f5f9;
}
.kv li:last-child { border-bottom: none; }
.kv li span:first-child { color: #6b7280; }
.kv li span:last-child { color: #1f2937; font-weight: 500; }

.profile-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.profile-actions .el-button { flex: 1 1 auto; min-width: 100px; margin-left: 0 !important; }

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

.trust-sub {
  margin: 4px 0 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}

.trust-score {
  min-width: 72px;
  text-align: center;
  padding: 10px 14px;
  border-radius: 14px;
  background: linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%);
  color: #fff;
  font-size: 24px;
  font-weight: 700;
}

.trust-level-row {
  margin-top: -4px;
  color: #7c3aed;
  font-size: 13px;
  font-weight: 600;
}

.trust-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.trust-item {
  padding: 12px;
  border-radius: 12px;
  background: #f7f7fb;
}

.trust-item span {
  display: block;
  color: #6b7280;
  font-size: 12px;
  margin-bottom: 6px;
}

.trust-item b {
  color: #111827;
  font-size: 18px;
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
  border-bottom: 1px dashed #eceff3;
  font-size: 13px;
}

.trust-row span {
  color: #6b7280;
}

.trust-row b {
  color: #111827;
}

.trust-next {
  margin: 0;
  color: #7c3aed;
  font-size: 13px;
  line-height: 1.6;
}

.anonymous-boards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.anonymous-boards-label {
  color: #6b7280;
  font-size: 12px;
}

.anonymous-board-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.user-group-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.user-group-card p {
  margin: 4px 0 8px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.6;
}
.user-group-card strong {
  color: #168776;
  font-size: 20px;
  letter-spacing: 0;
}
.user-group-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.user-group-actions .el-button {
  margin-left: 0 !important;
}

.topic-line {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px dashed #f1f5f9;
  cursor: pointer;
  border-radius: 6px;
  min-width: 0;
  overflow: hidden;
}
.topic-line:last-child { border-bottom: none; }
.topic-line:hover { background: #f4f6f8; }
.tag { color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
.anon-tag { color: #7c3aed; font-size: 12px; font-weight: 600; }
.title { font-size: 14px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.meta { font-size: 12px; color: #9ca3af; flex-shrink: 0; }

.cpu-section-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.hidden-file-input { display: none; }

@media (max-width: 640px) {
  .cpu-card {
    border-radius: 10px;
    padding: 14px;
  }

  .profile-actions {
    gap: 6px;
  }
  .profile-actions .el-button {
    flex: 1 1 calc(50% - 4px);
    min-width: 0;
  }

  .avatar-actions {
    gap: 6px;
  }

  .trust-head {
    flex-direction: column;
  }

  .trust-score {
    min-width: 0;
    width: 100%;
  }

  .trust-grid,
  .trust-breakdown {
    grid-template-columns: 1fr;
  }

  .user-group-card {
    align-items: stretch;
    flex-direction: column;
  }
  .user-group-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .topic-line {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 2px;
  }

  .title {
    flex-basis: 100%;
    order: 3;
    white-space: normal;
    line-height: 1.45;
  }

  .meta {
    margin-left: auto;
  }
}
</style>
