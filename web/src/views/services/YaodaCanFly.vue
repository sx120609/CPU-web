<template>
  <main class="flight-page">
    <header class="flight-topbar">
      <button type="button" class="back-link" @click="router.push('/services/tools')">
        <el-icon><ArrowLeft /></el-icon>
        <span>返回小工具</span>
      </button>
      <div class="brand-lockup">
        <img :src="cpuFlightEmblem" alt="药大人能飞创意校标" />
        <span><b>药大人能飞</b><small>校园创意版</small></span>
      </div>
      <button type="button" class="icon-action" :aria-label="soundEnabled ? '关闭音效' : '开启音效'" @click="toggleSound">
        <el-icon><Bell v-if="soundEnabled" /><MuteNotification v-else /></el-icon>
      </button>
    </header>

    <section class="flight-layout">
      <div ref="stageEl" class="game-stage" :class="`phase-${phase}`">
        <canvas
          ref="canvasEl"
          class="game-canvas"
          role="img"
          aria-label="药大人能飞游戏区域"
          tabindex="0"
          @pointerdown="handleCanvasPointer"
        ></canvas>

        <div v-if="phase !== 'menu'" class="game-hud" aria-live="polite">
          <div class="score-chip">
            <small>本局</small>
            <strong>{{ score }}</strong>
          </div>
          <div class="score-chip score-chip--best">
            <small>最高</small>
            <strong>{{ bestScore }}</strong>
          </div>
          <button
            v-if="phase === 'playing' || phase === 'paused'"
            type="button"
            class="hud-button"
            :aria-label="phase === 'paused' ? '继续游戏' : '暂停游戏'"
            @click.stop="togglePause"
          >
            <el-icon><VideoPlay v-if="phase === 'paused'" /><VideoPause v-else /></el-icon>
          </button>
        </div>

        <Transition name="panel-pop">
          <div v-if="phase === 'menu'" class="game-overlay game-overlay--menu">
            <div class="school-emblem-hero"><img :src="cpuFlightEmblem" alt="药大人能飞创意校标" /></div>
            <p class="eyebrow">中国药科大学 · 校园小游戏</p>
            <h1>药大人能飞</h1>
            <p class="menu-copy">让胶囊乘风而起，穿过药学实验装置。</p>
            <button type="button" class="primary-button" @click.stop="startGame">
              <el-icon><Promotion /></el-icon>
              开始飞行
            </button>
            <div class="control-hint">
              <span>点击 / 触摸</span>
              <i></i>
              <span>空格 / ↑</span>
            </div>
          </div>
        </Transition>

        <Transition name="panel-pop">
          <div v-if="phase === 'paused'" class="game-overlay game-overlay--compact">
            <div class="overlay-card">
              <span class="overlay-icon"><el-icon><VideoPause /></el-icon></span>
              <p class="eyebrow">稍作休息</p>
              <h2>飞行已暂停</h2>
              <p>当前 {{ score }} 分，状态已为你保留。</p>
              <button type="button" class="primary-button" @click.stop="togglePause">
                <el-icon><VideoPlay /></el-icon>
                继续飞行
              </button>
              <button type="button" class="text-button" @click.stop="returnToMenu">返回首页</button>
            </div>
          </div>
        </Transition>

        <Transition name="panel-pop">
          <div v-if="phase === 'over'" class="game-overlay game-overlay--compact">
            <div class="overlay-card result-card">
              <span class="result-badge" :class="{ 'is-record': isNewRecord }">
                {{ isNewRecord ? "新纪录" : resultTitle }}
              </span>
              <strong class="result-score">{{ score }}</strong>
              <span class="result-unit">分</span>
              <div class="result-meta">
                <span><small>历史最高</small><b>{{ bestScore }}</b></span>
                <span><small>飞行等级</small><b>{{ flightRank }}</b></span>
              </div>
              <p class="cloud-result" :class="{ success: cloudSubmitState === 'success' }">{{ cloudResultMessage }}</p>
              <div v-if="newlyUnlocked.length" class="new-achievements" aria-live="polite">
                <span>新成就</span>
                <b v-for="achievement in newlyUnlocked" :key="achievement.code">
                  {{ achievement.icon }} {{ achievement.title }}
                </b>
              </div>
              <button type="button" class="primary-button" @click.stop="startGame">
                <el-icon><RefreshRight /></el-icon>
                再飞一次
              </button>
              <button type="button" class="text-button" @click.stop="returnToMenu">返回首页</button>
            </div>
          </div>
        </Transition>

        <div v-if="phase === 'playing' && score === 0" class="tap-prompt">
          <span>轻点保持飞行</span>
          <small>避开上、下方装置</small>
        </div>
      </div>

      <aside class="game-sidebar">
        <section class="side-card score-summary">
          <div>
            <span class="side-kicker">MY FLIGHT LOG</span>
            <h2>我的飞行记录</h2>
          </div>
          <div class="best-block">
            <span>BEST</span>
            <strong>{{ bestScore }}</strong>
            <small>最高分</small>
          </div>
          <div class="stats-row">
            <span><b>{{ history.length }}</b><small>记录局数</small></span>
            <span><b>{{ totalScore }}</b><small>累计穿越</small></span>
          </div>
        </section>

        <section class="side-card leaderboard-card">
          <div class="side-title-row">
            <div>
              <span class="side-kicker">CAMPUS RANKING</span>
              <h3>全校飞行榜</h3>
            </div>
            <button type="button" class="refresh-rank" aria-label="刷新排行榜" :disabled="leaderboardLoading" @click="loadLeaderboard(true)">
              <el-icon><RefreshRight /></el-icon>
            </button>
          </div>
          <div v-if="leaderboardLoading && !leaderboard.length" class="rank-state">正在读取云端战绩...</div>
          <ol v-else-if="leaderboard.length" class="leaderboard-list">
            <li v-for="entry in leaderboard.slice(0, 8)" :key="entry.userId" :class="{ me: cloudMe?.userId === entry.userId }">
              <span class="leaderboard-rank">{{ entry.rank }}</span>
              <span class="leaderboard-avatar">{{ entry.name.slice(0, 1) }}</span>
              <span class="leaderboard-user"><b>{{ entry.name }}</b><small>{{ entry.games }} 局 · {{ entry.achievementCount }} 枚成就</small></span>
              <strong>{{ entry.bestScore }}</strong>
            </li>
          </ol>
          <div v-else class="rank-state">还没有云端战绩，登录后拿下第一名。</div>
          <div v-if="cloudMe" class="my-cloud-rank">
            <span>我的全校排名</span>
            <strong>#{{ cloudMe.rank }}</strong>
            <small>云端最高 {{ cloudMe.bestScore }} 分</small>
          </div>
          <button v-else-if="!isLoggedIn" type="button" class="login-rank-button" @click="goToLogin">登录并加入排行榜</button>
          <p v-if="leaderboardError" class="rank-error">{{ leaderboardError }}</p>
          <small class="player-count">已有 {{ totalPlayers }} 位同学留下战绩</small>
        </section>

        <section class="side-card achievements-card">
          <div class="side-title-row">
            <div>
              <span class="side-kicker">CLOUD ACHIEVEMENTS</span>
              <h3>飞行成就册</h3>
            </div>
            <span class="achievement-total">{{ unlockedAchievementCount }}/{{ achievements.length }}</span>
          </div>
          <div v-if="achievements.length" class="achievement-grid">
            <article
              v-for="achievement in visibleAchievements"
              :key="achievement.code"
              class="achievement-item"
              :class="{ unlocked: achievement.unlocked }"
            >
              <span class="achievement-icon" aria-hidden="true">{{ achievement.icon }}</span>
              <span class="achievement-copy">
                <b>{{ achievement.title }}</b>
                <small>{{ achievement.description }}</small>
                <i><em :style="{ width: `${achievementPercent(achievement)}%` }"></em></i>
                <span>{{ achievement.unlocked ? "已解锁" : `${achievement.progress}/${achievement.target}` }}</span>
              </span>
            </article>
          </div>
          <div v-else class="rank-state">成就册正在连接云端...</div>
          <button
            v-if="achievements.length > 6"
            type="button"
            class="achievement-toggle"
            @click="showAllAchievements = !showAllAchievements"
          >
            {{ showAllAchievements ? "收起成就" : `查看全部 ${achievements.length} 项成就` }}
          </button>
          <p v-if="!isLoggedIn" class="achievement-login-note">登录后解锁进度将永久保存在云端。</p>
        </section>

        <section class="side-card history-card">
          <div class="side-title-row">
            <div>
              <span class="side-kicker">RECENT</span>
              <h3>最近战绩</h3>
            </div>
            <el-icon><Clock /></el-icon>
          </div>
          <ol v-if="history.length" class="history-list">
            <li v-for="(item, index) in history" :key="`${item.playedAt}-${index}`">
              <span class="history-rank">{{ String(index + 1).padStart(2, "0") }}</span>
              <span class="history-main">
                <b>{{ item.score }} 分</b>
                <small>{{ formatHistoryDate(item.playedAt) }}</small>
              </span>
              <span class="history-level">{{ rankForScore(item.score) }}</span>
            </li>
          </ol>
          <div v-else class="empty-history">
            <el-icon><Promotion /></el-icon>
            <span>第一段飞行正等你出发</span>
          </div>
        </section>

        <section class="side-card rules-card">
          <div class="side-title-row">
            <div>
              <span class="side-kicker">HOW TO PLAY</span>
              <h3>飞行说明</h3>
            </div>
          </div>
          <ul>
            <li><kbd>空格</kbd><span>或点击画面，让胶囊向上振翅</span></li>
            <li><kbd>P</kbd><span>暂停 / 继续当前飞行</span></li>
            <li><kbd>Esc</kbd><span>结束本局并返回游戏首页</span></li>
          </ul>
          <p>未登录时成绩只保存在当前浏览器；登录后，经过校验的成绩会自动计入全校榜。</p>
        </section>
      </aside>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  ArrowLeft,
  Bell,
  Clock,
  MuteNotification,
  Promotion,
  RefreshRight,
  VideoPause,
  VideoPlay,
} from "@element-plus/icons-vue";
import { getToken } from "@/api/request";
import {
  yaodaFlightApi,
  type YaodaFlightAchievement,
  type YaodaFlightLeaderboard,
  type YaodaFlightRankingEntry,
} from "@/api/yaodaFlight";
import cpuFlightEmblem from "@/assets/yaoda-can-fly/cpu-flight-emblem.svg";

