<template>
  <main class="notification-redirect">
    <section>
      <span>药大拾间联动</span>
      <h1>通知功能已迁移到主站</h1>
      <p>药苑之声的排期、播放和互动通知统一由药大拾间消息中心发送，建议绑定 QQBot 获取即时通知。</p>
      <div>
        <a :href="messagesUrl">前往消息中心</a>
        <a :href="qqBotUrl">绑定 QQBot</a>
      </div>
    </section>
  </main>
</template>

<script setup>
import { cpuWebRedirectUrl } from '~/utils/cpuWebNavigation'

const messagesUrl = cpuWebRedirectUrl('messages')
const qqBotUrl = cpuWebRedirectUrl('qqbot-binding')

onMounted(() => {
  window.location.replace(qqBotUrl)
})
</script>

<style scoped>
.notification-redirect {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: #f6f8f2;
  color: #1f2a1f;
}

section {
  width: min(100%, 560px);
  padding: 2rem;
  border: 1px solid #d2deca;
  border-radius: 22px;
  background: #f8fbf6;
  box-shadow: 0 18px 45px rgba(31, 42, 31, 0.08);
}

span {
  color: #2f7d4f;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}

h1 {
  margin: 0.55rem 0;
  font-size: 1.5rem;
}

p {
  color: #5f715f;
  line-height: 1.75;
}

section div {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.4rem;
}

a {
  padding: 0.65rem 0.9rem;
  border: 1px solid #c9d8c0;
  border-radius: 10px;
  color: #2f7d4f;
  background: #fff;
  font-size: 0.85rem;
  font-weight: 700;
  text-decoration: none;
}
</style>
