// @ts-nocheck
import { z } from 'zod';

import {
  parseDocumentPages,
  parseImage,
  parsePdfPages,
  parseWordPages,
} from '../documents/document-parser.ts';

export const MIXED_LEARNING_MATERIAL_TYPES = [
  'method_card',
  'common_mistake',
  'question_type_summary',
  'exam_trend',
  'textbook_deep_dive',
  'solution_summary',
  'concept_explanation',
  'study_advice',
] as const;

export const MIXED_SOURCE_TYPES = [
  'lesson_handout',
  'workbook',
  'question_pack',
  'exam_paper',
  'answer_book',
  'textbook',
  'mixed_material',
] as const;

export const MIXED_UNIT_KINDS = [
  'page',
  'slide',
  'question_region',
  'explanation_region',
  'text_block',
] as const;

export const MIXED_QUESTION_TYPES = [
  'choice',
  'fill_in',
  'short_answer',
  'solution',
  'proof',
  'unknown',
] as const;

export const MIXED_QUALITY_STATUSES = [
  'publishable',
  'missing_answer',
  'missing_solution',
  'incomplete_stem',
  'needs_human_review',
] as const;

export const sourceRefSchema = z
  .object({
    page: z.number().int().min(1),
    slide_no: z.number().int().min(1).optional(),
    question_no: z.string().optional(),
    text_snippet: z.string().optional(),
  })
  .passthrough();

export const mixedLearningMaterialBatchSchema = z
  .object({
    source_document: z
      .object({
        source_type: z.enum(MIXED_SOURCE_TYPES),
        title: z.string(),
        subject_name: z.string(),
        stage: z.enum(['primary', 'junior', 'senior']),
        grade: z.string(),
        provider: z.string(),
        publisher: z.string(),
        year: z.number().int().nullable(),
        season: z.string(),
        exam_name: z.string(),
        paper_name: z.string(),
        region: z.string(),
        lesson_no: z.string(),
        page_count: z.number().int().min(0),
      })
      .passthrough(),
    source_units: z.array(
      z
        .object({
          unit_kind: z.enum(MIXED_UNIT_KINDS),
          page_no: z.number().int().min(1),
          slide_no: z.number().int().min(1).optional(),
          question_no: z.string().optional(),
          bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
          text_snippet: z.string(),
        })
        .passthrough(),
    ),
    knowledge_points: z.array(
      z
        .object({
          name: z.string(),
          chapter_no: z.string().nullable(),
          brief: z.string(),
        })
        .passthrough(),
    ),
    learning_materials: z.array(
      z
        .object({
          material_type: z.enum(MIXED_LEARNING_MATERIAL_TYPES),
          title: z.string(),
          content: z.string(),
          student_summary: z.string(),
          content_origin: z.enum(['source_extract', 'model_summary']),
          kp_hints: z.array(z.string()),
          source_ref: sourceRefSchema,
          confidence: z.number().min(0).max(1),
        })
        .passthrough(),
    ),
    questions: z.array(
      z
        .object({
          content: z.string(),
          question_type: z.enum(MIXED_QUESTION_TYPES),
          options: z.array(
            z
              .object({
                label: z.string(),
                text: z.string(),
              })
              .passthrough(),
          ),
          answer: z.string(),
          solution_text: z.string(),
          difficulty: z.number(),
          kp_hints: z.array(z.string()),
          quality_status: z.enum(MIXED_QUALITY_STATUSES),
          source_ref: sourceRefSchema,
        })
        .passthrough(),
    ),
  })
  .passthrough();

const learningResourceThreadItemSchema = z
  .object({
    title: z.string(),
    content: z.string(),
    content_origin: z.enum(['source_extract', 'model_summary']),
    source_ref: sourceRefSchema,
    confidence: z.number().min(0).max(1),
  })
  .passthrough();

const learningResourceQuestionSchema = z
  .object({
    content: z.string(),
    question_type: z.enum(MIXED_QUESTION_TYPES),
    options: z.array(
      z
        .object({
          label: z.string(),
          text: z.string(),
        })
        .passthrough(),
    ),
    answer: z.string(),
    solution_text: z.string(),
    difficulty: z.number(),
    kp_hints: z.array(z.string()).optional(),
    quality_status: z.enum(MIXED_QUALITY_STATUSES),
    source_ref: sourceRefSchema,
  })
  .passthrough();

