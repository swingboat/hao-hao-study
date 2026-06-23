// @ts-nocheck
import { z } from 'zod';

import { callLlm } from '../llm/llm-client.ts';
import { findLlmTargetByIdOrAlias } from '../llm/target-ids.ts';

export const QUESTION_ANSWER_DRAFT_PROMPT_VERSION = 'question/common/generateQuestionAnswerDraft';

export const questionAnswerDraftSchema = z
  .object({
    kind: z.literal('question_answer_draft'),
    answer: z.string(),
    solution_text: z.string(),
    confidence: z.number().min(0).max(1).nullable(),
    warnings: z.array(z.string()),
    prompt_version: z.literal(QUESTION_ANSWER_DRAFT_PROMPT_VERSION),
  })
  .strict();

export async function generateQuestionAnswerDraft(request: Record<string, unknown> = {}) {
  const {
    providerId,
    question = {},
    knowledge,
    llmConfig,
    llmTarget,
    llmTargetId,
    targetConfig = {},
    target,
    targetId,
    maxTokens,
    temperature,
    apiKey,
    payloadLogPath,
    payloadLogLimit,
    callLlmImpl = callLlm,
  } = request;
  const preflight = detectQuestionAnswerDraftInputWarnings(question);
  if (preflight.fatal) {
    return emptyQuestionAnswerDraft(preflight.warnings);
  }

  const resolvedLlmConfig = resolveLlmConfig({ llmConfig, targetConfig });
  const resolvedLlmTarget = resolveLlmTarget({
    llmConfig: resolvedLlmConfig,
    llmTarget: llmTarget ?? target,
    llmTargetId: llmTargetId ?? targetId ?? providerId,
  });
  const prompt = buildQuestionAnswerDraftPrompt({ question, knowledge });
  const llmResult = await callLlmImpl(
    omitUndefined({
      llmConfig: resolvedLlmConfig,
      llmTarget: resolvedLlmTarget,
      targetConfig: resolvedLlmConfig,
      target: resolvedLlmTarget,
      input: prompt,
      maxTokens: maxTokens == null ? undefined : maxTokens,
      temperature,
      apiKey,
      payloadLogPath,
      payloadLogLimit,
      requestLabel: QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
    }),
  );
  if (llmResult.ok === false) {
    return emptyQuestionAnswerDraft([
      ...preflight.warnings,
      `LLM 调用失败，未生成参考解答草稿。${llmResult.error_message ? `错误：${llmResult.error_message}` : ''}`,
    ]);
  }
  if (!String(llmResult.text ?? '').trim()) {
    return emptyQuestionAnswerDraft([
      ...preflight.warnings,
      'LLM 未返回可见文本，无法生成参考解答草稿。',
    ]);
  }

  const parsed = parseQuestionAnswerDraftText(llmResult.text);
  if (isQuestionAnswerDraftParseFailure(parsed)) {
    const repaired = await repairQuestionAnswerDraftJson({
      callLlmImpl,
      request: {
        llmConfig: resolvedLlmConfig,
        llmTarget: resolvedLlmTarget,
        targetConfig: resolvedLlmConfig,
        target: resolvedLlmTarget,
        maxTokens: maxTokens == null ? undefined : maxTokens,
        temperature,
        apiKey,
        payloadLogPath,
        payloadLogLimit,
      },
      originalPrompt: prompt,
      previousOutput: llmResult.text,
      parseWarnings: parsed.warnings,
    });
    if (!isQuestionAnswerDraftParseFailure(repaired)) {
      return normalizeQuestionAnswerDraft({
        ...repaired,
        warnings: [...preflight.warnings, ...repaired.warnings],
      });
    }
    return normalizeQuestionAnswerDraft({
      ...repaired,
      warnings: [
        ...preflight.warnings,
        ...parsed.warnings,
        '已尝试修复模型输出 JSON，但仍未得到合法结构。',
      ],
    });
  }

  return normalizeQuestionAnswerDraft({
    ...parsed,
    warnings: [...preflight.warnings, ...parsed.warnings],
  });
}

