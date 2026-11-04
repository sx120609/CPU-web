<template>
  <main class="flight-shell">
    <section ref="phoneEl" class="game-phone">
      <canvas
        v-show="screen === 'game'"
        ref="canvasEl"
        class="game-canvas"
        role="img"
        :aria-label="st('药大人能飞游戏区域')"
        tabindex="0"
        @pointerdown="handleCanvasPointer"
      ></canvas>

      <section v-if="screen === 'menu'" class="menu-screen">
        <button data-cpu-button="surface" type="button" class="corner-back" aria-label="返回小游戏" @click="router.push(MINI_GAMES_PATH)">←</button>
        <img class="menu-emblem" :src="cpuEmblem" alt="中国药科大学校标" />
        <h1>{{ st('药大人能飞') }}</h1>
        <p class="menu-tagline">💊 点击起飞 · 穿越药苑 · 兴药为民</p>
        <div class="best-score-box">
          <span>最高分</span>
          <strong>{{ displayBest }}</strong>
        </div>
        <div class="menu-actions">
          <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click="startGame">开始游戏</button>
          <button data-cpu-button="surface" type="button" class="game-button game-button--achievement" @click="openScreen('achievements')">🏆 成就</button>
          <button data-cpu-button="surface" type="button" class="game-button game-button--ranking" @click="openScreen('ranking')">📊 全校排行</button>
          <button data-cpu-button="surface" type="button" class="game-button game-button--secondary" @click="openScreen('history')">📜 历史战绩</button>
          <button data-cpu-button="surface" type="button" class="game-button game-button--secondary" @click="openScreen('settings')">⚙ 设置</button>
        </div>
        <p class="menu-footnote">{{ recoveryNotice || (isLoggedIn ? "云端排行与成就已开启" : "本机记录 · 登录后同步云端") }}</p>
      </section>

      <section v-else-if="screen === 'game'" class="game-layer">
        <div class="score-board">
          <span>得分</span>
          <strong>{{ score }}</strong>
          <small>最高 {{ displayBest }}</small>
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
          <h2>点击屏幕或空格起飞</h2>
          <p>按住节奏点击，穿过所有药学管道！</p>
        </div>

        <div v-if="gamePhase === 'paused'" class="modal-shade">
          <div class="game-modal">
            <span class="modal-icon">⏸</span>
            <h2>飞行暂停</h2>
            <p>当前 {{ score }} 分</p>
            <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click.stop="togglePause">继续飞行</button>
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
              <span><small>飞行等级</small><b>{{ flightRank }}</b></span>
            </div>
            <p class="cloud-result" :class="{ success: cloudSubmitState === 'success' }">{{ cloudResultMessage }}</p>
            <div v-if="newlyUnlocked.length" class="new-unlocks">
              <b v-for="item in newlyUnlocked" :key="item.code">{{ item.icon }} {{ item.title }}</b>
            </div>
            <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click.stop="startGame">再飞一次</button>
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
            <button data-cpu-button="surface"
              v-if="isLoggedIn"
              type="button"
              class="manual-sync-button"
              :disabled="historySyncing || !history.length"
              @click="syncLocalHistory(true)"
            >
              {{ historySyncing ? "更新中..." : "手动更新成绩" }}
            </button>
          </div>
          <p v-if="historySyncMessage" class="history-sync-message">{{ historySyncMessage }}</p>
          <ol v-if="leaderboard.length" class="ranking-list">
            <li v-for="entry in leaderboard" :key="entry.userId" :class="{ me: cloudMe?.userId === entry.userId }">
              <span class="rank-number">{{ entry.rank }}</span>
              <UserAvatar :size="44" :src="entry.avatar" :name="entry.name" :seed="entry.userId" :alt="entry.name + '的头像'" />
              <span class="rank-user">
                <b>{{ entry.name }}</b>
                <small>{{ entry.games }} 局 · {{ entry.achievementCount }} 枚成就 · 累计 {{ entry.totalScore }}</small>
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
              <small>{{ formatHistoryDate(item.playedAt) }}</small>
              <em>{{ rankForScore(item.score) }}</em>
            </li>
          </ol>
          <div v-else class="empty-panel">暂无历史战绩，快去飞一次吧！</div>
        </div>

        <div v-else class="panel-scroll flight-settings-panel">
          <img :src="cpuEmblem" alt="中国药科大学校标" />
          <div class="setting-row">
            <span><b>游戏音效</b><small>起飞、得分与碰撞提示音</small></span>
            <button data-cpu-button="surface" type="button" :class="{ active: soundEnabled }" @click="toggleSound">{{ soundEnabled ? "开启" : "关闭" }}</button>
          </div>
          <div class="setting-row">
            <span><b>云端档案</b><small>{{ isLoggedIn ? "排行榜、局数和成就自动保存" : "当前成绩仅保存在这台设备" }}</small></span>
            <button data-cpu-button="surface" v-if="!isLoggedIn" type="button" @click="goToLogin">登录</button>
            <b v-else class="cloud-online">已连接</b>
          </div>
          <p>操作：点击 / 触摸 / 空格 / ↑ 起飞，P 暂停，Esc 返回主页。</p>
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
  yaodaFlightApi,
  type YaodaFlightAchievement,
  type YaodaFlightLeaderboard,
  type YaodaFlightRankingEntry,
} from "@/api/yaodaFlight";
import UserAvatar from "@/components/common/UserAvatar.vue";
import cpuEmblem from "@/assets/yaoda-can-fly/cpu-emblem.png";
import { MINI_GAMES_PATH } from "@/data/miniGames";
import {
  NJU_FLIGHT_PHYSICS,
  njuCircleIntersectsRect,
  njuFlightPipeGeometry,
} from "./yaodaFlightDifficulty";

