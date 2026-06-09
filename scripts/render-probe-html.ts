#!/usr/bin/env tsx
/**
 * 把 probe-slide-vision 的 all.json 渲染成单文件 HTML（可直接浏览器打开）
 *
 * 显示：
 *   - items：题号 / 类型 / 难度 / 来源 / KP / 题干 / 选项 / 答案 / 解析 / 图
 *   - resources：类型 / KP / 标题 / 内容
 *
 * 图：复用 probe-slide-vision 的 crops/ 目录里的 PNG（相对路径），保证 HTML
 *     在 run 目录里就能直接打开。
 *
 * LaTeX 公式：用 KaTeX CDN 自动渲染。
 *
 * 用法：tsx scripts/render-probe-html.ts <probe-slide-vision-run-dir>
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RUN_DIR = process.argv[2];
if (!RUN_DIR) {
  console.error('Usage: tsx scripts/render-probe-html.ts <probe-slide-vision-run-dir>');
  process.exit(1);
}

interface Figure {
  figure_no: number;
  alt?: string;
  bbox?: [number, number, number, number];
}
interface Item {
  content: string;
  item_type: 'choice' | 'fill_in';
  options: Array<{ label: string; text: string }>;
  answer: string;
  solution_text: string;
  difficulty: number;
  kp_hints: string[];
  item_no?: string;
  figures?: Figure[];
  _src_page: number;
}
interface Resource {
  kp_hint: string;
  resource_kind: 'summary' | 'method' | 'pitfall' | 'key_point';
  title: string;
  content: string;
  figures?: Figure[];
  _src_page: number;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** \n → <br/>；其余原样（KaTeX delimited 公式 $...$ 由前端 auto-render 处理） */
function richText(s: unknown): string {
  return esc(s).replace(/\n/g, '<br/>');
}

const KIND_LABEL: Record<Resource['resource_kind'], string> = {
  summary: '📘 概念/公式',
  method: '🛠️ 方法',
  pitfall: '⚠️ 易错',
  key_point: '⭐ 重难点',
};
const KIND_COLOR: Record<Resource['resource_kind'], string> = {
  summary: '#e3f2fd',
  method: '#e8f5e9',
  pitfall: '#fff3e0',
  key_point: '#fce4ec',
};

function difficultyDots(d: number): string {
  const n = Math.max(1, Math.min(5, Math.round(d)));
  return '●'.repeat(n) + '○'.repeat(5 - n);
}

async function findFigureFile(
  cropsDir: string,
  cropFiles: string[],
  page: number,
  itemNo: string | undefined,
  figNo: number,
): Promise<string | null> {
  // 复用 probe-slide-vision 的命名：page-NN-item<sanitized>-figM.png
  // sanitized = itemNo.replace(/[^\w]/g, '_')
  const pageTag = `page-${String(page).padStart(2, '0')}`;
  const itemTag = `item${(itemNo ?? '?').replace(/[^\w]/g, '_')}`;
  const figTag = `fig${figNo}`;
  const exact = `${pageTag}-${itemTag}-${figTag}.png`;
  if (cropFiles.includes(exact)) return path.posix.join('crops', exact);
  // 退化匹配：同 page + figN，挑第一个
  const fallback = cropFiles.find((f) => f.startsWith(`${pageTag}-`) && f.endsWith(`-${figTag}.png`));
  return fallback ? path.posix.join('crops', fallback) : null;
}

