/**
 * zod schemas 入口 — 跨端共享的 API / LLM 契约 schema。
 *
 * 子模块：
 *   - knowledge-point  KP 解析输出（admin 上传教材 → LLM → staging）
 *   - practice-item    题目解析输出（admin 上传题集 → LLM → staging）
 *
 * 业务 schema 待 M4–M9 阶段按需补齐。
 */
export * from './knowledge-point';
export * from './practice-item';
