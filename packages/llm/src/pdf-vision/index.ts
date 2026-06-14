/**
 * @hao/llm/pdf-vision — PDF Vision 流水线公共层
 *
 * 抽自 apps/admin/lib/kp-pipeline-vision.ts 与 packages/llm/src/vision/extract-questions-from-pdf.ts
 * 中"与具体业务无关"的部分。两条线（KP / Questions）是同一件事的两个不完整实现 —— 各做了对方没做的
 * 一半（KP 有并发+cache+split-fallback 没 boundary；Questions 有 boundary+dedup+figure crop 没并发+
 * cache+split-fallback）。把这些纯机械逻辑抽到这里，业务侧（admin/lib/kp-pipeline-vision.ts、
 * admin/lib/question-pipeline.ts）只留 prompt + schema + 后处理。
 *
 * 当前进度（Task #1，分 5 步）：
 *   Step 1（本文件首次出现）：concurrent-pool / split-fallback —— KP 接入
 *   Step 2（待）：boundary 检测重抽 —— Questions 接入
 *   Step 3（待）：rasterize-cache —— 双方共用
 *   Step 4（待）：runChunkedVisionPipeline 统一编排 —— KP/Questions 改薄壳
 *   Step 5（待）：删除老 kp-pipeline.ts（converse）+ pdf-extract.ts（pdf-parse）
 */
export { runConcurrentPool } from './concurrent-pool';
export type { ConcurrentPoolOpts, PoolResult } from './concurrent-pool';
export { callWithSplitFallback } from './split-fallback';
export type {
  CallWithSplitFallbackOpts,
  CallWithSplitFallbackResult,
} from './split-fallback';
