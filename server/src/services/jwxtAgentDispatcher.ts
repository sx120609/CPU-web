import { z } from "zod";
import { Errors } from "../utils/response";
import * as jwxt from "./jwxtFacade";
import { crawlSchoolFeedSource } from "./schoolCrawlerCore";
import type { JwxtAgentAction } from "./jwxtAgentProtocol";

const emptySchema = z.object({}).strict();
const loginSchema = z.object({
  pendingId: z.string().min(8).max(2048),
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(1024),
  captcha: z.string().max(64).optional(),
}).strict();
const tokenSchema = z.object({ token: z.string().min(1).max(512) }).strict();
const handoffSchema = z.object({
  handoff: z.object({
    id: z.string().min(32).max(128),
    callbackUrl: z.string().url().max(4096),
    cookies: z.record(z.record(z.string())),
    username: z.string().min(1).max(128),
    issuedAt: z.number().int(),
  }).strict(),
}).strict();

export async function dispatchJwxtAgentAction(action: JwxtAgentAction, payload: unknown): Promise<unknown> {
  switch (action) {
    case "login.begin":
      emptySchema.parse(payload);
      return jwxt.beginLogin();
    case "login.submit-handoff":
      return jwxt.submitLoginForHandoff(loginSchema.parse(payload));
    case "login.submit-legacy":
      return jwxt.submitLogin(loginSchema.parse(payload));
    case "session.consume-handoff": {
      const input = handoffSchema.parse(payload);
      return jwxt.consumeLoginHandoff(input.handoff);
    }
    case "session.logout":
      return jwxt.logout(tokenSchema.parse(payload).token);
    case "session.status": {
      const input = z.object({ token: z.string().min(1).max(512).nullish() }).strict().parse(payload);
      return jwxt.getStatus(input.token);
    }
    case "session.stats":
      emptySchema.parse(payload);
      return jwxt.sessionStats();
    case "jwxt.schedule": {
      const input = tokenSchema.extend({ semester: z.string().max(64).optional(), week: z.string().max(16).optional() }).parse(payload);
      return jwxt.getSchedule(input.token, input);
    }
    case "jwxt.grades": {
      const input = tokenSchema.extend({ semester: z.string().max(64).optional() }).parse(payload);
      return jwxt.getGrades(input.token, input);
    }
    case "jwxt.midterm-grades": {
      const input = tokenSchema.extend({ semester: z.string().max(64).optional() }).parse(payload);
      return jwxt.getMidtermGrades(input.token, input);
    }
    case "jwxt.exams": {
      const input = tokenSchema.extend({ semester: z.string().max(64).optional(), type: z.string().max(32).optional() }).parse(payload);
      return jwxt.getExams(input.token, input);
    }
    case "jwxt.calendar":
      return jwxt.getCalendar(tokenSchema.parse(payload).token);
    case "jwxt.progress":
      return jwxt.getProgress(tokenSchema.parse(payload).token);
    case "jwxt.pyfa":
      return jwxt.getPyfa(tokenSchema.parse(payload).token);
    case "jwxt.iapps":
      return jwxt.getIApps(tokenSchema.parse(payload).token);
    case "jwxt.graduate-schedule": {
      const input = tokenSchema.extend({ semester: z.string().max(64).optional(), termcode: z.string().max(64).optional() }).parse(payload);
      return jwxt.getGraduateSchedule(input.token, input);
    }
    case "jwxt.debug-snapshot":
      return jwxt.debugSnapshot(tokenSchema.parse(payload).token);
    case "school-feed.crawl": {
      const input = z.object({
        source: z.object({
          slug: z.string().min(1).max(128),
          listUrl: z.string().url().max(4096),
          maxPages: z.number().int().min(1).max(10),
        }).strict(),
        skipExternalIds: z.array(z.string().max(512)).max(10_000).optional(),
        dryRun: z.boolean().optional(),
      }).strict().parse(payload);
      return crawlSchoolFeedSource(input.source, {
        skipExternalIds: input.skipExternalIds,
        dryRun: input.dryRun,
      });
    }
    default:
      throw Errors.badRequest("Agent 不支持该教务操作");
  }
}
