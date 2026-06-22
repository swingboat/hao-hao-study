// @ts-nocheck
import { z } from 'zod';

import { callLlm } from '../llm/llm-client.ts';
import { findLlmTargetByIdOrAlias } from '../llm/target-ids.ts';

export const QUESTION_ANSWER_DRAFT_PROMPT_VERSION = 'question/common/generateQuestionAnswerDraft';

export const questionAnswerDraftSchema = z
  .object({
    answer: z.string().default(''),
    solution_text: z.string().default(''),
    confidence: z.number().min(0).max(1).nullable().default(null),
    warnings: z.array(z.string().max(180)).default([]),
  })
  .strip();

export async function generateQuestionAnswerDraft(request: Record<string, unknown> = {}) {
  const {
    question,
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
    onProgress,
    callLlmImpl = callLlm,
  } = request;
  const resolvedLlmConfig = resolveLlmConfig({ llmConfig, targetConfig });
  const resolvedLlmTarget = resolveLlmTarget({
    llmConfig: resolvedLlmConfig,
    llmTarget: llmTarget ?? target,
    llmTargetId: llmTargetId ?? targetId,
  });
  const validation = validateQuestionForDraft(question);
  if (validation.blockingWarnings.length > 0) {
    onProgress?.({
      stage: 'draft_skipped',
      progress_percent: 100,
      message: validation.blockingWarnings.join('；'),
    });
    return emptyDraftResult({
      llmTarget: resolvedLlmTarget,
      warnings: validation.blockingWarnings,
      payloadLogPath,
      skippedReason: 'insufficient_question_input',
    });
  }

  const prompt = buildQuestionAnswerDraftPrompt({ question, knowledge });
  onProgress?.({
    stage: 'draft_started',
    progress_percent: 10,
    message: '开始生成参考答案/解析草稿',
  });

  const llmResult = await callLlmImpl({
    llmConfig: resolvedLlmConfig,
    llmTarget: resolvedLlmTarget,
    targetConfig: resolvedLlmConfig,
    target: resolvedLlmTarget,
    input: prompt,
    maxTokens,
    temperature,
    apiKey,
    payloadLogPath,
    payloadLogLimit,
    requestLabel: 'generateQuestionAnswerDraft',
  });

  const llm = llmInfo({ result: llmResult, target: resolvedLlmTarget });
  const parsed = parseQuestionAnswerDraftText(llmResult.text);
  if (!parsed.ok) {
    onProgress?.({
      stage: 'draft_failed',
      progress_percent: 100,
      message: '模型输出未通过结构化校验',
    });
    return {
      kind: 'question_answer_draft',
      status: 'failed',
      answer: '',
      solution_text: '',
      confidence: null,
      warnings: [...validation.nonBlockingWarnings, '模型输出不是合法结构化草稿，需要人工处理。'],
      prompt_version: QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
      draft_source: 'ai_generated_review_draft',
      llm,
      diagnostics: {
        parse_error: parsed.parse_error,
        validation_error: parsed.validation_error,
        payload_log_path: payloadLogPath ?? '',
      },
      usage: llmResult.usage ?? null,
      latency_ms: llmResult.latency_ms ?? null,
      ok: false,
    };
  }

  onProgress?.({
    stage: 'draft_done',
    progress_percent: 100,
    message: '参考答案/解析草稿生成完成',
  });

  return {
    kind: 'question_answer_draft',
    status: llmResult.ok === false ? 'partial' : 'ok',
    ...parsed.draft,
    warnings: [...validation.nonBlockingWarnings, ...parsed.draft.warnings],
    prompt_version: QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
    draft_source: 'ai_generated_review_draft',
    llm,
    diagnostics: {
      parse_error: null,
      validation_error: null,
      payload_log_path: payloadLogPath ?? '',
    },
    usage: llmResult.usage ?? null,
    latency_ms: llmResult.latency_ms ?? null,
    ok: llmResult.ok !== false,
  };
}

export function buildQuestionAnswerDraftPrompt({ question, knowledge } = {}) {
  const safeQuestion = normalizeQuestionForPrompt(question);
  const safeKnowledge = sanitizeForPrompt(knowledge ?? null);

  return [
    '你是一名高中学科教研审核助手。请为单道待审核题生成“参考答案/解析草稿”，供 admin 人工审核辅助使用。',
    '',
    `prompt_version: ${QUESTION_ANSWER_DRAFT_PROMPT_VERSION}`,
    '',
    '硬性要求：',
    '- 这是审核辅助草稿，不是原文解析结果。',
    '- 必须根据题干、选项和给定知识点上下文独立解题，不得声称答案来自原文。',
    '- 不要编造题目来源、原文答案、老师结论或未提供的图片信息。',
    '- 如果题干不完整、选项缺失、图片信息不足，answer 留空，并在 warnings 说明原因。',
    '- 对选择题，answer 返回选项字母和必要文本，例如 "B. 2 ∈ A"；solution_text 给出推导步骤。',
    '- 对填空题，answer 返回最终填空内容；solution_text 给出推导步骤。',
    '- 只返回 JSON，不要用 Markdown，不要用 ``` 包裹。',
    '',
    '返回 JSON schema：',
    '{',
    '  "answer": "参考答案；无法可靠判断时为空字符串",',
    '  "solution_text": "解析草稿；无法可靠判断时为空字符串",',
    '  "confidence": 0.0 到 1.0 的数字，无法判断则为 null,',
    '  "warnings": ["输入不足、选项缺失、图片信息不足等问题"]',
    '}',
    '',
    '待审核题：',
    JSON.stringify(safeQuestion, null, 2),
    '',
    '可选知识点上下文：',
    JSON.stringify(safeKnowledge, null, 2),
  ].join('\n');
}

