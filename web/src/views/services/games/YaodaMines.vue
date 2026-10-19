<template>
  <main class="flight-shell mn-shell">
    <section ref="phoneEl" class="game-phone">
      <canvas
        v-show="screen === 'game'"
        ref="canvasEl"
        class="game-canvas"
        role="img"
        aria-label="清扫药大雷游戏区域"
        tabindex="0"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerEnd"
        @pointercancel="handlePointerEnd"
        @contextmenu.prevent
      ></canvas>

      <section v-if="screen === 'menu'" class="menu-screen">
        <button data-cpu-button="surface" type="button" class="corner-back" aria-label="返回小游戏" @click="router.push(MINI_GAMES_PATH)">←</button>
        <canvas ref="menuArtEl" class="menu-emblem" width="248" height="248" role="img" aria-label="拿着探雷器的药大学生和一颗胶囊雷"></canvas>
        <h1>清扫药大雷</h1>
        <p class="menu-tagline">推理排雷不用猜 · 和下课铃赛跑</p>
        <div class="best-score-box">
          <span>最高分</span>
          <strong>{{ displayBest }}</strong>
        </div>
        <div class="menu-actions">
          <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click="startGame">开始扫雷</button>
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
        <div class="mn-clock" :class="{ warn: timeLeft <= 15, danger: timeLeft <= 8 && gamePhase === 'playing' }" :aria-label="`倒计时 ${timerText} 秒`">
          <small>倒计时</small>
          <b>{{ timerText }}</b>
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
        <p ref="levelEl" class="mn-level">
          <span>第 {{ level }} 关 · {{ placeName }}</span>
          <span class="mn-mines-left"><img :src="capsuleIcon" alt="" />剩 {{ minesLeft }} 颗</span>
        </p>

        <div v-if="gamePhase === 'ready'" class="ready-hint">
          <h2>点任意一格开始</h2>
          <p>第一下必定安全。数字是周围八格里有几颗雷；每一盘都能靠推理扫完，用不着猜。长按插旗，点数字可以把周围一起翻开。</p>
        </div>

        <div v-if="banner" :key="banner.id" class="mn-banner" :class="banner.tone" role="status">{{ banner.text }}</div>

        <div ref="toolbarEl" class="mn-toolbar">
          <div class="mn-mode" role="radiogroup" aria-label="点格子时">
            <button data-cpu-button="surface" type="button" role="radio" :aria-checked="mode === 'open'" :class="{ active: mode === 'open' }" @click.stop="setMode('open')">⛏ 翻开</button>
            <button data-cpu-button="surface" type="button" role="radio" :aria-checked="mode === 'flag'" :class="{ active: mode === 'flag' }" @click.stop="setMode('flag')"><img :src="flagIcon" alt="" />插旗</button>
          </div>
          <p>{{ mode === "open" ? "点一下翻开 · 长按插旗" : "点一下插旗 · 长按翻开" }}</p>
        </div>

        <div v-if="gamePhase === 'paused'" class="modal-shade">
          <div class="game-modal">
            <span class="modal-icon">⏸</span>
            <h2>先歇一会儿</h2>
            <p>第 {{ level }} 关 · 当前 {{ score }} 分 · 倒计时停在 {{ timerText }} 秒</p>
            <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click.stop="togglePause">接着扫</button>
            <button data-cpu-button="surface" type="button" class="plain-button" @click.stop="returnToMenu">返回主页</button>
          </div>
        </div>

        <div v-if="gamePhase === 'over' && showResult" class="modal-shade">
          <div class="game-modal result-modal">
            <span class="result-label">{{ isNewRecord ? "新纪录！" : resultTitle }}</span>
            <strong class="final-score">{{ score }}</strong>
            <span class="final-unit">分</span>
            <div class="mn-cause">
              <canvas ref="causeArtEl" width="96" height="96" aria-hidden="true"></canvas>
              <span><b>{{ causeName }}</b><small>{{ causeLine }}</small></span>
            </div>
            <div class="result-stats">
              <span><small>历史最高</small><b>{{ displayBest }}</b></span>
              <span><small>清完</small><b>{{ boards }} 关</b></span>
              <span><small>称号</small><b>{{ rankTitle }}</b></span>
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
                <small>{{ entry.games }} 局 · {{ entry.achievementCount }} 枚成就 · 最多清完 {{ entry.bestBoards }} 关</small>
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
                <b>{{ achievement.title }}</b>
                <small>{{ achievement.description }}</small>
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
              <small>{{ formatHistoryDate(item.playedAt) }} · 清完 {{ item.boards }} 关</small>
              <em>{{ minesRank(item.score) }}</em>
            </li>
          </ol>
          <div v-else class="empty-panel">暂无历史战绩，快去扫一局吧！</div>
        </div>

        <div v-else class="panel-scroll flight-settings-panel">
          <div class="setting-row">
            <span><b>游戏音效</b><small>翻开、插旗、过关的提示音</small></span>
            <button data-cpu-button="surface" type="button" :class="{ active: soundEnabled }" @click="toggleSound">{{ soundEnabled ? "开启" : "关闭" }}</button>
          </div>
          <div class="setting-row">
            <span><b>云端档案</b><small>{{ isLoggedIn ? "排行榜、局数和成就自动保存" : "当前成绩仅保存在这台设备" }}</small></span>
            <button data-cpu-button="surface" v-if="!isLoggedIn" type="button" @click="goToLogin">登录</button>
            <b v-else class="cloud-online">已连接</b>
          </div>
          <p>玩法：翻开所有不是雷的格子就过关。格子上的数字是它周围八格里一共有几颗雷。每一关的第一下必定安全，而且每一盘都能只靠推理扫完，不用猜。</p>
          <p>倒计时：开局 {{ MINES_RULES.startSeconds }} 秒，过一关加一些时间，场地越大加得越多；从第 9 关起场地不再变大，过关加的时间却越来越少。踩到一颗雷或者时间用完，这一局就结束。</p>
          <p>得分：翻开一格 {{ MINES_RULES.cellScore }} 分；清完一关，这一关每颗雷再加 {{ MINES_RULES.mineScore }} 分。</p>
          <div class="mn-guide">
            <span v-for="(kind, index) in MINE_KINDS" :key="kind.name">
              <canvas ref="guideEls" width="96" height="96" aria-hidden="true"></canvas>
              <b>{{ kind.name }}</b>
              <small>{{ kind.line }}</small>
            </span>
          </div>
          <p>操作：点一下翻开，长按插旗（下方可以切成“点一下插旗、长按翻开”）。点一个已经翻开的数字，它周围插够了旗，就把其余的邻格一起翻开。电脑上左键翻开、右键插旗；F 切换点击方式，P 暂停，Esc 返回主页。</p>
        </div>
      </section>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { getToken } from "@/api/request";
