<template>
  <main class="flight-shell nai-shell">
    <section ref="phoneEl" class="game-phone">
      <canvas
        v-show="screen === 'game'"
        ref="canvasEl"
        class="game-canvas"
        role="img"
        :aria-label="st('合成药大奶游戏区域')"
        tabindex="0"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerUp"
        @pointercancel="handlePointerCancel"
      ></canvas>

      <section v-if="screen === 'menu'" class="menu-screen">
        <button data-cpu-button="surface" type="button" class="corner-back" aria-label="返回小游戏" @click="router.push(MINI_GAMES_PATH)">←</button>
        <canvas ref="menuArtEl" class="menu-emblem" width="248" height="248" role="img" :aria-label="st('一群装在泡泡里的药大奶')"></canvas>
        <h1>{{ st('合成药大奶') }}</h1>
        <p class="menu-tagline">两只一样的撞一起，合成更大的一只</p>
        <div class="best-score-box">
          <span>最高分</span>
          <strong>{{ displayBest }}</strong>
        </div>
        <div class="menu-actions">
          <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click="startGame">开始合成</button>
          <button data-cpu-button="surface" type="button" class="game-button game-button--achievement" @click="openScreen('achievements')">🏆 成就</button>
          <button data-cpu-button="surface" type="button" class="game-button game-button--ranking" @click="openScreen('ranking')">📊 全校排行</button>
          <button data-cpu-button="surface" type="button" class="game-button game-button--secondary" @click="openScreen('history')">📜 历史战绩</button>
          <button data-cpu-button="surface" type="button" class="game-button game-button--secondary" @click="openScreen('settings')">⚙ 设置</button>
        </div>
        <p class="menu-footnote">{{ isLoggedIn ? "云端排行与成就已开启" : "本机记录 · 登录后同步云端" }}</p>
      </section>

      <section v-else-if="screen === 'game'" class="game-layer">
        <div class="score-board">
          <span>得分</span>
          <strong>{{ score }}</strong>
          <small>最高 {{ displayBest }}</small>
        </div>
        <div class="nai-next" :aria-label="st(`下一个：${NAI_LEVELS[nextLevel - 1].name}`)">
          <small>下一个</small>
          <canvas ref="nextEl" width="96" height="96" aria-hidden="true"></canvas>
        </div>
        <div class="game-controls">
          <button data-cpu-button="surface"
            v-if="gamePhase === 'playing' || gamePhase === 'paused'"
            type="button"
            :aria-label="gamePhase === 'paused' ? '继续游戏' : '暂停游戏'"
            @click.stop="togglePause"
          >{{ gamePhase === "paused" ? "▶" : "Ⅱ" }}</button>
          <button data-cpu-button="surface" type="button" aria-label="返回主页" @click.stop="returnToMenu">×</button>
        </div>

        <div v-if="gamePhase === 'ready'" class="ready-hint">
          <span class="ready-flight-mark" aria-hidden="true">👆</span>
          <h2>点击罐子或空格开始</h2>
          <p>左右移动选位置，松手投放。落稳的球越过警戒线，这一局就结束</p>
        </div>

        <div v-if="banner" :key="banner.id" class="nai-banner" role="status">{{ banner.text }}</div>

        <div v-if="gamePhase === 'paused'" class="modal-shade">
          <div class="game-modal">
            <span class="modal-icon">⏸</span>
            <h2>先歇一会儿</h2>
            <p>当前 {{ score }} 分 · 最高合成 {{ bestLevelName }}</p>
            <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click.stop="togglePause">继续合成</button>
            <button data-cpu-button="surface" type="button" class="plain-button" @click.stop="returnToMenu">返回主页</button>
          </div>
        </div>

        <div v-if="gamePhase === 'over'" class="modal-shade">
          <div class="game-modal result-modal">
            <span class="result-label">{{ isNewRecord ? "新纪录！" : resultTitle }}</span>
            <strong class="final-score">{{ score }}</strong>
            <span class="final-unit">分</span>
            <div class="result-stats">
              <span><small>历史最高</small><b>{{ displayBest }}</b></span>
              <span><small>最高合成</small><b>{{ bestLevelName }}</b></span>
              <span><small>称号</small><b>{{ st(rankTitle) }}</b></span>
            </div>
            <p class="cloud-result" :class="{ success: cloudSubmitState === 'success' }">{{ cloudResultMessage }}</p>
            <div v-if="newlyUnlocked.length" class="new-unlocks">
              <b v-for="item in newlyUnlocked" :key="item.code">{{ item.icon }} {{ item.title }}</b>
            </div>
            <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click.stop="startGame">再来一局</button>
            <button data-cpu-button="surface" type="button" class="plain-button" @click.stop="returnToMenu">返回主页</button>
          </div>
        </div>
      </section>

      <section v-else class="panel-screen">
        <header class="panel-header">
          <h2>{{ panelTitle }}</h2>
          <button data-cpu-button="surface" type="button" @click="returnToMenu">返回主页</button>
        </header>

        <div v-if="screen === 'ranking'" class="panel-scroll ranking-panel">
          <div class="ranking-summary">
            <div><span>全校玩家</span><strong>{{ totalPlayers }}</strong></div>
            <div v-if="cloudMe"><span>我的排名</span><strong>#{{ cloudMe.rank }}</strong></div>
            <button data-cpu-button="surface" type="button" :disabled="leaderboardLoading" @click="loadLeaderboard(true)">
              {{ leaderboardLoading ? "刷新中..." : "刷新榜单" }}
            </button>
          </div>
          <ol v-if="leaderboard.length" class="ranking-list">
            <li v-for="entry in leaderboard" :key="entry.userId" :class="{ me: cloudMe?.userId === entry.userId }">
              <span class="rank-number">{{ entry.rank }}</span>
              <UserAvatar :size="44" :src="entry.avatar" :name="entry.name" :seed="entry.userId" :alt="entry.name + '的头像'" />
              <span class="rank-user">
                <b>{{ entry.name }}</b>
                <small>{{ entry.games }} 局 · {{ entry.achievementCount }} 枚成就 · 合成过{{ levelName(entry.bestLevel) }}</small>
              </span>
              <strong>{{ entry.bestScore }}</strong>
            </li>
          </ol>
          <div v-else class="empty-panel">{{ leaderboardLoading ? "正在读取云端战绩..." : "还没有云端战绩，等你拿下第一名！" }}</div>
          <button data-cpu-button="surface" v-if="!isLoggedIn" type="button" class="panel-login" @click="goToLogin">登录并加入全校排行</button>
          <p v-if="leaderboardError" class="panel-error">{{ leaderboardError }}</p>
        </div>

        <div v-else-if="screen === 'achievements'" class="panel-scroll achievement-panel">
          <p class="panel-counter">已解锁 <b>{{ unlockedAchievementCount }}/{{ achievements.length }}</b></p>
          <div v-if="achievements.length" class="achievement-list">
            <article v-for="achievement in achievements" :key="achievement.code" :class="{ unlocked: achievement.unlocked }">
              <span class="achievement-icon">{{ achievement.icon }}</span>
              <span class="achievement-copy">
                <b>{{ st(achievement.title) }}</b>
                <small>{{ st(achievement.description) }}</small>
                <i><em :style="{ width: achievementPercent(achievement) + '%' }"></em></i>
              </span>
              <strong>{{ achievement.unlocked ? "已达成" : achievement.progress + "/" + achievement.target }}</strong>
            </article>
          </div>
          <div v-else class="empty-panel">{{ leaderboardLoading ? "正在读取云端成就..." : "成就册暂时没有连接上" }}</div>
          <button data-cpu-button="surface" v-if="!isLoggedIn" type="button" class="panel-login" @click="goToLogin">登录并保存成就进度</button>
        </div>

        <div v-else-if="screen === 'history'" class="panel-scroll">
          <ol v-if="history.length" class="history-list">
            <li v-for="(item, index) in history" :key="item.playedAt + '-' + index">
              <span>{{ String(index + 1).padStart(2, "0") }}</span>
              <b>{{ item.score }} 分</b>
              <small>{{ formatHistoryDate(item.playedAt) }} · 合成到{{ levelName(item.level) }}</small>
              <em>{{ naiRank(item.score) }}</em>
            </li>
          </ol>
          <div v-else class="empty-panel">暂无历史战绩，快去合成一局吧！</div>
        </div>

        <div v-else class="panel-scroll flight-settings-panel">
          <div class="setting-row">
            <span><b>游戏音效</b><small>投放与合成提示音</small></span>
            <button data-cpu-button="surface" type="button" :class="{ active: soundEnabled }" @click="toggleSound">{{ soundEnabled ? "开启" : "关闭" }}</button>
          </div>
          <div class="setting-row">
            <span><b>云端档案</b><small>{{ isLoggedIn ? "排行榜、局数和成就自动保存" : "当前成绩仅保存在这台设备" }}</small></span>
            <button data-cpu-button="surface" v-if="!isLoggedIn" type="button" @click="goToLogin">登录</button>
            <b v-else class="cloud-online">已连接</b>
          </div>
          <p>玩法：把手里的奶蛙投进罐子，两只一样的撞在一起会合成高一级的一只，等级越高分越多。投下来的只会是前四级。落稳的球顶部越过警戒线超过一秒半，这一局就结束。两只{{ st("药大奶") }}相撞会一起消失，再加 {{ NAI_RULES.clearBonus }} 分。</p>
          <div class="nai-guide">
            <span v-for="(level, index) in NAI_LEVELS" :key="level.name">
              <canvas ref="guideEls" width="96" height="96" aria-hidden="true"></canvas>
              <b>{{ st(level.name) }}</b>
              <small>{{ index ? `合成 +${naiMergeScore(index + 1)}` : "最小的一只" }}</small>
            </span>
          </div>
          <p>操作：鼠标移动瞄准、点击投放；触屏按住拖动、松手投放；方向键左右微调，空格或回车投放，P 暂停，Esc 返回主页。</p>
        </div>
      </section>
    </section>
  </main>
