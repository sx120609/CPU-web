<template>
  <div class="thx-page" :class="{ 'thx-page--calm': calm }">
    <ThanksFireworks ref="fireworksRef" class="thx-fireworks" />

    <header class="thx-nav">
      <div class="thx-nav-inner">
        <button class="thx-nav-back" type="button" aria-label="返回" @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
        </button>
        <strong class="thx-nav-title">致谢</strong>
        <nav class="thx-nav-links" aria-label="章节">
          <a
            v-for="section in sections"
            :key="section.id"
            :href="`#${section.id}`"
            :class="{ 'is-on': activeSection === section.id }"
            @click.prevent="jumpTo(section.id)"
          >{{ section.label }}</a>
        </nav>
        <button class="thx-pill thx-pill--small" type="button" @click="shareSite">分享</button>
      </div>
    </header>

    <!-- 开场 -->
    <section id="thx-hero" class="thx-hero thx-tone-dark" data-thx-section>
      <div ref="heroBodyEl" class="thx-hero-body">
        <p class="thx-hero-eyebrow thx-rise">{{ thanksHero.eyebrow }}</p>
        <h1 class="thx-hero-title">{{ thanksHero.title }}</h1>
        <p class="thx-hero-lead thx-rise" style="--thx-delay: 240ms">{{ thanksHero.lead }}</p>
        <div class="thx-actions thx-rise" style="--thx-delay: 380ms">
          <button class="thx-pill" type="button" @click="shareSite">帮我们分享</button>
          <a class="thx-link" href="#thx-lead" @click.prevent="jumpTo('thx-lead')">
            看看都有谁<el-icon><ArrowRight /></el-icon>
          </a>
        </div>
      </div>
    </section>

    <!-- 实时数字 -->
    <section class="thx-band thx-tone-dark">
      <ul v-reveal class="thx-figures">
        <li v-for="figure in figures" :key="figure.key">
          <b>{{ formatCount(shownFigures[figure.key] ?? 0) }}</b>
          <span>{{ figure.label }}</span>
        </li>
      </ul>
      <p v-reveal class="thx-live"><i></i>数字实时更新</p>
    </section>

    <!-- 主创 -->
    <section id="thx-lead" class="thx-lead thx-tone-dark" data-thx-section>
      <p v-reveal class="thx-lead-role">{{ thanksLead.role }}</p>
      <h2 v-reveal="1" class="thx-lead-name">{{ thanksLead.name }}</h2>
      <p v-reveal="2" class="thx-lead-aliases">{{ thanksLead.aliases.join(" · ") }}</p>
      <p v-reveal="3" class="thx-lead-note">{{ thanksLead.note }}</p>
    </section>

    <!-- 伙伴 -->
    <section id="thx-people" class="thx-section thx-tone-light" data-thx-section>
      <div class="thx-inner">
        <header v-reveal class="thx-head">
          <h2>还有他们。</h2>
          <p>写代码的，出钱出力的，出主意的。</p>
        </header>
        <ul class="thx-bento">
          <li v-for="(person, index) in thanksPeople" :key="person.name" v-reveal="index % 2" :style="{ '--thx-span': person.span }">
            <article class="thx-tile" :data-tint="person.tint">
              <el-icon class="thx-tile-icon"><component :is="ICONS[person.icon]" /></el-icon>
              <p class="thx-tile-role">{{ person.role }}</p>
              <h3>{{ person.name }}<small v-if="person.alias">{{ person.alias }}</small></h3>
              <p class="thx-tile-note">{{ person.note }}</p>
            </article>
          </li>
        </ul>
      </div>
    </section>

    <!-- 赞助榜：iOS / 鸿蒙原生壳内不展示 -->
    <section v-if="showSponsors" id="thx-sponsors" class="thx-section thx-tone-dark" data-thx-section>
      <div class="thx-inner">
        <header v-reveal class="thx-head">
          <h2>为服务器续命的人。</h2>
          <p>每一笔赞助都变成了带宽、存储和又一个月的在线。</p>
        </header>
        <template v-if="ranking.length">
          <div v-reveal class="thx-total">
            <b>¥{{ formatMoney(totalAmount) }}</b>
            <span><i></i>来自 {{ formatCount(sponsorTotal) }} 次赞助 · 按累计金额实时排序</span>
          </div>
          <div v-reveal class="thx-board">
            <TransitionGroup tag="ol" name="thx-rank">
              <li v-for="(entry, index) in shownRanking" :key="entry.key" :class="{ 'is-top': index < 3 }">
                <span class="thx-board-rank">{{ index + 1 }}</span>
                <UserAvatar
                  :size="index < 3 ? 40 : 32"
                  :src="entry.user?.avatar"
                  :name="entry.user?.nickname ?? '匿名同学'"
                  :seed="entry.user?.id ?? entry.key"
                  alt="赞助者头像"
                />
                <span class="thx-board-name">{{ entry.user?.nickname || "匿名同学" }}</span>
                <span class="thx-board-count">{{ entry.orderCount }} 次</span>
                <b class="thx-board-amount" :class="{ 'is-flash': flashKeys.has(entry.key) }">¥{{ entry.amount }}</b>
              </li>
            </TransitionGroup>
          </div>
          <p v-reveal class="thx-anon">
            <template v-if="anonymousCount">榜上有 {{ anonymousCount }} 位同学选择了匿名，</template>还有一些支持者没有留名、没有上榜。名字不在这里，感谢是一样的。
          </p>
        </template>
        <p v-else v-reveal class="thx-empty">鸣谢墙上的名字会出现在这里。</p>
        <div v-reveal class="thx-actions thx-actions--start">
          <button v-if="ranking.length > BOARD_COLLAPSED" class="thx-link" type="button" @click="boardExpanded = !boardExpanded">
            {{ boardExpanded ? "收起" : `显示全部 ${ranking.length} 位` }}
          </button>
          <router-link class="thx-link" to="/sponsor">查看鸣谢墙<el-icon><ArrowRight /></el-icon></router-link>
        </div>
      </div>
    </section>

    <!-- 工具与开源 -->
    <section id="thx-tools" class="thx-section thx-tone-white" data-thx-section>
      <div class="thx-inner">
        <header v-reveal class="thx-head">
          <h2>用它们做出来的。</h2>
          <p>开发工具，和一路用到的开源项目。</p>
        </header>
        <ul class="thx-tools">
          <li v-for="(tool, index) in thanksTools" :key="tool.name" v-reveal="index">
            <span>{{ tool.note }}</span>
            <b>{{ tool.name }}</b>
          </li>
        </ul>
        <p v-reveal class="thx-subhead">开源项目</p>
        <ul v-reveal class="thx-stack">
          <li v-for="project in thanksOpenSource" :key="project.name">
            <component
              :is="project.url ? 'a' : 'div'"
              class="thx-chip"
              :href="project.url"
              :target="project.url ? '_blank' : undefined"
              :rel="project.url ? 'noopener noreferrer' : undefined"
            >
              <b>{{ project.name }}</b>
              <span>{{ project.note }}</span>
            </component>
          </li>
        </ul>
      </div>
    </section>

    <!-- 时间线 -->
    <section id="thx-road" class="thx-section thx-tone-light" data-thx-section>
      <div class="thx-inner thx-inner--narrow">
        <header v-reveal class="thx-head">
          <h2>一路走来。</h2>
        </header>
        <ol class="thx-road">
          <li v-for="(step, index) in thanksMilestones" :key="index" v-reveal>
            <time>{{ step.date }}</time>
            <div>
              <h3>{{ step.title }}</h3>
              <p v-if="step.note">{{ step.note }}</p>
            </div>
          </li>
        </ol>
        <p class="thx-footnote">节点整理自项目的提交记录与各端的发布记录。</p>
      </div>
    </section>

    <!-- 片尾 -->
    <section id="thx-you" class="thx-finale thx-tone-dark" data-thx-section>
      <h2 v-reveal class="thx-you">还有你，<em>{{ auth.nickname || thanksFinale.fallbackName }}</em>。</h2>
      <p v-reveal="1" class="thx-finale-body">{{ thanksFinale.body }}</p>
      <div v-reveal="2" class="thx-actions">
        <button class="thx-pill" type="button" @click="shareSite">帮我们分享</button>
        <button class="thx-pill thx-pill--ghost" type="button" @click="celebrate">放一束烟花</button>
      </div>
      <p class="thx-sign">{{ thanksFinale.sign }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, type Component, type Directive } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowLeft, ArrowRight, Briefcase, Calendar, Coin, Opportunity, School, Watch } from "@element-plus/icons-vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { paymentsApi, type SponsorRankingEntry } from "@/api/payments";
