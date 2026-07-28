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