type GamePhase = "menu" | "playing" | "paused" | "over";
type Pipe = { x: number; gapY: number; passed: boolean; variant: number };
type HistoryItem = { score: number; playedAt: string };

const router = useRouter();
const canvasEl = ref<HTMLCanvasElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);
const phase = ref<GamePhase>("menu");
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
const cloudSubmitState = ref<"idle" | "syncing" | "success" | "error" | "guest">("idle");
const achievements = ref<YaodaFlightAchievement[]>([]);
const newlyUnlocked = ref<YaodaFlightLeaderboard["newlyUnlocked"]>([]);
const showAllAchievements = ref(false);

const WORLD_WIDTH = 390;
const WORLD_HEIGHT = 680;
const GROUND_HEIGHT = 76;
const PLAYER_X = 104;
const PLAYER_RADIUS = 17;
const PIPE_WIDTH = 68;
const STORAGE_PREFIX = "cpu-web:yaoda-can-fly:v1";

let playerY = WORLD_HEIGHT * 0.46;
let velocityY = 0;
let pipes: Pipe[] = [];
let elapsed = 0;
let lastFrameAt = 0;
let animationFrame = 0;
let resizeObserver: ResizeObserver | null = null;
let audioContext: AudioContext | null = null;
let canvasContext: CanvasRenderingContext2D | null = null;
let cloudAttemptPromise: Promise<number | null> = Promise.resolve(null);
let cloudSettlementPromise: Promise<void> = Promise.resolve();
let gameGeneration = 0;

