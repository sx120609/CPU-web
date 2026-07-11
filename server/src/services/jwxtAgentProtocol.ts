import type * as jwxt from "./jwxtFacade";
import type { LoginHandoffAttempt, LoginSessionHandoff } from "./jwxtClient";
import type { CrawlSchoolFeedResult, SchoolFeedSourceInput } from "./schoolCrawlerCore";

export const JWXT_AGENT_PROTOCOL_VERSION = 1;

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
  "jwxt.calendar": { input: { token: string }; output: Awaited<ReturnType<typeof jwxt.getCalendar>> };
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
};

export type JwxtAgentWireMessage =
  | JwxtAgentWelcomeMessage
  | JwxtAgentReadyMessage
  | JwxtAgentRequestMessage
  | JwxtAgentResponseMessage;
