<template>
  <main class="flight-shell zd-shell">
    <section ref="phoneEl" class="game-phone">
      <canvas
        v-show="screen === 'game'"
        ref="canvasEl"
        class="game-canvas"
        role="img"
        aria-label="药大人大战僵尸游戏区域"
        tabindex="0"
        @pointerdown="handleCanvasPointer"
      ></canvas>

      <section v-if="screen === 'menu'" class="menu-screen">
        <button data-cpu-button="surface" type="button" class="corner-back" aria-label="返回小游戏" @click="router.push(MINI_GAMES_PATH)">←</button>
        <canvas ref="menuArtEl" class="menu-emblem" width="248" height="248" role="img" aria-label="胶囊射手对阵僵尸"></canvas>
        <h1>药大人大战僵尸</h1>
        <p class="menu-tagline">🌿 种药材 · 守药圃 · 一只都别放过</p>
        <div class="best-score-box">
          <span>最高分</span>
          <strong>{{ displayBest }}</strong>
        </div>
        <div class="menu-actions">
          <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click="startGame">开始守圃</button>
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
        <div class="zd-status">
          <b>{{ wave ? `第 ${wave} 波` : "备战中" }}</b>
          <small>击退 {{ kills }}</small>
        </div>
        <div class="game-controls">
          <button data-cpu-button="surface"
            v-if="gamePhase === 'playing' || gamePhase === 'paused'"
            type="button"
            :aria-label="gamePhase === 'paused' ? '继续游戏' : '暂停游戏'"
            @click.stop="togglePause"
          >{{ gamePhase === "paused" ? "▶" : "Ⅱ" }}</button>
          <button data-cpu-button="surface" type="button" aria-label="结束本局" @click.stop="requestExit()">×</button>
        </div>

        <div v-if="gamePhase === 'ready'" class="ready-hint">
          <span class="ready-flight-mark" aria-hidden="true">👆</span>
          <h2>点击药圃或空格开始</h2>
          <p>先种研钵攒药力，再摆射手。只要一只僵尸走出药圃，这一局就结束</p>
        </div>

        <div v-if="banner" :key="banner.id" class="zd-banner" :class="{ big: banner.big }" role="status">{{ banner.text }}</div>

        <!-- 点中一株药材：在它旁边弹出一张小卡片，写着它是什么、有哪些效果，以及升级。 -->
        <div
          v-if="focusInfo && popPlace && gamePhase === 'playing'"
          class="zd-pop"
          :class="{ below: popPlace.below }"
          :style="popPlace.style"
          role="group"
          :aria-label="`${focusInfo.name}，${focusInfo.level} 级`"
        >
          <div class="zd-pop-head">
            <b>{{ focusInfo.name }}</b>
            <em>Lv{{ focusInfo.level }}</em>
          </div>
          <p v-if="focusInfo.genes" class="zd-pop-genes">{{ focusInfo.genes }}</p>
          <ul v-if="focusInfo.perks.length" class="zd-pop-perks">
            <li v-for="perk in focusInfo.perks.slice(0, 3)" :key="perk">{{ perk }}</li>
            <li v-if="focusInfo.perks.length > 3" class="more">还有 {{ focusInfo.perks.length - 3 }} 项效果</li>
          </ul>
          <p class="zd-pop-next">{{ focusInfo.next ? `升级后：${focusInfo.next.summary}` : focusInfo.kind === "fizz" ? "一次性的，不能升级" : "已经升到头了" }}</p>
          <button
            v-if="focusInfo.next"
            data-cpu-button="surface"
            type="button"
            :class="{ short: energy < focusInfo.next.cost }"
            @click.stop="upgradeFocused"
          >升级<span>{{ compact(focusInfo.next.cost) }} 药力</span></button>
          <i class="zd-pop-tail" :style="{ left: popPlace.tail }" aria-hidden="true"></i>
        </div>

        <div class="zd-dock">
          <p class="zd-hint" :class="{ warn: Boolean(tip) }">{{ tip || selectionHint }}</p>
          <div class="zd-bar">
            <div class="zd-energy" :aria-label="`药力 ${energy}`">
              <i aria-hidden="true"></i>
              <b :class="{ long: energy >= 10000 }">{{ compact(energy) }}</b>
              <small>药力</small>
            </div>
            <div class="zd-cards">
            <button
              v-for="(kind, index) in ZD_UNIT_ORDER"
              :key="kind"
              data-cpu-button="surface"
              type="button"
              class="zd-card"
              :class="{ selected: selected === kind, short: energy < ZD_UNITS[kind].cost }"
              :aria-label="`${ZD_UNITS[kind].name}，${ZD_UNITS[kind].cost} 药力`"
              :aria-pressed="selected === kind"
              @click.stop="selectCard(kind)"
            >
              <canvas ref="iconEls" width="88" height="88" aria-hidden="true"></canvas>
              <span>{{ ZD_UNITS[kind].cost }}</span>
              <i ref="maskEls" class="zd-card-mask" aria-hidden="true"></i>
              <em aria-hidden="true">{{ index + 1 }}</em>
            </button>
            <button
              data-cpu-button="surface"
              type="button"
              class="zd-card zd-shovel"
              :class="{ selected: selected === 'shovel' }"
              aria-label="铲子：移除一株药材"
              :aria-pressed="selected === 'shovel'"
              @click.stop="selectCard('shovel')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M19.4 4.6 11 13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
                <path d="M17 2.6l4.4 4.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
                <path d="M8.9 10.9 13.1 15.1 8.6 19.6a3.7 3.7 0 0 1-5 .2l-.4-.4a3.7 3.7 0 0 1 .2-5z" fill="currentColor" />
              </svg>
              <span>移除</span>
            </button>
            </div>
          </div>
        </div>

        <div v-if="gamePhase === 'paused' && exitConfirm" class="modal-shade">
          <div class="game-modal" role="alertdialog" aria-label="结束这一局">
            <span class="modal-icon">🏳</span>
            <h2>结束这一局？</h2>
            <p>当前 {{ score }} 分 · 第 {{ wave }} 波，结束后按这个成绩计入战绩和全校榜</p>
            <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click.stop="togglePause">继续守圃</button>
            <button data-cpu-button="surface" type="button" class="plain-button" @click.stop="endGameEarly">结束并结算</button>
          </div>
        </div>

        <div v-else-if="gamePhase === 'paused'" class="modal-shade">
          <div class="game-modal">
            <span class="modal-icon">⏸</span>
            <h2>战斗暂停</h2>
            <p>当前 {{ score }} 分 · 第 {{ wave }} 波</p>
            <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click.stop="togglePause">继续守圃</button>
            <button data-cpu-button="surface" type="button" class="plain-button" @click.stop="requestExit()">结束本局</button>
          </div>
        </div>

        <div v-if="gamePhase === 'over'" class="modal-shade">
          <div class="game-modal result-modal">
            <span class="result-label">{{ isNewRecord ? "新纪录！" : resultTitle }}</span>
            <strong class="final-score">{{ score }}</strong>
            <span class="final-unit">分</span>
            <div class="result-stats">
              <span><small>历史最高</small><b>{{ displayBest }}</b></span>
              <span><small>坚守到</small><b>第 {{ wave }} 波</b></span>
              <span><small>称号</small><b>{{ commanderRank }}</b></span>
            </div>
            <p class="cloud-result" :class="{ success: cloudSubmitState === 'success' }">{{ cloudResultMessage }}</p>
            <div v-if="newlyUnlocked.length" class="new-unlocks">
              <b v-for="item in newlyUnlocked" :key="item.code">{{ item.icon }} {{ item.title }}</b>
            </div>
            <button data-cpu-button="surface" type="button" class="game-button game-button--start" @click.stop="startGame">再守一局</button>
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
                <small>{{ entry.games }} 局 · {{ entry.achievementCount }} 枚成就 · 最远第 {{ entry.bestWaves }} 波</small>
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
              <small>{{ formatHistoryDate(item.playedAt) }} · 第 {{ item.waves }} 波</small>
              <em>{{ zdCommanderRank(item.score) }}</em>
            </li>
          </ol>
          <div v-else class="empty-panel">暂无历史战绩，快去守一局吧！</div>
        </div>

        <div v-else class="panel-scroll flight-settings-panel">
          <div class="setting-row">
            <span><b>游戏音效</b><small>种植、命中与爆炸提示音</small></span>
            <button data-cpu-button="surface" type="button" :class="{ active: soundEnabled }" @click="toggleSound">{{ soundEnabled ? "开启" : "关闭" }}</button>
          </div>
          <div class="setting-row">
            <span><b>画面风格</b><small>{{ artStyle === "classic" ? "经典：最早那一版手绘的药材和僵尸" : "新版：重新画过的药材和僵尸" }}</small></span>
            <button data-cpu-button="surface" type="button" class="active" :aria-label="`画面风格：${artStyle === 'classic' ? '经典' : '新版'}，点击切换`" @click="toggleArtStyle">{{ artStyle === "classic" ? "经典" : "新版" }}</button>
          </div>
          <div class="setting-row">
            <span><b>云端档案</b><small>{{ isLoggedIn ? "排行榜、局数和成就自动保存" : "当前成绩仅保存在这台设备" }}</small></span>
            <button data-cpu-button="surface" v-if="!isLoggedIn" type="button" @click="goToLogin">登录</button>
            <b v-else class="cloud-online">已连接</b>
          </div>
          <p>玩法：僵尸从上方沿五路药圃往下走，只要有一只走出药圃，这一局就结束。先选下方的药材，再点药圃里的空格种下；种植要花药力，药力会慢慢自己涨，研钵能磨出更多。僵尸一波比一波多、一波比一波硬，每五波来一大波。</p>
          <p v-for="kind in ZD_UNIT_ORDER" :key="kind" class="zd-guide">
            <b>{{ ZD_UNITS[kind].name }}</b>{{ ZD_UNITS[kind].cost }} 药力 · {{ ZD_UNITS[kind].summary }}
            <small v-for="(upgrade, index) in ZD_UPGRADES[kind]" :key="index">{{ index + 2 }} 级（{{ upgrade.cost }} 药力）：{{ upgrade.summary }}</small>
          </p>
          <p>升级：不选药材时，直接点已经种下的药材，再点“升级”（或再点它一次），升级不用等冷却。等级没有封顶：三级以后每升一级，数值和花费都按比例往上涨，花费涨得更快一些。</p>
          <p>杂交：选一种药材，种到另一种已经种下的药材上，就得到一个新品种——两种药材原来的本事都在，血量更厚，还多一样这个品种独有的效果。杂交要付这种药材的价钱（那株已经升过级的话，再加上升到同一级的升级费），之后几种本事一起升级。一株上可以接着再杂交别的药材，种数不限（每种一份），凑得出的每一对组合效果都生效。泡腾片本身不能被杂交。</p>
          <p class="zd-guide zd-hybrids">
            <b>杂交图鉴</b>
            <small v-for="(hybrid, pair) in ZD_HYBRIDS" :key="pair">{{ hybrid.name }}（{{ pairLabel(pair) }}）：{{ hybrid.perk }}</small>
          </p>
          <p>操作：点击 / 触摸选药材和格子，数字键 1 到 8 选药材，9 选铲子，U 升级点中的药材，P 暂停，Esc 返回（对局中会先问要不要结束）。</p>
        </div>
      </section>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import { getToken } from "@/api/request";
