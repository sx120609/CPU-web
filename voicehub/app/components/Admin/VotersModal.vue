<template>
  <Teleport to="body">
    <div v-if="show" class="modal-overlay" @click="closeModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3 class="modal-title">投票人员列表</h3>
          <button class="close-btn" @click="closeModal">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div v-if="songInfo" class="song-info">
            <div class="song-main">
              <h4 class="song-title">{{ songInfo.title }}</h4>
              <p class="song-artist">{{ songInfo.artist }}</p>
              <div class="vote-summary">
                <svg class="heart-icon" fill="currentColor" viewBox="0 0 24 24">
                  <path
                    d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                  />
                </svg>
                <span class="vote-count">{{ totalVotes }} 票</span>
              </div>
            </div>

            <div class="vote-editor">
              <label class="vote-editor-label" for="target-votes">调整投票人数</label>
              <div class="vote-editor-row">
                <input
                  id="target-votes"
                  v-model="targetVoteCountInput"
                  type="number"
                  min="0"
                  step="1"
                  class="vote-editor-input"
                  :disabled="updatingVoteCount"
                />
                <button
                  class="vote-editor-button"
                  :disabled="!canSubmitVoteCount || updatingVoteCount"
                  @click="updateVoteCount"
                >
                  {{ updatingVoteCount ? '保存中...' : '保存票数' }}
                </button>
              </div>
              <p v-if="voteEditorError" class="vote-editor-error">{{ voteEditorError }}</p>
            </div>
          </div>

          <div v-if="loading" class="loading-container">
            <div class="spinner" />
            <p>正在加载投票人员...</p>
          </div>

          <div v-else-if="error" class="error-container">
            <svg
              class="error-icon"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" x2="9" y1="9" y2="15" />
              <line x1="9" x2="15" y1="9" y2="15" />
            </svg>
            <p class="error-message">{{ error }}</p>
            <button class="retry-btn" @click="fetchVoters">重试</button>
          </div>

          <div v-else-if="voters.length > 0" class="voters-list">
            <div class="voters-header">
              <span class="voters-title">投票人员 ({{ voters.length }})</span>
            </div>
            <div class="voters-container">
              <div
                v-for="(voter, index) in voters"
                :key="`${voter.id}-${voter.votedAt}-${index}`"
                class="voter-item"
              >
                <div class="voter-info">
                  <div class="voter-avatar">
                    {{ getAvatarText(voter.name) }}
                  </div>
                  <div class="voter-details">
                    <span class="voter-name">{{ voter.name }}</span>
                    <span class="vote-time">{{ formatVoteTime(voter.votedAt) }}</span>
                  </div>
                </div>
                <div class="voter-number">#{{ index + 1 }}</div>
              </div>
            </div>
          </div>

          <div v-else class="empty-state">
            <svg
              class="empty-icon"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
              />
            </svg>
            <p>暂无投票</p>
          </div>
        </div>

        <div class="modal-footer">
          <button class="close-button" @click="closeModal">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  songId: {
    type: Number,
    default: null
  }
})

const emit = defineEmits(['close', 'updated'])

const loading = ref(false)
const error = ref('')
const songInfo = ref(null)
const voters = ref([])
const totalVotes = ref(0)
const targetVoteCountInput = ref('0')
const updatingVoteCount = ref(false)
const voteEditorError = ref('')

const parseTargetVoteCount = () => {
  const parsed = Number.parseInt(String(targetVoteCountInput.value).trim(), 10)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null
  }
  return parsed
}

const canSubmitVoteCount = computed(() => {
  const target = parseTargetVoteCount()
  return target !== null && target !== totalVotes.value
})

const closeModal = () => {
  emit('close')
}

const resetState = () => {
  songInfo.value = null
  voters.value = []
  totalVotes.value = 0
  targetVoteCountInput.value = '0'
  error.value = ''
  voteEditorError.value = ''
  loading.value = false
  updatingVoteCount.value = false
}

const fetchVoters = async () => {
  if (!props.songId) return

  loading.value = true
  error.value = ''

  try {
    const response = await $fetch(`/api/songs/${props.songId}/voters`)
    songInfo.value = response.song
    voters.value = response.voters || []
    totalVotes.value = response.totalVotes || 0
    targetVoteCountInput.value = String(totalVotes.value)
  } catch (err) {
    console.error('获取投票人员失败:', err)
    error.value = err?.data?.message || '获取投票人员失败'
  } finally {
    loading.value = false
  }
}

const updateVoteCount = async () => {
  if (!props.songId) return

  const targetCount = parseTargetVoteCount()
  if (targetCount === null) {
    voteEditorError.value = '请输入有效的非负整数票数'
    return
  }

  voteEditorError.value = ''
  updatingVoteCount.value = true

  try {
    const response = await $fetch(`/api/admin/songs/${props.songId}/vote-count`, {
      method: 'POST',
      body: { targetCount }
    })

    const latestCount = Number(response?.data?.totalVotes)
    totalVotes.value = Number.isInteger(latestCount) && latestCount >= 0 ? latestCount : targetCount
    targetVoteCountInput.value = String(totalVotes.value)

    await fetchVoters()

    emit('updated', {
      songId: props.songId,
      totalVotes: totalVotes.value
    })
  } catch (err) {
    console.error('更新投票人数失败:', err)
    voteEditorError.value = err?.data?.message || '更新投票人数失败'
  } finally {
    updatingVoteCount.value = false
  }
}

