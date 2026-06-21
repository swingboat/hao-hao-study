// @ts-nocheck
import { findLlmTargetByIdOrAlias } from '../llm/target-ids.ts';
import { parsePdfKnowledgePoints } from './knowledge-parser.ts';
import {
  buildMixedLearningMaterialFinalPrompt,
  buildMixedLearningMaterialKnowledgeContext,
  buildMixedLearningMaterialPagePrompt,
  learningResourceAnalysisBatchSchema,
  parseImageMixedLearningMaterial,
  parsePdfMixedLearningMaterial,
  parseWordMixedLearningMaterial,
} from './mixed-learning-material-parser.ts';
import {
  buildQuestionFinalPrompt,
  buildQuestionPagePrompt,
  parsePdfQuestions,
  parseWordQuestions,
} from './question-parser.ts';

export async function analyzeKnowledgePoints({
  file,
  pdf,
  llmConfig,
  llmTarget,
  llmTargetId,
  targetConfig = {},
  target,
  targetId,
  parsePdfKnowledgePointsImpl = parsePdfKnowledgePoints,
  ...parserOptions
} = {}) {
  const resolvedLlmConfig = resolveLlmConfig({ llmConfig, targetConfig });
  const resolvedLlmTarget = resolveLlmTarget({
    llmConfig: resolvedLlmConfig,
    llmTarget: llmTarget ?? target,
    llmTargetId: llmTargetId ?? targetId,
  });
  const sourceFile = normalizeAnalysisFile({
    file,
    pdf,
    defaultType: 'pdf',
    allowedTypes: ['pdf'],
  });
  const parserResult = await parsePdfKnowledgePointsImpl(
    omitUndefined({
      ...parserOptions,
      llmConfig: resolvedLlmConfig,
      llmTarget: resolvedLlmTarget,
      targetConfig: resolvedLlmConfig,
      target: resolvedLlmTarget,
      pdf: fileToParserDocument(sourceFile),
    }),
  );

  return buildKnowledgeAnalysisResult({
    result: parserResult,
    file: sourceFile,
    target: resolvedLlmTarget,
  });
}

export async function analyzeQuestions({
  file,
  pdf,
  word,
  knowledge,
  llmConfig,
  llmTarget,
  llmTargetId,
  targetConfig = {},
  target,
  targetId,
  pagePrompt,
  finalPrompt,
  parsePdfQuestionsImpl = parsePdfQuestions,
  parseWordQuestionsImpl = parseWordQuestions,
  maxKnowledgeContextItems = 180,
  ...parserOptions
} = {}) {
  const resolvedLlmConfig = resolveLlmConfig({ llmConfig, targetConfig });
  const resolvedLlmTarget = resolveLlmTarget({
    llmConfig: resolvedLlmConfig,
    llmTarget: llmTarget ?? target,
    llmTargetId: llmTargetId ?? targetId,
  });
  const sourceFile = normalizeAnalysisFile({
    file,
    pdf,
    word,
    defaultType: pdf ? 'pdf' : word ? 'word' : 'pdf',
    allowedTypes: ['pdf', 'word'],
  });
  const knowledgeSource = normalizeKnowledgeSource(knowledge);
  const knowledgeContext = buildQuestionKnowledgeContext({
    points: knowledgeSource.points,
    maxItems: maxKnowledgeContextItems,
  });
  const resolvedPagePrompt = (args) =>
    appendKnowledgeContext(
      resolvePrompt(pagePrompt ?? ((input) => buildQuestionPagePrompt(input)), args),
      knowledgeContext,
    );
  const resolvedFinalPrompt = (args) =>
    appendKnowledgeContext(
      resolvePrompt(finalPrompt ?? ((input) => buildQuestionFinalPrompt(input)), args),
      knowledgeContext,
    );
  const request = omitUndefined({
    ...parserOptions,
    llmConfig: resolvedLlmConfig,
    llmTarget: resolvedLlmTarget,
    targetConfig: resolvedLlmConfig,
    target: resolvedLlmTarget,
    [sourceFile.type]: fileToParserDocument(sourceFile),
    pagePrompt: resolvedPagePrompt,
    finalPrompt: resolvedFinalPrompt,
  });
  const parserResult =
    sourceFile.type === 'word'
      ? await parseWordQuestionsImpl(request)
      : await parsePdfQuestionsImpl(request);

  return buildQuestionAnalysisResult({
    result: parserResult,
    file: sourceFile,
    target: resolvedLlmTarget,
    knowledgeSource,
  });
}

export async function analyzeLearningResource(options = {}) {
  const mixedResult = await analyzeMixedLearningMaterial(options);
  const knowledgeSource = normalizeKnowledgeSource(options.knowledge);
  return buildLearningResourceAnalysisResult({
    result: mixedResult,
    knowledgeSource,
    payloadLogPath: options.payloadLogPath,
  });
}

