<template>
  <div class="th-page th-rooms">
    <router-link class="th-back" to="/treehole">
      <el-icon aria-hidden="true"><ArrowLeft /></el-icon>艾绒树洞
    </router-link>
    <header class="th-head">
      <div class="th-head-copy">
        <h1>主题宣泄室</h1>
        <p>按困扰找到同主题的房间，和有相似经历的同学匿名聊聊。房间里只显示虚拟 ID，由小艾绒照看。</p>
      </div>
      <div v-if="isHost" class="th-actions">
        <el-button type="primary" @click="createOpen = true">开设宣泄室</el-button>
      </div>
    </header>

    <div class="th-topic-picker th-scroll-chips" role="group" aria-label="按主题筛选">
      <button type="button" class="th-topic" :class="{ 'is-on': !category }" :aria-pressed="!category" @click="category = ''">全部</button>
      <button
        v-for="item in categories"
        :key="item.value"
        type="button"
        class="th-topic"
        :class="{ 'is-on': category === item.value }"
        :aria-pressed="category === item.value"
        @click="category = item.value"
      >
        {{ item.label }}
      </button>
    </div>

    <div v-if="loading && !rooms.length" class="th-group" role="status"><el-skeleton :rows="4" animated /></div>
    <div v-else-if="error" class="th-group th-empty" role="alert"><p>{{ error }}</p><el-button @click="load">重试</el-button></div>
    <div v-else-if="!filtered.length" class="th-group th-empty">
      <p>{{ category ? "这个主题还没有宣泄室。" : "还没有开放的宣泄室。" }}</p>
      <p v-if="!isHost" class="th-muted">也可以先写一条留言，小艾绒会陪你聊。</p>
    </div>
    <div v-else class="th-room-grid">
      <article v-for="room in filtered" :key="room.id" class="th-room-card">
        <div class="th-row-title">
          {{ room.name }}
          <em class="th-chip is-brand">{{ room.categoryLabel }}</em>
        </div>
        <p class="th-room-intro">{{ room.intro || "这里欢迎同主题的同学聊聊。" }}</p>
        <p class="th-meta"><span>{{ room.visitorCount }} 位同学</span><span>{{ room.hostCount }} 位小艾绒</span></p>
        <div class="th-actions">
          <el-button v-if="room.joined" type="primary" plain @click="router.push(`/treehole/room/${room.id}`)">进入</el-button>
          <el-button v-else-if="room.removed" disabled>已被移出</el-button>
          <el-button v-else type="primary" @click="openJoin(room)">加入</el-button>
        </div>
      </article>
    </div>

    <el-dialog v-model="joinOpen" :title="joining ? `加入「${joining.name}」` : '加入宣泄室'" width="min(92vw, 460px)" append-to-body>
      <h3 class="th-rules-title">保密与伦理须知</h3>
      <ol class="th-rules">
        <li v-for="(line, index) in ruleLines" :key="index">{{ line }}</li>
      </ol>
      <el-checkbox v-model="agreed">我已阅读，并会遵守以上须知</el-checkbox>
      <template #footer>
        <el-button @click="joinOpen = false">再看看</el-button>
        <el-button type="primary" :disabled="!agreed" :loading="submitting" @click="join">进入宣泄室</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="createOpen" title="开设宣泄室" width="min(92vw, 440px)" append-to-body>
      <form class="th-form" @submit.prevent="create">
        <div class="th-field">
          <span class="th-field-label">主题</span>
          <div class="th-topic-picker th-create-topics">
            <button
              v-for="item in categories"
              :key="item.value"
              type="button"
              class="th-topic"
              :class="{ 'is-on': form.category === item.value }"
              @click="form.category = item.value"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
        <div class="th-field">
          <label for="th-room-name">名称</label>
          <el-input id="th-room-name" v-model="form.name" maxlength="20" placeholder="例如：期末周互助、实验总失败怎么办" />
        </div>
        <div class="th-field">
          <label for="th-room-intro">简介</label>
          <el-input id="th-room-intro" v-model="form.intro" type="textarea" :rows="2" maxlength="120" show-word-limit placeholder="同学在列表里会看到" />
        </div>
      </form>
      <p class="th-muted">你会成为这个宣泄室的管理员，之后进来的小艾绒也是管理员。</p>
      <template #footer>
        <el-button @click="createOpen = false">取消</el-button>
        <el-button type="primary" :disabled="form.name.trim().length < 2 || !form.category" :loading="submitting" @click="create">开设</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";
import { treeholeApi, type TreeholeRoomCard } from "@/api/treehole";
import { errorText } from "./shared";
import "./treehole.css";

const route = useRoute();
const router = useRouter();
const rooms = ref<TreeholeRoomCard[]>([]);
const categories = ref<Array<{ value: string; label: string }>>([]);
const rules = ref("");
const isHost = ref(false);
const loading = ref(false);
const error = ref("");
const category = ref(typeof route.query.category === "string" ? route.query.category : "");
const joinOpen = ref(false);
const joining = ref<TreeholeRoomCard | null>(null);
const agreed = ref(false);
const createOpen = ref(false);
const submitting = ref(false);
const form = reactive({ name: "", category: "", intro: "" });

const filtered = computed(() => (category.value ? rooms.value.filter((room) => room.category === category.value) : rooms.value));
const ruleLines = computed(() => rules.value.split("\n").map((line) => line.trim()).filter(Boolean));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const me = await treeholeApi.me();
    if (!me.consent.agreed) {
      router.replace("/treehole");
      return;
    }
    isHost.value = me.roles.host;
    const result = await treeholeApi.rooms();
    rooms.value = result.rooms;
    categories.value = result.categories;
    rules.value = result.rules;
    if (!form.category) form.category = result.categories[0]?.value ?? "";
    const wanted = Number(route.query.room);
    if (wanted) {
      const room = rooms.value.find((item) => item.id === wanted);
      if (room?.joined) router.replace(`/treehole/room/${room.id}`);
      else if (room && !room.removed) openJoin(room);
    }
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

function openJoin(room: TreeholeRoomCard) {
  joining.value = room;
  agreed.value = false;
  joinOpen.value = true;
}

async function join() {
  if (!joining.value || !agreed.value) return;
  submitting.value = true;
  try {
    const result = await treeholeApi.joinRoom(joining.value.id);
    joinOpen.value = false;
    ElMessage.success(`已加入，你在群里的虚拟 ID 是 ${result.alias}`);
    router.push(`/treehole/room/${joining.value.id}`);
  } finally {
    submitting.value = false;
  }
}

async function create() {
  if (form.name.trim().length < 2 || !form.category) return;
  submitting.value = true;
  try {
    const { id } = await treeholeApi.createRoom({ name: form.name.trim(), category: form.category, intro: form.intro.trim() });
    createOpen.value = false;
    router.push(`/treehole/room/${id}`);
  } finally {
    submitting.value = false;
  }
}

watch(category, (value) => router.replace({ query: value ? { category: value } : {} }));
onMounted(load);
</script>

<style scoped>
.th-room-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.th-room-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
}
.th-room-intro { flex: 1; margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.th-room-card .th-actions { margin-top: 4px; }
.th-rules-title { margin: 0 0 6px; font-size: var(--cpu-fs-m); }
.th-rules {
  margin: 0 0 12px;
  padding-left: 20px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.7;
}
.th-create-topics { margin-top: 2px; }
</style>
