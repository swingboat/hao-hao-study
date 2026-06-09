#!/usr/bin/env tsx
/**
 * 探针：老师课件 PDF → 同时抽"题目 + 知识资源"
 *
 * 目的：验证 Claude Opus 4.7 Converse 能不能稳定从课件 PDF 里抽出两类结构化内容：
 *   1. 题目（items）—— 例题 / 课堂练习
 *   2. 知识资源（resources）—— 知识点总结 / 解题方法 / 易错点 / 关键概念
 *
 * 不强约束 schema（让 Claude 自由发挥），只在 prompt 里规定 JSON 形态，结果先 JSON.parse
 * 后落盘人工看。验证完再决定要不要扩 packages/db schema 加 description / methods 字段。
 *
 * 用法：pnpm exec tsx scripts/probe-lecture-notes.ts <pdf-path>
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzePdf, type AnalyzePdfResult, type AnalyzeProgressEvent } from '@hao/llm';

// 仓库根目录 = 本脚本所在目录的上一级（scripts/ 直接在 repo root 下）
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 内联读 .env（避免 root 装 dotenv；.env 永远在 repo root，不依赖 cwd）
async function loadEnv() {
  try {
    const raw = await readFile(path.join(REPO_ROOT, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...valueParts] = trimmed.split('=');
      if (key && !process.env[key]) {
        process.env[key] = valueParts.join('=').replace(/^"|"$/g, '');
      }
    }
  } catch {
    // .env 可选
  }
}

const PDF_PATH = process.argv[2];

const SUBJECT_NAME = '高中数学';
const RUN_ID = new Date()
  .toISOString()
  .replace(/[.:]/g, '-')
  .replace('Z', '');
const OUTPUT_DIR = path.join(REPO_ROOT, `results/probe-lecture-notes/${RUN_ID}`);

function buildChunkPrompt(ctx: {
  chunkIndex: number;
  totalChunks: number;
  startPage: number;
  endPage: number;
}): string {
  return [
    `你正在帮 ${SUBJECT_NAME} 教研团队处理老师的讲义 / 课件 PDF（PPT 转 PDF 形态，每页通常是一个 slide）。`,
    `当前是第 ${ctx.chunkIndex}/${ctx.totalChunks} 个分片（原 PDF 第 ${ctx.startPage}-${ctx.endPage} 页）。`,
    '',
    '请同时抽取这个分片里的**两类**内容，输出严格 JSON。',
    '',
    '## A. items（题目）',
    '- 题型：仅 choice（选择题）和 fill_in（填空题）。解答题 / 证明题 / 计算题（要写过程的）整道丢弃。',
    '- 范围：例题、课堂练习、习题、活动题都要抽，**包括穿插在讲解里的"例 1"、"例 2"** 这种。',
    '- 字段：',
    '  * content：题干，含图时在末尾加 `[图片描述: ...]`',
    '  * item_type："choice" | "fill_in"',
    '  * options：choice 时给 [{label:"A",text:"..."},...]，fill_in 时给 []',
    '  * answer：choice 单选 "A" / 多选按字母序拼接如 "AB"；fill_in 多空用半角分号分隔如 "8;7"',
    '  * solution_text：解析全文。课件里通常带详细解析（老师讲课用），尽量完整保留。抽不到给 ""',
    '  * difficulty：1-5 整数，把握不准给 3',
    '  * kp_hints：相关 KP 候选名（领域标准术语，2-50 字符），第一个为主 KP，至少 1 条最多 5 条',
    '  * source_hint：{ page: <PDF 页码>, item_no: "例 3" / "练习 2" 等 }',
    '',
    '## B. resources（知识资源）—— 课件 PDF 独有，非常重要',
    '- 抽老师整理的"非题目"知识：',
    '  * summary：知识点总结 / 概念定义 / 公式归纳（如"排列数公式 A(n,m) = n!/(n-m)!"）',
    '  * method：解题方法 / 套路 / 通法（如"插空法解决相邻问题：先排其他元素再插空"）',
    '  * pitfall：易错点 / 常见错误（红色标注 / "注意"开头的内容）',
    '  * key_point：重难点提示 / 高频考点',
    '- 字段：',
    '  * kp_hint：关联到哪个 KP（用领域标准术语，2-50 字符），如"排列数计算"、"插空法"',
    '  * resource_kind："summary" | "method" | "pitfall" | "key_point"',
    '  * title：精炼标题，10-40 字符，如"插空法的适用场景"、"排列数公式 A(n,m) 的两种写法"',
    '  * content：完整正文，保留数学公式原貌（LaTeX 风格 OK），50-1500 字符',
    '  * source_hint：{ page, slide_title?: "本页 slide 标题" }',
    '',
    '## 输出形态',
    '```',
    '{ "items": [...], "resources": [...] }',
    '```',
    '- 两个数组都可以为空（不要编）。',
    '- 不要 markdown 代码块包裹、不要解释文字、不要任何前后缀。',
    '- 公式保留 LaTeX 原貌（如 $C_n^k$ 或 \\binom{n}{k}），不要转纯文本。',
  ].join('\n');
}

function buildFinalPrompt(ctx: {
  pdfPath: string;
  pageCount: number;
  chunkSummaries: Array<{ chunkIndex: number; startPage: number; endPage: number; text: string }>;
}): string {
  const blocks = ctx.chunkSummaries
    .map((s) =>
      [`--- 分片 ${s.chunkIndex}（第 ${s.startPage}-${s.endPage} 页）---`, s.text].join('\n'),
    )
    .join('\n\n');
  return [
    `下面是 ${SUBJECT_NAME} 课件 ${ctx.pdfPath}（${ctx.pageCount} 页）按页分片后各 chunk 抽出的 JSON。`,
    '',
    '请合并所有分片，做三件事：',
    '1. 把跨分片切边附近**明显重复**的题（同 content）和资源（同 title + 同 kp_hint）只保留一份。',
    '2. 规范化 kp_hints：同一概念不同写法统一（"组合数" / "组合数公式" 统一为更具体那个）。',
    '3. 按原 PDF 出现顺序排序（用 source_hint.page 升序，缺失的排末尾）。',
    '',
    '严格按 `{ "items": [...], "resources": [...] }` 输出，规则与各分片相同：',
    '- 仅 choice / fill_in 两类题',
    '- resources 仅 summary/method/pitfall/key_point 四类',
    '- 不要 markdown 包裹、不要解释',
    '',
    blocks,
  ].join('\n');
}

interface CombinedItem {
  content: string;
  item_type: 'choice' | 'fill_in';
  options: Array<{ label: string; text: string }>;
  answer: string;
  solution_text: string;
  difficulty: number;
  kp_hints: string[];
  source_hint?: { page?: number | null; item_no?: string | null };
}

interface CombinedResource {
  kp_hint: string;
  resource_kind: 'summary' | 'method' | 'pitfall' | 'key_point';
  title: string;
  content: string;
  source_hint?: { page?: number | null; slide_title?: string | null };
}

interface CombinedBatch {
  items: CombinedItem[];
  resources: CombinedResource[];
}

function tryParse(text: string): CombinedBatch | { _error: string; _raw: string } {
  // Claude 偶尔会包裹在 ```json ... ```，先去掉
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  try {
    const parsed = JSON.parse(stripped);
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray(parsed.items) &&
      Array.isArray(parsed.resources)
    ) {
      return parsed as CombinedBatch;
    }
    return { _error: 'shape mismatch (expect {items[],resources[]})', _raw: text };
  } catch (e) {
    return { _error: `JSON parse failed: ${String(e).slice(0, 200)}`, _raw: text };
  }
}

async function main() {
  await loadEnv();
  if (!PDF_PATH) {
    console.error('Usage: pnpm exec tsx scripts/probe-lecture-notes.ts <pdf-path>');
    process.exit(1);
  }
  if (!process.env.WEBEX_LLM_TOKEN) {
    console.error('WEBEX_LLM_TOKEN not set in .env');
    process.exit(1);
  }
  await mkdir(OUTPUT_DIR, { recursive: true });
  console.log(`📄 PDF: ${PDF_PATH}`);
  console.log(`📂 Output: ${OUTPUT_DIR}`);
  console.log('');

  const events: AnalyzeProgressEvent[] = [];
  const t0 = Date.now();

  let result: AnalyzePdfResult;
  try {
    result = await analyzePdf({
      providerId: 'webex-claude-opus-4.7-converse',
      pdfPath: PDF_PATH,
      // Opus 4.7 converse on Webex 容易 429，按用户实测建议：每片 15 页 + 60s 间隔。
      // chunk 1 上一轮 10 页就把 12k output 顶满（被截），15 页保险给到 24k；
      // final 合成时输入是两片摘要，输出 14k 实测足够，留 24k 余量。
      chunkPages: 15,
      delayBetweenRequestsSeconds: 60,
      maxChunkTokens: 24000,
      maxFinalTokens: 24000,
      maxRetries: 2,
      chunkPromptBuilder: buildChunkPrompt,
      finalPromptBuilder: buildFinalPrompt,
      onProgress: (e) => {
        events.push(e);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        if (e.type === 'plan') {
          console.log(`[+${elapsed}s] plan: ${e.pageCount} 页 → ${e.ranges.length} 个分片`);
        } else if (e.type === 'chunk_start') {
          console.log(`[+${elapsed}s] chunk ${e.chunkIndex} 开始（页 ${e.startPage}-${e.endPage}）`);
        } else if (e.type === 'chunk_done') {
          console.log(
            `[+${elapsed}s] chunk ${e.chunkIndex} 完成 ${e.latencyMs}ms tokens=${JSON.stringify(e.tokenUsage)} retries=${e.retries}`,
          );
        } else if (e.type === 'sleep') {
          console.log(`[+${elapsed}s] 睡 ${e.seconds}s 避 429...`);
        } else if (e.type === 'final_start') {
          console.log(`[+${elapsed}s] 终审开始`);
        } else if (e.type === 'final_done') {
          console.log(
            `[+${elapsed}s] 终审完成 ${e.latencyMs}ms tokens=${JSON.stringify(e.tokenUsage)} retries=${e.retries}`,
          );
        } else if (e.type === 'error') {
          console.error(`[+${elapsed}s] ❌ error stage=${e.stage}:`, e.error);
        }
      },
    });
  } catch (err) {
    console.error('analyzePdf failed:', err);
    await writeFile(
      path.join(OUTPUT_DIR, 'error.json'),
      JSON.stringify({ events, error: String(err) }, null, 2),
    );
    process.exit(1);
  }

  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ 完成（总耗时 ${totalSec}s）\n`);

  // 解析每个 chunk 和 final
  const chunkParsed = result.chunks.map((c) => ({
    chunkIndex: c.chunkIndex,
    startPage: c.startPage,
    endPage: c.endPage,
    parsed: tryParse(c.text),
    raw_first_400: c.text.slice(0, 400),
  }));
  const finalParsed = tryParse(result.final.text);

  // 统计
  const stats = {
    pdf_path: PDF_PATH,
    page_count: result.pageCount,
    chunk_count: result.chunks.length,
    total_seconds: Number(totalSec),
    chunk_token_usage: result.chunks.map((c) => c.tokenUsage),
    final_token_usage: result.final.tokenUsage,
    parse_success_per_chunk: chunkParsed.map((c) => ({
      chunk: c.chunkIndex,
      ok: !('_error' in c.parsed),
      items: '_error' in c.parsed ? null : c.parsed.items.length,
      resources: '_error' in c.parsed ? null : c.parsed.resources.length,
    })),
    final_parse_ok: !('_error' in finalParsed),
    final_items: '_error' in finalParsed ? null : finalParsed.items.length,
    final_resources: '_error' in finalParsed ? null : finalParsed.resources.length,
  };

  // 写盘：raw + parsed + stats
  await writeFile(path.join(OUTPUT_DIR, 'stats.json'), JSON.stringify(stats, null, 2));
  await writeFile(
    path.join(OUTPUT_DIR, 'chunks-raw.json'),
    JSON.stringify(
      result.chunks.map((c) => ({ ...c, requestPayload: undefined })),
      null,
      2,
    ),
  );
  await writeFile(
    path.join(OUTPUT_DIR, 'final-raw.txt'),
    result.final.text,
  );
  await writeFile(path.join(OUTPUT_DIR, 'final-parsed.json'), JSON.stringify(finalParsed, null, 2));
  await writeFile(
    path.join(OUTPUT_DIR, 'chunks-parsed.json'),
    JSON.stringify(chunkParsed, null, 2),
  );

  console.log('=== STATS ===');
  console.log(JSON.stringify(stats, null, 2));
  console.log('');

  if ('_error' in finalParsed) {
    console.log('⚠️  终审 JSON 解析失败:', finalParsed._error);
    console.log('终审原文前 1000 字:');
    console.log(result.final.text.slice(0, 1000));
  } else {
    console.log(`✅ 终审解析成功：${finalParsed.items.length} 题 + ${finalParsed.resources.length} 条资源`);
    console.log('');
    console.log('=== 题目示例（前 2 道）===');
    console.log(JSON.stringify(finalParsed.items.slice(0, 2), null, 2));
    console.log('');
    console.log('=== 资源示例（前 3 条）===');
    console.log(JSON.stringify(finalParsed.resources.slice(0, 3), null, 2));
  }

  console.log(`\n💾 完整输出已保存到 ${OUTPUT_DIR}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
