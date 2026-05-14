<template>
  <div class="market-page">
    <div class="head">
      <h2>🛒 二手市场</h2>
      <el-button v-if="auth.isLoggedIn" type="primary" @click="$router.push({ name: 'post', query: { board: 'market' } })">
        <el-icon><Plus /></el-icon> 发布商品
      </el-button>
    </div>

    <el-radio-group v-model="filter" size="default" @change="reload">
      <el-radio-button value="all">全部</el-radio-button>
      <el-radio-button value="sell">出售</el-radio-button>
      <el-radio-button value="buy">求购</el-radio-button>
    </el-radio-group>

    <div class="goods-grid" v-loading="loading">
      <div v-for="t in filteredList" :key="t.id" class="goods" @click="$router.push(`/forum/topic/${t.id}`)">
        <div class="g-head">
          <span class="title">{{ t.title }}</span>
          <span v-if="t.metadata?.condition === '求购'" class="badge badge-buy">求购</span>
        </div>
        <div class="g-price" v-if="t.metadata?.price !== undefined">¥ {{ t.metadata.price }}</div>
        <div class="g-meta">
          <span v-if="t.metadata?.condition && t.metadata?.condition !== '求购'">📦 {{ t.metadata.condition }}</span>
          <span v-if="t.metadata?.tradeMode">🤝 {{ t.metadata.tradeMode }}</span>
        </div>
        <div class="g-foot">
          <span>{{ t.author?.nickname }}</span>
          <span>{{ fmtRelative(t.createdAt) }}</span>
          <span>💬 {{ t.replyCount }}</span>
        </div>
      </div>
      <el-empty v-if="!loading && !list.length" description="还没有商品" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Plus } from "@element-plus/icons-vue";
import { topicApi } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";
import { fmtRelative } from "@/utils/format";

const auth = useAuthStore();
const list = ref<any[]>([]);
const loading = ref(false);
const filter = ref("all");

onMounted(async () => { await reload(); });

async function reload() {
  loading.value = true;
  try {
    const r = await topicApi.list({ board: "market", size: 50, sort: "new" });
    list.value = r.list;
  } finally { loading.value = false; }
}

const filteredList = computed(() => {
  if (filter.value === "all") return list.value;
  if (filter.value === "buy") return list.value.filter((t) => t.metadata?.condition === "求购");
  return list.value.filter((t) => t.metadata?.condition !== "求购");
});
</script>

<style scoped>
.market-page { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; justify-content: space-between; align-items: center; }
.head h2 { margin: 0; font-size: 22px; }

.goods-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
.goods {
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.goods:hover { border-color: var(--cpu-primary); box-shadow: 0 4px 12px rgba(22,135,118,0.08); }

.g-head { display: flex; gap: 6px; align-items: center; }
.title { font-size: 14px; color: #1f2937; font-weight: 500; flex: 1; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
.badge-buy { background: #fef3c7; color: #b45309; }

.g-price { font-size: 22px; font-weight: 700; color: #ef4444; margin: 8px 0; }
.g-meta { display: flex; gap: 10px; font-size: 12px; color: #6b7280; flex-wrap: wrap; }

.g-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #f1f5f9;
  font-size: 11px;
  color: #9ca3af;
}
</style>
