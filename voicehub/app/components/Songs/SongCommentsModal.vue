<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition ease-out duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition ease-in duration-150"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="show"
        class="comments-overlay"
        @click="handleOverlayClose"
      >
        <div class="comments-modal" @click.stop>
          <div class="comments-header">
            <div class="comments-title-wrap">
              <h3 class="comments-title">歌曲评论</h3>
              <p v-if="song" class="comments-subtitle">《{{ song.title }} - {{ song.artist }}》</p>
            </div>
            <button class="comments-close" @click="$emit('close')">
              <Icon name="close" :size="18" />
            </button>
          </div>

          <div class="comments-body">
            <div v-if="loading" class="comments-state">加载评论中...</div>
            <div v-else-if="error" class="comments-state comments-error">
              <p>{{ error }}</p>
              <button class="retry-btn" @click="$emit('refresh')">重试</button>
            </div>
            <div v-else-if="comments.length === 0" class="comments-state comments-empty">
              暂无评论，来发表第一条评论吧
            </div>
            <ul v-else class="comments-list">
              <li v-for="comment in comments" :key="comment.id" class="comment-item">
                <div class="comment-meta">
                  <span class="comment-user">{{ comment.userDisplayName || '匿名用户' }}</span>
                  <span class="comment-time">{{ formatTime(comment.createdAt) }}</span>
                </div>
                <p class="comment-content">{{ comment.content }}</p>
                <div class="comment-actions-row">
                  <template v-if="canDelete(comment)">
                    <template v-if="pendingDeleteCommentId === comment.id">
                      <button
                        :disabled="deleting"
                        class="delete-confirm-btn"
                        @click="confirmDelete(comment)"
                      >
                        {{ deleting ? '删除中...' : '确认删除' }}
                      </button>
                      <button
                        :disabled="deleting"
                        class="delete-cancel-btn"
                        @click="cancelDelete"
                      >
                        取消
                      </button>
                    </template>
                    <button
                      v-else
                      :disabled="deleting"
                      class="delete-btn"
                      @click="requestDelete(comment)"
                    >
                      删除
                    </button>
                  </template>
                  <button
                    v-if="isAuthenticated"
                    class="reply-btn"
                    @click="startReply(comment)"
                  >
                    回复
                  </button>
                </div>

                <ul v-if="comment.replies && comment.replies.length > 0" class="replies-list">
                  <li v-for="reply in comment.replies" :key="reply.id" class="reply-item">
                    <div class="comment-meta">
                      <span class="comment-user">{{ reply.userDisplayName || '匿名用户' }}</span>
                      <span class="comment-time">{{ formatTime(reply.createdAt) }}</span>
                    </div>
                    <p class="comment-content">
                      <span
                        v-if="reply.replyToUserDisplayName"
                        class="reply-target-user"
                      >
                        回复 {{ reply.replyToUserDisplayName }}：
                      </span>
                      {{ reply.content }}
                    </p>
                    <div class="comment-actions-row">
                      <template v-if="canDelete(reply)">
                        <template v-if="pendingDeleteCommentId === reply.id">
                          <button
                            :disabled="deleting"
                            class="delete-confirm-btn"
                            @click="confirmDelete(reply)"
                          >
                            {{ deleting ? '删除中...' : '确认删除' }}
                          </button>
                          <button
                            :disabled="deleting"
                            class="delete-cancel-btn"
                            @click="cancelDelete"
                          >
                            取消
                          </button>
                        </template>
                        <button
                          v-else
                          :disabled="deleting"
                          class="delete-btn"
                          @click="requestDelete(reply)"
                        >
                          删除
                        </button>
                      </template>
                      <button
                        v-if="isAuthenticated"
                        class="reply-btn"
                        @click="startReply(comment)"
                      >
                        回复
                      </button>
                    </div>
                  </li>
                </ul>
              </li>
            </ul>
          </div>

          <div class="comments-footer">
            <div v-if="replyTarget" class="reply-target-banner">
              <span>正在回复 {{ replyTarget.userDisplayName || '匿名用户' }}</span>
              <button class="reply-cancel-btn" @click="clearReplyTarget">取消</button>
            </div>

            <textarea
              ref="commentInputRef"
              v-model="draftComment"
              :disabled="submitting"
              :maxlength="300"
              class="comment-input"
              :placeholder="inputPlaceholder"
            />
            <div class="comment-actions">
              <span v-if="!isAuthenticated" class="comment-tip">请先登录后再评论</span>
              <span v-else class="comment-tip">{{ draftComment.length }}/300</span>
              <button
                :disabled="submitDisabled"
                class="submit-btn"
                @click="handleSubmit"
              >
                {{ submitting ? '提交中...' : submitButtonText }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import Icon from '~/components/UI/Icon.vue'
import { useBodyScrollLock } from '~/composables/useBodyScrollLock'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  song: {
    type: Object,
    default: null
  },
  comments: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: ''
  },
  submitting: {
    type: Boolean,
    default: false
  },
  deleting: {
    type: Boolean,
    default: false
  },
  isAuthenticated: {
    type: Boolean,
    default: false
  },
  currentUserId: {
    type: Number,
    default: null
  },
  isAdminUser: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'submit', 'delete', 'refresh'])

