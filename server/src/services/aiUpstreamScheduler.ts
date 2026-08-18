/** Keep a small amount of parallelism without allowing one Ollama instance to be flooded. */
const OLLAMA_MAX_ACTIVE_REQUESTS = 2;
export const OLLAMA_QUEUE_TIMEOUT_MS = 30_000;

type QueueEntry = {
  run: () => Promise<unknown>;
  holdActiveUntil?: (value: unknown) => Promise<void> | void;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  timer?: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
  settled: boolean;
};

type ProviderLane = {
  key: string;
  active: number;
  queue: QueueEntry[];
};

const providerLanes = new Map<string, ProviderLane>();

export class AiProviderBusyError extends Error {
  readonly code = "AI_PROVIDER_BUSY";
  readonly endpoint: string;

  constructor(endpoint: string) {
    super("AI 服务当前正在处理其他请求，请稍后重试或使用已配置的回退服务");
    this.name = "AiProviderBusyError";
    this.endpoint = endpoint;
  }
}

export function isAiProviderBusyError(error: unknown): error is AiProviderBusyError {
  return error instanceof AiProviderBusyError
    || (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "AI_PROVIDER_BUSY");
}

/** Ollama 默认会把同一实例的请求排队；把排队边界放到应用层，避免用户互相拖住。 */
export function runWithAiProviderIsolation<T>(input: {
  provider?: string;
  endpoint: string;
  signal?: AbortSignal;
  run: () => Promise<T>;
  /** Keep the provider slot occupied after run resolves, for example until an SSE body is consumed. */
  holdActiveUntil?: (value: T) => Promise<void> | void;
}): Promise<T> {
  if (!isOllamaProvider(input.provider, input.endpoint)) return input.run();
  if (input.signal?.aborted) return Promise.reject(input.signal.reason || createAbortError());

  const key = buildProviderLaneKey(input.endpoint);
  const lane = providerLanes.get(key) || { key, active: 0, queue: [] };
  providerLanes.set(key, lane);

  return new Promise<T>((resolve, reject) => {
    const entry: QueueEntry = {
      run: input.run as () => Promise<unknown>,
      holdActiveUntil: input.holdActiveUntil as ((value: unknown) => Promise<void> | void) | undefined,
      resolve: resolve as (value: unknown) => void,
      reject,
      signal: input.signal,
      settled: false,
    };
    const removeFromQueue = () => {
      const index = lane.queue.indexOf(entry);
      if (index >= 0) lane.queue.splice(index, 1);
    };
    const settleQueued = (error?: unknown) => {
      if (entry.settled) return;
      entry.settled = true;
      removeFromQueue();
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.onAbort) entry.signal?.removeEventListener("abort", entry.onAbort);
      if (error) entry.reject(error);
      drainProviderLane(lane);
      cleanupProviderLane(lane);
    };

    entry.onAbort = () => settleQueued(input.signal?.reason || createAbortError());
    input.signal?.addEventListener("abort", entry.onAbort, { once: true });
    if (input.signal?.aborted) {
      settleQueued(input.signal.reason || createAbortError());
      return;
    }
    entry.timer = setTimeout(() => {
      settleQueued(new AiProviderBusyError(input.endpoint));
    }, OLLAMA_QUEUE_TIMEOUT_MS);
    lane.queue.push(entry);
    drainProviderLane(lane);
  });
}

function drainProviderLane(lane: ProviderLane) {
  while (lane.active < OLLAMA_MAX_ACTIVE_REQUESTS && lane.queue.length) {
    const entry = lane.queue.shift();
    if (!entry || entry.settled) continue;
    entry.settled = true;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.onAbort) entry.signal?.removeEventListener("abort", entry.onAbort);
    lane.active += 1;
    Promise.resolve()
      .then(() => entry.run())
      .then((value) => {
        // Resolve the caller immediately so it can consume the response body;
        // the provider lane itself stays occupied until the body is finished.
        entry.resolve(value);
        return entry.holdActiveUntil?.(value);
      }, (error) => {
        entry.reject(error);
      })
      .catch(() => undefined)
      .finally(() => {
        lane.active = Math.max(0, lane.active - 1);
        drainProviderLane(lane);
        cleanupProviderLane(lane);
      });
  }
}

function cleanupProviderLane(lane: ProviderLane) {
  if (lane.active === 0 && lane.queue.length === 0 && providerLanes.get(lane.key) === lane) {
    providerLanes.delete(lane.key);
  }
}

function isOllamaProvider(provider: string | undefined, endpoint: string) {
  if (String(provider || "").trim().toLowerCase() === "ollama") return true;
  try {
    return new URL(endpoint).port === "11434";
  } catch {
    return false;
  }
}

function buildProviderLaneKey(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return `ollama:${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return `ollama:${String(endpoint || "").trim().toLowerCase()}`;
  }
}

function createAbortError() {
  const error = new Error("AI 请求已取消");
  error.name = "AbortError";
  return error;
}