const isLoggedIn = computed(() => Boolean(getToken()));
const totalScore = computed(() => history.value.reduce((total, item) => total + item.score, 0));
const flightRank = computed(() => rankForScore(score.value));
const resultTitle = computed(() => score.value >= 10 ? "飞得漂亮" : score.value >= 4 ? "渐入佳境" : "再试一次");
const unlockedAchievementCount = computed(() => achievements.value.filter((achievement) => achievement.unlocked).length);
const visibleAchievements = computed(() => showAllAchievements.value ? achievements.value : achievements.value.slice(0, 6));
const cloudResultMessage = computed(() => {
  if (cloudSubmitState.value === "syncing") return "正在校验并同步云端战绩...";
  if (cloudSubmitState.value === "success") return `已计入全校榜${cloudMe.value ? ` · 当前第 ${cloudMe.value.rank} 名` : ""}`;
  if (cloudSubmitState.value === "error") return "本局已保存在本机，云端同步未完成";
  if (cloudSubmitState.value === "guest") return "登录后，下一局成绩可加入全校榜";
  return "";
});

onMounted(() => {
  bestScore.value = readNumber(`${STORAGE_PREFIX}:best`);
  history.value = readHistory();
  soundEnabled.value = readBoolean(`${STORAGE_PREFIX}:sound`, true);
  window.addEventListener("keydown", handleKeydown);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  resizeObserver = new ResizeObserver(resizeCanvas);
  if (stageEl.value) resizeObserver.observe(stageEl.value);
  void loadLeaderboard();
  nextTick(() => {
    resizeCanvas();
    drawScene();
  });
});

onBeforeUnmount(() => {
  if (phase.value === "playing" || phase.value === "paused") {
    cloudSettlementPromise = abandonCloudAttempt(cloudAttemptPromise);
  }
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", handleKeydown);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  void audioContext?.close();
});

function startGame() {
  if (phase.value === "playing") return;
  gameGeneration += 1;
  const generation = gameGeneration;
  score.value = 0;
  isNewRecord.value = false;
  newlyUnlocked.value = [];
  playerY = WORLD_HEIGHT * 0.46;
  velocityY = -345;
  elapsed = 0;
  cloudSubmitState.value = isLoggedIn.value ? "idle" : "guest";
  cloudAttemptPromise = cloudSettlementPromise.then(() => beginCloudAttempt(generation));
  pipes = [createPipe(WORLD_WIDTH + 74, 0), createPipe(WORLD_WIDTH + 306, 1)];
  phase.value = "playing";
  lastFrameAt = performance.now();
  ensureAudio();
  playTone(520, 0.055, 0.035);
  canvasEl.value?.focus({ preventScroll: true });
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(gameLoop);
}

function returnToMenu() {
  const shouldAbandon = phase.value === "playing" || phase.value === "paused";
  const pendingAttempt = cloudAttemptPromise;
  gameGeneration += 1;
  if (shouldAbandon) cloudSettlementPromise = abandonCloudAttempt(pendingAttempt);
  phase.value = "menu";
  pipes = [];
  playerY = WORLD_HEIGHT * 0.46;
  velocityY = 0;
  cancelAnimationFrame(animationFrame);
  drawScene();
}

function togglePause() {
  if (phase.value === "playing") {
    phase.value = "paused";
    cancelAnimationFrame(animationFrame);
    drawScene();
  } else if (phase.value === "paused") {
    phase.value = "playing";
    lastFrameAt = performance.now();
    animationFrame = requestAnimationFrame(gameLoop);
  }
}

function flap() {
  if (phase.value !== "playing") return;
  velocityY = -370;
  playTone(670, 0.04, 0.025);
}

function handleCanvasPointer(event: PointerEvent) {
  event.preventDefault();
  if (phase.value === "playing") flap();
}

function handleKeydown(event: KeyboardEvent) {
  if (["Space", "ArrowUp"].includes(event.code)) {
    event.preventDefault();
    if (phase.value === "menu" || phase.value === "over") startGame();
    else flap();
    return;
  }
  if (event.code === "Enter" && (phase.value === "menu" || phase.value === "over")) {
    event.preventDefault();
    startGame();
  } else if (event.code === "KeyP" && (phase.value === "playing" || phase.value === "paused")) {
    event.preventDefault();
    togglePause();
  } else if (event.code === "Escape" && phase.value !== "menu") {
    event.preventDefault();
    returnToMenu();
  }
}

function handleVisibilityChange() {
  if (document.hidden && phase.value === "playing") togglePause();
}

function gameLoop(now: number) {
  if (phase.value !== "playing") return;
  const delta = Math.min((now - lastFrameAt) / 1000, 0.034);
  lastFrameAt = now;
  updateGame(delta);
  drawScene();
  if (phase.value === "playing") animationFrame = requestAnimationFrame(gameLoop);
}