const draftComment = ref('')
const replyTarget = ref(null)
const commentInputRef = ref(null)
const pendingDeleteCommentId = ref(null)
const { lock, unlock } = useBodyScrollLock()

watch(
  () => props.show,
  (show, previousShow) => {
    if (show) {
      lock()
    } else if (previousShow) {
      unlock()
    }

    if (!show) {
      draftComment.value = ''
      replyTarget.value = null
      pendingDeleteCommentId.value = null
    }
  }
)

onUnmounted(() => {
  if (props.show) {
    unlock()
  }
})

const submitDisabled = computed(() => {
  return !props.isAuthenticated || props.submitting || !draftComment.value.trim()
})

const inputPlaceholder = computed(() => {
  if (!replyTarget.value) {
    return '写下你的评论（最多300字）'
  }
  return `回复 ${replyTarget.value.userDisplayName || '该用户'}（最多300字）`
})

const submitButtonText = computed(() => {
  return replyTarget.value ? '发表回复' : '发表评论'
})

const handleOverlayClose = () => {
  emit('close')
}

const clearReplyTarget = () => {
  replyTarget.value = null
}

const requestDelete = (comment) => {
  if (!comment || props.deleting) return
  pendingDeleteCommentId.value = comment.id
}

const cancelDelete = () => {
  if (props.deleting) return
  pendingDeleteCommentId.value = null
}

const canDelete = (comment) => {
  if (!props.isAuthenticated || !comment) return false
  if (props.isAdminUser) return true
  return Number(comment.userId) === Number(props.currentUserId)
}

const startReply = async (comment) => {
  if (!props.isAuthenticated) {
    return
  }

  replyTarget.value = comment
  await nextTick()
  if (commentInputRef.value && typeof commentInputRef.value.focus === 'function') {
    commentInputRef.value.focus()
  }
}

const handleSubmit = () => {
  const content = draftComment.value.trim()
  if (!content || submitDisabled.value) {
    return
  }

  emit('submit', {
    content,
    parentCommentId: replyTarget.value?.id || null
  })

  draftComment.value = ''
  replyTarget.value = null
}

const confirmDelete = (comment) => {
  if (!comment || props.deleting) return
  pendingDeleteCommentId.value = null
  emit('delete', comment)
}

const formatTime = (time) => {
  if (!time) return ''
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<style scoped>
.comments-overlay {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(31, 42, 31, 0.25);
  backdrop-filter: blur(4px);
}

.comments-modal {
  width: min(720px, 100%);
  max-height: min(82vh, 760px);
  display: flex;
  flex-direction: column;
  background: #f8fbf6;
  border: 1px solid #d2deca;
  border-radius: 16px;
  box-shadow: 0 18px 48px rgba(31, 42, 31, 0.18);
  overflow: hidden;
}

.comments-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  background: #f2f7ee;
  border-bottom: 1px solid #d2deca;
}