export async function analyzeMixedLearningMaterial({
  file,
  pdf,
  word,
  image,
  subjectName = '',
  knowledge,
  llmConfig,
  llmTarget,
  llmTargetId,
  targetConfig = {},
  target,
  targetId,
  pagePrompt,
  finalPrompt,
  parsePdfMixedLearningMaterialImpl = parsePdfMixedLearningMaterial,
  parseWordMixedLearningMaterialImpl = parseWordMixedLearningMaterial,
  parseImageMixedLearningMaterialImpl = parseImageMixedLearningMaterial,
  maxKnowledgeContextItems = 180,
  ...parserOptions
} = {}) {
  const resolvedLlmConfig = resolveLlmConfig({ llmConfig, targetConfig });
  const resolvedLlmTarget = resolveLlmTarget({
    llmConfig: resolvedLlmConfig,
    llmTarget: llmTarget ?? target,
    llmTargetId: llmTargetId ?? targetId,
  });
  const sourceFile = normalizeAnalysisFile({
    file,
    pdf,
    word,
    image,
    defaultType: pdf ? 'pdf' : word ? 'word' : image ? 'image' : 'pdf',
    allowedTypes: ['pdf', 'word', 'image'],
  });
  const knowledgeSource = normalizeKnowledgeSource(knowledge);
  const knowledgeContext = buildMixedLearningMaterialKnowledgeContext({
    points: knowledgeSource.points,
    maxItems: maxKnowledgeContextItems,
  });
  const resolvedPagePrompt = (args) =>
    appendKnowledgeContext(
      resolvePrompt(
        pagePrompt ??
          ((input) =>
            buildMixedLearningMaterialPagePrompt({
              ...input,
              subjectName,
            })),
        args,
      ),
      knowledgeContext,
    );
  const resolvedFinalPrompt = (args) =>
    appendKnowledgeContext(
      resolvePrompt(
        finalPrompt ??
          ((input) =>
            buildMixedLearningMaterialFinalPrompt({
              ...input,
              subjectName,
            })),
        args,
      ),
      knowledgeContext,
    );
  const request = omitUndefined({
    ...parserOptions,
    llmConfig: resolvedLlmConfig,
    llmTarget: resolvedLlmTarget,
    targetConfig: resolvedLlmConfig,
    target: resolvedLlmTarget,
    subjectName,
    [sourceFile.type]: fileToParserDocument(sourceFile),
    pagePrompt: resolvedPagePrompt,
    finalPrompt: resolvedFinalPrompt,
  });
  const parserResult =
    sourceFile.type === 'word'
      ? await parseWordMixedLearningMaterialImpl(request)
      : sourceFile.type === 'image'
        ? await parseImageMixedLearningMaterialImpl(request)
        : await parsePdfMixedLearningMaterialImpl(request);

  return buildMixedLearningMaterialAnalysisResult({
    result: parserResult,
    file: sourceFile,
    target: resolvedLlmTarget,
    knowledgeSource,
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

function normalizeAnalysisFile({ file, pdf, word, image, defaultType, allowedTypes }) {
  const input =
    file ??
    (pdf ? { ...pdf, type: 'pdf' } : null) ??
    (word ? { ...word, type: 'word' } : null) ??
    (image ? { ...image, type: 'image' } : null);
  if (!input || typeof input !== 'object') throw new Error('file is required');
  const type = normalizeFileType(
    input.type ??
      input.mimeType ??
      input.mime_type ??
      input.name ??
      input.filename ??
      input.path ??
      defaultType,
  );
  if (!allowedTypes.includes(type)) {
    throw new Error(`Unsupported file type: ${type}`);
  }
  const name = input.name ?? input.filename ?? defaultFileName(type);
  const data = input.data == null ? undefined : stripDataUrl(input.data);
  const normalized = omitUndefined({
    type,
    name: String(name),
    data,
    path: input.path,
    mimeType: input.mimeType ?? input.mime_type,
  });
  if (!normalized.data && !normalized.path) throw new Error('file.data or file.path is required');
  return normalized;
}

function normalizeFileType(value) {
  const type = String(value ?? '').toLowerCase();
  if (type.includes('pdf')) return 'pdf';
  if (type.includes('word') || type.includes('docx') || type.includes('wordprocessingml'))
    return 'word';
  if (
    type.includes('image') ||
    ['png', 'jpg', 'jpeg', 'webp'].includes(type) ||
    /\.(png|jpe?g|webp)(?:$|[?#])/.test(type)
  ) {
    return 'image';
  }
  return type || 'pdf';
}

function defaultFileName(type) {
  if (type === 'word') return 'document.docx';
  if (type === 'image') return 'image.png';
  return 'document.pdf';
}

function fileToParserDocument(file) {
  return omitUndefined({
    name: file.name,
    data: file.data,
    path: file.path,
    mimeType: file.mimeType,
  });
}

function buildKnowledgeAnalysisResult({ result, file, target }) {
  const pages = result.pages ?? [];
  const images = normalizeImageRefs(result.images);
  const pointIds = createKnowledgePointIdAllocator();
  const chapters = normalizeBusinessChapters(result.chapters ?? [], pointIds);
  const nestedPoints = flattenKnowledgePointsFromChapters(chapters);
  const topLevelPoints =
    Array.isArray(result.knowledge_points) && result.knowledge_points.length
      ? result.knowledge_points.map((point) => normalizeBusinessKnowledgePoint(point, {}, pointIds))
      : nestedPoints;
  const knowledgePoints = mergeKnowledgePointLists([...nestedPoints, ...topLevelPoints]);
  const coverageSummary = result.coverage_summary ?? {};
  const status = analysisStatus({
    result,
    count: knowledgePoints.length,
    pages,
  });
  const llm = llmInfo({ result, target });

  return omitUndefined({
    kind: 'knowledge_points',
    status,
    source: {
      type: file.type,
      name: file.name,
      page_count: pages.length,
    },
    llm,
    images,
    chapters,
    knowledge_points: knowledgePoints,
    coverage: {
      input_candidate_count: numberOrDefault(coverageSummary.input_candidate_count, 0),
      output_knowledge_point_count: numberOrDefault(
        coverageSummary.output_knowledge_point_count,
        knowledgePoints.length,
      ),
      expected_range: coverageSummary.expected_range ?? result.target_knowledge_point_range,
      notes: normalizeStringArray(coverageSummary.coverage_notes ?? coverageSummary.notes),
    },
    diagnostics: {
      parse_error: result.parse_error ?? null,
      uncertain_notes: normalizeStringArray(result.uncertain_notes),
      page_results: pages.map(sanitizePageResult),
      payload_log_path: result.payload_log_path,
      fallback_used: result.fallback_used,
    },

    document_type: result.document_type ?? file.type,
    llm_target_id: llm.llm_target_id,
    target_id: llm.target_id,
    provider: llm.provider,
    model: llm.model,
    api_shape: llm.api_shape,
    ok: status !== 'failed',
    knowledge_point_count: knowledgePoints.length,
    coverage_summary: result.coverage_summary,
    target_knowledge_point_range: result.target_knowledge_point_range,
    uncertain_notes: normalizeStringArray(result.uncertain_notes),
    parse_error: result.parse_error,
    usage: result.usage,
    latency_ms: result.latency_ms,
    pages,
    payload_log_path: result.payload_log_path,
    fallback_used: result.fallback_used,
  });
}

function buildQuestionAnalysisResult({ result, file, target, knowledgeSource }) {
  const pages = result.pages ?? [];
  const images = normalizeImageRefs(result.images);
  const questions = (result.questions ?? []).map((question, index) =>
    normalizeBusinessQuestion(question, index),
  );
  const status = analysisStatus({
    result,
    count: questions.length,
    pages,
  });
  const llm = llmInfo({ result, target });

  return omitUndefined({
    kind: 'questions',
    status,
    source: {
      type: file.type,
      name: file.name,
      page_count: pages.length,
    },
    llm,
    knowledge_source: {
      count: knowledgeSource.points.length,
      source_type: knowledgeSource.sourceType,
    },
    images,
    questions,
    diagnostics: {
      question_count: result.question_count ?? questions.length,
      parse_error: result.parse_error ?? null,
      uncertain_notes: normalizeStringArray(result.uncertain_notes),
      page_results: pages.map(sanitizePageResult),
    },

    document_type: result.document_type ?? file.type,
    llm_target_id: llm.llm_target_id,
    target_id: llm.target_id,
    provider: llm.provider,
    model: llm.model,
    api_shape: llm.api_shape,
    ok: status !== 'failed',
    question_count: result.question_count ?? questions.length,
    parse_error: result.parse_error,
    usage: result.usage,
    latency_ms: result.latency_ms,
    pages,
  });
}

function buildMixedLearningMaterialAnalysisResult({ result, file, target, knowledgeSource }) {
  const pages = result.pages ?? [];
  const llm = llmInfo({ result, target });
  return omitUndefined({
    source_document: result.source_document,
    source_units: result.source_units ?? [],
    knowledge_points: result.knowledge_points ?? [],
    learning_materials: result.learning_materials ?? [],
    questions: result.questions ?? [],
    knowledge_source: {
      count: knowledgeSource.points.length,
      source_type: knowledgeSource.sourceType,
    },
    llm,
    diagnostics: {
      parse_error: result.parse_error ?? null,
      validation_error: result.validation_error ?? null,
      page_results: pages.map(sanitizePageResult),
      payload_log_path: result.payload_log_path,
      fallback_used: result.fallback_used,
      schema_version: result.mixed_material_schema_version,
    },

    document_type: result.document_type ?? file.type,
    llm_target_id: llm.llm_target_id,
    target_id: llm.target_id,
    provider: llm.provider,
    model: llm.model,
    api_shape: llm.api_shape,
    ok: result.ok,
    parse_error: result.parse_error,
    validation_error: result.validation_error,
    usage: result.usage,
    latency_ms: result.latency_ms,
    pages,
    images: normalizeImageRefs(result.images),
    payload_log_path: result.payload_log_path,
    raw_mixed_material: result.raw_mixed_material,
    fallback_used: result.fallback_used,
    mixed_material_schema_version: result.mixed_material_schema_version,
  });
}

const LEARNING_MATERIAL_THREAD_KEYS = {
  method_card: 'method_cards',
  common_mistake: 'common_mistakes',
  question_type_summary: 'question_type_summaries',
  exam_trend: 'exam_trends',
  textbook_deep_dive: 'textbook_deep_dives',
  solution_summary: 'solution_summaries',
  concept_explanation: 'concept_explanations',
  study_advice: 'study_advice',
};

function buildLearningResourceAnalysisResult({ result, knowledgeSource, payloadLogPath }) {
  const { knowledgeThreads, unmappedItems, filteredItemsSummary } = organizeMixedResultByKnowledge({
    result,
    knowledgeSource,
  });
  const resolvedPayloadLogPath = String(
    result.diagnostics?.payload_log_path ?? result.payload_log_path ?? payloadLogPath ?? '',
  );
  const diagnostics = {
    fallback_used: result.diagnostics?.fallback_used ?? result.fallback_used ?? null,
    parse_error: result.diagnostics?.parse_error ?? result.parse_error ?? null,
    validation_error: result.diagnostics?.validation_error ?? result.validation_error ?? null,
    payload_log_path: resolvedPayloadLogPath,
  };
  const batch = omitUndefined({
    kind: 'learning_resource',
    source_document: result.source_document,
    knowledge_threads: knowledgeThreads,
    unmapped_items: unmappedItems,
    filtered_items_summary: filteredItemsSummary,
    diagnostics,

    knowledge_source: result.knowledge_source ?? {
      count: knowledgeSource.points.length,
      source_type: knowledgeSource.sourceType,
    },
    llm: result.llm,
    document_type: 'learning_resource',
    llm_target_id: result.llm_target_id,
    target_id: result.target_id,
    provider: result.provider,
    model: result.model,
    api_shape: result.api_shape,
    ok: result.ok,
    usage: result.usage,
    latency_ms: result.latency_ms,
    pages: result.pages,
    images: result.images,
    payload_log_path: result.payload_log_path ?? resolvedPayloadLogPath,
    fallback_used: diagnostics.fallback_used,
  });
  const validation = learningResourceAnalysisBatchSchema.safeParse(batch);
  if (!validation.success && diagnostics.validation_error == null) {
    return {
      ...batch,
      diagnostics: {
        ...diagnostics,
        validation_error: validation.error.issues,
      },
    };
  }
  return batch;
}

function organizeMixedResultByKnowledge({ result, knowledgeSource }) {
  const externalKnowledgePoints = knowledgeSource.points ?? [];
  const hasExternalKnowledge = externalKnowledgePoints.length > 0;
  const candidates = hasExternalKnowledge
    ? externalKnowledgePoints.map((point, index) => knowledgeCandidateFromInput(point, index))
    : buildGeneratedKnowledgeCandidates(result);
  const threadsById = new Map();
  const unmappedItems = [];
  const filtered = createFilteredItemsCollector();

  for (const unit of result.source_units ?? []) {
    const categories = classifyNonLearningText(unit.text_snippet);
    if (categories.length) {
      filtered.add(categories);
    }
  }

  for (const material of result.learning_materials ?? []) {
    const categories = classifyNonLearningText(
      [material.title, material.content, material.student_summary].join('\n'),
    );
    if (categories.length) {
      filtered.add(categories);
      continue;
    }
    const match = matchLearningItemToKnowledge({
      item: material,
      candidates,
      hasExternalKnowledge,
      fallbackHints: material.kp_hints ?? [],
    });
    if (!match) {
      unmappedItems.push(unmappedLearningMaterial(material, 'no_matching_knowledge_point'));
      continue;
    }
    const thread = ensureKnowledgeThread(threadsById, match);
    const key = LEARNING_MATERIAL_THREAD_KEYS[material.material_type] ?? 'concept_explanations';
    thread[key].push(materialToThreadItem(material));
    addThreadSourceRef(thread, material.source_ref);
  }

  for (const question of result.questions ?? []) {
    const normalizedQuestion = normalizeLearningResourceQuestion(question);
    const categories = classifyNonLearningText(normalizedQuestion.content);
    if (categories.length) {
      filtered.add(categories);
      continue;
    }
    const match = matchLearningItemToKnowledge({
      item: normalizedQuestion,
      candidates,
      hasExternalKnowledge,
      fallbackHints: normalizedQuestion.kp_hints ?? [],
    });
    if (!match) {
      unmappedItems.push(unmappedQuestion(normalizedQuestion, 'no_matching_knowledge_point'));
      continue;
    }
    const thread = ensureKnowledgeThread(threadsById, match);
    thread.questions.push(normalizedQuestion);
    addThreadSourceRef(thread, normalizedQuestion.source_ref);
  }

  for (const thread of threadsById.values()) {
    thread.source_refs = dedupeSourceRefs(thread.source_refs);
  }

  return {
    knowledgeThreads: Array.from(threadsById.values()),
    unmappedItems,
    filteredItemsSummary: filtered.summary(),
  };
}

function buildGeneratedKnowledgeCandidates(result) {
  const byName = new Map();
  const add = (point) => {
    if (!point?.name) return;
    const key = normalizeKnowledgeText(point.name);
    if (!key || byName.has(key)) return;
    byName.set(key, knowledgeCandidateFromMixed(point, byName.size));
  };
  for (const point of result.knowledge_points ?? []) add(point);
  for (const material of result.learning_materials ?? []) {
    for (const hint of material.kp_hints ?? []) add({ name: hint, brief: '' });
  }
  for (const question of result.questions ?? []) {
    for (const hint of question.kp_hints ?? []) add({ name: hint, brief: '' });
  }
  return Array.from(byName.values());
}

function knowledgeCandidateFromInput(point, index) {
  return {
    id: String(point.id ?? `kp-input-${index + 1}`),
    name: String(point.name ?? ''),
    chapter_no:
      point.chapter_number == null && point.chapter_no == null
        ? null
        : String(point.chapter_number ?? point.chapter_no),
    brief: String(point.description ?? point.brief ?? ''),
    search_text: [
      point.name,
      point.chapter_title,
      point.section_title,
      point.description,
      ...(point.formulas ?? []),
    ]
      .filter(Boolean)
      .join('\n'),
    source: 'knowledge',
  };
}

function knowledgeCandidateFromMixed(point, index) {
  return {
    id: String(point.id ?? `kp-generated-${index + 1}`),
    name: String(point.name ?? ''),
    chapter_no: point.chapter_no == null ? null : String(point.chapter_no),
    brief: String(point.brief ?? point.description ?? ''),
    search_text: [point.name, point.chapter_no, point.brief, point.description]
      .filter(Boolean)
      .join('\n'),
    source: 'generated',
  };
}

function matchLearningItemToKnowledge({ item, candidates, hasExternalKnowledge, fallbackHints }) {
  const hints = normalizeStringArray(fallbackHints);
  const itemText = [
    item.title,
    item.content,
    item.student_summary,
    item.content,
    item.solution_text,
    item.answer,
    ...(hints ?? []),
  ]
    .filter(Boolean)
    .join('\n');

  let best = null;
  for (const candidate of candidates) {
    const score = scoreKnowledgeMatch({
      itemText,
      hints,
      candidate,
    });
    if (!best || score > best.match_confidence) {
      best = {
        ...candidate,
        match_confidence: score,
      };
    }
  }

  if (best && best.match_confidence >= 0.45) return best;
  if (!hasExternalKnowledge && hints.length) {
    const hint = hints[0];
    return {
      id: `kp-generated-hint-${stableIdPart(hint)}`,
      name: hint,
      chapter_no: null,
      brief: '',
      search_text: hint,
      source: 'generated',
      match_confidence: 0.7,
    };
  }
  return null;
}

function scoreKnowledgeMatch({ itemText, hints, candidate }) {
  const candidateText = candidate.search_text || candidate.name || '';
  const normalizedCandidateName = normalizeKnowledgeText(candidate.name);
  const normalizedCandidateText = normalizeKnowledgeText(candidateText);
  const normalizedItemText = normalizeKnowledgeText(itemText);
  let score = 0;

  for (const hint of hints) {
    const normalizedHint = normalizeKnowledgeText(hint);
    if (!normalizedHint) continue;
    if (normalizedHint === normalizedCandidateName) score = Math.max(score, 0.98);
    if (
      normalizedCandidateText.includes(normalizedHint) ||
      normalizedHint.includes(normalizedCandidateName)
    ) {
      score = Math.max(score, 0.88);
    }
  }

  if (normalizedCandidateName && normalizedItemText.includes(normalizedCandidateName)) {
    score = Math.max(score, 0.82);
  }

  for (const rule of KNOWLEDGE_MATCH_RULES) {
    if (rule.item.test(itemText) && rule.knowledge.test(candidateText)) {
      score = Math.max(score, rule.score);
    }
  }

  const overlap = characterOverlapScore(normalizedItemText, normalizedCandidateText);
  if (overlap >= 0.55) score = Math.max(score, 0.62);
  else if (overlap >= 0.35) score = Math.max(score, 0.48);

  return Math.max(0, Math.min(1, score));
}

const KNOWLEDGE_MATCH_RULES = [
  {
    item: /互异|回代|含参|参数/,
    knowledge: /互异|元素.*重复|元素.*不同|含参|参数/,
    score: 0.86,
  },
  {
    item: /子集|真子集|包含关系|A\s*⊆|\\subset|包含于/,
    knowledge: /子集|真子集|集合间|基本关系|包含/,
    score: 0.84,
  },
  {
    item: /交集|并集|补集|集合运算|A\s*[∩∪]|\\cap|\\cup/,
    knowledge: /交集|并集|补集|集合运算|交并补|运算/,
    score: 0.84,
  },
  {
    item: /子集个数|真子集个数|2\^n|2\\\^\{?n\}?|非空子集/,
    knowledge: /子集个数|真子集|子集|集合子集/,
    score: 0.84,
  },
  {
    item: /空集|∅|分类讨论|分情况/,
    knowledge: /空集|分类讨论|集合关系/,
    score: 0.84,
  },
];

function ensureKnowledgeThread(threadsById, match) {
  if (!threadsById.has(match.id)) {
    threadsById.set(match.id, {
      knowledge_point: {
        id: match.id,
        name: match.name,
        chapter_no: match.chapter_no ?? null,
        brief: match.brief ?? '',
        match_confidence: clamp01(match.match_confidence ?? 0.7),
      },
      concept_explanations: [],
      method_cards: [],
      common_mistakes: [],
      question_type_summaries: [],
      exam_trends: [],
      textbook_deep_dives: [],
      solution_summaries: [],
      study_advice: [],
      questions: [],
      source_refs: [],
    });
  }
  const thread = threadsById.get(match.id);
  thread.knowledge_point.match_confidence = Math.max(
    thread.knowledge_point.match_confidence,
    clamp01(match.match_confidence ?? 0.7),
  );
  return thread;
}

function materialToThreadItem(material) {
  return omitUndefined({
    title: String(material.title ?? ''),
    content: String(material.content ?? ''),
    student_summary: material.student_summary,
    content_origin:
      material.content_origin === 'model_summary' ? 'model_summary' : 'source_extract',
    kp_hints: normalizeStringArray(material.kp_hints),
    source_ref: material.source_ref,
    confidence: clamp01(numberOrDefault(material.confidence, 0.7)),
  });
}

function normalizeLearningResourceQuestion(question) {
  const answer = question.answer == null ? '' : String(question.answer);
  const solutionText = question.solution_text == null ? '' : String(question.solution_text);
  let qualityStatus = question.quality_status ?? 'publishable';
  if (!answer.trim()) qualityStatus = 'missing_answer';
  else if (!solutionText.trim() && qualityStatus === 'publishable')
    qualityStatus = 'missing_solution';
  return {
    ...question,
    content: String(question.content ?? ''),
    question_type: question.question_type ?? 'unknown',
    options: Array.isArray(question.options) ? question.options : [],
    answer,
    solution_text: solutionText,
    difficulty: numberOrDefault(question.difficulty, 0),
    kp_hints: normalizeStringArray(question.kp_hints),
    quality_status: qualityStatus,
    source_ref: question.source_ref,
  };
}

function unmappedLearningMaterial(material, reason) {
  return {
    item_type: 'learning_material',
    reason,
    title: String(material.title ?? ''),
    content: String(material.content ?? material.student_summary ?? ''),
    source_ref: material.source_ref,
    suggested_kp_hints: normalizeStringArray(material.kp_hints),
  };
}

function unmappedQuestion(question, reason) {
  return {
    item_type: 'question',
    reason,
    title: String(question.source_ref?.question_no ?? '未匹配试题'),
    content: String(question.content ?? ''),
    source_ref: question.source_ref,
    suggested_kp_hints: normalizeStringArray(question.kp_hints),
  };
}

function addThreadSourceRef(thread, sourceRef) {
  if (!sourceRef?.page) return;
  thread.source_refs.push(sourceRef);
}

function dedupeSourceRefs(sourceRefs) {
  const byKey = new Map();
  for (const ref of sourceRefs ?? []) {
    if (!ref?.page) continue;
    const key = [ref.page, ref.slide_no ?? '', ref.question_no ?? '', ref.text_snippet ?? ''].join(
      '|',
    );
    if (!byKey.has(key)) byKey.set(key, ref);
  }
  return Array.from(byKey.values());
}

function createFilteredItemsCollector() {
  let count = 0;
  const categories = new Set();
  return {
    add(values) {
      const normalized = Array.isArray(values) ? values.filter(Boolean) : [];
      if (!normalized.length) return;
      count += 1;
      for (const value of normalized) categories.add(value);
    },
    summary() {
      return {
        count,
        categories: Array.from(categories),
      };
    },
  };
}

function classifyNonLearningText(value) {
  const text = String(value ?? '');
  const categories = new Set();
  if (/扫码|二维码|QR\s*code|关注.*资料|加群|客服|课程顾问/i.test(text)) categories.add('qr_code');
  if (/优惠|报名|续班|领取|课程顾问|招生|广告|低至|限时/i.test(text))
    categories.add('advertisement');
  if (/老师介绍|教师介绍|主讲老师|授课老师|名师|教龄/.test(text)) categories.add('teacher_intro');
  if (/版权|©|Copyright|禁止翻印|内部资料/.test(text)) categories.add('copyright');
  if (/页脚|页码|第\s*\d+\s*页\s*\/\s*\d+/.test(text)) categories.add('page_footer');
  if (/目录|导航|上一页|下一页|返回首页/.test(text)) categories.add('duplicate_navigation');
  if (
    /班主任|公众号|小程序|讲座|福利/.test(text) &&
    !/集合|函数|数学|物理|化学|语文|英语/.test(text)
  ) {
    categories.add('non_subject_content');
  }
  return Array.from(categories);
}

function normalizeKnowledgeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。、“”‘’；：:,.()[\]{}<>《》【】|_—-]/g, '');
}

function characterOverlapScore(left, right) {
  if (!left || !right) return 0;
  const rightChars = new Set([...right]);
  const leftChars = [...new Set([...left])];
  if (!leftChars.length) return 0;
  const overlap = leftChars.filter((char) => rightChars.has(char)).length;
  return overlap / Math.max(1, Math.min(leftChars.length, rightChars.size));
}

function stableIdPart(value) {
  const normalized = normalizeKnowledgeText(value);
  let hash = 0;
  for (const char of normalized) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash).toString(36) || 'unknown';
}

function normalizeBusinessChapters(chapters, pointIds) {
  return chapters
    .filter((chapter) => chapter && typeof chapter === 'object')
    .map((chapter, chapterIndex) => {
      const chapterNumber = chapter.number == null ? '' : String(chapter.number);
      const chapterTitle = chapter.display_name ?? chapter.title ?? '';
      const chapterId = chapter.id == null ? `ch-${chapterIndex + 1}` : String(chapter.id);
      return omitUndefined({
        ...chapter,
        id: chapterId,
        number: chapterNumber,
        title: chapter.title == null ? '' : String(chapter.title),
        display_name:
          chapter.display_name == null
            ? [chapterNumber, chapter.title].filter(Boolean).join(' ')
            : String(chapter.display_name),
        source_pages: normalizePageArray(chapter.source_pages),
        sections: normalizeBusinessSections(chapter.sections ?? [], {
          chapterIndex,
          chapterNumber,
          chapterTitle,
          pointIds,
        }),
        knowledge_points: (chapter.knowledge_points ?? []).map((point) =>
          normalizeBusinessKnowledgePoint(
            point,
            {
              chapter_number: chapterNumber,
              chapter_title: chapterTitle,
            },
            pointIds,
          ),
        ),
      });
    });
}

function normalizeBusinessSections(
  sections,
  { chapterIndex, chapterNumber, chapterTitle, pointIds },
) {
  return sections
    .filter((section) => section && typeof section === 'object')
    .map((section, sectionIndex) => {
      const sectionNumber = section.number == null ? '' : String(section.number);
      const sectionTitle = section.display_name ?? section.title ?? '';
      return omitUndefined({
        ...section,
        id: section.id == null ? `sec-${chapterIndex + 1}-${sectionIndex + 1}` : String(section.id),
        number: sectionNumber,
        title: section.title == null ? '' : String(section.title),
        display_name:
          section.display_name == null
            ? [sectionNumber, section.title].filter(Boolean).join(' ')
            : String(section.display_name),
        source_pages: normalizePageArray(section.source_pages),
        knowledge_points: (section.knowledge_points ?? []).map((point) =>
          normalizeBusinessKnowledgePoint(
            point,
            {
              chapter_number: chapterNumber,
              chapter_title: chapterTitle,
              section_number: sectionNumber,
              section_title: sectionTitle,
            },
            pointIds,
          ),
        ),
      });
    });
}

function normalizeBusinessKnowledgePoint(point, context, pointIds) {
  const chapterTitle = point.chapter_title ?? context.chapter_title;
  const sectionTitle = point.section_title ?? context.section_title;
  const normalized = omitUndefined({
    ...point,
    name: point.name == null ? '' : String(point.name),
    description: point.description == null ? undefined : String(point.description),
    formulas: normalizeStringArray(point.formulas),
    examples: normalizeStringArray(point.examples),
    prerequisites: normalizeStringArray(point.prerequisites),
    difficulty: point.difficulty == null ? undefined : String(point.difficulty),
    source_pages: normalizePageArray(point.source_pages),
    chapter_number: point.chapter_number ?? context.chapter_number,
    chapter_title: chapterTitle,
    section_number: point.section_number ?? context.section_number,
    section_title: sectionTitle,
  });
  return {
    id: pointIds.idFor(normalized),
    ...normalized,
  };
}

function createKnowledgePointIdAllocator() {
  let nextId = 1;
  const byKey = new Map();
  return {
    idFor(point) {
      if (point.id) {
        const id = String(point.id);
        byKey.set(knowledgePointKey(point), id);
        return id;
      }
      const key = knowledgePointKey(point);
      if (!byKey.has(key)) byKey.set(key, `kp-${nextId++}`);
      return byKey.get(key);
    },
  };
}

function knowledgePointKey(point) {
  return [
    point.name ?? '',
    point.chapter_title ?? '',
    point.section_title ?? '',
    normalizePageArray(point.source_pages).join(','),
  ].join('|');
}

function flattenKnowledgePointsFromChapters(chapters) {
  return chapters.flatMap((chapter) => [
    ...(chapter.sections ?? []).flatMap((section) => section.knowledge_points ?? []),
    ...(chapter.knowledge_points ?? []),
  ]);
}

function mergeKnowledgePointLists(points) {
  const byKey = new Map();
  for (const point of points) {
    if (!point) continue;
    const key = knowledgePointMergeIdentity(point);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, point);
  }
  return Array.from(byKey.values());
}