</template>

<script setup lang="ts">
import { useSchoolText } from "@/utils/schoolText";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { getToken } from "@/api/request";
import { useAuthStore } from "@/stores/auth";
import {
  yaodaNaiApi,
  type YaodaNaiAchievement,
  type YaodaNaiLeaderboard,
  type YaodaNaiRankingEntry,
} from "@/api/yaodaNai";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { MINI_GAMES_PATH } from "@/data/miniGames";
import {
  createNaiState,
  naiClampAim,
  naiDrop,
  naiMergeScore,
  naiRank,
  naiStep,
  NAI_LEVELS,
  NAI_MAX_LEVEL,
  NAI_RULES,
  type NaiState,
} from "./yaodaNaiEngine";
import { drawNaiIcon, drawNaiMenuArt, drawNaiScene, naiAimAt, naiArtReady, naiLayout } from "./yaodaNaiScene";

// 外校显示成本校简称（见 utils/schoolText.ts）。
const st = useSchoolText();

type Screen = "menu" | "game" | "ranking" | "achievements" | "history" | "settings";
type GamePhase = "ready" | "playing" | "paused" | "over";
type HistoryItem = { score: number; level: number; playedAt: string };

const router = useRouter();
const auth = useAuthStore();
const phoneEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const menuArtEl = ref<HTMLCanvasElement | null>(null);
const nextEl = ref<HTMLCanvasElement | null>(null);
const guideEls = ref<HTMLCanvasElement[]>([]);
const screen = ref<Screen>("menu");
const gamePhase = ref<GamePhase>("ready");
const score = ref(0);
const nextLevel = ref(1);
const maxLevel = ref(0);
const banner = ref<{ id: number; text: string } | null>(null);
const bestScore = ref(0);
const history = ref<HistoryItem[]>([]);
const soundEnabled = ref(true);
const isNewRecord = ref(false);
const leaderboard = ref<YaodaNaiRankingEntry[]>([]);
const cloudMe = ref<YaodaNaiRankingEntry | null>(null);
const totalPlayers = ref(0);
const leaderboardLoading = ref(false);
const leaderboardError = ref("");
const achievements = ref<YaodaNaiAchievement[]>([]);
const newlyUnlocked = ref<YaodaNaiLeaderboard["newlyUnlocked"]>([]);
const cloudSubmitState = ref<"idle" | "syncing" | "success" | "error" | "guest">("idle");
const cloudSubmitDetail = ref("");

