/**
 * 学校账号本地加密保存（用于“记住登录”）
 *
 * 安全模型：
 * - 数据只保存在当前浏览器 localStorage，不上传服务器。
 * - 使用 Web Crypto AES-GCM 加密；密钥也保存在 localStorage。这能避免明文暴露，
 *   但不能防止已经能在当前页面执行脚本的攻击，因此共享设备不要勾选记住登录。
 * - 每次自动登录都会重新走学校 SSO。
 * - 用户可在教务页清除保存的登录信息，或清理浏览器站点数据。
 */
const KEY_STORAGE = "cpu-jwxt-key-v1";
const CRED_STORAGE = "cpu-jwxt-creds-v1";

function storageAvailable() {
  try {
    const key = "__cpu_storage_probe__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function b64encode(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
  return btoa(text);
}

function b64decode(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function getOrCreateKey(): Promise<CryptoKey> {
  if (!storageAvailable()) throw new Error("browser storage is unavailable");
  let raw = localStorage.getItem(KEY_STORAGE);
  let bytes: Uint8Array<ArrayBuffer>;
  if (!raw) {
    bytes = crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem(KEY_STORAGE, b64encode(bytes));
  } else {
    bytes = b64decode(raw);
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function saveCreds(username: string, password: string): Promise<void> {
  if (!username || !password) return;
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({
    username,
    password,
    savedAt: Date.now(),
  }));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  localStorage.setItem(CRED_STORAGE, JSON.stringify({
    version: 1,
    iv: b64encode(iv),
    data: b64encode(new Uint8Array(cipher)),
  }));
}

export async function loadCreds(): Promise<{ username: string; password: string } | null> {
  if (!storageAvailable()) return null;
  const raw = localStorage.getItem(CRED_STORAGE);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as { iv?: string; data?: string };
    if (!payload.iv || !payload.data) return null;
    const key = await getOrCreateKey();
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(payload.iv) },
      key,
      b64decode(payload.data),
    );
    const obj = JSON.parse(new TextDecoder().decode(decrypted)) as {
      username?: unknown;
      password?: unknown;
    };
    const username = typeof obj.username === "string" ? obj.username : "";
    const password = typeof obj.password === "string" ? obj.password : "";
    return username && password ? { username, password } : null;
  } catch {
    clearCreds();
    return null;
  }
}

export function hasCreds(): boolean {
  try {
    return Boolean(localStorage.getItem(CRED_STORAGE));
  } catch {
    return false;
  }
}

export function clearCreds(): void {
  try {
    localStorage.removeItem(CRED_STORAGE);
  } catch { /* storage may be unavailable */ }
}

export async function savedUsername(): Promise<string | null> {
  const creds = await loadCreds();
  return creds?.username ?? null;
}
