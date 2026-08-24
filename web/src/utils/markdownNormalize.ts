/**
 * CommonMark 会把 `**标题：**正文` 视为无效的强调边界（中文标点后紧跟文字时尤为常见）。
 * 模型经常生成这种写法；先转换成等价 HTML，最终仍由 Markdown 渲染层的 DOMPurify 清洗。
 */
export function normalizeAdjacentStrongDelimiters(markdown: string) {
  return String(markdown || "").replace(
    /\*\*([^\n*]+?\S)\s*\*\*(?=[\p{L}\p{N}])/gu,
    "<strong>$1</strong>",
  );
}

const AI_TEXT_LATEX_COMMANDS = new Set([
  "alpha", "approx", "beta", "cdot", "chi", "cos", "delta", "displaystyle", "ell", "epsilon", "eta",
  "exists", "frac", "gamma", "ge", "geq", "gg", "in", "infty", "int", "iota", "kappa", "lambda",
  "le", "leq", "left", "ln", "log", "mapsto", "mid", "mu", "nabla", "ne", "neq", "newcommand", "nu",
  "not", "omega", "overline", "partial", "phi", "pi", "pm", "psi", "rho", "right", "rightarrow",
  "rm", "roman", "root", "rule", "sigma", "sin", "sqrt", "sum", "tau", "text", "theta", "times",
  "to", "top", "triangle", "underline", "upsilon", "varepsilon", "varphi", "varpi", "varrho", "varsigma",
  "vartheta", "vec", "xi", "zeta",
]);

/**
 * 部分 OpenAI 兼容上游会把 answer 再序列化一次，导致 `\n`、`\r\n`
 * 等控制字符以普通文本进入页面。恢复这些字符，同时保留常见 LaTeX 命令。
 */
export function normalizeAiTextControlEscapes(value: string) {
  const source = String(value || "").replace(/\r\n?/g, "\n");
  let normalized = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char !== "\\" || index + 1 >= source.length) {
      normalized += char;
      continue;
    }
    const escape = source[index + 1];
    if (
      (escape === "r" || escape === "n")
      && source[index + 2] === "\\"
      && source[index + 3] === (escape === "r" ? "n" : "r")
    ) {
      normalized += "\n";
      index += 3;
      continue;
    }
    if (escape === "u") {
      const hex = source.slice(index + 2, index + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        normalized += String.fromCharCode(Number.parseInt(hex, 16));
        index += 5;
        continue;
      }
    }
    if (escape === "n" || escape === "r" || escape === "t") {
      const command = source.slice(index + 1).match(/^[A-Za-z]+/u)?.[0] || "";
      if (!AI_TEXT_LATEX_COMMANDS.has(command)) {
        normalized += escape === "t" ? "\t" : "\n";
        index += 1;
        continue;
      }
    }
    normalized += char;
  }
  return normalized.replace(/\n{3,}/g, "\n\n");
}
