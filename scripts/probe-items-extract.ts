#!/usr/bin/env tsx
/**
 * 探针：F3 items 抽取根因实验
 *
 * 与生产 (admin/packages/llm/src/vision/extract-items-from-pdf.ts) 1:1 复刻调用形态：
 *   - 同 prompt (buildDefaultChunkPrompt)
 *   - 同 schema 形态 (ChunkExtractionSchema → JSON Schema)
 *   - 同 openai_chat adapter body 形态：messages 数组 + image_url base64 + max_tokens + response_format
 *
 * 但参数化三个变量，以做对照实验：
 *   --pages-per-call=N    一次喂 LLM 几页 (默认 2)
 *   --model=ID            llm_provider.id (从 DB 读 endpoint/model/quirks/max_output_tokens/auth_env_var)
 *   --schema-mode=        strict | object | none
 *                           strict: response_format=json_schema, strict=true (复刻 admin)
 *                           object: response_format=json_object (只要求合法 JSON)
 *                           none:   不传 response_format
 *   --max-pages=N         总页数上限 (用于快速迭代)
 *   --pdf=PATH            PDF 路径
 *
 * 输出: results/probe-items-extract/<run_id>/
 *   pages/page-NN.png
 *   per-chunk/chunk-NN-raw.json     (rawText + tokenUsage + latency + retries)
 *   per-chunk/chunk-NN-parsed.json  (JSON.parse 后或错误信息)
 *   all.json                        (merged items + resources)
 *   stats.json                      (run 参数 + 每片摘要)
 *   summary.md                      (人类可读)
 *
 * 用法：
 *   tsx --env-file=worktrees/admin/apps/admin/.env.local scripts/probe-items-extract.ts \
 *     --pdf=/path/to.pdf --model=webex-gemini-3.1-pro --pages-per-call=2 \
 *     --schema-mode=strict --max-pages=6
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ─────────────────────────────────────────────────────────────────
// CLI

interface Args {
  pdf: string;
  model: string;
  pagesPerCall: number;
  schemaMode: 'strict' | 'object' | 'none';
  maxPages?: number;
  dpi: number;
  delaySec: number;
  /**
   * max_tokens override：
   *   undefined → 用 DB 配置 (provider.max_output_tokens 或 default_params.max_tokens)
   *   number    → 强制覆盖
   *   'none'    → 完全不发 max_tokens 字段（也忽略 default_params.max_tokens）
   */
  maxOutputTokens?: number | 'none';
}

function parseArgs(): Args {
  const a: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([\w-]+)=(.*)$/);
    if (m) a[m[1]] = m[2];
  }
  const required = (k: string) => {
    if (!a[k]) {
      console.error(`Missing --${k}`);
      process.exit(1);
    }
    return a[k]!;
  };
  const schemaMode = (a['schema-mode'] ?? 'strict') as Args['schemaMode'];
  if (!['strict', 'object', 'none'].includes(schemaMode)) {
    console.error(`Bad --schema-mode=${schemaMode}; expected strict|object|none`);
    process.exit(1);
  }
  let maxOutputTokens: number | 'none' | undefined;
  if (a['max-output-tokens'] !== undefined) {
    maxOutputTokens =
      a['max-output-tokens'] === 'none' ? 'none' : Number.parseInt(a['max-output-tokens']!, 10);
    if (maxOutputTokens !== 'none' && !Number.isFinite(maxOutputTokens)) {
      console.error(`Bad --max-output-tokens=${a['max-output-tokens']}; expected integer or "none"`);
      process.exit(1);
    }
  }
  return {
    pdf: required('pdf'),
    model: required('model'),
    pagesPerCall: Number.parseInt(a['pages-per-call'] ?? '2', 10),
    schemaMode,
    maxPages: a['max-pages'] ? Number.parseInt(a['max-pages']!, 10) : undefined,
    dpi: Number.parseInt(a['dpi'] ?? '150', 10),
    delaySec: Number.parseInt(a['delay-sec'] ?? '8', 10),
    maxOutputTokens,
  };
}

const ARGS = parseArgs();

// ─────────────────────────────────────────────────────────────────
// Provider 配置 (从 admin worktree 的 prisma 读)