function knowledgePointMergeIdentity(point) {
  return [
    point.id ?? '',
    point.name ?? '',
    point.chapter_title ?? point.chapter ?? '',
    point.section_title ?? point.section ?? '',
  ].join('|');
}

function normalizeBusinessQuestion(question, index) {
  return {
    id: question.id == null ? `q-${index + 1}` : String(question.id),
    ...question,
    related_knowledge_points: normalizeRelatedKnowledgePoints(question.related_knowledge_points),
  };
}

function normalizeKnowledgeSource(knowledge) {
  if (!knowledge) return { sourceType: 'generated', points: [] };
  if (Array.isArray(knowledge)) {
    if (knowledge.some(isKnowledgeAnalysisSource)) {
      return {
        sourceType: 'knowledge_collection',
        points: mergeKnowledgePointLists(
          knowledge.flatMap((source, index) => {
            if (isKnowledgeAnalysisSource(source)) {
              return normalizeKnowledgeSourceObject(source, {
                sourceIndex: index,
                prefixIds: true,
              });
            }
            const point = normalizeKnowledgeInputPoint(source, index, {
              idPrefix: `ks${index + 1}-`,
            });
            return point ? [point] : [];
          }),
        ),
      };
    }
    return {
      sourceType: 'knowledge_list',
      points: knowledge
        .map((point, index) => normalizeKnowledgeInputPoint(point, index))
        .filter(Boolean),
    };
  }

  if (knowledge && typeof knowledge === 'object') {
    return {
      sourceType: 'knowledge_analysis_result',
      points: normalizeKnowledgeSourceObject(knowledge),
    };
  }

  return { sourceType: 'generated', points: [] };
}

