<template>
  <div class="thx-page" :class="{ 'thx-page--calm': calm }">
    <ThanksSky ref="skyRef" class="thx-sky" :calm="calm" />
    <div class="thx-aurora" aria-hidden="true"><i></i><i></i><i></i></div>

    <header class="thx-bar">
      <button class="thx-back" type="button" @click="goBack">
        <el-icon><ArrowLeft /></el-icon>
        <span>返回</span>
      </button>
    </header>

    <nav class="thx-dots" aria-label="章节">
      <a
        v-for="section in sections"
        :key="section.id"
        :href="`#${section.id}`"
        :class="{ 'is-on': activeSection === section.id }"
        @click.prevent="jumpTo(section.id)"
      >
        <span>{{ section.label }}</span>
      </a>
    </nav>

    <!-- 开场 -->
    <section id="thx-hero" class="thx-hero" data-thx-section>
      <span class="thx-hero-ghost" aria-hidden="true">{{ thanksHero.ghost }}</span>
      <div class="thx-hero-body">
        <p class="thx-eyebrow thx-rise">{{ thanksHero.eyebrow }} · 药大拾间</p>
        <h1 class="thx-hero-title thx-rise" style="--thx-delay: 120ms">{{ thanksHero.title }}</h1>
        <p class="thx-hero-lead thx-rise" style="--thx-delay: 260ms">{{ thanksHero.lead }}</p>
        <ul class="thx-figures thx-rise" style="--thx-delay: 400ms">
          <li v-for="(figure, index) in figureTargets" :key="figure.label">
            <b>{{ shownFigures[index] }}<small v-if="figure.suffix">{{ figure.suffix }}</small></b>
            <span>{{ figure.label }}</span>
          </li>
        </ul>
      </div>
      <a class="thx-cue" href="#thx-core" @click.prevent="jumpTo('thx-core')">
        <span>往下看</span>
        <el-icon><ArrowDown /></el-icon>
      </a>
    </section>

    <!-- 核心团队 -->
    <section id="thx-core" class="thx-section" data-thx-section>
      <header v-reveal class="thx-head">
        <p class="thx-kicker">01 — CORE TEAM</p>
        <h2>把它做出来的人</h2>
        <p>从第一行代码到每一次半夜上线。</p>
      </header>
      <ul class="thx-core">
        <li v-for="(person, index) in thanksCore" :key="index" v-reveal="index">
          <article class="thx-card" :data-hue="person.hue" @pointermove="tilt" @pointerleave="untilt">
            <div class="thx-card-avatar">
              <img v-if="person.avatar" :src="person.avatar" :alt="person.name" loading="lazy" />
              <span v-else>{{ initialOf(person.name) }}</span>
            </div>
            <h3>{{ person.name }}</h3>
            <p class="thx-card-role">{{ person.role }}</p>
            <p v-if="person.note" class="thx-card-note">{{ person.note }}</p>
          </article>
        </li>
      </ul>
    </section>

    <!-- 贡献者 -->
    <section id="thx-crew" class="thx-section thx-section--wide" data-thx-section>
      <header v-reveal class="thx-head">
        <p class="thx-kicker">02 — CONTRIBUTORS</p>
        <h2>一起添砖加瓦的人</h2>
        <p>提交过代码、报过问题、给过建议的每一位。</p>
      </header>
      <div v-reveal class="thx-marquees">
        <div
          v-for="(row, rowIndex) in marqueeRows"
          :key="rowIndex"
          class="thx-marquee"
          :class="{ 'thx-marquee--reverse': rowIndex % 2 === 1 }"
          :style="{ '--thx-dur': `${row.length * 5}s` }"
        >
          <div class="thx-marquee-track">
            <ul v-for="copy in 2" :key="copy" :aria-hidden="copy === 2 ? 'true' : undefined">
              <li v-for="(name, index) in row" :key="index" :data-hue="HUES[(index + rowIndex) % HUES.length]">{{ name }}</li>
            </ul>
          </div>
        </div>
      </div>
      <ul class="thx-groups">
        <li v-for="(group, index) in thanksGroups" :key="group.title" v-reveal="index">
          <h3>{{ group.title }}</h3>
          <p v-if="group.note" class="thx-group-note">{{ group.note }}</p>
          <p class="thx-group-names">{{ group.names.join(" · ") }}</p>
        </li>
      </ul>
    </section>

    <!-- 赞助者：iOS / 鸿蒙原生壳内不展示 -->
    <section v-if="showSponsors" id="thx-sponsors" class="thx-section" data-thx-section>
      <header v-reveal class="thx-head">
        <p class="thx-kicker">03 — SPONSORS</p>
        <h2>为服务器续命的人</h2>
        <p>每一笔赞助都变成了带宽、存储和又一个月的在线。</p>
      </header>
      <ul v-if="sponsors.length" v-reveal class="thx-sponsors">
        <li v-for="item in sponsors" :key="item.id" :title="item.message || undefined">
          <UserAvatar
            :size="28"
            :src="item.anonymous ? null : item.user?.avatar"
            :name="item.anonymous ? '匿名同学' : item.user?.nickname"
            :seed="item.anonymous ? `sponsor-${item.id}` : item.user?.id ?? item.id"
            alt="赞助者头像"
          />
          <span>{{ item.anonymous ? "匿名同学" : item.user?.nickname || "同学" }}</span>
        </li>
      </ul>
      <p v-else v-reveal class="thx-empty">鸣谢墙上的名字会出现在这里。</p>
      <div v-reveal class="thx-actions">
        <router-link class="thx-button" to="/sponsor">查看完整鸣谢墙</router-link>
      </div>
    </section>

    <!-- 开源项目 -->
    <section id="thx-stack" class="thx-section" data-thx-section>
      <header v-reveal class="thx-head">
        <p class="thx-kicker">{{ showSponsors ? "04" : "03" }} — OPEN SOURCE</p>
        <h2>站在巨人的肩膀上</h2>
        <p>没有这些开源项目，就没有拾间。</p>
      </header>
      <ul class="thx-stack">
        <li v-for="(project, index) in thanksOpenSource" :key="project.name" v-reveal="index % 6">
          <component
            :is="project.url ? 'a' : 'div'"
            class="thx-tile"
            :href="project.url"
            :target="project.url ? '_blank' : undefined"
            :rel="project.url ? 'noopener noreferrer' : undefined"
          >
            <b>{{ project.name }}</b>
            <span>{{ project.note }}</span>
          </component>
        </li>
      </ul>
    </section>

    <!-- 时间线 -->
    <section id="thx-road" class="thx-section thx-section--narrow" data-thx-section>
      <header v-reveal class="thx-head">
        <p class="thx-kicker">{{ showSponsors ? "05" : "04" }} — THE ROAD</p>
        <h2>一路走来</h2>
      </header>
      <ol class="thx-road">
        <li v-for="(step, index) in thanksMilestones" :key="index" v-reveal>
          <time>{{ step.date }}</time>
          <h3>{{ step.title }}</h3>
          <p v-if="step.note">{{ step.note }}</p>
        </li>
      </ol>
    </section>

    <!-- 片尾 -->
    <section id="thx-you" class="thx-section thx-finale" data-thx-section>
      <p v-reveal class="thx-kicker">{{ thanksFinale.lead }}</p>
      <h2 v-reveal="1" class="thx-you">还有，<em>{{ auth.nickname || thanksFinale.fallbackName }}</em></h2>
      <p v-reveal="2" class="thx-finale-body">{{ thanksFinale.body }}</p>
      <div v-reveal="3" class="thx-actions">
        <button class="thx-button thx-button--glow" type="button" @click="celebrate">放一束烟花</button>
      </div>
      <div v-reveal class="thx-roll" aria-hidden="true">
        <div class="thx-roll-track" :style="{ '--thx-dur': `${rollLineCount * 1.6}s` }">
          <div v-for="copy in 2" :key="copy" class="thx-roll-copy">
            <template v-for="group in rollGroups" :key="group.heading">
              <p class="thx-roll-heading">{{ group.heading }}</p>
              <p v-for="(line, index) in group.lines" :key="index">{{ line }}</p>
            </template>
          </div>
        </div>
      </div>
      <p class="thx-sign">{{ thanksFinale.sign }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, type Directive } from "vue";