import { useAuthStore } from "@/stores/auth";
import {
  zombieDefenseApi,
  type ZombieDefenseAchievement,
  type ZombieDefenseLeaderboard,
  type ZombieDefenseRankingEntry,
} from "@/api/zombieDefense";
import UserAvatar from "@/components/common/UserAvatar.vue";
import { MINI_GAMES_PATH } from "@/data/miniGames";
import {
  createZdState,
  zdCommanderRank,
  zdCooldownRatio,
  zdGraft,
  zdGraftBlocker,
  zdHybridOf,
  zdNextUpgrade,
  zdPlace,
  zdPlaceBlocker,
  zdRemove,
  zdStep,
  zdUnitAt,
  zdUnitKinds,
  zdUnitName,
  zdUnitPerks,
  zdUpgrade,
  zdUpgradeBlocker,
  ZD_HYBRIDS,
  ZD_UNIT_ORDER,
  ZD_UNITS,
  ZD_UPGRADES,
  type ZdUpgrade,
  type ZdState,
  type ZdUnitKind,
} from "./zombieDefenseEngine";
import { drawZdMenuArt, drawZdScene, drawZdUnitIcon, setZdArtStyle, zdArtReady, zdCellAt, zdLayout, type ZdArtStyle } from "./zombieDefenseScene";

