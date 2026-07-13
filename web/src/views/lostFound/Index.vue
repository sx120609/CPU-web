<template>
  <div class="lost-found-page">
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">校园互助 · 信息公开 · 私下核验</span>
        <h1>失物招领</h1>
        <p>把丢失和捡到的信息放到一个清楚、好找的地方。联系方式不会公开展示，认领通过站内表单完成。</p>
        <div class="hero-actions">
          <el-button type="primary" size="large" @click="openPublish('found')">我捡到了</el-button>
          <el-button size="large" @click="openPublish('lost')">我丢了</el-button>
          <el-button v-if="auth.isLoggedIn" text size="large" @click="mineOpen = true; loadMine()">我的信息</el-button>
        </div>
      </div>
      <div class="hero-mark" aria-hidden="true">
        <span>寻</span><small>LOST &amp; FOUND</small>
      </div>
    </section>

    <section class="filter-card cpu-card">
      <div class="quick-types">
        <button type="button" :class="{ active: !filters.kind }" @click="filters.kind = ''; applyFilters()">全部</button>
        <button type="button" :class="{ active: filters.kind === 'found' }" @click="filters.kind = 'found'; applyFilters()">我捡到了</button>
        <button type="button" :class="{ active: filters.kind === 'lost' }" @click="filters.kind = 'lost'; applyFilters()">我丢了</button>
      </div>
      <div class="filters">
        <el-input v-model="filters.q" clearable placeholder="搜索物品、地点或描述" @keyup.enter="applyFilters">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="filters.campus" clearable placeholder="全部校区" @change="applyFilters">
          <el-option v-for="campus in campuses" :key="campus" :label="campus" :value="campus" />
        </el-select>
        <el-input v-model="filters.location" clearable placeholder="地点关键词" @keyup.enter="applyFilters" />
        <el-date-picker v-model="filters.dates" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" @change="applyFilters" />
        <el-select v-model="filters.status" clearable placeholder="全部状态" @change="applyFilters">
          <el-option label="等待认领" value="active" /><el-option label="已认领" value="claimed" />
        </el-select>
        <el-button type="primary" @click="applyFilters">筛选</el-button>
      </div>
    </section>

    <div class="list-head">
      <div><strong>{{ total }}</strong> 条信息<small>已认领内容会弱化展示，仍可查看历史记录</small></div>
      <el-button text :loading="loading" @click="loadItems">刷新</el-button>
    </div>

    <section v-loading="loading" class="items-grid">
      <article
        v-for="item in items"
        :key="item.id"
        class="item-card"
        :class="{ claimed: item.status === 'claimed', pinned: item.pinned }"
        @click="openDetail(item.id)"
      >
        <div class="cover">
          <img v-if="item.cover" :src="item.cover" :alt="item.itemName" />
          <div v-else class="cover-placeholder">{{ item.kind === 'found' ? '拾' : '寻' }}</div>
          <span class="kind" :class="item.kind">{{ item.kind === 'found' ? '我捡到了' : '我丢了' }}</span>
          <span v-if="item.pinned" class="pin">置顶</span>
          <div v-if="item.status === 'claimed'" class="claimed-mark">已认领</div>
        </div>
        <div class="card-body">
          <h2>{{ item.itemName }}</h2>
          <p v-if="item.description">{{ item.description }}</p>
          <div class="facts">
            <span><el-icon><Location /></el-icon>{{ item.campus }} · {{ item.location }}</span>
            <span><el-icon><Clock /></el-icon>{{ formatDate(item.happenedAt) }}</span>
          </div>
          <footer>
            <span>{{ item.publisher.nickname }}</span>
            <span>{{ item.topic.replyCount }} 条讨论 · {{ item.claimCount }} 次认领申请</span>
          </footer>
        </div>
      </article>
      <el-empty v-if="!loading && !items.length" description="暂时没有符合条件的信息">
        <el-button type="primary" @click="openPublish('lost')">发布一条信息</el-button>
      </el-empty>
    </section>
    <el-pagination v-if="total > pageSize" v-model:current-page="page" :page-size="pageSize" :total="total" layout="prev, pager, next" @current-change="loadItems" />

    <el-dialog v-model="publishOpen" width="min(720px, 94vw)" :title="publishForm.kind === 'found' ? '发布：我捡到了' : '发布：我丢了'" destroy-on-close>
      <el-form label-position="top" class="publish-form">
        <div class="two-cols">
          <el-form-item label="发布类型" required><el-segmented v-model="publishForm.kind" :options="[{ label: '我捡到了', value: 'found' }, { label: '我丢了', value: 'lost' }]" block /></el-form-item>
          <el-form-item label="物品名称" required><el-input v-model="publishForm.itemName" maxlength="80" placeholder="例如：蓝色校园卡套" /></el-form-item>
        </div>
        <div class="three-cols">
          <el-form-item label="校区" required><el-input v-model="publishForm.campus" maxlength="40" placeholder="玄武门校区" /></el-form-item>
          <el-form-item label="具体地点" required><el-input v-model="publishForm.location" maxlength="100" placeholder="教学楼、食堂、操场等" /></el-form-item>
          <el-form-item label="丢失 / 捡到时间" required><el-date-picker v-model="publishForm.happenedAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="选择时间" /></el-form-item>
        </div>
        <el-form-item label="补充说明"><el-input v-model="publishForm.description" type="textarea" :rows="4" maxlength="3000" show-word-limit placeholder="可描述颜色、外观或发现经过；用于核验的关键特征建议不要全部公开。" /></el-form-item>
        <el-form-item label="联系方式" required>
          <el-input v-model="publishForm.contact" maxlength="120" placeholder="QQ / 微信 / 手机号，仅发布者本人、管理员和认领流程相关人员可见" />
          <p class="field-note">前台不会公开展示联系方式，认领者需登录后提交认领说明。</p>
        </el-form-item>
        <el-form-item label="图片（最多 6 张）">
          <div class="image-grid">
            <div v-for="(url, index) in publishForm.images" :key="url" class="image-cell"><img :src="url" alt="物品图片" /><button type="button" @click="publishForm.images.splice(index, 1)">×</button></div>
            <label v-if="publishForm.images.length < 6" class="upload-cell" :class="{ disabled: uploading }">
              <input type="file" accept="image/*" multiple :disabled="uploading" @change="uploadImages" />
              <el-icon :class="{ 'is-loading': uploading }"><Loading v-if="uploading" /><Plus v-else /></el-icon>
              <span>{{ uploading ? `上传中 ${uploadProgress}%` : '添加图片' }}</span>
            </label>
          </div>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="publishOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitItem">提交发布</el-button></template>
    </el-dialog>

    <el-drawer v-model="detailOpen" size="min(680px, 100vw)" direction="rtl" destroy-on-close>
      <template #header><div class="drawer-title"><span>{{ detail?.kind === 'found' ? '我捡到了' : '我丢了' }}</span><strong>{{ detail?.itemName || '信息详情' }}</strong></div></template>
      <div v-if="detail" class="detail" v-loading="detailLoading">
        <el-carousel v-if="detail.images.length" :autoplay="false" height="320px" indicator-position="outside"><el-carousel-item v-for="image in detail.images" :key="image.id"><img :src="image.url" :alt="detail.itemName" /></el-carousel-item></el-carousel>
        <div class="detail-tags"><el-tag :type="detail.kind === 'found' ? 'success' : 'warning'">{{ detail.kind === 'found' ? '我捡到了' : '我丢了' }}</el-tag><el-tag v-if="detail.status === 'claimed'" type="info">已认领</el-tag><el-tag v-if="detail.status === 'reviewing'" type="warning">审核中</el-tag><el-tag v-if="detail.pinned" type="danger">置顶</el-tag></div>
        <h2>{{ detail.itemName }}</h2>
        <dl><div><dt>校区地点</dt><dd>{{ detail.campus }} · {{ detail.location }}</dd></div><div><dt>发生时间</dt><dd>{{ formatDate(detail.happenedAt, true) }}</dd></div><div><dt>发布同学</dt><dd>{{ detail.publisher.nickname }}</dd></div></dl>
        <p v-if="detail.description" class="description">{{ detail.description }}</p>
        <el-alert v-if="!detail.mine" title="联系方式已保护" description="请通过站内认领表单描述物品特征或持有凭据。发布者核验通过后，再按双方留下的联系方式完成交接。" type="info" :closable="false" show-icon />
        <div v-else class="private-contact"><small>仅你和管理员可见的联系方式</small><strong>{{ detail.contact }}</strong></div>
        <div class="detail-actions">
          <el-button v-if="detail.status === 'active' && !detail.mine" type="primary" @click="openClaim">{{ detail.kind === 'found' ? '这是我的，提交认领' : '我找到了，联系失主' }}</el-button>
          <el-button v-if="detail.mine && detail.status === 'active'" type="success" plain @click="setItemStatus('claimed')">标记已认领</el-button>
          <el-button v-if="detail.mine && detail.status === 'active'" plain @click="setItemStatus('closed')">关闭信息</el-button>
          <el-button v-if="detail.mine && detail.status !== 'active'" plain @click="setItemStatus('active')">重新开放</el-button>
          <el-button @click="router.push(`/forum/topic/${detail.topicId}`)">去论坛讨论（{{ detail.topic.replyCount }}）</el-button>
        </div>
        <section v-if="detail.myClaim" class="my-claim"><h3>我的认领申请</h3><el-tag :type="claimTagType(detail.myClaim.status)">{{ claimStatusText(detail.myClaim.status) }}</el-tag><p>{{ detail.myClaim.message }}</p><el-button v-if="detail.myClaim.status === 'pending'" text type="danger" @click="withdrawClaim(detail.myClaim.id)">撤回申请</el-button></section>
        <section v-if="detail.mine && detail.claims?.length" class="claims"><h3>认领申请</h3><article v-for="claim in detail.claims" :key="claim.id"><div><strong>{{ claim.claimant?.nickname || '认领同学' }}</strong><el-tag size="small" :type="claimTagType(claim.status)">{{ claimStatusText(claim.status) }}</el-tag></div><p>{{ claim.message }}</p><p v-if="claim.evidence"><b>核验线索：</b>{{ claim.evidence }}</p><p class="claim-contact"><b>联系方式：</b>{{ claim.contact }}</p><footer v-if="claim.status === 'pending'"><el-button size="small" type="success" @click="resolveClaim(claim.id, 'accepted')">核验通过</el-button><el-button size="small" @click="resolveClaim(claim.id, 'rejected')">不匹配</el-button></footer></article></section>
      </div>
    </el-drawer>

    <el-dialog v-model="claimOpen" width="min(560px, 94vw)" title="提交站内认领信息">
      <el-alert title="请只填写发布者可以用来核验的信息，不要在公开评论区留下手机号、证件号等隐私。" type="warning" :closable="false" show-icon />
      <el-form label-position="top" class="claim-form"><el-form-item label="认领说明" required><el-input v-model="claimForm.message" type="textarea" :rows="4" maxlength="1000" show-word-limit placeholder="说明你与物品的关系，或你在哪里发现了它。" /></el-form-item><el-form-item label="可核验特征 / 凭据"><el-input v-model="claimForm.evidence" type="textarea" :rows="3" maxlength="1000" placeholder="例如物品内部特征、卡片姓名、购买记录等，仅发布者和管理员可见。" /></el-form-item><el-form-item label="你的联系方式" required><el-input v-model="claimForm.contact" maxlength="120" placeholder="QQ / 微信 / 手机号" /></el-form-item></el-form>
      <template #footer><el-button @click="claimOpen = false">取消</el-button><el-button type="primary" :loading="claimSubmitting" @click="submitClaim">提交给发布者</el-button></template>
    </el-dialog>

    <el-drawer v-model="mineOpen" size="min(760px, 100vw)" title="我的失物招领">
      <el-tabs v-model="mineTab"><el-tab-pane label="我发布的" name="published"><div class="mine-list"><button v-for="item in mine.published" :key="item.id" type="button" @click="mineOpen = false; openDetail(item.id)"><span>{{ item.kind === 'found' ? '捡到' : '寻找' }}</span><strong>{{ item.itemName }}</strong><small>{{ item.location }} · {{ statusText(item.status) }}</small></button><el-empty v-if="!mine.published.length" description="还没有发布记录" /></div></el-tab-pane><el-tab-pane label="我的认领" name="claims"><div class="mine-list"><button v-for="claim in mine.claims" :key="claim.id" type="button" @click="mineOpen = false; openDetail(claim.itemId)"><span>认领</span><strong>{{ claim.item?.itemName }}</strong><small>{{ claimStatusText(claim.status) }}</small></button><el-empty v-if="!mine.claims.length" description="还没有认领记录" /></div></el-tab-pane></el-tabs>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Clock, Loading, Location, Plus, Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import dayjs from "dayjs";
