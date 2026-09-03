<template>
  <div class="lost-found-page">
    <template v-if="isMobileLayout">
      <section class="mobile-lost-intro">
        <div class="mobile-lost-heading">
          <span class="mobile-lost-kicker">校园互助</span>
          <h1>失物招领</h1>
          <p>公开信息，私下核验。联系方式只在认领流程或私聊中发送。</p>
        </div>
        <div class="mobile-lost-actions">
          <button type="button" @click="openPublish('found')">
            <span class="mobile-action-icon"><el-icon><Plus /></el-icon></span>
            <span><b>发布招领</b><small>我捡到了</small></span>
          </button>
          <button type="button" @click="openPublish('lost')">
            <span class="mobile-action-icon is-lost"><el-icon><Search /></el-icon></span>
            <span><b>发布寻物</b><small>我丢了东西</small></span>
          </button>
          <button v-if="auth.isLoggedIn" type="button" class="mobile-mine-action" @click="mineOpen = true; loadMine()">
            我的发布与认领 <el-icon><ArrowRight /></el-icon>
          </button>
        </div>
      </section>

      <section class="mobile-lost-search" aria-label="筛选失物招领信息">
        <form class="mobile-search-row" @submit.prevent="applyFilters">
          <el-input v-model="filters.q" clearable placeholder="搜索物品、地点或描述" @clear="applyFilters">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <button type="button" class="mobile-filter-button" aria-label="更多筛选" @click="mobileFiltersOpen = true">
            <el-icon><Filter /></el-icon>
            <span v-if="mobileFilterCount">{{ mobileFilterCount }}</span>
          </button>
        </form>
        <nav class="mobile-kind-tabs" aria-label="信息类型">
          <button type="button" :class="{ active: !filters.kind }" @click="filters.kind = ''; applyFilters()">全部</button>
          <button type="button" :class="{ active: filters.kind === 'found' }" @click="filters.kind = 'found'; applyFilters()">捡到物品</button>
          <button type="button" :class="{ active: filters.kind === 'lost' }" @click="filters.kind = 'lost'; applyFilters()">寻找物品</button>
        </nav>
      </section>

      <section class="mobile-lost-feed">
        <header class="mobile-list-head">
          <div><h2>最新信息</h2><p>{{ total }} 条公开记录</p></div>
          <button type="button" :disabled="loading" @click="loadItems">{{ loading ? '刷新中' : '刷新' }}</button>
        </header>
        <div v-loading="loading" class="mobile-item-list">
          <article
            v-for="item in items"
            :key="item.id"
            class="mobile-item-card"
            :class="{ claimed: item.status === 'claimed', pinned: item.pinned }"
            tabindex="0"
            role="button"
            @click="openDetail(item)"
            @keydown.enter.prevent="openDetail(item)"
            @keydown.space.prevent="openDetail(item)"
            @pointerenter="prefetchDetail(item.id)"
          >
            <header class="mobile-item-author">
              <UserAvatar :size="36" :src="item.publisher.avatar" :name="item.publisher.nickname" :seed="item.publisher.id" alt="发布者头像" />
              <span class="mobile-item-author-copy"><b>{{ item.publisherDepartment || item.publisher.nickname }}</b><small>{{ formatDate(item.publishedAt || item.createdAt) }}</small></span>
              <em :class="item.kind">{{ item.kind === 'found' ? '捡到物品' : '寻找物品' }}</em>
            </header>
            <div class="mobile-item-content" :class="{ 'has-cover': item.cover }">
              <div class="mobile-item-copy">
                <h3>{{ item.itemName }}</h3>
                <p v-if="item.description">{{ item.description }}</p>
                <div class="mobile-item-facts">
                  <span><el-icon><Location /></el-icon>{{ item.campus || '校区待补充' }} · {{ item.location || '地点待补充' }}</span>
                  <span><el-icon><Clock /></el-icon>{{ formatDate(item.happenedAt) }}</span>
                </div>
              </div>
              <img v-if="item.cover" :src="item.cover" :alt="item.itemName" loading="lazy" decoding="async" />
            </div>
            <footer>
              <span v-if="item.pinned" class="mobile-pin">置顶</span>
              <span :class="['mobile-status', item.status]">{{ statusText(item.status) }}</span>
              <span class="mobile-item-stats">{{ item.topic.replyCount }} 条讨论 · {{ item.claimCount }} 次认领</span>
              <el-icon><ArrowRight /></el-icon>
            </footer>
          </article>
          <el-empty v-if="!loading && !items.length" description="暂时没有符合条件的信息">
            <el-button type="primary" @click="openPublish('lost')">发布一条寻物信息</el-button>
          </el-empty>
        </div>
      </section>
    </template>

    <template v-else>
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">校园互助 · 信息公开 · 私下核验</span>
        <h1>失物招领</h1>
        <p>把丢失和捡到的信息放到一个清楚、好找的地方。联系方式不会公开展示，认领通过站内表单完成。</p>
        <div class="hero-actions">
          <el-button size="large" @click="openPublish('found')">我捡到了</el-button>
          <el-button size="large" @click="openPublish('lost')">我丢了</el-button>
          <el-button v-if="auth.isLoggedIn" size="large" @click="mineOpen = true; loadMine()">我的信息</el-button>
        </div>
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
        @click="openDetail(item)"
        @pointerenter="prefetchDetail(item.id)"
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
            <span><el-icon><Location /></el-icon>{{ item.campus || '校区待补充' }} · {{ item.location || '地点待补充' }}</span>
            <span><el-icon><Clock /></el-icon>{{ formatDate(item.happenedAt) }}</span>
          </div>
          <footer>
            <span>{{ item.publisherDepartment || item.publisher.nickname }}</span>
            <span>{{ item.topic.replyCount }} 条讨论 · {{ item.claimCount }} 次认领申请</span>
          </footer>
        </div>
      </article>
      <el-empty v-if="!loading && !items.length" description="暂时没有符合条件的信息">
        <el-button type="primary" @click="openPublish('lost')">发布一条信息</el-button>
      </el-empty>
    </section>
    </template>
    <el-pagination v-if="total > pageSize" v-model:current-page="page" :page-size="pageSize" :total="total" layout="prev, pager, next" @current-change="loadItems" />

    <el-drawer v-model="mobileFiltersOpen" direction="btt" size="min(70vh, 520px)" title="筛选失物信息" class="mobile-filter-drawer">
      <el-form label-position="top" class="mobile-filter-form">
        <el-form-item label="校区"><el-select v-model="filters.campus" clearable placeholder="全部校区"><el-option v-for="campus in campuses" :key="campus" :label="campus" :value="campus" /></el-select></el-form-item>
        <el-form-item label="地点"><el-input v-model="filters.location" clearable placeholder="教学楼、宿舍、食堂等" /></el-form-item>
        <el-form-item label="时间范围"><el-date-picker v-model="filters.dates" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" /></el-form-item>
        <el-form-item label="认领状态"><el-select v-model="filters.status" clearable placeholder="全部状态"><el-option label="等待认领" value="active" /><el-option label="已认领" value="claimed" /></el-select></el-form-item>
      </el-form>
      <div class="mobile-filter-actions"><el-button @click="resetMobileFilters">重置</el-button><el-button type="primary" @click="mobileFiltersOpen = false; applyFilters()">查看结果</el-button></div>
    </el-drawer>

    <el-dialog v-model="publishOpen" width="min(720px, 94vw)" :title="publishForm.kind === 'found' ? '发布：我捡到了' : '发布：我丢了'" destroy-on-close>
      <el-form label-position="top" class="publish-form">
        <div class="two-cols">
          <el-form-item label="发布类型" required>
            <div class="choice-tabs" role="radiogroup" aria-label="发布类型">
              <button type="button" :class="{ active: publishForm.kind === 'found' }" @click="publishForm.kind = 'found'">我捡到了</button>
              <button type="button" :class="{ active: publishForm.kind === 'lost' }" @click="publishForm.kind = 'lost'">我丢了</button>
            </div>
          </el-form-item>
          <el-form-item label="物品名称" required><el-input v-model="publishForm.itemName" maxlength="80" placeholder="例如：蓝色校园卡套" /></el-form-item>
        </div>
        <el-form-item label="校区" required>
          <div class="choice-tabs campus-tabs" role="radiogroup" aria-label="校区">
            <button v-for="campus in campusOptions" :key="campus" type="button" :class="{ active: publishForm.campus === campus }" @click="publishForm.campus = campus">{{ campus }}</button>
          </div>
        </el-form-item>
        <div class="two-cols location-time-row">
          <el-form-item label="具体地点" required><el-input v-model="publishForm.location" maxlength="100" placeholder="教学楼、食堂、操场等" /></el-form-item>
          <el-form-item label="丢失 / 捡到时间" required><el-date-picker v-model="publishForm.happenedAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="选择时间" /></el-form-item>
        </div>
        <el-form-item v-if="publishForm.kind === 'found'" label="放到哪里了" required>
          <el-input v-model="publishForm.storageLocation" maxlength="160" placeholder="例如：7.1 宿管值班室、教学楼前台、保卫处失物招领柜" />
          <p class="field-note">请填写物品实际移交或暂存的位置，方便失主线下领取。</p>
        </el-form-item>
        <el-form-item label="补充说明"><el-input v-model="publishForm.description" type="textarea" :rows="4" maxlength="3000" show-word-limit placeholder="可描述颜色、外观或发现经过；用于核验的关键特征建议不要全部公开。" /></el-form-item>
        <el-form-item label="联系方式" required>
          <el-input v-model="publishForm.contact" maxlength="120" placeholder="QQ / 微信 / 手机号，仅发布者本人、管理员和认领流程相关人员可见" />
          <p class="field-note">前台不会公开展示联系方式，认领者需登录后提交认领说明。</p>
        </el-form-item>
        <el-form-item label="图片（最多 6 张）">
          <div class="image-grid">
            <div v-for="(url, index) in publishForm.images" :key="url" class="image-cell"><img :src="url" alt="物品图片" @click="openPublishImages(index)" /><button type="button" @click="publishForm.images.splice(index, 1)">×</button></div>
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
        <el-carousel v-if="detail.images.length" :autoplay="false" height="320px" indicator-position="outside"><el-carousel-item v-for="(image, index) in detail.images" :key="image.id"><img :src="image.url" :alt="detail.itemName" @click="openLostFoundImages(index)" /></el-carousel-item></el-carousel>
        <div class="detail-tags"><el-tag :type="detail.kind === 'found' ? 'success' : 'warning'">{{ detail.kind === 'found' ? '我捡到了' : '我丢了' }}</el-tag><el-tag v-if="detail.status === 'claimed'" type="info">已认领</el-tag><el-tag v-if="detail.status === 'reviewing'" type="warning">审核中</el-tag><el-tag v-if="detail.pinned" type="danger">置顶</el-tag></div>
        <h2>{{ detail.itemName }}</h2>
        <dl><div><dt>校区地点</dt><dd>{{ detail.campus || '校区待补充' }} · {{ detail.location || '地点待补充' }}</dd></div><div><dt>发生时间</dt><dd>{{ formatDate(detail.happenedAt, true) }}</dd></div><div><dt>发布同学</dt><dd>{{ detail.publisherDepartment || detail.publisher.nickname }}</dd></div></dl>
        <div v-if="detail.storageLocation || detail.publisherDepartment || detail.claimDeadline || detail.remark" class="import-details">
          <div v-if="detail.storageLocation"><small>失物存放点位</small><strong>{{ detail.storageLocation }}</strong></div>
          <div v-if="detail.publisherDepartment"><small>信息发布部门</small><strong>{{ detail.publisherDepartment }}</strong></div>
          <div v-if="detail.claimDeadline"><small>认领期限</small><strong>{{ formatDate(detail.claimDeadline, true) }}</strong></div>
          <div v-if="detail.remark"><small>备注</small><strong>{{ detail.remark }}</strong></div>
          <div><small>信息发布日期</small><strong>{{ formatDate(detail.publishedAt, true) }}</strong></div>
        </div>
        <p v-if="detail.description" class="description">{{ detail.description }}</p>
        <el-alert v-if="!canViewRawDetail" title="联系方式已保护" description="请通过站内认领表单描述物品特征或持有凭据。发布者核验通过后，再按双方留下的联系方式完成交接。" type="info" :closable="false" show-icon />
        <div v-else-if="detail.contact" class="private-contact"><small>仅发布者和失物招领管理员可见的原始联系方式</small><strong>{{ detail.contact }}</strong></div>
        <div class="detail-actions">
          <el-button v-if="detail.status === 'active' && !detail.mine" type="primary" @click="openClaim">{{ detail.kind === 'found' ? '这是我的，提交认领' : '我找到了，联系失主' }}</el-button>
          <el-button v-if="canDirectMessageDetail" plain @click="openDirectChat">私聊发布者</el-button>
          <el-button v-if="detail.mine && detail.status === 'active'" type="success" plain @click="setItemStatus('claimed')">标记已认领</el-button>
          <el-button v-if="detail.mine && detail.status === 'active'" plain @click="setItemStatus('closed')">关闭信息</el-button>
          <el-button v-if="detail.mine && detail.status !== 'active'" plain @click="setItemStatus('active')">重新开放</el-button>
          <el-button @click="router.push(`/forum/topic/${detail.topicId}`)">去论坛讨论（{{ detail.topic.replyCount }}）</el-button>
        </div>
        <section v-if="detail.myClaim" class="my-claim"><h3>我的认领申请</h3><el-tag :type="claimTagType(detail.myClaim.status)">{{ claimStatusText(detail.myClaim.status) }}</el-tag><p>{{ detail.myClaim.message }}</p><el-button v-if="detail.myClaim.status === 'pending'" text type="danger" @click="withdrawClaim(detail.myClaim.id)">撤回申请</el-button></section>
        <section v-if="canViewRawDetail && detail.claims?.length" class="claims"><h3>认领申请</h3><article v-for="claim in detail.claims" :key="claim.id"><div><strong>{{ claim.claimant?.nickname || '认领同学' }}</strong><el-tag size="small" :type="claimTagType(claim.status)">{{ claimStatusText(claim.status) }}</el-tag></div><p>{{ claim.message }}</p><p v-if="claim.evidence"><b>核验线索：</b>{{ claim.evidence }}</p><p class="claim-contact"><b>联系方式：</b>{{ claim.contact }}</p><footer v-if="claim.status === 'pending'"><el-button size="small" type="success" @click="resolveClaim(claim.id, 'accepted')">核验通过</el-button><el-button size="small" @click="resolveClaim(claim.id, 'rejected')">不匹配</el-button></footer></article></section>
      </div>
      <div v-else class="detail detail-skeleton" aria-live="polite">
        <el-skeleton :rows="7" animated />
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
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowRight, Clock, Filter, Loading, Location, Plus, Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import dayjs from "dayjs";
import { lostFoundApi, type LostFoundClaim, type LostFoundClaimStatus, type LostFoundItem, type LostFoundKind, type LostFoundStatus } from "@/api/lostFound";
import { uploadApi } from "@/api/topic";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { useAuthStore } from "@/stores/auth";
import { normalizeImageUploadError, prepareForumImageUpload } from "@/utils/imageUpload";
import { openImageGallery } from "@/utils/imageViewer";
import { useMobileLayout } from "@/utils/mobileLayout";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const isMobileLayout = useMobileLayout();
const items = ref<LostFoundItem[]>([]);
const campuses = ref<string[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = 18;
const total = ref(0);
const mobileFiltersOpen = ref(false);
const campusOptions = ["江宁校区", "玄武门校区"] as const;
type CampusOption = typeof campusOptions[number];
const filters = reactive<{ q: string; kind: string; campus: string; location: string; dates: string[]; status: string }>({ q: "", kind: "", campus: "", location: "", dates: [], status: "" });
const publishOpen = ref(false);
const submitting = ref(false);
const uploading = ref(false);
const uploadProgress = ref(0);
const publishForm = reactive({ kind: "found" as LostFoundKind, itemName: "", description: "", campus: "江宁校区" as CampusOption, location: "", storageLocation: "", happenedAt: "", contact: "", images: [] as string[] });
const detailOpen = ref(false);
const detailLoading = ref(false);
const detail = ref<LostFoundItem | null>(null);
const canViewRawDetail = computed(() => Boolean(detail.value && (detail.value.mine || auth.isLostFoundAdmin)));
const canDirectMessageDetail = computed(() => Boolean(
  detail.value
  && !detail.value.mine
  && detail.value.publisher.role !== "bot",
));
const mobileFilterCount = computed(() => [
  filters.campus,
  filters.location,
  filters.status,
  filters.dates.length ? "dates" : "",
].filter(Boolean).length);
const detailCache = new Map<number, LostFoundItem>();
const detailPrefetching = new Set<number>();
let detailRequestVersion = 0;
const claimOpen = ref(false);
const claimSubmitting = ref(false);
const claimForm = reactive({ message: "", evidence: "", contact: "" });
const mineOpen = ref(false);
const mineTab = ref("published");
const mine = reactive<{ published: LostFoundItem[]; claims: LostFoundClaim[] }>({ published: [], claims: [] });

onMounted(async () => {
  await Promise.all([loadItems(), loadMeta()]);
  const itemId = Number(route.query.item || 0);
  if (itemId) {
    await openDetail(itemId);
    if (route.query.action === "claim" && detail.value?.status === "active" && !detail.value.mine) openClaim();
  }
});

async function loadMeta() { try { campuses.value = (await lostFoundApi.meta({ suppressErrorMessage: true })).campuses; } catch { campuses.value = []; } }
async function loadItems() { loading.value = true; try { const result = await lostFoundApi.items({ q: filters.q || undefined, kind: filters.kind || undefined, campus: filters.campus || undefined, location: filters.location || undefined, status: filters.status || undefined, from: filters.dates?.[0], to: filters.dates?.[1] ? `${filters.dates[1]}T23:59:59` : undefined, page: page.value, size: pageSize }, { suppressErrorMessage: true }); items.value = result.list; total.value = result.total; } catch { items.value = []; total.value = 0; } finally { loading.value = false; } }
function applyFilters() { page.value = 1; void loadItems(); }
function resetMobileFilters() { Object.assign(filters, { campus: "", location: "", dates: [], status: "" }); mobileFiltersOpen.value = false; applyFilters(); }
function ensureLogin() { if (auth.isLoggedIn) return true; router.push({ name: "login", query: { redirect: route.fullPath } }); return false; }
function openPublish(kind: LostFoundKind) { if (!ensureLogin()) return; const campus = campusOptions.includes(filters.campus as CampusOption) ? filters.campus as CampusOption : "江宁校区"; Object.assign(publishForm, { kind, itemName: "", description: "", campus, location: "", storageLocation: "", happenedAt: dayjs().format("YYYY-MM-DDTHH:mm:ss"), contact: "", images: [] }); publishOpen.value = true; }
function openPublishImages(index: number) { openImageGallery(publishForm.images.map((src, imageIndex) => ({ src, title: `物品图片 ${imageIndex + 1}` })), index, { className: "cpu-lost-found-image-viewer" }); }
function openLostFoundImages(index: number) { if (!detail.value) return; openImageGallery(detail.value.images.map((image) => ({ src: image.url, title: detail.value?.itemName || "失物招领图片" })), index, { className: "cpu-lost-found-image-viewer" }); }

async function uploadImages(event: Event) { const input = event.target as HTMLInputElement; const files = Array.from(input.files || []).slice(0, 6 - publishForm.images.length); if (!files.length) return; uploading.value = true; try { for (let i = 0; i < files.length; i++) { const prepared = await prepareForumImageUpload(files[i]); const result = await uploadApi.media(prepared.blob, prepared.fileName, { onProgress: (state) => { uploadProgress.value = Math.round(((i + state.percent / 100) / files.length) * 100); } }); publishForm.images.push(result.url); } } catch (error) { ElMessage.error(normalizeImageUploadError(error, "图片上传失败，请稍后重试")); } finally { uploading.value = false; uploadProgress.value = 0; input.value = ""; } }
function validPublish() { if (publishForm.itemName.trim().length < 2) return ElMessage.warning("请填写物品名称"), false; if (!publishForm.campus.trim()) return ElMessage.warning("请填写校区"), false; if (publishForm.location.trim().length < 2) return ElMessage.warning("请填写具体地点"), false; if (publishForm.kind === "found" && publishForm.storageLocation.trim().length < 2) return ElMessage.warning("请填写物品放到哪里了"), false; if (!publishForm.happenedAt) return ElMessage.warning("请选择时间"), false; if (publishForm.contact.trim().length < 2) return ElMessage.warning("请填写联系方式"), false; return true; }
async function submitItem() { if (!validPublish() || submitting.value) return; submitting.value = true; try { const item = await lostFoundApi.create({ ...publishForm }); publishOpen.value = false; ElMessage.success(item.status === "reviewing" ? "已提交审核，通过后会公开展示" : "已发布，并同步到论坛讨论区"); await Promise.all([loadItems(), loadMeta()]); await openDetail(item.id); } finally { submitting.value = false; } }
async function prefetchDetail(id: number) {
  if (detailCache.has(id) || detailPrefetching.has(id)) return;
  detailPrefetching.add(id);
  try { detailCache.set(id, await lostFoundApi.item(id, { suppressErrorMessage: true, suppressAuthMessage: true })); }
  catch { /* 预取失败不影响正常打开 */ }
  finally { detailPrefetching.delete(id); }
}
async function openDetail(source: LostFoundItem | number) {
  const id = typeof source === "number" ? source : source.id;
  const requestVersion = ++detailRequestVersion;
  // 列表卡片本身已经拥有公开详情，先用它渲染，抽屉不会出现空白等待状态。
  detail.value = typeof source === "number" ? (detailCache.get(id) || null) : source;
  detailOpen.value = true;
  router.replace({ query: { ...route.query, item: String(id) } }).catch(() => null);
  detailLoading.value = !detailCache.has(id);
  try {
    // 即使已有预取缓存也刷新一次，避免认领状态、图片审核状态等动态信息滞后。
    const loaded = await lostFoundApi.item(id, { suppressErrorMessage: true });
    detailCache.set(id, loaded);
    if (requestVersion === detailRequestVersion) detail.value = loaded;
  } catch {
    if (requestVersion === detailRequestVersion) {
      detailOpen.value = false;
      ElMessage.error("信息加载失败或已下架");
    }
  } finally {
    if (requestVersion === detailRequestVersion) detailLoading.value = false;
  }
}
function openClaim() { if (!ensureLogin()) return; Object.assign(claimForm, { message: "", evidence: "", contact: "" }); claimOpen.value = true; }
function openDirectChat() {
  if (!detail.value) return;
  const target = `/messages?tab=private&forumKind=topic&forumId=${detail.value.topicId}`;
  if (!auth.isLoggedIn) {
    router.push({ name: "login", query: { redirect: target } });
    return;
  }
  router.push(target);
}
async function submitClaim() { if (!detail.value || claimSubmitting.value) return; if (claimForm.message.trim().length < 5) return ElMessage.warning("请至少填写 5 个字的认领说明"); if (claimForm.contact.trim().length < 2) return ElMessage.warning("请填写联系方式"); claimSubmitting.value = true; try { await lostFoundApi.claim(detail.value.id, { ...claimForm }); claimOpen.value = false; ElMessage.success("认领信息已私下提交给发布者"); await openDetail(detail.value.id); } finally { claimSubmitting.value = false; } }
async function setItemStatus(status: "active" | "claimed" | "closed") { if (!detail.value) return; const label = status === "claimed" ? "标记为已认领" : status === "closed" ? "关闭" : "重新开放"; await ElMessageBox.confirm(`确认${label}这条信息？`, "更新状态", { type: "warning" }); await lostFoundApi.updateStatus(detail.value.id, status); ElMessage.success("状态已更新"); await Promise.all([openDetail(detail.value.id), loadItems()]); }
async function resolveClaim(id: number, status: "accepted" | "rejected") { if (!detail.value) return; if (status === "accepted") await ElMessageBox.confirm("通过后该信息会自动标记为已认领，其他待处理申请将关闭。请确认已核对关键特征。", "确认认领", { type: "warning" }); await lostFoundApi.updateClaim(id, status); ElMessage.success(status === "accepted" ? "已通过认领" : "已标记为不匹配"); await Promise.all([openDetail(detail.value.id), loadItems()]); }
async function withdrawClaim(id: number) { if (!detail.value) return; await lostFoundApi.updateClaim(id, "withdrawn"); ElMessage.success("已撤回申请"); await openDetail(detail.value.id); }
async function loadMine() { if (!auth.isLoggedIn) return; try { Object.assign(mine, await lostFoundApi.mine({ suppressErrorMessage: true })); } catch { Object.assign(mine, { published: [], claims: [] }); } }
function formatDate(value?: string | null, full = false) { return value ? dayjs(value).format(full ? "YYYY年M月D日 HH:mm" : "M月D日 HH:mm") : "时间待补充"; }
function statusText(status: LostFoundStatus) { return ({ reviewing: "审核中", active: "等待认领", claimed: "已认领", closed: "已关闭", hidden: "已下架" } as Record<LostFoundStatus, string>)[status]; }
function claimStatusText(status: LostFoundClaimStatus) { return ({ pending: "待核验", accepted: "已通过", rejected: "不匹配", withdrawn: "已撤回" } as Record<LostFoundClaimStatus, string>)[status]; }
function claimTagType(status: LostFoundClaimStatus) { return status === "accepted" ? "success" : status === "pending" ? "warning" : "info"; }
</script>

<style scoped>
.lost-found-page{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:18px}.hero{position:relative;min-height:280px;padding:42px 46px;border-radius:24px;overflow:hidden;color:#fff;background:linear-gradient(125deg,#087f70 0%,#13a38c 62%,#79cfb4 100%);box-shadow:0 20px 45px rgba(8,127,112,.22)}.hero::after{content:"";position:absolute;right:-70px;top:-110px;width:380px;height:380px;border-radius:88px;background:linear-gradient(135deg,rgba(255,255,255,.13),rgba(255,255,255,.02));transform:rotate(18deg)}.hero-copy{position:relative;z-index:2;max-width:680px}.eyebrow{font-size:12px;letter-spacing:.14em;opacity:.82}.hero h1{margin:12px 0 10px;font-size:46px;letter-spacing:-.04em}.hero p{max-width:620px;margin:0;line-height:1.8;color:rgba(255,255,255,.88)}.hero-actions{display:flex;gap:10px;margin-top:26px;flex-wrap:wrap}.hero-actions :deep(.el-button--primary){color:#087f70;background:#fff;border-color:#fff}.hero-actions :deep(.el-button.is-text){color:#fff}.hero-visual{position:absolute;z-index:1;right:44px;top:48px;width:250px;display:flex;flex-direction:column;align-items:center;gap:8px}.visual-card{width:220px;padding:14px 16px;border:1px solid rgba(255,255,255,.28);border-radius:16px;background:rgba(255,255,255,.13);box-shadow:0 12px 28px rgba(6,78,68,.12);backdrop-filter:blur(9px)}.visual-card strong,.visual-card small{display:flex;align-items:center}.visual-card strong{gap:7px;margin:3px 0 5px;font-size:14px}.visual-card small{color:rgba(255,255,255,.76);font-size:10px}.visual-kicker{font-size:8px;font-weight:700;letter-spacing:.18em;opacity:.72}.found-card{transform:translateX(-18px)}.lost-card{transform:translateX(18px)}.visual-link{width:120px;display:flex;align-items:center;gap:9px;color:rgba(255,255,255,.84)}.visual-link span{height:1px;flex:1;background:rgba(255,255,255,.36)}.filter-card{padding:16px 18px}.quick-types{display:flex;gap:8px;margin-bottom:14px}.quick-types button{padding:8px 15px;border:0;border-radius:999px;color:var(--cpu-text-secondary);background:var(--cpu-surface-subtle);cursor:pointer}.quick-types button.active{color:#fff;background:var(--cpu-primary)}.filters{display:grid;grid-template-columns:1.5fr .9fr 1fr 1.35fr .8fr auto;gap:10px}.list-head{display:flex;align-items:center;justify-content:space-between}.list-head strong{font-size:22px;color:var(--cpu-primary)}.list-head small{margin-left:12px;color:var(--cpu-text-muted)}.items-grid{min-height:300px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.items-grid>.el-empty{grid-column:1/-1}.item-card{overflow:hidden;border:1px solid var(--cpu-border-soft);border-radius:16px;background:var(--cpu-card);box-shadow:var(--cpu-shadow-sm);cursor:pointer;transition:.2s ease}.item-card:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--cpu-primary) 45%,var(--cpu-border-soft));box-shadow:0 14px 30px rgba(15,23,42,.1)}.item-card.claimed{opacity:.66}.item-card.pinned{border-color:rgba(225,82,65,.4)}.cover{position:relative;height:190px;overflow:hidden;background:linear-gradient(135deg,#dff8ee,#eef7f5)}.cover img{width:100%;height:100%;object-fit:cover}.cover-placeholder{height:100%;display:grid;place-items:center;color:#0f8f7b;font:700 70px/1 serif}.kind,.pin{position:absolute;top:12px;padding:5px 10px;border-radius:999px;color:#fff;font-size:11px;font-weight:700;backdrop-filter:blur(8px)}.kind{left:12px}.kind.found{background:rgba(8,127,112,.88)}.kind.lost{background:rgba(217,119,6,.9)}.pin{right:12px;background:rgba(220,38,38,.86)}.claimed-mark{position:absolute;right:12px;bottom:12px;padding:8px 13px;border-radius:8px;color:#fff;background:rgba(30,41,59,.82);font-weight:700}.card-body{padding:16px}.card-body h2{margin:0 0 8px;font-size:19px}.card-body>p{height:42px;margin:0 0 12px;overflow:hidden;color:var(--cpu-text-secondary);font-size:13px;line-height:1.65}.facts{display:flex;flex-direction:column;gap:7px;color:var(--cpu-text-secondary);font-size:12px}.facts span{display:flex;align-items:center;gap:6px}.card-body footer{display:flex;justify-content:space-between;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--cpu-border-soft);color:var(--cpu-text-muted);font-size:11px}.el-pagination{align-self:center}.two-cols,.three-cols{display:grid;gap:14px}.two-cols{grid-template-columns:1fr 1.4fr}.three-cols{grid-template-columns:1fr 1.15fr 1.2fr}.two-cols>*,.three-cols>*{min-width:0}.choice-tabs{width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px;padding:3px;border-radius:9px;background:var(--cpu-surface-subtle)}.choice-tabs button{min-width:0;padding:7px 8px;border:0;border-radius:7px;color:var(--cpu-text-secondary);background:transparent;font-size:13px;white-space:nowrap;cursor:pointer;transition:.16s}.choice-tabs button.active{color:#fff;background:var(--cpu-primary);box-shadow:0 3px 8px color-mix(in srgb,var(--cpu-primary) 24%,transparent)}.campus-tabs button{font-size:12px}.field-note{margin:5px 0 0;color:var(--cpu-text-muted);font-size:11px}.image-grid{width:100%;display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.image-cell,.upload-cell{position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:var(--cpu-surface-subtle)}.image-cell img{width:100%;height:100%;object-fit:cover}.image-cell button{position:absolute;right:4px;top:4px;width:23px;height:23px;border:0;border-radius:50%;color:#fff;background:rgba(15,23,42,.7);cursor:pointer}.upload-cell{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:5px;border:1px dashed var(--cpu-border);color:var(--cpu-text-secondary);cursor:pointer}.upload-cell input{display:none}.upload-cell span{font-size:10px}.drawer-title{display:flex;flex-direction:column;gap:3px}.drawer-title span{color:var(--cpu-primary);font-size:11px}.drawer-title strong{font-size:20px}.detail{padding:0 6px 30px}.detail :deep(.el-carousel__item){border-radius:14px;background:var(--cpu-surface-subtle)}.detail :deep(.el-carousel__item img){width:100%;height:100%;object-fit:contain}.detail-tags{display:flex;gap:7px;margin-top:16px}.detail h2{margin:12px 0 16px;font-size:28px}.detail dl{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.detail dl div{padding:12px;border-radius:10px;background:var(--cpu-surface-subtle)}.detail dt{color:var(--cpu-text-muted);font-size:10px}.detail dd{margin:5px 0 0;font-size:13px}.description{padding:16px 0;white-space:pre-wrap;line-height:1.8}.private-contact{display:flex;flex-direction:column;gap:5px;padding:13px;border-radius:10px;background:rgba(8,127,112,.09)}.private-contact small{color:var(--cpu-text-muted)}.detail-actions{display:flex;gap:8px;margin:18px 0;flex-wrap:wrap}.claims,.my-claim{margin-top:22px;padding-top:18px;border-top:1px solid var(--cpu-border-soft)}.claims h3,.my-claim h3{margin:0 0 12px}.claims article{padding:14px;margin-bottom:10px;border:1px solid var(--cpu-border-soft);border-radius:12px}.claims article>div{display:flex;justify-content:space-between}.claims p,.my-claim p{color:var(--cpu-text-secondary);font-size:13px;line-height:1.7}.claim-contact{padding:8px;border-radius:8px;background:var(--cpu-surface-subtle)}.claim-form{margin-top:16px}.mine-list{display:flex;flex-direction:column;gap:8px}.mine-list button{display:grid;grid-template-columns:56px 1fr auto;align-items:center;gap:10px;padding:13px;border:1px solid var(--cpu-border-soft);border-radius:10px;color:var(--cpu-text);background:var(--cpu-card);text-align:left;cursor:pointer}.mine-list button span{color:var(--cpu-primary);font-size:11px}.mine-list button small{color:var(--cpu-text-muted)}
.hero{min-height:0;padding:22px 28px;border-radius:16px;background:linear-gradient(120deg,#087f70,#10a38d);box-shadow:0 10px 26px rgba(8,127,112,.16)}.hero::after{display:none}.hero-copy{max-width:none;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"eyebrow actions" "title actions" "description actions";align-items:center;column-gap:28px}.eyebrow{grid-area:eyebrow;font-size:10px}.hero h1{grid-area:title;margin:4px 0;font-size:30px;letter-spacing:-.03em}.hero p{grid-area:description;max-width:680px;font-size:13px;line-height:1.6}.hero-actions{grid-area:actions;margin:0;justify-content:flex-end}.hero-actions :deep(.el-button){min-width:96px;margin:0;color:#087f70;background:#fff;border-color:#fff;border-radius:8px;font-weight:600}.hero-actions :deep(.el-button:hover),.hero-actions :deep(.el-button:focus){color:#066c60;background:#eefbf7;border-color:#eefbf7}.campus-tabs button{padding:8px 16px;font-size:13px}.location-time-row{grid-template-columns:1fr 1fr}
@media(max-width:980px){.filters{grid-template-columns:1fr 1fr 1fr}.items-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hero-copy{max-width:none}}
@media(max-width:820px){.hero-copy{grid-template-columns:1fr;grid-template-areas:"eyebrow" "title" "description" "actions"}.hero-actions{justify-content:flex-start;margin-top:14px}}
@media(max-width:650px){.lost-found-page{gap:12px}.hero{min-height:auto;padding:20px;border-radius:14px}.hero h1{font-size:28px}.hero-actions{display:grid;grid-template-columns:1fr 1fr}.hero-actions .el-button{margin:0}.hero-actions .el-button:last-child{grid-column:1/-1}.filter-card{padding:12px}.filters{grid-template-columns:1fr 1fr}.filters>*:first-child,.filters :deep(.el-date-editor){grid-column:1/-1;width:100%}.list-head small{display:block;margin:2px 0 0}.items-grid{grid-template-columns:1fr}.cover{height:210px}.two-cols,.three-cols{grid-template-columns:1fr}.image-grid{grid-template-columns:repeat(3,1fr)}.detail dl{grid-template-columns:1fr}.detail h2{font-size:24px}.detail-actions .el-button{margin:0;flex:1 1 calc(50% - 8px)}.mine-list button{grid-template-columns:48px 1fr}.mine-list button small{grid-column:2}}
.import-details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:14px}.import-details div{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:8px;background:var(--cpu-surface-subtle)}.import-details small{color:var(--cpu-text-muted);font-size:10px}.import-details strong{font-size:12px;line-height:1.5;white-space:pre-wrap}
@media(max-width:600px){.import-details{grid-template-columns:1fr}}
.image-cell img,.detail :deep(.el-carousel__item img){cursor:zoom-in}
</style>

<style scoped>
.mobile-lost-intro,
.mobile-lost-search,
.mobile-lost-feed {
  border: 1px solid var(--cpu-border-soft);
  background: var(--cpu-card);
}

.mobile-lost-intro {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  gap: 18px;
  padding: 18px;
  border-radius: 15px;
  box-shadow: var(--cpu-shadow-sm);
}

.mobile-lost-heading {
  align-self: center;
}

.mobile-lost-kicker {
  color: var(--cpu-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .12em;
}

.mobile-lost-heading h1 {
  margin: 4px 0 5px;
  color: var(--cpu-text);
  font-size: 25px;
  letter-spacing: -.03em;
}

.mobile-lost-heading p {
  max-width: 500px;
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.mobile-lost-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.mobile-lost-actions > button {
  display: flex;
  min-width: 0;
  min-height: 64px;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 11px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.mobile-lost-actions > button:hover,
.mobile-lost-actions > button:focus-visible {
  border-color: color-mix(in srgb, var(--cpu-primary) 42%, var(--cpu-border-soft));
  outline: 0;
}

.mobile-action-icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--cpu-primary) 13%, var(--cpu-card));
  color: var(--cpu-primary);
  font-size: 18px;
}

.mobile-action-icon.is-lost {
  background: color-mix(in srgb, #f59e0b 13%, var(--cpu-card));
  color: #b45309;
}

.mobile-lost-actions b,
.mobile-lost-actions small {
  display: block;
}

.mobile-lost-actions b {
  font-size: 13px;
}

.mobile-lost-actions small {
  margin-top: 2px;
  color: var(--cpu-text-muted);
  font-size: 10px;
}

.mobile-lost-actions > .mobile-mine-action {
  grid-column: 1 / -1;
  min-height: 36px;
  justify-content: center;
  padding: 7px 10px;
  background: transparent;
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

.mobile-lost-search {
  padding: 11px;
  border-radius: 14px;
  box-shadow: var(--cpu-shadow-sm);
}

.mobile-search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px;
  gap: 7px;
}

.mobile-search-row :deep(.el-input__wrapper) {
  min-height: 42px;
  border-radius: 10px;
  background: var(--cpu-surface-soft);
  box-shadow: 0 0 0 1px var(--cpu-border-soft) inset;
}

.mobile-filter-button {
  position: relative;
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-primary);
  cursor: pointer;
  font-size: 17px;
}

.mobile-filter-button span {
  position: absolute;
  top: -5px;
  right: -5px;
  display: grid;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  place-items: center;
  border: 2px solid var(--cpu-card);
  border-radius: 999px;
  background: var(--cpu-primary);
  color: #fff;
  font-size: 9px;
  font-weight: 800;
}

.mobile-kind-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
  margin-top: 8px;
  padding: 4px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 11px;
  background: var(--cpu-surface-soft);
}

.mobile-kind-tabs button {
  min-height: 34px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}

.mobile-kind-tabs button.active {
  background: var(--cpu-primary);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--cpu-primary) 20%, transparent);
  color: #fff;
}

