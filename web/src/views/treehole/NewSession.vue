<template>
  <div class="th-page th-new">
    <router-link class="th-back" to="/treehole">
      <el-icon aria-hidden="true"><ArrowLeft /></el-icon>艾绒树洞
    </router-link>
    <header class="th-head">
      <div class="th-head-copy">
        <h1>{{ mode === "live" ? "实时聊天" : "留言倾诉" }}</h1>
        <p v-if="mode === 'live'">选一位正在值班的小艾绒，马上开始一对一聊天。</p>
        <p v-else>选一位小艾绒，或交给系统安排。洞主会在值班时间回复你。</p>
        <button type="button" class="th-switch-mode" @click="switchMode">{{ mode === "live" ? "改用留言倾诉" : "改用实时聊天" }} ›</button>
      </div>
    </header>

    <div v-if="loading" class="th-group" role="status"><el-skeleton :rows="4" animated /></div>
    <template v-else>
      <section class="th-group th-group--flush">
        <div class="th-group-head">
          <h2 class="th-h2">选择洞主</h2>
          <span class="th-muted">只显示洞主编号，彼此都看不到真实身份</span>
        </div>
        <div v-if="!visibleHosts.length && mode === 'live'" class="th-empty">
          <p>现在没有在岗的小艾绒。可以先留言，洞主值班时会回复你。</p>
          <el-button type="primary" @click="switchMode">改用留言倾诉</el-button>
        </div>
        <div v-else class="th-rows" role="radiogroup" aria-label="选择洞主">
          <button
            v-if="mode === 'async'"
            type="button"
            class="th-row th-host"
            role="radio"
            :aria-checked="selectedId === null"
            :class="{ 'is-selected': selectedId === null }"
            @click="pick(null)"
          >
            <span class="th-host-avatar" data-hue="brand">艾</span>
            <div class="th-row-copy">
              <div class="th-row-title">由系统安排</div>
              <div class="th-row-preview">优先安排正在值班、手头会话少的小艾绒</div>
            </div>
          </button>
          <button
            v-for="host in visibleHosts"
            :key="host.id"
            type="button"
            class="th-row th-host"
            role="radio"
            :aria-checked="selectedId === host.id"
            :class="{ 'is-selected': selectedId === host.id }"
            @click="pick(host.id)"
          >
            <span class="th-host-avatar" data-hue="violet">{{ host.code }}</span>
            <div class="th-row-copy">
              <div class="th-row-title">
                {{ host.name }}
                <em class="th-chip" :class="host.online ? 'is-ok' : ''">{{ host.online ? "在岗" : "离岗" }}</em>
              </div>
              <div class="th-row-preview">{{ host.intro || (host.online ? "正在值班" : nextShiftText(host.nextShiftAt)) }}</div>
            </div>
          </button>
        </div>
      </section>

      <section v-if="visibleHosts.length || mode === 'async'" ref="composerSection" class="th-group">
        <h2 class="th-h2">想说的话</h2>
        <p class="th-sub">可以从任何地方说起。这次对话的虚拟 ID 会在发送后生成，结束后作废。</p>
        <div class="th-new-composer">
          <Composer :send="start" draft-key="new-session" placeholder="说说此刻的心情…" />
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft } from "@element-plus/icons-vue";
import { treeholeApi, type TreeholeHost, type TreeholeMode } from "@/api/treehole";
import Composer from "./Composer.vue";
import { nextShiftText } from "./shared";
import "./treehole.css";

const route = useRoute();
const router = useRouter();
const hosts = ref<TreeholeHost[]>([]);
const loading = ref(true);
const selectedId = ref<number | null>(null);
const composerSection = ref<HTMLElement | null>(null);

// 手机上选好洞主，把写话的框带到眼前。
function pick(id: number | null) {
  selectedId.value = id;
  if (window.innerWidth < 640) composerSection.value?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

const mode = computed<TreeholeMode>(() => (route.query.mode === "live" ? "live" : "async"));
const visibleHosts = computed(() => (mode.value === "live" ? hosts.value.filter((host) => host.online) : hosts.value));

async function load() {
  loading.value = true;
  try {
    hosts.value = (await treeholeApi.hosts()).hosts;
  } finally {
    loading.value = false;
  }
  resetSelection();
}

function resetSelection() {
  selectedId.value = mode.value === "live" ? visibleHosts.value[0]?.id ?? null : null;
}

function switchMode() {
  router.replace({ query: { mode: mode.value === "live" ? "async" : "live" } });
}

async function start(payload: { content: string; imageId: number | null }) {
  if (mode.value === "live" && !selectedId.value) throw new Error("请选择一位在岗的洞主");
  const { id } = await treeholeApi.createSession({ mode: mode.value, hostId: selectedId.value, ...payload });
  router.replace(`/treehole/session/${id}`);
}

watch(mode, resetSelection);
onMounted(load);
</script>

<style scoped>
.th-switch-mode {
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--cpu-hue-brand-ink);
  font: inherit;
  font-size: var(--cpu-fs-s);
  cursor: pointer;
}
.th-host { gap: 12px; }
.th-host.is-selected { background: var(--cpu-primary-soft); }
.th-host.is-selected:hover { background: var(--cpu-primary-soft); }
.th-host-avatar {
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--cpu-hue-bg);
  color: var(--cpu-hue-ink);
  font-size: var(--cpu-fs-s);
  font-weight: 700;
}
.th-new-composer { margin-top: 12px; }
</style>