export const learningResourceAnalysisBatchSchema = z
  .object({
    source_document: mixedLearningMaterialBatchSchema.shape.source_document,
    knowledge_threads: z.array(
      z
        .object({
          knowledge_point: z
            .object({
              id: z.string(),
              name: z.string(),
              chapter_no: z.string().nullable(),
              brief: z.string(),
              match_confidence: z.number().min(0).max(1),
            })
            .passthrough(),
          concept_explanations: z.array(learningResourceThreadItemSchema),
          method_cards: z.array(learningResourceThreadItemSchema),
          common_mistakes: z.array(learningResourceThreadItemSchema),
          question_type_summaries: z.array(learningResourceThreadItemSchema),
          exam_trends: z.array(learningResourceThreadItemSchema),
          textbook_deep_dives: z.array(learningResourceThreadItemSchema),
          solution_summaries: z.array(learningResourceThreadItemSchema),
          study_advice: z.array(learningResourceThreadItemSchema),
          questions: z.array(learningResourceQuestionSchema),
          source_refs: z.array(sourceRefSchema),
        })
        .passthrough(),
    ),
    unmapped_items: z.array(
      z
        .object({
          item_type: z.enum(['learning_material', 'question', 'knowledge_point', 'source_unit']),
          reason: z.enum([
            'no_matching_knowledge_point',
            'low_confidence',
            'ambiguous',
            'non_learning_content_filtered',
          ]),
          title: z.string(),
          content: z.string(),
          source_ref: sourceRefSchema,
          suggested_kp_hints: z.array(z.string()),
        })
        .passthrough(),
    ),
    filtered_items_summary: z
      .object({
        count: z.number().int().min(0),
        categories: z.array(
          z.enum([
            'advertisement',
            'teacher_intro',
            'qr_code',
            'page_footer',
            'copyright',
            'duplicate_navigation',
            'non_subject_content',
          ]),
        ),
      })
      .passthrough(),
    diagnostics: z
      .object({
        fallback_used: z.string().nullable(),
        parse_error: z.any().nullable(),
        validation_error: z.any().nullable(),
        payload_log_path: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

export async function parseMixedLearningMaterialPages({
  parseDocumentPagesImpl = parseDocumentPages,
  subjectName = '',
  pagePrompt,
  finalPrompt,
  fallbackTitle,
  ...options
}: Record<string, unknown> = {}) {
  const documentResult = await parseDocumentPagesImpl({
    ...options,
    documentType: 'mixed_learning_material',
    pagePrompt:
      pagePrompt ??
      (({ pageNumber, totalPages }) =>
        buildMixedLearningMaterialPagePrompt({
          pageNumber,
          totalPages,
          subjectName,
        })),
    finalPrompt:
      finalPrompt ??
      (({ pageResults }) =>
        buildMixedLearningMaterialFinalPrompt({
          pageResults,
          subjectName,
        })),
  });

  return resultFromDocumentParse({
    documentResult,
    subjectName,
    fallbackTitle,
    pageCount: documentResult.pages?.length,
  });
}

export async function parsePdfMixedLearningMaterial({
  parsePdfPagesImpl = parsePdfPages,
  subjectName = '',
  pagePrompt,
  finalPrompt,
  pdf,
  ...options
}: Record<string, unknown> = {}) {
  const documentResult = await parsePdfPagesImpl({
    ...options,
    pdf,
    documentType: 'mixed_learning_material',
    pagePrompt:
      pagePrompt ??
      (({ pageNumber, totalPages }) =>
        buildMixedLearningMaterialPagePrompt({
          pageNumber,
          totalPages,
          subjectName,
        })),
    finalPrompt:
      finalPrompt ??
      (({ pageResults }) =>
        buildMixedLearningMaterialFinalPrompt({
          pageResults,
          subjectName,
        })),
  });

  return resultFromDocumentParse({
    documentResult,
    subjectName,
    fallbackTitle: pdf?.path ?? pdf?.name ?? pdf?.filename,
    pageCount: documentResult.pages?.length,
  });
}

export async function parseWordMixedLearningMaterial({
  parseWordPagesImpl = parseWordPages,
  subjectName = '',
  pagePrompt,
  finalPrompt,
  word,
  ...options
}: Record<string, unknown> = {}) {
  const documentResult = await parseWordPagesImpl({
    ...options,
    word,
    documentType: 'mixed_learning_material',
    pagePrompt:
      pagePrompt ??
      (({ pageNumber, totalPages }) =>
        buildMixedLearningMaterialPagePrompt({
          pageNumber,
          totalPages,
          subjectName,
        })),
    finalPrompt:
      finalPrompt ??
      (({ pageResults }) =>
        buildMixedLearningMaterialFinalPrompt({
          pageResults,
          subjectName,
        })),
  });

  return resultFromDocumentParse({
    documentResult,
    subjectName,
    fallbackTitle: word?.path ?? word?.name ?? word?.filename,
    pageCount: documentResult.pages?.length,
  });
}

export async function parseImageMixedLearningMaterial({
  parseImageImpl = parseImage,
  subjectName = '',
  image,
  prompt,
  ...options
}: Record<string, unknown> = {}) {
  const documentResult = await parseImageImpl({
    ...options,
    image,
    prompt:
      prompt ??
      buildMixedLearningMaterialPagePrompt({
        pageNumber: 1,
        totalPages: 1,
        subjectName,
      }),
  });

  return resultFromDocumentParse({
    documentResult: {
      ...documentResult,
      document_type: 'mixed_learning_material',
      pages: [
        {
          page_number: 1,
          ok: documentResult.ok,
          text: documentResult.text,
          latency_ms: documentResult.latency_ms,
          usage: documentResult.usage,
          http_status: documentResult.http_status,
          error_message: documentResult.error_message,
        },
      ],
    },
    subjectName,
    fallbackTitle: image?.path ?? image?.name ?? image?.filename,
    pageCount: 1,
  });
}

export function buildMixedLearningMaterialPagePrompt({
  pageNumber,
  totalPages,
  subjectName = '',
}: Record<string, unknown> = {}) {
  return [
    `请解析这份${subjectName || '学习资料'}第 ${pageNumber}/${totalPages} 页图片。`,
    '目标不是只抽知识点或只抽试题，而是识别页面里的混合学习材料结构：知识精讲、题型方法、易错提醒、考情分析、例题、答案、手写解析、题型总结等。',
    '',
    '硬性要求：',
    `- 每条 learning_materials 和 questions 必须有 source_ref.page=${pageNumber}；如果能识别 slide_no、question_no，也要填写。`,
    '- 原文没有答案时，questions[].answer 必须是空字符串 ""，quality_status 必须是 missing_answer，不能编答案。',
    '- 原文没有解析时，questions[].solution_text 必须是空字符串 ""，不能补写推导。',
    '- 对手写解析可以整理进 solution_text，但只能整理页面可见信息，避免凭空补充原文没有的结论。',
    '- 原文直接抽取的内容 content_origin 标为 source_extract；模型基于页面内容归纳出的技巧总结标为 model_summary。',
    '- 如果本页来自完整试卷、答案册或解析册，要保留题号来源 question_no，并在 source_document 线索里说明 exam_name/paper_name/region。',
    '- 只输出 JSON，不要输出 Markdown，不要用 ``` 包裹。',
    '',
    '学习材料 material_type 只能使用：',
    '- method_card：解题方法、大招、口诀、步骤卡；',
    '- common_mistake：易错点、避坑、注意事项；',
    '- question_type_summary：题型总结、题型辨析、常见问法；',
    '- exam_trend：考情分析、频率、命题趋势；',
    '- textbook_deep_dive：教材概念深挖、定义性质扩展；',
    '- solution_summary：答案解析、手写解析、关键步骤整理；',
    '- concept_explanation：概念解释、知识精讲；',
    '- study_advice：学习建议、复习建议、审题建议。',
    '',
    '请输出 JSON：',
    '{',
    '  "source_document": {',
    '    "source_type": "lesson_handout | workbook | question_pack | exam_paper | answer_book | textbook | mixed_material",',
    '    "title": "资料标题或页面可判断的标题",',
    `    "subject_name": "${subjectName}",`,
    '    "stage": "primary | junior | senior",',
    '    "grade": "g10/g11/g12 或空字符串",',
    '    "provider": "机构或来源，例如高途；无法判断则为空字符串",',
    '    "publisher": "出版社；无法判断则为空字符串",',
    '    "year": 2024,',
    '    "season": "秋季",',
    '    "exam_name": "完整试卷类资料的考试名称；否则为空字符串",',
    '    "paper_name": "完整试卷类资料的卷名；否则为空字符串",',
    '    "region": "地区；否则为空字符串",',
    '    "lesson_no": "课程讲次；否则为空字符串",',
    `    "page_count": ${totalPages}`,
    '  },',
    '  "source_units": [',
    '    {',
    '      "unit_kind": "page | slide | question_region | explanation_region | text_block",',
    `      "page_no": ${pageNumber},`,
    '      "slide_no": 1,',
    '      "question_no": "例题2",',
    '      "bbox": [0, 0, 100, 100],',
    '      "text_snippet": "可定位的原文片段"',
    '    }',
    '  ],',
    '  "knowledge_points": [',
    '    {',
    '      "name": "集合中元素的互异性",',
    '      "chapter_no": null,',
    '      "brief": "简洁说明"',
    '    }',
    '  ],',
    '  "learning_materials": [',
    '    {',
    '      "material_type": "method_card",',
    '      "title": "含参问题回代检验",',
    '      "content": "页面可见内容或基于页面的简洁归纳",',
    '      "student_summary": "面向学生的一句话提醒",',
    '      "content_origin": "source_extract | model_summary",',
    '      "kp_hints": ["集合中元素的互异性"],',
    '      "source_ref": {',
    `        "page": ${pageNumber},`,
    '        "slide_no": 1,',
    '        "question_no": "例题2",',
    '        "text_snippet": "可定位原文"',
    '      },',
    '      "confidence": 0.9',
    '    }',
    '  ],',
    '  "questions": [',
    '    {',
    '      "content": "题干正文；没有明确作答任务不要放入 questions",',
    '      "question_type": "choice | fill_in | short_answer | solution | proof | unknown",',
    '      "options": [{ "label": "A", "text": "选项正文" }],',
    '      "answer": "原文可见答案；没有则为空字符串",',
    '      "solution_text": "原文可见解析；没有解析则为空字符串",',
    '      "difficulty": 1,',
    '      "kp_hints": ["集合的运算"],',
    '      "quality_status": "publishable | missing_answer | missing_solution | incomplete_stem | needs_human_review",',
    '      "source_ref": {',
    `        "page": ${pageNumber},`,
    '        "slide_no": 1,',
    '        "question_no": "例题2"',
    '      }',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}

export function buildMixedLearningMaterialFinalPrompt({
  pageResults,
  subjectName = '',
}: Record<string, unknown> = {}) {
  const pageText = (pageResults ?? [])
    .map((page) => [`第 ${page.page_number} 页：`, page.text].join('\n'))
    .join('\n\n---\n\n');

  return [
    `下面是一份${subjectName || '学习资料'}逐页视觉解析结果。`,
    '请合并重复项、保留来源定位，并输出整份资料的 MixedLearningMaterialBatch JSON。',
    '',
    '整合要求：',
    '- 不能只输出知识点或题目；要同时保留 knowledge_points、learning_materials、questions。',
    '- source_document.source_type 必须识别为 lesson_handout、workbook、question_pack、exam_paper、answer_book、textbook 或 mixed_material。',
    '- 如果资料是完整试卷，必须识别 source_document，例如 "2026 年高考卷 1 数学"，写入 exam_name/paper_name/region，并保留每道题的题号来源 question_no。',
    '- 对讲义/PPT/辅导资料，要尽量从标题、页眉、文件线索识别 provider、year、season、lesson_no。',
    '- learning_materials 至少区分 method_card、common_mistake、question_type_summary、exam_trend、textbook_deep_dive、solution_summary、concept_explanation、study_advice。',
    '- 每条 learning_materials 必须有 source_ref.page；能识别 slide_no/question_no 时也必须保留。',
    '- 每道题必须有 source_ref.page；能识别 question_no 时必须保留原题号，例如 "例题14"。',
    '- 原文没有答案时，answer 必须是空字符串 ""，quality_status 必须是 missing_answer。',
    '- 原文没有解析时，solution_text 必须是空字符串 ""；不要凭空生成解析。',
    '- 对手写解析只能整理可见步骤，不要补充页面没有的结论。',
    '- content_origin：原文直接抽取用 source_extract；模型归纳出来的技巧总结用 model_summary。',
    '- kp_hints 使用提供的知识点上下文做名称归一化；没有匹配时使用页面里的简洁知识点名。',
    '- 只输出 JSON，不要输出 Markdown，不要解释。',
    '',
    '必须返回的 JSON 顶层结构：',
    '{',
    '  "source_document": {},',
    '  "source_units": [],',
    '  "knowledge_points": [],',
    '  "learning_materials": [],',
    '  "questions": []',
    '}',
    '',
    pageText,
  ].join('\n');
}

export function buildMixedLearningMaterialKnowledgeContext({
  points,
  maxItems = 180,
}: Record<string, unknown> = {}) {
  if (!points?.length) {
    return [
      '知识点归一化要求：',
      '没有提供外部知识点库。请基于页面内容生成简洁、可复用的 kp_hints；不要为了匹配而编造不存在的知识点。',
    ].join('\n');
  }

  const rendered = points
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
    '知识点归一化要求：',
    '下面是可用于归一化 kp_hints 的知识点库。learning_materials 和 questions 的 kp_hints 应优先使用这些 name。',
    '可以参考 id，但输出 kp_hints 只放知识点名称字符串，不要输出 id。',
    '如果页面内容确实无法匹配下方知识点，可以使用页面中的简洁知识点名。',
    '',
    rendered.join('\n'),
  ].join('\n');
}

export function parseMixedLearningMaterialJson(text, context = {}) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    const batch = normalizeMixedLearningMaterialBatch({}, context);
    return {
      batch,
      raw: null,
      error: 'No JSON object found in model output.',
      validation_error: null,
    };
  }

  try {
    const parsed = JSON.parse(candidate);
    const batch = normalizeMixedLearningMaterialBatch(parsed, context);
    const validation = mixedLearningMaterialBatchSchema.safeParse(batch);
    return {
      batch,
      raw: parsed,
      error: validation.success ? null : 'MixedLearningMaterialBatch schema validation failed.',
      validation_error: validation.success ? null : validation.error.issues,
    };
  } catch (error) {
    const batch = normalizeMixedLearningMaterialBatch({}, context);
    return {
      batch,
      raw: null,
      error: error.message,
      validation_error: null,
    };
  }
}

export function normalizeMixedLearningMaterialBatch(value, context = {}) {
  const input = value?.batch && typeof value.batch === 'object' ? value.batch : (value ?? {});
  const sourceUnits = normalizeSourceUnits(input.source_units ?? input.sourceUnits);
  const firstPage = sourceUnits[0]?.page_no ?? 1;

  return {
    source_document: normalizeSourceDocument(
      input.source_document ?? input.sourceDocument,
      context,
    ),
    source_units: sourceUnits,
    knowledge_points: normalizeMixedKnowledgePoints(
      input.knowledge_points ?? input.knowledgePoints,
    ),
    learning_materials: normalizeLearningMaterials(
      input.learning_materials ?? input.learningMaterials ?? input.materials,
      {
        fallbackPage: firstPage,
      },
    ),
    questions: normalizeMixedQuestions(input.questions, {
      fallbackPage: firstPage,
    }),
  };
}

function resultFromDocumentParse({ documentResult, subjectName, fallbackTitle, pageCount }) {
  const parsed = parseMixedLearningMaterialJson(documentResult.text, {
    subjectName,
    fallbackTitle,
    pageCount,
  });
  const fallback = shouldUsePageResultFallback(parsed.batch, parsed.error)
    ? parseMixedLearningMaterialFromPageResults(documentResult.pages, {
        subjectName,
        fallbackTitle,
        pageCount,
      })
    : null;
  const effectiveBatch = fallback ?? parsed.batch;

  return {
    ...documentResult,
    ...effectiveBatch,
    parse_error: parsed.error,
    validation_error: parsed.validation_error,
    raw_mixed_material: parsed.raw,
    fallback_used: fallback ? 'page_results' : undefined,
    mixed_material_schema_version: 1,
    payload_log_path: documentResult.payload_log_path,
  };
}

function shouldUsePageResultFallback(batch, error) {
  if (!error) return false;
  return (
    (batch.source_units?.length ?? 0) === 0 &&
    (batch.knowledge_points?.length ?? 0) === 0 &&
    (batch.learning_materials?.length ?? 0) === 0 &&
    (batch.questions?.length ?? 0) === 0
  );
}

function parseMixedLearningMaterialFromPageResults(pages = [], context = {}) {
  const batches = [];
  for (const page of pages ?? []) {
    const parsed = parseMixedLearningMaterialJson(page.text, {
      ...context,
      pageCount: context.pageCount ?? pages.length,
    });
    if (
      parsed.batch.source_units.length ||
      parsed.batch.knowledge_points.length ||
      parsed.batch.learning_materials.length ||
      parsed.batch.questions.length
    ) {
      batches.push(parsed.batch);
    }
  }

  const merged = {
    source_document: normalizeSourceDocument(batches[0]?.source_document, context),
    source_units: dedupeSourceUnits(batches.flatMap((batch) => batch.source_units)),
    knowledge_points: dedupeKnowledgePoints(batches.flatMap((batch) => batch.knowledge_points)),
    learning_materials: dedupeLearningMaterials(
      batches.flatMap((batch) => batch.learning_materials),
    ),
    questions: dedupeQuestions(batches.flatMap((batch) => batch.questions)),
  };

  const validation = mixedLearningMaterialBatchSchema.safeParse(merged);
  if (validation.success) return merged;
  return normalizeMixedLearningMaterialBatch(merged, context);
}

function normalizeSourceDocument(value, context) {
  const source = value && typeof value === 'object' ? value : {};
  const fallbackTitle = baseNameWithoutExtension(
    context.fallbackTitle ?? source.name ?? source.filename ?? '',
  );
  const modelTitle = stringOrDefault(
    source.title ?? source.document_title ?? source.documentTitle,
    fallbackTitle || '学习资料',
  );
  const title = preferFallbackTitle({ modelTitle, fallbackTitle });
  const subjectName = stringOrDefault(
    source.subject_name ?? source.subjectName,
    context.subjectName ?? '',
  );
  const titleSearch = [title, context.fallbackTitle].filter(Boolean).join('\n');

  return {
    source_type: normalizeSourceType(source.source_type ?? source.sourceType, titleSearch),
    title,
    subject_name: subjectName,
    stage: normalizeStage(source.stage, subjectName || titleSearch),
    grade: stringOrDefault(source.grade, inferGrade(titleSearch)),
    provider: stringOrDefault(source.provider, inferProvider(titleSearch)),
    publisher: stringOrDefault(source.publisher, ''),
    year: numberOrNull(source.year ?? inferYear(titleSearch)),
    season: stringOrDefault(source.season, inferSeason(titleSearch)),
    exam_name: stringOrDefault(source.exam_name ?? source.examName, ''),
    paper_name: stringOrDefault(source.paper_name ?? source.paperName, ''),
    region: stringOrDefault(source.region, ''),
    lesson_no: stringOrDefault(source.lesson_no ?? source.lessonNo, inferLessonNo(titleSearch)),
    page_count: numberOrDefault(source.page_count ?? source.pageCount, context.pageCount ?? 0),
  };
}

function normalizeSourceType(value, searchText = '') {
  const raw = String(value ?? '').trim();
  if (MIXED_SOURCE_TYPES.includes(raw)) return raw;
  if (/答案|解析册|answer/i.test(raw) || /答案|解析册/.test(searchText)) return 'answer_book';
  if (/试卷|高考|联考|模拟卷|exam|paper/i.test(raw) || /试卷|高考|联考|模拟卷/.test(searchText))
    return 'exam_paper';
  if (/教材|textbook/i.test(raw) || /教材|必修|选择性必修/.test(searchText)) return 'textbook';
  if (
    /讲义|PPT|打印版|课件|handout|lesson/i.test(raw) ||
    /讲义|PPT|打印版|课件|第\d+讲|第[一二三四五六七八九十]+讲/.test(searchText)
  ) {
    return 'lesson_handout';
  }
  if (/题集|习题|练习|workbook/i.test(raw) || /题集|习题|练习/.test(searchText)) return 'workbook';
  if (/题包|question_pack/i.test(raw) || /题包/.test(searchText)) return 'question_pack';
  return 'mixed_material';
}

function normalizeStage(value, searchText = '') {
  const raw = String(value ?? '').toLowerCase();
  if (raw === 'primary' || /小学/.test(searchText)) return 'primary';
  if (raw === 'junior' || /初中/.test(searchText)) return 'junior';
  if (raw === 'senior' || /高中|高一|高二|高三/.test(searchText)) return 'senior';
  return 'senior';
}

function inferGrade(text) {
  if (/高一|g10|10年级/i.test(text)) return 'g10';
  if (/高二|g11|11年级/i.test(text)) return 'g11';
  if (/高三|g12|12年级/i.test(text)) return 'g12';
  return '';
}

function inferProvider(text) {
  if (/高途/.test(text)) return '高途';
  if (/学而思/.test(text)) return '学而思';
  if (/猿辅导/.test(text)) return '猿辅导';
  if (/新东方/.test(text)) return '新东方';
  return '';
}

function inferYear(text) {
  const match = String(text ?? '').match(/(20\d{2})/);
  return match ? Number(match[1]) : null;
}

function inferSeason(text) {
  const match = String(text ?? '').match(/(春季|暑假|暑期|秋季|寒假|冬季)/);
  return match ? match[1] : '';
}

function inferLessonNo(text) {
  const match = String(text ?? '').match(/第\s*([0-9一二三四五六七八九十百]+)\s*讲/);
  return match ? `第${match[1]}讲` : '';
}

function preferFallbackTitle({ modelTitle, fallbackTitle }) {
  if (!fallbackTitle) return modelTitle;
  if (!modelTitle) return fallbackTitle;
  if (
    /集合与逻辑重点题型全梳理/.test(fallbackTitle) &&
    !/集合与逻辑重点题型全梳理/.test(modelTitle)
  ) {
    return fallbackTitle;
  }
  if (/^(学习资料|高中数学讲义|高中数学资料|讲义|资料)$/.test(modelTitle.trim())) {
    return fallbackTitle;
  }
  return modelTitle;
}

function normalizeSourceUnits(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((unit) => unit && typeof unit === 'object')
    .map((unit) => {
      const page =
        positiveInt(
          unit.page_no ?? unit.pageNo ?? unit.page_number ?? unit.page ?? unit.source_page,
        ) ?? 1;
      return omitUndefined({
        unit_kind: normalizeUnitKind(unit.unit_kind ?? unit.unitKind ?? unit.kind),
        page_no: page,
        slide_no: positiveInt(unit.slide_no ?? unit.slideNo),
        question_no: optionalString(unit.question_no ?? unit.questionNo ?? unit.number),
        bbox: normalizeBbox(unit.bbox ?? unit.bounding_box ?? unit.boundingBox),
        text_snippet: stringOrDefault(unit.text_snippet ?? unit.textSnippet ?? unit.snippet, ''),
      });
    });
}

function normalizeUnitKind(value) {
  const raw = String(value ?? '').trim();
  if (MIXED_UNIT_KINDS.includes(raw)) return raw;
  if (/slide|页内|PPT|幻灯/i.test(raw)) return 'slide';
  if (/question|题/.test(raw)) return 'question_region';
  if (/explanation|解析|答案/.test(raw)) return 'explanation_region';
  if (/page|页/.test(raw)) return 'page';
  return 'text_block';
}

function normalizeMixedKnowledgePoints(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      if (typeof point === 'string') {
        const name = point.trim();
        return name ? { name, chapter_no: null, brief: '' } : null;
      }
      if (!point || typeof point !== 'object') return null;
      const name = stringOrDefault(point.name ?? point.title, '');
      const brief = stringOrDefault(point.brief ?? point.description ?? point.content, '');
      if (!name && !brief) return null;
      return {
        name: name || brief.slice(0, 30),
        chapter_no:
          point.chapter_no == null && point.chapterNo == null
            ? null
            : String(point.chapter_no ?? point.chapterNo),
        brief,
      };
    })
    .filter(Boolean);
}