import { useAuthStore } from "@/stores/auth";
import {
  yaodaMinesApi,
  type YaodaMinesAchievement,
  type YaodaMinesLeaderboard,
  type YaodaMinesRankingEntry,
} from "@/api/yaodaMines";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { MINI_GAMES_PATH } from "@/data/miniGames";
import capsuleIcon from "@/assets/yaoda-mines/mine-capsule.webp";
import flagIcon from "@/assets/yaoda-mines/flag.webp";
import {
  CELL_OPEN,
  createMinesState,
  MINE_KINDS,
  MINES_PLACES,
  MINES_RULES,
  minesFlag,
  minesLevel,
  minesOpen,
  minesRank,
  minesStep,
  type MinesState,
} from "./yaodaMinesEngine";
import {
  createMinesFx,
  drawMinesIcon,
  drawMinesMenuArt,
  drawMinesScene,
  minesArtReady,
  minesCellAt,
  minesFxSync,
  minesLayout,
  MINES_DEFAULT_INSETS,
  MINES_FLOATER_SECONDS,
  type MinesFloater,
  type MinesFx,
  type MinesInsets,
} from "./yaodaMinesScene";

type Screen = "menu" | "game" | "ranking" | "achievements" | "history" | "settings";
type GamePhase = "ready" | "playing" | "paused" | "over";
type Mode = "open" | "flag";
type HistoryItem = { score: number; boards: number; playedAt: string };

const router = useRouter();
const auth = useAuthStore();
const phoneEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const menuArtEl = ref<HTMLCanvasElement | null>(null);
const causeArtEl = ref<HTMLCanvasElement | null>(null);
const levelEl = ref<HTMLElement | null>(null);
const toolbarEl = ref<HTMLElement | null>(null);
const guideEls = ref<HTMLCanvasElement[]>([]);
const screen = ref<Screen>("menu");
const gamePhase = ref<GamePhase>("ready");
const mode = ref<Mode>("open");
const score = ref(0);
const boards = ref(0);
const level = ref(1);
const minesLeft = ref(0);
const timeLeft = ref<number>(MINES_RULES.startSeconds);
const timerText = ref(String(MINES_RULES.startSeconds));
const showResult = ref(false);
const banner = ref<{ id: number; text: string; tone: "info" | "good" | "bad" } | null>(null);
const bestScore = ref(0);
const history = ref<HistoryItem[]>([]);
const soundEnabled = ref(true);
const isNewRecord = ref(false);
const leaderboard = ref<YaodaMinesRankingEntry[]>([]);
const cloudMe = ref<YaodaMinesRankingEntry | null>(null);
const totalPlayers = ref(0);
const leaderboardLoading = ref(false);
const leaderboardError = ref("");
const achievements = ref<YaodaMinesAchievement[]>([]);
const newlyUnlocked = ref<YaodaMinesLeaderboard["newlyUnlocked"]>([]);
const cloudSubmitState = ref<"idle" | "syncing" | "success" | "error" | "guest">("idle");
const cloudSubmitDetail = ref("");
const causeKind = ref<number | null>(null);

const WORLD_WIDTH = 420;
/** 按住这么久算长按。 */
const LONG_PRESS_MS = 340;
/** 手指按下后挪动超过这么多像素，这一下就不算了。 */
const PRESS_SLOP = 14;
const STORAGE_PREFIX = "cpu-web:yaoda-mines:v1";