import { siteApi } from "@/api/site";
import { useAuthStore } from "@/stores/auth";
import { hidesNativeCommerce } from "@/utils/clientInfo";
import { copyText } from "@/utils/userGroup";
import ThanksFireworks from "./ThanksFireworks.vue";
import {
  thanksFinale,
  thanksHero,
  thanksLead,
  thanksMilestones,
  thanksOpenSource,
  thanksPeople,
  thanksShare,
  thanksTools,
  type ThanksIcon,
} from "./credits";

const ICONS: Record<ThanksIcon, Component> = {
  calendar: Calendar,
  watch: Watch,
  coin: Coin,
  school: School,
  briefcase: Briefcase,
  idea: Opportunity,
};
const REFRESH_MS = 20_000;
// CI 构建时从 GitHub 查到的提交数；没有就用 credits.ts 里手动维护的数
const COMMIT_COUNT = Number(import.meta.env.VITE_CPU_COMMIT_COUNT) || thanksHero.commitsFallback;
const BOARD_COLLAPSED = 10;

const router = useRouter();
const auth = useAuthStore();
const fireworksRef = ref<InstanceType<typeof ThanksFireworks> | null>(null);

const motionQuery = typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)") : undefined;
const calm = ref(Boolean(motionQuery?.matches));