function normalizeLearningMaterials(value, { fallbackPage }) {
  if (!Array.isArray(value)) return [];
  return value
    .map((material) => {
      if (!material || typeof material !== 'object') return null;
      const content = stringOrDefault(
        material.content ?? material.body ?? material.description,
        '',
      );
      const title = stringOrDefault(material.title ?? material.name, content.slice(0, 30));
      if (!title && !content) return null;
      return {
        material_type: normalizeMaterialType(
          material.material_type ?? material.materialType ?? material.type,
          title,
          content,
        ),
        title,
        content,
        student_summary: stringOrDefault(
          material.student_summary ?? material.studentSummary ?? material.summary,
          '',
        ),
        content_origin: normalizeContentOrigin(material.content_origin ?? material.contentOrigin),
        kp_hints: normalizeStringArray(
          material.kp_hints ??
            material.kpHints ??
            material.knowledge_points ??
            material.knowledgePoints,
        ),
        source_ref: normalizeSourceRef(
          material.source_ref ?? material.sourceRef ?? material,
          fallbackPage,
        ),
        confidence: clamp01(numberOrDefault(material.confidence, 0.7)),
      };
    })
    .filter(Boolean);
}

function normalizeMaterialType(value, title = '', content = '') {
  const raw = String(value ?? '').trim();
  if (MIXED_LEARNING_MATERIAL_TYPES.includes(raw)) return raw;
  const search = [raw, title, content].join('\n');
  if (/易错|误区|避坑|注意/.test(search)) return 'common_mistake';
  if (/题型|类型|套路|总结/.test(search)) return 'question_type_summary';
  if (/考情|高频|命题|趋势|考点/.test(search)) return 'exam_trend';
  if (/解析|答案|手写|步骤/.test(search)) return 'solution_summary';
  if (/方法|大招|技巧|口诀|检验|分类讨论|公式/.test(search)) return 'method_card';
  if (/教材|定义|性质|概念/.test(search)) return 'concept_explanation';
  if (/建议|复习|学习|审题/.test(search)) return 'study_advice';
  return 'concept_explanation';
}