// 外校显示成本校简称（见 utils/schoolText.ts）。
const st = useSchoolText();

type Screen = "menu" | "game" | "ranking" | "achievements" | "history" | "settings";
type GamePhase = "ready" | "playing" | "paused" | "over";
type Pipe = { x: number; gapY: number; gapSize: number; passed: boolean };
type HistoryItem = { score: number; playedAt: string };

const router = useRouter();
const auth = useAuthStore();
const phoneEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const screen = ref<Screen>("menu");
const gamePhase = ref<GamePhase>("ready");
const score = ref(0);
const bestScore = ref(0);
const history = ref<HistoryItem[]>([]);
const soundEnabled = ref(true);
const isNewRecord = ref(false);
const leaderboard = ref<YaodaFlightRankingEntry[]>([]);
const cloudMe = ref<YaodaFlightRankingEntry | null>(null);
const totalPlayers = ref(0);
const leaderboardLoading = ref(false);
const leaderboardError = ref("");
const historySyncing = ref(false);
const historySyncMessage = ref("");
const achievements = ref<YaodaFlightAchievement[]>([]);
const newlyUnlocked = ref<YaodaFlightLeaderboard["newlyUnlocked"]>([]);
const cloudSubmitState = ref<"idle" | "syncing" | "success" | "error" | "guest">("idle");
const cloudSubmitDetail = ref("");
const recoveryNotice = ref("");

const WORLD_WIDTH = NJU_FLIGHT_PHYSICS.worldWidth;
const WORLD_HEIGHT = NJU_FLIGHT_PHYSICS.worldHeight;
const GROUND_HEIGHT = WORLD_HEIGHT - NJU_FLIGHT_PHYSICS.groundY;
const PLAYER_X = NJU_FLIGHT_PHYSICS.playerX;
const PLAYER_RADIUS = NJU_FLIGHT_PHYSICS.playerRadius;
const PIPE_WIDTH = NJU_FLIGHT_PHYSICS.pipeWidth;
const STORAGE_PREFIX = "cpu-web:yaoda-can-fly:v2";
const GAME_RELEASE = "20260905-v5" as const;

