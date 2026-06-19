/**
 * 知识点（KP）解析输出 zod schema — LLM → admin 审核流程契约
 *
 * 用途：admin route 接收 @hao/llm 公共解析入口输出后，用本 schema 约束进入 staging
 * 的知识点候选。LLM prompt/schema 调整必须先在 how-to-use-llm-proxy 验证并同步。
 *
 * 字段对齐策略（与 packages/db/prisma/schema.prisma model knowledge_point 保持收敛）：
 *   - name        必填，对应 knowledge_point.name（min 2 / max 50，约束放在 LLM 这层早 fail）
 *   - chapter_no  可空，对应 knowledge_point.chapter_no（教材章节编号文本，如 "§3.2"）
 *   - brief       仅给运营在 staging 抽屉里看的简介；不入正式表，停留在 llm_payload
 *
 * 不放 subject_id：subject 由调用方上下文（admin 选了哪本教材）注入，避免 LLM 幻觉。
 */
import { z } from 'zod';

/** 单条 KP 候选（一行 staging） */
export const KnowledgePointParsedSchema = z.object({
  name: z.string().min(2, 'KP name 至少 2 字符').max(50, 'KP name 不超过 50 字符'),
  chapter_no: z.string().max(20).nullable().optional(),
  /** 给运营审核展示，不入正式 knowledge_point 表 */
  brief: z.string().max(200).optional(),
});
export type KnowledgePointParsed = z.infer<typeof KnowledgePointParsedSchema>;

/**
 * LLM 一次解析的批量输出。
 * 上限 500：人教 A 版必修一探针实测 GPT-5.4 v3 prompt 全本可产 ~234 条；
 * 500 = 1.2× 安全余量，超过即视为提示词写崩了 / 重复抽取。
 */
export const KnowledgePointBatchSchema = z.object({
  items: z
    .array(KnowledgePointParsedSchema)
    .min(1, '至少应抽出 1 个 KP')
    .max(500, '单次解析超过 500 个 KP，疑似提示词失控'),
});
export type KnowledgePointBatch = z.infer<typeof KnowledgePointBatchSchema>;