import { lostFoundApi, type LostFoundClaim, type LostFoundClaimStatus, type LostFoundItem, type LostFoundKind, type LostFoundStatus } from "@/api/lostFound";
import { uploadApi } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";
import { isAndroidNativeApp } from "@/utils/clientInfo";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const items = ref<LostFoundItem[]>([]);
const campuses = ref<string[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = 18;
const total = ref(0);
const filters = reactive<{ q: string; kind: string; campus: string; location: string; dates: string[]; status: string }>({ q: "", kind: "", campus: "", location: "", dates: [], status: "" });
const publishOpen = ref(false);
const submitting = ref(false);
const uploading = ref(false);
const uploadProgress = ref(0);
const publishForm = reactive({ kind: "found" as LostFoundKind, itemName: "", description: "", campus: "", location: "", happenedAt: "", contact: "", images: [] as string[] });
const detailOpen = ref(false);
const detailLoading = ref(false);
const detail = ref<LostFoundItem | null>(null);
const claimOpen = ref(false);
const claimSubmitting = ref(false);
const claimForm = reactive({ message: "", evidence: "", contact: "" });
const mineOpen = ref(false);
const mineTab = ref("published");
const mine = reactive<{ published: LostFoundItem[]; claims: LostFoundClaim[] }>({ published: [], claims: [] });

onMounted(async () => {
  await Promise.all([loadItems(), loadMeta()]);
  const itemId = Number(route.query.item || 0);
  if (itemId) await openDetail(itemId);
});

async function loadMeta() { try { campuses.value = (await lostFoundApi.meta({ suppressErrorMessage: true })).campuses; } catch { campuses.value = []; } }
async function loadItems() { loading.value = true; try { const result = await lostFoundApi.items({ q: filters.q || undefined, kind: filters.kind || undefined, campus: filters.campus || undefined, location: filters.location || undefined, status: filters.status || undefined, from: filters.dates?.[0], to: filters.dates?.[1] ? `${filters.dates[1]}T23:59:59` : undefined, page: page.value, size: pageSize }, { suppressErrorMessage: true }); items.value = result.list; total.value = result.total; } catch { items.value = []; total.value = 0; } finally { loading.value = false; } }
function applyFilters() { page.value = 1; void loadItems(); }
function ensureLogin() { if (auth.isLoggedIn) return true; router.push({ name: "login", query: { redirect: route.fullPath } }); return false; }
function openPublish(kind: LostFoundKind) { if (!ensureLogin()) return; Object.assign(publishForm, { kind, itemName: "", description: "", campus: filters.campus || "", location: "", happenedAt: dayjs().format("YYYY-MM-DDTHH:mm:ss"), contact: "", images: [] }); publishOpen.value = true; }

async function uploadImages(event: Event) { const input = event.target as HTMLInputElement; const files = Array.from(input.files || []).slice(0, 6 - publishForm.images.length); if (!files.length) return; uploading.value = true; try { for (let i = 0; i < files.length; i++) { const result = await uploadApi.media(files[i], files[i].name, { forceProxy: isAndroidNativeApp(), onProgress: (state) => { uploadProgress.value = Math.round(((i + state.percent / 100) / files.length) * 100); } }); publishForm.images.push(result.url); } } finally { uploading.value = false; uploadProgress.value = 0; input.value = ""; } }
function validPublish() { if (publishForm.itemName.trim().length < 2) return ElMessage.warning("请填写物品名称"), false; if (!publishForm.campus.trim()) return ElMessage.warning("请填写校区"), false; if (publishForm.location.trim().length < 2) return ElMessage.warning("请填写具体地点"), false; if (!publishForm.happenedAt) return ElMessage.warning("请选择时间"), false; if (publishForm.contact.trim().length < 2) return ElMessage.warning("请填写联系方式"), false; return true; }
async function submitItem() { if (!validPublish() || submitting.value) return; submitting.value = true; try { const item = await lostFoundApi.create({ ...publishForm }); publishOpen.value = false; ElMessage.success(item.status === "reviewing" ? "已提交审核，通过后会公开展示" : "已发布，并同步到论坛讨论区"); await Promise.all([loadItems(), loadMeta()]); await openDetail(item.id); } finally { submitting.value = false; } }
async function openDetail(id: number) { detailOpen.value = true; detailLoading.value = true; try { detail.value = await lostFoundApi.item(id, { suppressErrorMessage: true }); router.replace({ query: { ...route.query, item: String(id) } }).catch(() => null); } catch { detailOpen.value = false; ElMessage.error("信息加载失败或已下架"); } finally { detailLoading.value = false; } }
function openClaim() { if (!ensureLogin()) return; Object.assign(claimForm, { message: "", evidence: "", contact: "" }); claimOpen.value = true; }
async function submitClaim() { if (!detail.value || claimSubmitting.value) return; if (claimForm.message.trim().length < 5) return ElMessage.warning("请至少填写 5 个字的认领说明"); if (claimForm.contact.trim().length < 2) return ElMessage.warning("请填写联系方式"); claimSubmitting.value = true; try { await lostFoundApi.claim(detail.value.id, { ...claimForm }); claimOpen.value = false; ElMessage.success("认领信息已私下提交给发布者"); await openDetail(detail.value.id); } finally { claimSubmitting.value = false; } }
async function setItemStatus(status: "active" | "claimed" | "closed") { if (!detail.value) return; const label = status === "claimed" ? "标记为已认领" : status === "closed" ? "关闭" : "重新开放"; await ElMessageBox.confirm(`确认${label}这条信息？`, "更新状态", { type: "warning" }); await lostFoundApi.updateStatus(detail.value.id, status); ElMessage.success("状态已更新"); await Promise.all([openDetail(detail.value.id), loadItems()]); }
async function resolveClaim(id: number, status: "accepted" | "rejected") { if (!detail.value) return; if (status === "accepted") await ElMessageBox.confirm("通过后该信息会自动标记为已认领，其他待处理申请将关闭。请确认已核对关键特征。", "确认认领", { type: "warning" }); await lostFoundApi.updateClaim(id, status); ElMessage.success(status === "accepted" ? "已通过认领" : "已标记为不匹配"); await Promise.all([openDetail(detail.value.id), loadItems()]); }
async function withdrawClaim(id: number) { if (!detail.value) return; await lostFoundApi.updateClaim(id, "withdrawn"); ElMessage.success("已撤回申请"); await openDetail(detail.value.id); }
async function loadMine() { if (!auth.isLoggedIn) return; try { Object.assign(mine, await lostFoundApi.mine({ suppressErrorMessage: true })); } catch { Object.assign(mine, { published: [], claims: [] }); } }
function formatDate(value: string, full = false) { return dayjs(value).format(full ? "YYYY年M月D日 HH:mm" : "M月D日 HH:mm"); }
function statusText(status: LostFoundStatus) { return ({ reviewing: "审核中", active: "等待认领", claimed: "已认领", closed: "已关闭", hidden: "已下架" } as Record<LostFoundStatus, string>)[status]; }
function claimStatusText(status: LostFoundClaimStatus) { return ({ pending: "待核验", accepted: "已通过", rejected: "不匹配", withdrawn: "已撤回" } as Record<LostFoundClaimStatus, string>)[status]; }
function claimTagType(status: LostFoundClaimStatus) { return status === "accepted" ? "success" : status === "pending" ? "warning" : "info"; }
</script>

<style scoped>
.lost-found-page{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:18px}.hero{position:relative;min-height:280px;padding:42px 46px;border-radius:24px;overflow:hidden;color:#fff;background:linear-gradient(125deg,#087f70 0%,#13a38c 52%,#8bd8bd 100%);box-shadow:0 20px 45px rgba(8,127,112,.22)}.hero::after{content:"";position:absolute;inset:auto -80px -130px auto;width:410px;height:410px;border:70px solid rgba(255,255,255,.11);border-radius:50%}.hero-copy{position:relative;z-index:2;max-width:680px}.eyebrow{font-size:12px;letter-spacing:.14em;opacity:.82}.hero h1{margin:12px 0 10px;font-size:46px;letter-spacing:-.04em}.hero p{max-width:620px;margin:0;line-height:1.8;color:rgba(255,255,255,.88)}.hero-actions{display:flex;gap:10px;margin-top:26px;flex-wrap:wrap}.hero-actions :deep(.el-button--primary){color:#087f70;background:#fff;border-color:#fff}.hero-actions :deep(.el-button.is-text){color:#fff}.hero-mark{position:absolute;z-index:1;right:68px;top:42px;width:150px;height:150px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.42);border-radius:50%;background:rgba(255,255,255,.12);backdrop-filter:blur(8px)}.hero-mark span{font:700 64px/1 serif}.hero-mark small{position:absolute;bottom:25px;font-size:8px;letter-spacing:.16em}.filter-card{padding:16px 18px}.quick-types{display:flex;gap:8px;margin-bottom:14px}.quick-types button{padding:8px 15px;border:0;border-radius:999px;color:var(--cpu-text-secondary);background:var(--cpu-surface-subtle);cursor:pointer}.quick-types button.active{color:#fff;background:var(--cpu-primary)}.filters{display:grid;grid-template-columns:1.5fr .9fr 1fr 1.35fr .8fr auto;gap:10px}.list-head{display:flex;align-items:center;justify-content:space-between}.list-head strong{font-size:22px;color:var(--cpu-primary)}.list-head small{margin-left:12px;color:var(--cpu-text-muted)}.items-grid{min-height:300px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.items-grid>.el-empty{grid-column:1/-1}.item-card{overflow:hidden;border:1px solid var(--cpu-border-soft);border-radius:16px;background:var(--cpu-card);box-shadow:var(--cpu-shadow-sm);cursor:pointer;transition:.2s ease}.item-card:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--cpu-primary) 45%,var(--cpu-border-soft));box-shadow:0 14px 30px rgba(15,23,42,.1)}.item-card.claimed{opacity:.66}.item-card.pinned{border-color:rgba(225,82,65,.4)}.cover{position:relative;height:190px;overflow:hidden;background:linear-gradient(135deg,#dff8ee,#eef7f5)}.cover img{width:100%;height:100%;object-fit:cover}.cover-placeholder{height:100%;display:grid;place-items:center;color:#0f8f7b;font:700 70px/1 serif}.kind,.pin{position:absolute;top:12px;padding:5px 10px;border-radius:999px;color:#fff;font-size:11px;font-weight:700;backdrop-filter:blur(8px)}.kind{left:12px}.kind.found{background:rgba(8,127,112,.88)}.kind.lost{background:rgba(217,119,6,.9)}.pin{right:12px;background:rgba(220,38,38,.86)}.claimed-mark{position:absolute;right:12px;bottom:12px;padding:8px 13px;border-radius:8px;color:#fff;background:rgba(30,41,59,.82);font-weight:700}.card-body{padding:16px}.card-body h2{margin:0 0 8px;font-size:19px}.card-body>p{height:42px;margin:0 0 12px;overflow:hidden;color:var(--cpu-text-secondary);font-size:13px;line-height:1.65}.facts{display:flex;flex-direction:column;gap:7px;color:var(--cpu-text-secondary);font-size:12px}.facts span{display:flex;align-items:center;gap:6px}.card-body footer{display:flex;justify-content:space-between;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--cpu-border-soft);color:var(--cpu-text-muted);font-size:11px}.el-pagination{align-self:center}.two-cols,.three-cols{display:grid;gap:14px}.two-cols{grid-template-columns:1fr 1.4fr}.three-cols{grid-template-columns:.8fr 1.2fr 1.2fr}.field-note{margin:5px 0 0;color:var(--cpu-text-muted);font-size:11px}.image-grid{width:100%;display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.image-cell,.upload-cell{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:var(--cpu-surface-subtle)}.image-cell img{width:100%;height:100%;object-fit:cover}.image-cell button{position:absolute;right:4px;top:4px;width:23px;height:23px;border:0;border-radius:50%;color:#fff;background:rgba(15,23,42,.7);cursor:pointer}.upload-cell{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:5px;border:1px dashed var(--cpu-border);color:var(--cpu-text-secondary);cursor:pointer}.upload-cell input{display:none}.upload-cell span{font-size:10px}.drawer-title{display:flex;flex-direction:column;gap:3px}.drawer-title span{color:var(--cpu-primary);font-size:11px}.drawer-title strong{font-size:20px}.detail{padding:0 6px 30px}.detail :deep(.el-carousel__item){border-radius:14px;background:var(--cpu-surface-subtle)}.detail :deep(.el-carousel__item img){width:100%;height:100%;object-fit:contain}.detail-tags{display:flex;gap:7px;margin-top:16px}.detail h2{margin:12px 0 16px;font-size:28px}.detail dl{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.detail dl div{padding:12px;border-radius:10px;background:var(--cpu-surface-subtle)}.detail dt{color:var(--cpu-text-muted);font-size:10px}.detail dd{margin:5px 0 0;font-size:13px}.description{padding:16px 0;white-space:pre-wrap;line-height:1.8}.private-contact{display:flex;flex-direction:column;gap:5px;padding:13px;border-radius:10px;background:rgba(8,127,112,.09)}.private-contact small{color:var(--cpu-text-muted)}.detail-actions{display:flex;gap:8px;margin:18px 0;flex-wrap:wrap}.claims,.my-claim{margin-top:22px;padding-top:18px;border-top:1px solid var(--cpu-border-soft)}.claims h3,.my-claim h3{margin:0 0 12px}.claims article{padding:14px;margin-bottom:10px;border:1px solid var(--cpu-border-soft);border-radius:12px}.claims article>div{display:flex;justify-content:space-between}.claims p,.my-claim p{color:var(--cpu-text-secondary);font-size:13px;line-height:1.7}.claim-contact{padding:8px;border-radius:8px;background:var(--cpu-surface-subtle)}.claim-form{margin-top:16px}.mine-list{display:flex;flex-direction:column;gap:8px}.mine-list button{display:grid;grid-template-columns:56px 1fr auto;align-items:center;gap:10px;padding:13px;border:1px solid var(--cpu-border-soft);border-radius:10px;color:var(--cpu-text);background:var(--cpu-card);text-align:left;cursor:pointer}.mine-list button span{color:var(--cpu-primary);font-size:11px}.mine-list button small{color:var(--cpu-text-muted)}
@media(max-width:980px){.filters{grid-template-columns:1fr 1fr 1fr}.items-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hero-mark{opacity:.35}.hero-copy{max-width:620px}}
@media(max-width:650px){.lost-found-page{gap:12px}.hero{min-height:auto;padding:28px 20px;border-radius:16px}.hero h1{font-size:36px}.hero-mark{display:none}.hero-actions{display:grid;grid-template-columns:1fr 1fr}.hero-actions .el-button{margin:0}.hero-actions .el-button:last-child{grid-column:1/-1}.filter-card{padding:12px}.filters{grid-template-columns:1fr 1fr}.filters>*:first-child,.filters :deep(.el-date-editor){grid-column:1/-1;width:100%}.list-head small{display:block;margin:2px 0 0}.items-grid{grid-template-columns:1fr}.cover{height:210px}.two-cols,.three-cols{grid-template-columns:1fr}.image-grid{grid-template-columns:repeat(3,1fr)}.detail dl{grid-template-columns:1fr}.detail h2{font-size:24px}.detail-actions .el-button{margin:0;flex:1 1 calc(50% - 8px)}.mine-list button{grid-template-columns:48px 1fr}.mine-list button small{grid-column:2}}
</style>
