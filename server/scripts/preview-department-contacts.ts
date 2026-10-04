// Local verification only: actual directory router with static shell fixtures.
// It neither loads production credentials nor connects to a database.
import express from "express";
import { departmentContactsRouter } from "../src/routes/departmentContacts";
import { ok } from "../src/utils/response";
const app = express();
app.use("/api/tools/department-contacts", departmentContactsRouter);
app.get("/api/site/features", (_req, res) => ok(res, { forum: false, market: false,
  coursereview: false, electric: false, sponsor: false, forumLoginRequired: true, assistantEntry: true }));
app.get("/api/site/config", (_req, res) => ok(res, { siteOrigin: "", siteFilingNumber: "" }));
app.get("/api/site/navigation", (_req, res) => ok(res, [
  { id: "home", label: "首页", fullLabel: "首页", to: "/home", icon: "home", enabled: true, primary: true, showInDrawer: false, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
  { id: "services", label: "服务", fullLabel: "校园服务", to: "/services", icon: "service", enabled: true, primary: true, showInDrawer: true, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
]));
app.get("/api/tools", (_req, res) => ok(res, []));
app.get("/api/site/downloads/:name", (_req, res) => ok(res, { available: false, url: "", version: "", password: "" }));
app.get("/api/services", (_req, res) => ok(res, []));
app.post("/api/analytics/:name", (_req, res) => ok(res, {}));
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
  res.status(error.status || 500).json({ code: error.code || 1, data: null, message: error.message }));
const server = app.listen(18730, "127.0.0.1", () => console.log("Contacts verification API: http://127.0.0.1:18730"));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
