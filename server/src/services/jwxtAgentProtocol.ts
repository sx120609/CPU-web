import type * as jwxt from "./jwxtFacade";
import type { JwxtSessionSnapshot, LoginHandoffAttempt, LoginSessionHandoff } from "./jwxtClient";
import type { CrawlSchoolFeedResult, SchoolFeedSourceInput } from "./schoolCrawlerCore";
import type { AgentEncryptedLoginCredentials, AgentEncryptedSessionReplica, AgentReplicaRecipient } from "./jwxtAgentReplicaCrypto";

// 会话快照是 v1 上的可选扩展字段，保持协议号不变以支持主服务与 Agent 滚动升级。
export const JWXT_AGENT_PROTOCOL_VERSION = 2;

export type JwxtAgentActionMap = {
  "login.begin": {
    input: Record<string, never>;
    output: Awaited<ReturnType<typeof jwxt.beginLogin>>;
  };
  "login.submit-handoff": {
    input: Parameters<typeof jwxt.submitLoginForHandoff>[0];
    output: LoginHandoffAttempt;
  };
  "login.submit-legacy": {
    input: Parameters<typeof jwxt.submitLogin>[0];
    output: Awaited<ReturnType<typeof jwxt.submitLogin>>;
  };
  "login.submit-handoff-encrypted": {
    input: { pendingId: string; credentials: AgentEncryptedLoginCredentials };
    output: LoginHandoffAttempt & { authenticatedUsername?: string };
  };
  "login.submit-legacy-encrypted": {
    input: { pendingId: string; credentials: AgentEncryptedLoginCredentials };
    output: Awaited<ReturnType<typeof jwxt.submitLogin>> & { authenticatedUsername?: string };
  };
  "session.consume-handoff": {
    input: { handoff: LoginSessionHandoff };
    output: string;
  };
  "session.logout": { input: { token: string }; output: boolean };
  "session.status": {
    input: { token?: string | null };
    output: Awaited<ReturnType<typeof jwxt.getStatus>>;
  };
  "session.stats": {
    input: Record<string, never>;
    output: Awaited<ReturnType<typeof jwxt.sessionStats>>;
  };
  "session.export-snapshot": {
    input: { token: string };
    output: JwxtSessionSnapshot | null;
  };
  "session.import-snapshot": {
    input: { token: string; snapshot: JwxtSessionSnapshot };
    output: boolean;
  };
  "session.import-encrypted-snapshot": {
    input: { token: string; replica: AgentEncryptedSessionReplica };
    output: boolean;
  };
  "jwxt.schedule": {
    input: { token: string; semester?: string; week?: string };
    output: Awaited<ReturnType<typeof jwxt.getSchedule>>;
  };
  "jwxt.grades": {
    input: { token: string; semester?: string };
    output: Awaited<ReturnType<typeof jwxt.getGrades>>;
  };
  "jwxt.midterm-grades": {
    input: { token: string; semester?: string };
    output: Awaited<ReturnType<typeof jwxt.getMidtermGrades>>;
  };
  "jwxt.exams": {
    input: { token: string; semester?: string; type?: string };
    output: Awaited<ReturnType<typeof jwxt.getExams>>;
  };
  "jwxt.calendar": { input: { token: string; semester?: string }; output: Awaited<ReturnType<typeof jwxt.getCalendar>> };
  "jwxt.progress": { input: { token: string }; output: Awaited<ReturnType<typeof jwxt.getProgress>> };
  "jwxt.pyfa": { input: { token: string }; output: Awaited<ReturnType<typeof jwxt.getPyfa>> };
  "jwxt.iapps": { input: { token: string }; output: Awaited<ReturnType<typeof jwxt.getIApps>> };
  "jwxt.graduate-schedule": {
    input: { token: string; semester?: string; termcode?: string };
    output: Awaited<ReturnType<typeof jwxt.getGraduateSchedule>>;
  };
  "jwxt.debug-snapshot": {
    input: { token: string };
    output: Awaited<ReturnType<typeof jwxt.debugSnapshot>>;
  };
  "school-feed.crawl": {
    input: { source: SchoolFeedSourceInput; skipExternalIds?: string[]; dryRun?: boolean };
    output: CrawlSchoolFeedResult;
  };
};

export type JwxtAgentAction = keyof JwxtAgentActionMap;
export type JwxtAgentInput<A extends JwxtAgentAction> = JwxtAgentActionMap[A]["input"];
export type JwxtAgentOutput<A extends JwxtAgentAction> = JwxtAgentActionMap[A]["output"];

export type JwxtAgentWelcomeMessage = {
  type: "welcome";
  protocolVersion: number;
  heartbeatMs: number;
  agent: {
    id: string;
    name: string;
    maxConcurrent: number;
    jwxtEnabled: boolean;
    crawlEnabled: boolean;
  };
};

export type JwxtAgentReadyMessage = {
  type: "ready";
  protocolVersion: number;
  replicaPublicKey: string;
};

export type JwxtAgentReplicaTargetsMessage = {
  type: "replica-targets";
  targets: AgentReplicaRecipient[];
};

export type JwxtAgentRequestMessage = {
  type: "request";
  id: string;
  action: JwxtAgentAction;
  payload: unknown;
};

export type JwxtAgentResponseMessage = {
  type: "response";
  id: string;
  ok: boolean;
  data?: unknown;
  error?: { status: number; code: number; message: string };
  encryptedSessionReplicas?: AgentEncryptedSessionReplica[];
};

export function jwxtActionSessionToken(action: JwxtAgentAction, payload: unknown, output?: unknown) {
  if (action === "session.consume-handoff" && typeof output === "string") return output;
  if (action === "login.submit-legacy" || action === "login.submit-legacy-encrypted") {
    const token = (output as { token?: unknown } | null)?.token;
    return typeof token === "string" ? token : "";
  }
  if (
    action === "session.logout"
    || action === "session.status"
    || action === "session.export-snapshot"
    || action === "session.import-snapshot"
    || action === "session.import-encrypted-snapshot"
    || action.startsWith("jwxt.")
  ) {
    const token = (payload as { token?: unknown } | null)?.token;
    return typeof token === "string" ? token : "";
  }
  return "";
}

export type JwxtAgentWireMessage =
  | JwxtAgentWelcomeMessage
  | JwxtAgentReadyMessage
  | JwxtAgentReplicaTargetsMessage
  | JwxtAgentRequestMessage
  | JwxtAgentResponseMessage;