function onMotionChange(event: MediaQueryListEvent) {
  calm.value = event.matches;
}

function goBack() {
  if (window.history.state?.back) router.back();
  else router.replace("/home");
}

function formatCount(value: number) {
  return value.toLocaleString("en-US");
}

/** "3260.00" → "3,260.00" */
function formatMoney(amount: string) {
  const [whole, cents = "00"] = amount.split(".");
  return `${formatCount(Number(whole) || 0)}.${cents}`;
}

// ---- 实时数据：社区数字和赞助榜，定时刷新 ----
const showSponsors = !hidesNativeCommerce();
const community = ref<{ users: number; topics: number; replies: number } | null>(null);
const ranking = ref<SponsorRankingEntry[]>([]);
const sponsorTotal = ref(0);
const totalAmount = ref("0.00");
const boardExpanded = ref(false);
const flashKeys = reactive(new Set<string>());
const anonymousCount = computed(() => ranking.value.filter((entry) => entry.anonymous).length);
const shownRanking = computed(() => (boardExpanded.value ? ranking.value : ranking.value.slice(0, BOARD_COLLAPSED)));
let refreshTimer = 0;
let flashTimer = 0;
let disposed = false;

async function loadCommunity() {
  try {
    community.value = await siteApi.communityStats();
  } catch {
    // 取不到时开场只显示天数
  }
}

async function loadRanking() {
  if (!showSponsors) return;
  try {
    const next = await paymentsApi.sponsorRanking({ suppressErrorMessage: true });
    if (disposed) return;
    if (!next.enabled) {
      ranking.value = [];
      return;
    }
    // 金额涨了的条目闪一下；首次加载不算
    if (ranking.value.length) {
      const before = new Map(ranking.value.map((entry) => [entry.key, entry.amountCents]));
      for (const entry of next.list) {
        if ((before.get(entry.key) ?? 0) < entry.amountCents) flashKeys.add(entry.key);
      }
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => flashKeys.clear(), 2400);
    }
    ranking.value = next.list;
    sponsorTotal.value = next.total;
    totalAmount.value = next.totalAmount;
  } catch {
    // 赞助榜取不到时这一节只显示占位文案
  }
}

function refresh() {
  if (document.hidden) return;
  void loadCommunity();
  void loadRanking();
}

// ---- 开场数字 ----
const figures = computed(() => {
  const days = Math.max(1, Math.floor((Date.now() - new Date(`${thanksHero.since}T00:00:00+08:00`).getTime()) / 86_400_000));
  const sponsored = showSponsors && sponsorTotal.value > 0;
  return [
    { key: "days", label: "天的陪伴", value: days },
    { key: "commits", label: "次代码提交", value: COMMIT_COUNT },
    ...(community.value ? [{ key: "users", label: "位同学", value: community.value.users }] : []),
    // 第四个数：能看赞助的地方显示赞助次数，否则显示帖子数
    ...(sponsored ? [{ key: "sponsors", label: "次赞助", value: sponsorTotal.value }] : []),
    ...(!sponsored && community.value ? [{ key: "posts", label: "篇帖子和回复", value: community.value.topics + community.value.replies }] : []),
  ];
});
const shownFigures = reactive<Record<string, number>>({});
let countRaf = 0;