const WORLD_WIDTH = 420;
const KEY_STEP = 14;
const STORAGE_PREFIX = "cpu-web:yaoda-nai:v1";

let game: NaiState = createNaiState(1);
let aim = NAI_RULES.width / 2;
let aiming = false;
let worldHeight = 700;
let lastFrameAt = 0;
let animationFrame = 0;
let bannerSeq = 0;
let bannerUntil = 0;
let announcedLevel = 0;
let nextDrawn = false;
let unmounted = false;
let resizeObserver: ResizeObserver | null = null;
let canvasContext: CanvasRenderingContext2D | null = null;
let audioContext: AudioContext | null = null;
let cloudAttemptPromise: Promise<number | null> = Promise.resolve(null);
let cloudSettlementPromise: Promise<void> = Promise.resolve();
let gameGeneration = 0;

const isLoggedIn = computed(() => Boolean(getToken()));
const displayBest = computed(() => Math.max(bestScore.value, cloudMe.value?.bestScore ?? 0));
const rankTitle = computed(() => naiRank(score.value));
const bestLevelName = computed(() => levelName(maxLevel.value));
const resultTitle = computed(() => maxLevel.value >= 9 ? st("离药大奶一步之遥") : maxLevel.value >= 7 ? "渐入佳境" : "罐子满了");
const unlockedAchievementCount = computed(() => achievements.value.filter((item) => item.unlocked).length);
const panelTitle = computed(() => {
  if (screen.value === "ranking") return "📊 全校排行";
  if (screen.value === "achievements") return "🏆 成就";
  if (screen.value === "history") return "📜 历史战绩";
  return "⚙ 设置";
});
const cloudResultMessage = computed(() => {
  if (cloudSubmitState.value === "syncing") return "正在校验并同步云端战绩...";
  if (cloudSubmitState.value === "success") return "已计入全校榜" + (cloudMe.value ? " · 当前第 " + cloudMe.value.rank + " 名" : "");
  if (cloudSubmitState.value === "error") return cloudSubmitDetail.value || "本局已保存在本机，云端同步失败";
  if (cloudSubmitState.value === "guest") return "登录后，下一局可加入全校榜并解锁成就";
  return "";
});

onMounted(() => {
  document.documentElement.classList.add("yaoda-flight-open");
  bestScore.value = readNumber(STORAGE_PREFIX + ":best");
  history.value = readHistory();
  soundEnabled.value = readBoolean(STORAGE_PREFIX + ":sound", true);
  window.addEventListener("keydown", handleKeydown);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  resizeObserver = new ResizeObserver(resizeCanvas);
  if (phoneEl.value) resizeObserver.observe(phoneEl.value);
  void initializeCloud();
  nextTick(() => {
    resizeCanvas();
    drawMenuArt();
  });
  // 图片到了以后，把已经画出去的插画和小图标重画一遍。
  void naiArtReady.then(() => {
    if (unmounted) return;
    drawMenuArt();
    drawGuide();
    nextDrawn = false;
    if (screen.value === "game") {
      syncHud();
      drawScene();
    }
  });
});

