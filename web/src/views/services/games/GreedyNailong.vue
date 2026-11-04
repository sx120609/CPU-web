<template>
  <main class="flight-shell nl-shell">
    <section ref="phoneEl" class="game-phone">
      <canvas
        v-show="screen === 'game'"
        ref="canvasEl"
        class="game-canvas"
        role="img"
        :aria-label="st('药大人能吃游戏区域')"
        tabindex="0"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerEnd"
        @pointercancel="handlePointerEnd"
      ></canvas>

      <section v-if="screen === 'menu'" class="menu-screen">
        <button data-cpu-button="surface" type="button" class="corner-back" aria-label="返回小游戏" @click="router.push(MINI_GAMES_PATH)">←</button>
        <canvas ref="menuArtEl" class="menu-emblem" width="248" height="248" role="img" aria-label="系着围兜、举着刀叉的奶龙"></canvas>
        <h1>{{ st('药大人能吃') }}</h1>
        <p class="menu-tagline">滑动带路，吃得越多身子越长</p>
        <div class="best-score-box">
          <span>最高分</span>
          <strong>{{ displayBest }}</strong>
        </div>
        <div class="menu-actions">
          <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click="startGame">开饭</button>
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
        <div class="nl-length" :aria-label="`身长 ${length} 节`">
          <small>身长</small>
          <b>{{ length }}</b>
          <small>节</small>
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
          <h2>滑动屏幕或按方向键开始</h2>
          <p>往哪边滑，奶龙就往哪边拐；点在它的哪一边，它也会往那边拐。撞到墙或者咬到自己，这一局就结束</p>
        </div>

        <div v-if="banner" :key="banner.id" class="nl-banner" role="status">{{ banner.text }}</div>
        <p class="nl-hint">滑动或点两边转向 · 火锅和消食片过时不候</p>

        <div v-if="gamePhase === 'paused'" class="modal-shade">
          <div class="game-modal">
            <span class="modal-icon">⏸</span>
            <h2>先歇一会儿</h2>
            <p>当前 {{ score }} 分 · 身长 {{ length }} 节</p>
            <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click.stop="togglePause">接着吃</button>
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
              <span><small>最长</small><b>{{ maxLength }} 节</b></span>
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
                <small>{{ entry.games }} 局 · {{ entry.achievementCount }} 枚成就 · 最长 {{ entry.bestLength }} 节</small>
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
              <small>{{ formatHistoryDate(item.playedAt) }} · 最长 {{ item.length }} 节</small>
              <em>{{ nlRank(item.score) }}</em>
            </li>
          </ol>
          <div v-else class="empty-panel">暂无历史战绩，快去吃一局吧！</div>
        </div>

        <div v-else class="panel-scroll flight-settings-panel">
          <div class="setting-row">
            <span><b>游戏音效</b><small>转向、吃东西的提示音</small></span>
            <button data-cpu-button="surface" type="button" :class="{ active: soundEnabled }" @click="toggleSound">{{ soundEnabled ? "开启" : "关闭" }}</button>
          </div>
          <div class="setting-row">
            <span><b>云端档案</b><small>{{ isLoggedIn ? "排行榜、局数和成就自动保存" : "当前成绩仅保存在这台设备" }}</small></span>
            <button data-cpu-button="surface" v-if="!isLoggedIn" type="button" @click="goToLogin">登录</button>
            <b v-else class="cloud-online">已连接</b>
          </div>
          <p>玩法：奶龙会一直往前走，你只管转向。吃到东西就变长，吃得越多走得越快。撞到墙或者咬到自己的身子，这一局就结束。</p>
          <div class="nl-guide">
            <span v-for="item in GUIDE" :key="item.name">
              <canvas ref="guideEls" width="96" height="96" aria-hidden="true"></canvas>
              <b>{{ item.name }}</b>
              <small>{{ item.text }}</small>
            </span>
          </div>
          <p>操作：触屏朝想去的方向滑动，轻轻一划就行，按住不放可以连着拐弯；也可以直接点屏幕，点在奶龙的哪一边，它就往哪一边拐。键盘用方向键或 W A S D，空格开始，P 暂停，Esc 返回主页。</p>
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
  greedyNailongApi,
  type GreedyNailongAchievement,
  type GreedyNailongLeaderboard,
  type GreedyNailongRankingEntry,
} from "@/api/greedyNailong";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { MINI_GAMES_PATH } from "@/data/miniGames";
import {
  createNlState,
  nlRank,
  nlStep,
  nlTurn,
  NL_RULES,
  type NlDirection,
  type NlState,
} from "./greedyNailongEngine";
import { drawNlIcon, drawNlMenuArt, drawNlScene, nlArtReady, nlLayout, NL_FLOATER_SECONDS, type NlFloater } from "./greedyNailongScene";