function countUp() {
  cancelAnimationFrame(countRaf);
  const targets = figures.value;
  const from = Object.fromEntries(targets.map((figure) => [figure.key, shownFigures[figure.key] ?? 0]));
  if (calm.value) {
    for (const figure of targets) shownFigures[figure.key] = figure.value;
    return;
  }
  const startedAt = performance.now();
  const step = (now: number) => {
    const progress = Math.min((now - startedAt) / 1400, 1);
    const eased = 1 - (1 - progress) ** 4;
    for (const figure of targets) shownFigures[figure.key] = Math.round(from[figure.key] + (figure.value - from[figure.key]) * eased);
    if (progress < 1) countRaf = requestAnimationFrame(step);
  };
  countRaf = requestAnimationFrame(step);
}

watch(figures, countUp);

// ---- 章节导航 ----
const sections = [
  { id: "thx-lead", label: "主创" },
  { id: "thx-people", label: "伙伴" },
  ...(showSponsors ? [{ id: "thx-sponsors", label: "赞助" }] : []),
  { id: "thx-tools", label: "工具" },
  { id: "thx-road", label: "历程" },
];
const activeSection = ref("");
let sectionObserver: IntersectionObserver | null = null;

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: calm.value ? "auto" : "smooth", block: "start" });
}

// ---- 分享 ----
async function shareSite() {
  const url = new URL(thanksShare.path, window.location.origin).href;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: thanksShare.title, text: thanksShare.text, url });
      return;
    } catch (error) {
      // 用户自己关掉分享面板不算失败；其他情况退回复制
      if ((error as DOMException)?.name === "AbortError") return;
    }
  }
  try {
    await copyText(`${thanksShare.text} ${url}`);
    ElMessage.success("推荐语和链接已复制，去粘贴给朋友吧");
  } catch {
    ElMessage.error("复制失败，请手动复制地址栏里的链接");
  }
}

function celebrate() {
  fireworksRef.value?.celebrate();
}

// ---- 跟随滚动：开场随滚动淡出 ----
const heroBodyEl = ref<HTMLElement | null>(null);
let scrollRaf = 0;

function applyScroll() {
  scrollRaf = 0;
  const viewport = window.innerHeight;
  if (calm.value) {
    heroBodyEl.value?.style.removeProperty("--thx-p");
    return;
  }
  const heroProgress = Math.min(Math.max(window.scrollY / (viewport * 0.7), 0), 1);
  heroBodyEl.value?.style.setProperty("--thx-p", heroProgress.toFixed(3));
}

function onScroll() {
  if (!scrollRaf) scrollRaf = requestAnimationFrame(applyScroll);
}

// 子元素的指令先于本组件的 onMounted 执行，所以观察器按需创建
let revealObserver: IntersectionObserver | null = null;
function observeReveal(el: HTMLElement) {
  if (typeof IntersectionObserver === "undefined") {
    el.classList.add("is-in");
    return;
  }
  revealObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      revealObserver?.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  revealObserver.observe(el);
}

const vReveal: Directive<HTMLElement, number | undefined> = {
  mounted(el, binding) {
    el.classList.add("thx-reveal");
    if (binding.value) el.style.setProperty("--thx-delay", `${binding.value * 90}ms`);
    observeReveal(el);
  },
  unmounted(el) {
    revealObserver?.unobserve(el);
  },
};

onMounted(() => {
  motionQuery?.addEventListener?.("change", onMotionChange);
  countUp();
  refresh();
  refreshTimer = window.setInterval(refresh, REFRESH_MS);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  applyScroll();
  if (typeof IntersectionObserver !== "undefined") {
    sectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) activeSection.value = entry.target.id;
    }, { rootMargin: "-45% 0px -45% 0px" });
    document.querySelectorAll<HTMLElement>("[data-thx-section]").forEach((el) => sectionObserver?.observe(el));
  }
});

onBeforeUnmount(() => {
  disposed = true;
  motionQuery?.removeEventListener?.("change", onMotionChange);
  window.clearInterval(refreshTimer);
  window.clearTimeout(flashTimer);
  cancelAnimationFrame(countRaf);
  cancelAnimationFrame(scrollRaf);
  document.removeEventListener("visibilitychange", refresh);
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", onScroll);
  revealObserver?.disconnect();
  sectionObserver?.disconnect();
});
</script>

