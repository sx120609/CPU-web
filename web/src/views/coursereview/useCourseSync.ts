import { ref } from "vue";
import { ElMessage } from "element-plus";
import { courseApi, type CourseSyncResult } from "@/api/course";
import { useAuthStore } from "@/stores/auth";
import { useJwxtStore } from "@/stores/jwxt";
import { isJwxtAuthFailure } from "@/utils/jwxtAuthErrors";

function errorMessage(error: unknown) {
  const data = (error as { response?: { data?: { message?: string } } })?.response?.data;
  return data?.message || (error instanceof Error ? error.message : "") || "导入失败，请稍后再试";
}

/**
 * 从教务导入我的课程。教务授权的恢复全交给 jwxt store：
 * 失效时先静默恢复再重试，恢复不了才让页面弹出重新授权。
 */
export function useCourseSync() {
  const auth = useAuthStore();
  const jwxt = useJwxtStore();
  const syncing = ref(false);
  const needsReauth = ref(false);

  /** 站内独立账号没有学校侧身份，不能导入。 */
  const canSync = () => auth.isLoggedIn && auth.user?.studentSso !== false;

  async function sync(options: { silent?: boolean } = {}): Promise<CourseSyncResult | null> {
    if (syncing.value || !canSync()) return null;
    syncing.value = true;
    needsReauth.value = false;
    try {
      const result = await jwxt.withSessionRetry(() => courseApi.sync({ suppressErrorMessage: true }));
      if (!options.silent) {
        const parts = [
          result.taken ? `修过 ${result.taken} 门` : "",
          result.current ? `在修 ${result.current} 门` : "",
          result.planned ? `培养方案 ${result.planned} 门` : "",
        ].filter(Boolean);
        ElMessage.success(`已导入：${parts.join("，") || `${result.examined} 门课`}${result.partial ? "（教务有部分数据暂时没拿到）" : ""}`);
      }
      return result;
    } catch (error) {
      if (isJwxtAuthFailure(error) || jwxt.needsReauthorization) {
        // 静默导入失败不打扰；用户主动点的才弹授权。
        if (!options.silent) needsReauth.value = true;
      } else if (!options.silent) {
        ElMessage.error(errorMessage(error));
      }
      return null;
    } finally {
      syncing.value = false;
    }
  }

  return { syncing, needsReauth, canSync, sync };
}
