import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Monitor, Moon, Sunny } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { useAppearanceStore, type AppearanceMode } from "@/stores/appearance";
import { authApi, type WechatProfile } from "@/api/auth";
import { boardApi, type Board } from "@/api/board";
import { navigateToEpayCheckout, paymentsApi, type PayType, type SponsorCategory, type SponsorOptions } from "@/api/payments";
import { request } from "@/api/request";
import { searchApi, type CampusAssistantQuota } from "@/api/search";
import { fmtDate } from "@/utils/format";
import { compressImageFile, normalizeImageUploadError } from "@/utils/imageUpload";
import { preloadAvatar } from "@/utils/avatarPreview";
import { withMediaRevision } from "@/utils/cdnMedia";
import { readViewCache, writeViewCache } from "@/utils/viewCache";
import { hidesNativeCommerce, shouldHideHarmonyAssistant } from "@/utils/clientInfo";

interface ProfileViewCache {
  topics: any[];
  boards: Board[];
  sponsorOptions: SponsorOptions;
}

export const vipThemeOptions = [
  { value: "mint", label: "薄荷青" },
  { value: "sunset", label: "落日橙" },
  { value: "ocean", label: "深海蓝" },
  { value: "lavender", label: "薰衣草" },
] as const;

export const vipFrameOptions = [
  { value: "gold", label: "鎏金" },
  { value: "neon", label: "霓虹" },
  { value: "campus", label: "校园" },
] as const;

export const payTypeLabels: Record<PayType, string> = {
  alipay: "支付宝",
  wxpay: "微信支付",
  qqpay: "QQ 钱包",
  bank: "网银",
  jdpay: "京东支付",
};

export const sponsorDisplayOptions = [
  { value: "public", label: "公开鸣谢" },
  { value: "anonymous", label: "匿名鸣谢" },
  { value: "hidden", label: "不展示" },
] as const;

export const appearanceOptions: Array<{ value: AppearanceMode; label: string; icon: unknown }> = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sunny },
  { value: "dark", label: "深色", icon: Moon },
];

export function formatMoney(value: number | string | undefined | null) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

export function topicReviewLabel(topic: any) {
  if (!topic?.hidden) return "";
  const status = String(topic.aiReviewStatus || "");
  if (status === "checking") return "审核中 · 仅自己可见";
  if (status === "review_failed") return "审核暂未完成";
  if (["manual_requested", "manual_reviewing"].includes(status)) {
    return /自动重试|每 30 分钟|自动转入人工/u.test(String(topic.aiReviewReason || "")) ? "AI 异常 · 已转人工" : "人工复核中";
  }
  if (status === "blocked_ai") return "暂未通过审核";
  if (status === "rejected_manual") return "人工复核未通过";
  return "仅自己可见";
}

function normalizeProfileLoadError(error: unknown, fallback = "个人中心加载失败，请稍后重试") {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status === 401) return "登录状态已失效，请重新登录";
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
  }
  return fallback;
}

