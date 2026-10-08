import { computed, inject, onBeforeUnmount, onMounted, ref, watch, type InjectionKey, type Ref } from "vue";
import { ElMessage } from "element-plus";
import { useRoute, useRouter } from "vue-router";
import { getToken } from "@/api/request";
import { toolsApi, type ServiceToolCode, type ToolMeta } from "@/api/tools";
import { serviceTools, type ServiceTool } from "@/data/serviceTools";
import { useAuthStore } from "@/stores/auth";
import { useJwxtStore } from "@/stores/jwxt";
import { useSiteStore } from "@/stores/site";
import { shouldHideNativeYaodaCanFly } from "@/utils/clientInfo";
import { detectVenueLaunchMode, openVenueReservationWithoutReferrer } from "@/utils/venueReservation";
import { readViewCache, writeViewCache } from "@/utils/viewCache";

// 校园小工具的可见性、登录要求与打开方式；服务页和“全部小工具”页共用。
export function useServiceTools() {
  const auth = useAuthStore();
  const router = useRouter();
  const toolMetas = ref<ToolMeta[]>([]);
  const toolsLoading = ref(false);
  const toolsError = ref("");
  let toolsLoadSeq = 0;
  let disposed = false;
  const toolsCacheKey = computed(() => `cpu-services-tools-v1:${auth.user?.id ? `user-${auth.user.id}` : "guest"}`);
  const toolAccessMap = computed(() => Object.fromEntries(toolMetas.value.map((item) => [item.code, item])));
  const visibleTools = computed(() => serviceTools.filter((tool) => (
    toolAccessMap.value[tool.slug]?.isVisible !== false
    && !(tool.slug === "yaoda_can_fly" && shouldHideNativeYaodaCanFly(auth.isLoggedIn, auth.user?.username))
  )));

  onMounted(() => {
    disposed = false;
    restoreToolMetasCache();
    void loadToolMetas();
  });

  onBeforeUnmount(() => {
    disposed = true;
    toolsLoadSeq += 1;
  });

  watch(toolsCacheKey, (next, previous) => {
    if (disposed || next === previous) return;
    toolsLoadSeq += 1;
    toolMetas.value = [];
    restoreToolMetasCache();
    void loadToolMetas();
  });

  async function loadToolMetas() {
    const seq = ++toolsLoadSeq;
    toolsLoading.value = !toolMetas.value.length;
    toolsError.value = "";
    try {
      const next = await toolsApi.tools({ suppressErrorMessage: true });
      if (seq !== toolsLoadSeq) return;
      toolMetas.value = next;
      writeViewCache(toolsCacheKey.value, next);
    } catch (error) {
      if (seq !== toolsLoadSeq) return;
      if (!toolMetas.value.length) toolsError.value = normalizeToolsError(error);
    } finally {
      if (seq === toolsLoadSeq) toolsLoading.value = false;
    }
  }

  function restoreToolMetasCache() {
    const cached = readViewCache<ToolMeta[]>(
      toolsCacheKey.value,
      (value): value is ToolMeta[] => Array.isArray(value)
        && value.every((item) => Boolean(item) && typeof item === "object" && typeof (item as ToolMeta).code === "string"),
    );
    if (cached) toolMetas.value = cached;
    return cached;
  }

  function isLoginRequired(slug: string) {
    return Boolean(toolAccessMap.value[slug]?.requireLogin);
  }

  function toolBadge(tool: ServiceTool) {
    if (tool.hideBadge) return "";
    return tool.badge ?? (isLoginRequired(tool.slug) ? "需登录" : "免登录");
  }

  function openTool(tool: ServiceTool) {
    if (tool.slug === "venue_reservation" && detectVenueLaunchMode({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      viewportWidth: window.innerWidth,
    }) === "wechat") {
      openVenueReservationWithoutReferrer();
      return;
    }
    router.push(tool.routeName === "service-tool-detail"
      ? { name: tool.routeName, params: { slug: tool.slug } }
      : { name: tool.routeName });
  }

  return {
    auth,
    toolMetas,
    toolsLoading,
    toolsError,
    visibleTools,
    loadToolMetas,
    isLoginRequired,
    toolBadge,
    openTool,
  };
}

