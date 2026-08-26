<template>
  <form class="site-search-bar" role="search" @submit.prevent="submitSearch">
    <el-input
      v-model="keyword"
      clearable
      maxlength="100"
      aria-label="搜索站内内容"
      :placeholder="placeholder"
    >
      <template #prefix><el-icon><Search /></el-icon></template>
    </el-input>
    <el-button native-type="submit" type="primary" :disabled="!keyword.trim()">搜索</el-button>
  </form>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { Search } from "@element-plus/icons-vue";

withDefaults(defineProps<{ placeholder?: string }>(), {
  placeholder: "搜索帖子标题、正文、课程或校园服务",
});

const router = useRouter();
const keyword = ref("");

function submitSearch() {
  const query = keyword.value.trim().slice(0, 100);
  if (!query) return;
  router.push({ name: "site-search", query: { q: query } });
}
</script>

<style scoped>
.site-search-bar {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
</style>