async function main() {
  const allJsonPath = path.join(RUN_DIR, 'all.json');
  const statsJsonPath = path.join(RUN_DIR, 'stats.json');
  const cropsDir = path.join(RUN_DIR, 'crops');
  const data = JSON.parse(await readFile(allJsonPath, 'utf8')) as {
    items: Item[];
    resources: Resource[];
  };
  const stats = JSON.parse(await readFile(statsJsonPath, 'utf8'));
  const cropFiles = await readdir(cropsDir).catch(() => [] as string[]);

  // 渲染 items
  const itemHtmlParts: string[] = [];
  for (const [i, item] of data.items.entries()) {
    const figs: string[] = [];
    if (item.figures && item.figures.length > 0) {
      for (const fig of item.figures) {
        const url = await findFigureFile(cropsDir, cropFiles, item._src_page, item.item_no, fig.figure_no);
        if (url) {
          figs.push(`
            <figure class="fig">
              <img src="${esc(url)}" alt="${esc(fig.alt ?? '')}"/>
              <figcaption>${esc(fig.alt ?? `图 ${fig.figure_no}`)}</figcaption>
            </figure>`);
        } else {
          figs.push(`<div class="fig-missing">⚠️ 图 ${fig.figure_no}（${esc(fig.alt ?? '')}）裁切文件未找到</div>`);
        }
      }
    }
    const optionsHtml =
      item.item_type === 'choice' && item.options.length > 0
        ? `<ol class="opts">${item.options
            .map((o) => `<li><strong>${esc(o.label)}.</strong> ${richText(o.text)}</li>`)
            .join('')}</ol>`
        : '';
    const kpHtml = item.kp_hints.map((k) => `<span class="kp">${esc(k)}</span>`).join('');
    itemHtmlParts.push(`
      <article class="item">
        <header>
          <span class="num">题 ${i + 1}</span>
          <span class="badge type-${item.item_type}">${item.item_type === 'choice' ? '选择' : '填空'}</span>
          <span class="diff" title="难度 ${item.difficulty}">${difficultyDots(item.difficulty)}</span>
          <span class="src">p${item._src_page}${item.item_no ? ' · ' + esc(item.item_no) : ''}</span>
        </header>
        <div class="content">${richText(item.content)}</div>
        ${figs.length > 0 ? `<div class="figs">${figs.join('')}</div>` : ''}
        ${optionsHtml}
        ${item.answer ? `<div class="answer"><span class="label">答案：</span>${richText(item.answer)}</div>` : ''}
        ${item.solution_text ? `<details class="solution"><summary>查看解析</summary><div>${richText(item.solution_text)}</div></details>` : ''}
        <div class="kps">${kpHtml}</div>
      </article>`);
  }

  // 渲染 resources，按 kind 分组
  const grouped = new Map<Resource['resource_kind'], Resource[]>();
  for (const r of data.resources) {
    if (!grouped.has(r.resource_kind)) grouped.set(r.resource_kind, []);
    grouped.get(r.resource_kind)!.push(r);
  }
  const KIND_ORDER: Resource['resource_kind'][] = ['summary', 'method', 'pitfall', 'key_point'];
  const resourceHtmlParts: string[] = [];
  for (const kind of KIND_ORDER) {
    const list = grouped.get(kind);
    if (!list || list.length === 0) continue;
    resourceHtmlParts.push(`<h3 class="rh">${KIND_LABEL[kind]} <span class="count">${list.length}</span></h3>`);
    for (const r of list) {
      resourceHtmlParts.push(`
        <article class="res" style="background:${KIND_COLOR[kind]}">
          <header>
            <span class="badge">${KIND_LABEL[kind]}</span>
            <span class="kp">${esc(r.kp_hint)}</span>
            <span class="src">p${r._src_page}</span>
          </header>
          <h4>${richText(r.title)}</h4>
          <div class="content">${richText(r.content)}</div>
        </article>`);
    }
  }

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>探针结果 — ${esc(path.basename(RUN_DIR))}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"/>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.body,{delimiters:[
    {left:'$$',right:'$$',display:true},
    {left:'$',right:'$',display:false},
    {left:'\\\\(',right:'\\\\)',display:false},
    {left:'\\\\[',right:'\\\\]',display:true}
  ],throwOnError:false})"></script>