function normalizeContentOrigin(value) {
  const raw = String(value ?? '').trim();
  if (raw === 'source_extract' || /原文|摘录|extract/i.test(raw)) return 'source_extract';
  if (raw === 'model_summary' || /归纳|总结|summary/i.test(raw)) return 'model_summary';
  return 'source_extract';
}

function normalizeMixedQuestions(value, { fallbackPage }) {
  if (!Array.isArray(value)) return [];
  return value
    .map((question) => {
      if (!question || typeof question !== 'object') return null;
      const content = stringOrDefault(
        question.content ?? question.stem ?? question.question ?? question.raw_text,
        '',
      );
      const answer = stringOrDefault(question.answer, '');
      const solutionText = stringOrDefault(
        question.solution_text ??
          question.solutionText ??
          question.solution ??
          question.analysis ??
          question.explanation,
        '',
      );
      const qualityStatus = normalizeQuestionQuality({
        requested: question.quality_status ?? question.qualityStatus,
        content,
        answer,
        solutionText,
      });
      if (!content && !answer && !solutionText) return null;
      return {
        content,
        question_type: normalizeQuestionType(
          question.question_type ?? question.questionType ?? question.type,
        ),
        options: normalizeOptions(question.options),
        answer,
        solution_text: solutionText,
        difficulty: numberOrDefault(question.difficulty, 0),
        kp_hints: normalizeStringArray(
          question.kp_hints ??
            question.kpHints ??
            question.knowledge_points ??
            question.knowledgePoints,
        ),
        quality_status: qualityStatus,
        source_ref: normalizeSourceRef(
          question.source_ref ?? question.sourceRef ?? question,
          fallbackPage,
        ),
      };
    })
    .filter(Boolean);
}

