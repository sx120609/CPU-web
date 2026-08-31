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

export function isRecognizableUndergraduateSchedule(value: {
  title?: unknown;
  pageRecognized?: unknown;
  currentSemester?: unknown;
  semesters?: unknown[];
  cells?: unknown[];
} | null | undefined) {
  return Boolean(
    value?.pageRecognized === true
    || String(value?.currentSemester ?? "").trim()
    || (Array.isArray(value?.semesters) && value.semesters.length)
    || (Array.isArray(value?.cells) && value.cells.length)
  );
}

/**
 * 研究生与本科入口共享同一份统一认证 CookieJar。
 *
 * 研究生账号可能没有本科教务权限，因此先探测研究生入口。只有研究生数据可用时
 * 才能提前结束；空响应还要继续验证本科入口，避免把本科账号误判成尚未开通。
 * 若研究生入口返回的是解析/上游错误，而本科入口返回 401，优先保留研究生错误，
 * 避免前端把整套统一认证误判为过期并立刻退出。
 */
export async function detectAcademicIdentityFromProbes<TGraduate, TUndergraduate>(input: {
  probeGraduate: () => Promise<TGraduate>;
  probeUndergraduate: () => Promise<TUndergraduate>;
  isGraduateUsable: (value: TGraduate) => boolean;
  isUndergraduateUsable: (value: TUndergraduate) => boolean;
}): Promise<AcademicIdentityDetectionResult> {
  const graduate = await settle(input.probeGraduate);
  const graduateUsable = graduate.status === "fulfilled"
    ? input.isGraduateUsable(graduate.value)
    : false;
  if (graduateUsable) {
    return {
      identity: "graduate",
      source: "detected",
      capabilities: {
        undergraduate: false,
        graduate: true,
      },
    };
  }

  const undergraduate = await settle(input.probeUndergraduate);
  if (undergraduate.status === "fulfilled") {
    const usable = input.isUndergraduateUsable(undergraduate.value);
    if (!usable && graduate.status === "fulfilled") {
      return {
        identity: "graduate",
        source: "fallback",
        capabilities: {
          undergraduate: false,
          graduate: false,
        },
      };
    }
    return {
      identity: "undergraduate",
      source: usable ? "detected" : "fallback",
      capabilities: {
        undergraduate: usable,
        graduate: false,
      },
    };
  }

  if (graduate.status === "fulfilled") {
    if (isUnauthorizedReason(undergraduate.reason)) throw undergraduate.reason;
    return {
      identity: "graduate",
      source: "fallback",
      capabilities: {
        undergraduate: false,
        graduate: false,
      },
    };
  }
  if (isUnauthorizedReason(undergraduate.reason) && !isUnauthorizedReason(graduate.reason)) {
    throw graduate.reason;
  }
  throw undergraduate.reason;
}
