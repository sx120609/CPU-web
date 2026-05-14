import { Router } from "express";
import { authRequired } from "../middleware/auth";
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

export const router = Router();

// 公开路径
router.use("/auth", authRouter);
router.use("/boards", boardRouter);
router.use("/topics", topicRouter);
router.use("/replies", replyRouter);
router.use("/services", servicesRouter);
router.use("/courses", courseRouter);
router.use("/search", searchRouter);

// 教务代登录：begin-login / login 公开，其余 handler 内部验 token
router.use("/jwxt", jwxtRouter);

// 站内登录后
router.use("/user", authRequired, userRouter);
router.use("/home", authRequired, homeRouter);
router.use("/likes", authRequired, likeRouter);
router.use("/messages", authRequired, messageRouter);