<style scoped>
/* 这一页按 Apple 产品页的路子排：黑、浅灰、白三种底色分段交替，不跟随站点深浅色。
   类名一律带 thx- 前缀，避开 index.scss 深色主题里对 .block / .panel / .title 等通用类名的强制样式。 */
.thx-page {
  position: relative;
  min-height: 100dvh;
  overflow-x: clip;
  color: #f5f5f7;
  background: #000;
  font-family: var(--cpu-font-sans);
  font-size: var(--cpu-fs-l);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* iOS 和鸿蒙壳的原生标签栏叠在 WebView 底部，高度由壳写进各自的变量；
   这一页不在 MainLayout 里，要自己在页尾让出这段。安卓的标签栏在 WebView 之外。 */
html[data-cpu-ios-next] .thx-page {
  --thx-bottom-clearance: var(--cpu-ios-bottom-clearance, 96px);
}

html[data-cpu-harmony-native] .thx-page {
  --thx-bottom-clearance: var(--cpu-harmony-bottom-clearance, 0px);
}

.thx-tone-dark {
  --thx-bg: #000;
  --thx-ink: #f5f5f7;
  --thx-dim: #86868b;
  --thx-card: #161617;
  --thx-card-hover: #1d1d1f;
  --thx-line: #2c2c2e;
  --thx-link: #2997ff;
}

.thx-tone-light {
  --thx-bg: #f5f5f7;
  --thx-ink: #1d1d1f;
  --thx-dim: #6e6e73;
  --thx-card: #fff;
  --thx-card-hover: #fff;
  --thx-line: #d2d2d7;
  --thx-link: #0066cc;
}

.thx-tone-white {
  --thx-bg: #fff;
  --thx-ink: #1d1d1f;
  --thx-dim: #6e6e73;
  --thx-card: #f5f5f7;
  --thx-card-hover: #ececf0;
  --thx-line: #d2d2d7;
  --thx-link: #0066cc;
}

.thx-tone-dark,
.thx-tone-light,
.thx-tone-white {
  color: var(--thx-ink);
  background: var(--thx-bg);
}

/* 重置写在 :where 里，优先级不压过后面的章节样式 */
.thx-page :where(ul, ol) {
  margin: 0;
  padding: 0;
  list-style: none;
}

.thx-page :where(h1, h2, h3, p) {
  margin: 0;
}

/* 站点深色主题会把所有标题强制成它自己的文字色；这里让标题跟随所在分段 */
.thx-page :is(h1, h2, h3) {
  color: inherit !important;
}

.thx-fireworks {
  position: fixed;
  inset: 0;
  z-index: 5;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* ---- 吸顶导航 ---- */
.thx-nav {
  position: sticky;
  top: 0;
  z-index: 6;
  padding-top: env(safe-area-inset-top, 0px);
  color: #f5f5f7;
  background: rgba(22, 22, 23, 0.8);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: saturate(180%) blur(20px);
}

.thx-nav-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 1012px;
  height: 48px;
  margin: 0 auto;
  padding: 0 16px 0 8px;
}

.thx-nav-back {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: inherit;
  background: none;
  font-size: var(--cpu-fs-xl);
  cursor: pointer;
}

.thx-nav-back:hover {
  background: rgba(255, 255, 255, 0.1);
}

.thx-nav-title {
  margin-right: auto;
  font-size: var(--cpu-fs-xl);
  font-weight: 600;
}

.thx-nav-links {
  display: flex;
  gap: 28px;
  margin-right: 12px;
  font-size: var(--cpu-fs-xs);
}

.thx-nav-links a {
  color: rgba(245, 245, 247, 0.72);
  text-decoration: none;
  transition: color 0.2s;
}

.thx-nav-links a:hover,
.thx-nav-links a.is-on {
  color: #fff;
}

/* ---- 按钮和链接 ---- */
.thx-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  padding: 0 22px;
  border: 1px solid #0071e3;
  border-radius: 980px;
  color: #fff;
  background: #0071e3;
  font: inherit;
  font-size: var(--cpu-fs-l);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, color 0.2s, transform 0.2s;
}

@media (hover: hover) {
  .thx-pill:hover {
    border-color: #0077ed;
    background: #0077ed;
  }
}

.thx-pill:active {
  transform: scale(0.97);
}

.thx-pill--small {
  height: 28px;
  padding: 0 12px;
  font-size: var(--cpu-fs-xs);
}