import { useRouter } from "vue-router";
import { ArrowDown, ArrowLeft } from "@element-plus/icons-vue";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { paymentsApi, type SponsorWallItem } from "@/api/payments";
import { useAuthStore } from "@/stores/auth";
import { hidesNativeCommerce } from "@/utils/clientInfo";
import ThanksSky from "./ThanksSky.vue";
import {
  thanksContributors,
  thanksCore,
  thanksFinale,
  thanksGroups,
  thanksHero,
  thanksMilestones,
  thanksOpenSource,
  thanksStats,
  type ThanksHue,
  type ThanksStat,
} from "./credits";

const HUES: ThanksHue[] = ["teal", "blue", "violet", "amber", "rose"];
const MARQUEE_ROWS = 3;
const MARQUEE_MIN_PER_ROW = 10;
const SPONSOR_LIMIT = 36;

const router = useRouter();
const auth = useAuthStore();
const skyRef = ref<InstanceType<typeof ThanksSky> | null>(null);

const motionQuery = typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)") : undefined;
const calm = ref(Boolean(motionQuery?.matches));
const finePointer = typeof window !== "undefined" && Boolean(window.matchMedia?.("(hover: hover) and (pointer: fine)").matches);

function onMotionChange(event: MediaQueryListEvent) {
  calm.value = event.matches;
}

