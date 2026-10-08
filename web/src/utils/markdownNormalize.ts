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

// CJK punctuation, fullwidth forms (～，（）！), curly quotes, dashes, ellipsis and
// the middle dot never belong to a bare URL.
const URL_STOP_PATTERN = /[\u00B7\u2010-\u2027\u3000-\u303F\uFF00-\uFFEF]/u;
const HAN_PATTERN = /\p{Script=Han}/u;
// Han characters continue a URL only as a path segment or a query value, as in
// /wiki/中国药科大学 or ?q=成绩; right after other characters they are prose.
const URL_HAN_SEGMENT_STARTS = new Set(["/", "=", "?", "&", "#"]);
const URL_LIKE_CHARACTER = /[A-Za-z0-9./@:_~%?#=&+-]/u;

/**
 * marked 的 GFM 自动链接会一直延伸到空白处，而中文正文里没有空白：
 * `https://cputime.cn/jwxt查看成绩`、`https://cputime.cn。后续说明` 都会整体进入
 * href，点开就是错误页面。裸链接一旦紧接中文或全角标点，就在那里截断并补上
 * CommonMark 自动链接尖括号；显式 Markdown 链接地址末尾多出的标点也一并去掉。
 * 代码和已有的尖括号链接保持原样。
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

    const scheme = inlineCodeFenceLength ? "" : bareUrlSchemeAt(line, index);
    if (scheme && line.slice(0, index).endsWith("](")) {
      const targetEnd = findLinkTargetEnd(line, index);
      if (line[targetEnd] === ")") {
        normalized += trimLinkTargetPunctuation(line.slice(index, targetEnd));
        index = targetEnd;
        continue;
      }
    }
    if (scheme && !isProtectedMarkdownUrl(line, index)) {
      const { end, stoppedByCjk } = findBareUrlEnd(line, index);
      if (stoppedByCjk) {
        const { url, trailing } = splitTrailingUrlPunctuation(line.slice(index, end));
        if (url.length > scheme.length) {
          normalized += scheme === "www."
            ? `[${url}](http://${url})${trailing}`
            : `<${url}>${trailing}`;
          index = end;
          continue;
        }
      }
    }

    normalized += line[index];
    index += 1;
  }
  return normalized;
}

function bareUrlSchemeAt(line: string, index: number) {
  if (line.startsWith("https://", index)) return "https://";
  if (line.startsWith("http://", index)) return "http://";
  // "www." inside a longer URL or host name is not a separate link.
  if (line.startsWith("www.", index) && !URL_LIKE_CHARACTER.test(line[index - 1] || "")) return "www.";
  return "";
}

/** Scans a bare URL and reports whether CJK text or punctuation, rather than whitespace, ended it. */
function findBareUrlEnd(line: string, start: number) {
  let end = start;
  let inHanSegment = false;
  while (end < line.length) {
    const char = String.fromCodePoint(line.codePointAt(end) ?? 0);
    if (/[\s<>`]/u.test(char)) return { end, stoppedByCjk: false };
    if (URL_STOP_PATTERN.test(char)) return { end, stoppedByCjk: true };
    if (HAN_PATTERN.test(char)) {
      if (!inHanSegment && !URL_HAN_SEGMENT_STARTS.has(line[end - 1] || "")) return { end, stoppedByCjk: true };
      inHanSegment = true;
    } else {
      inHanSegment = false;
    }
    end += char.length;
  }
  return { end, stoppedByCjk: false };
}

/** Sentence punctuation, emphasis markers and an unmatched ")" before the cut belong to the prose. */
function splitTrailingUrlPunctuation(candidate: string) {
  let end = candidate.length;
  while (end > 0) {
    const char = candidate[end - 1];
    if (/[.,!?;:'"*_~]/u.test(char)) {
      end -= 1;
      continue;
    }
    const head = candidate.slice(0, end);
    if (char === ")" && head.split("(").length < head.split(")").length) {
      end -= 1;
      continue;
    }
    break;
  }
  return { url: candidate.slice(0, end), trailing: candidate.slice(end) };
}

/** The ")" closing a Markdown link target, allowing balanced parentheses inside it. */
function findLinkTargetEnd(line: string, start: number) {
  let depth = 0;
  let end = start;
  while (end < line.length && !/\s/u.test(line[end])) {
    if (line[end] === "(") depth += 1;
    else if (line[end] === ")") {
      if (!depth) return end;
      depth -= 1;
    }
    end += 1;
  }
  return end;
}

function trimLinkTargetPunctuation(target: string) {
  let end = target.length;
  while (end > 0 && (URL_STOP_PATTERN.test(target[end - 1]) || /[.,!?;:'"]/u.test(target[end - 1]))) end -= 1;
  return target.slice(0, end) || target;
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
