// KaTeX 与其样式只通过 markdown.ts 的 loadMarkdownMath() 按需动态加载，请勿在其他模块静态引入。
import katex from "katex";
import "katex/dist/katex.min.css";

export default katex;