function goBack() {
  if (window.history.state?.back) router.back();
  else router.replace("/home");
}

// ---- 赞助者 ----
const showSponsors = !hidesNativeCommerce();
const sponsors = ref<SponsorWallItem[]>([]);
const sponsorTotal = ref(0);

async function loadSponsors() {
  if (!showSponsors) return;
  try {
    const wall = await paymentsApi.sponsorWall({ suppressErrorMessage: true });
    if (!wall.enabled) return;
    sponsors.value = wall.list.slice(0, SPONSOR_LIMIT);
    sponsorTotal.value = wall.total;
    figureTargets.value = buildFigures();
    countUp();
  } catch {
    // 鸣谢墙取不到时这一节只显示占位文案
  }
}

// ---- 章节导航 ----
const sections = [
  { id: "thx-hero", label: "开场" },
  { id: "thx-core", label: "核心团队" },
  { id: "thx-crew", label: "贡献者" },
  ...(showSponsors ? [{ id: "thx-sponsors", label: "赞助者" }] : []),
  { id: "thx-stack", label: "开源项目" },
  { id: "thx-road", label: "时间线" },
  { id: "thx-you", label: "还有你" },
];
const activeSection = ref(sections[0].id);
let sectionObserver: IntersectionObserver | null = null;

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: calm.value ? "auto" : "smooth", block: "start" });
}

// ---- 开场数字 ----
function buildFigures(): ThanksStat[] {
  const days = Math.max(1, Math.floor((Date.now() - new Date(`${thanksHero.since}T00:00:00+08:00`).getTime()) / 86_400_000));
  return [
    { label: "天的陪伴", value: days },
    ...thanksStats,
    ...(sponsorTotal.value ? [{ label: "次赞助支持", value: sponsorTotal.value }] : []),
  ];
}
const figureTargets = ref(buildFigures());
const shownFigures = reactive<number[]>([]);
let countRaf = 0;

function countUp() {
  cancelAnimationFrame(countRaf);
  const targets = figureTargets.value.map((figure) => figure.value);
  const from = targets.map((_, index) => shownFigures[index] ?? 0);
  if (calm.value) {
    shownFigures.splice(0, shownFigures.length, ...targets);
    return;
  }
  const startedAt = performance.now();
  const step = (now: number) => {
    const progress = Math.min((now - startedAt) / 1600, 1);
    const eased = 1 - (1 - progress) ** 4;
    shownFigures.splice(0, shownFigures.length, ...targets.map((target, index) => Math.round(from[index] + (target - from[index]) * eased)));
    if (progress < 1) countRaf = requestAnimationFrame(step);
  };
  countRaf = requestAnimationFrame(step);
}