const worldHeight = WORLD_HEIGHT;
let playerY = 300;
let velocityY = 0;
let pipes: Pipe[] = [];
let elapsed = 0;
let timeSinceLastPipe = 0;
let lastFrameAt = 0;
let animationFrame = 0;
let resizeObserver: ResizeObserver | null = null;
let canvasContext: CanvasRenderingContext2D | null = null;
let audioContext: AudioContext | null = null;
let cloudAttemptPromise: Promise<number | null> = Promise.resolve(null);
let cloudSettlementPromise: Promise<void> = Promise.resolve();
let gameGeneration = 0;
const emblemImage = new Image();

const isLoggedIn = computed(() => Boolean(getToken()));
const displayBest = computed(() => Math.max(bestScore.value, cloudMe.value?.bestScore ?? 0));
const flightRank = computed(() => rankForScore(score.value));
const resultTitle = computed(() => score.value >= 10 ? "飞得漂亮" : score.value >= 4 ? "渐入佳境" : "再试一次");
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
  emblemImage.src = cpuEmblem;
  emblemImage.addEventListener("load", drawScene);
  window.addEventListener("keydown", handleKeydown);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  resizeObserver = new ResizeObserver(resizeCanvas);
  if (phoneEl.value) resizeObserver.observe(phoneEl.value);
  void initializeCloud();
  nextTick(resizeCanvas);
});

onBeforeUnmount(() => {
  document.documentElement.classList.remove("yaoda-flight-open");
  if (gamePhase.value === "playing" || gamePhase.value === "paused") {
    cloudSettlementPromise = abandonCloudAttempt(cloudAttemptPromise);
  }
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", handleKeydown);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  emblemImage.removeEventListener("load", drawScene);
  void audioContext?.close();
});

function openScreen(value: Screen) {
  screen.value = value;
  if (value === "ranking" || value === "achievements") void loadLeaderboard(true);
}

function startGame() {
  cancelAnimationFrame(animationFrame);
  screen.value = "game";
  gamePhase.value = "ready";
  score.value = 0;
  isNewRecord.value = false;
  newlyUnlocked.value = [];
  cloudSubmitState.value = isLoggedIn.value ? "idle" : "guest";
  cloudSubmitDetail.value = "";
  playerY = 300;
  velocityY = 0;
  pipes = [];
  elapsed = 0;
  timeSinceLastPipe = 0;
  nextTick(() => {
    resizeCanvas();
    drawScene();
    canvasEl.value?.focus({ preventScroll: true });
  });
}

function beginFlight() {
  if (gamePhase.value !== "ready") return;
  gameGeneration += 1;
  const generation = gameGeneration;
  gamePhase.value = "playing";
  velocityY = NJU_FLIGHT_PHYSICS.flapImpulse;
  elapsed = 0;
  timeSinceLastPipe = 0;
  pipes = [];
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
  pipes = [];
}

function togglePause() {
  if (gamePhase.value === "playing") {
    gamePhase.value = "paused";
    cancelAnimationFrame(animationFrame);
    drawScene();
  } else if (gamePhase.value === "paused") {
    gamePhase.value = "playing";
    lastFrameAt = performance.now();
    animationFrame = requestAnimationFrame(gameLoop);
  }
}

function flap() {
  if (gamePhase.value !== "playing") return;
  velocityY = NJU_FLIGHT_PHYSICS.flapImpulse;
  playTone(680, 0.04, 0.025);
}

function handleCanvasPointer(event: PointerEvent) {
  event.preventDefault();
  if (screen.value !== "game") return;
  if (gamePhase.value === "ready") beginFlight();
  else if (gamePhase.value === "playing") flap();
}

