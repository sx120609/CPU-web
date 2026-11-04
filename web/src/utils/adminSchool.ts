import { ref } from "vue";

/**
 * 后台「正在管理的学校」：平台管理员在后台顶部切换，后台页面发出的请求带 X-Admin-School。
 * 只在 /admin 页面里生效；服务端也只认平台管理员带的这个头。存在 sessionStorage，关掉标签页就回到自己学校。
 */
const STORAGE_KEY = "cpu-admin-school-v1";

function readStored() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export const adminSchool = ref(readStored());

export function setAdminSchool(schoolId: string) {
  adminSchool.value = schoolId;
  try {
    if (schoolId) sessionStorage.setItem(STORAGE_KEY, schoolId);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 存不了就只在这次页面里生效
  }
}

/** 当前页面在后台、且选了学校时返回学校代号；请求层据此加请求头。 */
export function activeAdminSchool() {
  if (typeof window === "undefined" || !adminSchool.value) return "";
  return window.location.pathname.startsWith("/admin") ? adminSchool.value : "";
}