// ---- 名单墙和片尾字幕 ----
const marqueeRows = computed(() => {
  const rows: string[][] = Array.from({ length: MARQUEE_ROWS }, () => []);
  thanksContributors.forEach((name, index) => rows[index % MARQUEE_ROWS].push(name));
  return rows.filter((row) => row.length).map((row) => {
    const filled = [...row];
    while (filled.length < MARQUEE_MIN_PER_ROW) filled.push(...row);
    return filled;
  });
});

const rollGroups = computed(() => [
  { heading: "核心团队", lines: thanksCore.map((person) => `${person.name}　${person.role}`) },
  { heading: "贡献者", lines: thanksContributors },
  ...thanksGroups.map((group) => ({ heading: group.title, lines: group.names })),
  { heading: "开源项目", lines: thanksOpenSource.map((project) => project.name) },
]);
const rollLineCount = computed(() => rollGroups.value.reduce((total, group) => total + group.lines.length + 2, 0));

function initialOf(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

// ---- 动效 ----
function tilt(event: PointerEvent) {
  if (!finePointer || calm.value) return;
  const card = event.currentTarget as HTMLElement;
  const rect = card.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  card.style.setProperty("--thx-mx", `${(x * 100).toFixed(1)}%`);
  card.style.setProperty("--thx-my", `${(y * 100).toFixed(1)}%`);
  card.style.setProperty("--thx-rx", `${((0.5 - y) * 12).toFixed(2)}deg`);
  card.style.setProperty("--thx-ry", `${((x - 0.5) * 14).toFixed(2)}deg`);
}

function untilt(event: PointerEvent) {
  const card = event.currentTarget as HTMLElement;
  for (const name of ["--thx-mx", "--thx-my", "--thx-rx", "--thx-ry"]) card.style.removeProperty(name);
}

function celebrate() {
  skyRef.value?.celebrate();
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
    if (binding.value) el.style.setProperty("--thx-delay", `${binding.value * 80}ms`);
    observeReveal(el);
  },
  unmounted(el) {
    revealObserver?.unobserve(el);
  },
};

onMounted(() => {
  motionQuery?.addEventListener?.("change", onMotionChange);
  countUp();
  void loadSponsors();
  if (typeof IntersectionObserver !== "undefined") {
    sectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) activeSection.value = entry.target.id;
    }, { rootMargin: "-45% 0px -45% 0px" });
    document.querySelectorAll<HTMLElement>("[data-thx-section]").forEach((el) => sectionObserver?.observe(el));
  }
});

onBeforeUnmount(() => {
  motionQuery?.removeEventListener?.("change", onMotionChange);
  cancelAnimationFrame(countRaf);
  revealObserver?.disconnect();
  sectionObserver?.disconnect();
});
</script>

<style scoped>
/* 这一页自成一个世界：不跟随站点深浅色，始终是夜空。
   类名一律带 thx- 前缀，避开 index.scss 深色主题里对 .block / .panel / .title 等通用类名的强制样式。 */
.thx-page {
  --thx-bg: #04060c;
  --thx-ink: #eef3f8;
  --thx-dim: rgba(238, 243, 248, 0.64);
  --thx-faint: rgba(238, 243, 248, 0.4);
  --thx-line: rgba(255, 255, 255, 0.1);
  --thx-glass: rgba(255, 255, 255, 0.045);
  --thx-teal: #2ee6c8;
  --thx-blue: #5aa2ff;
  --thx-violet: #a98bff;
  --thx-amber: #ffc857;
  --thx-rose: #ff7aa8;
  --thx-rainbow: linear-gradient(100deg, var(--thx-teal), var(--thx-blue), var(--thx-violet), var(--thx-rose), var(--thx-amber), var(--thx-teal));
  --thx-h: var(--thx-teal);
  position: relative;
  isolation: isolate;
  min-height: 100dvh;
  overflow-x: clip;
  color: var(--thx-ink);
  background: var(--thx-bg);
  font-size: var(--cpu-fs-m);
  line-height: 1.7;
}

.thx-page [data-hue="teal"] { --thx-h: var(--thx-teal); }
.thx-page [data-hue="blue"] { --thx-h: var(--thx-blue); }
.thx-page [data-hue="violet"] { --thx-h: var(--thx-violet); }
.thx-page [data-hue="amber"] { --thx-h: var(--thx-amber); }
.thx-page [data-hue="rose"] { --thx-h: var(--thx-rose); }

