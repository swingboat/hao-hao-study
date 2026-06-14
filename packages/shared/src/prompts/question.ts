/**
 * 题目（question）LLM 抽取 prompt 模板
 *
 * 用途：admin F3.1–F3.2 调 analyzePdf 时作为 chunkPromptBuilder / finalPromptBuilder 传入。
 *      callLLM 内部会把 QuestionBatchSchema 注入 prompt 末尾（bedrock_converse adapter
 *      的 schemaInPrompt 路径），LLM 输出后端会用 zod 兜底校验。
 *
 * 版本：QUESTION_PROMPT_VERSION 写到 llm_parse_job.prompt_version，方便审计追溯
 *      某次 staging 是哪个 prompt 版本产出的。改 prompt 时务必 bump 版本号。
 *
 * 与 KP 抽取 prompt（admin 自管 buildKpPrompt）的关系：
 *   - KP prompt 由 admin 写在自己包里（缺乏跨端复用）
 *   - 题目 prompt 放 shared 因为 prompt 体量大、约束细（Q2=a essay 丢弃 / kp_hints 形态 /
 *     图片描述规范 / 选项标号约定）三端都用到（admin 写、shared schema 校验、未来 web 端
 *     在 G3.4 解析页显示原文时也可能用到）
 */

/** prompt 版本字符串。改 prompt 时务必同步 bump。 */
export const QUESTION_PROMPT_VERSION = 'question.v1.2026-06-07';

export interface QuestionChunkPromptCtx {
  chunkIndex: number;
  totalChunks: number;
  startPage: number;
  endPage: number;
  /** 学科上下文（如 "高中数学"），用来锚定 KP 命名风格，避免 LLM 跑题 */
  subjectName: string;
}

export interface QuestionFinalPromptCtx {
  pdfPath: string;
  pageCount: number;
  subjectName: string;
  /** 各 chunk 已抽出的题目摘要（chunk_index + 题数 + 简短 KP 主题，整本去重用） */
  chunkSummaries: Array<{
    chunkIndex: number;
    startPage: number;
    endPage: number;
    /** chunk 阶段已抽出的题目 JSON 文本 —— 终审用来合并 + 输出最终批次 */
    text: string;
  }>;
}

/**
 * 单 chunk prompt：让 LLM 从 PDF 切片里抽出本片所有题目，输出 QuestionBatchSchema
 * 形状。analyzePdf 会把 PDF 切片本身作为 attachment 直接附在 prompt 后。
 *
 * 关键约束写进 prompt（schema 兜底再校一次，但 prompt 引导能减少 retry）：
 *   1. 仅抽 choice / fill_in；essay 整道丢弃
 *   2. content 含图时用 `[图片描述: ...]` 标注（Claude Converse 能看到原图）
 *   3. kp_hints 用学科领域内的标准术语（如"集合的运算"而非"集合"或"集合运算"）
 *   4. answer 形态严格：choice 用大写字母拼接，fill_in 多空用分号
 *   5. solution_text 抽不到给空串，不要编
 */