<style>
  :root { --fg:#1a1a1a; --muted:#666; --line:#e0e0e0; --accent:#2563eb; }
  * { box-sizing: border-box; }
  body { font: 15px/1.7 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--fg);
         max-width: 920px; margin: 0 auto; padding: 24px; background: #fafafa; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .meta { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  .stats { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px;
           margin-bottom: 24px; display: flex; gap: 24px; flex-wrap: wrap; }
  .stats div { font-size: 14px; }
  .stats strong { font-size: 18px; color: var(--accent); margin-right: 4px; }
  nav.tabs { position: sticky; top: 0; background: #fafafa; padding: 12px 0; margin: 0 -24px;
             padding-left: 24px; border-bottom: 1px solid var(--line); z-index: 10; }
  nav.tabs a { display: inline-block; padding: 6px 14px; margin-right: 8px; text-decoration: none;
               color: var(--fg); border: 1px solid var(--line); border-radius: 20px; background: #fff; }
  nav.tabs a:hover { border-color: var(--accent); color: var(--accent); }
  section { margin-top: 24px; }
  h2 { font-size: 20px; margin: 24px 0 12px; padding-bottom: 8px; border-bottom: 2px solid var(--accent); }

  .item, .res { background: #fff; border: 1px solid var(--line); border-radius: 10px;
                padding: 16px 20px; margin-bottom: 16px; }
  .item header, .res header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
                               margin-bottom: 10px; font-size: 13px; color: var(--muted); }
  .num { font-weight: 600; color: var(--accent); font-size: 14px; }
  .badge { padding: 2px 8px; border-radius: 4px; font-size: 12px; background: #eee; }
  .type-choice { background: #dbeafe; color: #1e40af; }
  .type-fill_in { background: #fef3c7; color: #92400e; }
  .diff { color: #f59e0b; letter-spacing: 1px; font-size: 12px; }
  .src { margin-left: auto; }
  .content { font-size: 15px; line-height: 1.8; white-space: pre-wrap; }
  .opts { padding-left: 0; list-style: none; counter-reset: opt; margin: 12px 0; }
  .opts li { padding: 6px 0; }
  .answer { background: #ecfdf5; border-left: 3px solid #10b981; padding: 8px 12px;
            margin: 12px 0; border-radius: 4px; }
  .answer .label { color: #065f46; font-weight: 600; }
  .solution { margin-top: 10px; }
  .solution summary { cursor: pointer; color: var(--accent); font-size: 13px; padding: 4px 0; }
  .solution > div { margin-top: 8px; padding: 10px 12px; background: #f9fafb;
                    border-left: 3px solid #94a3b8; border-radius: 4px; white-space: pre-wrap; }
  .kps { margin-top: 12px; }
  .kp { display: inline-block; padding: 2px 10px; margin: 2px 4px 2px 0; background: #f1f5f9;
        color: #475569; font-size: 12px; border-radius: 12px; }
  .figs { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0; }
  .fig { margin: 0; max-width: 360px; }
  .fig img { max-width: 100%; border: 1px solid var(--line); border-radius: 6px;
             background: #fff; padding: 4px; }
  .fig figcaption { font-size: 12px; color: var(--muted); text-align: center; margin-top: 4px; }
  .fig-missing { color: #ef4444; font-size: 13px; padding: 8px; border: 1px dashed #ef4444; border-radius: 4px; }
  .rh { margin: 20px 0 10px; font-size: 16px; }
  .rh .count { font-size: 12px; color: var(--muted); font-weight: normal; }
  .res h4 { margin: 6px 0 8px; font-size: 15px; }
</style>
</head>
<body>
<h1>${esc(path.basename(RUN_DIR))}</h1>
<div class="meta">PDF：${esc(stats.pdf_path)} · Model：${esc(stats.model)} · 总耗时 ${stats.total_seconds}s</div>
<div class="stats">
  <div><strong>${data.items.length}</strong> 题</div>
  <div><strong>${data.resources.length}</strong> 知识资源</div>
  <div><strong>${stats.total_figures}</strong> 图（裁出 ${stats.total_figures_cropped}，越界 ${stats.total_figures_bbox_invalid}）</div>
  <div><strong>${stats.page_count}</strong> 页</div>
</div>
<nav class="tabs">
  <a href="#items">📝 题目（${data.items.length}）</a>
  <a href="#resources">📚 知识资源（${data.resources.length}）</a>
</nav>
<section id="items">
  <h2>题目</h2>
  ${itemHtmlParts.join('\n')}
</section>
<section id="resources">
  <h2>知识资源</h2>
  ${resourceHtmlParts.join('\n')}
</section>
</body>
</html>`;

  const outPath = path.join(RUN_DIR, 'index.html');
  await writeFile(outPath, html);
  console.log(`✓ ${outPath}`);
  console.log(`  open file://${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
