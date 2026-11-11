<template>
  <div class="gd-page gd-index">
    <header class="gd-head">
      <div class="gd-head-copy">
        <h1>使用教程</h1>
        <p>想了解哪部分就点开哪一章，不用从头看完。</p>
      </div>
      <router-link v-if="firstChapter" class="gd-index-start" :to="chapterLocation(firstChapter.id)">
        从头看起<el-icon aria-hidden="true"><ArrowRight /></el-icon>
      </router-link>
    </header>

    <el-input
      v-model="keyword"
      class="gd-index-search"
      clearable
      :prefix-icon="Search"
      placeholder="搜一搜，比如 成绩、小组件、提醒"
      aria-label="搜索教程"
    />

    <template v-if="keyword.trim()">
      <div v-if="hits.length" class="gd-card" role="list" aria-label="搜索结果">
        <router-link
          v-for="hit in hits"
          :key="hit.chapter.id + (hit.topic?.id ?? '')"
          class="gd-row"
          role="listitem"
          :to="chapterLocation(hit.chapter.id, hit.topic?.id)"
        >
          <span class="gd-tile" :data-hue="hit.chapter.hue" aria-hidden="true">
            <el-icon><component :is="hit.chapter.icon" /></el-icon>
          </span>
          <span class="gd-row-copy">
            <span class="gd-row-title">{{ hit.topic ? hit.topic.title : hit.chapter.title }}</span>
            <span class="gd-row-sub">{{ hit.topic ? hit.chapter.title : hit.chapter.summary }}</span>
          </span>
          <el-icon aria-hidden="true"><ArrowRight /></el-icon>
        </router-link>
      </div>
      <p v-else class="gd-empty">没有找到“{{ keyword.trim() }}”。换个说法试试，或者直接翻下面的目录。</p>
      <button v-if="!hits.length" type="button" class="gd-index-clear" @click="keyword = ''">看全部章节</button>
    </template>

    <template v-else>
      <template v-for="group in groups" :key="group.title">
        <h2 class="gd-h2">{{ group.title }}</h2>
        <div class="gd-card" role="list" :aria-label="group.title">
          <router-link
            v-for="chapter in group.chapters"
            :key="chapter.id"
            class="gd-row"
            role="listitem"
            :to="chapterLocation(chapter.id)"
          >
            <span class="gd-tile" :data-hue="chapter.hue" aria-hidden="true">
              <el-icon><component :is="chapter.icon" /></el-icon>
            </span>
            <span class="gd-row-copy">
              <span class="gd-row-title">{{ chapter.title }}</span>
              <span class="gd-row-sub">{{ chapter.summary }}</span>
            </span>
            <span class="gd-row-more">{{ chapter.topics.length }} 项</span>
            <el-icon aria-hidden="true"><ArrowRight /></el-icon>
          </router-link>
        </div>
      </template>
      <p class="gd-index-foot">
        这里没写到，或者照着做不对？到
        <router-link to="/services/tools/feedback">需求反馈</router-link>
        告诉我们。
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowRight, Search } from "@element-plus/icons-vue";
import { useGuide } from "./useGuide";
import "./guide.css";

const { chapters, groups, search } = useGuide();
const keyword = ref("");
const hits = computed(() => search(keyword.value));
const firstChapter = computed(() => chapters.value[0]);

function chapterLocation(id: string, topic?: string) {
  return { name: "guide", params: { chapter: id }, ...(topic ? { query: { open: topic } } : {}) };
}
</script>

<style scoped>
.gd-index-start {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 2px;
  padding: 0 14px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-s);
  font-weight: 600;
  text-decoration: none;
}
.gd-index-clear {
  align-self: center;
  padding: 0;
  border: 0;
  background: none;
  color: var(--cpu-primary);
  font: inherit;
  font-size: var(--cpu-fs-s);
  cursor: pointer;
}
.gd-index-foot {
  margin: 0;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  text-align: center;
}
.gd-index-foot a { color: var(--cpu-primary); text-decoration: none; }
</style>