onBeforeUnmount(() => {
  unmounted = true;
  document.documentElement.classList.remove("yaoda-flight-open");
  if (gamePhase.value === "playing" || gamePhase.value === "paused") {
    cloudSettlementPromise = abandonCloudAttempt(cloudAttemptPromise);
  }
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", handleKeydown);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  void audioContext?.close();
});

function levelName(level: number) {
  return level >= 1 ? st(NAI_LEVELS[Math.min(NAI_MAX_LEVEL, level) - 1].name) : "—";
}

function openScreen(value: Screen) {
  screen.value = value;
  if (value === "ranking" || value === "achievements") void loadLeaderboard(true);
  if (value === "settings") nextTick(drawGuide);
}

function drawGuide() {
  for (const [index, canvas] of guideEls.value.entries()) {
    const context = canvas.getContext("2d");
    if (context) drawNaiIcon(context, index + 1, 96);
  }
}

function startGame() {
  cancelAnimationFrame(animationFrame);
  game = createNaiState(Math.floor(Math.random() * 0x7fffffff));
  aim = NAI_RULES.width / 2;
  aiming = false;
  announcedLevel = 0;
  screen.value = "game";
  gamePhase.value = "ready";
  banner.value = null;
  isNewRecord.value = false;
  newlyUnlocked.value = [];
  cloudSubmitState.value = isLoggedIn.value ? "idle" : "guest";
  cloudSubmitDetail.value = "";
  syncHud();
  nextTick(() => {
    resizeCanvas();
    syncHud();
    canvasEl.value?.focus({ preventScroll: true });
  });
}

function beginRound() {
  if (gamePhase.value !== "ready") return;
  gameGeneration += 1;
  const generation = gameGeneration;
  gamePhase.value = "playing";
  cloudAttemptPromise = cloudSettlementPromise.then(() => beginCloudAttempt(generation));
  lastFrameAt = performance.now();
  ensureAudio();
  playTone(540, 0.055, 0.035);
  animationFrame = requestAnimationFrame(gameLoop);
}

function returnToMenu() {
  const shouldAbandon = screen.value === "game" && (gamePhase.value === "playing" || gamePhase.value === "paused");
  const pendingAttempt = cloudAttemptPromise;
  gameGeneration += 1;
  if (shouldAbandon) cloudSettlementPromise = abandonCloudAttempt(pendingAttempt);
  cancelAnimationFrame(animationFrame);
  screen.value = "menu";
  gamePhase.value = "ready";
  nextTick(drawMenuArt);
}

function togglePause() {
  if (gamePhase.value === "playing") {
    gamePhase.value = "paused";
    aiming = false;
    cancelAnimationFrame(animationFrame);
    drawScene();
  } else if (gamePhase.value === "paused") {
    gamePhase.value = "playing";
    lastFrameAt = performance.now();
    animationFrame = requestAnimationFrame(gameLoop);
  }
}

function aimFromPointer(event: PointerEvent) {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const bounds = canvas.getBoundingClientRect();
  const worldX = ((event.clientX - bounds.left) / bounds.width) * WORLD_WIDTH;
  aim = naiClampAim(game.current, naiAimAt(naiLayout(WORLD_WIDTH, worldHeight), worldX));
}

function dropNow() {
  if (gamePhase.value !== "playing") return;
  if (naiDrop(game, aim)) {
    playEvents();
    syncHud();
  }
}

function handlePointerDown(event: PointerEvent) {
  event.preventDefault();
  if (screen.value !== "game") return;
  if (gamePhase.value === "ready") {
    // 开局这一下只用来开始，不投放。
    aimFromPointer(event);
    beginRound();
    return;
  }
  if (gamePhase.value !== "playing") return;
  aiming = true;
  try {
    canvasEl.value?.setPointerCapture(event.pointerId);
  } catch {
    // 拿不到指针捕获也能玩，只是拖出画布后不再跟手。
  }
  aimFromPointer(event);
}

function handlePointerMove(event: PointerEvent) {
  if (screen.value !== "game" || gamePhase.value === "over" || gamePhase.value === "paused") return;
  // 鼠标不用按住就能瞄准；触屏要按着拖。
  if (event.pointerType !== "mouse" && !aiming) return;
  aimFromPointer(event);
  if (gamePhase.value === "ready") drawScene();
}

function handlePointerUp(event: PointerEvent) {
  if (!aiming) return;
  aiming = false;
  aimFromPointer(event);
  dropNow();
}

function handlePointerCancel() {
  aiming = false;
}

