<template>
  <div class="gd-page gd-chapter">
    <router-link class="gd-back" to="/guide">
      <el-icon aria-hidden="true"><ArrowLeft /></el-icon>全部章节
    </router-link>

    <template v-if="chapter">
      <header class="gd-head">
        <span class="gd-tile" :data-hue="chapter.hue" aria-hidden="true">
          <el-icon><component :is="chapter.icon" /></el-icon>
        </span>
        <div class="gd-head-copy">
          <h1>{{ chapter.title }}</h1>
          <p>{{ chapter.summary }}</p>
        </div>
        <router-link v-if="chapter.entry" class="gd-chapter-entry" :to="chapter.entry.to">
          {{ chapter.entry.label }}<el-icon aria-hidden="true"><ArrowRight /></el-icon>
        </router-link>
      </header>

      <p v-for="paragraph in chapter.intro" :key="paragraph" class="gd-chapter-intro">{{ paragraph }}</p>

      <div class="gd-chapter-bar">
        <span>{{ chapter.topics.length }} 项，点标题展开</span>
        <button type="button" @click="toggleAll">{{ allOpen ? "全部收起" : "全部展开" }}</button>
      </div>

      <div class="gd-card">
        <details
          v-for="topic in chapter.topics"
          :id="topic.id"
          :key="topic.id"
          class="gd-topic"
          :open="opened.has(topic.id)"
          @toggle="onToggle(topic.id, $event)"
        >
          <summary>
            <span class="gd-topic-title">{{ topic.title }}</span>
            <span v-if="topic.tag" class="gd-topic-tag">{{ topic.tag }}</span>
            <el-icon class="gd-topic-arrow" aria-hidden="true"><ArrowDown /></el-icon>
          </summary>
          <div class="gd-topic-body">
            <p v-for="paragraph in topic.body" :key="paragraph">{{ paragraph }}</p>
            <ol v-if="topic.steps?.length">
              <li v-for="step in topic.steps" :key="step">{{ step }}</li>
            </ol>
            <ul v-if="topic.tips?.length" class="gd-topic-tips">
              <li v-for="tip in topic.tips" :key="tip">{{ tip }}</li>
            </ul>
            <router-link v-if="topic.link" class="gd-topic-link" :to="topic.link.to">
              {{ topic.link.label }}<el-icon aria-hidden="true"><ArrowRight /></el-icon>
            </router-link>
          </div>
        </details>
      </div>

      <nav class="gd-chapter-nav" aria-label="章节切换">
        <router-link v-if="previous" class="gd-chapter-step" :to="chapterLocation(previous.id)">
          <small>上一章</small>
          <b>{{ previous.title }}</b>
        </router-link>
        <span v-else />
        <router-link v-if="next" class="gd-chapter-step is-next" :to="chapterLocation(next.id)">
          <small>下一章</small>
          <b>{{ next.title }}</b>
        </router-link>
        <router-link v-else class="gd-chapter-step is-next" to="/guide">
          <small>已经是最后一章</small>
          <b>回到目录</b>
        </router-link>
      </nav>
    </template>

    <template v-else-if="settled">
      <p class="gd-empty">这一章在你这里用不到：可能是本校还没开放这个功能，或者这个客户端里没有它。</p>
      <router-link class="gd-chapter-entry gd-chapter-entry--center" to="/guide">看全部章节</router-link>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ArrowDown, ArrowLeft, ArrowRight } from "@element-plus/icons-vue";
import { setDocumentTitle } from "@/utils/documentTitle";
import { useGuide } from "./useGuide";
import "./guide.css";

const route = useRoute();
const { chapters, settled } = useGuide();
const chapterId = computed(() => String(route.params.chapter || ""));
const index = computed(() => chapters.value.findIndex((item) => item.id === chapterId.value));
const chapter = computed(() => chapters.value[index.value]);
const previous = computed(() => (index.value > 0 ? chapters.value[index.value - 1] : undefined));
const next = computed(() => (index.value >= 0 ? chapters.value[index.value + 1] : undefined));

// 默认全部收起：先看到这一章有哪些操作，再点开想看的。
const opened = ref(new Set<string>());
const allOpen = computed(() => Boolean(chapter.value?.topics.length) && chapter.value!.topics.every((topic) => opened.value.has(topic.id)));

function chapterLocation(id: string) {
  return { name: "guide-chapter", params: { chapter: id } };
}

function onToggle(id: string, event: Event) {
  const isOpen = (event.target as HTMLDetailsElement).open;
  if (isOpen === opened.value.has(id)) return;
  const nextSet = new Set(opened.value);
  if (isOpen) nextSet.add(id);
  else nextSet.delete(id);
  opened.value = nextSet;
}

function toggleAll() {
  opened.value = allOpen.value ? new Set() : new Set(chapter.value?.topics.map((topic) => topic.id));
}

// 从搜索结果或别的页面带着 ?open=条目 过来时，展开并滚到那一条。
watch(
  [chapterId, () => route.query.open, () => Boolean(chapter.value)],
  async ([id, target], previousValues) => {
    if (id !== previousValues?.[0]) opened.value = new Set();
    const topicId = typeof target === "string" ? target : "";
    if (!topicId || !chapter.value?.topics.some((topic) => topic.id === topicId)) return;
    opened.value = new Set(opened.value).add(topicId);
    await nextTick();
    document.getElementById(topicId)?.scrollIntoView({ block: "center" });
  },
  { immediate: true },
);

watch(() => chapter.value?.title, (title) => {
  if (title) setDocumentTitle(`${title} · 使用教程`);
}, { immediate: true });
</script>

<style scoped>
.gd-chapter-entry {
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
.gd-chapter-entry--center { align-self: center; }
.gd-chapter-intro {
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.7;
}
.gd-chapter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 2px -6px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}
.gd-chapter-bar button {
  padding: 4px 0;
  border: 0;
  background: none;
  color: var(--cpu-primary);
  font: inherit;
  cursor: pointer;
}

.gd-topic { border-top: 1px solid var(--cpu-border-soft); }
.gd-topic:first-child { border-top: 0; }
.gd-topic summary {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  list-style: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.gd-topic summary::-webkit-details-marker { display: none; }
.gd-topic-title {
  min-width: 0;
  flex: 1 1 auto;
  font-size: var(--cpu-fs-m);
  font-weight: 600;
  line-height: 1.45;
}
.gd-topic-tag {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  white-space: nowrap;
}
.gd-topic-arrow {
  flex: 0 0 auto;
  color: var(--cpu-text-muted);
  transition: transform 0.16s ease;
}
.gd-topic[open] .gd-topic-arrow { transform: rotate(180deg); }
.gd-topic-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 14px 14px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.75;
  overflow-wrap: anywhere;
}
.gd-topic-body :is(p, ol, ul) { margin: 0; }
.gd-topic-body ol { padding-left: 20px; color: var(--cpu-text); }
.gd-topic-body li + li { margin-top: 4px; }
.gd-topic-tips {
  padding: 10px 12px 10px 28px;
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-surface-soft);
}
.gd-topic-link {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 2px;
  color: var(--cpu-primary);
  font-weight: 600;
  text-decoration: none;
}

.gd-chapter-nav {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.gd-chapter-step {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  color: inherit;
  text-decoration: none;
}
.gd-chapter-step.is-next { align-items: flex-end; text-align: right; }
.gd-chapter-step small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.gd-chapter-step b {
  max-width: 100%;
  overflow: hidden;
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-m);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .gd-topic-arrow { transition: none; }
}
</style>
