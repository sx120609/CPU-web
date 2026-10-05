<template>
  <a
    v-if="card.downloadUrl"
    :data-cpu-button="variant === 'primary' ? 'primary' : 'action'"
    class="dl-action"
    :class="`dl-action--${variant}`"
    :href="card.downloadUrl"
    :target="downloadTarget"
    rel="noopener noreferrer"
    @click="emit('download', card.key, $event)"
  >
    {{ card.actionLabel }}<AppIcon name="download" />
  </a>
  <router-link
    v-else-if="card.route"
    :data-cpu-button="variant === 'primary' ? 'primary' : 'action'"
    class="dl-action"
    :class="`dl-action--${variant}`"
    :to="card.route"
  >
    {{ card.actionLabel }}<AppIcon name="arrow-right" />
  </router-link>
  <button v-else data-cpu-button="action" type="button" class="dl-action" disabled>
    {{ card.loading ? "正在获取下载信息" : "安装包暂时不可用" }}
  </button>
</template>

<script setup lang="ts">
import AppIcon from "@/components/common/AppIcon.vue";
import { isIosNativeApp } from "@/utils/clientInfo";
import type { DownloadPlatform, PlatformCard } from "./types";

withDefaults(defineProps<{ card: PlatformCard; variant?: "primary" | "plain" }>(), { variant: "plain" });
const emit = defineEmits<{ download: [platform: DownloadPlatform, event: MouseEvent] }>();
// iOS routes same-site popups through the Vue router. Use a real navigation so
// download APIs reach the server and their redirects open the system browser.
const downloadTarget = isIosNativeApp() ? "_self" : "_blank";
</script>
