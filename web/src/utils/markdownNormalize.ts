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

const CJK_BARE_URL_BOUNDARIES = new Set([
  "，", "。", "！", "？", "；", "：", "、",
  "（", "）", "【", "】", "《", "》", "“", "”", "‘", "’",
]);

/**
 * marked 会把裸链接后的中文标点和正文继续识别为 URL，例如
 * `https://cputime.cn。后续说明` 会整体进入 href。仅为存在中文标点边界的裸链接
 * 补上 CommonMark 自动链接尖括号；代码、HTML 标签和显式 Markdown 链接保持原样。
 */
export function normalizeBareUrlBoundaries(markdown: string) {
  const source = String(markdown || "");
  let fenceMarker = "";
  let fenceLength = 0;

  return source.split("\n").map((line) => {
    const fence = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1] || "";
    if (fence) {
      if (!fenceMarker) {
        fenceMarker = fence[0];
        fenceLength = fence.length;
      } else if (fence[0] === fenceMarker && fence.length >= fenceLength) {
        fenceMarker = "";
        fenceLength = 0;
      }
      return line;
    }
    if (fenceMarker) return line;
    return normalizeBareUrlBoundariesInLine(line);
  }).join("\n");
}

function normalizeBareUrlBoundariesInLine(line: string) {
  let normalized = "";
  let index = 0;
  let inlineCodeFenceLength = 0;

  while (index < line.length) {
    if (line[index] === "`") {
      let runLength = 1;
      while (line[index + runLength] === "`") runLength += 1;
      if (!inlineCodeFenceLength) inlineCodeFenceLength = runLength;
      else if (runLength === inlineCodeFenceLength) inlineCodeFenceLength = 0;
      normalized += line.slice(index, index + runLength);
      index += runLength;
      continue;
    }

    const isUrlStart = line.startsWith("https://", index) || line.startsWith("http://", index);
    if (!inlineCodeFenceLength && isUrlStart && !isProtectedMarkdownUrl(line, index)) {
      let end = index;
      while (end < line.length && !/[\s<>`]/u.test(line[end])) end += 1;
      const candidate = line.slice(index, end);
      const boundaryIndex = Array.from(candidate).findIndex((char) => CJK_BARE_URL_BOUNDARIES.has(char));
      if (boundaryIndex > 0) {
        const boundaryOffset = Array.from(candidate).slice(0, boundaryIndex).join("").length;
        let url = candidate.slice(0, boundaryOffset);
        let trailingAsciiPunctuation = "";
        const trailingMatch = /[.,!?;:]+$/u.exec(url)?.[0] || "";
        if (trailingMatch) {
          url = url.slice(0, -trailingMatch.length);
          trailingAsciiPunctuation = trailingMatch;
        }
        if (url.length > "https://".length) {
          normalized += `<${url}>${trailingAsciiPunctuation}`;
          index += boundaryOffset;
          continue;
        }
      }
    }

    normalized += line[index];
    index += 1;
  }
  return normalized;
}

function isProtectedMarkdownUrl(line: string, index: number) {
  const prefix = line.slice(0, index);
  if (prefix.lastIndexOf("<") > prefix.lastIndexOf(">")) return true;
  if (prefix.lastIndexOf("[") > prefix.lastIndexOf("]")) return true;
  return prefix.lastIndexOf("](") > prefix.lastIndexOf(")");
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