export function parseQuestionAnswerDraftText(text) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return {
      ok: false,
      draft: null,
      parse_error: 'No JSON object found in model output.',
      validation_error: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return {
      ok: false,
      draft: null,
      parse_error: error.message,
      validation_error: null,
    };
  }

  const validation = questionAnswerDraftSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      ok: false,
      draft: null,
      parse_error: null,
      validation_error: validation.error.issues,
    };
  }

  return {
    ok: true,
    draft: normalizeDraft(validation.data),
    parse_error: null,
    validation_error: null,
  };
}

function normalizeDraft(draft) {
  return {
    answer: String(draft.answer ?? '').trim(),
    solution_text: String(draft.solution_text ?? '').trim(),
    confidence: typeof draft.confidence === 'number' ? draft.confidence : null,
    warnings: normalizeStringArray(draft.warnings),
  };
}

function validateQuestionForDraft(question) {
  const normalized = normalizeQuestionForPrompt(question);
  const blockingWarnings = [];
  const nonBlockingWarnings = [];

  if (!normalized.content || normalized.content.replace(/\s+/g, '').length < 6) {
    blockingWarnings.push('题干信息不足，无法可靠生成参考答案。');
  }

  if (normalized.question_type === 'choice' && normalized.options.length === 0) {
    blockingWarnings.push('选择题缺少选项，无法可靠生成参考答案。');
  }

  if (questionDependsOnMissingImage(normalized)) {
    blockingWarnings.push('题干依赖图片信息，但输入中没有可用图片内容。');
  }

  if (!['choice', 'fill_in'].includes(normalized.question_type)) {
    nonBlockingWarnings.push('题型不是 choice 或 fill_in，草稿仅供人工谨慎参考。');
  }

  return { blockingWarnings, nonBlockingWarnings };
}

function questionDependsOnMissingImage(question) {
  const content = question.content ?? '';
  const mentionsImage = /(如图|见图|下图|上图|图中|图示|图像|figure|image)/i.test(content);
  const hasFigureContent =
    Array.isArray(question.figures) &&
    question.figures.some((figure) => figure?.data || figure?.text);
  return mentionsImage && !hasFigureContent;
}

function emptyDraftResult({ llmTarget, warnings, payloadLogPath, skippedReason }) {
  return {
    kind: 'question_answer_draft',
    status: 'partial',
    answer: '',
    solution_text: '',
    confidence: null,
    warnings,
    prompt_version: QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
    draft_source: 'ai_generated_review_draft',
    llm: llmInfo({ result: {}, target: llmTarget }),
    diagnostics: {
      parse_error: null,
      validation_error: null,
      payload_log_path: payloadLogPath ?? '',
      skipped_reason: skippedReason,
    },
    usage: null,
    latency_ms: null,
    ok: false,
  };
}

function normalizeQuestionForPrompt(question = {}) {
  const input = question && typeof question === 'object' ? question : {};
  return {
    content: String(input.content ?? input.stem ?? '').trim(),
    question_type: normalizeQuestionType(input.question_type ?? input.type),
    options: normalizeOptions(input.options),
    answer: String(input.answer ?? '').trim(),
    solution_text: String(input.solution_text ?? input.analysis ?? '').trim(),
    kp_hints: normalizeStringArray(input.kp_hints ?? input.related_knowledge_points),
    subjectName: String(input.subjectName ?? input.subject_name ?? '').trim(),
    source_ref: sanitizeForPrompt(input.source_ref ?? null),
    figures: Array.isArray(input.figures) ? sanitizeForPrompt(input.figures) : [],
  };
}

function normalizeQuestionType(value) {
  const text = String(value ?? '').trim();
  if (text === 'choice' || /选择/.test(text)) return 'choice';
  if (text === 'fill_in' || text === 'fill-in' || /填空/.test(text)) return 'fill_in';
  return text || 'unknown';
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.flatMap((option, index) => {
    if (typeof option === 'string') {
      const match = option.match(/^\s*([A-Z])[\.\u3001、\)]?\s*(.*)$/i);
      return [
        {
          label: (match?.[1] ?? String.fromCharCode(65 + index)).toUpperCase(),
          text: (match?.[2] ?? option).trim(),
        },
      ];
    }
    if (!option || typeof option !== 'object') return [];
    return [
      {
        label: String(option.label ?? String.fromCharCode(65 + index)).trim(),
        text: String(option.text ?? option.content ?? option.value ?? '').trim(),
      },
    ];
  });
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

function llmInfo({ result, target }) {
  const llmTargetId = result.llm_target_id ?? result.target_id ?? target.id;
  return {
    llm_target_id: llmTargetId,
    target_id: llmTargetId,
    provider: result.provider ?? target.provider,
    model: result.model ?? target.model ?? null,
    api_shape: result.api_shape ?? target.api_shape,
  };
}

function extractJsonCandidate(text) {
  const value = String(text ?? '').trim();
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return value.slice(start, end + 1);
}

function normalizeStringArray(value) {
  const input = Array.isArray(value) ? value : value == null ? [] : [value];
  return [
    ...new Set(
      input
        .map((item) => {
          if (typeof item === 'string') return item.trim();
          if (item && typeof item === 'object') return String(item.name ?? item.title ?? '').trim();
          return String(item ?? '').trim();
        })
        .filter(Boolean),
    ),
  ];
}

function sanitizeForPrompt(value) {
  if (Array.isArray(value)) return value.map(sanitizeForPrompt);
  if (!value || typeof value !== 'object') return value;

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (isInternalKey(key)) continue;
    output[key] = sanitizeForPrompt(item);
  }
  return output;
}

function isInternalKey(key) {
  return /(^id$|_id$|Id$|provider|job|parse_job|payload|fallback|quality_status|answer_source)/.test(
    key,
  );
}