// 桌面端与移动端服务页共用的数据与入口行为；两套页面只负责各自的排版。
// services/Index.vue 只调用一次并 provide 给两套页面：iPad 旋转跨过布局切换点时，
// 搜索词、电费对话框和已加载的工具配置都会保留，也不会重复请求。
export function useServicesPage() {
  const tools = useServiceTools();
  const { auth } = tools;
  const jwxt = useJwxtStore();
  const router = useRouter();
  const route = useRoute();
  const site = useSiteStore();
  const electricOpen = ref(false);
  // 移动端的搜索词；放在共享状态里，切换布局后切回来仍在。
  const keyword = ref("");
  let disposed = false;
  const academicDataUnavailable = computed(() => Boolean(auth.user?.studentSso && auth.academicIdentityUnavailable));
  const electricAvailable = computed(() => auth.isLoggedIn && site.features.electric);

  watch(
    [() => route.query.open, () => site.features.electric],
    ([quickOpen, electricEnabled]) => {
      if (quickOpen === "electric" && electricEnabled) electricOpen.value = true;
      if (quickOpen === "network" || quickOpen === "desktop") void router.push("/download");
    },
    { immediate: true },
  );

  onMounted(async () => {
    disposed = false;
    jwxt.hydrate();
    try {
      // 服务页只探测现有教务会话，不自动提交已保存的学校凭据。
      await jwxt.refreshStatus();
    } catch {
      if (!disposed) ElMessage.warning("教务登录状态暂时无法刷新，基础服务仍可继续使用");
    }
  });

  onBeforeUnmount(() => {
    disposed = true;
  });

  return {
    ...tools,
    jwxt,
    electricOpen,
    electricAvailable,
    academicDataUnavailable,
    keyword,
  };
}

export type ServicesPage = ReturnType<typeof useServicesPage>;
export const servicesPageKey: InjectionKey<ServicesPage> = Symbol("services-page");

export function useInjectedServicesPage() {
  const page = inject(servicesPageKey);
  if (!page) throw new Error("services page state is not provided");
  return page;
}

// 小工具的管理入口：工具配置里可管理的，加上账号被单独授权的。
export function useToolManageEntry(toolMetas: Ref<ToolMeta[]>) {
  const router = useRouter();
  const permitted = ref<ServiceToolCode[]>([]);
  const manageable = computed(() => Array.from(new Set([
    ...toolMetas.value.filter((item) => item.canManage).map((item) => item.code),
    ...permitted.value,
  ])));
  const canManageAny = computed(() => manageable.value.length > 0);

  onMounted(async () => {
    if (!getToken()) return;
    try {
      const perms = await toolsApi.myPermissions({
        suppressAuthRedirect: true,
        suppressAuthMessage: true,
        suppressErrorMessage: true,
      });
      permitted.value = [...perms.toolCodes, ...(perms.adminToolCodes ?? [])];
    } catch {
      /* 没拿到授权信息时只按工具配置判断 */
    }
  });

  function canManageTool(code: string) {
    return manageable.value.includes(code as ServiceToolCode);
  }

  function openToolManage(code: ServiceToolCode) {
    if (code === "file_collect") {
      router.push("/services/tools/filestore");
      return;
    }
    router.push({ path: "/services/tools/manage", query: { tool: code } });
  }

  function openManage() {
    openToolManage(manageable.value[0] ?? "questionnaire");
  }

  return { canManageAny, canManageTool, openToolManage, openManage };
}

// 自定义标签沿用工具配置的色调；默认标签按是否需要登录区分。
export function toolBadgeTone(tool: ServiceTool, loginRequired: boolean) {
  if (tool.badge) return tool.badgeType === "success" ? "open" : "info";
  return loginRequired ? "login" : "open";
}

// 游客与未登录教务时的兜底公开入口。
export const publicServiceLinks = [
  { name: "图书馆", icon: "course", url: "http://lib.cpu.edu.cn" },
  { name: "馆藏检索", icon: "search", url: "http://opac.cpu.edu.cn" },
  { name: "融合门户", icon: "school", url: "https://i.cpu.edu.cn" },
  { name: "教务处", icon: "document", url: "http://jwc.cpu.edu.cn" },
  { name: "校园新闻", icon: "announcement", url: "http://news.cpu.edu.cn" },
  { name: "就业平台", icon: "work", url: "https://cpu.91job.org.cn/sub-station/home/10316" },
];

function normalizeToolsError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "工具配置加载失败，已显示默认入口";
  }
  return "工具配置加载失败，已显示默认入口";
}
