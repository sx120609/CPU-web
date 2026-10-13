import bcrypt from "bcryptjs";
import { ConcurrencyGate, ConcurrencyGateFullError } from "./loadShield";
import { Errors } from "./response";

// bcryptjs 是纯 JS 实现，每次校验都在主线程上消耗几十毫秒 CPU；登录入口公开，必须限制同时进行的数量，
// 否则洪泛密码登录就能把整个进程的 CPU 占满。
const passwordGate = new ConcurrencyGate(4, 64);

async function throughPasswordGate<T>(task: () => Promise<T>) {
  try {
    return await passwordGate.run(task);
  } catch (error) {
    if (error instanceof ConcurrencyGateFullError) throw Errors.busy("当前登录人数较多，请稍后重试");
    throw error;
  }
}

export const hashPassword = (plain: string) => throughPasswordGate(() => bcrypt.hash(plain, 10));
export const verifyPassword = (plain: string, hash: string) => throughPasswordGate(() => bcrypt.compare(plain, hash));
