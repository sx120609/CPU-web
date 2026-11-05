import { computed } from "vue";
import { useSiteStore } from "@/stores/site";

export const USER_QQ_GROUP_HINT_KEY = "cpu-user-qq-group-hint-v1";

/** 本校的用户交流 QQ 群号（学校档案的 userGroup）；没有群时为空，页面上的「加群咨询」就不显示。 */
export function useUserGroupQq() {
  const site = useSiteStore();
  return computed(() => site.userGroupQq);
}

/** 打开本校用户群的加群链接；没有链接时什么也不做。 */
export function openUserGroup() {
  const url = useSiteStore().userGroupJoinUrl;
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}