function isKnowledgeAnalysisSource(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value.kind === 'knowledge_points' ||
        Array.isArray(value.knowledge_points) ||
        Array.isArray(value.chapters)),
  );
}

function normalizeKnowledgeSourceObject(knowledge, { sourceIndex = 0, prefixIds = false } = {}) {
  const sourceName = knowledgeSourceName(knowledge);
  const context = omitUndefined({
    idPrefix: prefixIds ? `ks${sourceIndex + 1}-` : undefined,
    source_name: sourceName,
  });
  const fromTopLevel = Array.isArray(knowledge.knowledge_points)
    ? knowledge.knowledge_points
        .map((point, index) => normalizeKnowledgeInputPoint(point, index, context))
        .filter(Boolean)
    : [];
  const fromChapters = Array.isArray(knowledge.chapters)
    ? flattenInputKnowledgeFromChapters(knowledge.chapters, context)
    : [];
  return mergeKnowledgePointLists([...fromTopLevel, ...fromChapters]);
}

function knowledgeSourceName(knowledge) {
  const source = knowledge?.source;
  return (
    source?.name ??
    knowledge?.source_name ??
    knowledge?.sourceName ??
    knowledge?.textbook_name ??
    knowledge?.textbookName ??
    ''
  );
}

function flattenInputKnowledgeFromChapters(chapters, context = {}) {
  const points = [];
  for (const chapter of chapters) {
    const chapterTitle =
      chapter.display_name ?? [chapter.number, chapter.title].filter(Boolean).join(' ');
    for (const section of chapter.sections ?? []) {
      const sectionTitle =
        section.display_name ?? [section.number, section.title].filter(Boolean).join(' ');
      for (const point of section.knowledge_points ?? []) {
        points.push(
          normalizeKnowledgeInputPoint(point, points.length, {
            ...context,
            chapter_title: chapterTitle,
            section_title: sectionTitle,
          }),
        );
      }
    }
    for (const point of chapter.knowledge_points ?? []) {
      points.push(
        normalizeKnowledgeInputPoint(point, points.length, {
          ...context,
          chapter_title: chapterTitle,
        }),
      );
    }
  }
  return points.filter(Boolean);
}