function handleKeydown(event: KeyboardEvent) {
  if (["Space", "Enter"].includes(event.code)) {
    if (event.repeat) return;
    if (screen.value === "menu") {
      event.preventDefault();
      startGame();
    } else if (screen.value === "game" && gamePhase.value === "ready") {
      event.preventDefault();
      beginRound();
    } else if (screen.value === "game" && gamePhase.value === "playing") {
      event.preventDefault();
      dropNow();
    } else if (screen.value === "game" && gamePhase.value === "over") {
      event.preventDefault();
      startGame();
    }
    return;
  }
  if ((event.code === "ArrowLeft" || event.code === "ArrowRight") && screen.value === "game" && gamePhase.value !== "over") {
    event.preventDefault();
    aim = naiClampAim(game.current, aim + (event.code === "ArrowLeft" ? -KEY_STEP : KEY_STEP));
    if (gamePhase.value !== "playing") drawScene();
  } else if (event.code === "KeyP" && screen.value === "game" && (gamePhase.value === "playing" || gamePhase.value === "paused")) {
    event.preventDefault();
    togglePause();
  } else if (event.code === "Escape" && screen.value !== "menu") {
    event.preventDefault();
    returnToMenu();
  }
}

function handleVisibilityChange() {
  if (document.hidden && gamePhase.value === "playing") togglePause();
}

function gameLoop(now: number) {
  if (gamePhase.value !== "playing") return;
  const delta = Math.min((now - lastFrameAt) / 1000, 0.05);
  lastFrameAt = now;
  naiStep(game, delta);
  aim = naiClampAim(game.current, aim);
  playEvents();
  syncHud();
  drawScene();
  if (game.over) finishGame();
  else animationFrame = requestAnimationFrame(gameLoop);
}

function playEvents() {
  for (const event of game.events) {
    if (event.type === "drop") playTone(430, 0.05, 0.03);
    else if (event.type === "merge") {
      playTone(330 * 2 ** ((event.level - 2) / 6), 0.12, 0.045);
      // 第一次合成出高等级时报个名。
      if (event.level >= 5 && event.level > announcedLevel) {
        announcedLevel = event.level;
        showBanner(event.level === NAI_MAX_LEVEL ? st("药大奶！") : st(`合成出${NAI_LEVELS[event.level - 1].name}`));
        if (event.level === NAI_MAX_LEVEL) {
          window.setTimeout(() => playTone(784, 0.12, 0.05), 90);
          window.setTimeout(() => playTone(1047, 0.2, 0.05), 190);
        }
      }
    } else if (event.type === "clear") {
      showBanner(st(`两只药大奶！+${NAI_RULES.clearBonus}`));
      for (const [index, frequency] of [523, 659, 784, 1047].entries()) {
        window.setTimeout(() => playTone(frequency, 0.16, 0.05), index * 80);
      }
    }
  }
  game.events.length = 0;
}

function showBanner(text: string) {
  bannerSeq += 1;
  banner.value = { id: bannerSeq, text };
  bannerUntil = game.time + 1.6;
}

function syncHud() {
  score.value = game.score;
  maxLevel.value = game.maxLevel;
  if (banner.value && game.time >= bannerUntil) banner.value = null;
  if (nextLevel.value !== game.next || !nextDrawn) {
    nextLevel.value = game.next;
    const context = nextEl.value?.getContext("2d");
    if (context) {
      drawNaiIcon(context, game.next, 96);
      nextDrawn = true;
    } else nextDrawn = false;
  }
}

function finishGame() {
  if (gamePhase.value !== "playing") return;
  gamePhase.value = "over";
  aiming = false;
  banner.value = null;
  isNewRecord.value = score.value > bestScore.value;
  if (isNewRecord.value) {
    bestScore.value = score.value;
    writeStorage(STORAGE_PREFIX + ":best", String(bestScore.value));
  }
  const item: HistoryItem = { score: game.score, level: game.maxLevel, playedAt: new Date().toISOString() };
  history.value = [item, ...history.value].slice(0, 30);
  writeStorage(STORAGE_PREFIX + ":history", JSON.stringify(history.value));
  const generation = gameGeneration;
  const result = { score: game.score, drops: game.drops, level: game.maxLevel, durationMs: Math.max(0, Math.round(game.time * 1000)) };
  cloudSettlementPromise = finishCloudAttempt(cloudAttemptPromise, generation, result);
  playTone(180, 0.16, 0.06);
  window.setTimeout(() => playTone(130, 0.2, 0.045), 110);
}

function resizeCanvas() {
  const canvas = canvasEl.value;
  const phone = phoneEl.value;
  if (!canvas || !phone || !phone.clientWidth || !phone.clientHeight) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const scale = phone.clientWidth / WORLD_WIDTH;
  worldHeight = phone.clientHeight / scale;
  canvas.width = Math.round(phone.clientWidth * ratio);
  canvas.height = Math.round(phone.clientHeight * ratio);
  canvasContext = canvas.getContext("2d");
  canvasContext?.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0);
  nextDrawn = false;
  drawScene();
}

function drawScene() {
  if (!canvasContext) return;
  drawNaiScene(canvasContext, { width: WORLD_WIDTH, height: worldHeight, game, aim, playing: gamePhase.value === "playing" });
}

function drawMenuArt() {
  const context = menuArtEl.value?.getContext("2d");
  if (context) drawNaiMenuArt(context, 248);
}

function toggleSound() {
  soundEnabled.value = !soundEnabled.value;
  writeStorage(STORAGE_PREFIX + ":sound", String(soundEnabled.value));
  if (soundEnabled.value) {
    ensureAudio();
    playTone(620, 0.07, 0.035);
  }
}

