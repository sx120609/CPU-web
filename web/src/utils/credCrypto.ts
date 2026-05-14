/**
 * 学校账号本地加密保存（用于"记住登录"）
 *
 * 安全模型（必读）：
 *  - 数据**只**保存在你浏览器的 localStorage，从不上传任何服务器
 *  - 使用 Web Crypto AES-GCM 加密，密钥本身也存 localStorage —— 这只能防"路过看一眼"的人，
 *    无法防能在你浏览器执行 JS 的攻击者（XSS）。我们站内 markdown 走 DOMPurify 已防 XSS，
 *    但请在共享/不受信任的电脑上**不要勾选记住登录**
 *  - 每次自动登录都会经过学校 SSO 一次正式登录（重新颁发 session）
 *  - 用户可以一键清除（站内"忘记登录"或浏览器清理 localStorage）
 */
const KEY_STORAGE = "cpu-jwxt-key-v1";
const CRED_STORAGE = "cpu-jwxt-creds-v1";

async function getOrCreateKey(): Promise<CryptoKey> {
  let raw = localStorage.getItem(KEY_STORAGE);
  let bytes: Uint8Array;
  if (!raw) {
    bytes = crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem(KEY_STORAGE, b64encode(bytes));
  } else {
    bytes = b64decode(raw);
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function b64encode(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const raw = atob(s);
  const u = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
  return u;
}

export async function saveCreds(username: string, password: string): Promise<void> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ username, password, savedAt: Date.now() }));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  const payload = { iv: b64encode(iv), data: b64encode(new Uint8Array(cipher)) };
  localStorage.setItem(CRED_STORAGE, JSON.stringify(payload));
}

export async function loadCreds(): Promise<{ username: string; password: string } | null> {
  const raw = localStorage.getItem(CRED_STORAGE);
  if (!raw) return null;
  try {
    const { iv, data } = JSON.parse(raw);
    const key = await getOrCreateKey();
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(iv) },
      key,
      b64decode(data)
    );
    const obj = JSON.parse(new TextDecoder().decode(decrypted));
    if (!obj.username || !obj.password) return null;
    return { username: obj.username, password: obj.password };
  } catch {
    return null;
  }
}

export function hasCreds(): boolean {
  return !!localStorage.getItem(CRED_STORAGE);
}

export function clearCreds(): void {
  localStorage.removeItem(CRED_STORAGE);
}

/** 仅展示用：判断当前是否有保存的账号（不返回密码） */
export async function savedUsername(): Promise<string | null> {
  const c = await loadCreds();
  return c?.username ?? null;
}
