<template>
  <div class="post-page">
    <h2 class="page-title">{{ editingId ? '编辑帖子' : '发表新帖' }}</h2>

    <div class="cpu-card form">
      <el-form label-position="top" :model="form">
        <el-form-item label="选择板块" required>
          <el-select v-model="form.boardSlug" placeholder="选择要发帖的板块" :disabled="!!editingId" @change="onBoardChange">
            <el-option-group v-for="(group, label) in groupedBoards" :key="label" :label="label">
              <el-option
                v-for="b in group"
                :key="b.slug"
                :value="b.slug"
                :label="`${b.icon ?? ''} ${b.name}`"
                :disabled="b.readOnly"
              >
                <span style="margin-right:6px">{{ b.icon }}</span>{{ b.name }}
                <span style="float:right;color:#9ca3af;font-size:12px">{{ b.readOnly ? '只读' : '' }}</span>
              </el-option>
            </el-option-group>
          </el-select>
          <div v-if="currentBoard" class="board-hint">
            {{ currentBoard.description }}
          </div>
        </el-form-item>

        <!-- 二手板块特化 -->
        <template v-if="boardType === 'market'">
          <div class="meta-row">
            <el-form-item label="价格（元）" required>
              <el-input-number v-model="meta.price" :min="0" :max="999999" :step="10" />
            </el-form-item>
            <el-form-item label="新旧程度">
              <el-select v-model="meta.condition" placeholder="选择">
                <el-option label="全新" value="全新" />
                <el-option label="九成新" value="九成新" />
                <el-option label="八成新" value="八成新" />
                <el-option label="七成新及以下" value="七成新及以下" />
                <el-option label="求购" value="求购" />
              </el-select>
            </el-form-item>
            <el-form-item label="交易方式">
              <el-select v-model="meta.tradeMode" placeholder="选择">
                <el-option label="当面" value="当面" />
                <el-option label="包邮" value="包邮" />
                <el-option label="当面 / 包邮+5" value="当面 / 包邮+5" />
              </el-select>
            </el-form-item>
          </div>
        </template>

        <!-- 提问板块特化 -->
        <template v-if="boardType === 'question'">
          <el-form-item label="悬赏（声望）">
            <el-input-number v-model="meta.bounty" :min="0" :max="999" :step="5" />
            <span class="cpu-muted" style="margin-left:8px">采纳回答者获得声望</span>
          </el-form-item>
        </template>

        <!-- 课程点评特化 -->
        <template v-if="boardType === 'coursereview'">
          <el-form-item label="评价的课程" required>
            <el-select v-model="meta.courseId" filterable placeholder="搜课程名 / 教师">
              <el-option v-for="c in courses" :key="c.id" :value="c.id" :label="`${c.code} ${c.name} - ${c.teacher}`">
                <span>{{ c.code }} · {{ c.name }}</span>
                <span style="float:right;color:#9ca3af;font-size:12px">{{ c.teacher }}</span>
              </el-option>
            </el-select>
          </el-form-item>
          <div class="rate-row">
            <el-form-item label="难度"><el-rate v-model="meta.ratings.difficulty" /></el-form-item>
            <el-form-item label="收获"><el-rate v-model="meta.ratings.reward" /></el-form-item>
            <el-form-item label="推荐度"><el-rate v-model="meta.ratings.recommend" /></el-form-item>
            <el-form-item label="给分"><el-rate v-model="meta.ratings.givingScore" /></el-form-item>
          </div>
          <el-form-item label="学期">
            <el-input v-model="meta.semester" placeholder="例如 2024-2025-1" style="max-width:240px" />
          </el-form-item>
        </template>

        <el-form-item label="标题" required>
          <el-input v-model="form.title" placeholder="一句话描述要点（2-120 字）" maxlength="120" show-word-limit />
        </el-form-item>

        <el-form-item label="正文（支持 Markdown）" required>
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="14"
            placeholder="支持 **加粗**、*斜体*、`代码`、# 标题、- 列表、[链接](url)、行首 > 引用、表格…"
            maxlength="20000"
            show-word-limit
          />
        </el-form-item>

        <el-form-item v-if="form.content">
          <div class="preview">
            <h4>预览</h4>
            <MarkdownView :content="form.content" />
          </div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="submitting" @click="submit">{{ editingId ? '保存修改' : '发布帖子' }}</el-button>
          <el-button @click="$router.back()">取消</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import MarkdownView from "@/components/forum/MarkdownView.vue";