function normalizeQuestionType(value) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (MIXED_QUESTION_TYPES.includes(raw)) return raw;
  if (/选择|choice|单选|多选/.test(raw)) return 'choice';
  if (/填空|fill/.test(raw)) return 'fill_in';
  if (/证明|proof/.test(raw)) return 'proof';
  if (/解答|计算|solution/.test(raw)) return 'solution';
  if (/简答|short/.test(raw)) return 'short_answer';
  return 'unknown';
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((option, index) => {
      if (typeof option === 'string') {
        const match = option.match(/^\s*([A-H])[\s.．、:：]*(.*)$/i);
        return {
          label: match ? match[1].toUpperCase() : String.fromCharCode(65 + index),
          text: match ? match[2].trim() : option,
        };
      }
      if (!option || typeof option !== 'object') return null;
      return {
        label: stringOrDefault(option.label ?? option.key, String.fromCharCode(65 + index)),
        text: stringOrDefault(option.text ?? option.content ?? option.value, ''),
      };
    })
    .filter(Boolean);
}

function normalizeQuestionQuality({ requested, content, answer, solutionText }) {
  if (!content.trim()) return 'incomplete_stem';
  if (!answer.trim()) return 'missing_answer';
  if (!solutionText.trim()) return 'missing_solution';
  const raw = String(requested ?? '').trim();
  if (MIXED_QUALITY_STATUSES.includes(raw)) return raw;
  return 'publishable';
}