/* 重置写在 :where 里，优先级不压过后面的章节样式 */
.thx-page :where(ul, ol) {
  margin: 0;
  padding: 0;
  list-style: none;
}

.thx-page :where(h1, h2, h3, p) {
  margin: 0;
}

/* 站点深色主题会把所有标题强制成它自己的文字色 */
.thx-page :is(h1, h2, h3) {
  color: var(--thx-ink) !important;
}

/* 渐变字和描边字：深色主题下文字上会多出一层暗影，把渐变压暗，这里显式关掉 */
.thx-hero-title,
.thx-hero-ghost,
.thx-you em {
  text-shadow: none !important;
}

/* ---- 背景 ---- */
.thx-sky,
.thx-aurora {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.thx-sky {
  z-index: -1;
}

.thx-aurora {
  z-index: -2;
  overflow: hidden;
}

.thx-aurora i {
  position: absolute;
  width: 70vmax;
  height: 70vmax;
  border-radius: 50%;
  opacity: 0.5;
  animation: thx-drift 28s ease-in-out infinite alternate;
}

.thx-aurora i:nth-child(1) {
  top: -30vmax;
  left: -20vmax;
  background: radial-gradient(closest-side, rgba(46, 230, 200, 0.34), transparent);
}

.thx-aurora i:nth-child(2) {
  top: 10vmax;
  right: -35vmax;
  background: radial-gradient(closest-side, rgba(169, 139, 255, 0.3), transparent);
  animation-duration: 36s;
  animation-delay: -12s;
}

.thx-aurora i:nth-child(3) {
  bottom: -40vmax;
  left: 10vmax;
  background: radial-gradient(closest-side, rgba(90, 162, 255, 0.26), transparent);
  animation-duration: 44s;
  animation-delay: -20s;
}

@keyframes thx-drift {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to { transform: translate3d(12vmax, 8vmax, 0) scale(1.25); }
}

/* ---- 顶部返回和章节圆点 ---- */
.thx-bar {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 5;
  padding: calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px;
}

.thx-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 12px 0 8px;
  border: 1px solid var(--thx-line);
  border-radius: 999px;
  color: var(--thx-ink);
  background: rgba(10, 14, 22, 0.6);
  backdrop-filter: blur(12px);
  font: inherit;
  font-size: var(--cpu-fs-s);
  cursor: pointer;
}

.thx-back:hover {
  border-color: rgba(255, 255, 255, 0.28);
}

.thx-dots {
  position: fixed;
  top: 50%;
  right: 20px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transform: translateY(-50%);
}

.thx-dots a {
  position: relative;
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  transition: background 0.3s, box-shadow 0.3s, transform 0.3s;
}

.thx-dots a.is-on {
  background: var(--thx-teal);
  box-shadow: 0 0 12px var(--thx-teal);
  transform: scale(1.3);
}

.thx-dots span {
  position: absolute;
  top: 50%;
  right: 18px;
  color: var(--thx-dim);
  font-size: var(--cpu-fs-xs);
  white-space: nowrap;
  opacity: 0;
  transform: translate(6px, -50%);
  transition: opacity 0.2s, transform 0.2s;
  pointer-events: none;
}

.thx-dots a:hover span,
.thx-dots a.is-on span {
  opacity: 1;
  transform: translate(0, -50%);
}

/* ---- 入场 ---- */
.thx-reveal {
  opacity: 0;
  transform: translateY(26px);
  transition:
    opacity 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) var(--thx-delay, 0ms),
    transform 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) var(--thx-delay, 0ms);
}

.thx-reveal.is-in {
  opacity: 1;
  transform: none;
}

/* 首屏不等滚动观察器，挂载后直接入场 */
.thx-rise {
  animation: thx-rise 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) var(--thx-delay, 0ms) both;
}

@keyframes thx-rise {
  from {
    opacity: 0;
    transform: translateY(26px);
  }
}

/* ---- 开场 ---- */
.thx-hero {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 100dvh;
  padding: 96px 24px;
  overflow: hidden;
  text-align: center;
}