function normalizeKnowledgeInputPoint(point, index, context = {}) {
  if (!point) return null;
  if (typeof point === 'string') {
    const name = point.trim();
    return name ? { id: `kp-input-${index + 1}`, name } : null;
  }
  if (typeof point !== 'object') return null;
  const name = point.name == null ? '' : String(point.name).trim();
  if (!name) return null;
  const rawId = point.id == null ? `kp-input-${index + 1}` : String(point.id);
  return omitUndefined({
    id: context.idPrefix ? `${context.idPrefix}${rawId}` : rawId,
    name,
    chapter_title:
      point.chapter_title ?? point.chapterTitle ?? point.chapter ?? context.chapter_title,
    section_title:
      point.section_title ?? point.sectionTitle ?? point.section ?? context.section_title,
    description: point.description == null ? undefined : String(point.description),
    formulas: normalizeStringArray(point.formulas),
    source_pages: normalizePageArray(point.source_pages),
    source_name: point.source_name ?? point.sourceName ?? context.source_name,
  });
}

function buildQuestionKnowledgeContext({ points, maxItems }) {
  if (!points.length) {
    return [
      '关联知识点要求：',
      '没有提供外部知识点库。解析每道试题时，请根据题干、选项、答案和解析判断本题涉及的知识点。',
      '每道题都应尽量输出 related_knowledge_points，格式为：',
      '[{"name":"知识点名称","chapter":"章名称","section":"节名称","confidence":0.0到1.0,"reason":"关联理由"}]',
      '请根据每道题内容生成简洁、可复用的知识点名称；如果确实无法判断，related_knowledge_points 输出空数组。',
    ].join('\n');
  }
  const renderedPoints = points
    .slice(0, maxItems)
    .map((point, index) =>
      [
        `${index + 1}. id=${point.id}`,
        `name=${point.name}`,
        point.chapter_title ? `chapter=${point.chapter_title}` : '',
        point.section_title ? `section=${point.section_title}` : '',
        point.source_name ? `source=${point.source_name}` : '',
        point.description ? `description=${point.description}` : '',
        point.formulas?.length ? `formulas=${point.formulas.join('；')}` : '',
      ]
        .filter(Boolean)
        .join('; '),
    );

  return [
    '关联知识点要求：',
    '下面是可用于匹配试题的知识点库。解析每道试题时，请根据题干、选项、答案和解析判断关联知识点。',
    '每道题都应尽量输出 related_knowledge_points，格式为：',
    '[{"id":"知识点 id","name":"知识点名称","chapter":"章名称","section":"节名称","confidence":0.0到1.0,"reason":"关联理由"}]',
    '只能引用下方知识点库里的 id；如果确实无法判断，related_knowledge_points 输出空数组。',
    '',
    renderedPoints.join('\n'),
  ].join('\n');
}

