import type { subject } from '@hao/db';
import { type ExtractQuestionsFromPdfResult, extractQuestionsFromPdf } from '@hao/llm';
import {
  QUESTION_PROMPT_VERSION as SHARED_QUESTION_PROMPT_VERSION,
  buildQuestionChunkPrompt,
} from '@hao/shared/prompts';
/**
 * F3 题集 PDF → 试题（question）解析流水线 — admin 端薄壳。
 *
 * 形态对照 apps/admin/lib/kp-pipeline-vision.ts，差别：
 *   - 调用 @hao/llm 的 extractQuestionsFromPdf（L2，不丢题硬指标），不是 KP 抽取
 *   - 产出是 question 候选（含 figures / source_hint），不是 KP
 *   - 不写 DB（保持纯净），caller 用 onProgress 落 progress / 用返回值落 staging
 *
 * 关键约束（AGENTS.md §通用规则 4）：
 *   - 文件落盘走 @hao/storage 的 createStore()
 *   - LLM 一律走 @hao/llm 的 extractQuestionsFromPdf()，不要绕过去自己拼 analyzeImageBatch
 *
 * 与 kp-pipeline-vision 不同：进度模型简化为 QuestionProgressSnapshot（单段 phase + chunkDone/total），
 * 因为 extractQuestionsFromPdf 内部已经处理 chunk + 边界重抽 + dedup 所有复杂事件，admin 这层只做"翻译事件
 * 到 progress 快照"+ 写一行 staging。
 */
import type { ObjectStore } from '@hao/storage';

export const QUESTION_PROMPT_VERSION = SHARED_QUESTION_PROMPT_VERSION;

/**
 * 后台解析进度快照（写到 llm_parse_job.raw_response.progress）。
 * 形态比 kp-pipeline-vision 的 ProgressSnapshot 简化：
 *   - extractQuestionsFromPdf 内部封装了 chunk + boundary + dedup，事件多但 admin 不需要全暴露
 *   - 只跟 chunk 完成数 / boundary 触发数 / 当前阶段 + 错误摘要
 */
export interface QuestionProgressSnapshot {
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
  /** 边界重抽次数（extractQuestionsFromPdf 探测到跨页题对后才有） */
  boundaryDone?: number;
  /** 累计 token（extractQuestionsFromPdf 不分 reused/fresh，全部累加） */
  tokenUsageSoFar: { input: number; output: number } | null;
  questionCount?: number;
  figureCount?: number;
  lastEvent: string;
  errorMessage?: string | null;
}

export interface QuestionPipelineOptions {
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
   * 调用方（question-runner）从 prisma.knowledge_point.findMany({subject_id}) 拉。
   * v0.1：直接列全表（同学科 KP 量级 ≤500，2-50 字符 → 单 chunk 输入约 +10KB，可接受）。
   */
  kpDictionary?: string[];
  onProgress?: (snap: QuestionProgressSnapshot) => void;
  /** L2 默认 pagesPerCall=3，dpi=150；这里允许覆盖（题集图密度高时降到 2） */
  pagesPerCall?: number;
  dpi?: number;
}

export type QuestionPipelineResult = ExtractQuestionsFromPdfResult;

/**
 * 主入口。fail-soft 边界保留 extractQuestionsFromPdf 自带的"个别 chunk 失败不停整批"
 * 语义；只有 rasterize / 全军覆没才会真 throw 给 caller（runParse 转 status='failed'）。
 */
