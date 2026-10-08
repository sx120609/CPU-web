// 每行一个 JSON 对象，方便 PM2、journald 或日志平台直接解析。
export function createLogger({ output = process.stdout, now = () => new Date() } = {}) {
  const log = (level, event, fields = {}) => {
    output.write(`${JSON.stringify({ ts: now().toISOString(), level, event, ...fields })}\n`);
  };
  return {
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
  };
}