let game: MinesState = createMinesState(1);
let fx: MinesFx = createMinesFx();
let floaters: MinesFloater[] = [];
/** 正按着的那一格：按下的位置、时刻，以及长按是不是已经触发过了。 */
let press: { id: number; cellX: number; cellY: number; clientX: number; clientY: number; at: number; fired: boolean } | null = null;
let worldHeight = 700;
/** 场地上下要让开的浮层高度（画布坐标），每次尺寸变化时从页面上量。 */
let insets: MinesInsets = MINES_DEFAULT_INSETS;
let lastFrameAt = 0;
let animationFrame = 0;
let bannerSeq = 0;
let bannerTimer = 0;
let resultTimer = 0;
let overAt = 0;
let lastWarnSecond = -1;
let unmounted = false;
let resizeObserver: ResizeObserver | null = null;
let canvasContext: CanvasRenderingContext2D | null = null;
let audioContext: AudioContext | null = null;
let cloudAttemptPromise: Promise<number | null> = Promise.resolve(null);
let cloudSettlementPromise: Promise<void> = Promise.resolve();
let gameGeneration = 0;

const isLoggedIn = computed(() => Boolean(getToken()));
const displayBest = computed(() => Math.max(bestScore.value, cloudMe.value?.bestScore ?? 0));
const rankTitle = computed(() => minesRank(score.value));
const placeName = computed(() => placeFor(level.value));
const resultTitle = computed(() => causeKind.value === null ? "时间到" : "踩到雷了");
const causeName = computed(() => causeKind.value === null ? "下课铃" : MINE_KINDS[causeKind.value].name);
const causeLine = computed(() => causeKind.value === null ? "铃声响了，雷还没扫完" : MINE_KINDS[causeKind.value].line);
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
  mode.value = readStorage(STORAGE_PREFIX + ":mode") === "flag" ? "flag" : "open";
  window.addEventListener("keydown", handleKeydown);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  resizeObserver = new ResizeObserver(resizeCanvas);
  if (phoneEl.value) resizeObserver.observe(phoneEl.value);
  void initializeCloud();
  nextTick(() => {
    resizeCanvas();
    drawMenuArt();
  });
  // 图片到了以后，把已经画出去的招牌图和小图标重画一遍。
  void minesArtReady.then(() => {
    if (unmounted) return;
    drawMenuArt();
    drawGuide();
    drawCauseArt();
    if (screen.value === "game") drawScene();
  });
});

onBeforeUnmount(() => {
  unmounted = true;
  document.documentElement.classList.remove("yaoda-flight-open");
  if (gamePhase.value === "playing" || gamePhase.value === "paused") {
    cloudSettlementPromise = abandonCloudAttempt(cloudAttemptPromise);
  }
  cancelAnimationFrame(animationFrame);
  window.clearTimeout(bannerTimer);
  window.clearTimeout(resultTimer);
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", handleKeydown);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  void audioContext?.close();
});

function placeFor(value: number) {
  if (value <= MINES_PLACES.length) return MINES_PLACES[value - 1];
  return `${MINES_PLACES[MINES_PLACES.length - 1]} 第 ${value - MINES_PLACES.length + 1} 场`;
}

function openScreen(value: Screen) {
  screen.value = value;
  if (value === "ranking" || value === "achievements") void loadLeaderboard(true);
  if (value === "settings") nextTick(drawGuide);
}

function drawGuide() {
  for (const [index, canvas] of guideEls.value.entries()) {
    const context = canvas.getContext("2d");
    if (context) drawMinesIcon(context, index, 96);
  }
}

function drawCauseArt() {
  const context = causeArtEl.value?.getContext("2d");
  if (!context) return;
  if (causeKind.value === null) {
    // 超时没有雷可画，画一只早八闹钟当下课铃。
    drawMinesIcon(context, 0, 96);
  } else drawMinesIcon(context, causeKind.value, 96);
}

function setMode(value: Mode) {
  mode.value = value;
  writeStorage(STORAGE_PREFIX + ":mode", value);
  playTone(value === "flag" ? 700 : 560, 0.04, 0.02);
}

