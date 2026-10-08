import { computed, onBeforeUnmount, onMounted, reactive, ref, type Ref } from "vue";
import { ElMessage } from "element-plus";
import { jwxtApi } from "@/api/jwxt";
import { useJwxtStore } from "@/stores/jwxt";

export interface IServiceApp {
  id: number;
  name: string;
  detail: string;
  url: string;
  icon: string;
  types: string[];
  clickNum: number;
  favorite: boolean;
  favCount: number;
  dept: string;
  scope: string[];
}

const FAVORITES_KEY = "cpu-iservice-favorite-overrides";
const APPS_CACHE_KEY = "cpu-iservice-apps-cache-v1";
const darkAppIconRules = [
  { pattern: /缴费|费用|财务|支付|校园卡|一卡通|账单|补助|奖学金/, icon: "card", tone: "amber" },
  { pattern: /图书|借阅|馆藏|文献|数据库/, icon: "course", tone: "blue" },
  { pattern: /成绩|考试|课表|选课|课程|培养|教务|学籍|学分|毕业|补考|缓考/, icon: "school", tone: "blue" },
  { pattern: /宿舍|公寓|报修|水电|后勤/, icon: "home", tone: "green" },
  { pattern: /就业|招聘|勤工|实习/, icon: "work", tone: "violet" },
  { pattern: /邮箱|通知|公告|消息/, icon: "announcement", tone: "cyan" },
  { pattern: /申请|审批|证明|请假|离校|报到|办事/, icon: "document", tone: "indigo" },
  { pattern: /网络|VPN|信息|系统|门户|登录|账号/, icon: "desktop", tone: "violet" },
  { pattern: /健康|心理|医疗|体检/, icon: "service", tone: "rose" },
  { pattern: /体育|场馆|运动/, icon: "trophy", tone: "amber" },
  { pattern: /问卷|评价|反馈/, icon: "edit", tone: "cyan" },
] as const;
let activeRequest: Promise<any> | null = null;