export async function runQuestionAnalysis(
  opts: QuestionPipelineOptions,
): Promise<QuestionPipelineResult> {
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
    patch: Partial<QuestionProgressSnapshot> & {
      phase: QuestionProgressSnapshot['phase'];
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
  // 顺序保持 caller 传入的形态 —— question-runner 已按 chapter_no asc 拉好，这里别再 .sort()
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

  const result = await extractQuestionsFromPdf({
    pdfPath: opts.pdfPath,
    providerId: opts.providerId,
    sourceSha256: opts.sourceSha256,
    store: opts.store,
    // 默认 2 页/调用：与 admin/lib/kp-pipeline-vision.ts 对齐。
    // 实测 3 页 @ 150 DPI 时 Webex Gemini 输出被压到 100-200 字符截断（每片只能吐
    // 一道题题干前半段就停 → 全片 0 questions）；同 provider 同 DPI 跑 KP（也是 2 页）
    // 一直稳定。L2 默认值 3 是给宽松 vision 模型设计的，对 Webex Gemini 太激进。
    pagesPerCall: opts.pagesPerCall ?? 2,
    dpi: opts.dpi ?? 150,
    // L2 默认 chunk 间 sleep 8s（converse 时代为防 429 设的过度保守值）。
    // 实测 webex-gemini-3.1-pro 串行跑 0 个 429（KP 管线一样路径，profile 见
    // .run/dev.log），8s sleep 是空转 —— 100 页 / 34 chunks 白等 ~270s。
    // 调 0；如果以后真撞 429，callLLM 内部已有 Retry-After 退避。
    delayBetweenRequestsSeconds: 0,
    // 自定义 chunk prompt：用 shared 的 Question 抽题模板，
    // 覆盖 extractQuestionsFromPdf 的默认 prompt（默认是通用 KP/题混合抽，结构与 Question
    // schema 不完全对齐 —— 比如缺了 difficulty 必填 / kp_hints 用学科术语等约束）。
    // 默认 prompt 输出仍带 _src_pages / _truncated_* 内部字段，是 L2 跨页修复必需，
    // 我们在合并时不会丢这些；shared chunk prompt 也保留了同形输出契约。
    chunkPromptBuilder: (ctx) =>
      [
        buildQuestionChunkPrompt({
          chunkIndex: ctx.chunkIndex,
          totalChunks: ctx.totalChunks,
          startPage: ctx.pages[0] ?? 1,
          endPage: ctx.pages[ctx.pages.length - 1] ?? ctx.pages[0] ?? 1,
          subjectName,
        }),
        dictSection, // 空字符串时不影响 prompt 形态；非空时把已有 KP 字典锚到 LLM 上
        '',
        '⚠️ 在 QuestionBatchSchema 形态之外，每条 question 必须额外带 L2 跨页修复字段：',
        '  - `_src_pages`: number[] —— 这题出现在哪几页（1-based）',
        '  - `_truncated_before` / `_truncated_after`: boolean —— 题干是否跨入上/下页',
        '  - `figures`: [{figure_no, alt?, bbox:[x1,y1,x2,y2]}] —— bbox 归一化 [0..1] 左上原点',
        '另外把 `kp_hints` / `source_hint` / `difficulty` 等 Question 字段带上。',
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
            lastEvent: `chunk #${e.chunkIndex} done — ${e.questionCount} questions (${e.truncatedCount} truncated)`,
          });
          break;
        case 'chunk_error':
          chunksFailed += 1;
          // 错误 reason 必须落 stderr 留痕：上层 patchProgress 是 fire-and-forget，
          // 最终事务 raw_response 写入容易被尾部 'done' patch 抢先覆盖（实测 job
          // 9020d7d2 的 chunks 数组连同 error 字段全被尾 patch 吞了，只剩 chunksFailed 计数）。
          // 不修 race（race 在 caller 层），先保证 dev.log 能看到 reason。
          {
            const errAny = e.error as { rawText?: string; message?: string } | unknown;
            const rawText =
              typeof errAny === 'object' && errAny && 'rawText' in errAny
                ? String((errAny as { rawText?: unknown }).rawText ?? '')
                : '';
            console.warn(
              `[question-pipeline] chunk #${e.chunkIndex} (pages ${e.pages.join(',')}) failed: ${String(e.error).slice(0, 500)}`,
            );
            if (rawText) {
              console.warn(
                `[question-pipeline] chunk #${e.chunkIndex} rawText (len=${rawText.length}):\n${rawText.slice(0, 800)}`,
              );
            }
          }
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
            lastEvent: `boundary ${e.pages.join('-')} → +${e.addedQuestionCount} questions`,
          });
          break;
        case 'dedup_done':
          emit({
            phase: 'cropping',
            questionCount: e.after,
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
    questionCount: result.questions.length,
    figureCount: result.derivedAssets.length,
    lastEvent: `done: ${result.questions.length} questions, ${result.derivedAssets.length} figures`,
  });

  return result;
}
