import { Router } from "express";
import { authOptional, authRequired } from "../middleware/auth";
import { authRouter } from "./auth";
import { userRouter } from "./user";
import { homeRouter } from "./home";
import { boardRouter } from "./board";
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
import { paymentsRouter } from "./payments";
import { qqBotRouter } from "./qqbot";
import { storageRouter } from "./storage";
import { weiwallAuthRouter } from "./weiwallAuth";

export const router = Router();

// 公开路径
router.use("/auth", authRouter);
router.use("/boards", boardRouter);
router.use("/topics", authOptional, topicRouter);
router.use("/replies", authOptional, replyRouter);
router.use("/services", servicesRouter);
router.use("/courses", courseRouter);
router.use("/search", searchRouter);
router.use("/home", homeRouter);
router.use("/site", siteRouter);
router.use("/storage", storageRouter);
router.use("/tools", toolsRouter);
router.use("/payments", paymentsRouter);
router.use("/qqbot", qqBotRouter);
router.use("/weiwall-auth", weiwallAuthRouter);

// 教务代登录：begin-login / login 公开，其余 handler 内部验 token
router.use("/jwxt", jwxtRouter);

// 站内登录后
router.use("/user", authRequired, userRouter);
router.use("/likes", authRequired, likeRouter);
router.use("/messages", authRequired, messageRouter);
router.use("/uploads", uploadRouter);

// 管理后台：需登录 + 内部按 role 分级
router.use("/admin", authRequired, adminRouter);