.thx-pill--ghost {
  border-color: var(--thx-link);
  color: var(--thx-link);
  background: none;
}

/* 触屏上 :hover 会在点过之后一直留着，描边按钮看起来就像被填满了 */
@media (hover: hover) {
  .thx-pill--ghost:hover {
    border-color: var(--thx-link);
    color: #fff;
    background: var(--thx-link);
  }
}

.thx-pill--ghost:active {
  background: color-mix(in srgb, var(--thx-link) 18%, transparent);
}

.thx-link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: 0;
  color: var(--thx-link);
  background: none;
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}

.thx-link:hover {
  text-decoration: underline;
}

.thx-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px 28px;
  margin-top: 32px;
}

.thx-actions--start {
  justify-content: flex-start;
}

/* ---- 入场 ---- */
.thx-reveal {
  opacity: 0;
  transform: translateY(28px);
  transition:
    opacity 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) var(--thx-delay, 0ms),
    transform 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) var(--thx-delay, 0ms);
}

.thx-reveal.is-in {
  opacity: 1;
  transform: none;
}

/* 首屏不等滚动观察器，挂载后直接入场 */
.thx-rise {
  animation: thx-rise 1s cubic-bezier(0.2, 0.7, 0.2, 1) var(--thx-delay, 0ms) both;
}

@keyframes thx-rise {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
}

@keyframes thx-title {
  from {
    opacity: 0;
    filter: blur(16px);
    transform: scale(1.16);
  }
}

/* ---- 开场 ---- */
.thx-hero {
  display: grid;
  place-items: center;
  min-height: calc(100dvh - 49px - env(safe-area-inset-top, 0px));
  padding: 48px 24px 72px;
  text-align: center;
}

/* --thx-p 是滚出首屏的进度（0–1），由脚本写入 */
.thx-hero-body {
  opacity: calc(1 - var(--thx-p, 0));
  transform: translateY(calc(var(--thx-p, 0) * -40px)) scale(calc(1 - var(--thx-p, 0) * 0.08));
  will-change: opacity, transform;
}

.thx-hero-eyebrow {
  font-size: clamp(18px, 2.4vw, 24px);
  font-weight: 600;
}

.thx-hero-title {
  padding-left: 0.04em;
  font-size: clamp(96px, 22vw, 240px);
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.1;
  animation: thx-title 1.4s cubic-bezier(0.2, 0.7, 0.2, 1) 80ms both;
}

.thx-hero-lead {
  color: var(--thx-dim);
  font-size: clamp(18px, 2.6vw, 28px);
  font-weight: 600;
}

/* ---- 实时数字 ---- */
.thx-band {
  padding: 24px 24px 88px;
}

.thx-figures {
  display: flex;
  justify-content: center;
  max-width: 980px;
  margin: 0 auto;
}

.thx-figures li {
  flex: 1;
  max-width: 260px;
  padding: 4px 16px;
  border-left: 1px solid var(--thx-line);
  text-align: center;
}

.thx-figures li:first-child {
  border-left: 0;
}

.thx-figures b {
  display: block;
  font-size: clamp(36px, 6vw, 72px);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.thx-figures span {
  color: var(--thx-dim);
  font-size: var(--cpu-fs-m);
}

.thx-live {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 28px;
  color: var(--thx-dim);
  font-size: var(--cpu-fs-xs);
}

.thx-live i,
.thx-total i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #30d158;
  animation: thx-pulse 2s ease-in-out infinite;
}

@keyframes thx-pulse {
  50% { opacity: 0.25; }
}

/* ---- 主创 ---- */
.thx-lead {
  padding: 40px 24px 160px;
  text-align: center;
}

.thx-lead-role {
  color: var(--thx-link);
  font-size: clamp(16px, 2vw, 21px);
  font-weight: 600;
}

.thx-lead-name {
  margin-top: 4px;
  font-size: clamp(72px, 13vw, 144px);
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.15;
  padding-left: 0.06em;
}

.thx-lead-aliases {
  color: var(--thx-dim);
  font-size: clamp(18px, 2.6vw, 28px);
  font-weight: 600;
}

.thx-lead-note {
  max-width: 560px;
  margin: 28px auto 0;
  font-size: clamp(16px, 2vw, 21px);
  line-height: 1.6;
}

/* ---- 章节通用 ---- */
.thx-section {
  padding: 120px 24px;
}

