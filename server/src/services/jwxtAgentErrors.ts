import { HttpError } from "../utils/response";

export const AgentErrorCode = {
  offline: 5301, busy: 5302, timeout: 5303, transport: 5304,
  gateway: 5305, recovering: 5306, replicaUnavailable: 5307,
} as const;

export function sessionFailureReason(error: unknown) {
  if (!(error instanceof HttpError)) return null;
  if (error.status === 401) return "session_missing";
  if (error.code === AgentErrorCode.offline) return "agent_offline";
  if (error.code === AgentErrorCode.transport) return "agent_transport";
  // Compatibility during a rolling upgrade. Never classify upstream 5xx or busy as node failure.
  if (error.status >= 500 && /教务 Agent .*当前离线|教务 Agent .*已断开|教务 Agent .*发送失败/.test(error.message)) return "agent_offline";
  return null;
}