.thx-hero-ghost {
  position: absolute;
  top: 50%;
  left: 50%;
  /* 不用 transparent：深色配色方案下全透明的填充会被画成一层深色，压暗前面的标题 */
  color: rgba(255, 255, 255, 0.03);
  font-size: clamp(120px, 27vw, 440px);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
  white-space: nowrap;
  transform: translate(-50%, -58%);
  -webkit-text-stroke: 1px rgba(255, 255, 255, 0.07);
  user-select: none;
}

.thx-hero-body {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 640px;
}

.thx-eyebrow,
.thx-kicker {
  color: var(--thx-teal);
  font-family: var(--cpu-font-mono);
  font-size: var(--cpu-fs-xs);
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.thx-hero-title {
  margin-top: 12px;
  padding-left: 0.12em;
  background: var(--thx-rainbow);
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: clamp(88px, 22vw, 220px);
  font-weight: 800;
  letter-spacing: 0.12em;
  line-height: 1.05;
  filter: drop-shadow(0 0 48px rgba(46, 230, 200, 0.32));
  animation:
    thx-rise 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) var(--thx-delay, 0ms) both,
    thx-sheen 10s linear infinite;
}

@keyframes thx-sheen {
  to { background-position: 300% 0; }
}

.thx-hero-lead {
  margin-top: 16px;
  color: var(--thx-dim);
  font-size: var(--cpu-fs-l);
  line-height: 1.9;
}

.thx-figures {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px 40px;
  margin-top: 36px;
}

.thx-figures b {
  display: block;
  font-size: 32px;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.thx-figures small {
  margin-left: 2px;
  color: var(--thx-teal);
  font-size: var(--cpu-fs-l);
}

.thx-figures span {
  color: var(--thx-faint);
  font-size: var(--cpu-fs-xs);
}

.thx-cue {
  position: absolute;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 28px);
  left: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: var(--thx-faint);
  font-size: var(--cpu-fs-xs);
  letter-spacing: 0.2em;
  text-decoration: none;
  transform: translateX(-50%);
  animation: thx-bob 2.2s ease-in-out infinite;
}

@keyframes thx-bob {
  50% { transform: translate(-50%, 8px); }
}

/* ---- 章节通用 ---- */
.thx-section {
  max-width: 1080px;
  margin: 0 auto;
  padding: 104px 24px;
}

.thx-section--narrow {
  max-width: 640px;
}

.thx-section--wide {
  max-width: none;
  padding-inline: 0;
}

.thx-head {
  max-width: 1080px;
  margin: 0 auto 40px;
  padding-inline: 24px;
  text-align: center;
}

.thx-section:not(.thx-section--wide) .thx-head {
  padding-inline: 0;
}

.thx-head h2 {
  margin-top: 10px;
  font-size: clamp(28px, 5vw, 44px);
  font-weight: 800;
  line-height: 1.25;
}

.thx-head h2 + p {
  margin-top: 8px;
  color: var(--thx-dim);
}

/* ---- 核心团队卡片 ---- */
.thx-core {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.thx-core > li {
  perspective: 900px;
}

.thx-card {
  position: relative;
  height: 100%;
  padding: 24px 20px;
  overflow: hidden;
  border: 1px solid var(--thx-line);
  border-radius: 20px;
  background: var(--thx-glass);
  transform: rotateX(var(--thx-rx, 0deg)) rotateY(var(--thx-ry, 0deg));
  transition: transform 0.25s ease-out, border-color 0.3s;
  will-change: transform;
}

/* 跟着指针走的光斑 */
.thx-card::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(260px circle at var(--thx-mx, 50%) var(--thx-my, 0%), color-mix(in srgb, var(--thx-h) 30%, transparent), transparent 70%);
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}

.thx-card:hover {
  border-color: color-mix(in srgb, var(--thx-h) 55%, transparent);
}

.thx-card:hover::before {
  opacity: 1;
}

