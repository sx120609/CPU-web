import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import {
  beginLogin,
  submitLogin,
  logout,
  getStatus,
  sessionStats,
  getSchedule,
  getGrades,
  getMidtermGrades,
  getExams,
  getCalendar,
  getProgress,
  getPyfa,
  getIApps,
  getGraduateSchedule,
  debugSnapshot,
} from "../services/jwxtFacade";
import { crawlSchoolFeedSource } from "../services/schoolCrawlerCore";

export const proxyJwxtRouter = Router();

const tokenSchema = z.object({ token: z.string().min(1) });

proxyJwxtRouter.get("/health", (_req, res) => {
  res.json({ ok: true });
});

proxyJwxtRouter.use((req, _res, next) => {
  if (!config.proxyAuth) return next();
  if (req.get("X-Proxy-Auth") !== config.proxyAuth) return next(Errors.unauthorized("代理鉴权失败"));
  return next();
});

proxyJwxtRouter.post("/v1/begin-login", async (_req, res, next) => {
  try {
    ok(res, await beginLogin());
  } catch (e) { next(e); }
});

proxyJwxtRouter.post(
  "/v1/login",
  validate(z.object({
    pendingId: z.string().min(8),
    username: z.string().min(1),
    password: z.string().min(1),
    captcha: z.string().optional(),
  })),
  async (req, res, next) => {
    try {
      ok(res, await submitLogin(req.body));
    } catch (e) { next(e); }
  },
);

proxyJwxtRouter.post("/v1/logout", validate(tokenSchema), async (req, res, next) => {
  try {
    ok(res, { ok: await logout(req.body.token) });
  } catch (e) { next(e); }
});

proxyJwxtRouter.post("/v1/status", async (req, res, next) => {
  try {
    ok(res, await getStatus(req.body?.token));
  } catch (e) { next(e); }
});

proxyJwxtRouter.post(
  "/v1/schedule",
  validate(tokenSchema.extend({ semester: z.string().optional(), week: z.string().optional() })),
  async (req, res, next) => {
    try {
      const { token, semester, week } = req.body;
      ok(res, { parsed: await getSchedule(token, { semester, week }) });
    } catch (e) { next(e); }
  },
);

proxyJwxtRouter.post(
  "/v1/grades",
  validate(tokenSchema.extend({ semester: z.string().optional() })),
  async (req, res, next) => {
    try {
      const { token, semester } = req.body;
      ok(res, { parsed: await getGrades(token, { semester }) });
    } catch (e) { next(e); }
  },
);

proxyJwxtRouter.post(
  "/v1/midterm-grades",
  validate(tokenSchema.extend({ semester: z.string().optional() })),
  async (req, res, next) => {
    try {
      const { token, semester } = req.body;
      ok(res, { parsed: await getMidtermGrades(token, { semester }) });
    } catch (e) { next(e); }
  },
);

proxyJwxtRouter.post(
  "/v1/exams",
  validate(tokenSchema.extend({ semester: z.string().optional(), type: z.string().optional() })),
  async (req, res, next) => {
    try {
      const { token, semester, type } = req.body;
      ok(res, { parsed: await getExams(token, { semester, type }) });
    } catch (e) { next(e); }
  },
);

proxyJwxtRouter.post("/v1/calendar", validate(tokenSchema), async (req, res, next) => {
  try {
    ok(res, { parsed: await getCalendar(req.body.token) });
  } catch (e) { next(e); }
});

proxyJwxtRouter.post("/v1/progress", validate(tokenSchema), async (req, res, next) => {
  try {
    ok(res, { parsed: await getProgress(req.body.token) });
  } catch (e) { next(e); }
});

proxyJwxtRouter.post("/v1/pyfa", validate(tokenSchema), async (req, res, next) => {
  try {
    ok(res, { parsed: await getPyfa(req.body.token) });
  } catch (e) { next(e); }
});

proxyJwxtRouter.post("/v1/iapps", validate(tokenSchema), async (req, res, next) => {
  try {
    ok(res, { apps: await getIApps(req.body.token) });
  } catch (e) { next(e); }
});

proxyJwxtRouter.post(
  "/v1/graduate-schedule",
  validate(tokenSchema.extend({ semester: z.string().optional(), termcode: z.string().optional() })),
  async (req, res, next) => {
    try {
      const { token, semester, termcode } = req.body;
      ok(res, await getGraduateSchedule(token, { semester, termcode }));
    } catch (e) { next(e); }
  },
);

proxyJwxtRouter.post("/v1/debug-snapshot", validate(tokenSchema), async (req, res, next) => {
  try {
    ok(res, await debugSnapshot(req.body.token));
  } catch (e) { next(e); }
});

proxyJwxtRouter.get("/v1/stats", async (_req, res, next) => {
  try {
    ok(res, await sessionStats());
  } catch (e) { next(e); }
});

proxyJwxtRouter.post(
  "/v1/school-feed/crawl",
  validate(z.object({
    source: z.object({
      slug: z.string().min(1),
      listUrl: z.string().min(1),
      maxPages: z.number().int().min(1).max(10),
    }),
    skipExternalIds: z.array(z.string()).optional(),
    dryRun: z.boolean().optional(),
  })),
  async (req, res, next) => {
    try {
      const { source, skipExternalIds, dryRun } = req.body;
      ok(res, await crawlSchoolFeedSource(source, { skipExternalIds, dryRun }));
    } catch (e) { next(e); }
  },
);