function ensureAudio() {
  if (!soundEnabled.value || audioContext) return;
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AudioContextClass) audioContext = new AudioContextClass();
}

function playTone(frequency: number, duration: number, volume: number) {
  if (!soundEnabled.value) return;
  ensureAudio();
  if (!audioContext) return;
  if (audioContext.state === "suspended") void audioContext.resume();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  gain.gain.setValueAtTime(volume * 1.6, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

async function loadLeaderboard(force = false) {
  if (leaderboardLoading.value) return;
  leaderboardLoading.value = true;
  leaderboardError.value = "";
  try {
    applyLeaderboard(await yaodaNaiApi.leaderboard({ cacheTtlMs: force ? 0 : 15_000 }));
  } catch {
    leaderboardError.value = "云端排行暂时没有连接上";
  } finally {
    leaderboardLoading.value = false;
  }
}

async function initializeCloud() {
  if (!auth.ready) await auth.fetchMe({ probe: true }).catch(() => undefined);
  await loadLeaderboard();
}

async function beginCloudAttempt(generation: number) {
  if (!isLoggedIn.value) return null;
  try {
    const attempt = await yaodaNaiApi.startAttempt({
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
      suppressErrorMessage: true,
    });
    return attempt.id;
  } catch (error) {
    if (generation === gameGeneration) {
      cloudSubmitState.value = "error";
      cloudSubmitDetail.value = cloudFailureMessage(error, "云端未能创建本局记录，本局仅保存在本机");
    }
    return null;
  }
}

async function abandonCloudAttempt(attemptPromise: Promise<number | null>) {
  const attemptId = await attemptPromise;
  if (!attemptId) return;
  try {
    await yaodaNaiApi.abandonAttempt(attemptId, {
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
      suppressErrorMessage: true,
    });
  } catch {
    // The next start also closes unfinished attempts.
  }
}

async function finishCloudAttempt(
  attemptPromise: Promise<number | null>,
  generation: number,
  result: { score: number; drops: number; level: number; durationMs: number },
) {
  if (!isLoggedIn.value) {
    if (generation === gameGeneration) cloudSubmitState.value = "guest";
    return;
  }
  if (generation === gameGeneration) cloudSubmitState.value = "syncing";
  const attemptId = await attemptPromise;
  if (!attemptId) {
    if (generation === gameGeneration) {
      cloudSubmitState.value = "error";
      if (!cloudSubmitDetail.value) cloudSubmitDetail.value = "云端未能创建本局记录，本局仅保存在本机";
    }
    return;
  }
  try {
    const board = await yaodaNaiApi.finishAttempt(attemptId, result, {
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
      suppressErrorMessage: true,
    });
    applyLeaderboard(board);
    if (generation === gameGeneration) cloudSubmitState.value = "success";
  } catch (error) {
    if (generation === gameGeneration) {
      cloudSubmitState.value = "error";
      cloudSubmitDetail.value = cloudFailureMessage(error, "成绩校验未完成，本局仅保存在本机");
    }
  }
}

function cloudFailureMessage(error: unknown, fallback: string) {
  const failure = error as {
    response?: { status?: number; data?: { message?: unknown } };
  };
  const status = failure?.response?.status;
  const message = typeof failure?.response?.data?.message === "string"
    ? failure.response.data.message.trim()
    : "";
  if (status === 401) return "登录已过期，本局仅保存在本机";
  if (status === 429) return message || "操作太频繁，请稍后再开一局";
  return message || fallback;
}

function applyLeaderboard(value: YaodaNaiLeaderboard) {
  leaderboard.value = value.leaderboard;
  cloudMe.value = value.me;
  totalPlayers.value = value.totalPlayers;
  achievements.value = value.achievements;
  newlyUnlocked.value = value.newlyUnlocked;
}

function achievementPercent(item: YaodaNaiAchievement) {
  if (item.unlocked) return 100;
  return Math.min(100, Math.max(0, Math.round((item.progress / Math.max(1, item.target)) * 100)));
}

function goToLogin() {
  router.push({ name: "login", query: { redirect: router.currentRoute.value.path } });
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function readNumber(key: string) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function readBoolean(key: string, fallback: boolean) {
  const value = localStorage.getItem(key);
  return value === null ? fallback : value === "true";
}

function readHistory(): HistoryItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_PREFIX + ":history") || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => Number.isFinite(Number(item?.score)) && typeof item?.playedAt === "string")
      .slice(0, 30)
      .map((item) => ({
        score: Math.max(0, Math.floor(Number(item.score))),
        level: Math.max(0, Math.floor(Number(item.level) || 0)),
        playedAt: item.playedAt,
      }));
  } catch {
    return [];
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Local persistence is optional when browser storage is unavailable.
  }
}
</script>

