// 公开接口的源站减负工具：不按 IP 区分访问者（校园网成千上万人共用一个出口），
// 只限制源站自身要做的工作量——相同内容只算一次，昂贵操作的并发与排队都有上限。

/** 进程内 TTL + LRU 缓存，条数与近似字节数都有上限；同一 key 的并发未命中只执行一次 loader。值不能是 undefined（它表示未命中）。 */
export class TtlLru<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number; bytes: number }>();
  private readonly inflight = new Map<string, Promise<V>>();
  private bytes = 0;

  constructor(private readonly options: { maxEntries: number; maxBytes?: number; sizeOf?: (value: V) => number }) {}

  get size() {
    return this.entries.size;
  }

  get(key: string, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.delete(key);
      return undefined;
    }
    // 命中后移到队尾，维持 LRU 顺序。
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number, now = Date.now()) {
    this.delete(key);
    const bytes = this.options.sizeOf?.(value) ?? 0;
    if (this.options.maxBytes !== undefined && bytes > this.options.maxBytes) return;
    this.entries.set(key, { value, expiresAt: now + Math.max(1, ttlMs), bytes });
    this.bytes += bytes;
    for (const [oldest, entry] of this.entries) {
      if (this.entries.size <= this.options.maxEntries && (this.options.maxBytes === undefined || this.bytes <= this.options.maxBytes)) break;
      this.entries.delete(oldest);
      this.bytes -= entry.bytes;
    }
  }

  delete(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
  }

  /** 读缓存；未命中时合并同 key 的并发请求，只调用一次 loader。loader 抛错不缓存。 */
  load(key: string, ttlMs: number | ((value: V) => number), loader: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = (async () => {
      const value = await loader();
      this.set(key, value, typeof ttlMs === "function" ? ttlMs(value) : ttlMs);
      return value;
    })();
    this.inflight.set(key, promise);
    const cleanup = () => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    };
    promise.then(cleanup, cleanup);
    return promise;
  }
}

export class ConcurrencyGateFullError extends Error {
  constructor() {
    super("concurrency gate is full");
    this.name = "ConcurrencyGateFullError";
  }
}

/** 最多同时运行 concurrency 个任务，最多排队 maxQueue 个；队列满时立即拒绝，不让请求在内存里越堆越多。 */
export class ConcurrencyGate {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly concurrency: number, private readonly maxQueue: number) {}

  get active() {
    return this.running;
  }

  get queued() {
    return this.queue.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      if (this.queue.length >= this.maxQueue) throw new ConcurrencyGateFullError();
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await task();
    } finally {
      // 名额直接交给下一个排队者；没人排队才释放。
      const next = this.queue.shift();
      if (next) next();
      else this.running -= 1;
    }
  }
}
