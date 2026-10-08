import type { JwxtAgentConfig } from "../config";

/**
 * /api/ready 对外公布的教务 Agent 概况，供部署在别处的状态监控读取。
 * 只给数量：节点名称、地址、版本和身份仍然只在管理后台可见。
 * 统计口径与教务查询池一致，即已启用且承担教务的 Agent；在线指已连接并完成握手、可以接任务。
 */
export function summarizeJwxtAgents(
  agents: Pick<JwxtAgentConfig, "id" | "enabled" | "jwxtEnabled">[],
  stateOf: (agentId: string) => { ready: boolean },
) {
  const serving = agents.filter((agent) => agent.enabled && agent.jwxtEnabled);
  return {
    total: serving.length,
    online: serving.filter((agent) => stateOf(agent.id).ready).length,
  };
}