function normalizeSourceRef(value, fallbackPage = 1) {
  const ref = value && typeof value === 'object' ? value : {};
  const pages = normalizePageArray(ref.source_pages ?? ref.sourcePages ?? ref.pages);
  const page =
    positiveInt(
      ref.page ?? ref.page_no ?? ref.pageNo ?? ref.page_number ?? ref.source_page ?? pages[0],
    ) ??
    fallbackPage ??
    1;
  return omitUndefined({
    page,
    slide_no: positiveInt(ref.slide_no ?? ref.slideNo),
    question_no: optionalString(ref.question_no ?? ref.questionNo ?? ref.number),
    text_snippet: optionalString(
      ref.text_snippet ?? ref.textSnippet ?? ref.snippet ?? ref.raw_text,
    ),
  });
}

function dedupeSourceUnits(units) {
  return dedupeBy(units, (unit) =>
    [
      unit.unit_kind,
      unit.page_no,
      unit.slide_no ?? '',
      unit.question_no ?? '',
      unit.text_snippet ?? '',
    ].join('|'),
  );
}

function dedupeKnowledgePoints(points) {
  return dedupeBy(points, (point) => [point.name, point.chapter_no ?? ''].join('|'));
}

function dedupeLearningMaterials(materials) {
  return dedupeBy(materials, (material) =>
    [
      material.material_type,
      material.title,
      material.source_ref?.page ?? '',
      material.source_ref?.slide_no ?? '',
      material.source_ref?.question_no ?? '',
    ].join('|'),
  );
}