<style scoped src="./gameShell.css"></style>
<style scoped>
/* 奶黄配嫩绿，圆角和软阴影；共用外壳里的粗边框和硬投影在这一页都换掉。 */
.nai-shell {
  --ink: #2f4a2a;
  --cyan: #fff8d6;
  --blue: #6aa85a;
  --blue-dark: #2f6b3a;
  --school-blue: #2f6b3a;
  --nai-green: #2f6b3a;
  --nai-line: rgba(140, 176, 104, .5);
  --nai-card: rgba(255, 253, 240, .86);
  --nai-muted: #7c8a6c;
  background:
    radial-gradient(circle at 20% 0%, rgba(255, 255, 255, .9), transparent 42%),
    linear-gradient(165deg, #f8ecae, #d9e8b4 78%);
  font-family: ui-rounded, "SF Pro Rounded", "HarmonyOS Sans SC", "PingFang SC", system-ui, sans-serif;
}

.nai-shell .game-phone {
  border: 2px solid rgba(168, 196, 128, .8);
  border-radius: 26px;
  background: #fff9dc;
  box-shadow: 0 18px 44px rgba(96, 120, 60, .22);
}
.nai-shell .game-canvas { background: #fff9dc; cursor: pointer; touch-action: none; }

.nai-shell .menu-screen {
  background:
    radial-gradient(circle at 16% 4%, rgba(255, 255, 255, .95), transparent 40%),
    linear-gradient(180deg, #fffbe2, #e4efc4);
}
.nai-shell .corner-back,
.nai-shell .best-score-box,
.nai-shell .game-button {
  border: 1.5px solid var(--nai-line);
  box-shadow: 0 6px 16px rgba(96, 120, 60, .14);
}
.nai-shell .corner-back { border-radius: 50%; color: var(--nai-green); background: var(--nai-card); font-weight: 700; }
.nai-shell .menu-emblem {
  width: 168px;
  height: 168px;
  padding: 0;
  border: 2px solid rgba(168, 196, 128, .7);
  filter: drop-shadow(0 8px 14px rgba(96, 120, 60, .2));
}
.nai-shell .menu-screen h1 {
  margin-top: 2px;
  color: #23512d !important;
  font-size: clamp(32px, 9vw, 42px);
  font-weight: 900;
  letter-spacing: .02em;
  text-shadow: none;
}
.nai-shell .menu-tagline { color: #5c7a4a; background: rgba(226, 240, 200, .9); font-weight: 600; }
.nai-shell .best-score-box { border-radius: 18px; background: var(--nai-card); }
.nai-shell .best-score-box span { color: var(--nai-muted); font-weight: 700; }
.nai-shell .best-score-box strong { color: #23512d; }
.nai-shell .game-button { border-radius: 16px; font-weight: 800; letter-spacing: 0; }
.nai-shell .game-button:active { transform: translateY(1px); box-shadow: 0 2px 6px rgba(96, 120, 60, .16); }
.nai-shell .game-button--start { border-color: transparent; background: #4f9a5c; }
.nai-shell .game-button--achievement { border-color: transparent; color: #5a3d00; background: #ffd76a; }
.nai-shell .game-button--ranking { border-color: transparent; background: #6fae8f; }
.nai-shell .game-button--secondary { color: var(--nai-green); background: #e9f3d3; }
.nai-shell .menu-footnote { color: var(--nai-muted); font-weight: 600; }

/* 排行、成就、战绩、设置几个面板 */
.nai-shell .panel-header { border-bottom: 1.5px solid var(--nai-line); background: #fffdf0; }
.nai-shell .panel-header h2 { color: #23512d !important; font-weight: 800; }
.nai-shell .panel-header button,
.nai-shell .panel-login {
  border: 1.5px solid var(--nai-line);
  border-radius: 999px;
  color: var(--nai-green);
  background: #eef5d8;
  box-shadow: none;
  font-weight: 700;
}
.nai-shell .panel-login { border-radius: 16px; color: #fff; background: #4f9a5c; }
.nai-shell .ranking-summary div,
.nai-shell .ranking-list li,
.nai-shell .history-list li,
.nai-shell .achievement-list article,
.nai-shell .setting-row {
  border: 1.5px solid var(--nai-line);
  border-radius: 16px;
  background: rgba(255, 253, 240, .92);
  box-shadow: none;
}
.nai-shell .ranking-summary button { border: 0; border-radius: 14px; background: #4f9a5c; font-weight: 700; }
.nai-shell .ranking-list li.me,
.nai-shell .achievement-list article.unlocked { border-color: #f0c04a; background: #fff6cf; }
.nai-shell .ranking-list li > strong,
.nai-shell .history-list li > b,
.nai-shell .panel-counter b { color: #23512d; }
.nai-shell .setting-row button { border: 0; border-radius: 999px; background: #b9c2ac; }
.nai-shell .setting-row button.active { background: #4f9a5c; }
.nai-shell .flight-settings-panel > p { color: #53664a; text-align: left; }

.nai-guide {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px 4px;
  margin: 2px 0 14px;
}
.nai-guide span { display: grid; justify-items: center; gap: 2px; line-height: 1.2; }
.nai-guide canvas { width: 48px; height: 48px; }
.nai-guide b { color: #2f4a2a; font-size: 11px; font-weight: 700; }
.nai-guide small { color: var(--nai-muted); font-size: 9px; }

/* 对局里的浮层 */
.nai-shell .score-board,
.nai-next,
.nai-shell .game-controls button,
.nai-banner,
.nai-shell .ready-hint {
  border: 1.5px solid var(--nai-line);
  background: var(--nai-card);
  box-shadow: 0 6px 16px rgba(96, 120, 60, .14);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: var(--ink);
}
.nai-shell .score-board {
  top: 10px;
  left: 10px;
  min-width: 78px;
  place-items: start;
  padding: 8px 12px 9px;
  border-radius: 18px;
}
.nai-shell .score-board span { color: var(--nai-muted); font-size: 10px; font-weight: 700; }
.nai-shell .score-board strong { margin: 2px 0 1px; color: #23512d; font-size: 24px; font-weight: 900; letter-spacing: -.02em; }
.nai-shell .score-board small { color: var(--nai-muted); font-size: 10px; font-weight: 600; }

.nai-next {
  position: absolute;
  top: 10px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 7px 5px 13px;
  border-radius: 999px;
  transform: translateX(-50%);
}
.nai-next small { color: var(--nai-muted); font-size: 11px; font-weight: 700; white-space: nowrap; }
.nai-next canvas { width: 40px; height: 40px; }

.nai-shell .game-controls { top: 10px; right: 10px; gap: 6px; }
.nai-shell .game-controls button {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: var(--nai-green);
  font-size: 15px;
  font-weight: 800;
}
.nai-shell .game-controls button:active { background: #eef5d8; }

.nai-shell .ready-hint {
  top: 44%;
  width: min(80%, 300px);
  padding: 16px 16px 15px;
  border-radius: 22px;
}
.nai-shell .ready-flight-mark { margin: 0 0 6px; font-size: 30px; transform: none; }
.nai-shell .ready-hint h2 { margin: 0 0 6px; color: #23512d !important; font-size: 17px; font-weight: 800; text-shadow: none; }
.nai-shell .ready-hint p { color: #647558; font-size: 12px; font-weight: 500; line-height: 1.55; }

.nai-banner {
  position: absolute;
  top: 17%;
  left: 50%;
  padding: 8px 18px;
  border-color: rgba(255, 196, 70, .8);
  border-radius: 999px;
  color: #6a4a00;
  background: rgba(255, 244, 196, .95);
  font-size: 15px;
  font-weight: 800;
  white-space: nowrap;
  transform: translateX(-50%);
  animation: nai-pop .3s cubic-bezier(.2, 1.4, .4, 1) both;
}
@keyframes nai-pop {
  from { opacity: 0; transform: translateX(-50%) scale(.8); }
  to { opacity: 1; transform: translateX(-50%) scale(1); }
}

/* 暂停和结算 */
.nai-shell .modal-shade { background: rgba(70, 86, 46, .34); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.nai-shell .game-modal {
  width: min(100%, 300px);
  padding: 22px 20px 16px;
  border: 1.5px solid var(--nai-line);
  border-radius: 24px;
  background: #fffdf0;
  box-shadow: 0 18px 44px rgba(70, 90, 40, .28);
}
.nai-shell .modal-icon { color: var(--nai-green); font-size: 26px; }
.nai-shell .game-modal h2 { margin: 6px 0 2px; color: #23512d !important; font-size: 19px; font-weight: 800; }
.nai-shell .game-modal p { color: #6f7f62; font-size: 12px; }
.nai-shell .game-modal .game-button { min-height: 46px; border: 0; box-shadow: none; font-size: 15px; }
.nai-shell .game-modal .game-button:active { transform: none; background: #418550; }
.nai-shell .plain-button { margin-top: 12px; color: #6f7f62; font-weight: 600; }
.nai-shell .result-label { display: table; margin: 0 auto 2px; padding: 4px 10px; color: var(--nai-green); background: #e4f1d2; font-weight: 700; }
.nai-shell .final-score { color: #23512d; font-size: 60px; font-weight: 900; letter-spacing: -.03em; }
.nai-shell .final-unit { color: #6f7f62; font-weight: 600; }
.nai-shell .result-stats { grid-template-columns: repeat(3, 1fr); gap: 6px; }
.nai-shell .result-stats span { padding: 8px 4px; border: 0; border-radius: 14px; background: #eef4dc; }
.nai-shell .result-stats small { color: var(--nai-muted); font-size: 10px; }
.nai-shell .result-stats b { color: #2f4a2a; font-size: 13px; font-weight: 700; }
.nai-shell .cloud-result { color: #8a6a1c; font-weight: 600; }
.nai-shell .cloud-result.success { color: var(--nai-green); }
.nai-shell .new-unlocks b { color: #6a4a00; background: #fdeebf; font-weight: 600; }

@media (max-width: 600px) {
  .nai-shell { background: #fff9dc; }
  .nai-shell .game-phone { border: 0; border-radius: 0; box-shadow: none; }
}

@media (max-height: 720px) {
  .nai-shell .menu-emblem { width: 124px; height: 124px; }
  .nai-shell .menu-screen h1 { font-size: 32px; }
}

@media (max-height: 620px) {
  .nai-shell .menu-emblem { width: 88px; height: 88px; }
  .nai-shell .menu-screen h1 { font-size: 28px; }
}

@media (prefers-reduced-motion: reduce) {
  .nai-banner { animation: none; }
}
</style>