.thx-card-avatar {
  position: relative;
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  color: var(--thx-bg);
  background: linear-gradient(135deg, var(--thx-h), color-mix(in srgb, var(--thx-h) 40%, #fff));
  box-shadow: 0 0 28px color-mix(in srgb, var(--thx-h) 45%, transparent);
  font-size: var(--cpu-fs-xxl);
  font-weight: 800;
}

.thx-card-avatar img {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.thx-card h3 {
  position: relative;
  margin-top: 16px;
  font-size: var(--cpu-fs-xl);
}

.thx-card-role {
  position: relative;
  margin-top: 2px;
  color: var(--thx-h);
  font-size: var(--cpu-fs-xs);
}

.thx-card-note {
  position: relative;
  margin-top: 12px;
  color: var(--thx-dim);
  font-size: var(--cpu-fs-s);
}

/* ---- 贡献者名单墙 ---- */
.thx-marquees {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.thx-marquee {
  overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}

.thx-marquee-track {
  display: flex;
  width: max-content;
  animation: thx-slide var(--thx-dur, 60s) linear infinite;
}

.thx-marquee--reverse .thx-marquee-track {
  animation-direction: reverse;
}

.thx-marquee:hover .thx-marquee-track {
  animation-play-state: paused;
}

.thx-marquee-track ul {
  display: flex;
  gap: 12px;
  padding-right: 12px;
}

.thx-marquee-track li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 18px;
  border: 1px solid var(--thx-line);
  border-radius: 999px;
  background: var(--thx-glass);
  font-size: var(--cpu-fs-l);
  white-space: nowrap;
}

.thx-marquee-track li::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--thx-h);
  box-shadow: 0 0 10px var(--thx-h);
}

@keyframes thx-slide {
  to { transform: translateX(-50%); }
}

.thx-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  max-width: 1080px;
  margin: 40px auto 0;
  padding-inline: 24px;
}

.thx-groups > li {
  padding: 20px;
  border: 1px solid var(--thx-line);
  border-radius: 16px;
  background: var(--thx-glass);
}

.thx-groups h3 {
  font-size: var(--cpu-fs-l);
}

.thx-group-note {
  color: var(--thx-faint);
  font-size: var(--cpu-fs-xs);
}

.thx-group-names {
  margin-top: 12px;
  color: var(--thx-dim);
  line-height: 2;
}

/* ---- 赞助者 ---- */
.thx-sponsors {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.thx-sponsors li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px 5px 5px;
  border: 1px solid color-mix(in srgb, var(--thx-amber) 30%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--thx-amber) 8%, transparent);
  font-size: var(--cpu-fs-s);
}

.thx-empty {
  color: var(--thx-faint);
  text-align: center;
}

.thx-actions {
  display: flex;
  justify-content: center;
  margin-top: 28px;
}

.thx-button {
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 22px;
  border: 1px solid var(--thx-line);
  border-radius: 999px;
  color: var(--thx-ink);
  background: var(--thx-glass);
  font: inherit;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.3s, box-shadow 0.3s, transform 0.2s;
}

.thx-button:hover {
  border-color: rgba(255, 255, 255, 0.32);
}

.thx-button:active {
  transform: scale(0.97);
}

.thx-button--glow {
  border-color: transparent;
  color: var(--thx-bg);
  background: var(--thx-rainbow);
  background-size: 300% 100%;
  box-shadow: 0 0 36px rgba(46, 230, 200, 0.35);
  animation: thx-sheen 8s linear infinite;
}

.thx-button--glow:hover {
  box-shadow: 0 0 52px rgba(169, 139, 255, 0.55);
}

/* ---- 开源项目 ---- */
.thx-stack {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.thx-tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  height: 100%;
  padding: 16px;
  border: 1px solid var(--thx-line);
  border-radius: 14px;
  color: inherit;
  background: var(--thx-glass);
  text-decoration: none;
  transition: transform 0.25s, border-color 0.25s, background 0.25s;
}

a.thx-tile:hover {
  border-color: color-mix(in srgb, var(--thx-teal) 50%, transparent);
  background: color-mix(in srgb, var(--thx-teal) 8%, transparent);
  transform: translateY(-3px);
}

.thx-tile b {
  font-size: var(--cpu-fs-l);
}

.thx-tile span {
  color: var(--thx-faint);
  font-size: var(--cpu-fs-xs);
}

/* ---- 时间线 ---- */
.thx-road {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 36px;
  padding-left: 32px;
}

