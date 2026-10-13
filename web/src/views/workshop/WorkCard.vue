<template>
  <article class="pk-card ws-work">
    <div class="ws-work-top">
      <span class="pk-tile" aria-hidden="true">{{
        work.version?.type === "game" ? "🎮" : "✦"
      }}</span>
      <div class="ws-work-title">
        <h2 class="ws-name">
          <router-link :to="`/workshop/${work.id}`">{{
            work.version?.name || work.slug
          }}</router-link>
        </h2>
        <div class="ws-meta">
          <span>{{
            work.version?.type === "game"
              ? "游戏"
              : work.version?.type === "extension"
                ? "站点扩展"
                : "工具"
          }}</span
          ><span>v{{ work.version?.version || "—" }}</span>
        </div>
      </div>
    </div>
    <p class="ws-description ws-summary">
      {{ work.version?.description || "暂无介绍" }}
    </p>
    <div class="ws-meta">
      <router-link class="pk-link" :to="`/u/${work.author.id}`">{{
        work.author.nickname
      }}</router-link
      ><span>{{ workshopDate(work.updatedAt) }} 更新</span>
    </div>
    <div class="ws-footer">
      <router-link class="pk-pill" :to="`/workshop/${work.id}`"
        >查看作品</router-link
      >
      <el-button
        :loading="busy"
        :type="work.isFavorited ? 'primary' : 'default'"
        text
        :aria-label="work.isFavorited ? '取消收藏' : '收藏作品'"
        @click="$emit('favorite', work)"
        >{{ work.isFavorited ? "已收藏" : "收藏" }} ·
        {{ work.favoriteCount }}</el-button
      >
    </div>
  </article>
</template>
<script setup lang="ts">
import type { WorkshopWork } from "@/api/workshop";
import { workshopDate } from "./shared";
defineProps<{ work: WorkshopWork; busy?: boolean }>();
defineEmits<{ favorite: [work: WorkshopWork] }>();
</script>
