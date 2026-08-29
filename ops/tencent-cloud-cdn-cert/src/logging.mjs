import { sanitizeLogValue } from "./core.mjs";

export function createLogger({ output = process.stdout, knownSecrets = [], now = () => new Date() } = {}) {
  const log = (level, event, fields = {}) => {
    const record = sanitizeLogValue({
      ts: now().toISOString(),
      level,
      event,
      ...fields,
    }, knownSecrets);
    output.write(`${JSON.stringify(record)}\n`);
  };
  return {
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
  };
}