type Screen = "menu" | "game" | "ranking" | "achievements" | "history" | "settings";
type GamePhase = "ready" | "playing" | "paused" | "over";
type Selection = ZdUnitKind | "shovel" | null;
type HistoryItem = { score: number; waves: number; playedAt: string };
type FocusInfo = { lane: number; row: number; kind: ZdUnitKind; grafts: number; name: string; genes: string | null; perks: string[]; level: number; next: ZdUpgrade | null };

const router = useRouter();
const auth = useAuthStore();
const phoneEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const menuArtEl = ref<HTMLCanvasElement | null>(null);
const iconEls = ref<HTMLCanvasElement[]>([]);
const maskEls = ref<HTMLElement[]>([]);
const screen = ref<Screen>("menu");
const gamePhase = ref<GamePhase>("ready");
const score = ref(0);
const wave = ref(0);
const kills = ref(0);
const energy = ref(0);
const selected = ref<Selection>(null);
const tip = ref("");
const focusInfo = ref<FocusInfo | null>(null);
const banner = ref<{ id: number; text: string; big: boolean } | null>(null);
const bestScore = ref(0);
const history = ref<HistoryItem[]>([]);
const soundEnabled = ref(true);
const artStyle = ref<ZdArtStyle>("new");
const isNewRecord = ref(false);
/** 对局中途点了 ×、Esc 或要离开页面：先停下来问一句，确认后按当前成绩结算。 */
const exitConfirm = ref(false);
const endedEarly = ref(false);
const leaderboard = ref<ZombieDefenseRankingEntry[]>([]);
const cloudMe = ref<ZombieDefenseRankingEntry | null>(null);
const totalPlayers = ref(0);
const leaderboardLoading = ref(false);
const leaderboardError = ref("");
const achievements = ref<ZombieDefenseAchievement[]>([]);
const newlyUnlocked = ref<ZombieDefenseLeaderboard["newlyUnlocked"]>([]);
const cloudSubmitState = ref<"idle" | "syncing" | "success" | "error" | "guest">("idle");
const cloudSubmitDetail = ref("");

const WORLD_WIDTH = 420;
const STEP_SECONDS = 1 / 30;
const STORAGE_PREFIX = "cpu-web:zombie-defense:v1";

let game: ZdState = createZdState(1);
let worldHeight = 680;
/** 对局区域在页面里的宽高（CSS 像素），用来把药圃里的格子换算成页面上的位置。 */
const viewSize = ref({ width: 0, height: 0 });
let lastFrameAt = 0;
let animationFrame = 0;
let bannerSeq = 0;
let bannerUntil = 0;
let tipTimer = 0;
let lastHudAt = 0;
// 画面跟不上时把画布的清晰度降一档，见 watchFrameRate。
const QUALITY_RATIOS = [2, 1.5, 1];
let qualityStep = 0;
let paceFrames = 0;
let paceTotal = 0;
let bestPace = 0;
let slowWindows = 0;
const repeatingToneAt: Record<string, number> = {};
let resizeObserver: ResizeObserver | null = null;
let canvasContext: CanvasRenderingContext2D | null = null;
let audioContext: AudioContext | null = null;
let cloudAttemptPromise: Promise<number | null> = Promise.resolve(null);
let cloudSettlementPromise: Promise<void> = Promise.resolve();
let gameGeneration = 0;
/** 对局中途要离开页面时先拦下来问一句；确认结束后再去这里。 */
let pendingLeave: string | null = null;

const isLoggedIn = computed(() => Boolean(getToken()));
const displayBest = computed(() => Math.max(bestScore.value, cloudMe.value?.bestScore ?? 0));
const commanderRank = computed(() => zdCommanderRank(score.value));
const resultTitle = computed(() => endedEarly.value ? "提前结束" : wave.value >= 9 ? "铜墙铁壁" : wave.value >= 5 ? "渐入佳境" : "防线失守");
const selectionHint = computed(() => {
  if (selected.value === "shovel") return "点一株药材把它移除";
  if (!selected.value) return "选药材种到空格里；点已种下的药材可以升级";
  const unit = ZD_UNITS[selected.value];
  return `${unit.name} · ${unit.summary}；种到别的药材上是杂交`;
});
/** 点中药材时那张小卡片放在哪：贴着那一格，上半场的放在格子下面，下半场的放在上面。 */
const popPlace = computed(() => {
  const focus = focusInfo.value;
  const { width, height } = viewSize.value;
  if (!focus || !width || !height) return null;
  const scale = width / WORLD_WIDTH;
  const layout = zdLayout(WORLD_WIDTH, height / scale);
  const centerX = (layout.left + (focus.lane + 0.5) * layout.cellWidth) * scale;
  const cellTop = (layout.top + focus.row * layout.cellHeight) * scale;
  const cellBottom = cellTop + layout.cellHeight * scale;
  const popWidth = Math.min(212, width - 16);
  const left = Math.min(width - popWidth - 8, Math.max(8, centerX - popWidth / 2));
  const below = focus.row < 3;
  return {
    below,
    tail: `${Math.round(centerX - left)}px`,
    style: {
      left: `${Math.round(left)}px`,
      width: `${popWidth}px`,
      ...(below ? { top: `${Math.round(cellBottom + 10)}px` } : { bottom: `${Math.round(height - cellTop + 14)}px` }),
    },
  };
});
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
  artStyle.value = localStorage.getItem(STORAGE_PREFIX + ":style") === "classic" ? "classic" : "new";
  setZdArtStyle(artStyle.value);
  window.addEventListener("keydown", handleKeydown);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  resizeObserver = new ResizeObserver(resizeCanvas);
  if (phoneEl.value) resizeObserver.observe(phoneEl.value);
  void initializeCloud();
  nextTick(() => {
    resizeCanvas();
    drawMenuArt();
  });
  // 图是异步加载的：到齐以后把已经画出去的招牌图、药材栏图标和药圃重画一遍。
  void zdArtReady.then(() => {
    drawMenuArt();
    drawIcons();
    drawScene();
  });
});

