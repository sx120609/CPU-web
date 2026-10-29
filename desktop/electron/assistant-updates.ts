import { createHash, verify } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { compareUserScriptVersions, parseUserScriptIdentity } from "./userscript-update";

export const ASSISTANT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA35ngCtDxyLlxrv5fauI8phv96YHC145IyUkcHMH4srQ=
-----END PUBLIC KEY-----`;
export const ASSISTANT_KINDS = ["chaoxing", "multiplatform", "weban", "zhihuishu"] as const;
export type AssistantKind = typeof ASSISTANT_KINDS[number];
export type Release = { version: string; sha256: string; size: number; fileId: string; protocol: number; runtime: number; minClient: string };
export type Catalog = { schema: 1; sequence: number; releases: Record<AssistantKind, Release> };
export type SignedCatalog = { payload: string; signature: string };
export type Component = { version: string; root: string; sha256: string; source: "builtin" | "cache" };
export type AssistantStatus = { stage: "checking" | "current" | "updated" | "error"; version: string; message: string };
export interface AssistantProvider { catalog(): Promise<SignedCatalog>; package(release: Release): Promise<Buffer> }
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const semver = /^\d+\.\d+\.\d+$/;
const packageLimit = 4 * 1024 * 1024;

export function verifyCatalog(envelope: SignedCatalog, publicKey = ASSISTANT_PUBLIC_KEY): Catalog {
  if (!envelope || typeof envelope.payload !== "string" || envelope.payload.length > 24_000 || typeof envelope.signature !== "string"
    || !verify(null, Buffer.from(envelope.payload), publicKey, Buffer.from(envelope.signature, "base64"))) throw new Error("组件发布签名无效");
  const catalog = JSON.parse(envelope.payload) as Catalog;
  if (catalog.schema !== 1 || !Number.isSafeInteger(catalog.sequence) || catalog.sequence < 1) throw new Error("组件清单无效");
  for (const kind of ASSISTANT_KINDS) {
    const r = catalog.releases?.[kind];
    if (!r || !semver.test(r.version) || !semver.test(r.minClient) || !/^[a-f0-9]{64}$/.test(r.sha256)
      || !/^[a-zA-Z0-9_-]{1,100}$/.test(r.fileId) || !Number.isSafeInteger(r.size) || r.size < 1 || r.size > packageLimit
      || !Number.isInteger(r.protocol) || !Number.isInteger(r.runtime)) throw new Error("组件版本信息无效");
  }
  return catalog;
}

export function unpackComponent(bytes: Buffer, release: Release, kind: AssistantKind): Record<string, Buffer> {
  if (bytes.length !== release.size || hash(bytes) !== release.sha256) throw new Error("组件大小或哈希校验失败");
  const bundle = JSON.parse(gunzipSync(bytes, { maxOutputLength: 12 * 1024 * 1024 }).toString("utf8"));
  if (bundle.schema !== 1 || bundle.kind !== kind || bundle.version !== release.version || !bundle.files || typeof bundle.files !== "object") throw new Error("组件内容不匹配");
  const files: Record<string, Buffer> = {};
  const entries = Object.entries(bundle.files);
  if (!entries.length || entries.length > 100) throw new Error("组件文件数无效");
  for (const [name, value] of entries) {
    const allowed = kind === "zhihuishu"
      ? /^(ui\/index\.html|ui\/assets\/[A-Za-z0-9_-]+\.(js|css)|worker\/worker\.py|worker\/vendor\/[A-Za-z0-9_]+\.py|worker\/vendor\/LICENSE)$/.test(name)
      : name === ({ chaoxing: "monkey.js", multiplatform: "multiplatform.js", weban: "weban.js" } as Record<string,string>)[kind];
    if (!allowed || typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("组件包含不允许的文件");
    files[name] = Buffer.from(value, "base64");
  }
  const required = kind === "zhihuishu" ? ["ui/index.html", "worker/worker.py", "worker/vendor/fucker.py"] : [({ chaoxing: "monkey.js", multiplatform: "multiplatform.js", weban: "weban.js" } as Record<string,string>)[kind]];
  if (required.some(name => !files[name]?.length)) throw new Error("组件缺少必要文件");
  if (kind !== "zhihuishu" && parseUserScriptIdentity(files[required[0]].toString("utf8")).version !== release.version) throw new Error("组件脚本版本不一致");
  return files;
}

// Version directories are immutable. An active task keeps its selected directory;
// installing a newer component never overwrites files used by a running process.
export class AssistantUpdates {
  private available = new Map<AssistantKind, Component>();
  private pending = new Map<AssistantKind, Promise<AssistantStatus>>();
  private checked = new Map<AssistantKind, number>();
  private lastCatalog?: { envelope: SignedCatalog; value: Catalog };
  private catalogTask?: Promise<{ envelope: SignedCatalog; value: Catalog }>;
  private initialized?: Promise<void>;
  readonly states: Partial<Record<AssistantKind, AssistantStatus>> = {};
  constructor(private options: {
    cache: string; builtins: Record<AssistantKind, Component>; clientVersion: string;
    provider: AssistantProvider; publicKey?: string;
    validate?: (kind: AssistantKind, root: string) => Promise<void>;
    onState?: (kind: AssistantKind, state: AssistantStatus) => void;
  }) {}
  selected(kind: AssistantKind): Component { return this.available.get(kind) ?? this.options.builtins[kind]; }
  private status(kind: AssistantKind, stage: AssistantStatus["stage"], message: string) {
    const state = { stage, version: this.selected(kind).version, message };
    this.states[kind] = state; this.options.onState?.(kind, state); return state;
  }
  private async load(kind: AssistantKind, envelope: SignedCatalog): Promise<Component> {
    const release = verifyCatalog(envelope, this.options.publicKey).releases[kind];
    if (!this.compatible(release)) throw new Error("组件需要更新客户端");
    const root = path.join(this.options.cache, kind, release.sha256);
    const bytes = await readFile(path.join(root, "package.gz"));
    const files = unpackComponent(bytes, release, kind);
    for (const [name, expected] of Object.entries(files)) {
      if (!(await readFile(path.join(root, name))).equals(expected)) throw new Error("本地组件校验失败");
    }
    return { root, sha256: release.sha256, version: release.version, source: "cache" };
  }
  private compatible(r: Release) { return r.protocol === 1 && r.runtime === 1 && compareUserScriptVersions(this.options.clientVersion, r.minClient) >= 0; }
  async init(): Promise<void> {
    return this.initialized ??= (async () => {
      for (const kind of ASSISTANT_KINDS) {
        try {
          const envelope = JSON.parse(await readFile(path.join(this.options.cache, kind, "current.json"), "utf8"));
          const component = await this.load(kind, envelope);
          await this.options.validate?.(kind, component.root);
          if (compareUserScriptVersions(component.version, this.options.builtins[kind].version) >= 0) this.available.set(kind, component);
          const value = verifyCatalog(envelope, this.options.publicKey);
          if (!this.lastCatalog || value.sequence > this.lastCatalog.value.sequence) this.lastCatalog = { envelope, value };
        } catch { /* An invalid/missing cache falls back to the bundled component. */ }
      }
    })();
  }
  private async catalog() {
    return this.catalogTask ??= (async () => {
      const envelope = await this.options.provider.catalog();
      const value = verifyCatalog(envelope, this.options.publicKey);
      if (this.lastCatalog && value.sequence < this.lastCatalog.value.sequence) throw new Error("忽略过期组件清单");
      this.lastCatalog = { envelope, value }; return this.lastCatalog;
    })().finally(() => { this.catalogTask = undefined; });
  }
  async check(kind: AssistantKind, force = false): Promise<AssistantStatus> {
    await this.init();
    const pending = this.pending.get(kind); if (pending) return pending;
    if (!force && Date.now() - (this.checked.get(kind) ?? 0) < 30_000 && this.states[kind]) return this.states[kind]!;
    const task = (async () => {
      this.status(kind, "checking", "正在检查助手更新…");
      try {
        const { envelope, value } = await this.catalog();
        const release = value.releases[kind];
        if (!this.compatible(release)) return this.status(kind, "current", "此组件新版需要升级客户端，继续使用本地版本");
        const rejected: string[] = JSON.parse(await readFile(path.join(this.options.cache, kind, "rejected.json"), "utf8").catch(() => "[]"));
        if (rejected.includes(release.sha256)) return this.status(kind, "error", "此前加载失败的组件已回退，等待修复版本");
        const current = this.selected(kind);
        if (compareUserScriptVersions(release.version, current.version) <= 0) return this.status(kind, "current", `v${current.version} 已是可用最新版本`);
        const bytes = await this.options.provider.package(release);
        const files = unpackComponent(bytes, release, kind);
        const parent = path.join(this.options.cache, kind);
        const root = path.join(parent, release.sha256);
        const temp = `${root}.${Date.now()}.tmp`;
        await mkdir(temp, { recursive: true, mode: 0o700 });
        try {
          for (const [name, content] of Object.entries(files)) {
            await mkdir(path.dirname(path.join(temp, name)), { recursive: true });
            await writeFile(path.join(temp, name), content, { mode: 0o600 });
          }
          await writeFile(path.join(temp, "package.gz"), bytes, { mode: 0o600 });
          await this.options.validate?.(kind, temp);
          try { await rename(temp, root); } catch (error) {
            // A previous interrupted activation may have left an identical directory.
            await this.load(kind, envelope);
          }
          const pointer = path.join(parent, "current.json");
          const old = await readFile(pointer).catch(() => undefined);
          if (old) await writeFile(path.join(parent, "previous.json"), old, { mode: 0o600 });
          const pendingPointer = `${pointer}.tmp`;
          await writeFile(pendingPointer, JSON.stringify(envelope), { mode: 0o600 });
          await rename(pendingPointer, pointer);
          this.available.set(kind, { root, sha256: release.sha256, version: release.version, source: "cache" });
          return this.status(kind, "updated", `v${release.version} 已下载，下次打开助手生效；当前任务保持原版本`);
        } finally { await rm(temp, { recursive: true, force: true }); }
      } catch {
        return this.status(kind, "error", `更新检查或校验失败，继续使用本地 v${this.selected(kind).version}`);
      } finally { this.checked.set(kind, Date.now()); }
    })().finally(() => this.pending.delete(kind));
    this.pending.set(kind, task); return task;
  }
  async rollback(kind: AssistantKind): Promise<void> {
    const failed = this.available.get(kind);
    this.available.delete(kind);
    const dir = path.join(this.options.cache, kind);
    await mkdir(dir, { recursive: true });
    if (failed) {
      const rejected: string[] = JSON.parse(await readFile(path.join(dir, "rejected.json"), "utf8").catch(() => "[]"));
      await writeFile(path.join(dir, "rejected.json"), JSON.stringify([...new Set([...rejected, failed.sha256])].slice(-30)), { mode: 0o600 });
    }
    try {
      const old = await readFile(path.join(dir, "previous.json"), "utf8");
      const component = await this.load(kind, JSON.parse(old));
      await writeFile(path.join(dir, "current.json"), old, { mode: 0o600 });
      if (compareUserScriptVersions(component.version, this.options.builtins[kind].version) >= 0) this.available.set(kind, component);
    } catch { await rm(path.join(dir, "current.json"), { force: true }); }
    this.status(kind, "error", "新组件未能加载，已回退到可用版本");
  }
}

async function limited(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > limit) throw new Error("组件下载失败");
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let count = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; count += value.length; if (count > limit) throw new Error("组件超过大小上限"); chunks.push(Buffer.from(value)); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

// Public share credentials only; never ship the publisher's API key to clients.
export class AliyunAssistantProvider implements AssistantProvider {
  private token = ""; private tokenUntil = 0;
  private catalogCache?: { id: string; value: SignedCatalog };
  constructor(private fetchImpl: typeof fetch = fetch) {}
  private async post(endpoint: string, body: object, authenticated = true): Promise<any> {
    if (authenticated && Date.now() >= this.tokenUntil) {
      const data = await this.post("/v2/share_link/get_share_token", { share_id: "TunDZWtpXk5", share_pwd: "" }, false);
      if (typeof data.share_token !== "string") throw new Error("分享不可用");
      this.token = data.share_token; this.tokenUntil = Date.now() + 60 * 60_000;
    }
    const response = await this.fetchImpl(`https://bj37249.api.aliyunfile.com${endpoint}`, {
      method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { "x-share-token": this.token } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    return JSON.parse((await limited(response, 64 * 1024)).toString("utf8"));
  }
  private async download(id: string, limit: number) {
    const data = await this.post("/v2/file/get_download_url", { share_id: "TunDZWtpXk5", file_id: id, expire_sec: 900 });
    const url = new URL(data.url);
    if (url.protocol !== "https:" || !(url.hostname.endsWith(".aliyunfile.com") || url.hostname.endsWith(".aliyuncs.com"))) throw new Error("组件下载地址无效");
    return limited(await this.fetchImpl(url, { signal: AbortSignal.timeout(20_000) }), limit);
  }
  async catalog(): Promise<SignedCatalog> {
    const result = await this.post("/v2/file/list", { share_id: "TunDZWtpXk5", parent_file_id: "6ae29fce1be7cd1e2f19477fbebef69d8e2b00aa", limit: 1, order_by: "created_at", order_direction: "DESC" });
    const file = result.items?.[0];
    if (!file || !/^assistants-\d+\.json$/.test(file.name)) throw new Error("尚无组件发布");
    if (this.catalogCache && this.catalogCache.id === file.file_id) return this.catalogCache.value;
    const value = JSON.parse((await this.download(file.file_id, 32 * 1024)).toString("utf8"));
    this.catalogCache = { id: file.file_id, value }; return value;
  }
  package(release: Release) { return this.download(release.fileId, release.size); }
}
