import { siteApi, type SchoolSummary } from "@/api/site";
import { setSchoolChoice } from "@/api/request";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { isNativeScheduleShell } from "./clientInfo";

/**
 * 原生登录页的学校选择：学校列表来自 /api/schools，选中的学校写进和网页登录页同一个
 * cpu-school-choice，之后的统一认证请求都带上它（api/request.ts 的 X-CPU-School）。
 *
 * 只随线上网页安装：原生壳自带的兜底脚本（各端 build-web-bridge.mjs 打包的 iosNextScheduleBridge）
 * 不含它，那时原生登录页不显示学校选择，照旧用默认学校登录。
 */
export function installNativeLoginSchools() {
  if (!isNativeScheduleShell()) return;
  const host = window as any;
  if (!host.CPUTimeNative) return;
  const site = useSiteStore();
  const auth = useAuthStore();

  const current = () => ({
    id: String(site.school?.id || ""),
    name: site.schoolName,
    brandName: site.brandName,
    ssoLogin: site.school?.ssoLogin !== false,
  });
  host.CPUTimeNative.__loginSchool = current;

  host.CPUTimeNative.nativeLoginSchools = async () => {
    const [list] = await Promise.all([
      siteApi.schools().catch(() => [] as SchoolSummary[]),
      site.loaded ? undefined : site.fetch().catch(() => undefined),
    ]);
    return {
      current: current(),
      schools: list.map((item) => ({
        id: item.id,
        name: item.name,
        shortName: item.shortName,
        brandName: item.brandName,
        ssoLogin: item.ssoLogin !== false,
      })),
    };
  };

  /** 换学校，再按新学校准备统一认证（验证码等）；返回值和 nativeLoginBegin 相同。 */
  host.CPUTimeNative.nativeChooseSchool = async (schoolId: string) => {
    const id = String(schoolId || "").trim();
    if (id && id !== site.school?.id) {
      auth.cancelSsoMfa();
      setSchoolChoice(id);
      await site.fetch(true).catch(() => undefined);
      auth.ssoError = "";
    }
    if (site.school?.ssoLogin === false) return { ok: true, error: "", school: current() };
    return host.CPUTimeNative.nativeLoginBegin();
  };
}
