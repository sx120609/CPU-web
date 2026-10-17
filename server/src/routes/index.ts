import { Router, type RequestHandler } from "express";
import { authOptional, authRequired } from "../middleware/auth";
import { authRouter } from "./auth";
import { userRouter } from "./user";
import { homeRouter } from "./home";
import { boardRouter } from "./board";
import { announcementsRouter } from "./announcements";
import { topicRouter } from "./topic";
import { replyRouter } from "./reply";
import { likeRouter } from "./like";
import { courseRouter } from "./course";
import { servicesRouter } from "./services";
import { messageRouter } from "./message";
import { searchRouter } from "./search";
import { jwxtRouter } from "./jwxt";
import { adminRouter } from "./admin";
import { siteRouter } from "./site";
import { uploadRouter } from "./upload";
import { toolsRouter } from "./tools";
import { departmentContactsRouter } from "./departmentContacts";
import { paymentsRouter } from "./payments";
import { qqBotRouter } from "./qqbot";
import { storageRouter } from "./storage";
import { courseBotRouter } from "./courseBot";
import { zhihuishuRouter } from "./zhihuishu";
import { lostFoundRouter } from "./lostFound";
import { integrationsRouter } from "./integrations";
import { oauthRouter } from "./oauth";
import { forumAdsRouter } from "./forumAds";
import { vipRouter } from "./vip";
import { wechatRouter } from "./wechat";
import { userAvatarRouter } from "./userAvatar";
import { directMessageRouter } from "./directMessage";
import { forumReportRouter } from "./forumReport";
import { accountVerificationRouter } from "./accountVerification";
import { yaodaFlightRouter } from "./yaodaFlight";
import { tomatoNoodleRouter } from "./tomatoNoodle";
import { zombieDefenseRouter } from "./zombieDefense";
import { yaodaNaiRouter } from "./yaodaNai";
import { greedyNailongRouter } from "./greedyNailong";
import { privacyRouter } from "./privacy";
import { revokedCredentialGate } from "../middleware/revokedCredential";
import { scheduleShareRouter } from "./scheduleShares";
import { liveActivityRouter } from "./liveActivities";
import { appClientRouter } from "./appClients";
import { coupleRouter } from "./couple";

export const router = Router();
export const apiAdmissionPaths: string[] = [];
function mount(path: string, ...handlers: RequestHandler[]) {
  apiAdmissionPaths.push('/api' + path);
  router.use(path, ...handlers);
}
mount("/privacy", privacyRouter);
mount("/schedule-shares", scheduleShareRouter);
mount("/live-activities", liveActivityRouter);
mount("/app-clients", authOptional, appClientRouter);

// 公开路径
mount("/auth", authRouter);
mount("/user-avatars", userAvatarRouter);
mount("/boards", authOptional, boardRouter);
mount("/announcements", announcementsRouter);
mount("/topics", authOptional, topicRouter);
mount("/replies", authOptional, replyRouter);
mount("/services", servicesRouter);
mount("/courses", authOptional, courseRouter);
mount("/search", authOptional, searchRouter);
mount("/home", authOptional, homeRouter);
mount("/site", siteRouter);
mount("/forum-ads", forumAdsRouter);
mount("/vip", vipRouter);
mount("/storage", storageRouter);
mount("/tools/yaoda-can-fly", yaodaFlightRouter);
mount("/tools/tomato-egg-noodles", tomatoNoodleRouter);
mount("/tools/zombie-defense", zombieDefenseRouter);
mount("/tools/yaoda-nai", yaodaNaiRouter);
mount("/tools/greedy-nailong", greedyNailongRouter);
mount("/tools/department-contacts", departmentContactsRouter);
mount("/tools", toolsRouter);
mount("/payments", paymentsRouter);
mount("/qqbot", qqBotRouter);
mount("/wechat", wechatRouter);
mount("/course-bot/zhihuishu", authRequired, zhihuishuRouter);
mount("/course-bot", authRequired, courseBotRouter);
mount("/lost-found", lostFoundRouter);
mount("/integrations", integrationsRouter);
mount("/oauth", oauthRouter);

// 教务代登录：begin-login / login 公开，其余 handler 内部验 token
mount("/jwxt", revokedCredentialGate, jwxtRouter);

// 站内登录后
mount("/user", authRequired, userRouter);
mount("/likes", authRequired, likeRouter);
mount("/messages", authRequired, messageRouter);
mount("/direct-messages", authRequired, directMessageRouter);
mount("/couple", authRequired, coupleRouter);
mount("/forum-reports", authRequired, forumReportRouter);
mount("/account-verification", authRequired, accountVerificationRouter);
mount("/uploads", authOptional, uploadRouter);

// 管理后台：需登录 + 内部按 role 分级
mount("/admin", authRequired, adminRouter);
