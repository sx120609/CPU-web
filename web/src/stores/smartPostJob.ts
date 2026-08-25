import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  topicApi,
  type SmartPostComposePayload,
  type SmartPostJobSnapshot,
} from "@/api/topic";

type StoredSmartPostTask = {
  jobId: string;
  returnPath: string;
  userId: number;
  createdAt: string;
};

const STORAGE_KEY = "cpu-smart-post-job-v1";
const POLL_INTERVAL_MS = 1_800;
const POLL_RETRY_MS = 4_000;
const DISCOVERY_INTERVAL_MS = 10_000;

export const useSmartPostJobStore = defineStore("smart-post-job", () => {
  const task = ref<StoredSmartPostTask | null>(null);
  const status = ref<SmartPostJobSnapshot | null>(null);
  const starting = ref(false);
  const pollWarning = ref("");
  let pollTimer = 0;
  let pollGeneration = 0;
  let discoveryTimer = 0;
  let discoveryGeneration = 0;
  let currentUserId = 0;

  const active = computed(() => status.value?.state === "queued" || status.value?.state === "running");
  const terminal = computed(() => status.value?.state === "completed" || status.value?.state === "failed");

  async function begin(payload: SmartPostComposePayload, returnPath: string, userId: number) {
    if (starting.value || active.value || (task.value && !terminal.value)) {
      throw new Error("已有智慧发帖任务正在后台处理");
    }
    currentUserId = userId;
    if (terminal.value || task.value) dismiss();
    starting.value = true;
    pollWarning.value = "";
    try {
      const normalizedReturnPath = normalizeReturnPath(returnPath);
      stopDiscovery();
      const snapshot = await topicApi.startSmartCompose({ ...payload, returnPath: normalizedReturnPath });
      task.value = {
        jobId: snapshot.jobId,
        returnPath: normalizeReturnPath(snapshot.returnPath || normalizedReturnPath),
        userId,
        createdAt: snapshot.createdAt,
      };
      status.value = snapshot;
      writeStoredTask(task.value);
      schedulePoll(POLL_INTERVAL_MS);
      return snapshot;
    } finally {
      starting.value = false;
    }
  }

  function resume(userId: number) {
    currentUserId = userId;
    if (!task.value) task.value = readStoredTask();
    if (task.value?.userId !== userId) {
      clearLocalTask();
    }
    if (task.value && !terminal.value) schedulePoll(0);
    else scheduleDiscovery(0);
  }

  function dismiss() {
    const acknowledgedJobId = terminal.value ? task.value?.jobId : "";
    stopPolling();
    clearLocalTask();
    if (acknowledgedJobId) void topicApi.acknowledgeSmartCompose(acknowledgedJobId).catch(() => undefined);
    if (currentUserId) scheduleDiscovery(DISCOVERY_INTERVAL_MS);
  }

  function clearForLogout() {
    starting.value = false;
    currentUserId = 0;
    stopPolling();
    stopDiscovery();
    clearLocalTask();
  }

  function schedulePoll(delayMs: number) {
    window.clearTimeout(pollTimer);
    const generation = ++pollGeneration;
    pollTimer = window.setTimeout(() => {
      void poll(generation);
    }, delayMs);
  }

  async function poll(generation: number) {
    const currentTask = task.value;
    if (!currentTask || generation !== pollGeneration || terminal.value) return;
    try {
      const snapshot = await topicApi.smartComposeStatus(currentTask.jobId);
      if (generation !== pollGeneration || task.value?.jobId !== currentTask.jobId) return;
      status.value = snapshot;
      pollWarning.value = "";
      if (snapshot.state === "queued" || snapshot.state === "running") {
        schedulePoll(POLL_INTERVAL_MS);
      } else {
        scheduleDiscovery(DISCOVERY_INTERVAL_MS);
      }
    } catch (error) {
      if (generation !== pollGeneration || task.value?.jobId !== currentTask.jobId) return;
      const httpStatus = Number((error as { response?: { status?: unknown } })?.response?.status || 0);
      if (httpStatus === 404) {
        const now = new Date().toISOString();
        status.value = {
          jobId: currentTask.jobId,
          state: "failed",
          progress: status.value?.progress || 0,
          message: "任务状态已失效",
          createdAt: currentTask.createdAt,
          updatedAt: now,
          completedAt: now,
          result: null,
          error: "任务不存在或已过期，可能是服务重启导致。上传文件未被保存，请返回发帖页重新提交。",
          returnPath: currentTask.returnPath,
        };
        pollWarning.value = "";
        return;
      }
      if (httpStatus === 401) return;
      pollWarning.value = "暂时无法刷新进度，后台任务仍会继续处理";
      schedulePoll(POLL_RETRY_MS);
    }
  }

  function stopPolling() {
    pollGeneration += 1;
    window.clearTimeout(pollTimer);
    pollTimer = 0;
  }

  function scheduleDiscovery(delayMs: number) {
    window.clearTimeout(discoveryTimer);
    const generation = ++discoveryGeneration;
    discoveryTimer = window.setTimeout(() => {
      void discover(generation);
    }, delayMs);
  }

  async function discover(generation: number) {
    const userId = currentUserId;
    if (!userId || generation !== discoveryGeneration || (task.value && !terminal.value)) return;
    try {
      const snapshot = await topicApi.currentSmartCompose();
      if (generation !== discoveryGeneration || currentUserId !== userId || (task.value && !terminal.value)) return;
      if (snapshot && snapshot.jobId !== task.value?.jobId) {
        task.value = {
          jobId: snapshot.jobId,
          returnPath: normalizeReturnPath(snapshot.returnPath),
          userId,
          createdAt: snapshot.createdAt,
        };
        status.value = snapshot;
        pollWarning.value = "";
        writeStoredTask(task.value);
        if (snapshot.state === "queued" || snapshot.state === "running") schedulePoll(POLL_INTERVAL_MS);
        else scheduleDiscovery(DISCOVERY_INTERVAL_MS);
        return;
      }
    } catch (error) {
      const httpStatus = Number((error as { response?: { status?: unknown } })?.response?.status || 0);
      if (httpStatus === 401) return;
    }
    if (generation === discoveryGeneration && currentUserId === userId && (!task.value || terminal.value)) {
      scheduleDiscovery(DISCOVERY_INTERVAL_MS);
    }
  }

  function stopDiscovery() {
    discoveryGeneration += 1;
    window.clearTimeout(discoveryTimer);
    discoveryTimer = 0;
  }

  function clearLocalTask() {
    task.value = null;
    status.value = null;
    pollWarning.value = "";
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  return {
    task,
    status,
    starting,
    pollWarning,
    active,
    terminal,
    begin,
    resume,
    dismiss,
    clearForLogout,
  };
});

function normalizeReturnPath(value: string) {
  const path = String(value || "").trim();
  return /^\/post(?:\/\d+\/edit)?(?:[?#].*)?$/u.test(path) ? path : "/post";
}

function readStoredTask(): StoredSmartPostTask | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<StoredSmartPostTask> | null;
    const jobId = String(parsed?.jobId || "").trim();
    const userId = Number(parsed?.userId);
    if (!jobId || !Number.isSafeInteger(userId) || userId <= 0) return null;
    return {
      jobId,
      userId,
      returnPath: normalizeReturnPath(String(parsed?.returnPath || "")),
      createdAt: String(parsed?.createdAt || new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

function writeStoredTask(task: StoredSmartPostTask) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(task)); } catch { /* ignore */ }
}