onBeforeUnmount(() => {
  document.documentElement.classList.remove("yaoda-flight-open");
  // 万一没经过确认就被卸载：这一局也照当前成绩结算，不白打。
  if (screen.value === "game") finishGame({ silent: true });
  cancelAnimationFrame(animationFrame);
  window.clearTimeout(tipTimer);
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", handleKeydown);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  void audioContext?.close();
});

onBeforeRouteLeave((to) => {
  if (screen.value !== "game" || (gamePhase.value !== "playing" && gamePhase.value !== "paused")) return true;
  requestExit(to.fullPath);
  return false;
});

function openScreen(value: Screen) {
  screen.value = value;
  if (value === "ranking" || value === "achievements") void loadLeaderboard(true);
}

function startGame() {
  cancelAnimationFrame(animationFrame);
  game = createZdState(Math.floor(Math.random() * 0x7fffffff));
  // 新的一局从最清晰开始。
  qualityStep = 0;
  paceFrames = 0;
  paceTotal = 0;
  slowWindows = 0;
  screen.value = "game";
  gamePhase.value = "ready";
  selected.value = null;
  tip.value = "";
  focusInfo.value = null;
  banner.value = null;
  isNewRecord.value = false;
  exitConfirm.value = false;
  endedEarly.value = false;
  pendingLeave = null;
  newlyUnlocked.value = [];
  cloudSubmitState.value = isLoggedIn.value ? "idle" : "guest";
  cloudSubmitDetail.value = "";
  syncHud();
  nextTick(() => {
    resizeCanvas();
    drawIcons();
    syncHud();
    canvasEl.value?.focus({ preventScroll: true });
  });
}

function drawIcons() {
  for (const [index, kind] of ZD_UNIT_ORDER.entries()) {
    const context = iconEls.value[index]?.getContext("2d");
    if (context) drawZdUnitIcon(context, kind, 88);
  }
}

function beginDefense() {
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
  // 对局进行中不能直接回主页，要先确认结束（结束了才算分）。
  if (screen.value === "game" && (gamePhase.value === "playing" || gamePhase.value === "paused")) {
    requestExit();
    return;
  }
  gameGeneration += 1;
  cancelAnimationFrame(animationFrame);
  screen.value = "menu";
  gamePhase.value = "ready";
  nextTick(drawMenuArt);
}

/** 对局中途想退出：停下来弹出确认框。还没开打或已经结束的直接回主页。 */
function requestExit(leaveTo: string | null = null) {
  if (gamePhase.value !== "playing" && gamePhase.value !== "paused") {
    returnToMenu();
    return;
  }
  if (gamePhase.value === "playing") togglePause();
  pendingLeave = leaveTo;
  exitConfirm.value = true;
}

/** 确认结束：按当前分数和波次结算，跟被僵尸突破一样计入战绩和全校榜。 */
function endGameEarly() {
  if (gamePhase.value !== "paused" || !exitConfirm.value) return;
  const leaveTo = pendingLeave;
  endedEarly.value = true;
  finishGame();
  if (leaveTo) void router.push(leaveTo);
}

function togglePause() {
  if (gamePhase.value === "playing") {
    gamePhase.value = "paused";
    cancelAnimationFrame(animationFrame);
    drawScene();
  } else if (gamePhase.value === "paused") {
    exitConfirm.value = false;
    pendingLeave = null;
    gamePhase.value = "playing";
    lastFrameAt = performance.now();
    animationFrame = requestAnimationFrame(gameLoop);
  }
}

function selectCard(value: Exclude<Selection, null>) {
  if (gamePhase.value === "ready") beginDefense();
  if (gamePhase.value !== "playing") return;
  selected.value = selected.value === value ? null : value;
  tip.value = "";
  focusInfo.value = null;
  drawScene();
}

/** 点中一株药材：记下它，在它旁边弹出小卡片。 */
function focusUnit(lane: number, row: number) {
  const unit = zdUnitAt(game, lane, row);
  focusInfo.value = unit
    ? {
      lane,
      row,
      kind: unit.kind,
      grafts: unit.grafts.length,
      name: zdUnitName(unit),
      // 杂交过的把这一格里有哪几种列出来。
      genes: unit.grafts.length ? zdUnitKinds(unit).map((kind) => ZD_UNITS[kind].name).join("＋") : null,
      perks: zdUnitPerks(unit),
      level: unit.level,
      next: zdNextUpgrade(unit),
    }
    : null;
}

function upgradeFocused() {
  const focus = focusInfo.value;
  if (!focus || gamePhase.value !== "playing") return;
  const blocker = zdUpgradeBlocker(game, focus.lane, focus.row);
  if (blocker) showTip(blocker);
  else zdUpgrade(game, focus.lane, focus.row);
  playEvents();
  syncHud();
  drawScene();
}

function showTip(text: string, milliseconds = 1300) {
  tip.value = text;
  window.clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => { tip.value = ""; }, milliseconds);
}

/** 后期药力和升级费能到几十万、上百万，药材栏里放不下，改用“万”“亿”。 */
function compact(value: number) {
  if (value < 100000) return String(value);
  if (value < 100000000) return `${Math.floor(value / 1000) / 10}万`;
  return `${Math.floor(value / 10000000) / 10}亿`;
}

/** 图鉴里“胶囊射手 + 酒精灯”这样的写法。 */
function pairLabel(pair: string | number) {
  return String(pair).split("+").map((kind) => ZD_UNITS[kind as ZdUnitKind]?.name ?? kind).join(" + ");
}