export function buildQuestionAnswerDraftPrompt(request: Record<string, unknown> = {}) {
  const { question = {}, knowledge } = request;
  const promptInput = {
    question: normalizeQuestionForDraftPrompt(question),
    knowledge: normalizeKnowledgeForDraftPrompt(knowledge),
  };
  return [
    `prompt_version: ${QUESTION_ANSWER_DRAFT_PROMPT_VERSION}`,
    '',
    '你是一名数学/学科教研老师，正在为 admin 审核后台生成“admin 审核辅助草稿：AI 参考解答草稿”。',
    '这个能力只用于审核辅助，不是学习资料原文解析结果。',
    '',
    '硬性要求：',
    '- 只返回 JSON，不要用 Markdown，不要用 ``` 包裹。',
    '- 输出必须严格符合下方 schema；不要输出 schema 之外的字段。',
    '- 不要输出 quality_status、answer_source、source_answer、source_solution、from_source、original_answer 等可能被误解为原文答案的字段。',
    '- 必须根据题干、选项、知识点上下文独立解题；question.answer 与 question.solution_text 只可作为待核对信息，不能当作原文答案。',
    '- 不得声称答案来自原文、教材、解析册、图片 OCR 或上传资料。',
    '- 不要编造题干没有给出的条件、图片、图表、答案或解析。',
    '- 条件不足时返回 warnings，answer 可以是空字符串 ""，solution_text 也可以是空字符串 ""。',
    '- 题干不完整、选项缺失、图片/图表信息不足、公式无法辨认时，不要硬答。',
    '- 选择题 answer 返回选项字母和必要文本，例如 "B. {1,2,3}"；如果无法确定选项，answer 返回 ""。',
    '- 填空题 answer 返回最终填空内容，不要添加多余解释。',
    '- 解答题/证明题 answer 返回最终结论或关键结果；如果题目要求证明且无法完整证明，answer 返回 "" 并写 warnings。',
    '- solution_text 返回简洁推导步骤；不要写与题目无关的知识讲解。',
    '- confidence 是 0 到 1 的数字；信息不足或无法判断时为 null。',
    '',
    '返回 JSON schema：',
    '{',
    '  "kind": "question_answer_draft",',
    '  "answer": "AI 参考答案草稿；条件不足时为空字符串",',
    '  "solution_text": "AI 参考解析草稿；条件不足时为空字符串",',
    '  "confidence": 0.0,',
    '  "warnings": ["输入不足、选项缺失、图表缺失、公式无法辨认等诊断"],',
    `  "prompt_version": "${QUESTION_ANSWER_DRAFT_PROMPT_VERSION}"`,
    '}',
    '',
    '输入数据：',
    JSON.stringify(promptInput, null, 2),
  ].join('\n');
}

export function parseQuestionAnswerDraftText(text) {
  const candidate = extractJsonObjectCandidate(text);
  if (!candidate) {
    return emptyQuestionAnswerDraft(['模型输出不是可解析 JSON：未找到完整 JSON 对象。']);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return emptyQuestionAnswerDraft([`模型输出不是可解析 JSON：${error.message}`]);
  }

  return normalizeQuestionAnswerDraft(parsed);
}

async function repairQuestionAnswerDraftJson({
  callLlmImpl,
  request,
  originalPrompt,
  previousOutput,
  parseWarnings,
}) {
  const repairResult = await callLlmImpl(
    omitUndefined({
      ...request,
      input: buildQuestionAnswerDraftRepairPrompt({
        originalPrompt,
        previousOutput,
        parseWarnings,
      }),
      requestLabel: `${QUESTION_ANSWER_DRAFT_PROMPT_VERSION}:repair-json`,
    }),
  );
  if (repairResult.ok === false) {
    return emptyQuestionAnswerDraft([
      `LLM JSON 修复调用失败。${repairResult.error_message ? `错误：${repairResult.error_message}` : ''}`,
    ]);
  }
  if (!String(repairResult.text ?? '').trim()) {
    return emptyQuestionAnswerDraft(['LLM JSON 修复调用未返回可见文本。']);
  }
  return parseQuestionAnswerDraftText(repairResult.text);
}

