// 学习辅助脚本的运行配置。
//
// 脚本自己的 getConfig() 不做任何 merge：拿到一个对象就直接用，缺哪个键就是
// undefined。后果不是报错而是静默变危险 ——
//   缺 interval / answerInterval*  → sleep(undefined) → NaN → 逐题瞬间作答
//   缺 minAccuracy                 → 旧版脚本的提交完整性判断失效
// 所以客户端下发的配置必须是完整的一整份，不能只发用户改过的那几项。
//
// 另外两个必须遵守的形状约束（否则脚本的迁移分支会改写并回写我们的值）：
//   aiEnabled 必须是 boolean
//   deepseekEnabled 必须为假

export type ScriptConfig = Record<string, unknown>;

// 用户可以在客户端界面里改的项。其余键只是为了"给全"而存在。
//
// 刻意不含 aiModel：服务端 routes/oauth.ts 的 /v1/responses 里
// `const model = siteConfig.assistantModel`，客户端传什么都被丢弃，
// 放个输入框只会让人以为改了有用。
//
// 也不含 customApi*：本站的答案全部来自后台配置的 AI，没有题库这条路。
// 脚本里那几个题库函数（题库海/一之/言溪）连调用点都没有。
export type EditableKey =
  | "autoVideo" | "autoJump" | "autoSubmit" | "autoExam"
  | "answerIntervalMin" | "answerIntervalMax"
  | "aiEnabled" | "answerDepth";

// 改动后是否需要重新打开学习窗口才生效。
// 脚本在构造时对配置做了快照（this.defaultConfig），这些项读的是快照；
// 而 AI 开关是每道题现读现用，所以能热改。
export const NEEDS_RELOAD: readonly EditableKey[] = [
  "autoVideo", "autoJump", "autoSubmit", "autoExam",
  "answerIntervalMin", "answerIntervalMax"
];

export const DEFAULT_SCRIPT_CONFIG: ScriptConfig = {
  // —— 用户可改 ——
  autoVideo: true,
  autoJump: true,
  autoSubmit: false,          // 脚本默认 true。默认不自动提交，让用户自己按一下更稳妥
  autoExam: false,            // 自动考试与视频挂机不是一个量级，默认关
  interval: 3,               // 固定安全值，不再作为用户设置暴露
  answerIntervalMin: 8,
  answerIntervalMax: 20,
  submitDelayMin: 20,        // 固定安全值，不再作为用户设置暴露
  submitDelayMax: 40,
  minAccuracy: 1,            // 兼容旧版缓存脚本：必须全部题目都获得答案才提交
  aiEnabled: true,
  answerDepth: "low",
  // 服务端会用站点配置里的模型覆盖它，这里填什么都不影响结果；
  // 给个值只是因为脚本要求配置项齐全。
  aiModel: "deepseek-reasoner",
  // 本站没有题库，答案全部走后台配置的 AI，这条路始终关闭
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
  answerIntervalMin: { min: 1, max: 300 },
  answerIntervalMax: { min: 1, max: 300 }
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
  // 这些参数属于实现细节。忽略历史 preferences.json 中的旧覆盖值，避免已删除的设置继续影响行为。
  result.interval = DEFAULT_SCRIPT_CONFIG.interval;
  result.submitDelayMin = DEFAULT_SCRIPT_CONFIG.submitDelayMin;
  result.submitDelayMax = DEFAULT_SCRIPT_CONFIG.submitDelayMax;
  result.minAccuracy = DEFAULT_SCRIPT_CONFIG.minAccuracy;

  result.aiModel = asTrimmed(source.aiModel, DEFAULT_SCRIPT_CONFIG.aiModel as string, 128)
    || (DEFAULT_SCRIPT_CONFIG.aiModel as string);
  result.customApiUrl = asHttpUrl(source.customApiUrl);
  result.customApiKey = asTrimmed(source.customApiKey, "", 256);
  // 地址没填就别声称启用了自定义题库
  if (!result.customApiUrl) result.customApiEnabled = false;

  // 这两条是脚本迁移分支的触发条件，必须钉死
  result.aiEnabled = asBool(source.aiEnabled, true);
  result.answerDepth = source.answerDepth === "high" || source.answerDepth === "max" ? source.answerDepth : "low";
  result.deepseekEnabled = false;

  return result;
};
