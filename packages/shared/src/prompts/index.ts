/**
 * @hao/shared/prompts — LLM prompt 模板入口
 *
 * 设计原则：跨端复用的 prompt 放这里；只有 admin 用的简单 prompt 留在 apps/admin/lib/prompts.ts。
 * 每个 prompt 模块导出 PROMPT_VERSION 常量，admin 落 llm_parse_job.prompt_version 时引用。
 */
export {
  buildQuestionChunkPrompt,
  buildQuestionFinalPrompt,
  QUESTION_PROMPT_VERSION,
  type QuestionChunkPromptCtx,
  type QuestionFinalPromptCtx,
} from './question';