interface ProviderRow {
  id: string;
  protocol: string;
  endpoint: string;
  model: string;
  auth_env_var: string;
  default_params: Record<string, unknown>;
  max_output_tokens: number | null;
  quirks: Record<string, unknown>;
  output_normalizers: string[];
}

const PRISMA_CLIENT_PATH =
  '/Users/huyin/Swingboat/github/hao-hao-study/worktrees/admin/packages/db/node_modules/@prisma/client/index.js';

async function loadProvider(providerId: string): Promise<ProviderRow> {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import path outside this worktree
  const mod: any = await import(PRISMA_CLIENT_PATH);
  const PrismaClient = mod.PrismaClient ?? mod.default?.PrismaClient;
  if (!PrismaClient) throw new Error('PrismaClient not found at ' + PRISMA_CLIENT_PATH);
  const prisma = new PrismaClient();
  try {
    const row = await prisma.llm_provider.findUnique({ where: { id: providerId } });
    if (!row) throw new Error(`llm_provider not found: ${providerId}`);
    return {
      id: row.id,
      protocol: row.protocol,
      endpoint: row.endpoint,
      model: row.model,
      auth_env_var: row.auth_env_var,
      default_params: (row.default_params ?? {}) as Record<string, unknown>,
      max_output_tokens: row.max_output_tokens,
      quirks: (row.quirks ?? {}) as Record<string, unknown>,
      output_normalizers: (row.output_normalizers ?? []) as string[],
    };
  } finally {
    await prisma.$disconnect();
  }
}

// ─────────────────────────────────────────────────────────────────
// JSON Schema (手写复刻 ChunkExtractionSchema → admin/zodToJsonSchema 的输出形态)
// 参考: worktrees/admin/packages/llm/src/vision/extract-items-from-pdf.ts:161-196
//      worktrees/admin/packages/llm/src/json-schema.ts (stripLength=true)

const FIGURE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    figure_no: { type: 'number' },
    alt: { type: 'string' },
    // z.tuple([number,number,number,number]) → admin zodToJsonSchema 没有 ZodTuple 分支
    // 走兜底 {} —— 但实际生产环境正是如此（admin 代码现状）。复刻这一点。
    bbox: {},
  },
  required: ['figure_no', 'bbox'],
  additionalProperties: false,
};

const ITEM_JSON_SCHEMA = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    item_type: { type: 'string', enum: ['choice', 'fill_in'] },
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, text: { type: 'string' } },
        required: ['label', 'text'],
        additionalProperties: false,
      },
    },
    answer: { type: 'string' },
    solution_text: { type: 'string' },
    difficulty: { type: 'number' },
    kp_hints: { type: 'array', items: { type: 'string' } },
    item_no: { type: 'string', nullable: true },
    figures: { type: 'array', items: FIGURE_JSON_SCHEMA },
    _src_pages: { type: 'array', items: { type: 'number' } },
    _truncated_before: { type: 'boolean' },
    _truncated_after: { type: 'boolean' },
  },
  required: [
    'content',
    'item_type',
    'options',
    'answer',
    'solution_text',
    'difficulty',
    'kp_hints',
    '_src_pages',
    '_truncated_before',
    '_truncated_after',
  ],
  additionalProperties: false,
};

const RESOURCE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    kp_hint: { type: 'string' },
    resource_kind: {
      type: 'string',
      enum: ['summary', 'method', 'pitfall', 'key_point'],
    },
    title: { type: 'string' },
    content: { type: 'string' },
    figures: { type: 'array', items: FIGURE_JSON_SCHEMA },
    _src_pages: { type: 'array', items: { type: 'number' } },
    _truncated_before: { type: 'boolean' },
    _truncated_after: { type: 'boolean' },
  },
  required: [
    'kp_hint',
    'resource_kind',
    'title',
    'content',
    '_src_pages',
    '_truncated_before',
    '_truncated_after',
  ],
  additionalProperties: false,
};

const CHUNK_JSON_SCHEMA = {
  type: 'object',
  properties: {
    items: { type: 'array', items: ITEM_JSON_SCHEMA },
    resources: { type: 'array', items: RESOURCE_JSON_SCHEMA },
  },
  required: ['items', 'resources'],
  additionalProperties: false,
};

