<template>
  <div class="th-page th-new">
    <router-link class="th-back" to="/treehole">
      <el-icon aria-hidden="true"><ArrowLeft /></el-icon>艾绒树洞
    </router-link>
    <header class="th-head">
      <div class="th-head-copy">
        <h1>留言倾诉</h1>
        <p>写下想说的话。留言会先放进待认领，小艾绒值班时认领后回复你，回复会提醒你。</p>
      </div>
    </header>

    <section class="th-group">
      <h2 class="th-h2">和什么有关？</h2>
      <p class="th-sub">选填，最多 3 个。方便合适的小艾绒认领。</p>
      <div class="th-topic-picker" role="group" aria-label="留言标签">
        <button
          v-for="topic in TREEHOLE_TOPICS"
          :key="topic"
          type="button"
          class="th-topic"
          :class="{ 'is-on': topics.includes(topic) }"
          :aria-pressed="topics.includes(topic)"
          @click="toggle(topic)"
        >
          {{ topic }}
        </button>
      </div>
    </section>

    <section class="th-group">
      <h2 class="th-h2">想说的话</h2>
      <p class="th-sub">可以从任何地方说起，也可以配图。这条留言的虚拟 ID 会在发送后生成，结束后作废。</p>
      <div class="th-new-composer">
        <Composer :send="start" draft-key="new-session" placeholder="说说此刻的心情…" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";
import { treeholeApi, TREEHOLE_TOPICS } from "@/api/treehole";
import Composer from "./Composer.vue";
import "./treehole.css";

const router = useRouter();
const topics = ref<string[]>([]);

function toggle(topic: string) {
  if (topics.value.includes(topic)) {
    topics.value = topics.value.filter((item) => item !== topic);
    return;
  }
  if (topics.value.length >= 3) {
    ElMessage.info("最多选 3 个标签");
    return;
  }
  topics.value = [...topics.value, topic];
}

async function start(payload: { content: string; imageId: number | null }) {
  const { id } = await treeholeApi.createSession({ topics: topics.value, ...payload });
  ElMessage.success("留言已送达，小艾绒认领和回复时会提醒你");
  router.replace(`/treehole/session/${id}`);
}
</script>

<style scoped>
.th-new-composer { margin-top: 12px; }
</style>