function handleCanvasPointer(event: PointerEvent) {
  event.preventDefault();
  if (screen.value !== "game") return;
  if (gamePhase.value === "ready") {
    beginDefense();
    return;
  }
  const canvas = canvasEl.value;
  if (gamePhase.value !== "playing" || !canvas) return;
  const bounds = canvas.getBoundingClientRect();
  const cell = zdCellAt(
    zdLayout(WORLD_WIDTH, worldHeight),
    ((event.clientX - bounds.left) / bounds.width) * WORLD_WIDTH,
    ((event.clientY - bounds.top) / bounds.height) * worldHeight,
  );
  if (!cell) return;
  if (selected.value === "shovel") {
    if (zdRemove(game, cell.lane, cell.row)) selected.value = null;
    else showTip("这一格没有药材");
  } else if (selected.value && zdUnitAt(game, cell.lane, cell.row)) {
    const blocker = zdGraftBlocker(game, selected.value, cell.lane, cell.row);
    if (blocker) showTip(blocker);
    else if (zdGraft(game, selected.value, cell.lane, cell.row)) {
      // 杂交成功：报一下新品种的名字和它独有的效果。
      const unit = zdUnitAt(game, cell.lane, cell.row);
      const added = selected.value;
      if (unit) {
        // 新凑出来的组合效果：新药材和这一格里原有的每一种各配一对。
        const gained: string[] = [];
        for (const kind of zdUnitKinds(unit)) {
          if (kind === added) continue;
          for (const part of (zdHybridOf(kind, added)?.perk ?? "").split("；")) if (part && !gained.includes(part)) gained.push(part);
        }
        showTip(`杂交出${zdUnitName(unit)}：${gained.join("；")}`, 3200);
      }
      selected.value = null;
    }
  } else if (selected.value) {
    const blocker = zdPlaceBlocker(game, selected.value, cell.lane, cell.row);
    if (blocker) showTip(blocker);
    else if (zdPlace(game, selected.value, cell.lane, cell.row)) selected.value = null;
  } else if (!zdUnitAt(game, cell.lane, cell.row)) {
    focusInfo.value = null;
    showTip("先在下方选一种药材");
  } else if (focusInfo.value?.lane === cell.lane && focusInfo.value.row === cell.row && focusInfo.value.next) {
    // 再点一次已经点中的药材，直接升级。
    upgradeFocused();
    return;
  } else {
    tip.value = "";
    focusUnit(cell.lane, cell.row);
  }
  playEvents();
  syncHud();
  drawScene();
}

function handleKeydown(event: KeyboardEvent) {
  if (["Space", "Enter"].includes(event.code)) {
    if (event.repeat) return;
    if (screen.value === "menu") {
      event.preventDefault();
      startGame();
    } else if (screen.value === "game" && gamePhase.value === "ready") {
      event.preventDefault();
      beginDefense();
    } else if (screen.value === "game" && gamePhase.value === "over") {
      event.preventDefault();
      startGame();
    }
    return;
  }
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1];
  if (digit && screen.value === "game") {
    event.preventDefault();
    selectCard(digit === "9" ? "shovel" : ZD_UNIT_ORDER[Number(digit) - 1]);
  } else if (event.code === "KeyU" && screen.value === "game" && focusInfo.value) {
    event.preventDefault();
    upgradeFocused();
  } else if (event.code === "KeyP" && screen.value === "game" && (gamePhase.value === "playing" || gamePhase.value === "paused")) {
    event.preventDefault();
    togglePause();
  } else if (event.code === "Escape" && screen.value !== "menu") {
    event.preventDefault();
    // 确认框开着时 Esc 等于“继续守圃”。
    if (screen.value === "game" && gamePhase.value === "paused" && exitConfirm.value) togglePause();
    else returnToMenu();
  }
}

function handleVisibilityChange() {
  if (document.hidden && gamePhase.value === "playing") togglePause();
}

/**
 * 盯着帧间隔：每 90 帧算一次平均。这台设备最顺的时候是多少记下来（省电模式、高刷屏各不相同），
 * 之后连续两段都比它慢一半以上、并且每帧超过 24 毫秒，就把画布的清晰度降一档——
 * 要画的像素少了，后期场面再大也能跟上。一局里只降不升，免得来回跳。
 */
function watchFrameRate(interval: number) {
  // 切到后台再回来、弹出系统对话框这类停顿不算。
  if (interval <= 0 || interval > 250) return;
  paceFrames += 1;
  paceTotal += interval;
  if (paceFrames < 90) return;
  const pace = paceTotal / paceFrames;
  paceFrames = 0;
  paceTotal = 0;
  if (!bestPace || pace < bestPace) bestPace = pace;
  slowWindows = pace > Math.max(24, bestPace * 1.5) ? slowWindows + 1 : 0;
  if (slowWindows < 2 || qualityStep >= QUALITY_RATIOS.length - 1) return;
  slowWindows = 0;
  const before = canvasRatio();
  qualityStep += 1;
  if (canvasRatio() < before) resizeCanvas();
}

function canvasRatio() {
  return Math.min(window.devicePixelRatio || 1, QUALITY_RATIOS[qualityStep]);
}

function gameLoop(now: number) {
  if (gamePhase.value !== "playing") return;
  watchFrameRate(now - lastFrameAt);
  let remaining = Math.min((now - lastFrameAt) / 1000, 0.1);
  lastFrameAt = now;
  while (remaining > 0 && !game.over) {
    const delta = Math.min(remaining, STEP_SECONDS);
    zdStep(game, delta);
    remaining -= delta;
  }
  playEvents();
  // 后期分数和药力每一帧都在变。界面上的数字一秒刷十次就够了，省下每帧更新页面的开销。
  if (game.over || now - lastHudAt >= 100) {
    lastHudAt = now;
    syncHud();
  }
  drawScene();
  if (game.over) finishGame();
  else animationFrame = requestAnimationFrame(gameLoop);
}

/**
 * 对局里反复出现的音效：同一种两次之间至少隔 gap 毫秒。后期一秒有几十次开火、爆炸和光束，
 * 每次都新建一个振荡器会拖慢页面，声音也糊成一片。
 */
function playRepeating(key: string, gap: number, frequency: number, duration: number, volume: number) {
  const now = performance.now();
  if (now - (repeatingToneAt[key] ?? -1e9) < gap) return;
  repeatingToneAt[key] = now;
  playTone(frequency, duration, volume);
}