// 桌面端与移动端个人中心共用的数据、表单与操作；两套页面只负责各自的排版。
export function useProfilePage() {
  const commerceHidden = hidesNativeCommerce();
  const auth = useAuthStore();
  const site = useSiteStore();
  const appearance = useAppearanceStore();
  const route = useRoute();
  const router = useRouter();
  const user = computed(() => auth.user);
  const assistantHiddenForClient = computed(() => shouldHideHarmonyAssistant(auth.isLoggedIn, auth.user?.username));
  const assistantEntryVisible = computed(() => site.features.assistantEntry && !assistantHiddenForClient.value);
  const myTopics = ref<any[]>([]);
  const boards = ref<Board[]>([]);
  const editing = ref(false);
  const saving = ref(false);
  const logoutBusy = ref(false);
  const avatarSaving = ref(false);
  const avatarPreviewFailed = ref(false);
  const avatarPreviewRevision = ref(0);
  const avatarDisplayUrl = computed(() => user.value?.avatar && avatarPreviewRevision.value
    ? withMediaRevision(user.value.avatar, avatarPreviewRevision.value)
    : user.value?.avatar);
  const vipStyleSaving = ref(false);
  const avatarInputRef = ref<HTMLInputElement | null>(null);
  const trustDetailsOpen = ref(false);
  const anonymousBoardsOpen = ref(false);
  const sponsorSubmitting = ref(false);
  const sponsorAmount = ref("10");
  const sponsorPayType = ref<PayType>("alipay");
  const sponsorCategoryId = ref("");
  const sponsorMessage = ref("");
  const sponsorDisplayMode = ref<"public" | "anonymous" | "hidden">("public");
  const sponsorConfirmOpen = ref(false);
  const sponsorOrders = ref<any[]>([]);
  const profileLoading = ref(false);
  const profileLoadError = ref("");
  const profileSnapshotReady = ref(false);
  const assistantQuota = ref<CampusAssistantQuota | null>(null);
  const assistantQuotaLoading = ref(false);
  const assistantQuotaError = ref("");
  const wechatProfile = ref<WechatProfile | null>(null);
  const wechatProfileLoading = ref(false);
  const wechatProfileError = ref("");
  const sponsorOptionsCached = ref(false);
  const sponsorOptions = reactive<SponsorOptions>({
    enabled: false,
    payTypes: [],
    amounts: [5, 10, 20, 50],
    minAmount: "1.00",
    maxAmount: "9999.00",
    title: "赞助本站",
    description: "赞助会通过易支付完成，成功后金额会展示在你的个人资料里。",
    wallEnabled: true,
    allowMessage: true,
    assistantPointsPerYuan: 1,
    categories: [],
  });
  let profileLoadSeq = 0;
  let handledSponsorReturnKey = "";
  let sponsorReturnInFlightKey = "";

  const editForm = reactive({ nickname: "", bio: "", college: "", enrollYear: undefined as any });
  const passwordDialog = ref(false);
  const savingPw = ref(false);
  const pwForm = reactive({ oldPassword: "", newPassword: "", confirm: "" });
  const anonymousBoards = computed(() => boards.value.filter((board) => board.anonymousEnabled));
  const profileCacheKey = computed(() => user.value?.id ? `cpu-profile-view-v1:user-${user.value.id}` : "");
  const sponsorVisible = computed(() => !commerceHidden && (site.features.sponsor || (user.value?.sponsorAmount ?? 0) > 0));
  const anonymousStatusText = computed(() => {
    const state = user.value?.anonymousState;
    if (!state) return "—";
    if (state.frozen) return "已冻结";
    if (!state.eligible) return `未达门槛（${state.minReputation}）`;
    return "可用";
  });
  const anonymousResetText = computed(() => {
    const nextResetAt = user.value?.anonymousState?.nextResetAt;
    return nextResetAt ? fmtDate(nextResetAt, "MM-DD HH:mm") : "—";
  });
  const enabledPayTypes = computed(() => sponsorOptions.payTypes.map((value) => ({ value, label: payTypeLabels[value] })));
  const selectedSponsorCategory = computed<SponsorCategory | undefined>(() => (
    sponsorOptions.categories.find((category) => category.id === sponsorCategoryId.value)
  ));
  const profileThemeClass = computed(() => user.value?.profileTheme ? `profile-theme-${user.value.profileTheme}` : "");
  const profileFrameClass = computed(() => user.value?.profileFrame ? `profile-frame-${user.value.profileFrame}` : "");
  const nicknameReviewText = computed(() => {
    const review = user.value?.nicknameReview;
    if (!review || review.status === "none") return "";
    if (["checking", "manual_pending"].includes(review.status)) return `昵称“${review.pendingNickname || ""}”正在后台审核，当前昵称暂不改变。`;
    if (review.status === "rejected") return `昵称“${review.pendingNickname || ""}”未通过审核：${review.reason || "请换一个昵称后重试"}`;
    if (review.status === "review_failed") return review.reason || "昵称审核暂未完成，请重新提交。";
    return "";
  });
  const wechatBindingStateText = computed(() => {
    if (wechatProfileLoading.value && !wechatProfile.value) return "正在查询绑定状态";
    if (wechatProfileError.value && !wechatProfile.value) return "绑定状态暂不可用";
    if (!wechatProfile.value?.binding) return "尚未绑定";
    return wechatProfile.value.binding.subscribed ? "已关注并绑定" : "已绑定，当前未关注";
  });

  watch(passwordDialog, (v) => {
    if (!v) { pwForm.oldPassword = ""; pwForm.newPassword = ""; pwForm.confirm = ""; }
  });

  onMounted(() => {
    void loadProfilePage();
  });

  watch(() => [route.query.sponsor, route.query.outTradeNo], () => {
    void handleSponsorReturnFromQuery();
  });

  watch(() => route.query.sponsorCategory, () => {
    selectDefaultSponsorCategory();
  });

  watch(editing, (v) => {
    if (v && user.value) {
      editForm.nickname = user.value.nicknameReview?.pendingNickname || user.value.nickname;
      editForm.bio = user.value.bio || "";
      editForm.college = user.value.college || "";
      editForm.enrollYear = user.value.enrollYear ?? undefined;
    }
  });

  async function loadProfilePage() {
    const seq = ++profileLoadSeq;
    profileLoading.value = !auth.user;
    profileLoadError.value = "";
    let restoredFromCache = false;
    try {
      if (!auth.user) await auth.fetchMe();
      if (seq !== profileLoadSeq) return;
      if (!auth.user) {
        profileLoadError.value = "登录状态已失效，请重新登录";
        profileSnapshotReady.value = true;
        return;
      }
      if (!assistantHiddenForClient.value) void loadAssistantQuota();
      void loadWechatBinding({ silent: true });
      restoredFromCache = restoreProfileCache();
      if (!site.loaded) await site.fetch();
      if (seq !== profileLoadSeq) return;
      await handleSponsorReturnFromQuery();

      const [topicResult, boardResult] = await Promise.allSettled([
        auth.forumHidden ? Promise.resolve([]) : request.get<any[]>(`/user/${auth.user.id}/topics`, undefined, { suppressErrorMessage: true }),
        auth.forumHidden ? Promise.resolve([]) : boardApi.list({ suppressErrorMessage: true }),
      ]);
      if (seq !== profileLoadSeq) return;
      if (topicResult.status === "fulfilled") myTopics.value = topicResult.value;
      if (boardResult.status === "fulfilled") boards.value = boardResult.value;
      profileSnapshotReady.value = true;
      if (!restoredFromCache && (topicResult.status === "rejected" || boardResult.status === "rejected")) {
        profileLoadError.value = "部分个人资料加载失败，已显示可用内容";
      }

      await Promise.all([
        (site.features.sponsor || (user.value?.sponsorAmount ?? 0) > 0) ? loadSponsorOptions() : Promise.resolve(),
        loadSponsorOrders(),
      ]);
      if (seq === profileLoadSeq) writeProfileCache();
    } catch (error) {
      if (seq !== profileLoadSeq) return;
      profileSnapshotReady.value = true;
      if (!restoredFromCache) profileLoadError.value = normalizeProfileLoadError(error);
    } finally {
      if (seq === profileLoadSeq) profileLoading.value = false;
    }
  }

  async function loadAssistantQuota() {
    if (assistantQuotaLoading.value) return;
    assistantQuotaLoading.value = true;
    assistantQuotaError.value = "";
    try {
      assistantQuota.value = await searchApi.assistantQuota({ suppressErrorMessage: true });
    } catch {
      assistantQuotaError.value = "AI 额度加载失败，请稍后重试";
    } finally {
      assistantQuotaLoading.value = false;
    }
  }

  async function saveEdit() {
    if (saving.value) return;
    const nickname = editForm.nickname.trim();
    if (!nickname) {
      ElMessage.warning("昵称不能为空");
      return;
    }
    saving.value = true;
    try {
      const u = await authApi.updateMe({
        ...editForm,
        nickname,
        bio: editForm.bio.trim(),
        college: editForm.college.trim(),
      } as any);
      auth.user = u;
      ElMessage.success(["pending", "checking"].includes(u.profileReview?.status || "") ? "资料已提交 AI 审核，通过后自动公开生效" : "已保存");
      editing.value = false;
    } finally { saving.value = false; }
  }

  async function saveVipDecoration(field: "profileTheme" | "profileFrame", value: string) {
    if (!user.value?.vipActive || vipStyleSaving.value) return;
    vipStyleSaving.value = true;
    try {
      await auth.updateProfile({ [field]: value } as any);
      ElMessage.success("VIP 个性化资料已更新");
    } finally {
      vipStyleSaving.value = false;
    }
  }

  async function loadSponsorOptions() {
    if (commerceHidden) return;
    try {
      Object.assign(sponsorOptions, await paymentsApi.sponsorOptions({ suppressErrorMessage: true }));
      sponsorOptionsCached.value = true;
      if (sponsorOptions.amounts.length) sponsorAmount.value = String(sponsorOptions.amounts[1] ?? sponsorOptions.amounts[0]);
      if (sponsorOptions.payTypes.length) sponsorPayType.value = sponsorOptions.payTypes[0];
      selectDefaultSponsorCategory();
    } catch {
      if (!sponsorOptionsCached.value) sponsorOptions.enabled = false;
    }
  }

  async function loadSponsorOrders() {
    if (commerceHidden) return;
    try {
      sponsorOrders.value = (await paymentsApi.sponsorOrders({ page: 1, size: 10, status: "paid" }, { suppressErrorMessage: true })).list;
    } catch {
      /* 赞助记录是补充内容；失败时保留当前页面，避免后台刷新造成闪烁。 */
    }
  }

  function isProfileViewCache(value: unknown): value is ProfileViewCache {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<ProfileViewCache>;
    return Array.isArray(candidate.topics)
      && Array.isArray(candidate.boards)
      && Boolean(candidate.sponsorOptions)
      && typeof candidate.sponsorOptions === "object"
      && Array.isArray(candidate.sponsorOptions.amounts)
      && Array.isArray(candidate.sponsorOptions.payTypes);
  }

  function restoreProfileCache() {
    if (!profileCacheKey.value) return false;
    const cached = readViewCache(profileCacheKey.value, isProfileViewCache);
    if (!cached) return false;
    myTopics.value = auth.forumHidden ? [] : cached.topics;
    boards.value = auth.forumHidden ? [] : cached.boards;
    Object.assign(sponsorOptions, cached.sponsorOptions);
    sponsorOptionsCached.value = true;
    profileSnapshotReady.value = true;
    if (sponsorOptions.amounts.length) sponsorAmount.value = String(sponsorOptions.amounts[1] ?? sponsorOptions.amounts[0]);
    if (sponsorOptions.payTypes.length) sponsorPayType.value = sponsorOptions.payTypes[0];
    selectDefaultSponsorCategory();
    return true;
  }

  function selectDefaultSponsorCategory() {
    const requestedId = String(route.query.sponsorCategory ?? "").trim();
    const requested = sponsorOptions.categories.find((category) => category.id === requestedId && category.accepting);
    if (requested) {
      sponsorCategoryId.value = requested.id;
      return;
    }
    const current = sponsorOptions.categories.find((category) => category.id === sponsorCategoryId.value && category.accepting);
    if (current) return;
    const next = sponsorOptions.categories.find((category) => category.featured && category.accepting)
      ?? sponsorOptions.categories.find((category) => category.accepting);
    sponsorCategoryId.value = next?.id ?? "";
  }

  function writeProfileCache() {
    if (!profileCacheKey.value) return;
    writeViewCache(profileCacheKey.value, {
      topics: myTopics.value,
      boards: boards.value,
      sponsorOptions: { ...sponsorOptions },
    } satisfies ProfileViewCache);
  }

  async function handleSponsorReturnFromQuery() {
    if (commerceHidden) return;
    const sponsorQuery = String(route.query.sponsor ?? "");
    if (sponsorQuery !== "success") return;
    const key = String(route.query.outTradeNo ?? "__no_trade_no");
    if (handledSponsorReturnKey === key || sponsorReturnInFlightKey === key) return;
    sponsorReturnInFlightKey = key;
    try {
      await pollSponsorReturn(String(route.query.outTradeNo ?? ""));
      await loadSponsorOrders();
      handledSponsorReturnKey = key;
    } finally {
      if (sponsorReturnInFlightKey === key) sponsorReturnInFlightKey = "";
    }
  }

  function validateSponsorAmount() {
    if (!selectedSponsorCategory.value?.accepting) {
      ElMessage.warning("请选择仍在进行中的赞助类别");
      return false;
    }
    const amount = Number(sponsorAmount.value);
    const min = Number(sponsorOptions.minAmount);
    const max = Number(sponsorOptions.maxAmount);
    if (!Number.isFinite(amount) || amount < min || amount > max) {
      ElMessage.warning(`赞助金额需在 ${formatMoney(min)} - ${formatMoney(max)} 元之间`);
      return false;
    }
    return true;
  }

  function openSponsorConfirm() {
    if (commerceHidden) return;
    if (sponsorSubmitting.value) return;
    if (!validateSponsorAmount()) return;
    if (!enabledPayTypes.value.length) {
      ElMessage.warning("当前没有可用支付方式");
      return;
    }
    sponsorConfirmOpen.value = true;
  }

  async function submitSponsor() {
    if (commerceHidden) return;
    if (sponsorSubmitting.value) return;
    if (!validateSponsorAmount()) return;
    if (!enabledPayTypes.value.length) {
      ElMessage.warning("当前没有可用支付方式");
      return;
    }
    sponsorSubmitting.value = true;
    try {
      const result = await paymentsApi.createSponsorOrderWithOptions({
        amount: sponsorAmount.value,
        payType: sponsorPayType.value,
        categoryId: sponsorCategoryId.value,
        message: sponsorMessage.value.trim(),
        displayMode: sponsorDisplayMode.value,
      });
      sponsorConfirmOpen.value = false;
      navigateToEpayCheckout(result);
    } finally {
      sponsorSubmitting.value = false;
    }
  }

  async function pollSponsorReturn(outTradeNo: string) {
    if (!outTradeNo) {
      await auth.fetchMe();
      ElMessage.success("支付完成后赞助金额会自动刷新，若未显示请稍等片刻");
      return;
    }
    for (let i = 0; i < 6; i += 1) {
      const order = await paymentsApi.sponsorOrder(outTradeNo, { suppressErrorMessage: true }).catch(() => null);
      if (order?.status === "paid") {
        await auth.fetchMe();
        ElMessage.success("赞助已到账，感谢支持");
        return;
      }
      if (order?.status === "closed") {
        ElMessage.warning("该订单已超时关闭，请重新发起赞助");
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
    await auth.fetchMe();
    ElMessage.info("已返回本站，支付状态还在确认中");
  }

  async function savePassword() {
    if (savingPw.value) return;
    if (pwForm.newPassword.length < 6) { ElMessage.warning("新密码至少 6 位"); return; }
    if (pwForm.newPassword !== pwForm.confirm) { ElMessage.warning("两次输入的新密码不一致"); return; }
    if (pwForm.newPassword === pwForm.oldPassword) { ElMessage.warning("新密码不能与原密码相同"); return; }
    savingPw.value = true;
    try {
      await authApi.changePassword(pwForm.oldPassword, pwForm.newPassword);
      ElMessage.success("密码已修改");
      passwordDialog.value = false;
    } finally { savingPw.value = false; }
  }

  async function onLogout() {
    if (logoutBusy.value) return;
    const confirmed = await ElMessageBox.confirm("确认退出登录？", "提示")
      .then(() => true)
      .catch(() => false);
    if (!confirmed) return;
    logoutBusy.value = true;
    try {
      await auth.logout();
      await router.replace("/login");
    } finally {
      logoutBusy.value = false;
    }
  }

  function openWechatBinding() {
    router.push("/messages?tab=settings");
  }

  async function loadWechatBinding(opts?: { silent?: boolean }) {
    if (wechatProfileLoading.value) return;
    wechatProfileLoading.value = true;
    wechatProfileError.value = "";
    try {
      wechatProfile.value = await authApi.wechatProfile({ suppressErrorMessage: true });
    } catch (error) {
      wechatProfileError.value = normalizeProfileLoadError(error);
      if (!opts?.silent) ElMessage.error("微信绑定状态加载失败");
    } finally {
      wechatProfileLoading.value = false;
    }
  }

  function refreshWechatBinding() {
    return loadWechatBinding();
  }

  function pickAvatar() {
    if (avatarSaving.value) return;
    avatarInputRef.value?.click();
  }

  async function onAvatarChange(event: Event) {
    const target = event.target as HTMLInputElement | null;
    const file = target?.files?.[0];
    if (!file) return;
    if (avatarSaving.value) {
      if (target) target.value = "";
      return;
    }

    avatarSaving.value = true;
    try {
      const avatar = await compressImageFile(file, {
        maxWidth: 320,
        maxHeight: 320,
        quality: 0.78,
        mimeType: "image/jpeg",
        maxBytes: 140 * 1024,
      });
      await auth.updateProfile({ avatar });
      ElMessage.success("头像已提交审核，通过后公开显示");
    } catch (error) {
      ElMessage.error(normalizeImageUploadError(error, "头像上传失败，请稍后重试"));
    } finally {
      avatarSaving.value = false;
      if (target) target.value = "";
    }
  }

  async function removeAvatar() {
    if (avatarSaving.value) return;
    avatarSaving.value = true;
    try {
      await auth.updateProfile({ avatar: null });
      avatarPreviewFailed.value = false;
      avatarPreviewRevision.value = 0;
      ElMessage.success("头像移除申请已提交审核");
    } finally {
      avatarSaving.value = false;
    }
  }

  function openMyTopic(id: number) {
    router.push(`/forum/topic/${id}`);
  }

  async function retryAvatarPreview() {
    if (avatarSaving.value || !user.value?.avatar) return;
    avatarSaving.value = true;
    try {
      avatarPreviewRevision.value = Date.now();
      avatarPreviewFailed.value = !(await preloadAvatar(avatarDisplayUrl.value));
      if (!avatarPreviewFailed.value) ElMessage.success("头像已加载");
      else ElMessage.warning("预览暂时不可用，头像已保存，请稍后重试");
    } finally {
      avatarSaving.value = false;
    }
  }

  return {
    commerceHidden,
    auth,
    site,
    appearance,
    route,
    router,
    user,
    assistantHiddenForClient,
    assistantEntryVisible,
    myTopics,
    boards,
    anonymousBoards,
    editing,
    editForm,
    saving,
    logoutBusy,
    avatarSaving,
    avatarPreviewFailed,
    avatarDisplayUrl,
    avatarInputRef,
    vipStyleSaving,
    trustDetailsOpen,
    anonymousBoardsOpen,
    sponsorVisible,
    sponsorOptions,
    sponsorSubmitting,
    sponsorAmount,
    sponsorPayType,
    sponsorCategoryId,
    sponsorMessage,
    sponsorDisplayMode,
    sponsorConfirmOpen,
    sponsorOrders,
    enabledPayTypes,
    selectedSponsorCategory,
    profileLoading,
    profileLoadError,
    profileSnapshotReady,
    assistantQuota,
    assistantQuotaLoading,
    assistantQuotaError,
    wechatProfile,
    wechatProfileLoading,
    wechatBindingStateText,
    passwordDialog,
    savingPw,
    pwForm,
    anonymousStatusText,
    anonymousResetText,
    profileThemeClass,
    profileFrameClass,
    nicknameReviewText,
    loadProfilePage,
    loadAssistantQuota,
    saveEdit,
    saveVipDecoration,
    openSponsorConfirm,
    submitSponsor,
    savePassword,
    onLogout,
    openWechatBinding,
    refreshWechatBinding,
    pickAvatar,
    onAvatarChange,
    removeAvatar,
    retryAvatarPreview,
    openMyTopic,
  };
}