function appendKnowledgeContext(prompt, knowledgeContext) {
  if (!knowledgeContext) return prompt;
  return [prompt, '', knowledgeContext].join('\n');
}

function resolvePrompt(prompt, args) {
  return typeof prompt === 'function' ? prompt(args) : String(prompt ?? '');
}

function normalizeRelatedKnowledgePoints(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      if (typeof point === 'string') {
        const name = point.trim();
        return name ? { name } : null;
      }
      if (!point || typeof point !== 'object') return null;
      const normalized = omitUndefined({
        id: point.id == null ? undefined : String(point.id),
        name: point.name == null ? undefined : String(point.name),
        chapter:
          point.chapter == null && point.chapter_title == null && point.chapterTitle == null
            ? undefined
            : String(point.chapter ?? point.chapter_title ?? point.chapterTitle),
        section:
          point.section == null && point.section_title == null && point.sectionTitle == null
            ? undefined
            : String(point.section ?? point.section_title ?? point.sectionTitle),
        confidence: numberOrUndefined(point.confidence),
        reason: point.reason == null ? undefined : String(point.reason),
      });
      return Object.keys(normalized).length > 0 ? normalized : null;
    })
    .filter(Boolean);
}

function analysisStatus({ result, count, pages }) {
  const hasFailedPages = pages.some((page) => page.ok === false);
  if (result.ok === false && count === 0) return 'failed';
  if (result.parse_error && count === 0) return 'failed';
  if (result.ok === false || result.parse_error || hasFailedPages) return 'partial';
  return 'ok';
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

function sanitizePageResult(page) {
  return omitUndefined({
    page_number: page.page_number,
    ok: page.ok,
    text: page.text,
    usage: page.usage,
    latency_ms: page.latency_ms,
    http_status: page.http_status,
    error_message: page.error_message,
  });
}

function normalizeImageRefs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((image) => {
      if (!image || typeof image !== 'object') return null;
      const normalized = omitUndefined({
        kind: image.kind == null ? 'page_image' : String(image.kind),
        reference_type:
          image.reference_type == null && image.referenceType == null
            ? 'file_path'
            : String(image.reference_type ?? image.referenceType),
        page_number: numberOrUndefined(image.page_number ?? image.pageNumber),
        mime_type:
          image.mime_type == null && image.mimeType == null
            ? undefined
            : String(image.mime_type ?? image.mimeType),
        path: image.path == null ? undefined : String(image.path),
      });
      return normalized.path ? normalized : null;
    })
    .filter(Boolean);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function normalizePageArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function numberOrDefault(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function clamp01(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function numberOrUndefined(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripDataUrl(data) {
  const value = String(data);
  const marker = ';base64,';
  const markerIndex = value.indexOf(marker);
  return markerIndex >= 0 ? value.slice(markerIndex + marker.length) : value;
}

function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined));
}