function startGame() {
  cancelAnimationFrame(animationFrame);
  window.clearTimeout(resultTimer);
  game = createMinesState(Math.floor(Math.random() * 0x7fffffff));
  fx = createMinesFx();
  floaters = [];
  press = null;
  screen.value = "game";
  gamePhase.value = "ready";
  showResult.value = false;
  banner.value = null;
  isNewRecord.value = false;
  newlyUnlocked.value = [];
  causeKind.value = null;
  lastWarnSecond = -1;
  cloudSubmitState.value = isLoggedIn.value ? "idle" : "guest";
  cloudSubmitDetail.value = "";
  syncHud();
  nextTick(() => {
    resizeCanvas();
    canvasEl.value?.focus({ preventScroll: true });
    runLoop();
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
}

function returnToMenu() {
  const shouldAbandon = screen.value === "game" && (gamePhase.value === "playing" || gamePhase.value === "paused");
  const pendingAttempt = cloudAttemptPromise;
  gameGeneration += 1;
  if (shouldAbandon) cloudSettlementPromise = abandonCloudAttempt(pendingAttempt);
  cancelAnimationFrame(animationFrame);
  window.clearTimeout(resultTimer);
  press = null;
  screen.value = "menu";
  gamePhase.value = "ready";
  nextTick(drawMenuArt);
}

function togglePause() {
  if (gamePhase.value === "playing") {
    gamePhase.value = "paused";
    press = null;
    cancelAnimationFrame(animationFrame);
    drawScene();
  } else if (gamePhase.value === "paused") {
    gamePhase.value = "playing";
    lastFrameAt = performance.now();
    runLoop();
  }
}

/** 画面一直在动（翻开、插旗、过关、爆炸都有动画），只在暂停和结算停稳以后才停下。 */
function runLoop() {
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(gameLoop);
}

function gameLoop(now: number) {
  if (screen.value !== "game" || gamePhase.value === "paused") return;
  if (gamePhase.value === "playing") {
    const delta = Math.min((now - lastFrameAt) / 1000, 0.05);
    lastFrameAt = now;
    minesStep(game, delta);
    playEvents();
    if (game.phase === "over") finishGame();
  }
  updatePress(now);
  syncHud();
  drawScene();
  if (gamePhase.value === "over" && now - overAt > 2600) return;
  animationFrame = requestAnimationFrame(gameLoop);
}

function cellFromEvent(event: PointerEvent) {
  const canvas = canvasEl.value;
  if (!canvas) return null;
  const bounds = canvas.getBoundingClientRect();
  const scale = bounds.width / WORLD_WIDTH;
  const layout = minesLayout(WORLD_WIDTH, worldHeight, game.board.columns, game.board.rows, insets);
  return minesCellAt(layout, (event.clientX - bounds.left) / scale, (event.clientY - bounds.top) / scale);
}

function canAct() {
  return screen.value === "game" && (gamePhase.value === "ready" || gamePhase.value === "playing") && game.phase === "play";
}

function handlePointerDown(event: PointerEvent) {
  event.preventDefault();
  if (!canAct()) return;
  const cell = cellFromEvent(event);
  if (!cell) return;
  if (event.button === 2) {
    // 右键直接插旗
    act(cell.x, cell.y, "flag");
    return;
  }
  press = { id: event.pointerId, cellX: cell.x, cellY: cell.y, clientX: event.clientX, clientY: event.clientY, at: performance.now(), fired: false };
  try {
    canvasEl.value?.setPointerCapture(event.pointerId);
  } catch {
    // 拿不到指针捕获也能玩，只是滑出画布后不再跟手。
  }
  drawScene();
}

function handlePointerMove(event: PointerEvent) {
  if (!press || press.id !== event.pointerId) return;
  if (Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) > PRESS_SLOP) press = null;
}

function handlePointerEnd(event: PointerEvent) {
  const gesture = press;
  if (!gesture || gesture.id !== event.pointerId) return;
  press = null;
  if (event.type !== "pointerup" || gesture.fired) return;
  // 鼠标中键点数字是连开，引擎里点数字本来就是连开，按“翻开”处理。
  act(gesture.cellX, gesture.cellY, event.button === 1 ? "open" : mode.value);
}

/** 长按：按到时间就做另一种操作，不等抬手。 */
function updatePress(now: number) {
  if (!press || press.fired || !canAct()) return;
  const board = game.board;
  const view = board.view[press.cellY * board.columns + press.cellX];
  if (view === CELL_OPEN) return;
  if (now - press.at < LONG_PRESS_MS) return;
  press.fired = true;
  act(press.cellX, press.cellY, mode.value === "open" ? "flag" : "open");
  try {
    navigator.vibrate?.(14);
  } catch {
    // 不支持震动就算了。
  }
}

function pressHold(now: number) {
  if (!press || press.fired || !canAct() || !game.board.ready) return 0;
  const view = game.board.view[press.cellY * game.board.columns + press.cellX];
  if (view === CELL_OPEN) return 0;
  // 按下后先等一小会儿再显示进度圈，普通点击时不闪。
  return Math.max(0, (now - press.at - 90) / (LONG_PRESS_MS - 90));
}

/** 对 (x, y) 做一次操作。雷还没埋的时候（这一关的第一下）不管哪种操作都算翻开。 */
function act(x: number, y: number, action: Mode) {
  if (!canAct()) return;
  if (gamePhase.value === "ready") beginRound();
  const board = game.board;
  const view = board.view[y * board.columns + x];
  if (action === "flag" && board.ready && view !== CELL_OPEN) minesFlag(game, x, y);
  else minesOpen(game, x, y);
  minesFxSync(fx, game, performance.now() / 1000, { x, y });
  playEvents();
  if (game.phase === "over") finishGame();
  syncHud();
  drawScene();
}

function handleKeydown(event: KeyboardEvent) {
  if (["Space", "Enter"].includes(event.code)) {
    if (event.repeat) return;
    if (screen.value === "menu" || (screen.value === "game" && gamePhase.value === "over" && showResult.value)) {
      event.preventDefault();
      startGame();
    }
    return;
  }
  if (event.code === "KeyF" && screen.value === "game") {
    event.preventDefault();
    setMode(mode.value === "open" ? "flag" : "open");
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

function playEvents() {
  const now = performance.now() / 1000;
  for (const event of game.events) {
    if (event.type === "open") {
      floaters.push({ text: `+${event.score}`, x: event.x, y: event.y, born: now });
      if (event.cells >= 8) {
        playTone(520, 0.05, 0.03);
        window.setTimeout(() => playTone(760, 0.08, 0.03), 45);
      } else playTone(640 + Math.min(4, event.cells) * 30, 0.04, 0.03);
    } else if (event.type === "flag") {
      playTone(event.on ? 880 : 440, 0.05, 0.03);
    } else if (event.type === "boom") {
      playNoise(0.45, 0.16);
      playTone(110, 0.4, 0.07);
      try {
        navigator.vibrate?.([60, 40, 120]);
      } catch {
        // 不支持震动就算了。
      }
    } else if (event.type === "clear") {
      showBanner(`第 ${event.level} 关扫完！+${event.score} 分 · +${event.seconds} 秒`, "good");
      [523, 659, 784, 1047].forEach((frequency, index) => window.setTimeout(() => playTone(frequency, 0.12, 0.04), index * 70));
    } else if (event.type === "next") {
      const spec = minesLevel(event.level);
      showBanner(`第 ${event.level} 关 · ${placeFor(event.level)} · ${spec.columns}×${spec.rows} · ${spec.mines} 颗雷`, "info");
      playTone(600, 0.06, 0.03);
    } else if (event.type === "timeout") {
      playTone(330, 0.25, 0.05);
      window.setTimeout(() => playTone(247, 0.4, 0.05), 200);
    }
  }
  game.events.length = 0;
  if (floaters.length && now - floaters[0].born >= MINES_FLOATER_SECONDS) {
    floaters = floaters.filter((floater) => now - floater.born < MINES_FLOATER_SECONDS);
  }
}

function showBanner(text: string, tone: "info" | "good" | "bad") {
  bannerSeq += 1;
  banner.value = { id: bannerSeq, text, tone };
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => {
    banner.value = null;
  }, 1900);
}

function syncHud() {
  score.value = game.score;
  boards.value = game.boards;
  level.value = game.board.level;
  minesLeft.value = game.board.mines - game.board.flags;
  timeLeft.value = game.timeLeft;
  const text = game.timeLeft < 10 ? game.timeLeft.toFixed(1) : String(Math.ceil(game.timeLeft));
  if (timerText.value !== text) timerText.value = text;
  // 最后几秒每秒滴一声
  const second = Math.ceil(game.timeLeft);
  if (gamePhase.value === "playing" && game.phase === "play" && second <= 8 && second !== lastWarnSecond) {
    lastWarnSecond = second;
    playTone(second <= 3 ? 990 : 820, 0.05, 0.03);
  }
}

function finishGame() {
  if (gamePhase.value !== "playing") return;
  gamePhase.value = "over";
  overAt = performance.now();
  press = null;
  causeKind.value = game.cause === "mine" && game.hit ? game.hit.kind : null;
  minesFxSync(fx, game, overAt / 1000, game.hit);
  if (game.cause === "mine" && game.hit) showBanner(`踩雷：${MINE_KINDS[game.hit.kind].name}！`, "bad");
  else showBanner("时间到！", "bad");
  // 和账号在别的设备上的最好成绩比，不只看这台设备。
  isNewRecord.value = game.score > displayBest.value;
  if (game.score > bestScore.value) {
    bestScore.value = game.score;
    writeStorage(STORAGE_PREFIX + ":best", String(bestScore.value));
  }
  const item: HistoryItem = { score: game.score, boards: game.boards, playedAt: new Date().toISOString() };
  history.value = [item, ...history.value].slice(0, 30);
  writeStorage(STORAGE_PREFIX + ":history", JSON.stringify(history.value));
  const generation = gameGeneration;
  const result = { score: game.score, boards: game.boards, cells: game.cells, durationMs: Math.max(0, Math.round(game.time * 1000)) };
  cloudSettlementPromise = finishCloudAttempt(cloudAttemptPromise, generation, result);
  // 先让人看清雷都在哪，再弹结算
  window.clearTimeout(resultTimer);
  resultTimer = window.setTimeout(() => {
    if (generation !== gameGeneration || screen.value !== "game") return;
    banner.value = null;
    showResult.value = true;
    nextTick(drawCauseArt);
  }, 1500);
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
  // 浮层按 CSS 像素排版，场地按画布坐标排版：量出浮层占了多高，换算过来让开。
  const frame = phone.getBoundingClientRect();
  const level = levelEl.value?.getBoundingClientRect();
  const toolbar = toolbarEl.value?.getBoundingClientRect();
  insets = level && toolbar && level.height && toolbar.height
    ? { top: (level.bottom - frame.top) / scale, bottom: (frame.bottom - toolbar.top) / scale }
    : MINES_DEFAULT_INSETS;
  drawScene();
}

function drawScene() {
  if (!canvasContext || screen.value !== "game") return;
  const now = performance.now();
  minesFxSync(fx, game, now / 1000, null);
  drawMinesScene(canvasContext, {
    width: WORLD_WIDTH,
    height: worldHeight,
    insets,
    game,
    fx,
    now: now / 1000,
    press: press && !press.fired && game.phase === "play" ? { x: press.cellX, y: press.cellY, hold: pressHold(now) } : null,
    covered: gamePhase.value === "paused",
    floaters,
  });
}

function drawMenuArt() {
  const context = menuArtEl.value?.getContext("2d");
  if (context) drawMinesMenuArt(context, 248);
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

/** 爆炸声：一段衰减的噪声。 */
function playNoise(duration: number, volume: number) {
  if (!soundEnabled.value) return;
  ensureAudio();
  if (!audioContext) return;
  if (audioContext.state === "suspended") void audioContext.resume();
  const length = Math.floor(audioContext.sampleRate * duration);
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 2;
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.value = 900;
  gain.gain.value = volume;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioContext.destination);
  source.start();
}

async function loadLeaderboard(force = false) {
  if (leaderboardLoading.value) return;
  leaderboardLoading.value = true;
  leaderboardError.value = "";
  try {
    applyLeaderboard(await yaodaMinesApi.leaderboard({ cacheTtlMs: force ? 0 : 15_000 }));
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
    const attempt = await yaodaMinesApi.startAttempt({
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
    await yaodaMinesApi.abandonAttempt(attemptId, {
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
  result: { score: number; boards: number; cells: number; durationMs: number },
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
    const board = await yaodaMinesApi.finishAttempt(attemptId, result, {
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

function applyLeaderboard(value: YaodaMinesLeaderboard) {
  leaderboard.value = value.leaderboard;
  cloudMe.value = value.me;
  totalPlayers.value = value.totalPlayers;
  achievements.value = value.achievements;
  newlyUnlocked.value = value.newlyUnlocked;
}

function achievementPercent(item: YaodaMinesAchievement) {
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

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readNumber(key: string) {
  const value = Number(readStorage(key));
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function readBoolean(key: string, fallback: boolean) {
  const value = readStorage(key);
  return value === null ? fallback : value === "true";
}

function readHistory(): HistoryItem[] {
  try {
    const parsed = JSON.parse(readStorage(STORAGE_PREFIX + ":history") || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => Number.isFinite(Number(item?.score)) && typeof item?.playedAt === "string")
      .slice(0, 30)
      .map((item) => ({
        score: Math.max(0, Math.floor(Number(item.score))),
        boards: Math.max(0, Math.floor(Number(item.boards) || 0)),
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
/* 薄荷绿配深青，橙色点缀；共用外壳里的粗边框和硬投影在这一页都换掉。 */
.mn-shell {
  --ink: #17363b;
  --cyan: #e4f5f0;
  --blue: #2f9e8d;
  --blue-dark: #1f7a6d;
  --school-blue: #1f7a6d;
  --mn-deep: #0f3138;
  --mn-teal: #2f9e8d;
  --mn-orange: #f08a24;
  --mn-line: rgba(47, 158, 141, .32);
  --mn-card: rgba(255, 255, 255, .9);
  --mn-muted: #5f7f7a;
  /* 对局里的浮层压在不停重画的画布上，不用毛玻璃，用不透明一点的深色底。 */
  --mn-glass: rgba(6, 26, 30, .82);
  --mn-glass-line: rgba(170, 240, 225, .16);
  --mn-text: #effaf7;
  --mn-text-muted: rgba(239, 250, 247, .62);
  background:
    radial-gradient(circle at 50% 0%, rgba(70, 160, 145, .7), transparent 45%),
    linear-gradient(160deg, #10343b, #081a1f 70%);
  font-family: ui-rounded, "SF Pro Rounded", "HarmonyOS Sans SC", "PingFang SC", system-ui, sans-serif;
}

.mn-shell .game-phone {
  border: 1.5px solid rgba(170, 240, 225, .22);
  border-radius: 26px;
  background: #0d2a31;
  box-shadow: 0 18px 44px rgba(0, 0, 0, .4);
}
.mn-shell .game-canvas { background: #0d2a31; cursor: pointer; touch-action: none; -webkit-touch-callout: none; }

.mn-shell .menu-screen {
  background:
    radial-gradient(circle at 18% 6%, rgba(255, 255, 255, .95), transparent 42%),
    linear-gradient(180deg, #f1fbf8, #c8ebe2);
}
.mn-shell .corner-back,
.mn-shell .best-score-box,
.mn-shell .game-button {
  border: 1.5px solid var(--mn-line);
  box-shadow: 0 6px 16px rgba(20, 80, 70, .14);
}
.mn-shell .corner-back { border-radius: 50%; color: var(--mn-deep); background: var(--mn-card); font-weight: 700; }
.mn-shell .menu-emblem {
  width: 184px;
  height: 184px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: none;
  box-shadow: none;
  filter: drop-shadow(0 10px 14px rgba(20, 80, 70, .22));
}
.mn-shell .menu-screen h1 {
  margin-top: 2px;
  color: var(--mn-deep) !important;
  font-size: clamp(32px, 9vw, 42px);
  font-weight: 900;
  letter-spacing: .04em;
  text-shadow: none;
}
.mn-shell .menu-tagline { color: #1f6f63; background: rgba(255, 255, 255, .78); font-weight: 600; }
.mn-shell .best-score-box { border-radius: 18px; background: var(--mn-card); }
.mn-shell .best-score-box span { color: var(--mn-muted); font-weight: 700; }
.mn-shell .best-score-box strong { color: #d9531e; }
.mn-shell .game-button { border-radius: 16px; font-weight: 800; letter-spacing: 0; }
.mn-shell .game-button:active { transform: translateY(1px); box-shadow: 0 2px 6px rgba(20, 80, 70, .16); }
.mn-shell .game-button--start { border-color: transparent; background: var(--mn-orange); }
.mn-shell .game-button--achievement { border-color: transparent; color: #4a3500; background: #ffd166; }
.mn-shell .game-button--ranking { border-color: transparent; background: #1f7a6d; }
.mn-shell .game-button--secondary { color: var(--mn-deep); background: #e3f4ef; }
.mn-shell .menu-footnote { color: var(--mn-muted); font-weight: 600; }

/* 排行、成就、战绩、设置几个面板 */
.mn-shell .panel-screen { background: #eef8f5; }
.mn-shell .panel-header { border-bottom: 1.5px solid var(--mn-line); background: #f7fcfa; }
.mn-shell .panel-header h2 { color: var(--mn-deep) !important; font-weight: 800; }
.mn-shell .panel-header button,
.mn-shell .panel-login {
  border: 1.5px solid var(--mn-line);
  border-radius: 999px;
  color: var(--mn-deep);
  background: #e3f4ef;
  box-shadow: none;
  font-weight: 700;
}
.mn-shell .panel-login { border-radius: 16px; color: #fff; background: var(--mn-orange); }
.mn-shell .ranking-summary div,
.mn-shell .ranking-list li,
.mn-shell .history-list li,
.mn-shell .achievement-list article,
.mn-shell .setting-row {
  border: 1.5px solid var(--mn-line);
  border-radius: 16px;
  background: rgba(255, 255, 255, .94);
  box-shadow: none;
}
.mn-shell .ranking-summary button { border: 0; border-radius: 14px; background: var(--mn-teal); font-weight: 700; }
.mn-shell .ranking-list li.me,
.mn-shell .achievement-list article.unlocked { border-color: #f3b15b; background: #fff4e2; }
.mn-shell .ranking-list li > strong,
.mn-shell .history-list li > b,
.mn-shell .panel-counter b { color: #d9531e; }
.mn-shell .setting-row button { border: 0; border-radius: 999px; background: #b9cfca; }
.mn-shell .setting-row button.active { background: var(--mn-teal); }
.mn-shell .flight-settings-panel > p { color: #456661; text-align: left; }

.mn-guide { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 2px 0; }
.mn-guide span {
  display: grid;
  grid-template-columns: 40px 1fr;
  align-items: center;
  gap: 0 8px;
  padding: 8px 9px;
  border: 1.5px solid var(--mn-line);
  border-radius: 14px;
  background: rgba(255, 255, 255, .94);
  line-height: 1.35;
  text-align: left;
}
.mn-guide canvas { grid-row: span 2; width: 40px; height: 40px; }
.mn-guide b { color: var(--mn-deep); font-size: 13px; font-weight: 700; }
.mn-guide small { color: var(--mn-muted); font-size: 11px; }

/* 对局里的浮层 */
.mn-shell .score-board,
.mn-clock,
.mn-shell .game-controls button,
.mn-level span,
.mn-banner,
.mn-mode,
.mn-shell .ready-hint {
  border: 1px solid var(--mn-glass-line);
  background: var(--mn-glass);
  box-shadow: 0 8px 18px rgba(0, 0, 0, .22);
  color: var(--mn-text);
}
.mn-shell .score-board {
  top: 10px;
  left: 10px;
  min-width: 78px;
  place-items: start;
  padding: 8px 12px 9px;
  border-radius: 16px;
}
.mn-shell .score-board span { color: var(--mn-text-muted); font-size: 10px; font-weight: 700; }
.mn-shell .score-board strong { margin: 2px 0 1px; color: #ffd27a; font-size: 24px; font-weight: 900; letter-spacing: -.02em; }
.mn-shell .score-board small { color: var(--mn-text-muted); font-size: 10px; font-weight: 600; }

.mn-clock {
  position: absolute;
  top: 10px;
  left: 50%;
  display: grid;
  min-width: 92px;
  place-items: center;
  padding: 7px 14px 8px;
  border-radius: 16px;
  line-height: 1;
  transform: translateX(-50%);
}
.mn-clock small { color: var(--mn-text-muted); font-size: 10px; font-weight: 700; }
.mn-clock b { margin-top: 3px; color: #8ff0d9; font-size: 26px; font-weight: 900; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.mn-clock.warn b { color: #ffc35c; }
.mn-clock.danger { border-color: rgba(255, 110, 90, .6); animation: mn-pulse .5s ease-in-out infinite alternate; }
.mn-clock.danger b { color: #ff7a62; }
@keyframes mn-pulse {
  from { transform: translateX(-50%) scale(1); }
  to { transform: translateX(-50%) scale(1.06); }
}

.mn-shell .game-controls { top: 10px; right: 10px; gap: 6px; }
.mn-shell .game-controls button {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  font-size: 15px;
  font-weight: 800;
}
.mn-shell .game-controls button:active { background: rgba(30, 80, 80, .9); }

.mn-level {
  position: absolute;
  top: 74px;
  right: 0;
  left: 0;
  display: flex;
  justify-content: center;
  gap: 6px;
  margin: 0;
}
.mn-level span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.mn-mines-left img { width: 16px; height: 16px; object-fit: contain; }

.mn-shell .ready-hint {
  top: 46%;
  width: min(84%, 310px);
  padding: 15px 16px 14px;
  border-radius: 20px;
}
.mn-shell .ready-hint h2 { margin: 0 0 6px; color: #ffd27a !important; font-size: 17px; font-weight: 800; text-shadow: none; }
.mn-shell .ready-hint p { color: rgba(239, 250, 247, .78); font-size: 12px; font-weight: 500; line-height: 1.6; }

.mn-banner {
  position: absolute;
  top: 112px;
  left: 50%;
  max-width: calc(100% - 24px);
  overflow: hidden;
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
  transform: translateX(-50%);
  animation: mn-pop .3s cubic-bezier(.2, 1.4, .4, 1) both;
}
.mn-banner.good { border-color: rgba(143, 240, 217, .5); color: #8ff0d9; }
.mn-banner.bad { border-color: rgba(255, 122, 98, .6); color: #ffb3a3; }
@keyframes mn-pop {
  from { opacity: 0; transform: translateX(-50%) scale(.8); }
  to { opacity: 1; transform: translateX(-50%) scale(1); }
}

.mn-toolbar {
  position: absolute;
  right: 0;
  bottom: max(10px, var(--game-safe-bottom));
  left: 0;
  display: grid;
  justify-items: center;
  gap: 5px;
}
.mn-mode {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
}
.mn-mode button {
  display: inline-flex;
  min-width: 96px;
  height: 38px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 0;
  border-radius: 999px;
  color: var(--mn-text-muted);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 800;
}
.mn-mode button img { width: 18px; height: 18px; object-fit: contain; }
.mn-mode button.active { color: #0d2a31; background: #8ff0d9; }
.mn-mode button.active:last-child { background: #ffc35c; }
.mn-toolbar p { margin: 0; color: rgba(239, 250, 247, .55); font-size: 11px; font-weight: 600; }

/* 暂停和结算 */
.mn-shell .modal-shade { background: rgba(4, 18, 22, .5); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); }
.mn-shell .game-modal {
  width: min(100%, 304px);
  padding: 22px 20px 16px;
  border: 1.5px solid var(--mn-line);
  border-radius: 24px;
  background: #f7fcfa;
  box-shadow: 0 18px 44px rgba(0, 0, 0, .32);
}
.mn-shell .modal-icon { color: var(--mn-teal); font-size: 26px; }
.mn-shell .game-modal h2 { margin: 6px 0 2px; color: var(--mn-deep) !important; font-size: 19px; font-weight: 800; }
.mn-shell .game-modal p { color: #5f7f7a; font-size: 12px; }
.mn-shell .game-modal .game-button { min-height: 46px; border: 0; box-shadow: none; font-size: 15px; }
.mn-shell .game-modal .game-button:active { transform: none; background: #d9741a; }
.mn-shell .plain-button { margin-top: 12px; color: #5f7f7a; font-weight: 600; }
.mn-shell .result-label { display: table; margin: 0 auto 2px; padding: 4px 10px; color: #b4410f; background: #ffe6d2; font-weight: 700; }
.mn-shell .final-score { color: #d9531e; font-size: 56px; font-weight: 900; letter-spacing: -.03em; }
.mn-shell .final-unit { color: #5f7f7a; font-weight: 600; }
.mn-cause {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 14px;
  background: #e8f5f1;
  text-align: left;
}
.mn-cause canvas { width: 44px; height: 44px; flex: 0 0 auto; }
.mn-cause span { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.mn-cause b { color: var(--mn-deep); font-size: 14px; font-weight: 800; }
.mn-cause small { color: #5f7f7a; font-size: 11px; }
.mn-shell .result-stats { grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 8px; }
.mn-shell .result-stats span { padding: 8px 4px; border: 0; border-radius: 14px; background: #e8f5f1; }
.mn-shell .result-stats small { color: var(--mn-muted); font-size: 10px; }
.mn-shell .result-stats b { color: var(--mn-deep); font-size: 13px; font-weight: 700; }
.mn-shell .cloud-result { color: #9a5d00; font-weight: 600; }
.mn-shell .cloud-result.success { color: #1f7a4d; }
.mn-shell .new-unlocks b { color: #6a4a00; background: #fdeebf; font-weight: 600; }

@media (max-width: 600px) {
  .mn-shell { background: #0d2a31; }
  .mn-shell .game-phone { border: 0; border-radius: 0; box-shadow: none; }
}

@media (max-height: 720px) {
  .mn-shell .menu-emblem { width: 132px; height: 132px; }
  .mn-shell .menu-screen h1 { font-size: 32px; }
}

@media (max-height: 620px) {
  .mn-shell .menu-emblem { width: 92px; height: 92px; }
  .mn-shell .menu-screen h1 { font-size: 28px; }
}

@media (prefers-reduced-motion: reduce) {
  .mn-banner,
  .mn-clock.danger { animation: none; }
}
</style>