.thx-inner {
  max-width: 980px;
  margin: 0 auto;
}

.thx-inner--narrow {
  max-width: 780px;
}

.thx-head {
  margin-bottom: 48px;
}

.thx-head h2 {
  font-size: clamp(32px, 5.6vw, 56px);
  font-weight: 700;
  line-height: 1.15;
}

.thx-head h2 + p {
  margin-top: 12px;
  color: var(--thx-dim);
  font-size: clamp(16px, 2vw, 21px);
  font-weight: 600;
}

/* ---- 伙伴：拼贴卡片 ---- */
.thx-bento {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 20px;
}

.thx-bento > li {
  grid-column: span var(--thx-span, 6);
}

.thx-tile {
  --thx-tint: #0071e3;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 280px;
  padding: 32px;
  border-radius: 28px;
  background: var(--thx-card);
  transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1);
}

@media (hover: hover) {
  .thx-tile:hover {
    transform: scale(1.015);
  }
}

.thx-tile[data-tint="orange"] { --thx-tint: #f56300; }
.thx-tile[data-tint="green"] { --thx-tint: #1aa33c; }
.thx-tile[data-tint="purple"] { --thx-tint: #8944ab; }
.thx-tile[data-tint="pink"] { --thx-tint: #e30b5d; }
.thx-tile[data-tint="teal"] { --thx-tint: #0a84a8; }

.thx-tile-icon {
  margin-bottom: auto;
  color: var(--thx-tint);
  font-size: 44px;
}

.thx-tile-role {
  margin-top: 32px;
  color: var(--thx-tint);
  font-size: var(--cpu-fs-m);
  font-weight: 600;
}

.thx-tile h3 {
  margin-top: 4px;
  font-size: clamp(24px, 3.4vw, 36px);
  font-weight: 700;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.thx-tile h3 small {
  margin-left: 10px;
  color: var(--thx-dim);
  font-size: var(--cpu-fs-l);
  font-weight: 400;
}

.thx-tile-note {
  margin-top: 8px;
  color: var(--thx-dim);
}

/* ---- 赞助榜 ---- */
.thx-total b {
  display: block;
  font-size: clamp(48px, 9vw, 96px);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.thx-total span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  color: var(--thx-dim);
  font-size: var(--cpu-fs-m);
}

.thx-board {
  max-width: 720px;
  margin-top: 40px;
  padding: 8px 28px;
  border-radius: 28px;
  background: var(--thx-card);
}

.thx-board ol {
  position: relative;
}

.thx-board li {
  display: grid;
  grid-template-columns: 28px auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 60px;
  border-top: 1px solid var(--thx-line);
}

.thx-board li:first-child {
  border-top-color: transparent;
}

.thx-board li.is-top {
  min-height: 72px;
}

.thx-board-rank {
  color: var(--thx-dim);
  font-size: var(--cpu-fs-m);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.thx-board li.is-top .thx-board-rank {
  color: var(--thx-ink);
  font-size: var(--cpu-fs-xl);
  font-weight: 700;
}

.thx-board-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thx-board li.is-top .thx-board-name {
  font-size: var(--cpu-fs-xl);
  font-weight: 600;
}

.thx-board-count {
  color: var(--thx-dim);
  font-size: var(--cpu-fs-xs);
}

.thx-board-amount {
  min-width: 88px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  transition: color 1.2s;
}

.thx-board-amount.is-flash {
  color: #30d158;
  transition-duration: 0.2s;
}

/* 名次变化时整行滑到新位置 */
.thx-rank-move {
  transition: transform 0.8s cubic-bezier(0.2, 0.7, 0.2, 1);
}

.thx-rank-enter-active,
.thx-rank-leave-active {
  transition: opacity 0.5s, transform 0.5s;
}

.thx-rank-enter-from,
.thx-rank-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

.thx-rank-leave-active {
  position: absolute;
}

.thx-anon {
  max-width: 720px;
  margin-top: 24px;
  font-size: clamp(16px, 2vw, 21px);
  font-weight: 600;
}

.thx-empty {
  color: var(--thx-dim);
}

/* ---- 工具与开源 ---- */
.thx-tools {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.thx-tools li {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-height: 200px;
  padding: 32px;
  border-radius: 28px;
  background: var(--thx-card);
}

.thx-tools span {
  color: var(--thx-dim);
  font-size: var(--cpu-fs-m);
  font-weight: 600;
}

.thx-tools b {
  font-size: clamp(28px, 4.6vw, 48px);
  line-height: 1.2;
}

.thx-subhead {
  margin: 56px 0 16px;
  color: var(--thx-dim);
  font-size: var(--cpu-fs-m);
  font-weight: 600;
}

.thx-stack {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.thx-chip {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 18px;
  border-radius: 18px;
  color: inherit;
  background: var(--thx-card);
  text-decoration: none;
  transition: background 0.2s;
}

a.thx-chip:hover {
  background: var(--thx-card-hover);
}

.thx-chip b {
  font-weight: 600;
}

.thx-chip span {
  color: var(--thx-dim);
  font-size: var(--cpu-fs-xs);
}

/* ---- 时间线 ---- */
.thx-road li {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 24px;
  padding: 22px 0;
  border-top: 1px solid var(--thx-line);
}

.thx-road li:last-child {
  border-bottom: 1px solid var(--thx-line);
}

.thx-road time {
  color: var(--thx-dim);
  font-size: var(--cpu-fs-xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.thx-road h3 {
  font-size: var(--cpu-fs-xl);
  font-weight: 600;
}

.thx-road p {
  margin-top: 4px;
  color: var(--thx-dim);
  font-size: var(--cpu-fs-m);
}

.thx-footnote {
  margin-top: 20px;
  color: var(--thx-dim);
  font-size: var(--cpu-fs-xs);
}

/* ---- 片尾 ---- */
.thx-finale {
  padding: 160px 24px calc(env(safe-area-inset-bottom, 0px) + 72px + var(--thx-bottom-clearance, 0px));
  text-align: center;
}

.thx-you {
  font-size: clamp(40px, 8vw, 96px);
  font-weight: 700;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

/* 用 text-fill-color 而不是 color: transparent：标题颜色被上面的规则强制了 */
.thx-you em {
  background: linear-gradient(90deg, #2997ff, #bf5af2 55%, #ff375f);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-style: normal;
}

.thx-finale-body {
  max-width: 560px;
  margin: 24px auto 0;
  color: var(--thx-dim);
  font-size: clamp(16px, 2vw, 21px);
}

.thx-sign {
  margin-top: 120px;
  color: var(--thx-dim);
  font-size: var(--cpu-fs-xs);
}

/* ---- 窄屏 ---- */
@media (max-width: 760px) {
  .thx-nav-links {
    display: none;
  }

  .thx-bento > li {
    grid-column: 1 / -1;
  }

  .thx-tile {
    min-height: 220px;
    padding: 24px;
    border-radius: 22px;
  }
}

@media (max-width: 640px) {
  .thx-hero {
    padding: 32px 20px 56px;
  }

  .thx-band {
    padding: 8px 16px 64px;
  }

  .thx-figures {
    flex-wrap: wrap;
    row-gap: 28px;
  }

  .thx-figures li {
    flex: 0 0 50%;
    max-width: none;
    padding: 0 8px;
  }

  .thx-figures li:nth-child(odd) {
    border-left: 0;
  }

  .thx-lead {
    padding: 24px 20px 104px;
  }

  .thx-section {
    padding: 80px 16px;
  }

  .thx-head {
    margin-bottom: 32px;
  }

  .thx-board {
    margin-top: 28px;
    padding: 4px 16px;
    border-radius: 22px;
  }

  .thx-board li {
    gap: 10px;
  }

  .thx-board-count {
    display: none;
  }

  .thx-tools {
    gap: 12px;
  }

  .thx-tools li {
    min-height: 140px;
    padding: 20px;
    border-radius: 22px;
  }

  .thx-stack {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .thx-road li {
    grid-template-columns: 1fr;
    gap: 2px;
    padding: 18px 0;
  }

  .thx-road time {
    font-size: var(--cpu-fs-m);
  }

  .thx-finale {
    padding-top: 112px;
  }

  .thx-sign {
    margin-top: 80px;
  }
}

/* ---- 减弱动效 ---- */
.thx-page--calm .thx-rise,
.thx-page--calm .thx-hero-title,
.thx-page--calm .thx-live i,
.thx-page--calm .thx-total i {
  animation: none;
}

.thx-page--calm .thx-reveal {
  opacity: 1;
  transform: none;
  transition: none;
}

.thx-page--calm .thx-tile,
.thx-page--calm .thx-rank-move {
  transition: none;
}
</style>