.comments-title {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  color: #1f2a1f;
}

.comments-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #5f715f;
}

.comments-close {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid #d2deca;
  color: #4c5f4c;
  background: #f8fbf6;
  cursor: pointer;
}

.comments-body {
  min-height: 220px;
  max-height: 44vh;
  overflow-y: auto;
  padding: 14px 16px;
}

.comments-state {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #5f715f;
}

.comments-error {
  color: #a04040;
}

.retry-btn {
  border: 1px solid #2f7d4f;
  background: #2f7d4f;
  color: #ffffff;
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
}

.comments-empty {
  color: #6f816f;
}

.comments-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.comment-item {
  border: 1px solid #d7e4cf;
  background: #f5faf1;
  border-radius: 12px;
  padding: 10px 12px;
}

.comment-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.comment-user {
  color: #1f2a1f;
  font-size: 13px;
  font-weight: 700;
}

.comment-time {
  color: #6f816f;
  font-size: 12px;
}

.comment-content {
  margin: 0;
  color: #2e3d2e;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.comment-actions-row {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

.reply-btn {
  height: 28px;
  border: 1px solid #b5ccb5;
  background: #f8fbf6;
  color: #2f7d4f;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.delete-btn {
  height: 28px;
  border: 1px solid #e0b7b7;
  background: #fff4f4;
  color: #b23f3f;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.delete-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.delete-confirm-btn {
  height: 28px;
  border: 1px solid #d14f4f;
  background: #d14f4f;
  color: #ffffff;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.delete-cancel-btn {
  height: 28px;
  border: 1px solid #cedbce;
  background: #f8fbf6;
  color: #617861;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.delete-confirm-btn:disabled,
.delete-cancel-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.replies-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0 0 0 12px;
  border-left: 2px solid #d7e4cf;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reply-item {
  border: 1px solid #dce8d4;
  background: #ffffff;
  border-radius: 10px;
  padding: 8px 10px;
}

.reply-target-user {
  color: #2f7d4f;
  font-weight: 600;
}

.comments-footer {
  padding: 12px 16px 16px;
  border-top: 1px solid #d2deca;
  background: #f8fbf6;
}

.reply-target-banner {
  margin-bottom: 10px;
  padding: 8px 10px;
  border: 1px solid #d2deca;
  border-radius: 10px;
  background: #f2f7ee;
  color: #355835;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.reply-cancel-btn {
  height: 24px;
  border: 1px solid #bdd4bd;
  border-radius: 8px;
  background: #f8fbf6;
  color: #527052;
  font-size: 12px;
  padding: 0 10px;
  cursor: pointer;
}

.comment-input {
  width: 100%;
  min-height: 96px;
  resize: vertical;
  border-radius: 10px;
  border: 1px solid #cfdcc7;
  background: #ffffff;
  padding: 10px 12px;
  color: #1f2a1f;
  font-size: 14px;
  line-height: 1.5;
  outline: none;
}

.comment-input:focus {
  border-color: #2f7d4f;
  box-shadow: 0 0 0 2px rgba(47, 125, 79, 0.12);
}

.comment-actions {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.comment-tip {
  font-size: 12px;
  color: #6f816f;
}

.submit-btn {
  border: 1px solid #2f7d4f;
  background: #2f7d4f;
  color: #ffffff;
  border-radius: 10px;
  height: 36px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .comments-modal {
    width: 100%;
    max-height: 86vh;
  }

  .comments-title {
    font-size: 18px;
  }

  .comments-subtitle {
    font-size: 12px;
  }

  .comments-body {
    max-height: 46vh;
    padding: 12px;
  }

  .comments-footer {
    padding: 10px 12px 12px;
  }

  .comment-actions {
    flex-wrap: wrap;
  }

  .submit-btn {
    width: 100%;
  }
}
</style>
