import type { NativeDormSync } from "@/utils/nativeDormSync";
import type { DormSyncNowResult } from "@/views/schedule/dormSync";

export interface NativeDormOfferDeps {
  /** 当前登录的站内账号；没登录时为空。 */
  userId: () => number | null | undefined;
  /** 原生课表按它区分账号（`nativeScheduleAccountKey()`）；没登录时为空。 */
  accountKey: () => string;
  /** 共用的同步状态，第一次要动态加载。 */
  sync: () => Promise<NativeDormSync>;
}

/**
 * `CPUTimeNativeDorm` 的 offer：快照绑定**收到请求时**的账号。加载同步模块的这段时间里换了账号，
 * 旧账号的课表不能记到新账号名下。这个文件只有类型依赖，桥可以静态引入，在任何等待之前取到账号。
 */
export async function offerNativeDormSnapshot(
  request: { snapshot?: unknown; account?: string; force?: boolean },
  deps: NativeDormOfferDeps,
): Promise<DormSyncNowResult> {
  const userId = deps.userId();
  const key = userId ? deps.accountKey() : "";
  if (!userId || !key) return "unavailable";
  if (request.account && request.account !== key) return "skipped";
  const sync = await deps.sync();
  if (deps.userId() !== userId || deps.accountKey() !== key) return "skipped";
  return sync.offer(request.snapshot, { force: request.force === true, userId });
}

export type NativeDormRequest = {
  action?: string;
  snapshot?: unknown;
  account?: string;
  force?: boolean;
  code?: string;
};

export type NativeDormReply = { result: string } | { missing: true } | { error: string };

export interface NativeDormRequestDeps extends NativeDormOfferDeps {
  /** 页面的登录状态已经恢复。 */
  ready: () => boolean;
  /** 等登录状态恢复；等不到时为 false。 */
  settled: () => Promise<boolean>;
  open: (code?: string) => Promise<unknown>;
}

/**
 * `CPUTimeNativeDorm` 的分发。登录状态已恢复时 offer 不经过任何等待，账号就是收到请求那一刻的账号。
 * 还没恢复时，不带 account 的快照认不出是谁的，不收（原生课表下次稳定时会再交）；带 account 的等登录恢复后按它核对。
 */
export async function handleNativeDormRequest(request: NativeDormRequest | null | undefined, deps: NativeDormRequestDeps): Promise<NativeDormReply> {
  const input = request ?? {};
  try {
    if (input.action === "offer") {
      if (!deps.ready()) {
        if (!input.account) return { result: "unavailable" };
        if (!(await deps.settled())) return { missing: true };
      }
      return { result: await offerNativeDormSnapshot(input, deps) };
    }
    if (!(await deps.settled())) return { missing: true };
    if (input.action === "open") {
      await deps.open(input.code);
      return { result: "opened" };
    }
    return { error: "不支持的宿舍课表操作" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "宿舍课表暂时不可用" };
  }
}
