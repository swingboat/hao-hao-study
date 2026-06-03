/**
 * @hao/shared — 跨端共享业务逻辑入口。
 *
 * 子模块（按主 PRD 切分）：
 *   - schemas/         zod schemas（API 请求/响应、LLM 输出契约）
 *   - recommender/     三池凑题（主 PRD §G3.1）
 *   - session-commit/  G3.3 提交事务（6 步原子）
 *   - mastery/         Mastery 增减规则（主 PRD §10.2）
 *
 * 当前为骨架，业务实现待 M4/M5 阶段补齐。
 */
export const SHARED_VERSION = '0.1.0';