function playEvents() {
  for (const event of game.events) {
    if (event === "wave" || event === "bigWave") {
      bannerSeq += 1;
      banner.value = { id: bannerSeq, text: event === "bigWave" ? "一大波僵尸来袭！" : `第 ${game.wave} 波`, big: event === "bigWave" };
      bannerUntil = game.time + (event === "bigWave" ? 2.6 : 1.6);
      playTone(event === "bigWave" ? 196 : 294, 0.22, 0.05);
    } else if (event === "shoot") playRepeating("shoot", 125, 720, 0.03, 0.012);
    else if (event === "boom") playRepeating("boom", 160, 110, 0.3, 0.07);
    else if (event === "beam") playRepeating("beam", 180, 250, 0.14, 0.035);
    else if (event === "place") playTone(520, 0.06, 0.035);
    else if (event === "upgrade" || event === "graft") {
      playTone(event === "graft" ? 587 : 660, 0.07, 0.035);
      window.setTimeout(() => playTone(event === "graft" ? 880 : 990, 0.1, 0.03), 80);
    }
    else if (event === "remove") playTone(330, 0.06, 0.03);
    else if (event === "energy") playRepeating("energy", 220, 988, 0.05, 0.015);
  }
  game.events.length = 0;
}

function syncHud() {
  score.value = game.score;
  wave.value = game.wave;
  kills.value = game.kills;
  energy.value = game.energy;
  if (banner.value && game.time >= bannerUntil) banner.value = null;
  // 点中的药材可能被啃掉、被铲掉或刚升了级。
  const focus = focusInfo.value;
  if (focus) {
    const unit = zdUnitAt(game, focus.lane, focus.row);
    if (!unit || unit.kind !== focus.kind || unit.grafts.length !== focus.grafts || unit.level !== focus.level) focusUnit(focus.lane, focus.row);
  }
  for (const [index, kind] of ZD_UNIT_ORDER.entries()) {
    const mask = maskEls.value[index];
    // 只在数值变了的时候才动样式，免得每一帧都触发重排。
    const height = `${Math.round(zdCooldownRatio(game, kind) * 100)}%`;
    if (mask && mask.style.height !== height) mask.style.height = height;
  }
}

function finishGame(options: { silent?: boolean } = {}) {
  if (gamePhase.value !== "playing" && gamePhase.value !== "paused") return;
  cancelAnimationFrame(animationFrame);
  gamePhase.value = "over";
  exitConfirm.value = false;
  pendingLeave = null;
  selected.value = null;
  focusInfo.value = null;
  isNewRecord.value = score.value > bestScore.value;
  if (isNewRecord.value) {
    bestScore.value = score.value;
    writeStorage(STORAGE_PREFIX + ":best", String(bestScore.value));
  }
  const item: HistoryItem = { score: game.score, waves: game.wave, playedAt: new Date().toISOString() };
  history.value = [item, ...history.value].slice(0, 30);
  writeStorage(STORAGE_PREFIX + ":history", JSON.stringify(history.value));
  const generation = gameGeneration;
  const result = { score: game.score, waves: game.wave, durationMs: Math.max(0, Math.round(game.time * 1000)) };
  cloudSettlementPromise = finishCloudAttempt(cloudAttemptPromise, generation, result);
  if (options.silent) return;
  playTone(180, 0.16, 0.06);
  window.setTimeout(() => playTone(130, 0.2, 0.045), 110);
}

function resizeCanvas() {
  const canvas = canvasEl.value;
  const phone = phoneEl.value;
  if (!canvas || !phone || !phone.clientWidth || !phone.clientHeight) return;
  const ratio = canvasRatio();
  const scale = phone.clientWidth / WORLD_WIDTH;
  worldHeight = phone.clientHeight / scale;
  viewSize.value = { width: phone.clientWidth, height: phone.clientHeight };
  canvas.width = Math.round(phone.clientWidth * ratio);
  canvas.height = Math.round(phone.clientHeight * ratio);
  canvasContext = canvas.getContext("2d");
  canvasContext?.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0);
  drawScene();
}

function drawScene() {
  if (!canvasContext) return;
  drawZdScene(canvasContext, { width: WORLD_WIDTH, height: worldHeight, game, selected: selected.value, focus: focusInfo.value });
}

function drawMenuArt() {
  const context = menuArtEl.value?.getContext("2d");
  if (context) drawZdMenuArt(context, 248);
}