function updateGame(delta: number) {
  elapsed += delta;
  const speed = 128 + Math.min(score.value * 2.4, 44);
  const gapSize = Math.max(142, 176 - score.value * 1.15);
  velocityY += 1120 * delta;
  playerY += velocityY * delta;

  for (const pipe of pipes) {
    pipe.x -= speed * delta;
    if (!pipe.passed && pipe.x + PIPE_WIDTH < PLAYER_X) {
      pipe.passed = true;
      score.value += 1;
      playTone(880, 0.075, 0.045);
    }
  }

  const lastPipe = pipes[pipes.length - 1];
  if (lastPipe && lastPipe.x < WORLD_WIDTH - 228) {
    pipes.push(createPipe(lastPipe.x + 228, pipes.length));
  }
  pipes = pipes.filter((pipe) => pipe.x > -PIPE_WIDTH - 12);

  if (playerY - PLAYER_RADIUS <= 0 || playerY + PLAYER_RADIUS >= WORLD_HEIGHT - GROUND_HEIGHT) {
    finishGame();
    return;
  }

  for (const pipe of pipes) {
    const overlapsX = PLAYER_X + PLAYER_RADIUS - 3 > pipe.x && PLAYER_X - PLAYER_RADIUS + 3 < pipe.x + PIPE_WIDTH;
    const overlapsY = playerY - PLAYER_RADIUS + 4 < pipe.gapY - gapSize / 2
      || playerY + PLAYER_RADIUS - 4 > pipe.gapY + gapSize / 2;
    if (overlapsX && overlapsY) {
      finishGame();
      return;
    }
  }
}

function finishGame() {
  if (phase.value !== "playing") return;
  phase.value = "over";
  isNewRecord.value = score.value > bestScore.value;
  if (isNewRecord.value) {
    bestScore.value = score.value;
    writeStorage(`${STORAGE_PREFIX}:best`, String(bestScore.value));
  }
  const item: HistoryItem = { score: score.value, playedAt: new Date().toISOString() };
  history.value = [item, ...history.value].slice(0, 6);
  writeStorage(`${STORAGE_PREFIX}:history`, JSON.stringify(history.value));
  const generation = gameGeneration;
  const finalScore = score.value;
  const durationMs = Math.max(0, Math.round(elapsed * 1000));
  cloudSettlementPromise = finishCloudAttempt(cloudAttemptPromise, generation, finalScore, durationMs);
  playTone(180, 0.16, 0.06);
  window.setTimeout(() => playTone(130, 0.2, 0.045), 110);
}

function createPipe(x: number, variant: number): Pipe {
  const min = 180;
  const max = WORLD_HEIGHT - GROUND_HEIGHT - 178;
  const wave = (Math.sin(elapsed * 1.7 + variant * 2.13) + 1) / 2;
  const jitter = Math.random() * 42 - 21;
  return { x, gapY: Math.max(min, Math.min(max, min + wave * (max - min) + jitter)), passed: false, variant: variant % 3 };
}

function resizeCanvas() {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(WORLD_WIDTH * ratio);
  canvas.height = Math.round(WORLD_HEIGHT * ratio);
  canvasContext = canvas.getContext("2d");
  canvasContext?.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawScene();
}

function drawScene() {
  const context = canvasContext;
  if (!context) return;
  context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  drawBackground(context);
  for (const pipe of pipes) drawObstacle(context, pipe);
  drawPlayer(context);
  drawGround(context);
}

function drawBackground(context: CanvasRenderingContext2D) {
  const sky = context.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
  sky.addColorStop(0, "#b9eee7");
  sky.addColorStop(0.58, "#e8faf4");
  sky.addColorStop(1, "#fff5d8");
  context.fillStyle = sky;
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  context.globalAlpha = 0.5;
  for (let index = 0; index < 5; index += 1) {
    const x = ((index * 104 - elapsed * (10 + index * 1.5)) % 540 + 540) % 540 - 70;
    const y = 82 + (index % 3) * 92;
    drawCloud(context, x, y, 0.72 + (index % 2) * 0.22);
  }
  context.globalAlpha = 1;

  context.fillStyle = "rgba(15, 143, 123, 0.11)";
  context.beginPath();
  context.moveTo(0, WORLD_HEIGHT - GROUND_HEIGHT);
  context.lineTo(0, 474);
  context.lineTo(52, 448);
  context.lineTo(96, 469);
  context.lineTo(140, 423);
  context.lineTo(186, 461);
  context.lineTo(238, 435);
  context.lineTo(294, 466);
  context.lineTo(344, 429);
  context.lineTo(WORLD_WIDTH, 452);
  context.lineTo(WORLD_WIDTH, WORLD_HEIGHT - GROUND_HEIGHT);
  context.closePath();
  context.fill();

  context.fillStyle = "rgba(18, 108, 95, 0.13)";
  for (let x = 18; x < WORLD_WIDTH; x += 58) {
    const height = 52 + ((x / 58) % 3) * 13;
    context.fillRect(x, WORLD_HEIGHT - GROUND_HEIGHT - height, 38, height);
    context.fillRect(x + 11, WORLD_HEIGHT - GROUND_HEIGHT - height - 9, 16, 9);
  }
}

function drawCloud(context: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(x, y, 19 * scale, 0, Math.PI * 2);
  context.arc(x + 23 * scale, y - 10 * scale, 25 * scale, 0, Math.PI * 2);
  context.arc(x + 52 * scale, y, 20 * scale, 0, Math.PI * 2);
  context.rect(x, y, 52 * scale, 19 * scale);
  context.fill();
}

function drawObstacle(context: CanvasRenderingContext2D, pipe: Pipe) {
  const gapSize = Math.max(142, 176 - score.value * 1.15);
  const topHeight = pipe.gapY - gapSize / 2;
  const bottomY = pipe.gapY + gapSize / 2;
  drawLabColumn(context, pipe.x, -16, topHeight + 16, false, pipe.variant);
  drawLabColumn(context, pipe.x, bottomY, WORLD_HEIGHT - GROUND_HEIGHT - bottomY + 16, true, pipe.variant);
}

