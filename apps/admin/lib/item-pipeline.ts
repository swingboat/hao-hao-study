import type { subject } from '@hao/db';
import { type ExtractItemsFromPdfResult, extractItemsFromPdf } from '@hao/llm';
import { PRACTICE_ITEM_PROMPT_VERSION, buildPracticeItemChunkPrompt } from '@hao/shared/prompts';
/**
 * F3 题集 PDF → 试题（practice_item）解析流水线 — admin 端薄壳。
 *
 * 形态对照 apps/admin/lib/kp-pipeline-vision.ts，差别：
 *   - 调用 @hao/llm 的 extractItemsFromPdf（L2，不丢题硬指标），不是 KP 抽取
 *   - 产出是 practice_item 候选（含 figures / source_hint），不是 KP
 *   - 不写 DB（保持纯净），caller 用 onProgress 落 progress / 用返回值落 staging
 *
 * 关键约束（AGENTS.md §通用规则 4）：
 *   - 文件落盘走 @hao/storage 的 createStore()
 *   - LLM 一律走 @hao/llm 的 extractItemsFromPdf()，不要绕过去自己拼 analyzeImageBatch
 *
 * 与 kp-pipeline-vision 不同：进度模型简化为 ItemProgressSnapshot（单段 phase + chunkDone/total），
 * 因为 extractItemsFromPdf 内部已经处理 chunk + 边界重抽 + dedup 所有复杂事件，admin 这层只做"翻译事件
 * 到 progress 快照"+ 写一行 staging。
 */
import type { ObjectStore } from '@hao/storage';

export const ITEM_PROMPT_VERSION = PRACTICE_ITEM_PROMPT_VERSION;

/**
 * 后台解析进度快照（写到 llm_parse_job.raw_response.progress）。
 * 形态比 kp-pipeline-vision 的 ProgressSnapshot 简化：
 *   - extractItemsFromPdf 内部封装了 chunk + boundary + dedup，事件多但 admin 不需要全暴露
 *   - 只跟 chunk 完成数 / boundary 触发数 / 当前阶段 + 错误摘要
 */
export interface ItemProgressSnapshot {
  phase:
    | 'rasterizing'
    | 'chunking'
    | 'boundary_refetching'
    | 'cropping'
    | 'persisting'
    | 'done'
    | 'failed';
  startedAt: string;
  lastEventAt: string;
  pageCount?: number;
  totalChunks?: number;
  chunksDone: number;
  chunksFailed: number;
  /** 边界重抽次数（extractItemsFromPdf 探测到跨页题对后才有） */
  boundaryDone?: number;
  /** 累计 token（extractItemsFromPdf 不分 reused/fresh，全部累加） */
  tokenUsageSoFar: { input: number; output: number } | null;
  itemCount?: number;
  figureCount?: number;
  lastEvent: string;
  errorMessage?: string | null;
}

export interface ItemPipelineOptions {
  jobId: string;
  providerId: string;
  /** 已落盘的 PDF 绝对路径（admin 上层从 storage.get 后写到 tmp 再传进来） */
  pdfPath: string;
  /** PDF 内容指纹；derived_asset（figure crop）落 storage 时挂这下面 */
  sourceSha256: string;
  store: ObjectStore;
  subject: subject;
  /** 仅用于 prompt 上下文（不入 staging）；调用方一般传 subject.name */
  subjectName?: string;
  /**
   * 已有 KP 字典（同学科）。非空时拼进 chunk prompt 的"【优先复用】"段，让 LLM 输出的
   * kp_hints 字面量尽量对齐 knowledge_point 表，省去 admin 抽屉里手搜映射的功夫。
   * 调用方（item-runner）从 prisma.knowledge_point.findMany({subject_id}) 拉。
   * v0.1：直接列全表（同学科 KP 量级 ≤500，2-50 字符 → 单 chunk 输入约 +10KB，可接受）。
   */
  kpDictionary?: string[];
  onProgress?: (snap: ItemProgressSnapshot) => void;
  /** L2 默认 pagesPerCall=3，dpi=150；这里允许覆盖（题集图密度高时降到 2） */
  pagesPerCall?: number;
  dpi?: number;
}

export type ItemPipelineResult = ExtractItemsFromPdfResult;

/**
 * 主入口。fail-soft 边界保留 extractItemsFromPdf 自带的"个别 chunk 失败不停整批"
 * 语义；只有 rasterize / 全军覆没才会真 throw 给 caller（runParse 转 status='failed'）。
 */