// 外校显示成本校简称（见 utils/schoolText.ts）。
const st = useSchoolText();

type Screen = "menu" | "game" | "ranking" | "achievements" | "history" | "settings";
type GamePhase = "ready" | "playing" | "paused" | "over";
type HistoryItem = { score: number; length: number; playedAt: string };

const router = useRouter();
const auth = useAuthStore();
const phoneEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const menuArtEl = ref<HTMLCanvasElement | null>(null);
const guideEls = ref<HTMLCanvasElement[]>([]);
const screen = ref<Screen>("menu");
const gamePhase = ref<GamePhase>("ready");
const score = ref(0);
const length = ref<number>(NL_RULES.startLength);
const maxLength = ref<number>(NL_RULES.startLength);
const banner = ref<{ id: number; text: string } | null>(null);
const bestScore = ref(0);
const history = ref<HistoryItem[]>([]);
const soundEnabled = ref(true);
const isNewRecord = ref(false);
const leaderboard = ref<GreedyNailongRankingEntry[]>([]);
const cloudMe = ref<GreedyNailongRankingEntry | null>(null);
const totalPlayers = ref(0);
const leaderboardLoading = ref(false);
const leaderboardError = ref("");
const achievements = ref<GreedyNailongAchievement[]>([]);
const newlyUnlocked = ref<GreedyNailongLeaderboard["newlyUnlocked"]>([]);
const cloudSubmitState = ref<"idle" | "syncing" | "success" | "error" | "guest">("idle");
const cloudSubmitDetail = ref("");

const WORLD_WIDTH = 420;
/** 手指滑过这么多像素算一次转向；抬手时不到这么多、但超过一半的快划也算。 */
const SWIPE_DISTANCE = 10;
/** 按下到抬起不超过这么久、几乎没动，算点了一下。 */
const TAP_MILLISECONDS = 400;
const STORAGE_PREFIX = "cpu-web:greedy-nailong:v1";
const KEY_DIRECTIONS: Record<string, NlDirection> = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};

/** 设置页里讲三样吃的。 */
const GUIDE = [
  { icon: 0, name: "零食", text: `+${NL_RULES.snackScore} 分，长一节。场上一直有一份` },
  { icon: "feast", name: "火锅", text: `每吃 ${NL_RULES.feastEvery} 份零食上一锅，${NL_RULES.feastSeconds} 秒内吃掉；越早吃分越高（${NL_RULES.feastScoreMin} 到 ${NL_RULES.feastScoreMax} 分），长两节` },
  { icon: "pill", name: "消食片", text: `身子长到 ${NL_RULES.pillFromLength} 节以后，每吃 ${NL_RULES.pillEvery} 份零食出一份；+${NL_RULES.pillScore} 分，瘦 ${NL_RULES.pillShrink} 节` },
] as const;

let game: NlState = createNlState(1);
let floaters: NlFloater[] = [];
/** 正在进行的一次触摸：x、y 是上一次转向（或按下）的位置，startX、startY 是按下的位置。 */
let swipeOrigin: { id: number; x: number; y: number; startX: number; startY: number; at: number; turned: boolean } | null = null;
let worldHeight = 700;
let lastFrameAt = 0;
let animationFrame = 0;
let bannerSeq = 0;
let bannerUntil = 0;
let unmounted = false;
let resizeObserver: ResizeObserver | null = null;
let canvasContext: CanvasRenderingContext2D | null = null;
let audioContext: AudioContext | null = null;
let cloudAttemptPromise: Promise<number | null> = Promise.resolve(null);
let cloudSettlementPromise: Promise<void> = Promise.resolve();
let gameGeneration = 0;