.mobile-lost-feed {
  padding: 13px;
  border-radius: 15px;
  background: color-mix(in srgb, var(--cpu-surface-soft) 58%, var(--cpu-card));
}

.mobile-list-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px 10px;
}

.mobile-list-head h2 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 18px;
}

.mobile-list-head p {
  margin: 3px 0 0;
  color: var(--cpu-text-muted);
  font-size: 10px;
}

.mobile-list-head > button {
  padding: 5px 2px;
  border: 0;
  background: transparent;
  color: var(--cpu-primary);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}

.mobile-list-head > button:disabled {
  opacity: .55;
}

.mobile-item-list {
  display: flex;
  min-height: 180px;
  flex-direction: column;
  gap: 8px;
}

.mobile-item-card {
  padding: 13px 12px 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 11px;
  background: var(--cpu-card);
  color: var(--cpu-text);
  cursor: pointer;
}

.mobile-item-card:focus-visible {
  border-color: var(--cpu-primary);
  outline: 2px solid color-mix(in srgb, var(--cpu-primary) 32%, transparent);
  outline-offset: 1px;
}

.mobile-item-card.claimed {
  opacity: .72;
}

.mobile-item-card.pinned {
  border-color: color-mix(in srgb, #ef4444 28%, var(--cpu-border-soft));
}

.mobile-item-author {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.mobile-item-author-copy {
  min-width: 0;
  flex: 1;
}

.mobile-item-author b,
.mobile-item-author small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-item-author b {
  font-size: 13px;
  font-weight: 650;
}

.mobile-item-author small {
  margin-top: 2px;
  color: var(--cpu-text-muted);
  font-size: 10px;
}

.mobile-item-author em {
  flex: 0 0 auto;
  padding: 3px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--cpu-primary) 11%, var(--cpu-card));
  color: var(--cpu-primary);
  font-size: 10px;
  font-style: normal;
  font-weight: 750;
}

