import { Router } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "../prisma";
import { authOptional } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";

// 三维校园联机：只在内存里保存正在自由探索的人的位置，不落库、不记历史。
// 客户端每 ~250 ms 用一次 sync 上报自己的位置并取回附近的人；12 秒没有上报就视为离开。
// 对外只暴露随机的 pid 和昵称，不暴露账号 id；sid + key 只给本人，用来证明"这是我"。

export const campus3dPresenceRouter = Router();

type Player = {
  sid: string;
  key: Buffer;
  pid: string;
  name: string;
  state: number[] | null;
  hidden: boolean;
  lastSync: number;
};

const players = new Map<string, Player>();
const MAX_PLAYERS = 400;
const STALE_MS = 12_000;
const NEAR_M = 600;
const MAX_RETURNED = 40;

function sweep(now = Date.now()) {
  for (const [sid, p] of players) if (now - p.lastSync > STALE_MS) players.delete(sid);
}

function cleanName(nickname: string | null | undefined) {
  const n = String(nickname || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 16);
  return n || "药大同学";
}

function findPlayer(sid: string, key: string) {
  const p = players.get(sid);
  if (!p) return null;
  const given = Buffer.from(key, "hex");
  if (given.length !== p.key.length || !timingSafeEqual(given, p.key)) return null;
  return p;
}

const credsSchema = z.object({
  sid: z.string().regex(/^[0-9a-f]{24}$/),
  key: z.string().regex(/^[0-9a-f]{32}$/),
});

// [x, y, z, heading, mode, colour, speed]; mode 0 walk, 1 swim, 2 drive, 3 ride
const syncSchema = credsSchema.extend({
  s: z.tuple([
    z.number().finite().min(-3000).max(3000),
    z.number().finite().min(-20).max(200),
    z.number().finite().min(-3000).max(3000),
    z.number().finite().min(-100).max(100),
    z.number().int().min(0).max(3),
    z.number().int().min(0).max(15),
    z.number().finite().min(-60).max(60),
  ]),
  h: z.boolean().optional(),
});

campus3dPresenceRouter.post("/join", authOptional, async (req, res, next) => {
  try {
    sweep();
    if (players.size >= MAX_PLAYERS) throw Errors.badRequest("校园里人太多了，稍后再试");
    let name = `游客${100 + Math.floor(Math.random() * 900)}`;
    if (req.user) {
      const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { nickname: true, status: true } });
      if (!user || user.status === "banned") throw Errors.forbidden("当前账号不能使用联机");
      name = cleanName(user.nickname);
    }
    const sid = randomBytes(12).toString("hex"), key = randomBytes(16);
    const player: Player = { sid, key, pid: randomBytes(4).toString("hex"), name, state: null, hidden: false, lastSync: Date.now() };
    players.set(sid, player);
    ok(res, { sid, key: key.toString("hex"), pid: player.pid, name });
  } catch (error) {
    next(error);
  }
});

campus3dPresenceRouter.post("/sync", validate(syncSchema), (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof syncSchema>;
    const me = findPlayer(body.sid, body.key);
    if (!me) throw Errors.notFound("联机已断开，请重新进入");
    const now = Date.now();
    me.state = body.s.map((v, i) => (i === 4 || i === 5 ? v : Math.round(v * 100) / 100));
    me.hidden = Boolean(body.h);
    me.lastSync = now;
    if (Math.random() < 0.05) sweep(now);
    const [x, , z] = me.state;
    const near: Array<[number, Player]> = [];
    for (const p of players.values()) {
      if (p === me || p.hidden || !p.state || now - p.lastSync > STALE_MS) continue;
      const d = Math.hypot(p.state[0] - x, p.state[2] - z);
      if (d < NEAR_M) near.push([d, p]);
    }
    near.sort((a, b) => a[0] - b[0]);
    ok(res, {
      t: now,
      n: players.size,
      p: near.slice(0, MAX_RETURNED).map(([, p]) => [p.pid, p.name, ...(p.state as number[])]),
    });
  } catch (error) {
    next(error);
  }
});

campus3dPresenceRouter.post("/leave", validate(credsSchema), (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof credsSchema>;
    if (findPlayer(body.sid, body.key)) players.delete(body.sid);
    ok(res, {});
  } catch (error) {
    next(error);
  }
});