const getAvatarText = (name) => {
  if (!name) return '?'
  const cleanName = name.replace(/[（(].*[）)]/, '').trim()
  return cleanName.slice(-1).toUpperCase()
}

const formatVoteTime = (dateString) => {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now - date

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`

  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

watch(
  () => props.show,
  (newShow) => {
    if (newShow && props.songId) {
      void fetchVoters()
      return
    }

    if (!newShow) {
      resetState()
    }
  }
)

watch(
  () => props.songId,
  (newSongId, oldSongId) => {
    if (props.show && newSongId && newSongId !== oldSongId) {
      void fetchVoters()
    }
  }
)
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(23, 31, 31, 0.38);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
  padding: 20px;
}

.modal-content {
  background: #f5f8f4;
  border-radius: 16px;
  border: 1px solid #d7e2d3;
  width: 100%;
  max-width: 560px;
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 52px rgba(36, 48, 41, 0.22);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 24px 0;
}

.modal-title {
  font-size: 20px;
  font-weight: 700;
  color: #1f2a22;
  margin: 0;
}

.close-btn {
  background: transparent;
  border: none;
  color: #5e6d61;
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: #e4ece2;
  color: #2a3a30;
}

.close-btn svg {
  width: 20px;
  height: 20px;
}

.modal-body {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.song-info {
  background: #ebf2e9;
  border-radius: 12px;
  padding: 18px;
  margin-bottom: 20px;
  border: 1px solid #d4dfd0;
}

.song-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.song-title {
  font-size: 18px;
  font-weight: 700;
  color: #26352b;
  margin: 0;
}

.song-artist {
  color: #617268;
  margin: 0;
  font-size: 14px;
}

.vote-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.heart-icon {
  width: 18px;
  height: 18px;
  color: #dc4d5a;
}

.vote-count {
  color: #bf3244;
  font-weight: 700;
  font-size: 15px;
}

.vote-editor {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #cdd8ca;
}

.vote-editor-label {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: #4b5e53;
  margin-bottom: 8px;
}

.vote-editor-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.vote-editor-input {
  width: 120px;
  border: 1px solid #bdccba;
  border-radius: 8px;
  padding: 8px 10px;
  background: #ffffff;
  color: #1f2a22;
  font-size: 14px;
}

.vote-editor-input:focus {
  outline: none;
  border-color: #4f8b61;
  box-shadow: 0 0 0 2px rgba(79, 139, 97, 0.16);
}

.vote-editor-button {
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  background: #3e8a57;
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.vote-editor-button:hover:not(:disabled) {
  background: #35764a;
}

.vote-editor-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.vote-editor-error {
  margin-top: 8px;
  margin-bottom: 0;
  color: #ba2f3f;
  font-size: 12px;
}

.loading-container,
.error-container,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  gap: 12px;
  color: #5d6f63;
}

.spinner {
  width: 30px;
  height: 30px;
  border: 3px solid #d4e0d1;
  border-top: 3px solid #4f8b61;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.error-icon {
  width: 44px;
  height: 44px;
  color: #c1494f;
}

.error-message {
  color: #c1494f;
  text-align: center;
  margin: 0;
}

.retry-btn {
  background: #3e8a57;
  color: #ffffff;
  border: none;
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}

.retry-btn:hover {
  background: #35764a;
}

.voters-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.voters-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid #d4dfd0;
}

.voters-title {
  font-weight: 700;
  color: #2a3a30;
  font-size: 15px;
}

.voters-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 300px;
  overflow-y: auto;
}

.voter-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 14px;
  background: #eef4ec;
  border-radius: 10px;
  border: 1px solid #d5e0d2;
  transition: all 0.2s ease;
}

.voter-item:hover {
  background: #e5eee2;
  border-color: #c7d6c2;
}

.voter-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.voter-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, #7cae89, #4f8b61);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-weight: 700;
  font-size: 13px;
}

.voter-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.voter-name {
  color: #25362b;
  font-weight: 600;
  font-size: 14px;
}

.vote-time,
.voter-number,
.empty-state p {
  color: #678071;
  font-size: 12px;
  margin: 0;
}

.empty-icon {
  width: 44px;
  height: 44px;
  color: #95aa9a;
}

.modal-footer {
  padding: 0 24px 24px;
  display: flex;
  justify-content: flex-end;
}

.close-button {
  background: #deeadb;
  color: #2f4035;
  border: 1px solid #c6d6c2;
  padding: 10px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}

.close-button:hover {
  background: #d4e2d1;
}

.voters-container::-webkit-scrollbar {
  width: 6px;
}

.voters-container::-webkit-scrollbar-track {
  background: #e4ece2;
  border-radius: 3px;
}

.voters-container::-webkit-scrollbar-thumb {
  background: #b6c9b6;
  border-radius: 3px;
}

.voters-container::-webkit-scrollbar-thumb:hover {
  background: #9fb69f;
}

@media (max-width: 768px) {
  .modal-overlay {
    padding: 10px;
  }

  .modal-content {
    max-height: 90vh;
  }

  .modal-header,
  .modal-body,
  .modal-footer {
    padding-left: 16px;
    padding-right: 16px;
  }

  .vote-editor-row {
    flex-direction: column;
    align-items: stretch;
  }

  .vote-editor-input {
    width: 100%;
  }
}
</style>
