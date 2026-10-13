<template>
  <div class="pk-page pk-page--narrow games-hub">
    <header class="pk-head">
      <router-link class="pk-back" to="/services/tools"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>校园小工具</router-link>
      <div class="pk-title">
        <span class="pk-tile" aria-hidden="true"><el-icon><Trophy /></el-icon></span>
        <div class="pk-title-copy">
          <h1>小游戏<em class="pk-badge is-open">即点即玩</em></h1>
          <p>课间来一局。登录后成绩计入全校排行，还能解锁成就。</p>
        </div>
      </div>
    </header>

    <router-link class="pk-notice" to="/workshop?type=game">去创意工坊发现更多游戏，或分享你的创作 →</router-link>

    <div class="games-hub-list">
      <button
        v-for="game in miniGames"
        :key="game.slug"
        data-cpu-button="surface"
        type="button"
        class="games-hub-card"
        :data-hue="game.hue"
        @click="router.push({ name: game.routeName })"
      >
        <span class="games-hub-cover" aria-hidden="true">{{ game.cover }}</span>
        <span class="games-hub-copy">
          <b>{{ game.name }}</b>
          <small>{{ game.summary }}</small>
          <span class="games-hub-tags">
            <em v-for="tag in game.tags" :key="tag">{{ tag }}</em>
            <em v-if="bestScores[game.slug]" class="is-best">我的最高 {{ bestScores[game.slug] }} 分</em>
          </span>
        </span>
        <el-icon class="games-hub-arrow" aria-hidden="true"><ArrowRight /></el-icon>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive } from "vue";
import { useRouter } from "vue-router";
import { ArrowLeft, ArrowRight, Trophy } from "@element-plus/icons-vue";
import { request } from "@/api/request";
import { miniGames } from "@/data/miniGames";
import { useAuthStore } from "@/stores/auth";
import "@/styles/page-kit.css";

const router = useRouter();
const auth = useAuthStore();
const bestScores = reactive(Object.fromEntries(miniGames.map((game) => [game.slug, readBestScore(game.bestStorageKey)])));

// 本机记录只算这台设备上打的局；登录后补上账号的云端最高分，和游戏里显示的一致。
onMounted(() => {
  if (!auth.isLoggedIn) return;
  for (const game of miniGames) {
    request.get<{ me: { bestScore: number } | null }>(game.leaderboardPath, undefined, {
      cacheTtlMs: 15_000,
      suppressErrorMessage: true,
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
    }).then((board) => {
      bestScores[game.slug] = Math.max(bestScores[game.slug], board.me?.bestScore ?? 0);
    }).catch(() => undefined);
  }
});

function readBestScore(key: string) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}
</script>

<style scoped>
.games-hub-list { display: grid; gap: 12px; }

.games-hub-card {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: border-color .15s ease;
}
.games-hub-card:active { background: var(--cpu-surface-soft); }
@media (hover: hover) {
  .games-hub-card:hover { border-color: var(--cpu-hue-ink); }
}

.games-hub-cover {
  display: grid;
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-hue-bg);
  font-size: 32px;
  line-height: 1;
}

.games-hub-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.games-hub-copy b { color: var(--cpu-text); font-size: var(--cpu-fs-l); font-weight: 600; line-height: 1.35; }
.games-hub-copy small { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.5; }

.games-hub-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.games-hub-tags em {
  padding: 1px 7px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  font-style: normal;
  line-height: 1.6;
}
.games-hub-tags em.is-best { background: var(--cpu-hue-bg); color: var(--cpu-hue-ink); font-weight: 500; }

.games-hub-arrow { flex: 0 0 auto; color: var(--cpu-text-muted); font-size: var(--cpu-fs-l); }

@media (prefers-reduced-motion: reduce) {
  .games-hub-card { transition: none; }
}
</style>