.mobile-item-author em.lost {
  background: color-mix(in srgb, #f59e0b 12%, var(--cpu-card));
  color: #b45309;
}

.mobile-item-content {
  display: grid;
  min-width: 0;
  gap: 10px;
  margin-top: 11px;
}

.mobile-item-content.has-cover {
  grid-template-columns: minmax(0, 1fr) 82px;
}

.mobile-item-copy {
  min-width: 0;
}

.mobile-item-copy h3 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 15px;
  font-weight: 650;
  line-height: 1.45;
}

.mobile-item-copy > p {
  display: -webkit-box;
  margin: 5px 0 0;
  overflow: hidden;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.mobile-item-content > img {
  width: 82px;
  height: 82px;
  border-radius: 9px;
  background: var(--cpu-surface-subtle);
  object-fit: cover;
}

.mobile-item-facts {
  display: grid;
  gap: 4px;
  margin-top: 8px;
  color: var(--cpu-text-muted);
  font-size: 10px;
}

.mobile-item-facts span {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-item-card footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--cpu-border-soft);
  color: var(--cpu-text-muted);
  font-size: 10px;
}

.mobile-item-card footer > .el-icon {
  flex: 0 0 auto;
}

.mobile-pin,
.mobile-status {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 999px;
  font-weight: 700;
}

.mobile-pin {
  background: color-mix(in srgb, #ef4444 10%, var(--cpu-card));
  color: #dc2626;
}

.mobile-status {
  background: color-mix(in srgb, var(--cpu-primary) 10%, var(--cpu-card));
  color: var(--cpu-primary);
}

.mobile-status.claimed,
.mobile-status.closed,
.mobile-status.hidden {
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-muted);
}

.mobile-item-stats {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-filter-form :deep(.el-select),
.mobile-filter-form :deep(.el-date-editor) {
  width: 100%;
}

.mobile-filter-actions {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 8px;
}

.mobile-filter-actions :deep(.el-button) {
  width: 100%;
  margin: 0;
}

@media (max-width: 768px) {
  .lost-found-page {
    max-width: 860px;
    gap: 10px;
  }

  .mobile-lost-intro {
    grid-template-columns: 1fr;
    gap: 12px;
    padding: 13px;
    border-radius: 13px;
  }

  .mobile-lost-heading h1 {
    font-size: 22px;
  }

  .mobile-lost-search {
    padding: 9px;
    border-radius: 13px;
  }

  .mobile-lost-feed {
    margin-inline: -4px;
    padding: 10px 8px;
    border-radius: 12px;
  }
}
</style>