export function buildQuestionChunkPrompt(ctx: QuestionChunkPromptCtx): string {
  return [
    `你正在帮 ${ctx.subjectName} 教研团队从一份题集 PDF 里抽取题目入题库。`,
    `当前是第 ${ctx.chunkIndex}/${ctx.totalChunks} 个 PDF 分片（原 PDF 第 ${ctx.startPage}-${ctx.endPage} 页）。`,
    '',
    '请把这个分片里**每一道独立题目**抽取出来，按 JSON schema 输出。规则：',
    '',
    '【题型边界】',
    '1. **只接受**两种题型：',
    '   - `choice`：选择题（单选 / 多选），必须含 ≥2 个选项',
    '   - `fill_in`：填空题（单空 / 多空）',
    '2. **强制丢弃**：解答题 / 证明题 / 论述题 / 计算题（带过程的）/ 任何要求学生写多步推导的题。',
    '   v0.1 MVP 只支持机器自动批改，主观题不入库。',
    '',
    '【字段规范】',
    '- `content`：题干正文。若题目带图（几何图 / 函数图像 / 表格），在题干末尾用 `[图片描述: ...]` 标注，',
    '  描述要让没看过原图的人也能解题（坐标点 / 几何关系 / 关键标注），不要只写"如图所示"。',
    '- `question_type`：`"choice"` 或 `"fill_in"`，必填。',
    '- `options`：',
    '    - choice 题：按原文顺序列出，label 是大写字母 A/B/C/D...，text 是选项正文（不含 "A." 前缀）。',
    '    - fill_in 题：留空数组 `[]`。',
    '- `answer`：',
    '    - choice 单选："A"；choice 多选按字母序拼接如 "AB"、"ACD"。',
    '    - fill_in 单空：直接写答案文本；多空用半角分号分隔如 "8;7"。',
    '- `solution_text`：解析全文。若原 PDF 没给解析就留**空字符串 ""**，不要编。',
    '- `difficulty`：1-5 整数估计（1=送分题 / 3=中等 / 5=压轴）。把握不准就给 3。',
    '- `kp_hints`：本题考查的知识点**名称**列表（不是 UUID）。第一个为主 KP 候选，按重要性排序。',
    `    用 ${ctx.subjectName} 领域的标准术语，2-50 字符，如"函数的单调性"、"集合的运算"、"等比数列求和"。`,
    '    不要写得太宽（如只写"函数"）也不要太窄（如"奇函数定义"），对齐教材一节的概念粒度。',
    '    至少 1 条，最多 5 条。条目之间不要重复。',
    '- `source_hint`：可选。能从分片里识别到题号时填 `{ page, question_no }`（question_no 如 "第 3 题" / "1.2.3"），',
    '    便于后续运营回 PDF 校对。',
    '',
    '【输出形态】',
    '严格按下方 JSON Schema 输出整个 QuestionBatchSchema（一个 `{ "questions": [...] }` 对象）。',
    '不要任何 markdown 包裹、不要解释文字、不要前后缀。',
    '如果本分片里一道题都没有（可能是封面 / 答案页 / 索引），返回 `{ "questions": [] }` —— 上层会兜底转成空批次。',
  ].join('\n');
}

/**
 * 终审 prompt：把各 chunk 抽出的题目合并去重、规范化输出。
 *
 * 实际行为：
 *   - chunk 阶段已经按 schema 抽好，终审主要做"跨 chunk 看是否同题重复（两个 chunk 切边附近）"
 *   - 终审输出 schema 仍是 QuestionBatchSchema —— admin 可以直接拿来批量入 staging
 *   - 终审不带 PDF attachment，纯文本聚合
 *
 * 注意：终审是可选的。admin 也可以直接用 chunk 结果合并，跳过终审 LLM 调用以省 token。
 *      analyzePdf 当前固定有终审；后续如果加 `skipFinalSynthesis` 选项 admin 可以关掉。
 */
export function buildQuestionFinalPrompt(ctx: QuestionFinalPromptCtx): string {
  const chunkBlocks = ctx.chunkSummaries
    .map((s) =>
      [`--- 分片 ${s.chunkIndex}（第 ${s.startPage}-${s.endPage} 页）---`, s.text].join('\n'),
    )
    .join('\n\n');

  return [
    `下面是 ${ctx.subjectName} 题集 ${ctx.pdfPath}（共 ${ctx.pageCount} 页）按页分片后各 chunk 抽出的题目 JSON。`,
    '',
    '请合并所有分片的题目，做下面三件事：',
    '1. 把跨分片切边附近**明显重复**的题（同 content / 同 answer）只保留一份。',
    '2. 规范化 kp_hints：同一概念的不同写法统一（如"集合运算" / "集合的运算" 统一成"集合的运算"）。',
    '3. 按原 PDF 出现顺序排序输出（用 source_hint.page → question_no 排序，缺失的排末尾）。',
    '',
    '严格按 QuestionBatchSchema 输出整个 `{ "questions": [...] }`，规则与各分片相同：',
    '- 仅 choice / fill_in 两类',
    '- 字段规范、长度约束、答案形态与分片阶段一致',
    '- 不要任何 markdown 包裹、不要解释文字',
    '',
    chunkBlocks,
  ].join('\n');
}