export async function runItemAnalysis(opts: ItemPipelineOptions): Promise<ItemPipelineResult> {
  const onProgress = opts.onProgress ?? (() => {});
  const startedAt = new Date().toISOString();

  // 累积量；每个事件触发后整体快照写一次
  let pageCount = 0;
  let totalChunks: number | undefined;
  let chunksDone = 0;
  let chunksFailed = 0;
  let boundaryDone = 0;
  let tokIn = 0;
  let tokOut = 0;

  const emit = (
    patch: Partial<ItemProgressSnapshot> & {
      phase: ItemProgressSnapshot['phase'];
      lastEvent: string;
    },
  ) => {
    onProgress({
      startedAt,
      lastEventAt: new Date().toISOString(),
      pageCount: pageCount || undefined,
      totalChunks,
      chunksDone,
      chunksFailed,
      boundaryDone,
      tokenUsageSoFar: tokIn || tokOut ? { input: tokIn, output: tokOut } : null,
      ...patch,
    });
  };

  emit({ phase: 'rasterizing', lastEvent: 'rasterizing PDF (pdftoppm)' });

  const subjectName = opts.subjectName ?? opts.subject.name;
  // 字典段：去重 + 截断到 500 条（防爆 prompt）；空数组就不拼，prompt 里也不出"【优先复用】"段。
  // 顺序保持 caller 传入的形态 —— item-runner 已按 chapter_no asc 拉好，这里别再 .sort()
  // （字母序会把"第十章"系列 KP 排到末尾，截断时随机丢章节）。Array.from(new Set(...)) 保留首次见到的顺序。
  const dictNames = Array.from(
    new Set((opts.kpDictionary ?? []).map((s) => s.trim()).filter((s) => s.length > 0)),
  ).slice(0, 500);
  const dictSection =
    dictNames.length === 0
      ? ''
      : [
          '',
          `【优先复用以下 ${dictNames.length} 个已有 ${subjectName} 知识点名（字面完全一致最佳；同义改写也用这些字面量）】`,
          dictNames.map((n) => `- ${n}`).join('\n'),
          '',
          '若题目考查的概念上方列表里没有，再用你自己的术语并保持 2-50 字符。',
          '不要把已有 KP 名拆成更细粒度（如 "函数的单调性" 不要拆成 "单调递增" / "单调递减"）。',
        ].join('\n');

  const result = await extractItemsFromPdf({
    pdfPath: opts.pdfPath,
    providerId: opts.providerId,
    sourceSha256: opts.sourceSha256,
    store: opts.store,
    pagesPerCall: opts.pagesPerCall ?? 3,
    dpi: opts.dpi ?? 150,
    // 自定义 chunk prompt：用 shared 里 v1.2026-06-07 的 PracticeItem 抽题模板，
    // 覆盖 extractItemsFromPdf 的默认 prompt（默认是通用 KP/题混合抽，结构与 PracticeItem
    // schema 不完全对齐 —— 比如缺了 difficulty 必填 / kp_hints 用学科术语等约束）。
    // 默认 prompt 输出仍带 _src_pages / _truncated_* 内部字段，是 L2 跨页修复必需，
    // 我们在合并时不会丢这些；shared chunk prompt 也保留了同形输出契约。
    chunkPromptBuilder: (ctx) =>
      [
        buildPracticeItemChunkPrompt({
          chunkIndex: ctx.chunkIndex,
          totalChunks: ctx.totalChunks,
          startPage: ctx.pages[0] ?? 1,
          endPage: ctx.pages[ctx.pages.length - 1] ?? ctx.pages[0] ?? 1,
          subjectName,
        }),
        dictSection, // 空字符串时不影响 prompt 形态；非空时把已有 KP 字典锚到 LLM 上
        '',
        '⚠️ 在 PracticeItemBatchSchema 形态之外，每条 item 必须额外带 L2 跨页修复字段：',
        '  - `_src_pages`: number[] —— 这题出现在哪几页（1-based）',
        '  - `_truncated_before` / `_truncated_after`: boolean —— 题干是否跨入上/下页',
        '  - `figures`: [{figure_no, alt?, bbox:[x1,y1,x2,y2]}] —— bbox 归一化 [0..1] 左上原点',
        '另外把 `kp_hints` / `source_hint` / `difficulty` 等 PracticeItem 字段带上。',
      ].join('\n'),
    onProgress: (e) => {
      switch (e.type) {
        case 'rasterize_done':
          pageCount = e.pageCount;
          emit({
            phase: 'chunking',
            lastEvent: `rasterize_done: ${e.pageCount} pages @ ${e.dpi}dpi`,
          });
          break;
        case 'chunk_start':
          totalChunks = e.totalChunks;
          emit({
            phase: 'chunking',
            lastEvent: `chunk #${e.chunkIndex}/${e.totalChunks} start (pages ${e.pages.join(',')})`,
          });
          break;
        case 'chunk_done':
          chunksDone += 1;
          if (e.tokenUsage) {
            tokIn += e.tokenUsage.input;
            tokOut += e.tokenUsage.output;
          }
          emit({
            phase: 'chunking',
            lastEvent: `chunk #${e.chunkIndex} done — ${e.itemCount} items (${e.truncatedCount} truncated)`,
          });
          break;
        case 'chunk_error':
          chunksFailed += 1;
          emit({
            phase: 'chunking',
            lastEvent: `chunk #${e.chunkIndex} failed: ${String(e.error).slice(0, 120)}`,
          });
          break;
        case 'boundary_plan':
          if (e.boundaries.length > 0) {
            emit({
              phase: 'boundary_refetching',
              lastEvent: `${e.boundaries.length} boundary pair(s) detected, refetching`,
            });
          }
          break;
        case 'boundary_done':
          boundaryDone += 1;
          emit({
            phase: 'boundary_refetching',
            lastEvent: `boundary ${e.pages.join('-')} → +${e.addedItemCount} items`,
          });
          break;
        case 'dedup_done':
          emit({
            phase: 'cropping',
            itemCount: e.after,
            lastEvent: `dedup ${e.before}→${e.after}; cropping figures`,
          });
          break;
        case 'crop_done':
          emit({
            phase: 'persisting',
            figureCount: e.figureCount,
            lastEvent: `crop_done: ${e.figureCount} figures (${e.invalidCount} invalid)`,
          });
          break;
      }
    },
  });

  emit({
    phase: 'done',
    itemCount: result.items.length,
    figureCount: result.derivedAssets.length,
    lastEvent: `done: ${result.items.length} items, ${result.derivedAssets.length} figures`,
  });

  return result;
}
