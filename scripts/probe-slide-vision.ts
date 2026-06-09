#!/usr/bin/env tsx
/**
 * 探针：PDF → 每页 1 张 PNG → Gemini 3.1 Pro 视觉多模态抽题（含 figure bbox）
 *
 * 输入：一个 PDF 路径
 * 输出：results/probe-slide-vision/<run_id>/
 *   - pages/page-NN.png             — pdftoppm 渲染的每页整图
 *   - per-page/page-NN-raw.json     — Gemini 原始返回
 *   - per-page/page-NN-parsed.json  — 解析后的 items[] + resources[]
 *   - crops/page-NN-fig-M.png       — 根据 Gemini 给的 bbox 裁出的 figure 缩略图（人工眼检）
 *   - all.json                      — 全 PDF 合并 items + resources
 *   - stats.json                    — 每页 token、bbox 数量、耗时
 *
 * 用法：tsx --env-file=.env scripts/probe-slide-vision.ts <pdf-path>
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PDF_PATH = process.argv[2];
if (!PDF_PATH) {
  console.error('Usage: tsx --env-file=.env scripts/probe-slide-vision.ts <pdf-path>');
  process.exit(1);
}
if (!process.env.WEBEX_LLM_TOKEN) {
  console.error('WEBEX_LLM_TOKEN not set');
  process.exit(1);
}

const RUN_ID = new Date().toISOString().replace(/[.:]/g, '-').replace('Z', '');
const OUTPUT_DIR = path.join(REPO_ROOT, `results/probe-slide-vision/${RUN_ID}`);
const PAGES_DIR = path.join(OUTPUT_DIR, 'pages');
const RAW_DIR = path.join(OUTPUT_DIR, 'per-page');
const CROPS_DIR = path.join(OUTPUT_DIR, 'crops');

const DPI = 150;
const DELAY_SEC = 8; // Gemini 比 Claude 宽松，8s 间隔起手
const MAX_RETRIES = 3;
const MODEL = 'google.gemini-3.1-pro-global';
const ENDPOINT =
  'https://llm-proxy.us-east-2.int.infra.intelligence.webex.com/openai/v1/chat/completions';

// ─────────────────────────────────────────────────────────────────
// Prompt：让 Gemini 同时给 items + resources，含图时给 bbox

function buildPrompt(ctx: { page: number; totalPages: number }): string {
  return [
    `这是一份 PDF 教学课件的第 ${ctx.page}/${ctx.totalPages} 页（已渲染为图片，整张图就是一个完整的 PDF 页面，里面可能含 1 张或多张 slide）。`,
    `请同时抽取这一页里的两类内容，严格输出 JSON。`,
    '',
    '## A. items（题目）',
    '- 仅 choice（选择题）和 fill_in（填空题）。解答/证明/计算（要写过程的）整道丢弃。',
    '- 字段：',
    '  * content：题干文字',
    '  * item_type："choice" | "fill_in"',
    '  * options：choice 时给 [{label,text}]，fill_in 时给 []',
    '  * answer：见到答案就抽，否则给 ""',
    '  * solution_text：解析全文，没有给 ""',
    '  * difficulty：1-5 整数，不确定给 3',
    '  * kp_hints：相关知识点候选名 1-5 条',
    '  * item_no：原文里的题号，如 "例 3" / "练习 2" / "2024·新高考Ⅱ" 等',
    '  * figures：题目附图信息数组（**没图给 []**），每个元素：',
    '    {',
    '      "figure_no": 1,                         // 题内第几张图',
    '      "alt": "四棱锥示意图",                  // 一句话描述',
    '      "bbox": [x1, y1, x2, y2]                // 归一化坐标：',
    '                                              //   原点在图像左上角',
    '                                              //   x 沿宽度方向 [0..1]，y 沿高度方向 [0..1]',
    '                                              //   x1 < x2, y1 < y2',
    '                                              //   把图形完整框住（含必要文字标注），尽量贴边但不要切掉内容',
    '    }',
    '  * 题干里出现"如图"或图形是题的核心信息（几何题、网格、统计图、染色题）时必须填 figures。',
    '',
    '## B. resources（知识资源）',
    '- 抽页内的非题目知识：summary（公式/概念）/ method（解题方法）/ pitfall（易错）/ key_point（重难点）',
    '- 字段：kp_hint, resource_kind, title (10-40 字), content (50-1500 字)',
    '- 同样若资源本身配图（如公式推导示意图），可在 resource 上加 figures 字段，结构同 items.figures',
    '',
    '## 输出形态',
    '```',
    '{ "items": [...], "resources": [...] }',
    '```',
    '- items / resources 两个数组都可为空（不要编）。',
    '- 不要 markdown 代码块包裹、不要解释文字。',
    '- 公式保留 LaTeX 原貌（$C_n^k$、\\binom{n}{k} 等）。',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────
// PDF → 每页 PNG

function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exit ${c}`))));
  });
}

async function rasterizeAllPages(pdfPath: string, outDir: string): Promise<string[]> {
  await runCmd('pdftoppm', ['-r', String(DPI), '-png', pdfPath, path.join(outDir, 'page')]);
  const files = (await readdir(outDir))
    .filter((f) => f.startsWith('page-') && f.endsWith('.png'))
    .sort();
  return files.map((f) => path.join(outDir, f));
}

// ─────────────────────────────────────────────────────────────────
// Gemini 调用（Webex OpenAI 兼容接口 + image_url base64）

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: unknown;
}

async function callGeminiVision(pngPath: string, prompt: string): Promise<{
  rawText: string;
  tokenUsage: { input: number; output: number } | null;
  retries: number;
  latencyMs: number;
}> {
  const base64 = (await readFile(pngPath)).toString('base64');
  const body = {
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: 8000,
    response_format: { type: 'json_object' },
  };

  let retries = 0;
  const t0 = Date.now();
  while (true) {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.WEBEX_LLM_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    if (resp.status === 429 && retries < MAX_RETRIES) {
      const ra = resp.headers.get('retry-after');
      const wait = ra ? Number.parseInt(ra, 10) * 1000 : 30_000;
      console.log(`     429, sleep ${wait}ms (retry ${retries + 1}/${MAX_RETRIES})`);
      await new Promise((r) => setTimeout(r, wait));
      retries += 1;
      continue;
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Gemini ${resp.status}: ${text.slice(0, 500)}`);
    }
    const json = (await resp.json()) as OpenAIChatResponse;
    const rawText = json.choices?.[0]?.message?.content ?? '';
    const u = json.usage;
    const tokenUsage =
      typeof u?.prompt_tokens === 'number' && typeof u?.completion_tokens === 'number'
        ? { input: u.prompt_tokens, output: u.completion_tokens }
        : null;
    return { rawText, tokenUsage, retries, latencyMs: Date.now() - t0 };
  }
}

// ─────────────────────────────────────────────────────────────────
// JSON 解析 + bbox 裁切

interface Figure {
  figure_no: number;
  alt?: string;
  bbox: [number, number, number, number];
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
}
interface Resource {
  kp_hint: string;
  resource_kind: 'summary' | 'method' | 'pitfall' | 'key_point';
  title: string;
  content: string;
  figures?: Figure[];
}
interface PageParsed {
  items: Item[];
  resources: Resource[];
}

function tryParse(text: string): PageParsed | { _error: string; _raw: string } {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const obj = JSON.parse(stripped);
    if (obj && Array.isArray(obj.items) && Array.isArray(obj.resources)) {
      return obj as PageParsed;
    }
    return { _error: 'shape mismatch', _raw: text };
  } catch (e) {
    return { _error: `JSON parse failed: ${String(e).slice(0, 200)}`, _raw: text };
  }
}

async function cropFigure(
  pngPath: string,
  bbox: [number, number, number, number],
  outPath: string,
): Promise<{ width: number; height: number } | null> {
  // biome-ignore lint/suspicious/noExplicitAny: sharp loaded via pnpm path
  const sharpMod: any = await import(
    path.join(REPO_ROOT, 'node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js')
  );
  const sharp = sharpMod.default ?? sharpMod;
  const img = sharp(pngPath);
  const meta = await img.metadata();
  const W = meta.width as number;
  const H = meta.height as number;
  const [x1, y1, x2, y2] = bbox;
  if (!(x1 >= 0 && y1 >= 0 && x2 > x1 && y2 > y1 && x2 <= 1.001 && y2 <= 1.001)) {
    console.log(`     ⚠️  bbox 越界，跳过裁切：${JSON.stringify(bbox)}`);
    return null;
  }
  const left = Math.max(0, Math.round(x1 * W));
  const top = Math.max(0, Math.round(y1 * H));
  const width = Math.min(W - left, Math.round((x2 - x1) * W));
  const height = Math.min(H - top, Math.round((y2 - y1) * H));
  await img.extract({ left, top, width, height }).png().toFile(outPath);
  return { width, height };
}

// ─────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(PAGES_DIR, { recursive: true });
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(CROPS_DIR, { recursive: true });

  console.log(`📄 PDF: ${PDF_PATH}`);
  console.log(`📂 Output: ${OUTPUT_DIR}`);
  console.log(`🤖 Model: ${MODEL} (Webex)`);
  console.log('');
  console.log('▶ Step 1: pdftoppm 渲染所有页...');
  const pagePngs = await rasterizeAllPages(PDF_PATH, PAGES_DIR);
  console.log(`  ✓ ${pagePngs.length} 页 → ${PAGES_DIR}/`);
  console.log('');

  const allItems: Array<Item & { _src_page: number }> = [];
  const allResources: Array<Resource & { _src_page: number }> = [];
  const stats: Array<{
    page: number;
    latencyMs: number;
    tokenUsage: { input: number; output: number } | null;
    retries: number;
    parseOk: boolean;
    items: number | null;
    resources: number | null;
    figuresInItems: number;
    figuresCropped: number;
    figuresBboxInvalid: number;
  }> = [];

  console.log(`▶ Step 2: 逐页调 Gemini (delay ${DELAY_SEC}s)...`);
  const t0 = Date.now();
  for (let i = 0; i < pagePngs.length; i++) {
    const pageNo = i + 1;
    const pngPath = pagePngs[i];
    const tElapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[+${tElapsed}s] page ${pageNo}/${pagePngs.length} → Gemini...`);

    const prompt = buildPrompt({ page: pageNo, totalPages: pagePngs.length });
    let resp: Awaited<ReturnType<typeof callGeminiVision>>;
    try {
      resp = await callGeminiVision(pngPath, prompt);
    } catch (e) {
      console.error(`  ❌ page ${pageNo}: ${String(e).slice(0, 200)}`);
      stats.push({
        page: pageNo,
        latencyMs: 0,
        tokenUsage: null,
        retries: 0,
        parseOk: false,
        items: null,
        resources: null,
        figuresInItems: 0,
        figuresCropped: 0,
        figuresBboxInvalid: 0,
      });
      continue;
    }

    await writeFile(
      path.join(RAW_DIR, `page-${String(pageNo).padStart(2, '0')}-raw.json`),
      JSON.stringify({ rawText: resp.rawText, tokenUsage: resp.tokenUsage, retries: resp.retries, latencyMs: resp.latencyMs }, null, 2),
    );

    const parsed = tryParse(resp.rawText);
    const parseOk = !('_error' in parsed);
    let figuresInItems = 0;
    let figuresCropped = 0;
    let figuresBboxInvalid = 0;

    if (parseOk) {
      for (const item of parsed.items) {
        if (item.figures) {
          for (const fig of item.figures) {
            figuresInItems += 1;
            const outName = `page-${String(pageNo).padStart(2, '0')}-item${(item.item_no ?? '?').replace(/[^\w]/g, '_')}-fig${fig.figure_no}.png`;
            const r = await cropFigure(pngPath, fig.bbox, path.join(CROPS_DIR, outName));
            if (r) figuresCropped += 1;
            else figuresBboxInvalid += 1;
          }
        }
        allItems.push({ ...item, _src_page: pageNo });
      }
      for (const r of parsed.resources) allResources.push({ ...r, _src_page: pageNo });
    }

    await writeFile(
      path.join(RAW_DIR, `page-${String(pageNo).padStart(2, '0')}-parsed.json`),
      JSON.stringify(parsed, null, 2),
    );

    console.log(
      `  ${parseOk ? '✓' : '✗'} ${resp.latencyMs}ms tokens=${JSON.stringify(resp.tokenUsage)} retries=${resp.retries} | items=${parseOk ? parsed.items.length : 'N/A'} resources=${parseOk ? parsed.resources.length : 'N/A'} figures=${figuresInItems} (cropped ${figuresCropped}, bbox-invalid ${figuresBboxInvalid})`,
    );

    stats.push({
      page: pageNo,
      latencyMs: resp.latencyMs,
      tokenUsage: resp.tokenUsage,
      retries: resp.retries,
      parseOk,
      items: parseOk ? parsed.items.length : null,
      resources: parseOk ? parsed.resources.length : null,
      figuresInItems,
      figuresCropped,
      figuresBboxInvalid,
    });

    if (i < pagePngs.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_SEC * 1000));
    }
  }
  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('');
  console.log(`✅ 完成（总耗时 ${totalSec}s）`);
  console.log('');

  await writeFile(
    path.join(OUTPUT_DIR, 'all.json'),
    JSON.stringify({ items: allItems, resources: allResources }, null, 2),
  );
  await writeFile(
    path.join(OUTPUT_DIR, 'stats.json'),
    JSON.stringify(
      {
        pdf_path: PDF_PATH,
        model: MODEL,
        page_count: pagePngs.length,
        total_seconds: Number(totalSec),
        delay_seconds: DELAY_SEC,
        total_items: allItems.length,
        total_resources: allResources.length,
        total_figures: stats.reduce((s, x) => s + x.figuresInItems, 0),
        total_figures_cropped: stats.reduce((s, x) => s + x.figuresCropped, 0),
        total_figures_bbox_invalid: stats.reduce((s, x) => s + x.figuresBboxInvalid, 0),
        per_page: stats,
      },
      null,
      2,
    ),
  );

  console.log('=== 汇总 ===');
  console.log(`  题: ${allItems.length}`);
  console.log(`  资源: ${allResources.length}`);
  console.log(`  含图题中 figure 总数: ${stats.reduce((s, x) => s + x.figuresInItems, 0)}`);
  console.log(`    成功裁切: ${stats.reduce((s, x) => s + x.figuresCropped, 0)}`);
  console.log(`    bbox 越界丢弃: ${stats.reduce((s, x) => s + x.figuresBboxInvalid, 0)}`);
  console.log('');
  console.log(`💾 ${OUTPUT_DIR}/`);
  console.log(`   pages/    — 整页 PNG`);
  console.log(`   per-page/ — Gemini 每页原始 + 解析 JSON`);
  console.log(`   crops/    — bbox 裁切结果（人工眼检 bbox 准不准）`);
  console.log(`   all.json  — 汇总 items + resources`);
  console.log(`   stats.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
