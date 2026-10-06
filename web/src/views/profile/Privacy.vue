<template>
  <main class="pk-page pk-page--narrow privacy-page" :aria-busy="loading">
    <header class="pk-head">
      <router-link v-if="auth.isLoggedIn" class="pk-back" to="/profile"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>我的</router-link>
      <div class="pk-title">
        <span class="pk-tile" aria-hidden="true"><el-icon><Lock /></el-icon></span>
        <div class="pk-title-copy">
          <h1>账号与隐私</h1>
          <p><a class="pk-link" href="/privacy.html">隐私政策</a><template v-if="!auth.forumHidden"> · <a class="pk-link" href="/community-rules.html">社区治理规则</a></template></p>
        </div>
      </div>
    </header>

    <template v-if="auth.isLoggedIn">
      <section v-if="!auth.forumHidden" class="pk-card">
        <h2 class="pk-h2">已屏蔽用户</h2>
        <p class="pk-muted">屏蔽后不显示该账号的帖子和回复，双方无法继续私聊。匿名内容按实际账号生效，不会显示其真实身份。</p>
        <p v-if="!blocks.length" class="pk-empty privacy-gap">暂无屏蔽用户</p>
        <ul v-else class="pk-rows privacy-gap">
          <li v-for="item in blocks" :key="item.id" class="pk-row privacy-block"><span class="pk-row-copy"><b>{{ item.label }}</b></span><el-button text @click="unblock(item.id)">解除屏蔽</el-button></li>
        </ul>
      </section>
      <section class="pk-card privacy-danger">
        <h2 class="pk-h2">永久删除账户</h2>
        <p>提交后立即停止原账户访问，系统自动清理账号资料、绑定、教务缓存、小组件凭证、AI 历史、上传文件及药苑之声身份。<template v-if="!auth.forumHidden">你发布的帖子和回复将清空并隐藏；与你相关的私聊会话（含双方消息）会删除。</template><template v-else>你在本站发布的内容及交流记录也会清理。</template>你创建的问卷、文件收集任务及其提交内容也会删除。请先保存需要的资料。</p>
        <p>学校账号及学校保存的数据不受影响。再次使用学校登录会创建全新的本站账户，原账户不可恢复。赞助不因注销自动退款，未使用权益和积分会失效。</p>
        <p>交易对账记录、无法回溯身份的数字关联和删除回执会按隐私政策保留；备份及第三方接收方的历史数据不等同于在线数据即时删除。任务遇到故障会自动重试，只有全部在线清理完成才显示完成。</p>
        <el-checkbox v-model="acknowledged">我已理解删除范围及不可恢复的后果</el-checkbox>
        <el-input v-model="confirmation" placeholder="请输入：删除我的账户" autocomplete="off" />
        <el-button type="danger" :loading="deleting" :disabled="!acknowledged || confirmation !== '删除我的账户'" @click="removeAccount">永久删除我的账户</el-button>
      </section>
    </template>
    <section class="pk-card privacy-receipt">
      <h2 class="pk-h2">查询删除进度</h2>
      <p class="pk-muted">删除回执是查询凭证，请自行保存，不要分享给他人。</p>
      <div class="privacy-receipt-row">
        <el-input v-model="receipt" placeholder="删除回执" autocomplete="off" />
        <el-button :disabled="receipt.length !== 43" @click="checkStatus">查询进度</el-button>
      </div>
      <p v-if="status" class="pk-notice" role="status">{{ status.message }}</p>
      <router-link v-if="!auth.isLoggedIn && !receipt" class="pk-link" to="/login">登录后管理账号与隐私</router-link>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ArrowLeft, Lock } from '@element-plus/icons-vue';
import '@/styles/page-kit.css';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { request } from '@/api/request';
import { clearCreds } from '@/utils/credCrypto';
import { clearCommunityViewCaches } from '@/utils/privacyLocalState';
const auth = useAuthStore();
const loading = ref(false), deleting = ref(false), acknowledged = ref(false), confirmation = ref('');
const blocks = ref<Array<{ id: string; label: string }>>([]);
const receipt = ref(''), status = ref<{ message: string } | null>(null);
try { receipt.value = localStorage.getItem('cpu-account-deletion-receipt') || ''; } catch { /* Storage may be disabled. */ }
async function refresh() {
  loading.value = true;
  try {
    if (auth.isLoggedIn && !auth.forumHidden) {
      blocks.value = await request.get('/user/blocks');
    }
  } finally { loading.value = false; }
}
async function unblock(id: string) { await request.delete(`/user/blocks/${encodeURIComponent(id)}`); clearCommunityViewCaches(); await refresh(); }
async function checkStatus() { status.value = await request.post('/privacy/account-deletion/status', { receipt: receipt.value }); }
async function removeAccount() {
  try { await ElMessageBox.confirm('这会永久删除本站账户及上述关联数据，无法恢复。确认继续？', '最后确认', { type: 'warning', confirmButtonText: '永久删除', cancelButtonText: '取消', closeOnClickModal: false }); } catch { return; }
  deleting.value = true;
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    receipt.value = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try { localStorage.setItem('cpu-account-deletion-receipt', receipt.value); } catch { /* The visible receipt remains available for copying. */ }
    const result = await request.post<{ receipt: string }>('/privacy/account-deletion', { confirmation: confirmation.value, acknowledged: acknowledged.value, receipt: receipt.value });
    receipt.value = result.receipt;
    clearCreds();
    clearCommunityViewCaches();
    try { (window as any).CPUIOS?.clearScheduleWidget?.(); } catch { /* The server has already revoked widget credentials. */ }
    await auth.logout();
    await checkStatus();
    ElMessage.success('已提交永久删除，请保存下方回执并查询最终结果');
  } catch {
    ElMessage.warning('请求结果尚未确认，请保留下方回执并查询进度，避免重复提交');
  } finally { deleting.value = false; }
}
onMounted(refresh);
</script>

<style scoped>
.privacy-gap { margin-top: 12px; }
.privacy-block { padding-inline: 0; min-height: 48px; }
.privacy-danger { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.privacy-danger > p { margin: 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.75; }
.privacy-danger .el-input { max-width: 360px; }
.privacy-receipt { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.privacy-receipt .pk-muted { margin: 0; }
.privacy-receipt-row { display: flex; width: 100%; gap: 8px; }
.privacy-receipt-row .el-input { flex: 1; min-width: 0; }
@media (max-width: 560px) {
  .privacy-danger .el-input { max-width: none; }
  .privacy-danger > .el-button { width: 100%; }
  .privacy-receipt-row { flex-direction: column; }
}
</style>