// i 服务应用列表的数据、筛选与收藏；桌面端面板和移动端列表共用。
// 传入 keyword 时由调用方持有搜索词（移动端服务页的整页搜索）。
export function useIServiceApps(options: { keyword?: Ref<string> } = {}) {
  const apps = ref<IServiceApp[]>([]);
  const jwxt = useJwxtStore();
  const loading = ref(false);
  const error = ref("");
  const keyword = options.keyword ?? ref("");
  const activeCat = ref("");
  const filterFav = ref<"" | "fav">("");
  const iconLoadState = reactive(new Map<string, "proxy" | "failed">());
  let disposed = false;

  onMounted(() => {
    disposed = false;
    reload(false);
  });

  onBeforeUnmount(() => {
    disposed = true;
  });

  async function reload(force = true) {
    if (disposed) return;
    if (force) iconLoadState.clear();
    error.value = "";
    await loadApps(force);
  }

  async function loadApps(force = false) {
    if (disposed) return;
    restoreAppsCache();
    loading.value = force || !apps.value.length;
    try {
      const r: any = await fetchApps();
      if (disposed) return;
      const overrides = loadFavoriteOverrides();
      apps.value = (r.apps ?? []).map((a: IServiceApp) => ({
        ...a,
        favorite: favoriteFor(a, overrides),
      }));
      sortApps();
      writeAppsCache(r.apps ?? []);
      error.value = "";
    } catch (e: any) {
      if (disposed) return;
      if (!apps.value.length) error.value = e?.message || "i 服务暂时不可用";
    } finally {
      if (!disposed) loading.value = false;
    }
  }

  function fetchApps() {
    if (activeRequest) return activeRequest;
    // i 服务是可选上游，失败时只在当前卡片中提示，避免自动重试连续弹窗。
    activeRequest = jwxt.withSessionRetry(() => jwxtApi.iapps({ silent: true }));
    activeRequest.then(
      () => { activeRequest = null; },
      () => { activeRequest = null; }
    );
    return activeRequest;
  }

  function restoreAppsCache() {
    const cached = readAppsCache();
    if (!cached?.apps.length || apps.value.length) return cached;
    const overrides = loadFavoriteOverrides();
    apps.value = cached.apps.map((a) => ({ ...a, favorite: favoriteFor(a, overrides) }));
    sortApps();
    return cached;
  }

  const categories = computed(() => {
    const m = new Map<string, number>();
    for (const a of apps.value) {
      for (const t of a.types) m.set(t, (m.get(t) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  });

  const filtered = computed(() => {
    const kw = keyword.value.trim().toLowerCase();
    return apps.value.filter((a) => {
      if (activeCat.value && !a.types.includes(activeCat.value)) return false;
      if (filterFav.value === "fav" && !a.favorite) return false;
      if (kw) {
        const hit =
          a.name.toLowerCase().includes(kw) ||
          a.detail.toLowerCase().includes(kw) ||
          a.types.some((t) => t.toLowerCase().includes(kw)) ||
          a.dept.toLowerCase().includes(kw);
        if (!hit) return false;
      }
      return true;
    });
  });

  function hasAppIcon(a: IServiceApp) {
    return Boolean(a.icon) && iconLoadState.get(iconKey(a)) !== "failed";
  }

  function appIconSource(a: IServiceApp) {
    return iconLoadState.get(iconKey(a)) === "proxy" ? iconProxyPath(a.icon) : a.icon;
  }

  function onIconError(a: IServiceApp) {
    const key = iconKey(a);
    if (!iconLoadState.has(key) && iconProxyPath(a.icon)) {
      iconLoadState.set(key, "proxy");
      return;
    }
    iconLoadState.set(key, "failed");
  }

  function sortApps() {
    apps.value.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return (b.clickNum ?? 0) - (a.clickNum ?? 0);
    });
  }

  function toggleFavorite(a: IServiceApp) {
    const overrides = loadFavoriteOverrides();
    const next = !a.favorite;
    overrides[favoriteKey(a)] = next;
    saveFavoriteOverrides(overrides);
    a.favorite = next;
    sortApps();
    ElMessage.success(next ? "已加入我的收藏" : "已取消收藏");
  }

  function openApp(a: IServiceApp) {
    if (!a.url) {
      ElMessage.warning("该应用暂未配置链接");
      return;
    }
    const url = typeof a.url === "string" ? a.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) {
      ElMessage.warning("该应用链接格式暂不支持");
      return;
    }
    // 带 noopener / noreferrer 时 window.open 按规范总是返回 null，即使新页面已经打开，
    // 所以这里不能用返回值判断是否被拦截，否则每次都会误报“浏览器阻止了新窗口”。
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return {
    apps,
    loading,
    error,
    keyword,
    activeCat,
    filterFav,
    categories,
    filtered,
    reload,
    hasAppIcon,
    appIconSource,
    onIconError,
    darkAppIconName,
    darkAppIconTone,
    toggleFavorite,
    openApp,
  };
}

function readAppsCache(): { savedAt: number; apps: IServiceApp[] } | null {
  try {
    const raw = localStorage.getItem(APPS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== "number" || !Array.isArray(parsed.apps)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAppsCache(list: IServiceApp[]) {
  try {
    localStorage.setItem(APPS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), apps: list }));
  } catch {
    /* ignore */
  }
}

function iconKey(a: IServiceApp) {
  return String(a.icon || a.id || a.name);
}

function iconProxyPath(icon: string) {
  try {
    const url = new URL(icon, window.location.origin);
    if (url.protocol !== "https:" || url.hostname !== "i.cpu.edu.cn") return "";
    return `/api/jwxt/iapps/icon?path=${encodeURIComponent(url.pathname)}`;
  } catch {
    return "";
  }
}

function darkAppIcon(a: IServiceApp) {
  const searchText = [a.name, a.detail, a.dept, ...a.types].join(" ");
  return darkAppIconRules.find((rule) => rule.pattern.test(searchText)) || { icon: "service", tone: "teal" };
}

function darkAppIconName(a: IServiceApp) {
  return darkAppIcon(a).icon;
}

function darkAppIconTone(a: IServiceApp) {
  return darkAppIcon(a).tone;
}

function favoriteKey(a: IServiceApp) {
  return String(a.id || a.url || a.name);
}

function loadFavoriteOverrides(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveFavoriteOverrides(overrides: Record<string, boolean>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(overrides));
}

function favoriteFor(a: IServiceApp, overrides = loadFavoriteOverrides()) {
  const key = favoriteKey(a);
  return Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : Boolean(a.favorite);
}