.thx-road::before {
  content: "";
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 5px;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(var(--thx-teal), var(--thx-blue), var(--thx-violet), transparent);
}

.thx-road li {
  position: relative;
}

.thx-road li::before {
  content: "";
  position: absolute;
  top: 6px;
  left: -32px;
  width: 12px;
  height: 12px;
  border: 2px solid var(--thx-teal);
  border-radius: 50%;
  background: var(--thx-bg);
  box-shadow: 0 0 14px var(--thx-teal);
}

.thx-road time {
  color: var(--thx-teal);
  font-family: var(--cpu-font-mono);
  font-size: var(--cpu-fs-xs);
  letter-spacing: 0.1em;
}

.thx-road h3 {
  font-size: var(--cpu-fs-xl);
}

.thx-road p {
  margin-top: 4px;
  color: var(--thx-dim);
}

/* ---- 片尾 ---- */
.thx-finale {
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 72px);
  text-align: center;
}

.thx-you {
  margin-top: 12px;
  font-size: clamp(32px, 7vw, 72px);
  font-weight: 800;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.thx-you em {
  background: var(--thx-rainbow);
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-style: normal;
  animation: thx-sheen 10s linear infinite;
}

.thx-finale-body {
  max-width: 520px;
  margin: 16px auto 0;
  color: var(--thx-dim);
  font-size: var(--cpu-fs-l);
  line-height: 1.9;
}

.thx-roll {
  height: 300px;
  margin-top: 72px;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(transparent, #000 22%, #000 78%, transparent);
  mask-image: linear-gradient(transparent, #000 22%, #000 78%, transparent);
}

.thx-roll-track {
  animation: thx-roll var(--thx-dur, 60s) linear infinite;
}

.thx-roll-copy {
  padding-bottom: 40px;
}

.thx-roll p {
  margin-top: 8px;
  color: var(--thx-dim);
}

.thx-roll .thx-roll-heading {
  margin-top: 40px;
  color: var(--thx-teal);
  font-family: var(--cpu-font-mono);
  font-size: var(--cpu-fs-xs);
  letter-spacing: 0.3em;
}

.thx-roll .thx-roll-heading:first-child {
  margin-top: 0;
}

@keyframes thx-roll {
  to { transform: translateY(-50%); }
}

.thx-sign {
  margin-top: 48px;
  color: var(--thx-faint);
  font-family: var(--cpu-font-mono);
  font-size: var(--cpu-fs-xs);
  letter-spacing: 0.3em;
}

/* ---- 窄屏 ---- */
@media (max-width: 900px) {
  .thx-dots {
    display: none;
  }
}

@media (max-width: 640px) {
  .thx-hero {
    padding: 80px 20px;
  }

  .thx-hero-lead,
  .thx-finale-body {
    font-size: var(--cpu-fs-m);
  }

  .thx-figures {
    gap: 12px 28px;
    margin-top: 28px;
  }

  .thx-figures b {
    font-size: var(--cpu-fs-xxl);
  }

  .thx-section {
    padding: 72px 16px;
  }

  .thx-section--wide {
    padding-inline: 0;
  }

  .thx-head {
    margin-bottom: 28px;
    padding-inline: 16px;
  }

  .thx-core {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .thx-card {
    padding: 16px 14px;
    border-radius: 16px;
  }

  .thx-marquee-track li {
    height: 34px;
    padding: 0 14px;
    font-size: var(--cpu-fs-m);
  }

  .thx-groups {
    padding-inline: 16px;
  }

  .thx-stack {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* ---- 减弱动效 ---- */
.thx-page--calm .thx-aurora i,
.thx-page--calm .thx-rise,
.thx-page--calm .thx-hero-title,
.thx-page--calm .thx-you em,
.thx-page--calm .thx-button--glow,
.thx-page--calm .thx-cue,
.thx-page--calm .thx-marquee-track,
.thx-page--calm .thx-roll-track {
  animation: none;
}

.thx-page--calm .thx-reveal {
  opacity: 1;
  transform: none;
  transition: none;
}

.thx-page--calm .thx-marquee {
  overflow-x: auto;
}
</style>