function buildQuestionAnswerDraftRepairPrompt({ originalPrompt, previousOutput, parseWarnings }) {
  return [
    `prompt_version: ${QUESTION_ANSWER_DRAFT_PROMPT_VERSION}`,
    '',
    '上一次模型输出不是可解析 JSON。请根据原始任务和上一次输出，修复为严格 JSON。',
    '只返回 JSON，不要 Markdown，不要解释。',
    '不要添加 schema 之外的字段。',
    '',
    '必须返回：',
    '{',
    '  "kind": "question_answer_draft",',
    '  "answer": "",',
    '  "solution_text": "",',
    '  "confidence": null,',
    '  "warnings": [],',
    `  "prompt_version": "${QUESTION_ANSWER_DRAFT_PROMPT_VERSION}"`,
    '}',
    '',
    '解析失败原因：',
    normalizeStringArray(parseWarnings).join('\n'),
    '',
    '原始任务：',
    originalPrompt,
    '',
    '上一次模型输出：',
    String(previousOutput ?? '').slice(0, 8000),
  ].join('\n');
}

function isQuestionAnswerDraftParseFailure(result) {
  return normalizeStringArray(result?.warnings).some((warning) =>
    /模型输出不是可解析 JSON/.test(warning),
  );
}

function detectQuestionAnswerDraftInputWarnings(question = {}) {
  const warnings = [];
  const content = String(question?.content ?? question?.stem ?? '').trim();
  const questionType = normalizeQuestionTypeText(question?.question_type ?? question?.type);
  const options = normalizeDraftOptions(question?.options);

  if (!content || /【\s*在这里粘贴题干\s*】|^\s*题干\s*$/i.test(content)) {
    warnings.push('题干为空或仍是占位内容，无法生成可靠参考答案。');
  }
  if (questionType === 'choice' && options.length === 0) {
    warnings.push('选择题缺少选项，无法稳定判断答案。');
  }
  if (dependsOnMissingVisual(question)) {
    warnings.push('题干依赖图片/图表信息，但输入没有提供可解题的图片、图表或文字描述。');
  }

  return {
    fatal: warnings.length > 0,
    warnings,
  };
}

function dependsOnMissingVisual(question = {}) {
  const content = String(question?.content ?? question?.stem ?? '');
  if (!/(如图|下图|图中|图示|图表|图片|表格|表中|统计图|坐标图|函数图象|几何图形)/.test(content)) {
    return false;
  }
  const visualFields = [
    question.figure,
    question.figures,
    question.images,
    question.image,
    question.image_text,
    question.image_description,
    question.diagram_text,
    question.table,
    question.tables,
  ];
  return !visualFields.some(hasMeaningfulVisualContext);
}

function hasMeaningfulVisualContext(value) {
  if (Array.isArray(value)) return value.some(hasMeaningfulVisualContext);
  if (!value) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value !== 'object') return false;
  return Object.values(value).some((item) => {
    if (typeof item === 'string') return item.trim().length > 0;
    if (Array.isArray(item)) return item.length > 0;
    return Boolean(item);
  });
}

function normalizeQuestionForDraftPrompt(question = {}) {
  return omitUndefined({
    content: String(question.content ?? question.stem ?? ''),
    question_type: normalizeQuestionTypeText(question.question_type ?? question.type),
    options: normalizeDraftOptions(question.options),
    answer: question.answer == null ? undefined : String(question.answer),
    solution_text:
      question.solution_text == null && question.analysis == null
        ? undefined
        : String(question.solution_text ?? question.analysis),
    kp_hints: normalizeStringArray(question.kp_hints ?? question.related_knowledge_points),
    subjectName:
      question.subjectName == null && question.subject_name == null
        ? undefined
        : String(question.subjectName ?? question.subject_name),
    source_ref:
      question.source_ref == null
        ? undefined
        : typeof question.source_ref === 'string'
          ? question.source_ref
          : JSON.stringify(question.source_ref),
    image_description:
      question.image_description == null &&
      question.image_text == null &&
      question.diagram_text == null
        ? undefined
        : String(question.image_description ?? question.image_text ?? question.diagram_text),
  });
}

function normalizeKnowledgeForDraftPrompt(knowledge) {
  const source = normalizeKnowledgeSource(knowledge);
  return source.points.slice(0, 80).map((point) =>
    omitUndefined({
      id: point.id == null ? undefined : String(point.id),
      name: point.name == null ? undefined : String(point.name),
      chapter_title: point.chapter_title == null ? undefined : String(point.chapter_title),
      section_title: point.section_title == null ? undefined : String(point.section_title),
      brief:
        point.description == null && point.brief == null
          ? undefined
          : String(point.description ?? point.brief),
      formulas: normalizeStringArray(point.formulas),
    }),
  );
}