/** 在新版和经典两种画面之间切换，记在这台设备上；已经画出去的招牌图、图标和药圃跟着重画。 */
function toggleArtStyle() {
  artStyle.value = artStyle.value === "classic" ? "new" : "classic";
  writeStorage(STORAGE_PREFIX + ":style", artStyle.value);
  setZdArtStyle(artStyle.value);
  drawMenuArt();
  drawIcons();
  drawScene();
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
    applyLeaderboard(await zombieDefenseApi.leaderboard({ cacheTtlMs: force ? 0 : 15_000 }));
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
    const attempt = await zombieDefenseApi.startAttempt({
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

async function finishCloudAttempt(
  attemptPromise: Promise<number | null>,
  generation: number,
  result: { score: number; waves: number; durationMs: number },
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
    const board = await zombieDefenseApi.finishAttempt(attemptId, result, {
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

function applyLeaderboard(value: ZombieDefenseLeaderboard) {
  leaderboard.value = value.leaderboard;
  cloudMe.value = value.me;
  totalPlayers.value = value.totalPlayers;
  achievements.value = value.achievements;
  newlyUnlocked.value = value.newlyUnlocked;
}

function achievementPercent(item: ZombieDefenseAchievement) {
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
        waves: Math.max(0, Math.floor(Number(item.waves) || 0)),
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
/* 主菜单和排行等面板沿用共用外壳，只换成药圃的配色。 */
.zd-shell {
  --ink: #2f3a2a;
  --cyan: #cfe6b4;
  --blue: #4f8a3c;
  --blue-dark: #2f6b3a;
  --school-blue: #2f6b3a;
  /* 对局里的浮层压在不停重画的画布上，毛玻璃每一帧都要重新模糊，手机上很费，所以用不透明一点的底色。 */
  --zd-glass: rgba(18, 26, 30, .8);
  --zd-line: rgba(255, 255, 255, .14);
  --zd-text: #f4f7f2;
  --zd-muted: rgba(244, 247, 242, .64);
  --zd-gold: #ffd166;
  --zd-red: #ef5a44;
  background:
    radial-gradient(circle at 50% 0%, rgba(86, 122, 70, 0.82), transparent 45%),
    linear-gradient(160deg, #1b2a1c, #0f1810 70%);
}

.zd-shell .menu-emblem { border-color: rgba(47, 107, 58, .24); }
.zd-shell .menu-screen h1 { color: #2f6b3a !important; font-size: clamp(30px, 8.4vw, 40px); }
.zd-shell .menu-tagline { background: rgba(47, 74, 44, 0.72); }
.zd-shell .game-button--ranking { background: #7a5ab0; }
.zd-shell .panel-header,
.zd-shell .setting-row { background: #f6fbee; }
.zd-shell .ranking-list li,
.zd-shell .history-list li,
.zd-shell .achievement-list article:not(.unlocked) { background: rgba(246, 251, 238, .92); }
.zd-shell .flight-settings-panel > p { color: #4c5a45; text-align: left; }
.zd-shell .flight-settings-panel > .zd-guide { margin-top: -6px; }
.zd-guide b { margin-right: 8px; color: #2f6b3a; }
.zd-guide small { display: block; margin-top: 2px; color: #7b8676; font-size: 9px; }
.zd-hybrids small { margin-top: 4px; font-size: 10px; line-height: 1.5; }

/* 对局画面：深色半透明的浮层，不用粗边框和硬阴影。 */
.zd-shell .game-phone { background: #1c3a31; }
.zd-shell .game-canvas { background: #24463c; }
.zd-shell .game-layer { font-family: ui-rounded, "SF Pro Rounded", "HarmonyOS Sans SC", "PingFang SC", system-ui, sans-serif; }

.zd-shell .score-board,
.zd-status,
.zd-shell .game-controls button,
.zd-bar,
.zd-banner,
.zd-shell .ready-hint {
  border: 1px solid var(--zd-line);
  background: var(--zd-glass);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .22);
  color: var(--zd-text);
}

.zd-shell .score-board {
  top: 10px;
  left: 10px;
  min-width: 66px;
  place-items: start;
  padding: 7px 11px 8px;
  border-radius: 14px;
}
.zd-shell .score-board span { color: var(--zd-muted); font-size: 10px; font-weight: 600; }
.zd-shell .score-board strong { margin: 2px 0 1px; color: var(--zd-text); font-size: 22px; font-weight: 800; letter-spacing: -.02em; }
.zd-shell .score-board small { color: var(--zd-muted); font-size: 10px; font-weight: 600; }

.zd-status {
  position: absolute;
  top: 10px;
  left: 50%;
  display: grid;
  justify-items: center;
  gap: 3px;
  min-width: 74px;
  padding: 7px 14px 8px;
  border-radius: 999px;
  line-height: 1;
  transform: translateX(-50%);
}
.zd-status b { font-size: 14px; font-weight: 800; }
.zd-status small { color: var(--zd-muted); font-size: 10px; font-weight: 600; }

.zd-shell .game-controls { top: 10px; right: 10px; gap: 6px; }
.zd-shell .game-controls button {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  font-size: 15px;
  font-weight: 700;
}
.zd-shell .game-controls button:active { background: rgba(18, 26, 30, .82); }

.zd-shell .ready-hint {
  top: 42%;
  width: min(80%, 300px);
  padding: 16px 16px 15px;
  border-radius: 20px;
}
.zd-shell .ready-flight-mark { margin: 0 0 6px; font-size: 30px; transform: none; }
.zd-shell .ready-hint h2 { margin: 0 0 6px; color: var(--zd-text) !important; font-size: 17px; font-weight: 800; text-shadow: none; }
.zd-shell .ready-hint p { color: var(--zd-muted); font-size: 12px; font-weight: 500; line-height: 1.55; }

.zd-banner {
  position: absolute;
  top: 24%;
  left: 50%;
  padding: 8px 18px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 800;
  white-space: nowrap;
  transform: translateX(-50%);
  animation: zd-pop .28s cubic-bezier(.2, 1.4, .4, 1) both;
}
.zd-banner.big { border-color: rgba(255, 170, 150, .5); background: rgba(160, 40, 28, .78); font-size: 17px; }
@keyframes zd-pop {
  from { opacity: 0; transform: translateX(-50%) scale(.8); }
  to { opacity: 1; transform: translateX(-50%) scale(1); }
}

.zd-dock {
  position: absolute;
  right: 8px;
  bottom: max(10px, var(--game-safe-bottom));
  left: 8px;
}
.zd-hint {
  display: flex;
  min-height: 26px;
  align-items: center;
  justify-content: center;
  margin: 0 0 4px;
  color: var(--zd-muted);
  font-size: 11px;
  font-weight: 500;
  text-align: center;
}
.zd-hint.warn { color: #ffb4a6; }

/* 点中药材时弹在它旁边的小卡片。 */
.zd-pop {
  position: absolute;
  z-index: 3;
  display: grid;
  gap: 6px;
  padding: 10px 12px 12px;
  border: 1px solid rgba(255, 255, 255, .18);
  border-radius: 14px;
  background: rgba(17, 26, 30, .96);
  box-shadow: 0 10px 26px rgba(0, 0, 0, .42);
  color: var(--zd-text);
  pointer-events: auto;
  animation: zd-pop-in .14s ease-out both;
}
@keyframes zd-pop-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
.zd-pop-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.zd-pop-head b { min-width: 0; overflow: hidden; font-size: 14px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
.zd-pop-head em {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffe08e, #f2b93c);
  color: #3a2a05;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  line-height: 1.3;
}
.zd-pop p { margin: 0; }
.zd-pop-genes { color: var(--zd-muted); font-size: 10px; line-height: 1.4; }
.zd-pop-perks { display: grid; gap: 3px; margin: 0; padding: 0; list-style: none; }
.zd-pop-perks li { position: relative; padding-left: 11px; color: var(--zd-gold); font-size: 11px; line-height: 1.4; }
.zd-pop-perks li::before {
  position: absolute;
  top: .5em;
  left: 1px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  content: "";
}
.zd-pop-perks li.more { color: var(--zd-muted); }
.zd-pop-next { color: var(--zd-muted); font-size: 11px; line-height: 1.45; }
.zd-pop button {
  display: flex;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 2px;
  border: 0;
  border-radius: 10px;
  background: linear-gradient(180deg, #ffe08e, #f2b93c);
  box-shadow: 0 2px 0 #b07c14;
  color: #3a2a05;
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.zd-pop button span { font-size: 12px; font-weight: 700; opacity: .82; }
.zd-pop button:active { box-shadow: none; transform: translateY(2px); }
.zd-pop button.short { background: rgba(255, 255, 255, .14); box-shadow: none; color: #ff9a8a; }
.zd-pop-tail {
  position: absolute;
  bottom: -6px;
  width: 11px;
  height: 11px;
  margin-left: -5.5px;
  border-right: 1px solid rgba(255, 255, 255, .18);
  border-bottom: 1px solid rgba(255, 255, 255, .18);
  background: rgb(17, 26, 30);
  transform: rotate(45deg);
}
.zd-pop.below .zd-pop-tail { top: -6px; bottom: auto; transform: rotate(225deg); }

.zd-bar {
  display: flex;
  align-items: stretch;
  gap: 6px;
  padding: 6px;
  border-radius: 18px;
}
.zd-energy {
  display: grid;
  width: 52px;
  flex: 0 0 auto;
  place-content: center;
  justify-items: center;
  gap: 4px;
  border-radius: 12px;
  background: rgba(0, 0, 0, .26);
  line-height: 1;
}
/* 药力：一颗发亮的药丸。 */
.zd-energy i {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #fffbd6, #ffd166 46%, #e8962a 100%);
  box-shadow: 0 0 10px rgba(255, 209, 102, .55), inset 0 -2px 3px rgba(150, 80, 10, .35);
}
.zd-energy small { color: var(--zd-muted); font-size: 10px; font-weight: 600; }
.zd-energy b { color: var(--zd-gold); font-size: 17px; font-weight: 800; letter-spacing: -.02em; }
.zd-energy b.long { font-size: 12px; white-space: nowrap; }

.zd-cards {
  display: grid;
  min-width: 0;
  flex: 1 1 0;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 5px;
}

/* 药材卡：上面是图，下面一条写着价钱。 */
.zd-card {
  position: relative;
  display: grid;
  min-width: 0;
  justify-items: center;
  padding: 3px 0 0;
  overflow: hidden;
  border: 1.5px solid rgba(255, 255, 255, .2);
  border-radius: 12px;
  background: radial-gradient(circle at 50% 34%, #6f9a84, #33503f 78%);
  box-shadow: 0 2px 0 rgba(0, 0, 0, .36);
  color: var(--zd-text);
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform .12s ease, border-color .12s ease;
}
.zd-card canvas { width: 38px; height: 38px; filter: drop-shadow(0 2px 1.5px rgba(0, 0, 0, .35)); }
.zd-card span {
  display: block;
  width: 100%;
  margin-top: 2px;
  padding: 3px 0 4px;
  background: rgba(10, 16, 18, .62);
  color: var(--zd-gold);
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  text-align: center;
}
.zd-card em {
  position: absolute;
  top: 2px;
  left: 5px;
  color: rgba(244, 247, 242, .55);
  font-size: 9px;
  font-style: normal;
  font-weight: 600;
}
.zd-card.short span { color: #ff9a8a; }
.zd-card.short canvas { opacity: .45; filter: grayscale(.7); }
.zd-card.selected {
  border-color: var(--zd-gold);
  box-shadow: 0 0 0 1.5px var(--zd-gold), 0 6px 12px rgba(0, 0, 0, .4);
  transform: translateY(-4px);
}
.zd-card-mask {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 0;
  background: rgba(8, 12, 14, .66);
  pointer-events: none;
}
.zd-shovel {
  grid-column: span 2;
  grid-auto-flow: column;
  align-content: center;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0;
  background: linear-gradient(180deg, #56606a, #333b44);
}
.zd-shovel svg { width: 24px; height: 24px; color: #e6ebef; }
.zd-shovel span { width: auto; margin: 0; padding: 0; background: none; color: var(--zd-text); font-size: 12px; font-weight: 700; }
.zd-shovel.selected { background: linear-gradient(180deg, #b0503f, #7c3023); }

/* 暂停和结算 */
.zd-shell .modal-shade { background: rgba(8, 14, 14, .56); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.zd-shell .game-modal {
  width: min(100%, 300px);
  padding: 22px 20px 16px;
  border: 0;
  border-radius: 22px;
  background: #f7faf4;
  box-shadow: 0 18px 44px rgba(0, 0, 0, .34);
}
.zd-shell .modal-icon { color: #2f6b3a; font-size: 26px; }
.zd-shell .game-modal h2 { margin: 6px 0 2px; color: #24301f !important; font-size: 19px; font-weight: 800; }
.zd-shell .game-modal p { color: #6a7566; font-size: 12px; }
.zd-shell .game-modal .game-button {
  min-height: 46px;
  border: 0;
  border-radius: 14px;
  background: #2f6b3a;
  box-shadow: none;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0;
}
.zd-shell .game-modal .game-button:active { transform: none; background: #25572e; box-shadow: none; }
.zd-shell .plain-button { margin-top: 12px; color: #6a7566; font-weight: 600; }
.zd-shell .result-label { display: table; margin: 0 auto 2px; padding: 4px 10px; color: #2f6b3a; background: #e2f0d8; font-weight: 700; }
.zd-shell .final-score { color: #24301f; font-size: 60px; font-weight: 800; letter-spacing: -.03em; }
.zd-shell .final-unit { color: #6a7566; font-weight: 600; }
.zd-shell .result-stats { grid-template-columns: repeat(3, 1fr); gap: 6px; }
.zd-shell .result-stats span { padding: 8px 4px; border: 0; border-radius: 12px; background: #ecf2e6; }
.zd-shell .result-stats small { color: #7b8676; font-size: 10px; }
.zd-shell .result-stats b { color: #24301f; font-size: 13px; font-weight: 700; }
.zd-shell .cloud-result { color: #8a6a1c; font-weight: 600; }
.zd-shell .cloud-result.success { color: #2f6b3a; }
.zd-shell .new-unlocks b { color: #6a4a00; background: #fdeebf; font-weight: 600; }

@media (hover: none) {
  .zd-card em { display: none; }
}

@media (max-width: 600px) {
  .zd-shell { background: #0f1810; }
}

@media (prefers-reduced-motion: reduce) {
  .zd-banner,
  .zd-pop { animation: none; }
  .zd-card { transition: none; }
}
</style>
