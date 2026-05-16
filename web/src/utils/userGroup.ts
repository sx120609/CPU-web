export const USER_QQ_GROUP = "704825850";
export const USER_QQ_GROUP_JOIN_URL = "https://qm.qq.com/q/oVRbeagLXq";
export const USER_QQ_GROUP_HINT_KEY = "cpu-user-qq-group-hint-v1";

export function openUserGroup() {
  window.open(USER_QQ_GROUP_JOIN_URL, "_blank", "noopener,noreferrer");
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