function handleKeydown(event: KeyboardEvent) {
  if (["Space", "ArrowUp"].includes(event.code)) {
    event.preventDefault();
    if (screen.value === "menu") startGame();
    else if (screen.value === "game" && gamePhase.value === "ready") beginFlight();
    else if (screen.value === "game" && gamePhase.value === "over") startGame();
    else flap();
    return;
  }
  if (event.code === "Enter" && screen.value === "menu") {
    event.preventDefault();
    startGame();
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
  updateGame(delta);
  drawScene();
  if (gamePhase.value === "playing") animationFrame = requestAnimationFrame(gameLoop);
}

function updateGame(delta: number) {
  elapsed += delta;
  velocityY += NJU_FLIGHT_PHYSICS.gravity * delta;
  playerY += velocityY * delta;

  if (playerY - PLAYER_RADIUS <= 0) {
    playerY = PLAYER_RADIUS;
    velocityY = 0;
  }
  if (playerY + PLAYER_RADIUS >= NJU_FLIGHT_PHYSICS.groundY) {
    playerY = NJU_FLIGHT_PHYSICS.groundY - PLAYER_RADIUS;
    velocityY = 0;
    finishGame();
    return;
  }

  timeSinceLastPipe += delta;
  if (timeSinceLastPipe >= NJU_FLIGHT_PHYSICS.pipeSpawnIntervalSeconds) {
    pipes.push(createPipe());
    timeSinceLastPipe = 0;
  }

  for (const pipe of pipes) {
    pipe.x -= NJU_FLIGHT_PHYSICS.pipeSpeed * delta;
    if (!pipe.passed && pipe.x + PIPE_WIDTH < NJU_FLIGHT_PHYSICS.scoreLineX) {
      pipe.passed = true;
      score.value += 1;
      playTone(890, 0.07, 0.04);
    }
    const topHeight = pipe.gapY - pipe.gapSize / 2;
    const bottomY = pipe.gapY + pipe.gapSize / 2;
    const hitTop = njuCircleIntersectsRect(
      PLAYER_X,
      playerY,
      PLAYER_RADIUS,
      pipe.x,
      0,
      PIPE_WIDTH,
      topHeight,
    );
    const hitBottom = njuCircleIntersectsRect(
      PLAYER_X,
      playerY,
      PLAYER_RADIUS,
      pipe.x,
      bottomY,
      PIPE_WIDTH,
      NJU_FLIGHT_PHYSICS.groundY - bottomY,
    );
    if (hitTop || hitBottom) {
      finishGame();
      return;
    }
  }
  pipes = pipes.filter((pipe) => pipe.x + PIPE_WIDTH >= -50);
}

function finishGame() {
  if (gamePhase.value !== "playing") return;
  gamePhase.value = "over";
  isNewRecord.value = score.value > bestScore.value;
  if (isNewRecord.value) {
    bestScore.value = score.value;
    writeStorage(STORAGE_PREFIX + ":best", String(bestScore.value));
  }
  const item: HistoryItem = { score: score.value, playedAt: new Date().toISOString() };
  history.value = [item, ...history.value].slice(0, 30);
  writeStorage(STORAGE_PREFIX + ":history", JSON.stringify(history.value));
  const generation = gameGeneration;
  const finalScore = score.value;
  const durationMs = Math.max(0, Math.round(elapsed * 1000));
  cloudSettlementPromise = finishCloudAttempt(cloudAttemptPromise, generation, finalScore, durationMs);
  playTone(180, 0.16, 0.06);
  window.setTimeout(() => playTone(130, 0.2, 0.045), 110);
}

function createPipe(): Pipe {
  const geometry = njuFlightPipeGeometry(Math.random(), Math.random());
  return {
    x: NJU_FLIGHT_PHYSICS.pipeSpawnX,
    gapY: geometry.gapY,
    gapSize: geometry.gapSize,
    passed: false,
  };
}

function resizeCanvas() {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(WORLD_WIDTH * ratio);
  canvas.height = Math.round(WORLD_HEIGHT * ratio);
  canvasContext = canvas.getContext("2d");
  canvasContext?.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (screen.value === "game" && gamePhase.value === "ready") playerY = 300;
  drawScene();
}

function drawScene() {
  const context = canvasContext;
  if (!context) return;
  context.clearRect(0, 0, WORLD_WIDTH, worldHeight);
  drawBackground(context);
  for (const pipe of pipes) drawPipe(context, pipe);
  drawPlayer(context);
  drawGround(context);
}

function drawBackground(context: CanvasRenderingContext2D) {
  context.fillStyle = "#70c5ce";
  context.fillRect(0, 0, WORLD_WIDTH, worldHeight);
  context.fillStyle = "rgba(255,255,255,.96)";
  const cloudPositions = [
    [30, 120, 0.78],
    [215, 175, 1.04],
    [330, 90, 0.7],
    [120, 290, 0.82],
  ];
  for (let index = 0; index < cloudPositions.length; index += 1) {
    const item = cloudPositions[index];
    const drift = screen.value === "game" ? (elapsed * (6 + index * 1.7)) % 520 : 0;
    drawCloud(context, ((item[0] - drift + 80 + 520) % 520) - 80, item[1], item[2]);
  }
}

function drawCloud(context: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  context.beginPath();
  context.arc(x, y, 18 * scale, 0, Math.PI * 2);
  context.arc(x + 24 * scale, y - 10 * scale, 25 * scale, 0, Math.PI * 2);
  context.arc(x + 52 * scale, y, 20 * scale, 0, Math.PI * 2);
  context.rect(x, y, 52 * scale, 18 * scale);
  context.fill();
}

function drawPipe(context: CanvasRenderingContext2D, pipe: Pipe) {
  const topHeight = pipe.gapY - pipe.gapSize / 2;
  const bottomY = pipe.gapY + pipe.gapSize / 2;
  drawPipeBody(context, pipe.x, -8, topHeight + 8, false);
  drawPipeBody(context, pipe.x, bottomY, worldHeight - GROUND_HEIGHT - bottomY + 8, true);
}

function drawPipeBody(context: CanvasRenderingContext2D, x: number, y: number, height: number, bottom: boolean) {
  const gradient = context.createLinearGradient(x, 0, x + PIPE_WIDTH, 0);
  gradient.addColorStop(0, "#42a62a");
  gradient.addColorStop(0.2, "#79d54c");
  gradient.addColorStop(0.7, "#4db72f");
  gradient.addColorStop(1, "#268516");
  context.fillStyle = gradient;
  context.strokeStyle = "#28511f";
  context.lineWidth = 3;
  context.fillRect(x, y, PIPE_WIDTH, height);
  context.strokeRect(x, y, PIPE_WIDTH, height);
  const capY = bottom ? y : y + height - 24;
  context.fillStyle = gradient;
  context.fillRect(x - 7, capY, PIPE_WIDTH + 14, 24);
  context.strokeRect(x - 7, capY, PIPE_WIDTH + 14, 24);
  context.fillStyle = "rgba(255,255,255,.22)";
  context.fillRect(x + 9, y + 3, 9, Math.max(0, height - 6));
}

function drawPlayer(context: CanvasRenderingContext2D) {
  const idleBob = gamePhase.value === "ready" ? Math.sin(performance.now() / 320) * 5 : 0;
  const angle = gamePhase.value === "playing" ? Math.max(-0.4, Math.min(0.7, velocityY / 700)) : -0.06;
  context.save();
  context.translate(PLAYER_X, playerY + idleBob);
  context.rotate(angle);
  context.fillStyle = "#fff";
  context.strokeStyle = "#3c3937";
  context.lineWidth = 2.5;
  context.beginPath();
  context.arc(0, 0, 25, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  if (emblemImage.complete && emblemImage.naturalWidth) {
    context.drawImage(emblemImage, -22, -22, 44, 44);
  } else {
    context.fillStyle = "#123f91";
    context.font = "900 12px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("CPU", 0, 0);
  }
  context.restore();
}

function drawGround(context: CanvasRenderingContext2D) {
  const y = worldHeight - GROUND_HEIGHT;
  context.fillStyle = "#57b53c";
  context.fillRect(0, y, WORLD_WIDTH, 10);
  context.fillStyle = "#2d7021";
  context.fillRect(0, y + 8, WORLD_WIDTH, 4);
  context.fillStyle = "#d8b77b";
  context.fillRect(0, y + 12, WORLD_WIDTH, GROUND_HEIGHT - 12);
  context.fillStyle = "rgba(116,82,41,.15)";
  const offset = (elapsed * 55) % 34;
  for (let x = -34 - offset; x < WORLD_WIDTH + 34; x += 34) {
    context.beginPath();
    context.moveTo(x, y + 12);
    context.lineTo(x + 15, y + 12);
    context.lineTo(x - 2, worldHeight);
    context.lineTo(x - 17, worldHeight);
    context.closePath();
    context.fill();
  }
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
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
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
    applyLeaderboard(await yaodaFlightApi.leaderboard({ cacheTtlMs: force ? 0 : 15_000 }));
  } catch {
    leaderboardError.value = "云端排行暂时没有连接上";
  } finally {
    leaderboardLoading.value = false;
  }
}

async function initializeCloud() {
  if (!auth.ready) await auth.fetchMe({ probe: true }).catch(() => undefined);
  await loadLeaderboard();
  await syncLocalHistory(false);
}

async function syncLocalHistory(manual: boolean) {
  const userId = auth.user?.id;
  if (!userId || !history.value.length || historySyncing.value) {
    if (manual && !history.value.length) historySyncMessage.value = "本机还没有可同步的战绩";
    return;
  }
  const recoveryKey = `${STORAGE_PREFIX}:recovery:${GAME_RELEASE}:user-${userId}`;
  if (!manual && localStorage.getItem(recoveryKey) === "1") return;
  historySyncing.value = true;
  if (manual) historySyncMessage.value = "";
  try {
    const result = await yaodaFlightApi.recoverHistory({
      release: GAME_RELEASE,
      history: history.value,
    }, {
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
      suppressErrorMessage: true,
    });
    applyLeaderboard(result);
    writeStorage(recoveryKey, "1");
    const localBest = Math.max(...history.value.map((item) => item.score));
    if (result.recoveredCount > 0) {
      const message = `已补传 ${result.recoveredCount} 局本机战绩`;
      recoveryNotice.value = message;
      if (manual) historySyncMessage.value = message;
    } else if (manual && (result.me?.bestScore ?? 0) >= localBest) {
      historySyncMessage.value = "云端成绩已是最新";
    } else if (manual) {
      historySyncMessage.value = "未找到可校验的遗漏对局";
    }
  } catch (error) {
    if (manual) historySyncMessage.value = cloudFailureMessage(error, "本机战绩同步失败，请稍后重试");
  } finally {
    historySyncing.value = false;
  }
}

async function beginCloudAttempt(generation: number) {
  if (!isLoggedIn.value) return null;
  try {
    const attempt = await yaodaFlightApi.startAttempt({
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
    await yaodaFlightApi.abandonAttempt(attemptId, {
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
  finalScore: number,
  durationMs: number,
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
    const result = await yaodaFlightApi.finishAttempt(attemptId, { score: finalScore, durationMs }, {
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
      suppressErrorMessage: true,
    });
    applyLeaderboard(result);
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

function applyLeaderboard(value: YaodaFlightLeaderboard) {
  leaderboard.value = value.leaderboard;
  cloudMe.value = value.me;
  totalPlayers.value = value.totalPlayers;
  achievements.value = value.achievements;
  newlyUnlocked.value = value.newlyUnlocked;
}

function achievementPercent(item: YaodaFlightAchievement) {
  if (item.unlocked) return 100;
  return Math.min(100, Math.max(0, Math.round((item.progress / Math.max(1, item.target)) * 100)));
}

function goToLogin() {
  router.push({ name: "login", query: { redirect: "/services/tools/yaoda-can-fly" } });
}

function rankForScore(value: number) {
  if (value >= 30) return "药学传奇";
  if (value >= 18) return "实验室王牌";
  if (value >= 10) return "熟练药师";
  if (value >= 4) return "飞行新秀";
  return "见习飞行员";
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
      .map((item) => ({ score: Math.max(0, Math.floor(Number(item.score))), playedAt: item.playedAt }));
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
