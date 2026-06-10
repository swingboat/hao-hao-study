/**
 * MathText —— 把含 LaTeX 的纯文本渲染为带数学公式的 HTML。
 *
 * LLM 抽题后 content / options / solution 普遍长成
 *   "已知集合 $M=\\{x|-4<x\\le 1\\}$，$N=\\{x|-1<x<3\\}$，则 $M \\cup N = (\\quad)$"
 * 不渲染就是给人看一串反斜杠。这里按 `$$...$$`（display）/ `$...$`（inline）切片，
 * 数学段交给 katex.renderToString，文本段保留原样换行。
 *
 * 服务端 / 客户端都能 import（无 hooks、无 'use client'）；调用方只要确保页面
 * 引入了 `katex/dist/katex.min.css`（本文件里也 import 了一次，Next.js 会去重）。
 */
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathTextProps {
  text: string;
  /** display=true → 整体当 block 块（保留换行 + display 数学居中）；默认 false 内联 */
  block?: boolean;
  className?: string;
}

interface Segment {
  type: 'text' | 'math';
  value: string;
  display: boolean;
}

/**
 * 裸 LaTeX 嗅探：LLM 输出的 answer / option 字段很多是
 *   `\{1,3,5\}` / `\{a | a=0 \text{ 或 } a>1\}` / `\frac{1}{2}` —— 没有 `$` 包裹。
 * 整段没有 `$` 但出现下列任一标志 → 视为整段裸 TeX，外层包 `$...$` 再走切片。
 *   - 反斜杠转义：`\{` `\}` `\\` `\|`
 *   - 常见 TeX 命令：`\frac` `\text` `\cup` `\cap` `\le` `\ge` `\in` `\notin` `\sqrt` `\pi` `\alpha` …
 *
 * 注意不能太激进 —— 纯中文里出现 `\` 本来就罕见，但保守起见只在"含反斜杠且不含 $"才触发。
 */
function looksLikeBareLatex(s: string): boolean {
  if (s.includes('$')) return false;
  if (!s.includes('\\')) return false;
  // \{ \} \\ \| 或 \后跟字母开头的命令名
  return /\\[\{\}\\|]|\\[A-Za-z]+/.test(s);
}

/**
 * 切片：依次扫描 `$$...$$` 和 `$...$`，遇到反斜杠转义的 `\$` 跳过；剩下都是 text。
 * 不用正则一次性 split —— LLM 偶尔吐出未配对的 `$`，那段就回退成普通文本，不抛错。
 */
function tokenize(input: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  let textBuf = '';
  const flushText = () => {
    if (textBuf) {
      out.push({ type: 'text', value: textBuf, display: false });
      textBuf = '';
    }
  };
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === '\\' && i + 1 < input.length && input[i + 1] === '$') {
      textBuf += '$';
      i += 2;
      continue;
    }
    if (ch === '$') {
      const isDisplay = input[i + 1] === '$';
      const open = isDisplay ? '$$' : '$';
      const start = i + open.length;
      // 找配对的 $$/$（同样跳过 `\$`）
      let j = start;
      let found = -1;
      while (j < input.length) {
        if (input[j] === '\\' && j + 1 < input.length && input[j + 1] === '$') {
          j += 2;
          continue;
        }
        if (input[j] === '$') {
          if (isDisplay && input[j + 1] === '$') {
            found = j;
            break;
          }
          if (!isDisplay) {
            found = j;
            break;
          }
        }
        j += 1;
      }
      if (found === -1) {
        // 没配对：保留 $ 当普通字符
        textBuf += ch;
        i += 1;
        continue;
      }
      flushText();
      out.push({
        type: 'math',
        value: input.slice(start, found),
        display: isDisplay,
      });
      i = found + open.length;
      continue;
    }
    textBuf += ch;
    i += 1;
  }
  flushText();
  return out;
}

function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
      output: 'html',
    });
  } catch (e) {
    // 兜底：katex 还是抛了就显示原始 TeX，方便人工修正
    const safe = tex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<code class="text-red-600">${safe}</code>`;
  }
}

export function MathText({ text, block = false, className = '' }: MathTextProps) {
  if (!text) return null;
  const normalized = looksLikeBareLatex(text) ? `$${text}$` : text;
  const segments = tokenize(normalized);
  const html = segments
    .map((seg) => {
      if (seg.type === 'math') return renderMath(seg.value, seg.display);
      // text：转义后保留换行
      const escaped = seg.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return escaped.replace(/\n/g, '<br/>');
    })
    .join('');
  const Tag = block ? 'div' : 'span';
  // biome-ignore lint/security/noDangerouslySetInnerHtml: katex.renderToString 输出受信任 HTML；文本段已转义
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