const isLoggedIn = computed(() => Boolean(getToken()));
const displayBest = computed(() => Math.max(bestScore.value, cloudMe.value?.bestScore ?? 0));
const rankTitle = computed(() => nlRank(score.value));
const resultTitle = computed(() => game.cause === "full" ? "吃满全场！" : game.cause === "self" ? "咬到自己了" : "撞墙了");
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
  // 图片到了以后，把已经画出去的招牌图和小图标重画一遍。
  void nlArtReady.then(() => {
    if (unmounted) return;
    drawMenuArt();
    drawGuide();
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
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", handleKeydown);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  void audioContext?.close();
});

function openScreen(value: Screen) {
  screen.value = value;
  if (value === "ranking" || value === "achievements") void loadLeaderboard(true);
  if (value === "settings") nextTick(drawGuide);
}

function drawGuide() {
  for (const [index, canvas] of guideEls.value.entries()) {
    const context = canvas.getContext("2d");
    if (context && GUIDE[index]) drawNlIcon(context, GUIDE[index].icon, 96);
  }
}

function startGame() {
  cancelAnimationFrame(animationFrame);
  game = createNlState(Math.floor(Math.random() * 0x7fffffff));
  floaters = [];
  swipeOrigin = null;
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
    swipeOrigin = null;
    cancelAnimationFrame(animationFrame);
    drawScene();
  } else if (gamePhase.value === "paused") {
    gamePhase.value = "playing";
    lastFrameAt = performance.now();
    animationFrame = requestAnimationFrame(gameLoop);
  }
}

/** 转向；还没开始的话，这一下顺便开始。 */
function steer(direction: NlDirection) {
  if (screen.value !== "game") return;
  if (gamePhase.value === "ready") beginRound();
  if (gamePhase.value !== "playing") return;
  if (nlTurn(game, direction)) playEvents();
}

function handlePointerDown(event: PointerEvent) {
  event.preventDefault();
  if (screen.value !== "game" || gamePhase.value === "over" || gamePhase.value === "paused") return;
  swipeOrigin = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, at: performance.now(), turned: false };
  try {
    canvasEl.value?.setPointerCapture(event.pointerId);
  } catch {
    // 拿不到指针捕获也能玩，只是滑出画布后不再跟手。
  }
}

function handlePointerMove(event: PointerEvent) {
  if (!swipeOrigin || swipeOrigin.id !== event.pointerId) return;
  const dx = event.clientX - swipeOrigin.x;
  const dy = event.clientY - swipeOrigin.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_DISTANCE) return;
  steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  // 从这里重新算起：手指不抬，接着往另一边滑还能再拐。
  swipeOrigin.x = event.clientX;
  swipeOrigin.y = event.clientY;
  swipeOrigin.turned = true;
}

function handlePointerEnd(event: PointerEvent) {
  const gesture = swipeOrigin;
  if (!gesture || gesture.id !== event.pointerId) return;
  swipeOrigin = null;
  if (event.type !== "pointerup") return;
  // 很快的一划可能来不及收到移动事件，抬手时按划过的距离补一次。
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_DISTANCE / 2) {
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
    return;
  }
  if (gesture.turned) return;
  // 没滑动，只是点了一下：开局前算开始，对局里按点的位置转向。
  if (gamePhase.value === "ready") beginRound();
  else if (performance.now() - gesture.at <= TAP_MILLISECONDS) steerToward(event.clientX, event.clientY);
}