function drawLabColumn(context: CanvasRenderingContext2D, x: number, y: number, height: number, bottom: boolean, variant: number) {
  const dark = variant === 1 ? "#0b6f68" : variant === 2 ? "#177c70" : "#0f8f7b";
  const light = variant === 1 ? "#44b7a7" : variant === 2 ? "#4eaa91" : "#56bca9";
  context.save();
  context.shadowColor = "rgba(15, 70, 62, 0.18)";
  context.shadowBlur = 10;
  context.shadowOffsetX = 2;
  context.fillStyle = dark;
  roundedRect(context, x, y, PIPE_WIDTH, height, 9);
  context.fill();
  context.shadowColor = "transparent";

  context.fillStyle = light;
  roundedRect(context, x + 9, y + 8, 13, Math.max(0, height - 16), 5);
  context.fill();

  const capY = bottom ? y : y + height - 22;
  context.fillStyle = "#f4a31a";
  roundedRect(context, x - 7, capY, PIPE_WIDTH + 14, 22, 7);
  context.fill();
  context.strokeStyle = "#8b5a0b";
  context.lineWidth = 3;
  context.stroke();

  const labelY = bottom ? y + 40 : y + height - 78;
  if (labelY > y + 20 && labelY < y + height - 24) {
    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    roundedRect(context, x + 13, labelY, PIPE_WIDTH - 26, 30, 7);
    context.fill();
    context.fillStyle = dark;
    context.font = "800 11px Inter, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("CPU", x + PIPE_WIDTH / 2, labelY + 15);
  }
  context.restore();
}

