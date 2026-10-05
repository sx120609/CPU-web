<template>
  <div class="fs-workspace">
    <WorkspaceMobile v-if="isMobileLayout" />
    <WorkspaceDesktop v-else />
    <TaskEditor />
    <FileManagerDialog />
    <QrDialog />
    <BusyDialog />
  </div>
</template>

<script setup lang="ts">
import { computed, provide } from "vue";
import { useMobileLayout } from "@/utils/mobileLayout";
import BusyDialog from "./components/BusyDialog.vue";
import FileManagerDialog from "./components/FileManagerDialog.vue";
import QrDialog from "./components/QrDialog.vue";
import TaskEditor from "./components/TaskEditor.vue";
import WorkspaceDesktop from "./WorkspaceDesktop.vue";
import WorkspaceMobile from "./WorkspaceMobile.vue";
import { filestoreWorkspaceKey, useFilestoreWorkspace } from "./workspace";

const isMobileLayout = useMobileLayout();
// 工作台状态放在这一层，切换桌面 / 移动布局时不会丢失选中的任务、搜索和编辑中的草稿。
provide(filestoreWorkspaceKey, useFilestoreWorkspace({ autoSelectFirst: computed(() => !isMobileLayout.value) }));
</script>
