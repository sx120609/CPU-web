<template>
  <main class="flight-shell">
    <section ref="phoneEl" class="game-phone">
      <canvas
        v-show="screen === 'game'"
        ref="canvasEl"
        class="game-canvas"
        role="img"
        aria-label="药大人能飞游戏区域"
        tabindex="0"
        @pointerdown="handleCanvasPointer"
      ></canvas>

      <section v-if="screen === 'menu'" class="menu-screen">
        <button type="button" class="corner-back" aria-label="返回小工具" @click="router.push('/services/tools')">←</button>
        <img class="menu-emblem" :src="cpuEmblem" alt="中国药科大学校标" />
        <h1>药大人能飞</h1>
        <p class="menu-tagline">💊 点击起飞 · 穿越药苑 · 兴药为民</p>
        <div class="best-score-box">
          <span>最高分</span>
          <strong>{{ displayBest }}</strong>
        </div>
        <div class="menu-actions">
          <button type="button" class="game-button game-button--start" @click="startGame">开始游戏</button>
          <button type="button" class="game-button game-button--achievement" @click="openScreen('achievements')">🏆 成就</button>
          <button type="button" class="game-button game-button--ranking" @click="openScreen('ranking')">📊 全校排行</button>
          <button type="button" class="game-button game-button--secondary" @click="openScreen('history')">📜 历史战绩</button>
          <button type="button" class="game-button game-button--secondary" @click="openScreen('settings')">⚙ 设置</button>
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
          <button
            v-if="gamePhase === 'playing' || gamePhase === 'paused'"
            type="button"
            :aria-label="gamePhase === 'paused' ? '继续游戏' : '暂停游戏'"
            @click.stop="togglePause"
          >{{ gamePhase === "paused" ? "▶" : "Ⅱ" }}</button>
          <button type="button" aria-label="返回主页" @click.stop="returnToMenu">×</button>
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
            <button type="button" class="game-button game-button--start" @click.stop="togglePause">继续飞行</button>
            <button type="button" class="plain-button" @click.stop="returnToMenu">返回主页</button>
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
            <button type="button" class="game-button game-button--start" @click.stop="startGame">再飞一次</button>
            <button type="button" class="plain-button" @click.stop="returnToMenu">返回主页</button>
          </div>
        </div>
      </section>

      <section v-else class="panel-screen">
        <header class="panel-header">
          <h2>{{ panelTitle }}</h2>
          <button type="button" @click="returnToMenu">返回主页</button>
        </header>

        <div v-if="screen === 'ranking'" class="panel-scroll ranking-panel">
          <div class="ranking-summary">
            <div><span>全校玩家</span><strong>{{ totalPlayers }}</strong></div>
            <div v-if="cloudMe"><span>我的排名</span><strong>#{{ cloudMe.rank }}</strong></div>
            <button type="button" :disabled="leaderboardLoading" @click="loadLeaderboard(true)">
              {{ leaderboardLoading ? "刷新中..." : "刷新榜单" }}
            </button>
            <button
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
          <button v-if="!isLoggedIn" type="button" class="panel-login" @click="goToLogin">登录并加入全校排行</button>
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
          <button v-if="!isLoggedIn" type="button" class="panel-login" @click="goToLogin">登录并保存成就进度</button>
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
            <button type="button" :class="{ active: soundEnabled }" @click="toggleSound">{{ soundEnabled ? "开启" : "关闭" }}</button>
          </div>
          <div class="setting-row">
            <span><b>云端档案</b><small>{{ isLoggedIn ? "排行榜、局数和成就自动保存" : "当前成绩仅保存在这台设备" }}</small></span>
            <button v-if="!isLoggedIn" type="button" @click="goToLogin">登录</button>
            <b v-else class="cloud-online">已连接</b>
          </div>
          <p>操作：点击 / 触摸 / 空格 / ↑ 起飞，P 暂停，Esc 返回主页。</p>
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
  yaodaFlightApi,
  type YaodaFlightAchievement,
  type YaodaFlightLeaderboard,
  type YaodaFlightRankingEntry,
} from "@/api/yaodaFlight";
import UserAvatar from "@/components/common/UserAvatar.vue";
import cpuEmblem from "@/assets/yaoda-can-fly/cpu-emblem.png";
import {
  NJU_FLIGHT_PHYSICS,
  njuCircleIntersectsRect,
  njuFlightPipeGeometry,
} from "./yaodaFlightDifficulty";

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
const GAME_RELEASE = "20260904-v4" as const;

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