/** 点了一下屏幕：点在奶龙的哪一边，就往哪一边拐。竖着走时看左右，横着走时看上下；点在正前正后分不出来，不算。 */
function steerToward(clientX: number, clientY: number) {
  const canvas = canvasEl.value;
  if (!canvas || gamePhase.value !== "playing") return;
  const bounds = canvas.getBoundingClientRect();
  const scale = bounds.width / WORLD_WIDTH;
  const layout = nlLayout(WORLD_WIDTH, worldHeight);
  const head = game.snake[0];
  const dx = clientX - (bounds.left + (layout.left + (head.x + 0.5) * layout.cell) * scale);
  const dy = clientY - (bounds.top + (layout.top + (head.y + 0.5) * layout.cell) * scale);
  // 已经记下还没拐的转向也算数，连点两下可以拐两次。
  const heading = game.queue.length ? game.queue[game.queue.length - 1] : game.direction;
  const upright = heading === "up" || heading === "down";
  if (Math.abs(upright ? dx : dy) < layout.cell * scale * 0.5) return;
  steer(upright ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down");
}

function handleKeydown(event: KeyboardEvent) {
  const direction = KEY_DIRECTIONS[event.code];
  if (direction && screen.value === "game" && (gamePhase.value === "ready" || gamePhase.value === "playing")) {
    event.preventDefault();
    if (!event.repeat) steer(direction);
    return;
  }
  if (["Space", "Enter"].includes(event.code)) {
    if (event.repeat) return;
    if (screen.value === "menu") {
      event.preventDefault();
      startGame();
    } else if (screen.value === "game" && gamePhase.value === "ready") {
      event.preventDefault();
      beginRound();
    } else if (screen.value === "game" && gamePhase.value === "over") {
      event.preventDefault();
      startGame();
    }
    return;
  }
  if (event.code === "KeyP" && screen.value === "game" && (gamePhase.value === "playing" || gamePhase.value === "paused")) {
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
  nlStep(game, delta);
  playEvents();
  syncHud();
  drawScene();
  if (game.over) finishGame();
  else animationFrame = requestAnimationFrame(gameLoop);
}

function playEvents() {
  for (const event of game.events) {
    if (event.type === "turn") playTone(420, 0.03, 0.012);
    else if (event.type === "eat") {
      floaters.push({ text: `+${event.score}`, x: event.x, y: event.y, born: game.time });
      if (event.kind === "feast") {
        playTone(659, 0.09, 0.045);
        window.setTimeout(() => playTone(880, 0.14, 0.045), 80);
      } else if (event.kind === "pill") {
        playTone(520, 0.08, 0.04);
        window.setTimeout(() => playTone(392, 0.12, 0.04), 80);
        showBanner(`瘦了 ${NL_RULES.pillShrink} 节`);
      } else playTone(600 + Math.min(300, game.foods * 4), 0.07, 0.04);
    } else if (event.type === "spawn") {
      showBanner(event.kind === "feast" ? `火锅上桌！${NL_RULES.feastSeconds} 秒内吃掉` : "消食片来了，吃了能瘦");
      playTone(event.kind === "feast" ? 784 : 494, 0.1, 0.035);
    }
  }
  game.events.length = 0;
  if (floaters.length && game.time - floaters[0].born >= NL_FLOATER_SECONDS) {
    floaters = floaters.filter((floater) => game.time - floater.born < NL_FLOATER_SECONDS);
  }
}

function showBanner(text: string) {
  bannerSeq += 1;
  banner.value = { id: bannerSeq, text };
  bannerUntil = game.time + 1.8;
}

function syncHud() {
  score.value = game.score;
  length.value = game.snake.length;
  maxLength.value = game.maxLength;
  if (banner.value && game.time >= bannerUntil) banner.value = null;
}

function finishGame() {
  if (gamePhase.value !== "playing") return;
  gamePhase.value = "over";
  swipeOrigin = null;
  banner.value = null;
  isNewRecord.value = score.value > bestScore.value;
  if (isNewRecord.value) {
    bestScore.value = score.value;
    writeStorage(STORAGE_PREFIX + ":best", String(bestScore.value));
  }
  const item: HistoryItem = { score: game.score, length: game.maxLength, playedAt: new Date().toISOString() };
  history.value = [item, ...history.value].slice(0, 30);
  writeStorage(STORAGE_PREFIX + ":history", JSON.stringify(history.value));
  const generation = gameGeneration;
  const result = { score: game.score, foods: game.foods, length: game.maxLength, durationMs: Math.max(0, Math.round(game.time * 1000)) };
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
  drawScene();
}

function drawScene() {
  if (!canvasContext) return;
  drawNlScene(canvasContext, { width: WORLD_WIDTH, height: worldHeight, game, floaters });
}

function drawMenuArt() {
  const context = menuArtEl.value?.getContext("2d");
  if (context) drawNlMenuArt(context, 248);
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
    applyLeaderboard(await greedyNailongApi.leaderboard({ cacheTtlMs: force ? 0 : 15_000 }));
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
    const attempt = await greedyNailongApi.startAttempt({
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
    await greedyNailongApi.abandonAttempt(attemptId, {
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
  result: { score: number; foods: number; length: number; durationMs: number },
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
    const board = await greedyNailongApi.finishAttempt(attemptId, result, {
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

function applyLeaderboard(value: GreedyNailongLeaderboard) {
  leaderboard.value = value.leaderboard;
  cloudMe.value = value.me;
  totalPlayers.value = value.totalPlayers;
  achievements.value = value.achievements;
  newlyUnlocked.value = value.newlyUnlocked;
}

function achievementPercent(item: GreedyNailongAchievement) {
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
        length: Math.max(0, Math.floor(Number(item.length) || 0)),
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
/* 奶龙的金黄配橙色，圆角和软阴影；共用外壳里的粗边框和硬投影在这一页都换掉。 */
.nl-shell {
  --ink: #5a3a12;
  --cyan: #fff3c4;
  --blue: #f08a24;
  --blue-dark: #c9650c;
  --school-blue: #c9650c;
  --nl-orange: #e8730c;
  --nl-brown: #6b4210;
  --nl-line: rgba(232, 176, 84, .6);
  --nl-card: rgba(255, 252, 238, .9);
  --nl-muted: #9a7b4f;
  background:
    radial-gradient(circle at 20% 0%, rgba(255, 255, 255, .9), transparent 42%),
    linear-gradient(165deg, #ffe9a6, #ffd27a 78%);
  font-family: ui-rounded, "SF Pro Rounded", "HarmonyOS Sans SC", "PingFang SC", system-ui, sans-serif;
}

.nl-shell .game-phone {
  border: 2px solid rgba(232, 176, 84, .8);
  border-radius: 26px;
  background: #fff3c4;
  box-shadow: 0 18px 44px rgba(150, 96, 20, .22);
}
.nl-shell .game-canvas { background: #fff3c4; cursor: pointer; touch-action: none; }

.nl-shell .menu-screen {
  background:
    radial-gradient(circle at 16% 4%, rgba(255, 255, 255, .95), transparent 40%),
    linear-gradient(180deg, #fff6d2, #ffe3a0);
}
.nl-shell .corner-back,
.nl-shell .best-score-box,
.nl-shell .game-button {
  border: 1.5px solid var(--nl-line);
  box-shadow: 0 6px 16px rgba(150, 96, 20, .14);
}
.nl-shell .corner-back { border-radius: 50%; color: var(--nl-brown); background: var(--nl-card); font-weight: 700; }
.nl-shell .menu-emblem {
  width: 176px;
  height: 176px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: none;
  box-shadow: none;
  filter: drop-shadow(0 10px 14px rgba(150, 96, 20, .24));
}
.nl-shell .menu-screen h1 {
  margin-top: 2px;
  color: #b4560a !important;
  font-size: clamp(32px, 9vw, 42px);
  font-weight: 900;
  letter-spacing: .02em;
  text-shadow: none;
}
.nl-shell .menu-tagline { color: #8a5a1a; background: rgba(255, 236, 178, .95); font-weight: 600; }
.nl-shell .best-score-box { border-radius: 18px; background: var(--nl-card); }
.nl-shell .best-score-box span { color: var(--nl-muted); font-weight: 700; }
.nl-shell .best-score-box strong { color: #b4560a; }
.nl-shell .game-button { border-radius: 16px; font-weight: 800; letter-spacing: 0; }
.nl-shell .game-button:active { transform: translateY(1px); box-shadow: 0 2px 6px rgba(150, 96, 20, .16); }
.nl-shell .game-button--start { border-color: transparent; background: #f08a24; }
.nl-shell .game-button--achievement { border-color: transparent; color: #5a3d00; background: #ffd76a; }
.nl-shell .game-button--ranking { border-color: transparent; background: #6aaa4e; }
.nl-shell .game-button--secondary { color: var(--nl-brown); background: #fff0c2; }
.nl-shell .menu-footnote { color: var(--nl-muted); font-weight: 600; }

/* 排行、成就、战绩、设置几个面板 */
.nl-shell .panel-header { border-bottom: 1.5px solid var(--nl-line); background: #fffbe8; }
.nl-shell .panel-header h2 { color: #b4560a !important; font-weight: 800; }
.nl-shell .panel-header button,
.nl-shell .panel-login {
  border: 1.5px solid var(--nl-line);
  border-radius: 999px;
  color: var(--nl-brown);
  background: #fff0c2;
  box-shadow: none;
  font-weight: 700;
}
.nl-shell .panel-login { border-radius: 16px; color: #fff; background: #f08a24; }
.nl-shell .ranking-summary div,
.nl-shell .ranking-list li,
.nl-shell .history-list li,
.nl-shell .achievement-list article,
.nl-shell .setting-row {
  border: 1.5px solid var(--nl-line);
  border-radius: 16px;
  background: rgba(255, 252, 238, .94);
  box-shadow: none;
}
.nl-shell .ranking-summary button { border: 0; border-radius: 14px; background: #f08a24; font-weight: 700; }
.nl-shell .ranking-list li.me,
.nl-shell .achievement-list article.unlocked { border-color: #f0a83a; background: #fff0c2; }
.nl-shell .ranking-list li > strong,
.nl-shell .history-list li > b,
.nl-shell .panel-counter b { color: #b4560a; }
.nl-shell .setting-row button { border: 0; border-radius: 999px; background: #cdbf9f; }
.nl-shell .setting-row button.active { background: #f08a24; }
.nl-shell .flight-settings-panel > p { color: #75552a; text-align: left; }

.nl-guide { display: grid; gap: 8px; margin: 2px 0 14px; }
.nl-guide span {
  display: grid;
  grid-template-columns: 44px 1fr;
  align-items: center;
  gap: 0 10px;
  padding: 8px 10px;
  border: 1.5px solid var(--nl-line);
  border-radius: 14px;
  background: rgba(255, 252, 238, .94);
  line-height: 1.35;
  text-align: left;
}
.nl-guide canvas { grid-row: span 2; width: 44px; height: 44px; }
.nl-guide b { color: var(--nl-brown); font-size: 13px; font-weight: 700; }
.nl-guide small { color: var(--nl-muted); font-size: 11px; }

/* 对局里的浮层。底下的画布一直在重画，不用毛玻璃。 */
.nl-shell .score-board,
.nl-length,
.nl-shell .game-controls button,
.nl-banner,
.nl-shell .ready-hint {
  border: 1.5px solid var(--nl-line);
  background: var(--nl-card);
  box-shadow: 0 6px 16px rgba(150, 96, 20, .14);
  color: var(--ink);
}
.nl-shell .score-board {
  top: 10px;
  left: 10px;
  min-width: 78px;
  place-items: start;
  padding: 8px 12px 9px;
  border-radius: 18px;
}
.nl-shell .score-board span { color: var(--nl-muted); font-size: 10px; font-weight: 700; }
.nl-shell .score-board strong { margin: 2px 0 1px; color: #b4560a; font-size: 24px; font-weight: 900; letter-spacing: -.02em; }
.nl-shell .score-board small { color: var(--nl-muted); font-size: 10px; font-weight: 600; }

.nl-length {
  position: absolute;
  top: 10px;
  left: 50%;
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 8px 15px 9px;
  border-radius: 999px;
  line-height: 1;
  transform: translateX(-50%);
}
.nl-length small { color: var(--nl-muted); font-size: 11px; font-weight: 700; white-space: nowrap; }
.nl-length b { color: #b4560a; font-size: 20px; font-weight: 900; }

.nl-shell .game-controls { top: 10px; right: 10px; gap: 6px; }
.nl-shell .game-controls button {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: var(--nl-brown);
  font-size: 15px;
  font-weight: 800;
}
.nl-shell .game-controls button:active { background: #fff0c2; }

.nl-shell .ready-hint {
  top: 27%;
  width: min(80%, 300px);
  padding: 16px 16px 15px;
  border-radius: 22px;
  background: rgba(255, 252, 238, .96);
}
.nl-shell .ready-flight-mark { margin: 0 0 6px; font-size: 30px; transform: none; }
.nl-shell .ready-hint h2 { margin: 0 0 6px; color: #b4560a !important; font-size: 17px; font-weight: 800; text-shadow: none; }
.nl-shell .ready-hint p { color: #86683c; font-size: 12px; font-weight: 500; line-height: 1.55; }

.nl-banner {
  position: absolute;
  top: 15%;
  left: 50%;
  padding: 8px 18px;
  border-color: rgba(255, 150, 60, .8);
  border-radius: 999px;
  color: #8a3d00;
  background: rgba(255, 240, 200, .97);
  font-size: 15px;
  font-weight: 800;
  white-space: nowrap;
  transform: translateX(-50%);
  animation: nl-pop .3s cubic-bezier(.2, 1.4, .4, 1) both;
}
@keyframes nl-pop {
  from { opacity: 0; transform: translateX(-50%) scale(.8); }
  to { opacity: 1; transform: translateX(-50%) scale(1); }
}
.nl-hint {
  position: absolute;
  right: 0;
  bottom: max(10px, var(--game-safe-bottom));
  left: 0;
  margin: 0;
  color: #a17a3c;
  font-size: 11px;
  font-weight: 600;
  text-align: center;
}

/* 暂停和结算 */
.nl-shell .modal-shade { background: rgba(110, 70, 16, .34); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.nl-shell .game-modal {
  width: min(100%, 300px);
  padding: 22px 20px 16px;
  border: 1.5px solid var(--nl-line);
  border-radius: 24px;
  background: #fffbe8;
  box-shadow: 0 18px 44px rgba(120, 76, 16, .28);
}
.nl-shell .modal-icon { color: var(--nl-orange); font-size: 26px; }
.nl-shell .game-modal h2 { margin: 6px 0 2px; color: #b4560a !important; font-size: 19px; font-weight: 800; }
.nl-shell .game-modal p { color: #8c7350; font-size: 12px; }
.nl-shell .game-modal .game-button { min-height: 46px; border: 0; box-shadow: none; font-size: 15px; }
.nl-shell .game-modal .game-button:active { transform: none; background: #d9741a; }
.nl-shell .plain-button { margin-top: 12px; color: #8c7350; font-weight: 600; }
.nl-shell .result-label { display: table; margin: 0 auto 2px; padding: 4px 10px; color: #b4560a; background: #ffe7b0; font-weight: 700; }
.nl-shell .final-score { color: #b4560a; font-size: 60px; font-weight: 900; letter-spacing: -.03em; }
.nl-shell .final-unit { color: #8c7350; font-weight: 600; }
.nl-shell .result-stats { grid-template-columns: repeat(3, 1fr); gap: 6px; }
.nl-shell .result-stats span { padding: 8px 4px; border: 0; border-radius: 14px; background: #fff0c8; }
.nl-shell .result-stats small { color: var(--nl-muted); font-size: 10px; }
.nl-shell .result-stats b { color: var(--nl-brown); font-size: 13px; font-weight: 700; }
.nl-shell .cloud-result { color: #8a6a1c; font-weight: 600; }
.nl-shell .cloud-result.success { color: #3f8a2e; }
.nl-shell .new-unlocks b { color: #6a4a00; background: #fdeebf; font-weight: 600; }

@media (max-width: 600px) {
  .nl-shell { background: #fff3c4; }
  .nl-shell .game-phone { border: 0; border-radius: 0; box-shadow: none; }
}

@media (max-height: 720px) {
  .nl-shell .menu-emblem { width: 128px; height: 128px; }
  .nl-shell .menu-screen h1 { font-size: 32px; }
}

@media (max-height: 620px) {
  .nl-shell .menu-emblem { width: 92px; height: 92px; }
  .nl-shell .menu-screen h1 { font-size: 28px; }
}

@media (prefers-reduced-motion: reduce) {
  .nl-banner { animation: none; }
}
</style>