function dedupeQuestions(questions) {
  return dedupeBy(questions, (question) =>
    [
      question.content,
      question.source_ref?.page ?? '',
      question.source_ref?.question_no ?? '',
    ].join('|'),
  );
}

function dedupeBy(items, keyFor) {
  const byKey = new Map();
  for (const item of items ?? []) {
    if (!item) continue;
    const key = keyFor(item);
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return Array.from(byKey.values());
}

function normalizeBbox(value) {
  if (Array.isArray(value) && value.length >= 4) {
    const box = value.slice(0, 4).map(Number);
    return box.every(Number.isFinite) ? box : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const box = [
    value.x ?? value.left,
    value.y ?? value.top,
    value.width ?? value.w,
    value.height ?? value.h,
  ].map(Number);
  return box.every(Number.isFinite) ? box : undefined;
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
  if (!Array.isArray(value)) {
    if (value == null) return [];
    const text = String(value).trim();
    return text ? [text] : [];
  }
  return value
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .map((item) => {
      if (item && typeof item === 'object') return item.name ?? item.title ?? item.id ?? '';
      return item;
    })
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function normalizePageArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 1);
}

function positiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function numberOrDefault(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0.7;
  return Math.max(0, Math.min(1, value));
}

function stringOrDefault(value, defaultValue) {
  if (value == null) return defaultValue;
  return String(value);
}

function optionalString(value) {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

function baseNameWithoutExtension(value) {
  const text = String(value ?? '');
  if (!text) return '';
  const normalized = text.split(/[\\/]/).at(-1) ?? text;
  return normalized.replace(/\.[^.]+$/, '');
}

function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined));
}
