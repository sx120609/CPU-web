export type AcademicIdentityDetectionResult = {
  identity: "undergraduate" | "graduate";
  source: "detected" | "fallback";
  capabilities: {
    undergraduate: boolean;
    graduate: boolean;
  };
};

type ProbeResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

async function settle<T>(probe: () => Promise<T>): Promise<ProbeResult<T>> {
  try {
    return { status: "fulfilled", value: await probe() };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

function isUnauthorizedReason(reason: unknown) {
  const candidate = reason as { status?: unknown; code?: unknown } | null | undefined;
  return Number(candidate?.status || 0) === 401 || Number(candidate?.code || 0) === 4001;
}

/**
 * 研究生与本科入口共享同一份统一认证 CookieJar。
 *
 * 研究生账号可能没有本科教务权限，因此必须先探测研究生入口；一旦研究生入口
 * 可达，就不能再调用可能清理共享会话的本科探测。若研究生入口返回的是解析/
 * 上游错误，而本科入口返回 401，也优先保留研究生错误，避免前端把整套统一认证
 * 误判为过期并立刻退出。
 */
export async function detectAcademicIdentityFromProbes<TGraduate, TUndergraduate>(input: {
  probeGraduate: () => Promise<TGraduate>;
  probeUndergraduate: () => Promise<TUndergraduate>;
  isGraduateUsable: (value: TGraduate) => boolean;
  isUndergraduateUsable: (value: TUndergraduate) => boolean;
}): Promise<AcademicIdentityDetectionResult> {
  const graduate = await settle(input.probeGraduate);
  if (graduate.status === "fulfilled") {
    const usable = input.isGraduateUsable(graduate.value);
    return {
      identity: "graduate",
      source: usable ? "detected" : "fallback",
      capabilities: {
        undergraduate: false,
        // 能完成研究生入口请求就说明统一认证交接成功；没有课程也不应被踢出。
        graduate: true,
      },
    };
  }

  const undergraduate = await settle(input.probeUndergraduate);
  if (undergraduate.status === "fulfilled") {
    const usable = input.isUndergraduateUsable(undergraduate.value);
    return {
      identity: "undergraduate",
      source: usable ? "detected" : "fallback",
      capabilities: {
        undergraduate: usable,
        graduate: false,
      },
    };
  }

  if (isUnauthorizedReason(undergraduate.reason) && !isUnauthorizedReason(graduate.reason)) {
    throw graduate.reason;
  }
  throw undergraduate.reason;
}
