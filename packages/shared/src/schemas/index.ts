/**
 * zod schemas 入口 — 跨端共享的 API / LLM 契约 schema。
 *
 * 子模块：
 *   - knowledge-point  KP 解析输出（admin 上传教材 → LLM → staging）
 *   - question         试题解析输出（admin 上传题集 → LLM → staging）
 *   - source-document  资料来源结构化输出
 *   - learning-material 辅导资料中的方法卡 / 易错 / 总结输出
 *
 * 业务 schema 待 M4–M9 阶段按需补齐。
 */
export * from './knowledge-point';
export * from './learning-material';
export * from './mixed-learning-material';
export * from './question';
export * from './source-document';
export * from './source-unit';
