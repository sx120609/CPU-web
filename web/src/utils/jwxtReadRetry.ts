export function shouldRetryJwxtRead(input: { method?: string; status: number; code: number; message: string; attempts: number; aborted?: boolean }) {
  return input.method?.toLowerCase() === "get" && !input.aborted && input.attempts < 2
    && ([5302, 5305, 5306].includes(input.code) || (input.status === 503 && /教务会话正在迁移/.test(input.message)));
}
