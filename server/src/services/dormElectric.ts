/** 主服务侧宿舍用电查询：缓存结果并交给校内出站 Agent 执行。 */
import { withCache } from "./cache";
import { requestAnyRemoteQueryAgent } from "./jwxtAgentRemote";
import type { DormElectricResult } from "./dormElectricCampus";

export type { DormElectricResult } from "./dormElectricCampus";

const CACHE_TTL_MS = 30_000;

export async function queryDormElectric(studentNo: string): Promise<DormElectricResult> {
  if (!studentNo) throw new Error("学号为空");
  return withCache("dorm-electric", [studentNo], CACHE_TTL_MS, () => (
    requestAnyRemoteQueryAgent("dorm-electric.query", { studentNo })
  ));
}
