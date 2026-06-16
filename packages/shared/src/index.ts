/**
 * @hao/shared — 跨端共享业务逻辑入口。
 *
 * 子模块（按主 PRD 切分）：
 *   - labels/          年级 / 学段中文展示标签字典（packages/shared/labels）
 *   - schemas/         zod schemas（API 请求/响应、LLM 输出契约）
 *   - prompts/         LLM prompt 模板（跨端复用部分）
 *   - question-planner/ 学生端公共出题 Planner 纯函数
 *
 * M4/M5 的 recommender / session-commit / mastery 等实现按需创建，不预留空壳。
 */
export * from './labels';
export * from './question-planner';

export const SHARED_VERSION = '0.1.0';