// ─────────────────────────────────────────────────────────────────
// prompt (复刻 buildDefaultChunkPrompt)

function buildChunkPrompt(ctx: {
  pages: number[];
  totalPages: number;
  chunkIndex: number;
  totalChunks: number;
}): string {
  const pagesText = ctx.pages.join(', ');
  return [
    `这是教材/试卷 PDF 第 ${ctx.chunkIndex}/${ctx.totalChunks} 个分片（原 PDF 第 ${pagesText} 页，共 ${ctx.totalPages} 页）。`,
    '请抽取这几页里出现的**试题**（item）和**知识点说明 / 解题方法 / 易错点 / 关键概念**（resource）。',
    '',
    '严格按以下 JSON Schema 输出（不要任何 markdown 包裹、不要解释、不要前后缀）：',
    '{',
    '  "items": [{',
    '    "content": "题干（含 [图N] 占位符）",',
    '    "item_type": "choice" | "fill_in",',
    '    "options": [{"label":"A","text":"..."}, ...],   // 填空题留空数组',
    '    "answer": "答案",',
    '    "solution_text": "解析（无则空串）",',
    '    "difficulty": 1-5,',
    '    "kp_hints": ["相关知识点名"],',
    '    "item_no": "题号（如 12 / 第三题）",            // 没有就 null',
    '    "figures": [{"figure_no":1,"alt":"...","bbox":[x1,y1,x2,y2]}],  // 归一化 [0..1] 左上原点',
    '    "_src_pages": [页号, ...],                       // 这题出现在哪几页（必填）',
    '    "_truncated_before": true|false,                 // 这题题干是不是从上一页延续过来的',
    '    "_truncated_after":  true|false                  // 这题是不是延续到了下一页（题干/选项/解析未完）',
    '  }],',
    '  "resources": [{',
    '    "kp_hint": "知识点名",',
    '    "resource_kind": "summary"|"method"|"pitfall"|"key_point",',
    '    "title": "...",',
    '    "content": "...",',
    '    "figures": [{...}],',
    '    "_src_pages": [页号, ...],',
    '    "_truncated_before": true|false,',
    '    "_truncated_after":  true|false',
    '  }]',
    '}',
    '',
    '重要：',
    `- 本分片只包含第 ${pagesText} 页；如果某题题干在第 ${ctx.pages[0]} 页前面就开始了（你看不到上文），_truncated_before=true。`,
    `- 如果某题在第 ${ctx.pages[ctx.pages.length - 1]} 页末尾还没结束（题干/选项/解析被截断），_truncated_after=true。`,
    '- _src_pages 必须是 1-based 的实际 PDF 页号，不是 chunk 内编号。',
    '- 没有图就不要伪造 figures。',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────
// 调 LLM (复刻 openai-chat adapter buildRequest)

interface CallResult {
  rawText: string;
  tokenUsage: { input: number; output: number } | null;
  latencyMs: number;
  retries: number;
  httpStatus: number;
  finishReason?: string;
  requestBody: object;
  rawJson: unknown;
}

const MAX_RETRIES = 3;

async function callLLM(
  provider: ProviderRow,
  prompt: string,
  imagesPng: Buffer[],
): Promise<CallResult> {
  const token = process.env[provider.auth_env_var];
  if (!token) {
    throw new Error(`env ${provider.auth_env_var} not set`);
  }

  const quirks = provider.quirks as {
    supports_temperature?: boolean;
    supports_response_format?: boolean;
    max_tokens_param_name?: string;
  };
  const dp = provider.default_params;

  // schema 路径选择
  // 注意: 实验目的是用 --schema-mode 强制走某个路径；忽略 quirks.supports_response_format
  // (但 prompt 里仍然包含人类可读的 schema 描述 —— 这是 buildChunkPrompt 自带的)
  let responseFormat: unknown = undefined;
  if (ARGS.schemaMode === 'strict') {
    responseFormat = {
      type: 'json_schema',
      json_schema: {
        name: 'structured_output',
        strict: true,
        schema: CHUNK_JSON_SCHEMA,
      },
    };
  } else if (ARGS.schemaMode === 'object') {
    responseFormat = { type: 'json_object' };
  }

  type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };
  const content: ContentPart[] = [
    { type: 'text', text: prompt },
    ...imagesPng.map(
      (b): ContentPart => ({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${b.toString('base64')}` },
      }),
    ),
  ];

  const body: Record<string, unknown> = {
    model: provider.model,
    messages: [{ role: 'user', content }],
  };

  const limit =
    provider.max_output_tokens ??
    (typeof dp.max_tokens === 'number' ? (dp.max_tokens as number) : undefined);
  // CLI override
  let effectiveLimit: number | undefined;
  if (ARGS.maxOutputTokens === 'none') {
    effectiveLimit = undefined; // 完全不发 max_tokens 字段
  } else if (typeof ARGS.maxOutputTokens === 'number') {
    effectiveLimit = ARGS.maxOutputTokens;
  } else {
    effectiveLimit = limit;
  }
  if (typeof effectiveLimit === 'number') {
    body[quirks.max_tokens_param_name ?? 'max_tokens'] = effectiveLimit;
  }

  for (const [k, v] of Object.entries(dp)) {
    if (k === 'max_tokens' || k === 'temperature') continue;
    if (body[k] === undefined) body[k] = v;
  }
  if (quirks.supports_temperature !== false && typeof dp.temperature === 'number') {
    body.temperature = dp.temperature;
  }
  if (responseFormat !== undefined) {
    body.response_format = responseFormat;
  }

  let retries = 0;
  const t0 = Date.now();
  while (true) {
    const resp = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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
    const text = await resp.text();
    if (!resp.ok) {
      // 不重试 4xx，把错误也作为"结果"记录下来（便于看 schema 校验失败信息）
      return {
        rawText: '',
        tokenUsage: null,
        latencyMs: Date.now() - t0,
        retries,
        httpStatus: resp.status,
        requestBody: body,
        rawJson: safeParseJson(text),
      };
    }
    const json = safeParseJson(text) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const rawText = json?.choices?.[0]?.message?.content ?? '';
    const finishReason = json?.choices?.[0]?.finish_reason;
    const u = json?.usage;
    const tokenUsage =
      typeof u?.prompt_tokens === 'number' && typeof u?.completion_tokens === 'number'
        ? { input: u.prompt_tokens, output: u.completion_tokens }
        : null;
    return {
      rawText,
      tokenUsage,
      latencyMs: Date.now() - t0,
      retries,
      httpStatus: resp.status,
      finishReason,
      requestBody: body,
      rawJson: json,
    };
  }
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { _parse_error: true, raw: s.slice(0, 2000) };
  }
}

// ─────────────────────────────────────────────────────────────────
// pdftoppm

function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exit ${c}`))));
  });
}

