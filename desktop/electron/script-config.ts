// 学习辅助脚本的运行配置。
//
// 脚本自己的 getConfig() 不做任何 merge：拿到一个对象就直接用，缺哪个键就是
// undefined。后果不是报错而是静默变危险 ——
//   缺 interval / answerInterval*  → sleep(undefined) → NaN → 逐题瞬间作答
//   缺 minAccuracy                 → `正确率 < undefined` 恒为 false → 0% 也自动提交
// 所以客户端下发的配置必须是完整的一整份，不能只发用户改过的那几项。
//
// 另外两个必须遵守的形状约束（否则脚本的迁移分支会改写并回写我们的值）：
//   aiEnabled 必须是 boolean
//   deepseekEnabled 必须为假

export type ScriptConfig = Record<string, unknown>;

// 用户可以在客户端界面里改的项。其余键只是为了"给全"而存在。
export type EditableKey =
  | "autoVideo" | "autoJump" | "autoSubmit" | "autoExam"
  | "interval" | "answerIntervalMin" | "answerIntervalMax"
  | "submitDelayMin" | "submitDelayMax" | "minAccuracy"
  | "aiEnabled" | "aiModel"
  | "customApiEnabled" | "customApiUrl" | "customApiKey";

// 改动后是否需要重新打开学习窗口才生效。
// 脚本在构造时对配置做了快照（this.defaultConfig），这些项读的是快照；
// 而 AI 与自定义题库那几项是每道题现读现用，所以能热改。
export const NEEDS_RELOAD: readonly EditableKey[] = [
  "autoVideo", "autoJump", "autoSubmit", "autoExam",
  "interval", "answerIntervalMin", "answerIntervalMax",
  "submitDelayMin", "submitDelayMax", "minAccuracy"
];

export const DEFAULT_SCRIPT_CONFIG: ScriptConfig = {
  // —— 用户可改 ——
  autoVideo: true,
  autoJump: true,
  autoSubmit: false,          // 脚本默认 true。默认不自动提交，让用户自己按一下更稳妥
  autoExam: false,            // 自动考试与视频挂机不是一个量级，默认关
  interval: 3,
  answerIntervalMin: 8,
  answerIntervalMax: 20,
  submitDelayMin: 20,
  submitDelayMax: 40,
  minAccuracy: 0.8,
  aiEnabled: true,
  aiModel: "deepseek-reasoner",
  customApiEnabled: false,
  customApiUrl: "",
  customApiKey: "",

  // —— 以下是为了满足"必须给全"而补齐的键，界面上不暴露 ——
  autoAnswer: true,           // 脚本里没有任何读取点，是个装饰开关
  debugger: false,
  aiApiKey: "",               // AI 出口在宿主 IPC，脚本侧这两项只写不读
  aiApiUrl: "",
  thtoken: "",                // 对应的题库函数在脚本里从未被调用
  yztoken: "",
  enncytoken: "",
  gptKey: "",
  gptModel: "gpt-3.5-turbo",
  gpt: false,
  gptType: ["0", "1", "2", "3", "4", "5", "6", "7"],
  hideExam: false,
  notice: "",
  deepseekKey: "",
  deepseekEnabled: false,     // 为真会让脚本把 aiEnabled 强制拉回 true 并回写
  deepseekModel: "deepseek-reasoner"
};

const INTERVAL_LIMITS: Record<string, { min: number; max: number }> = {
  interval: { min: 1, max: 120 },
  answerIntervalMin: { min: 1, max: 300 },
  answerIntervalMax: { min: 1, max: 300 },
  submitDelayMin: { min: 1, max: 600 },
  submitDelayMax: { min: 1, max: 600 }
};

const asBool = (value: unknown, fallback: boolean): boolean => typeof value === "boolean" ? value : fallback;

const asClampedNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const asTrimmed = (value: unknown, fallback: string, limit = 512): string =>
  typeof value === "string" ? value.trim().slice(0, limit) : fallback;

const asHttpUrl = (value: unknown): string => {
  const raw = asTrimmed(value, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
};

/**
 * 把用户覆盖项合到完整默认配置上，并把危险取值夹回可用范围。
 * 脚本自己对这些值零校验：间隔设成 0、最小值大于最大值都会让它逐题瞬间作答，
 * 行为特征非常明显，所以校验只能在这里做。
 */
export const buildScriptConfig = (overrides: ScriptConfig): ScriptConfig => {
  const source = { ...DEFAULT_SCRIPT_CONFIG, ...overrides };
  const result: ScriptConfig = { ...source };

  for (const key of ["autoVideo", "autoJump", "autoSubmit", "autoExam", "customApiEnabled"]) {
    result[key] = asBool(source[key], DEFAULT_SCRIPT_CONFIG[key] as boolean);
  }
  for (const [key, limits] of Object.entries(INTERVAL_LIMITS)) {
    result[key] = asClampedNumber(source[key], DEFAULT_SCRIPT_CONFIG[key] as number, limits.min, limits.max);
  }
  // 最小值大于最大值会让 randomSleep 算出负数，setTimeout 当 0 处理
  if ((result.answerIntervalMin as number) > (result.answerIntervalMax as number)) {
    result.answerIntervalMax = result.answerIntervalMin;
  }
  if ((result.submitDelayMin as number) > (result.submitDelayMax as number)) {
    result.submitDelayMax = result.submitDelayMin;
  }
  // 正确率必须是能参与数值比较的数；非数字会让"低于阈值就不提交"这条判断失效
  result.minAccuracy = asClampedNumber(source.minAccuracy, 0.8, 0, 1);

  result.aiModel = asTrimmed(source.aiModel, DEFAULT_SCRIPT_CONFIG.aiModel as string, 128)
    || (DEFAULT_SCRIPT_CONFIG.aiModel as string);
  result.customApiUrl = asHttpUrl(source.customApiUrl);
  result.customApiKey = asTrimmed(source.customApiKey, "", 256);
  // 地址没填就别声称启用了自定义题库
  if (!result.customApiUrl) result.customApiEnabled = false;

  // 这两条是脚本迁移分支的触发条件，必须钉死
  result.aiEnabled = asBool(source.aiEnabled, true);
  result.deepseekEnabled = false;

  return result;
};
