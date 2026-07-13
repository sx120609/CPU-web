<template>
  <div class="schedule-item-print">
    <div class="item-content">
      <!-- 序号 -->
      <div v-if="settings.showSequence" class="sequence-number">
        {{ schedule.sequence || 1 }}
      </div>

      <!-- 歌曲封面 -->
      <div v-if="settings.showCover" class="cover-section">
        <img
          v-if="schedule.song.cover"
          :alt="schedule.song.title"
          :src="convertToHttps(schedule.song.cover)"
          class="song-cover"
          referrerpolicy="no-referrer"
          @error="handleImageError"
        >
        <div class="cover-placeholder" :class="{ 'show': !schedule.song.cover }">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v6m0 6v6" />
            <path d="m21 12-6-3-6 3-6-3" />
          </svg>
        </div>
      </div>

      <!-- 歌曲信息 -->
      <div class="song-info">
        <div v-if="settings.showTitle" class="song-title">
          {{ schedule.song.title }}
          <!-- 重播标识 -->
          <span v-if="schedule.song.replayRequestCount > 0" class="replay-badge-print"> 重播 </span>
        </div>
        <div v-if="settings.showArtist" class="song-artist">
          {{ schedule.song.artist }}
        </div>
      </div>

      <!-- 投稿人信息（重播歌曲不显示申请人，只显示原投稿人） -->
      <div v-if="settings.showRequester" class="requester-info">
        <span class="label">投稿人：</span>
        <span class="value">
          {{ schedule.song.requester }}
          <span v-if="schedule.song.requesterGrade" class="text-zinc-400 mx-1">|</span>
          <span v-if="schedule.song.requesterGrade" class="text-zinc-500">{{ schedule.song.requesterGrade }}</span>
        </span>
      </div>

      <!-- 人数信息 -->
      <div v-if="settings.showVotes" class="votes-info">
        <span v-if="schedule.song.replayRequestCount > 0" class="label">申请重播：</span>
        <span v-else class="label">热度：</span>
        <span class="value">{{
          schedule.song.replayRequestCount > 0
            ? schedule.song.replayRequestCount + '人'
            : schedule.song.voteCount || 0
        }}</span>
      </div>

    </div>
  </div>
</template>

<script setup>
import { defineProps } from 'vue'
import { convertToHttps } from '~/utils/url'

// 定义props
defineProps({
  schedule: {
    type: Object,
    required: true
  },
  settings: {
    type: Object,
    required: true
  }
})

// 处理图片加载错误
const handleImageError = (event) => {
  event.target.style.display = 'none'
  event.target.nextElementSibling?.classList.add('show')
}
</script>

<style scoped>
.schedule-item-print {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid #d6e5d4;
  border-radius: 10px;
  background: #f7fbf6;
  margin-bottom: 8px;
  page-break-inside: avoid;
}

.item-content {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 12px;
}

.sequence-number {
  width: 30px;
  height: 30px;
  background: #eaf4e9;
  border: 1px solid #b8ceb7;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 14px;
  color: #245f3c;
  flex-shrink: 0;
}

.cover-section {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.song-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  background: #edf5ec;
  border-radius: 4px;
  display: none;
  align-items: center;
  justify-content: center;
  color: #87a088;
}

.cover-placeholder.show {
  display: flex;
}

.cover-placeholder svg {
  width: 20px;
  height: 20px;
}

.song-info {
  flex: 1;
  min-width: 0;
}

.song-title {
  font-weight: bold;
  font-size: 16px;
  color: #1f2f23;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 打印用重播标识 */
.replay-badge-print {
  display: inline-block;
  padding: 1px 4px;
  background: #fef4e8;
  border: 1px solid #e5b063;
  border-radius: 3px;
  color: #9d6512;
  font-size: 10px;
  font-weight: bold;
  flex-shrink: 0;
}

.song-artist {
  font-size: 14px;
  color: #5f725f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.requester-info,
.votes-info {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: #5f725f;
  white-space: nowrap;
}

.label {
  font-weight: 500;
  margin-right: 4px;
}

.value {
  color: #1f2f23;
}

/* 打印样式 */
@media print {
  .schedule-item-print {
    color: #1f2f23 !important;
    background: #f7fbf6 !important;
    border: 1px solid #d6e5d4 !important;
    border-radius: 10px !important;
    margin-bottom: 8px !important;
    width: 100% !important;
    max-width: none !important;
    box-sizing: border-box !important;
  }

  .item-content {
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    width: 100% !important;
    gap: 12px !important;
  }

  .sequence-number {
    background: #eaf4e9 !important;
    color: #245f3c !important;
    border: 1px solid #b8ceb7 !important;
    width: 30px !important;
    height: 30px !important;
    flex-shrink: 0 !important;
  }

  .cover-section {
    width: 40px !important;
    height: 40px !important;
    flex-shrink: 0 !important;
  }

  .song-info {
    flex: 1 !important;
    min-width: 0 !important;
  }

  .song-title {
    color: #1f2f23 !important;
    font-size: 16px !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }

  .song-artist,
  .label,
  .value {
    color: #2f3f32 !important;
  }

  .time-range {
    color: #5f725f !important;
  }

  .requester-info,
  .votes-info,
  .playtime-info {
    display: flex !important;
    align-items: center !important;
    font-size: 12px !important;
    white-space: nowrap !important;
    flex-shrink: 0 !important;
  }
}

/* 紧凑模式 */
.compact .schedule-item-print {
  padding: 4px 0;
}

.compact .item-content {
  gap: 8px;
}

.compact .sequence-number {
  width: 24px;
  height: 24px;
  font-size: 12px;
}

.compact .cover-section {
  width: 32px;
  height: 32px;
}

.compact .song-title {
  font-size: 14px;
}

.compact .song-artist {
  font-size: 12px;
}

.compact .requester-info,
.compact .votes-info,
.compact .playtime-info {
  font-size: 11px;
}
</style>