import { boardApi, type Board } from "@/api/board";
import { topicApi } from "@/api/topic";
import { courseApi, type Course } from "@/api/course";

const route = useRoute();
const router = useRouter();

const boards = ref<Board[]>([]);
const courses = ref<Course[]>([]);
const submitting = ref(false);
const editingId = computed(() => (route.params.id ? Number(route.params.id) : null));

const form = reactive({
  boardSlug: (route.query.board as string) || "",
  title: "",
  content: "",
});

const meta = reactive<any>({
  price: 0,
  condition: "九成新",
  tradeMode: "当面",
  bounty: 0,
  courseId: undefined,
  ratings: { difficulty: 3, reward: 3, recommend: 3, givingScore: 3 },
  semester: "",
});

const currentBoard = computed(() => boards.value.find((b) => b.slug === form.boardSlug));
const boardType = computed(() => currentBoard.value?.type ?? "normal");

const groupedBoards = computed(() => {
  const groups: Record<string, Board[]> = { "💬 综合讨论": [], "🎒 UGC": [], "📢 公告（只读）": [] };
  for (const b of boards.value) {
    if (b.type === "announce") groups["📢 公告（只读）"].push(b);
    else if (["market", "question", "coursereview"].includes(b.type)) groups["🎒 UGC"].push(b);
    else groups["💬 综合讨论"].push(b);
  }
  return groups;
});

onMounted(async () => {
  boards.value = await boardApi.list();
  courses.value = await courseApi.list();
  if (editingId.value) {
    const t = await topicApi.detail(editingId.value);
    form.boardSlug = t.board?.slug ?? "";
    form.title = t.title;
    form.content = t.content;
    if (t.metadata) Object.assign(meta, t.metadata);
  }
});

watch(boardType, () => {
  if (boardType.value === "coursereview" && !courses.value.length) {
    courseApi.list().then((r) => (courses.value = r));
  }
});

function onBoardChange() { /* 切换时不重置 meta，让用户自由 */ }

async function submit() {
  if (!form.boardSlug) { ElMessage.warning("请选择板块"); return; }
  if (form.title.trim().length < 2) { ElMessage.warning("标题至少 2 字"); return; }
  if (form.content.trim().length < 1) { ElMessage.warning("请填写正文"); return; }

  // 组织 metadata
  const metadata: any = {};
  if (boardType.value === "market") {
    if (!meta.price && meta.price !== 0) { ElMessage.warning("请填写价格"); return; }
    metadata.price = meta.price;
    metadata.condition = meta.condition;
    metadata.tradeMode = meta.tradeMode;
  } else if (boardType.value === "question") {
    metadata.bounty = meta.bounty;
    metadata.resolved = false;
  } else if (boardType.value === "coursereview") {
    if (!meta.courseId) { ElMessage.warning("请选择课程"); return; }
    metadata.courseId = meta.courseId;
    metadata.ratings = meta.ratings;
    if (meta.semester) metadata.semester = meta.semester;
  }

  submitting.value = true;
  try {
    if (editingId.value) {
      await topicApi.update(editingId.value, {
        title: form.title,
        content: form.content,
        metadata,
      });
      ElMessage.success("已保存");
      router.replace(`/forum/topic/${editingId.value}`);
    } else {
      const r = await topicApi.create({
        boardSlug: form.boardSlug,
        title: form.title,
        content: form.content,
        metadata,
      });
      ElMessage.success("已发布");
      router.replace(`/forum/topic/${r.id}`);
    }
  } finally { submitting.value = false; }
}
</script>

<style scoped>
.post-page { display: flex; flex-direction: column; gap: 16px; }
.page-title { margin: 0; font-size: 22px; }
.cpu-card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

.board-hint { font-size: 12px; color: #6b7280; margin-top: 6px; }
.meta-row { display: flex; gap: 14px; flex-wrap: wrap; }
.meta-row .el-form-item { min-width: 200px; flex: 1; }

.rate-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
@media (max-width: 700px) { .rate-row { grid-template-columns: 1fr 1fr; } }

.preview {
  background: #f9fafb;
  padding: 16px 18px;
  border-radius: 8px;
  border-left: 3px solid var(--cpu-primary);
  width: 100%;
}
.preview h4 { margin: 0 0 8px; color: #6b7280; font-size: 12px; font-weight: 500; }
.cpu-muted { font-size: 12px; color: #9ca3af; }
</style>