function normalizeQuestionTypeText(value) {
  const raw = String(value ?? 'unknown').trim();
  const lower = raw.toLowerCase();
  if (/choice|single|multiple|选择/.test(lower)) return 'choice';
  if (/fill|blank|填空/.test(lower)) return 'fill_in';
  if (/proof|证明/.test(lower)) return 'proof';
  if (/solution|解答|计算|问答|short/.test(lower)) return 'solution';
  return raw || 'unknown';
}

function normalizeDraftOptions(value) {
  if (Array.isArray(value)) {
    return value.map((option, index) => normalizeDraftOption(option, index)).filter(Boolean);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([label, text], index) => normalizeDraftOption({ label, text }, index))
      .filter(Boolean);
  }
  return [];
}

function normalizeDraftOption(option, index) {
  const fallbackLabel = String.fromCharCode(65 + index);
  if (typeof option === 'string') {
    const match = option.match(/^\s*([A-H])[\.\、\)]?\s*(.*)$/i);
    return {
      label: match ? match[1].toUpperCase() : fallbackLabel,
      text: match ? match[2].trim() : option.trim(),
    };
  }
  if (!option || typeof option !== 'object') return null;
  const label = String(option.label ?? option.key ?? option.option ?? fallbackLabel)
    .trim()
    .toUpperCase();
  const text = String(option.text ?? option.value ?? option.content ?? '').trim();
  if (!label && !text) return null;
  return {
    label: label || fallbackLabel,
    text,
  };
}

function normalizeQuestionAnswerDraft(value, extraWarnings = []) {
  const input = value && typeof value === 'object' ? value : {};
  const draft = {
    kind: 'question_answer_draft',
    answer: stringOrEmpty(input.answer),
    solution_text: stringOrEmpty(input.solution_text ?? input.solution ?? input.analysis),
    confidence: normalizeNullableConfidence(input.confidence),
    warnings: dedupeStringArray([
      ...normalizeStringArray(input.warnings),
      ...normalizeStringArray(extraWarnings),
    ]),
    prompt_version: QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
  };
  const validation = questionAnswerDraftSchema.safeParse(draft);
  if (validation.success) return validation.data;
  return {
    ...emptyQuestionAnswerDraft(['草稿结构校验失败，已返回空草稿。']),
    warnings: dedupeStringArray([...draft.warnings, '草稿结构校验失败，已返回空草稿。']),
  };
}

function emptyQuestionAnswerDraft(warnings = []) {
  return {
    kind: 'question_answer_draft',
    answer: '',
    solution_text: '',
    confidence: null,
    warnings: dedupeStringArray(normalizeStringArray(warnings)),
    prompt_version: QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
  };
}

function stringOrEmpty(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
}

function normalizeNullableConfidence(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

function dedupeStringArray(value) {
  const output = [];
  const seen = new Set();
  for (const item of value ?? []) {
    const text = String(item ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function normalizeKnowledgeSource(knowledge) {
  if (Array.isArray(knowledge)) return { points: knowledge };
  if (knowledge && typeof knowledge === 'object') {
    if (Array.isArray(knowledge.points)) return { points: knowledge.points };
    if (Array.isArray(knowledge.knowledge_points)) return { points: knowledge.knowledge_points };
    if (Array.isArray(knowledge.items)) return { points: knowledge.items };
  }
  return { points: [] };
}

function extractJsonObjectCandidate(text) {
  const value = String(text ?? '').trim();
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return value.slice(start, end + 1);
}

function resolveLlmConfig({ llmConfig, targetConfig }) {
  return llmConfig ?? targetConfig ?? {};
}

function resolveLlmTarget({ llmConfig, llmTarget, llmTargetId }) {
  if (llmTarget) return llmTarget;
  const requestedTargetId =
    llmTargetId ?? llmConfig.defaultLlmTargetId ?? llmConfig.defaultTargetId;
  const targets = llmConfig.llmTargets ?? llmConfig.targets ?? [];
  const found = requestedTargetId ? findLlmTargetByIdOrAlias(targets, requestedTargetId) : null;
  if (found) return found;
  if (requestedTargetId) throw new Error(`Unknown LLM target: ${requestedTargetId}`);
  throw new Error('llmTarget or llmTargetId is required');
}

function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
