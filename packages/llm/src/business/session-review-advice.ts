// @ts-nocheck
import { z } from 'zod';

import { callLlm } from '../llm/llm-client.ts';
import { findLlmTargetByIdOrAlias } from '../llm/target-ids.ts';

export const sessionReviewAdviceSchema = z
  .object({
    headline: z.string().min(4).max(80),
    summary: z.string().min(10).max(260),
    focusItems: z
      .array(
        z
          .object({
            knowledgePointName: z.string().min(1).max(60),
            priorityLabel: z.string().min(2).max(20),
            reason: z.string().min(6).max(180),
            suggestedAction: z.string().min(6).max(180),
            recommendedMaterialTypes: z.array(z.string().min(2).max(20)).max(4),
          })
          .passthrough(),
      )
      .max(3),
    nextSteps: z.array(z.string().min(4).max(120)).min(1).max(3),
    encouragement: z.string().min(4).max(80),
    warnings: z.array(z.string().max(120)).default([]),
    qualityFlags: z.array(z.string().max(60)).default([]),
  })
  .passthrough();

export async function generateSessionReviewAdvice({
  input,
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
} = {}) {
  const resolvedLlmConfig = resolveLlmConfig({ llmConfig, targetConfig });
  const resolvedLlmTarget = resolveLlmTarget({
    llmConfig: resolvedLlmConfig,
    llmTarget: llmTarget ?? target,
    llmTargetId: llmTargetId ?? targetId,
  });
  const prompt = buildSessionReviewAdvicePrompt(input);
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
    requestLabel: 'generateSessionReviewAdvice',
  });

  const llm = llmInfo({ result: llmResult, target: resolvedLlmTarget });
  const parsed = parseSessionReviewAdviceText(llmResult.text);
  if (!parsed.ok) {
    return {
      kind: 'session_review_advice',
      status: 'failed',
      advice: null,
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

  return {
    kind: 'session_review_advice',
    status: llmResult.ok === false ? 'partial' : 'ok',
    advice: parsed.advice,
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

export function buildSessionReviewAdvicePrompt(input = {}) {
  const compactInput = sanitizeForPrompt(input);
  return [
    '你是一名面向高中学生的一轮复习老师。请根据学生本次练习表现，生成简短、具体、可执行的复盘建议。',
    '',
    '硬性要求：',
    '- 只返回 JSON，不要用 Markdown，不要用 ``` 包裹。',
    '- 不要展示内部字段名、数据库 ID、provider、job、source_document_id、fallback、quality flag 等工程信息。',
    '- 不要编造未提供的学习历史、老师评价、题目来源或学生长期表现。',
    '- 对答错或还需巩固的知识点优先给具体行动建议。',
    '- 对答对的知识点只给轻量复习建议，不要制造焦虑。',
    '- 输出要适合结果页首屏展示，短句优先，避免长篇讲解。',
    '- recommendedMaterialTypes 使用学生能理解的中文名称，例如“易错提醒”“解题方法”“题型总结”“解析总结”。',
    '',
    '返回 JSON schema：',
    '{',
    '  "headline": "一句学生可理解的复盘标题",',
    '  "summary": "2-3 句总结本次表现和主要问题",',
    '  "focusItems": [',
    '    {',
    '      "knowledgePointName": "知识点名称",',
    '      "priorityLabel": "优先巩固 | 顺手复习 | 保持手感",',
    '      "reason": "为什么关注这个点，只基于输入事实",',
    '      "suggestedAction": "下一步怎么做，具体可执行",',
    '      "recommendedMaterialTypes": ["易错提醒", "解题方法"]',
    '    }',
    '  ],',
    '  "nextSteps": ["最多 3 条复盘步骤"],',
    '  "encouragement": "一句正向收束语",',
    '  "warnings": ["可选：输入不足、材料不足等诊断，不给学生端默认展示"],',
    '  "qualityFlags": ["可选：low_material_coverage | insufficient_history | partial_attempts"]',
    '}',
    '',
    '输入数据：',
    JSON.stringify(compactInput, null, 2),
  ].join('\n');
}

export function parseSessionReviewAdviceText(text) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return {
      ok: false,
      advice: null,
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
      advice: null,
      parse_error: error.message,
      validation_error: null,
    };
  }

  const validation = sessionReviewAdviceSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      ok: false,
      advice: null,
      parse_error: null,
      validation_error: validation.error.issues,
    };
  }

  return {
    ok: true,
    advice: validation.data,
    parse_error: null,
    validation_error: null,
  };
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

function sanitizeForPrompt(value) {
  if (Array.isArray(value)) return value.map(sanitizeForPrompt);
  if (!value || typeof value !== 'object') return value;

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (isInternalKey(key)) continue;
    output[toStudentSafeKey(key)] = sanitizeForPrompt(item);
  }
  return output;
}

function isInternalKey(key) {
  return /(^id$|_id$|Id$|provider|job|source_document_id|parse_job|payload|fallback)/.test(key);
}

function toStudentSafeKey(key) {
  return key;
}
