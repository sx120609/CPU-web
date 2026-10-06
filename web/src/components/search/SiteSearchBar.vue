<template>
  <form class="site-search-bar" role="search" @submit.prevent="submitSearch">
    <el-icon class="site-search-icon" aria-hidden="true"><Search /></el-icon>
    <input
      v-model="keyword"
      type="search"
      enterkeyhint="search"
      maxlength="100"
      :aria-label="scope === 'services' ? '搜索校园服务' : '搜索站内内容'"
      :placeholder="placeholder"
    />
    <button v-if="keyword.trim()" data-cpu-button="surface" type="submit">搜索</button>
  </form>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { Search } from "@element-plus/icons-vue";

const props = withDefaults(defineProps<{
  placeholder?: string;
  scope?: "all" | "services";
}>(), {
  placeholder: "搜索帖子标题、正文、课程或校园服务",
  scope: "all",
});

const router = useRouter();
const keyword = ref("");

function submitSearch() {
  const query = keyword.value.trim().slice(0, 100);
  if (!query) return;
  router.push({
    name: "site-search",
    query: props.scope === "services" ? { q: query, scope: "services" } : { q: query },
  });
}
</script>

<style scoped>
.site-search-bar { display: flex; width: 100%; height: 44px; align-items: center; gap: 8px; padding: 0 6px 0 12px; border-radius: var(--cpu-radius-m); background: var(--cpu-card); }
.site-search-bar:focus-within { box-shadow: inset 0 0 0 2px var(--cpu-primary); }
.site-search-icon { flex: none; color: var(--cpu-text-muted); font-size: 17px; }
.site-search-bar input { min-width: 0; height: 100%; flex: 1; padding: 0; border: 0; outline: 0; background: none; color: var(--cpu-text); font: inherit; font-size: var(--cpu-fs-m); -webkit-appearance: none; appearance: none; }
.site-search-bar input::placeholder { color: var(--cpu-text-muted); opacity: 1; }
.site-search-bar input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
.site-search-bar button { height: 32px; flex: none; padding: 0 12px; border: 0; border-radius: 8px; background: var(--cpu-primary); color: var(--cpu-on-primary); font: inherit; font-size: var(--cpu-fs-s); font-weight: 500; cursor: pointer; }
</style>
