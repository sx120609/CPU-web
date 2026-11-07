<template>
  <section class="th-group th-group--flush">
    <div class="th-group-head">
      <h2 class="th-h2">留言日志</h2>
      <div class="th-actions">
        <el-select v-model="filters.claim" size="small" clearable placeholder="全部进度" class="th-filter" @change="reload">
          <el-option label="待认领" value="unclaimed" />
          <el-option label="已认领" value="claimed" />
          <el-option label="已回复" value="replied" />
        </el-select>
        <el-select v-model="filters.topic" size="small" clearable placeholder="全部标签" class="th-filter" @change="reload">
          <el-option v-for="topic in TREEHOLE_TOPICS" :key="topic" :label="topic" :value="topic" />
        </el-select>
        <el-select v-model="filters.tag" size="small" clearable placeholder="全部风险" class="th-filter" @change="reload">
          <el-option label="普通情绪" value="normal" />
          <el-option label="重点关注" value="focus" />
          <el-option label="高危转介" value="crisis" />
        </el-select>
        <el-select v-model="filters.status" size="small" clearable placeholder="全部状态" class="th-filter" @change="reload">
          <el-option label="进行中" value="active" />
          <el-option label="已结束" value="ended" />
        </el-select>
        <el-select v-model="filters.mode" size="small" clearable placeholder="全部模式" class="th-filter" @change="reload">
          <el-option label="留言倾诉" value="async" />
          <el-option label="实时聊天" value="live" />
        </el-select>
      </div>
    </div>
    <p class="th-sub th-panel-note">打开任意一段对话都会记入操作日志。</p>
    <div v-if="!list.length" class="th-empty"><p>没有符合条件的会话。</p></div>
    <div v-else class="th-rows">
      <router-link v-for="session in list" :key="session.id" class="th-row" :to="`/treehole/session/${session.id}`">
        <div class="th-row-copy">
          <div class="th-row-title">
            {{ session.alias }}
            <em class="th-chip">{{ session.mode === "live" ? "实时" : "留言" }}</em>
            <em v-if="session.tag && session.tag !== 'normal'" class="th-chip" :class="tagTone(session.tag)">{{ tagLabel(session.tag) }}</em>
            <em class="th-chip" :class="claimStatusTone(session.claimStatus, session.status !== 'active')">{{ claimStatusLabel(session.claimStatus, session.status !== "active") }}</em>
            <em v-for="topic in session.topics" :key="topic" class="th-chip">#{{ topic }}</em>
          </div>
          <p class="th-meta"><span>{{ session.host ? `${session.host.name} 接待` : "无人认领" }}</span><span>开始于 {{ timeText(session.createdAt) }}</span><span>最近 {{ timeText(session.lastMessageAt) }}</span></p>
        </div>
      </router-link>
    </div>
    <div v-if="total > 30" class="th-pager">
      <el-pagination v-model:current-page="page" layout="prev, pager, next" :page-size="30" :total="total" small @current-change="load" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { treeholeApi, TREEHOLE_TOPICS, type TreeholeSession } from "@/api/treehole";
import { claimStatusLabel, claimStatusTone, tagLabel, tagTone, timeText } from "../shared";

const filters = reactive<{ tag?: string; status?: string; mode?: string; claim?: string; topic?: string }>({});
const list = ref<TreeholeSession[]>([]);
const total = ref(0);
const page = ref(1);

async function load() {
  const result = await treeholeApi.adminSessions({
    page: page.value,
    ...(filters.tag ? { tag: filters.tag } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.mode ? { mode: filters.mode } : {}),
    ...(filters.claim ? { claim: filters.claim } : {}),
    ...(filters.topic ? { topic: filters.topic } : {}),
  });
  list.value = result.list;
  total.value = result.total;
}

function reload() {
  page.value = 1;
  void load();
}

onMounted(load);
</script>

<style scoped>
.th-filter { width: 110px; }
.th-panel-note { margin: -6px 16px 8px; }
.th-pager { display: flex; justify-content: center; padding: 8px; border-top: 1px solid var(--cpu-border-soft); }
</style>