function drawPlayer(context: CanvasRenderingContext2D) {
  const idleBob = phase.value === "menu" ? Math.sin(performance.now() / 420) * 7 : 0;
  const angle = phase.value === "playing" ? Math.max(-0.45, Math.min(0.72, velocityY / 720)) : -0.08;
  context.save();
  context.translate(PLAYER_X, playerY + idleBob);
  context.rotate(angle);

  context.fillStyle = "rgba(16, 76, 68, 0.18)";
  context.beginPath();
  context.ellipse(2, 23, 29, 7, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#ffffff";
  context.strokeStyle = "#0a6d61";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(-17, -4);
  context.bezierCurveTo(-39, -24, -42, 5, -20, 13);
  context.closePath();
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(17, -4);
  context.bezierCurveTo(39, -24, 42, 5, 20, 13);
  context.closePath();
  context.fill();
  context.stroke();

  context.save();
  roundedRect(context, -27, -15, 54, 30, 15);
  context.clip();
  context.fillStyle = "#0f8f7b";
  context.fillRect(-27, -15, 27, 30);
  context.fillStyle = "#f4a31a";
  context.fillRect(0, -15, 27, 30);
  context.fillStyle = "rgba(255, 255, 255, 0.28)";
  context.fillRect(-20, -10, 37, 6);
  context.restore();
  context.strokeStyle = "#075c53";
  context.lineWidth = 3;
  roundedRect(context, -27, -15, 54, 30, 15);
  context.stroke();

  context.fillStyle = "#ffffff";
  context.fillRect(-7, -3, 14, 6);
  context.fillRect(-3, -7, 6, 14);
  context.restore();
}

function drawGround(context: CanvasRenderingContext2D) {
  const y = WORLD_HEIGHT - GROUND_HEIGHT;
  context.fillStyle = "#f4a31a";
  context.fillRect(0, y, WORLD_WIDTH, 9);
  context.fillStyle = "#165f55";
  context.fillRect(0, y + 9, WORLD_WIDTH, GROUND_HEIGHT - 9);
  context.fillStyle = "rgba(255,255,255,.12)";
  const offset = (elapsed * 70) % 38;
  for (let x = -38 - offset; x < WORLD_WIDTH + 38; x += 38) {
    context.beginPath();
    context.ellipse(x + 16, y + 38, 15, 7, -0.45, 0, Math.PI * 2);
    context.fill();
  }
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function toggleSound() {
  soundEnabled.value = !soundEnabled.value;
  writeStorage(`${STORAGE_PREFIX}:sound`, String(soundEnabled.value));
  if (soundEnabled.value) {
    ensureAudio();
    playTone(620, 0.07, 0.035);
  }
}

async function loadLeaderboard(force = false) {
  if (leaderboardLoading.value) return;
  leaderboardLoading.value = true;
  leaderboardError.value = "";
  try {
    applyLeaderboard(await yaodaFlightApi.leaderboard({ cacheTtlMs: force ? 0 : 15_000 }));
  } catch {
    leaderboardError.value = "排行榜暂时没有连接上";
  } finally {
    leaderboardLoading.value = false;
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
  } catch {
    if (generation === gameGeneration) cloudSubmitState.value = "error";
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
    // A later start also closes unfinished attempts, so abandoning is best effort.
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
    if (generation === gameGeneration) cloudSubmitState.value = "error";
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
  } catch {
    if (generation === gameGeneration) cloudSubmitState.value = "error";
  }
}

function applyLeaderboard(value: YaodaFlightLeaderboard) {
  leaderboard.value = value.leaderboard;
  cloudMe.value = value.me;
  totalPlayers.value = value.totalPlayers;
  achievements.value = value.achievements;
  newlyUnlocked.value = value.newlyUnlocked;
}

function achievementPercent(achievement: YaodaFlightAchievement) {
  if (achievement.unlocked) return 100;
  return Math.min(100, Math.max(0, Math.round((achievement.progress / Math.max(1, achievement.target)) * 100)));
}

function goToLogin() {
  router.push({ name: "login", query: { redirect: "/services/tools/yaoda-can-fly" } });
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
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function rankForScore(value: number) {
  if (value >= 30) return "药学传奇";
  if (value >= 18) return "实验室王牌";
  if (value >= 10) return "熟练药师";
  if (value >= 4) return "飞行新秀";
  return "见习胶囊";
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function readNumber(key: string) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function readBoolean(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function readHistory(): HistoryItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}:history`) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is HistoryItem => Number.isFinite(item?.score) && typeof item?.playedAt === "string")
      .slice(0, 6);
  } catch {
    return [];
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or embedded browser modes.
  }
}
</script>

<style scoped>
.flight-page {
  --flight-green: #0f8f7b;
  --flight-green-dark: #075f55;
  --flight-orange: #f4a31a;
  --flight-ink: #17332f;
  width: min(1180px, 100%);
  margin: 0 auto;
  padding: 18px clamp(12px, 2.4vw, 28px) 34px;
  color: var(--flight-ink);
}

.flight-topbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  min-height: 56px;
  margin-bottom: 18px;
}

.back-link,
.icon-action,
.hud-button,
.primary-button,
.text-button {
  font: inherit;
  cursor: pointer;
}

.back-link {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  color: var(--cpu-text-secondary);
  background: var(--cpu-card);
}

.back-link:hover { color: var(--flight-green); border-color: var(--flight-green); }

.brand-lockup {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-width: 176px;
  min-height: 48px;
  padding: 4px 10px;
}

.brand-lockup img {
  display: block;
  width: 44px;
  height: 44px;
}

.brand-lockup span {
  display: flex;
  flex-direction: column;
  text-align: left;
}

.brand-lockup b { color: var(--cpu-text); font-size: 14px; }
.brand-lockup small { color: #123f91; font-size: 9px; font-weight: 750; letter-spacing: 0.08em; }

.icon-action {
  justify-self: end;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 50%;
  color: var(--flight-green);
  background: var(--cpu-card);
}

.flight-layout {
  display: grid;
  grid-template-columns: minmax(320px, 460px) minmax(280px, 360px);
  justify-content: center;
  align-items: start;
  gap: clamp(18px, 3vw, 34px);
}

.game-stage {
  position: relative;
  width: min(100%, 430px);
  aspect-ratio: 390 / 680;
  justify-self: center;
  overflow: hidden;
  border: 1px solid rgba(7, 95, 85, 0.22);
  border-radius: 26px;
  background: #daf5ef;
  box-shadow: 0 24px 60px rgba(12, 83, 74, 0.18), 0 3px 0 rgba(7, 95, 85, 0.16);
  touch-action: manipulation;
  user-select: none;
}

.game-canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
}

.game-hud {
  position: absolute;
  z-index: 4;
  top: 16px;
  left: 16px;
  right: 16px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  pointer-events: none;
}

.score-chip {
  min-width: 64px;
  min-height: 54px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(7, 95, 85, 0.16);
  border-radius: 14px;
  color: var(--flight-green-dark);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 6px 16px rgba(7, 95, 85, 0.11);
  backdrop-filter: blur(10px);
}

.score-chip small { font-size: 9px; font-weight: 800; letter-spacing: 0.12em; }
.score-chip strong { font-size: 22px; line-height: 1; }
.score-chip--best strong { color: #bc7210; }

.hud-button {
  width: 44px;
  height: 44px;
  margin-left: auto;
  display: grid;
  place-items: center;
  border: 1px solid rgba(7, 95, 85, 0.16);
  border-radius: 14px;
  color: var(--flight-green-dark);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 6px 16px rgba(7, 95, 85, 0.11);
  pointer-events: auto;
}

.game-overlay {
  position: absolute;
  z-index: 6;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px;
  text-align: center;
}

.game-overlay--menu {
  background: linear-gradient(180deg, rgba(232, 250, 244, 0.18), rgba(232, 250, 244, 0.74) 58%, rgba(255, 245, 216, 0.97));
}

.school-emblem-hero {
  width: 118px;
  height: 118px;
  margin-bottom: 13px;
  border-radius: 50%;
  filter: drop-shadow(0 12px 16px rgba(18, 63, 145, 0.2));
  animation: emblem-hover 2.1s ease-in-out infinite;
}

.school-emblem-hero img { display: block; width: 100%; height: 100%; }

.eyebrow,
.side-kicker {
  margin: 0;
  color: var(--flight-green);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.game-overlay h1 {
  margin: 7px 0 0;
  color: var(--flight-ink);
  font-size: clamp(34px, 7vw, 50px);
  font-weight: 950;
  letter-spacing: -0.045em;
}

.menu-copy {
  max-width: 300px;
  margin: 9px 0 22px;
  color: #58756f;
  font-size: 14px;
  line-height: 1.7;
}

.primary-button {
  min-width: 190px;
  min-height: 52px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 16px;
  color: #fff;
  background: var(--flight-green);
  box-shadow: 0 7px 0 var(--flight-green-dark), 0 14px 24px rgba(7, 95, 85, 0.2);
  font-weight: 850;
  transition: transform 0.15s, box-shadow 0.15s;
}

.primary-button:hover { transform: translateY(-1px); }
.primary-button:active { transform: translateY(5px); box-shadow: 0 2px 0 var(--flight-green-dark); }

.control-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 22px;
  color: #6b8580;
  font-size: 11px;
  font-weight: 700;
}

.control-hint i { width: 3px; height: 3px; border-radius: 50%; background: var(--flight-orange); }

.game-overlay--compact { background: rgba(9, 60, 53, 0.42); backdrop-filter: blur(5px); }

.overlay-card {
  width: min(100%, 320px);
  padding: 28px 24px 24px;
  border: 1px solid rgba(7, 95, 85, 0.18);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 20px 50px rgba(5, 53, 47, 0.25);
}

.overlay-icon {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  margin: 0 auto 14px;
  border-radius: 17px;
  color: var(--flight-green);
  background: #ddf5ef;
  font-size: 25px;
}

.overlay-card h2 { margin: 7px 0 5px; font-size: 26px; }
.overlay-card > p:not(.eyebrow) { margin: 0 0 20px; color: #69817d; font-size: 13px; }
.overlay-card .primary-button { width: 100%; }

.text-button {
  margin-top: 15px;
  border: 0;
  color: #6b817d;
  background: none;
  font-size: 12px;
  font-weight: 750;
}

.result-badge {
  display: inline-flex;
  padding: 5px 11px;
  border-radius: 999px;
  color: var(--flight-green-dark);
  background: #daf4ed;
  font-size: 11px;
  font-weight: 850;
}

.result-badge.is-record { color: #7b4802; background: #ffe6ad; }
.result-score { display: inline-block; margin: 6px 0 0; color: var(--flight-green-dark); font-size: 76px; line-height: 1; }
.result-unit { margin-left: 4px; color: #66817c; font-size: 13px; font-weight: 750; }

.result-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 18px 0 22px;
}

.result-meta span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 8px;
  border-radius: 12px;
  background: #f3f8f6;
}

.result-meta small { color: #849692; font-size: 9px; }
.result-meta b { color: var(--flight-ink); font-size: 13px; }

.overlay-card .cloud-result {
  min-height: 17px;
  margin: -12px 0 18px;
  color: #8a6b35;
  font-size: 10px;
  font-weight: 700;
}

.overlay-card .cloud-result.success { color: var(--flight-green); }

.new-achievements {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 5px;
  margin: 0 0 12px;
}

.new-achievements > span {
  width: 100%;
  color: #a16207;
  font-size: 9px;
  font-weight: 850;
  letter-spacing: 0.08em;
}

.new-achievements b {
  padding: 5px 8px;
  border: 1px solid rgba(212, 138, 8, 0.25);
  border-radius: 999px;
  color: #7b4802;
  background: #fff6d7;
  font-size: 9px;
}

.tap-prompt {
  position: absolute;
  z-index: 3;
  left: 50%;
  bottom: 18%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 9px 15px;
  border-radius: 13px;
  color: var(--flight-green-dark);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 7px 18px rgba(7, 95, 85, 0.12);
  transform: translateX(-50%);
  pointer-events: none;
}

.tap-prompt span { font-size: 12px; font-weight: 850; }
.tap-prompt small { color: #77908b; font-size: 9px; }

.game-sidebar { display: flex; flex-direction: column; gap: 14px; }

.side-card {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 18px;
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}

.score-summary {
  position: relative;
  min-height: 208px;
  padding: 22px;
  overflow: hidden;
  color: #fff;
  background: linear-gradient(145deg, #0d8d79, #086156);
  border-color: transparent;
}

.score-summary::after {
  content: "+";
  position: absolute;
  right: -17px;
  bottom: -52px;
  color: rgba(255, 255, 255, 0.07);
  font-size: 190px;
  font-weight: 300;
  line-height: 1;
}

.score-summary .side-kicker { color: #a7e9dc; }
.score-summary h2 { margin: 4px 0 0; font-size: 18px; }

.best-block {
  position: absolute;
  z-index: 1;
  top: 18px;
  right: 20px;
  display: grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  gap: 0 7px;
  text-align: right;
}

.best-block span { grid-column: 1; color: #ffd991; font-size: 9px; font-weight: 850; letter-spacing: 0.12em; }
.best-block strong { grid-column: 2; grid-row: 1 / span 2; color: #fff; font-size: 50px; line-height: 1; }
.best-block small { grid-column: 1; color: rgba(255, 255, 255, 0.64); font-size: 9px; }

.stats-row {
  position: absolute;
  z-index: 1;
  left: 22px;
  right: 22px;
  bottom: 20px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.stats-row span {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
}

.stats-row b { font-size: 18px; }
.stats-row small { color: rgba(255, 255, 255, 0.66); font-size: 9px; }

.leaderboard-card,
.achievements-card,
.history-card,
.rules-card { padding: 19px; }

.side-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.side-title-row h3 { margin: 3px 0 0; color: var(--cpu-text); font-size: 16px; }
.side-title-row > .el-icon { color: var(--flight-green); font-size: 20px; }

.refresh-rank {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  color: #123f91;
  background: var(--cpu-surface-subtle);
  cursor: pointer;
}

.refresh-rank:disabled { cursor: wait; opacity: 0.55; }

.leaderboard-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.leaderboard-list li {
  display: grid;
  grid-template-columns: 23px 31px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  min-height: 46px;
  padding: 5px 7px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: var(--cpu-surface-subtle);
}

.leaderboard-list li.me { border-color: rgba(18, 63, 145, 0.3); background: rgba(18, 63, 145, 0.06); }
.leaderboard-rank { color: #7e918d; font-size: 11px; font-weight: 850; text-align: center; }
.leaderboard-list li:nth-child(1) .leaderboard-rank { color: #d48a08; font-size: 15px; }
.leaderboard-list li:nth-child(2) .leaderboard-rank { color: #75869b; font-size: 14px; }
.leaderboard-list li:nth-child(3) .leaderboard-rank { color: #a46a3d; font-size: 13px; }

.leaderboard-avatar {
  width: 31px;
  height: 31px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(145deg, #2457a7, #123f91);
  font-size: 12px;
  font-weight: 850;
}

.leaderboard-user { display: flex; flex-direction: column; min-width: 0; }
.leaderboard-user b { overflow: hidden; color: var(--cpu-text); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.leaderboard-user small { color: var(--cpu-text-secondary); font-size: 8px; }
.leaderboard-list li > strong { color: #123f91; font-size: 17px; }

.rank-state {
  min-height: 74px;
  display: grid;
  place-items: center;
  padding: 12px;
  border: 1px dashed var(--cpu-border-soft);
  border-radius: 11px;
  color: var(--cpu-text-secondary);
  font-size: 10px;
  text-align: center;
}

.my-cloud-rank {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  margin-top: 9px;
  padding: 10px 11px;
  border-radius: 11px;
  color: #fff;
  background: #123f91;
}

.my-cloud-rank span { font-size: 10px; font-weight: 750; }
.my-cloud-rank strong { grid-row: 1 / span 2; grid-column: 2; font-size: 21px; }
.my-cloud-rank small { color: rgba(255, 255, 255, 0.68); font-size: 8px; }

.login-rank-button {
  width: 100%;
  min-height: 38px;
  margin-top: 9px;
  border: 1px solid #123f91;
  border-radius: 10px;
  color: #123f91;
  background: rgba(18, 63, 145, 0.04);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 750;
}

.rank-error { margin: 8px 0 0; color: #a16207; font-size: 9px; text-align: center; }
.player-count { display: block; margin-top: 9px; color: var(--cpu-text-secondary); font-size: 8px; text-align: center; }

.achievement-total {
  min-width: 44px;
  padding: 6px 9px;
  border-radius: 999px;
  color: #123f91;
  background: rgba(18, 63, 145, 0.08);
  font-size: 10px;
  font-weight: 850;
  text-align: center;
}

.achievement-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }

.achievement-item {
  display: grid;
  grid-template-columns: 27px minmax(0, 1fr);
  gap: 7px;
  min-height: 86px;
  padding: 9px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 11px;
  background: var(--cpu-surface-subtle);
  filter: grayscale(0.7);
  opacity: 0.64;
}

.achievement-item.unlocked {
  border-color: rgba(212, 138, 8, 0.3);
  background: linear-gradient(145deg, #fff9e8, #fffdf8);
  filter: none;
  opacity: 1;
}

.achievement-icon {
  width: 27px;
  height: 27px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: rgba(18, 63, 145, 0.08);
  font-size: 15px;
}

.achievement-copy { display: flex; flex-direction: column; min-width: 0; }
.achievement-copy b { color: var(--cpu-text); font-size: 10px; line-height: 1.3; }
.achievement-copy small { min-height: 24px; margin-top: 2px; color: var(--cpu-text-secondary); font-size: 8px; line-height: 1.45; }

.achievement-copy i {
  height: 4px;
  margin-top: auto;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(18, 63, 145, 0.1);
}

.achievement-copy i em { display: block; height: 100%; border-radius: inherit; background: #123f91; }
.achievement-item.unlocked .achievement-copy i em { background: #d48a08; }
.achievement-copy > span { margin-top: 3px; color: #7f918d; font-size: 7px; font-weight: 750; }
.achievement-item.unlocked .achievement-copy > span { color: #a16207; }

.achievement-toggle {
  width: 100%;
  margin-top: 9px;
  padding: 8px;
  border: 0;
  border-radius: 9px;
  color: #123f91;
  background: rgba(18, 63, 145, 0.06);
  cursor: pointer;
  font: inherit;
  font-size: 9px;
  font-weight: 750;
}

.achievement-login-note { margin: 9px 0 0; color: var(--cpu-text-secondary); font-size: 8px; text-align: center; }

.history-list { display: flex; flex-direction: column; gap: 5px; margin: 0; padding: 0; list-style: none; }

.history-list li {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-height: 48px;
  padding: 6px 8px;
  border-radius: 11px;
  background: var(--cpu-surface-subtle);
}

.history-rank { color: #99aaa6; font-size: 10px; font-weight: 850; }
.history-main { display: flex; flex-direction: column; min-width: 0; }
.history-main b { color: var(--cpu-text); font-size: 13px; }
.history-main small { color: var(--cpu-text-secondary); font-size: 9px; }
.history-level { color: var(--flight-green); font-size: 9px; font-weight: 750; }

.empty-history {
  min-height: 90px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--cpu-border-soft);
  border-radius: 12px;
  color: var(--cpu-text-secondary);
  font-size: 11px;
}

.empty-history .el-icon { color: var(--flight-green); font-size: 24px; }
.rules-card ul { display: flex; flex-direction: column; gap: 9px; margin: 0; padding: 0; list-style: none; }
.rules-card li { display: flex; align-items: center; gap: 10px; color: var(--cpu-text-secondary); font-size: 11px; }

.rules-card kbd {
  min-width: 43px;
  min-height: 27px;
  display: grid;
  place-items: center;
  border: 1px solid var(--cpu-border-soft);
  border-bottom-width: 3px;
  border-radius: 7px;
  color: var(--flight-green-dark);
  background: var(--cpu-surface-subtle);
  font-family: inherit;
  font-size: 10px;
  font-weight: 800;
}

.rules-card > p { margin: 14px 0 0; color: var(--cpu-text-secondary); font-size: 10px; line-height: 1.6; }

.panel-pop-enter-active,
.panel-pop-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.panel-pop-enter-from,
.panel-pop-leave-to { opacity: 0; transform: scale(0.98); }

@keyframes emblem-hover {
  0%, 100% { transform: translateY(2px) rotate(-2deg); }
  50% { transform: translateY(-8px) rotate(2deg); }
}

@media (max-width: 860px) {
  .flight-layout { grid-template-columns: 1fr; }
  .game-stage { width: min(100%, 540px); max-height: none; }
  .game-sidebar { width: min(100%, 540px); margin: 0 auto; }
}

@media (max-width: 560px) {
  .flight-page { padding: 8px 0 28px; }
  .flight-topbar { grid-template-columns: auto 1fr auto; gap: 8px; padding: 0 12px; margin-bottom: 8px; }
  .back-link { width: 40px; padding: 0; justify-content: center; border-radius: 50%; }
  .back-link span { display: none; }
  .brand-lockup { min-width: 0; min-height: 42px; gap: 6px; padding: 2px 4px; }
  .brand-lockup img { width: 38px; height: 38px; }
  .brand-lockup small { display: none; }
  .game-stage { width: 100%; border-right: 0; border-left: 0; border-radius: 0; box-shadow: 0 16px 36px rgba(12, 83, 74, 0.15); }
  .game-sidebar { padding: 0 12px; }
  .game-overlay { padding: 22px; }
  .game-overlay h1 { font-size: 38px; }
  .school-emblem-hero { width: 104px; height: 104px; margin-bottom: 8px; }
}

@media (prefers-reduced-motion: reduce) {
  .school-emblem-hero { animation: none; }
  .panel-pop-enter-active,
  .panel-pop-leave-active,
  .primary-button { transition: none; }
}
</style>