<style scoped>
:global(html.yaoda-flight-open),
:global(html.yaoda-flight-open body) {
  overflow: hidden !important;
  overscroll-behavior: none;
}

.flight-shell {
  --ink: #34302f;
  --cyan: #70c5ce;
  --blue: #2f80ed;
  --blue-dark: #1e5cac;
  --school-blue: #123f91;
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: grid;
  place-items: center;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 0%, rgba(129, 77, 112, 0.86), transparent 45%),
    linear-gradient(160deg, #271323, #160812 70%);
  font-family: "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif;
  color: var(--ink);
  touch-action: manipulation;
  user-select: none;
  color-scheme: light;
}

.game-phone {
  position: relative;
  width: min(430px, calc(100vw - 24px));
  height: min(760px, calc(100dvh - 30px));
  overflow: hidden;
  border: 4px solid #3d3937;
  border-radius: 18px;
  background: var(--cyan);
  box-shadow: 0 13px 0 rgba(48, 45, 43, 0.9), 0 24px 44px rgba(0, 0, 0, 0.35);
}

.menu-screen,
.panel-screen,
.game-layer {
  position: absolute;
  inset: 0;
}

.menu-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 11px;
  padding: 24px 34px 18px;
  background:
    radial-gradient(circle at 50% 20%, rgba(255,255,255,.32), transparent 25%),
    var(--cyan);
}

.corner-back {
  position: absolute;
  top: 12px;
  left: 12px;
  width: 40px;
  height: 40px;
  border: 3px solid #45413f;
  border-radius: 12px;
  color: #403b39;
  background: rgba(255,255,255,.92);
  box-shadow: 0 4px 0 #403b39;
  cursor: pointer;
  font-size: 22px;
  font-weight: 900;
}

.menu-emblem {
  width: 124px;
  height: 124px;
  padding: 7px;
  border: 2px solid rgba(18, 63, 145, .24);
  border-radius: 50%;
  background: rgba(255, 255, 255, .76);
  object-fit: contain;
  filter: drop-shadow(0 5px 0 rgba(47, 54, 61, 0.28));
}

.menu-screen h1 {
  margin: -3px 0 0;
  color: #173f7d !important;
  font-size: clamp(38px, 10vw, 48px);
  font-weight: 950;
  letter-spacing: 0.03em;
  line-height: 1;
  text-shadow: 3px 3px 0 #fff, 6px 6px 0 rgba(41, 55, 70, 0.25);
}

.menu-tagline {
  margin: 1px 0 2px;
  padding: 5px 12px;
  border-radius: 999px;
  color: #fff;
  background: rgba(54, 63, 67, 0.68);
  font-size: 11px;
  font-weight: 800;
}

.best-score-box {
  min-width: 110px;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 5px;
  padding: 10px 15px;
  border: 3px solid #413d3b;
  border-radius: 13px;
  background: #fff;
  box-shadow: 0 5px 0 #413d3b;
}