async function rasterize(pdfPath: string, outDir: string, dpi: number, maxPages?: number): Promise<string[]> {
  const args = ['-r', String(dpi), '-png'];
  if (maxPages) {
    args.push('-f', '1', '-l', String(maxPages));
  }
  args.push(pdfPath, path.join(outDir, 'page'));
  await runCmd('pdftoppm', args);
  const files = (await readdir(outDir))
    .filter((f) => f.startsWith('page-') && f.endsWith('.png'))
    .sort();
  return files.map((f) => path.join(outDir, f));
}

// ─────────────────────────────────────────────────────────────────
// 主流程

async function main(): Promise<void> {
  console.log('▶ 加载 provider 配置...');
  const provider = await loadProvider(ARGS.model);
  console.log(`  ✓ ${provider.id} → ${provider.model} @ ${provider.endpoint}`);
  console.log(`    auth: ${provider.auth_env_var} (${process.env[provider.auth_env_var] ? 'set' : 'MISSING'})`);
  console.log(`    max_output_tokens: ${provider.max_output_tokens}`);
  console.log(`    quirks: ${JSON.stringify(provider.quirks)}`);
  console.log(`    default_params: ${JSON.stringify(provider.default_params)}`);
  console.log('');

  const runId = `${new Date().toISOString().replace(/[.:]/g, '-').replace('Z', '')}_${provider.id}_ppc${ARGS.pagesPerCall}_${ARGS.schemaMode}_mt${ARGS.maxOutputTokens ?? 'db'}`;
  const OUT_DIR = path.join(REPO_ROOT, `results/probe-items-extract/${runId}`);
  const PAGES_DIR = path.join(OUT_DIR, 'pages');
  const CHUNK_DIR = path.join(OUT_DIR, 'per-chunk');
  await mkdir(PAGES_DIR, { recursive: true });
  await mkdir(CHUNK_DIR, { recursive: true });

  console.log(`📄 PDF: ${ARGS.pdf}`);
  console.log(`📂 Out: ${OUT_DIR}`);
  console.log(
    `⚙️  pagesPerCall=${ARGS.pagesPerCall} schemaMode=${ARGS.schemaMode} maxOutputTokens=${ARGS.maxOutputTokens ?? '(use DB)'} maxPages=${ARGS.maxPages ?? 'all'} dpi=${ARGS.dpi} delaySec=${ARGS.delaySec}`,
  );
  console.log('');

  console.log('▶ Step 1: pdftoppm...');
  const pagePngs = await rasterize(ARGS.pdf, PAGES_DIR, ARGS.dpi, ARGS.maxPages);
  console.log(`  ✓ ${pagePngs.length} 页`);
  console.log('');

  // 分 chunk
  const chunks: Array<{ index: number; pages: number[]; pngs: string[] }> = [];
  for (let i = 0; i < pagePngs.length; i += ARGS.pagesPerCall) {
    const slice = pagePngs.slice(i, i + ARGS.pagesPerCall);
    const startPage = i + 1;
    const pages = slice.map((_, j) => startPage + j);
    chunks.push({ index: chunks.length + 1, pages, pngs: slice });
  }

  // 逐 chunk 调 LLM
  console.log(`▶ Step 2: 逐 chunk 调 LLM (共 ${chunks.length} 片，delay ${ARGS.delaySec}s)...`);
  interface ChunkStat {
    chunkIndex: number;
    pages: number[];
    httpStatus: number;
    finishReason?: string;
    latencyMs: number;
    retries: number;
    tokenUsage: { input: number; output: number } | null;
    rawTextLength: number;
    parseOk: boolean;
    parseError?: string;
    itemsCount: number | null;
    resourcesCount: number | null;
    figuresCount: number;
  }
  const stats: ChunkStat[] = [];
  const allItems: unknown[] = [];
  const allResources: unknown[] = [];

  const tStart = Date.now();
  for (const chunk of chunks) {
    const tElapsed = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(
      `[+${tElapsed}s] chunk ${chunk.index}/${chunks.length} pages=${chunk.pages.join(',')} → LLM...`,
    );

    const pngBuffers: Buffer[] = [];
    for (const p of chunk.pngs) pngBuffers.push(await readFile(p));
    const prompt = buildChunkPrompt({
      pages: chunk.pages,
      totalPages: pagePngs.length,
      chunkIndex: chunk.index,
      totalChunks: chunks.length,
    });

    let resp: CallResult;
    try {
      resp = await callLLM(provider, prompt, pngBuffers);
    } catch (e) {
      console.error(`  ❌ throw: ${String(e).slice(0, 300)}`);
      stats.push({
        chunkIndex: chunk.index,
        pages: chunk.pages,
        httpStatus: 0,
        latencyMs: 0,
        retries: 0,
        tokenUsage: null,
        rawTextLength: 0,
        parseOk: false,
        parseError: String(e).slice(0, 500),
        itemsCount: null,
        resourcesCount: null,
        figuresCount: 0,
      });
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, ARGS.delaySec * 1000));
      }
      continue;
    }

    const chunkTag = String(chunk.index).padStart(2, '0');
    await writeFile(
      path.join(CHUNK_DIR, `chunk-${chunkTag}-raw.json`),
      JSON.stringify(
        {
          chunkIndex: chunk.index,
          pages: chunk.pages,
          httpStatus: resp.httpStatus,
          finishReason: resp.finishReason,
          latencyMs: resp.latencyMs,
          retries: resp.retries,
          tokenUsage: resp.tokenUsage,
          rawTextLength: resp.rawText.length,
          rawText: resp.rawText,
          rawJson: resp.rawJson,
        },
        null,
        2,
      ),
    );

    let parseOk = false;
    let parseError: string | undefined;
    let itemsCount: number | null = null;
    let resourcesCount: number | null = null;
    let figuresCount = 0;
    let parsed: unknown = null;
    try {
      const stripped = resp.rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      parsed = JSON.parse(stripped);
      const p = parsed as { items?: unknown[]; resources?: unknown[] };
      if (Array.isArray(p.items) && Array.isArray(p.resources)) {
        parseOk = true;
        itemsCount = p.items.length;
        resourcesCount = p.resources.length;
        for (const it of p.items) {
          const figs = (it as { figures?: unknown[] }).figures;
          if (Array.isArray(figs)) figuresCount += figs.length;
          allItems.push({ ...(it as object), _src_chunk: chunk.index });
        }
        for (const r of p.resources) {
          allResources.push({ ...(r as object), _src_chunk: chunk.index });
        }
      } else {
        parseError = 'shape mismatch: missing items/resources arrays';
      }
    } catch (e) {
      parseError = String(e).slice(0, 300);
    }

    await writeFile(
      path.join(CHUNK_DIR, `chunk-${chunkTag}-parsed.json`),
      JSON.stringify(
        parseOk ? parsed : { _parse_error: parseError, _raw_preview: resp.rawText.slice(0, 1000) },
        null,
        2,
      ),
    );

    console.log(
      `  ${parseOk ? '✓' : '✗'} http=${resp.httpStatus} finish=${resp.finishReason ?? '?'} ` +
        `${resp.latencyMs}ms tokens=${JSON.stringify(resp.tokenUsage)} retries=${resp.retries} ` +
        `rawLen=${resp.rawText.length} | items=${itemsCount ?? 'N/A'} resources=${resourcesCount ?? 'N/A'} figures=${figuresCount}` +
        (parseError ? ` | parseErr=${parseError.slice(0, 80)}` : ''),
    );

    stats.push({
      chunkIndex: chunk.index,
      pages: chunk.pages,
      httpStatus: resp.httpStatus,
      finishReason: resp.finishReason,
      latencyMs: resp.latencyMs,
      retries: resp.retries,
      tokenUsage: resp.tokenUsage,
      rawTextLength: resp.rawText.length,
      parseOk,
      parseError,
      itemsCount,
      resourcesCount,
      figuresCount,
    });

    if (chunks.indexOf(chunk) < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, ARGS.delaySec * 1000));
    }
  }
  const totalSec = ((Date.now() - tStart) / 1000).toFixed(1);

  // 汇总
  const totalItems = allItems.length;
  const totalResources = allResources.length;
  const chunksFailed = stats.filter((s) => !s.parseOk).length;
  const avgRawLen = stats.length
    ? Math.round(stats.reduce((s, x) => s + x.rawTextLength, 0) / stats.length)
    : 0;
  const totalTokIn = stats.reduce(
    (s, x) => s + (x.tokenUsage?.input ?? 0),
    0,
  );
  const totalTokOut = stats.reduce(
    (s, x) => s + (x.tokenUsage?.output ?? 0),
    0,
  );

  await writeFile(
    path.join(OUT_DIR, 'all.json'),
    JSON.stringify({ items: allItems, resources: allResources }, null, 2),
  );

  const runMeta = {
    run_id: runId,
    pdf_path: ARGS.pdf,
    provider_id: provider.id,
    provider_model: provider.model,
    provider_endpoint: provider.endpoint,
    provider_max_output_tokens: provider.max_output_tokens,
    provider_quirks: provider.quirks,
    provider_default_params: provider.default_params,
    pages_per_call: ARGS.pagesPerCall,
    schema_mode: ARGS.schemaMode,
    max_pages: ARGS.maxPages ?? null,
    dpi: ARGS.dpi,
    delay_sec: ARGS.delaySec,
    page_count: pagePngs.length,
    chunk_count: chunks.length,
    total_seconds: Number(totalSec),
    total_items: totalItems,
    total_resources: totalResources,
    chunks_failed: chunksFailed,
    avg_raw_text_length: avgRawLen,
    total_token_input: totalTokIn,
    total_token_output: totalTokOut,
  };

  await writeFile(
    path.join(OUT_DIR, 'stats.json'),
    JSON.stringify({ ...runMeta, per_chunk: stats }, null, 2),
  );

  // summary.md
  const lines: string[] = [];
  lines.push(`# Probe Items Extract — ${runId}`);
  lines.push('');
  lines.push('## 实验参数');
  lines.push('');
  lines.push(`- PDF: \`${ARGS.pdf}\``);
  lines.push(`- Provider: \`${provider.id}\` → model=\`${provider.model}\``);
  lines.push(`- Endpoint: \`${provider.endpoint}\``);
  lines.push(`- max_output_tokens: \`${provider.max_output_tokens}\``);
  lines.push(`- quirks: \`${JSON.stringify(provider.quirks)}\``);
  lines.push(`- default_params: \`${JSON.stringify(provider.default_params)}\``);
  lines.push(`- pages_per_call: **${ARGS.pagesPerCall}**`);
  lines.push(`- schema_mode: **${ARGS.schemaMode}**`);
  lines.push(`- max_pages: ${ARGS.maxPages ?? 'all'}`);
  lines.push(`- dpi: ${ARGS.dpi}, delay_sec: ${ARGS.delaySec}`);
  lines.push('');
  lines.push('## 汇总');
  lines.push('');
  lines.push(`- 总页数: ${pagePngs.length} → ${chunks.length} chunks`);
  lines.push(`- 总耗时: ${totalSec}s`);
  lines.push(`- 成功 chunk: ${chunks.length - chunksFailed} / ${chunks.length}`);
  lines.push(`- 失败 chunk: ${chunksFailed}`);
  lines.push(`- 平均 rawText 长度: ${avgRawLen}`);
  lines.push(`- 总 items: ${totalItems}`);
  lines.push(`- 总 resources: ${totalResources}`);
  lines.push(`- token 总用量: input=${totalTokIn} output=${totalTokOut}`);
  lines.push('');
  lines.push('## 每片明细');
  lines.push('');
  lines.push('| chunk | pages | http | finish | latency | retries | tokens(in/out) | rawLen | items | resources | figures | 备注 |');
  lines.push('|------:|-------|-----:|--------|--------:|--------:|-----------------|-------:|------:|----------:|--------:|------|');
  for (const s of stats) {
    const tok = s.tokenUsage ? `${s.tokenUsage.input}/${s.tokenUsage.output}` : 'null';
    const note = s.parseOk ? '✓' : `✗ ${s.parseError?.slice(0, 60) ?? ''}`;
    lines.push(
      `| ${s.chunkIndex} | ${s.pages.join(',')} | ${s.httpStatus} | ${s.finishReason ?? '?'} | ${s.latencyMs}ms | ${s.retries} | ${tok} | ${s.rawTextLength} | ${s.itemsCount ?? '-'} | ${s.resourcesCount ?? '-'} | ${s.figuresCount} | ${note} |`,
    );
  }
  lines.push('');
  if (chunksFailed > 0) {
    lines.push('## 失败 chunk 列表');
    lines.push('');
    for (const s of stats.filter((x) => !x.parseOk)) {
      lines.push(`- chunk ${s.chunkIndex} (pages ${s.pages.join(',')}): ${s.parseError ?? '(http error)'}`);
    }
    lines.push('');
  }
  await writeFile(path.join(OUT_DIR, 'summary.md'), lines.join('\n'));

  console.log('');
  console.log('=== 汇总 ===');
  console.log(`  总 items: ${totalItems}`);
  console.log(`  总 resources: ${totalResources}`);
  console.log(`  成功 chunk: ${chunks.length - chunksFailed} / ${chunks.length}`);
  console.log(`  平均 rawText 长度: ${avgRawLen}`);
  console.log(`  token: in=${totalTokIn} out=${totalTokOut}`);
  console.log('');
  console.log(`💾 ${OUT_DIR}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