.best-score-box span { font-size: 14px; font-weight: 900; }
.best-score-box strong { color: #e11124; font-size: 24px; line-height: 1; }

.menu-actions {
  width: min(100%, 302px);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
  margin-top: 5px;
}

.game-button {
  min-height: 48px;
  border: 3px solid #403c39;
  border-radius: 12px;
  color: #fff;
  box-shadow: 0 6px 0 #403c39;
  cursor: pointer;
  font: inherit;
  font-size: 16px;
  font-weight: 950;
  letter-spacing: 0.02em;
  transition: transform .08s ease, box-shadow .08s ease;
}

.game-button:active { transform: translateY(4px); box-shadow: 0 2px 0 #403c39; }
.game-button--start { grid-column: 1 / -1; background: #ef0a17; }
.game-button--achievement { background: #ffb914; }
.game-button--ranking { background: #276fca; }
.game-button--secondary { background: var(--blue); font-size: 14px; }

.menu-footnote {
  margin: 7px 0 0;
  color: rgba(48, 66, 72, 0.68);
  font-size: 10px;
  font-weight: 700;
}

.game-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: var(--cyan);
  outline: none;
}

.game-layer { pointer-events: none; }
.game-layer button { pointer-events: auto; }

.score-board {
  position: absolute;
  top: 10px;
  left: 10px;
  min-width: 74px;
  display: grid;
  place-items: center;
  padding: 7px 10px;
  border: 3px solid #403c39;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 4px 0 #403c39;
  line-height: 1;
}

.score-board span { color: #6e6a66; font-size: 10px; font-weight: 800; }
.score-board strong { margin: 3px 0; color: #e11124; font-size: 26px; }
.score-board small { font-size: 11px; font-weight: 900; }

.game-controls {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 8px;
}

.game-controls button {
  width: 42px;
  height: 42px;
  border: 3px solid #403c39;
  border-radius: 12px;
  color: #272321;
  background: #fff;
  box-shadow: 0 4px 0 #403c39;
  cursor: pointer;
  font-size: 22px;
  font-weight: 950;
}

.ready-hint {
  position: absolute;
  top: 48%;
  left: 50%;
  width: min(84%, 310px);
  transform: translate(-50%, -50%);
  text-align: center;
}

.ready-flight-mark {
  display: block;
  margin-left: 116px;
  font-size: 48px;
  transform: rotate(-12deg);
}

.ready-hint h2 { margin: 13px 0 3px; color: #34302f !important; font-size: 23px; font-weight: 950; text-shadow: 2px 2px 0 rgba(255,255,255,.6); }
.ready-hint p { margin: 0; color: rgba(48, 65, 69, .72); font-size: 13px; font-weight: 800; }

.modal-shade {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 26px;
  background: rgba(17, 26, 27, .52);
  backdrop-filter: blur(4px);
  pointer-events: auto;
}

.game-modal {
  width: min(100%, 310px);
  padding: 22px;
  border: 4px solid #403c39;
  border-radius: 18px;
  background: #eefaff;
  box-shadow: 0 9px 0 rgba(46, 43, 41, .9);
  text-align: center;
}

.modal-icon { font-size: 34px; }
.game-modal h2 { margin: 7px 0 3px; color: #34302f !important; font-size: 25px; }
.game-modal p { margin: 5px 0 15px; }
.game-modal .game-button { width: 100%; margin-top: 8px; }

.plain-button {
  margin-top: 15px;
  border: 0;
  color: #5b5552;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 850;
}

.result-label {
  display: inline-block;
  padding: 5px 10px;
  border-radius: 999px;
  color: #7a4300;
  background: #ffe19b;
  font-size: 11px;
  font-weight: 900;
}

.final-score { display: inline-block; margin: 9px 0 0; color: #e11124; font-size: 72px; line-height: 1; }
.final-unit { margin-left: 4px; font-size: 13px; font-weight: 800; }
.result-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin: 12px 0 7px; }
.result-stats span { display: flex; flex-direction: column; padding: 8px; border: 2px solid #d1dadd; border-radius: 9px; background: #fff; }
.result-stats small { color: #777; font-size: 9px; }
.result-stats b { margin-top: 2px; font-size: 13px; }
.cloud-result { min-height: 18px; margin: 8px 0 !important; color: #9a5d00; font-size: 10px; font-weight: 750; }
.cloud-result.success { color: #127845; }
.new-unlocks { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; margin: 6px 0; }
.new-unlocks b { padding: 4px 7px; border-radius: 999px; color: #7a4300; background: #fff0bd; font-size: 9px; }

.panel-screen {
  display: flex;
  flex-direction: column;
  background: var(--cyan);
}

.panel-header {
  flex: 0 0 auto;
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 15px;
  border-bottom: 3px solid #403c39;
  background: #effaff;
}

.panel-header h2 { margin: 0; color: #34302f !important; font-size: 20px; font-weight: 950; }
.panel-header button {
  min-height: 42px;
  padding: 0 14px;
  border: 3px solid #403c39;
  border-radius: 11px;
  background: #fff;
  box-shadow: 0 5px 0 #403c39;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 900;
}

.panel-scroll {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px;
  scrollbar-color: #777 transparent;
  scrollbar-width: thin;
}

.ranking-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 11px;
}

.ranking-summary div {
  display: flex;
  flex-direction: column;
  padding: 10px;
  border: 2px solid rgba(60, 57, 55, .4);
  border-radius: 10px;
  background: rgba(255,255,255,.75);
}

.ranking-summary span { color: #777; font-size: 9px; font-weight: 800; }
.ranking-summary strong { margin-top: 2px; color: var(--school-blue); font-size: 20px; }
.ranking-summary button {
  grid-column: 1 / -1;
  min-height: 38px;
  border: 2px solid #403c39;
  border-radius: 9px;
  color: #fff;
  background: var(--school-blue);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 850;
}

.ranking-summary .manual-sync-button { background: #167242; }
.ranking-summary button:disabled { cursor: wait; opacity: .62; }
.history-sync-message {
  margin: -2px 0 10px;
  color: #285b3d;
  font-size: 10px;
  font-weight: 800;
  text-align: center;
}

.ranking-list,
.history-list { display: flex; flex-direction: column; gap: 7px; margin: 0; padding: 0; list-style: none; }

.ranking-list li {
  display: grid;
  grid-template-columns: 28px 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 60px;
  padding: 7px 10px;
  border: 2px solid rgba(62, 58, 55, .28);
  border-radius: 11px;
  background: rgba(239, 250, 255, .9);
  box-shadow: 0 3px 0 rgba(54, 68, 70, .18);
}

.ranking-list li.me { border-color: #f0a700; background: #fff7d7; }
.rank-number { color: #5e5a57; font-size: 14px; font-weight: 950; text-align: center; }
.ranking-list li:nth-child(1) .rank-number { color: #c48000; font-size: 20px; }
.ranking-list li:nth-child(2) .rank-number { color: #697987; font-size: 18px; }
.ranking-list li:nth-child(3) .rank-number { color: #9a5f3a; font-size: 17px; }
.rank-user { display: flex; flex-direction: column; min-width: 0; }
.rank-user b { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.rank-user small { overflow: hidden; color: #6c7779; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.ranking-list li > strong { color: #e11124; font-size: 20px; }

.panel-counter { margin: 0 0 10px; font-size: 12px; font-weight: 800; }
.panel-counter b { color: #d7192d; }
.achievement-list { display: flex; flex-direction: column; gap: 8px; }

.achievement-list article {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-height: 63px;
  padding: 8px 10px;
  border: 2px solid rgba(62, 58, 55, .23);
  border-radius: 10px;
  background: rgba(239, 250, 255, .78);
  filter: grayscale(.76);
  opacity: .68;
}

.achievement-list article.unlocked {
  border-color: #daa102;
  background: #fff7d7;
  filter: none;
  opacity: 1;
}

.achievement-icon { font-size: 25px; text-align: center; }
.achievement-copy { display: flex; flex-direction: column; min-width: 0; }
.achievement-copy b { font-size: 12px; }
.achievement-copy small { color: #647275; font-size: 9px; }
.achievement-copy i { height: 4px; margin-top: 5px; overflow: hidden; border-radius: 999px; background: rgba(18,63,145,.13); }
.achievement-copy i em { display: block; height: 100%; background: var(--school-blue); }
.achievement-list article > strong { color: #879092; font-size: 9px; }
.achievement-list article.unlocked > strong { color: #a06400; }

.empty-panel {
  min-height: 210px;
  display: grid;
  place-items: center;
  color: rgba(65, 84, 87, .54);
  font-size: 13px;
  font-weight: 750;
  text-align: center;
}

.panel-login {
  width: 100%;
  min-height: 44px;
  margin-top: 12px;
  border: 3px solid #403c39;
  border-radius: 10px;
  color: #fff;
  background: var(--school-blue);
  box-shadow: 0 5px 0 #403c39;
  cursor: pointer;
  font: inherit;
  font-weight: 900;
}

.panel-error { color: #9c4f00; font-size: 10px; text-align: center; }

.history-list li {
  display: grid;
  grid-template-columns: 32px 70px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 58px;
  padding: 9px 11px;
  border: 2px solid rgba(62, 58, 55, .24);
  border-radius: 10px;
  background: rgba(239, 250, 255, .82);
}

.history-list li > span { color: #788486; font-size: 11px; font-weight: 900; }
.history-list li > b { color: #e11124; font-size: 17px; }
.history-list li > small { color: #6c7779; font-size: 9px; }
.history-list li > em { color: var(--school-blue); font-size: 9px; font-style: normal; font-weight: 850; }

.flight-settings-panel { display: flex; flex-direction: column; gap: 12px; }
.flight-settings-panel > img {
  width: 116px;
  height: 116px;
  align-self: center;
  margin: 8px 0 4px;
  padding: 7px;
  border: 2px solid rgba(18, 63, 145, .24);
  border-radius: 50%;
  background: rgba(255, 255, 255, .76);
  object-fit: contain;
}

.setting-row {
  min-height: 66px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 13px;
  border: 2px solid #403c39;
  border-radius: 11px;
  background: #effaff;
}

.setting-row > span { display: flex; flex-direction: column; }
.setting-row b { font-size: 13px; }
.setting-row small { margin-top: 3px; color: #687577; font-size: 9px; }
.setting-row button {
  flex: 0 0 auto;
  min-width: 70px;
  min-height: 38px;
  border: 2px solid #403c39;
  border-radius: 9px;
  color: #fff;
  background: #777;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 900;
}

.setting-row button.active { background: var(--blue); }
.cloud-online { color: #167242; }
.flight-settings-panel > p { margin: 0; color: #536467; font-size: 10px; line-height: 1.7; text-align: center; }

@media (max-width: 600px) {
  .flight-shell { place-items: stretch; background: #160812; }
  .game-phone {
    width: 100vw;
    height: 100dvh;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .menu-screen { padding-right: 28px; padding-left: 28px; }
  .panel-header { padding-top: max(12px, env(safe-area-inset-top)); }
  .panel-scroll { padding-bottom: max(14px, env(safe-area-inset-bottom)); }
}

@media (max-height: 720px) {
  .menu-screen { gap: 7px; padding-top: 14px; padding-bottom: 10px; }
  .menu-emblem { width: 90px; height: 90px; }
  .menu-screen h1 { font-size: 34px; }
  .menu-tagline { font-size: 9px; }
  .best-score-box { padding: 7px 12px; }
  .menu-actions { gap: 7px; }
  .game-button { min-height: 42px; font-size: 14px; box-shadow: 0 4px 0 #403c39; }
  .menu-footnote { margin-top: 3px; }
}

@media (max-height: 620px) {
  .menu-emblem { width: 70px; height: 70px; }
  .menu-screen h1 { font-size: 30px; }
  .menu-tagline { display: none; }
  .best-score-box { min-width: 96px; padding: 5px 10px; }
  .game-button { min-height: 38px; }
}
</style>
