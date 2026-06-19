// @ts-nocheck
import { parsePdfPages } from '../documents/document-parser.ts';

export const DEFAULT_TEXTBOOK_KNOWLEDGE_POINT_TARGET_RANGE = '100-180';

export async function parsePdfKnowledgePoints({ parsePdfPagesImpl = parsePdfPages, ...options }) {
  const documentResult = await parsePdfPagesImpl({
    ...options,
    pagePrompt:
      options.pagePrompt ??
      (({ pageNumber, totalPages }) => buildKnowledgePagePrompt({ pageNumber, totalPages })),
    finalPrompt:
      options.finalPrompt ?? (({ pageResults }) => buildKnowledgeFinalPrompt({ pageResults })),
  });
  const parsed = parseKnowledgePointsJson(documentResult.text);
  const fallback =
    parsed.knowledge_points.length > 0
      ? null
      : parseKnowledgePointsFromPageResults(documentResult.pages);
  const effectiveParsed = fallback ?? parsed;

  return {
    ...documentResult,
    knowledge_point_count: effectiveParsed.knowledge_points.length,
    chapters: effectiveParsed.chapters,
    knowledge_points: effectiveParsed.knowledge_points,
    coverage_summary: effectiveParsed.coverage_summary,
    target_knowledge_point_range: DEFAULT_TEXTBOOK_KNOWLEDGE_POINT_TARGET_RANGE,
    uncertain_notes: effectiveParsed.uncertain_notes,
    parse_error: parsed.error,
    fallback_used: fallback ? 'page_results' : undefined,
    payload_log_path: options.payloadLogPath ?? documentResult.payload_log_path,
  };
}

export function buildKnowledgePagePrompt({ pageNumber, totalPages }) {
  return [
    `请分析这本教材第 ${pageNumber}/${totalPages} 页图片。`,
    '目标是识别本页出现的教材结构、章节线索和原子教学点，不要把练习题当作知识点主体。',
    '',
    '请特别关注：',
    '- 章、节、小节标题，以及本页属于哪一个章节；',
    '- 概念、定义、符号记法、定理、性质、公式、方法、图象特征、应用模型、易错点等原子教学点；',
    '- 同一页中并列出现的不同定义、性质、方法、公式要拆成不同知识点，不要只概括成一个大主题；',
    '- 与知识点相关的图形、表格、注释、思考、探究和例题说明；',
    '- 知识点的前置依赖、适用范围、易错点和难度；',
    '- 页码、页眉页脚和版式提示中能帮助定位章节的信息；',
    '- 无法确认或被遮挡的内容写入 uncertain_notes，不要编造。',
    '',
    '请输出 JSON，不要输出 Markdown：',
    '{',
    `  "page_number": ${pageNumber},`,
    '  "chapter_title": "本页所属章/节；无法判断则为空字符串",',
    '  "section_title": "本页所属小节；无法判断则为空字符串",',
    '  "knowledge_points": [',
    '    {',
    '      "name": "知识点名称",',
    '      "description": "知识点解释，尽量贴近教材表述",',
    '      "formulas": ["相关公式、符号或数学表达式"],',
    '      "examples": ["教材中的例题、情境或应用说明"],',
    '      "prerequisites": ["理解该知识点需要的前置知识"],',
    '      "difficulty": "基础/中等/较难/未知",',
    `      "source_pages": [${pageNumber}]`,
    '    }',
    '  ],',
    '  "uncertain_notes": []',
    '}',
  ].join('\n');
}

export function buildKnowledgeFinalPrompt({ pageResults }) {
  const inputCandidateCount = countPageKnowledgePointCandidates(pageResults);
  const pageText = pageResults
    .map((page) => [`第 ${page.page_number} 页：`, page.text].join('\n'))
    .join('\n\n---\n\n');

  return [
    '下面是一本教材逐页视觉解析得到的知识点候选。',
    '请基于这些页面结果，合并重复项，校正章节归属，并输出整本教材的结构化知识点 JSON。你的任务是整理教材知识点库，不是写教材摘要。',
    '',
    '要求：',
    `- 粒度目标：对一本完整高中数学教材，${DEFAULT_TEXTBOOK_KNOWLEDGE_POINT_TARGET_RANGE} 个知识点更正常；这不是硬性上下限，但如果最终明显少于 100 个，必须在 coverage_summary.coverage_notes 说明为什么没有遗漏。`,
    `- 本次逐页输入中约有 ${inputCandidateCount} 个知识点候选。除非确实重复、目录/前言/习题装饰或不是教学点，否则应保留非重复候选。`,
    '- 知识点应是原子教学点：定义、符号、关系、运算、性质、判定、公式、方法、图象特征、应用模型、常见误区可以分别成为独立知识点；不要把一整节压缩成一个大知识点。',
    '- 按教材原有章节顺序组织 chapters；',
    '- chapter 和 section 必须同时输出 number 和 title；title 不要重复包含 number；display_name 由 number + title 组成，便于前端显示。',
    '- 每个 chapter 下按教材原有节/小节顺序组织 sections，再把知识点放入对应 section.knowledge_points；',
    '- 如果某些知识点无法判断所属节，可以临时放在 chapter.knowledge_points；',
    '- 同一个知识点跨页出现时合并为一项，source_pages 保留所有相关页码；',
    '- 不要把普通练习题、二维码、广告、目录装饰或孤立例题编号当作知识点；',
    '- 例题可以作为 examples 支撑已有知识点；',
    '- description 应说明概念内涵、用途或教材中的核心表述；',
    '- formulas 只放与该知识点直接相关的公式、符号或表达式；',
    '- prerequisites 放理解该知识点需要先掌握的内容；',
    '- 对无法确认的章节、页码或识别内容写入 uncertain_notes，不要编造；',
    '- 只输出 JSON，不要输出 Markdown。',
    '',
    'JSON 格式：',
    '{',
    '  "coverage_summary": {',
    `    "input_candidate_count": ${inputCandidateCount},`,
    '    "output_knowledge_point_count": 0,',
    `    "expected_range": "${DEFAULT_TEXTBOOK_KNOWLEDGE_POINT_TARGET_RANGE}",`,
    '    "coverage_notes": ["如果输出数量明显低于目标粒度，请解释原因"]',
    '  },',
    '  "chapters": [',
    '    {',
    '      "number": "第一章",',
    '      "title": "章节名称，不要重复写 number",',
    '      "display_name": "第一章 章节名称",',
    '      "summary": "本章核心内容概述",',
    '      "source_pages": [1, 2],',
    '      "sections": [',
    '        {',
    '          "number": "1.1",',
    '          "title": "小节名称，不要重复写 number",',
    '          "display_name": "1.1 小节名称",',
    '          "summary": "本节核心内容概述",',
    '          "source_pages": [1, 2],',
    '          "knowledge_points": [',
    '            {',
    '              "name": "知识点名称",',
    '              "description": "知识点解释",',
    '              "formulas": ["公式或符号"],',
    '              "examples": ["例题或应用场景"],',
    '              "prerequisites": ["前置知识"],',
    '              "difficulty": "基础/中等/较难/未知",',
    '              "source_pages": [1]',
    '            }',
    '          ]',
    '        }',
    '      ],',
    '      "knowledge_points": [',
    '        {',
    '          "name": "知识点名称",',
    '          "description": "知识点解释",',
    '          "formulas": ["公式或符号"],',
    '          "examples": ["例题或应用场景"],',
    '          "prerequisites": ["前置知识"],',
    '          "difficulty": "基础/中等/较难/未知",',
    '          "source_pages": [1]',
    '        }',
    '      ]',
    '    }',
    '  ],',
    '  "knowledge_points": [],',
    '  "uncertain_notes": []',
    '}',
    '',
    pageText,
  ].join('\n');
}

export function parseKnowledgePointsJson(text) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return {
      chapters: [],
      knowledge_points: [],
      uncertain_notes: [],
      error: 'No JSON object found in model output.',
    };
  }

  try {
    const parsed = JSON.parse(candidate);
    const chapters = normalizeChapters(parsed.chapters);
    const nestedPoints = chapters.flatMap((chapter) => [
      ...(chapter.sections ?? []).flatMap((section) => section.knowledge_points ?? []),
      ...(chapter.knowledge_points ?? []),
    ]);
    const topLevelPoints = normalizeKnowledgePoints(parsed.knowledge_points, { chapterTitle: '' });
    const knowledgePoints = mergeKnowledgePoints([...nestedPoints, ...topLevelPoints]);

    return {
      chapters,
      knowledge_points: knowledgePoints,
      coverage_summary: normalizeCoverageSummary(parsed.coverage_summary, {
        outputKnowledgePointCount: knowledgePoints.length,
      }),
      uncertain_notes: normalizeStringArray(parsed.uncertain_notes),
      error: null,
      raw: parsed,
    };
  } catch (error) {
    return {
      chapters: [],
      knowledge_points: [],
      coverage_summary: normalizeCoverageSummary(null, {
        outputKnowledgePointCount: 0,
      }),
      uncertain_notes: [],
      error: error.message,
    };
  }
}

function normalizeChapters(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((chapter) => chapter && typeof chapter === 'object')
    .map((chapter) => {
      const heading = normalizeHeading({
        number: chapter.number ?? chapter.chapter_number ?? chapter.chapterNumber,
        title: chapter.title ?? chapter.name,
        kind: 'chapter',
      });
      return omitUndefined({
        number: heading.number,
        title: heading.title,
        display_name:
          chapter.display_name == null && chapter.displayName == null
            ? heading.displayName
            : String(chapter.display_name ?? chapter.displayName),
        summary: chapter.summary == null ? undefined : String(chapter.summary),
        source_pages: normalizePageArray(chapter.source_pages ?? chapter.pages),
        sections: normalizeSections(chapter.sections, {
          chapterNumber: heading.number,
          chapterTitle: heading.title,
          chapterDisplayName: heading.displayName,
        }),
        knowledge_points: normalizeKnowledgePoints(chapter.knowledge_points, {
          chapterNumber: heading.number,
          chapterTitle: heading.displayName,
          sectionNumber: '',
          sectionTitle: '',
        }),
        raw: chapter,
      });
    });
}

function normalizeSections(value, { chapterNumber, chapterTitle, chapterDisplayName }) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((section) => section && typeof section === 'object')
    .map((section) => {
      const heading = normalizeHeading({
        number: section.number ?? section.section_number ?? section.sectionNumber,
        title: section.title ?? section.name,
        kind: 'section',
      });
      return omitUndefined({
        number: heading.number,
        title: heading.title,
        display_name:
          section.display_name == null && section.displayName == null
            ? heading.displayName
            : String(section.display_name ?? section.displayName),
        summary: section.summary == null ? undefined : String(section.summary),
        source_pages: normalizePageArray(section.source_pages ?? section.pages),
        knowledge_points: normalizeKnowledgePoints(section.knowledge_points, {
          chapterNumber,
          chapterTitle: chapterDisplayName || chapterTitle,
          sectionNumber: heading.number,
          sectionTitle: heading.displayName,
        }),
        raw: section,
      });
    });
}

function normalizeKnowledgePoints(
  value,
  { chapterNumber = '', chapterTitle, sectionNumber = '', sectionTitle = '' },
) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((point) => point && typeof point === 'object')
    .map((point) =>
      omitUndefined({
        chapter_number:
          point.chapter_number == null && point.chapterNumber == null
            ? chapterNumber
            : String(point.chapter_number ?? point.chapterNumber),
        chapter_title:
          point.chapter_title == null && point.chapterTitle == null
            ? chapterTitle
            : String(point.chapter_title ?? point.chapterTitle),
        section_number:
          point.section_number == null && point.sectionNumber == null
            ? sectionNumber
            : String(point.section_number ?? point.sectionNumber),
        section_title:
          point.section_title == null && point.sectionTitle == null
            ? sectionTitle
            : String(point.section_title ?? point.sectionTitle),
        name: point.name == null ? '' : String(point.name),
        description: point.description == null ? '' : String(point.description),
        formulas: normalizeStringArray(point.formulas ?? point.formulae),
        examples: normalizeStringArray(point.examples),
        prerequisites: normalizeStringArray(point.prerequisites ?? point.preconditions),
        difficulty: point.difficulty == null ? '未知' : String(point.difficulty),
        source_pages: normalizePageArray(point.source_pages ?? point.pages),
        raw: point,
      }),
    )
    .filter((point) => point.name || point.description);
}

function mergeKnowledgePoints(points) {
  const merged = new Map();
  for (const point of points) {
    const key =
      `${point.chapter_title ?? ''}\n${point.section_title ?? ''}\n${point.name ?? ''}`.trim();
    if (!key || !merged.has(key)) {
      merged.set(key || `point-${merged.size + 1}`, point);
      continue;
    }
    const existing = merged.get(key);
    merged.set(key, {
      ...existing,
      description: existing.description || point.description,
      formulas: uniqueStrings([...(existing.formulas ?? []), ...(point.formulas ?? [])]),
      examples: uniqueStrings([...(existing.examples ?? []), ...(point.examples ?? [])]),
      prerequisites: uniqueStrings([
        ...(existing.prerequisites ?? []),
        ...(point.prerequisites ?? []),
      ]),
      source_pages: uniqueNumbers([
        ...(existing.source_pages ?? []),
        ...(point.source_pages ?? []),
      ]),
      raw: existing.raw,
    });
  }
  return [...merged.values()];
}

function normalizeCoverageSummary(value, { outputKnowledgePointCount }) {
  const summary = value && typeof value === 'object' ? value : {};
  return {
    input_candidate_count: numberOrDefault(
      summary.input_candidate_count ?? summary.inputCandidateCount,
      null,
    ),
    output_knowledge_point_count: outputKnowledgePointCount,
    expected_range:
      summary.expected_range == null && summary.expectedRange == null
        ? DEFAULT_TEXTBOOK_KNOWLEDGE_POINT_TARGET_RANGE
        : String(summary.expected_range ?? summary.expectedRange),
    coverage_notes: normalizeStringArray(summary.coverage_notes ?? summary.coverageNotes),
  };
}

function normalizeHeading({ number, title, kind }) {
  const parsed = parseHeadingNumber(title, kind);
  const normalizedNumber =
    number == null || String(number).trim() === '' ? parsed.number : String(number).trim();
  const normalizedTitle = stripHeadingNumber(
    title == null ? parsed.title : String(title),
    normalizedNumber,
  ).trim();
  const displayName = [normalizedNumber, normalizedTitle].filter(Boolean).join(' ');
  return {
    number: normalizedNumber,
    title: normalizedTitle,
    displayName,
  };
}

function parseHeadingNumber(value, kind) {
  const text = String(value ?? '').trim();
  if (!text) return { number: '', title: '' };

  if (kind === 'chapter') {
    const chapterMatch = text.match(/^(第[一二三四五六七八九十百千万\d]+章)\s*(.*)$/);
    if (chapterMatch) return { number: chapterMatch[1], title: chapterMatch[2].trim() };
    const modelingMatch = text.match(/^(数学建模)\s*(.*)$/);
    if (modelingMatch) return { number: modelingMatch[1], title: modelingMatch[2].trim() };
    return { number: '', title: text };
  }

  const sectionMatch = text.match(/^([0-9０-９]+(?:[.．][0-9０-９]+)*)\s*(.*)$/);
  if (sectionMatch) {
    return {
      number: normalizeDigitsAndDots(sectionMatch[1]),
      title: sectionMatch[2].trim(),
    };
  }
  return { number: '', title: text };
}

function stripHeadingNumber(title, number) {
  const text = String(title ?? '').trim();
  const normalizedNumber = String(number ?? '').trim();
  if (!normalizedNumber) return text;
  if (text === normalizedNumber) return '';
  if (text.startsWith(normalizedNumber)) return text.slice(normalizedNumber.length).trim();
  return text;
}

function normalizeDigitsAndDots(value) {
  return String(value)
    .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10))
    .replace(/．/g, '.');
}

function countPageKnowledgePointCandidates(pageResults) {
  return pageResults.reduce((count, page) => {
    const candidate = extractJsonCandidate(page.text);
    if (!candidate) return count;
    try {
      const parsed = JSON.parse(candidate);
      return count + (Array.isArray(parsed.knowledge_points) ? parsed.knowledge_points.length : 0);
    } catch {
      return count;
    }
  }, 0);
}

function parseKnowledgePointsFromPageResults(pageResults) {
  if (!Array.isArray(pageResults) || pageResults.length === 0) return null;

  const chapterEntries = new Map();
  const uncertainNotes = [];
  const pageParseErrors = [];
  let inputCandidateCount = 0;

  for (const page of pageResults) {
    const pageNumber = Number(page.page_number ?? page.pageNumber);
    const candidate = extractJsonCandidate(page.text);
    if (!candidate) {
      if (page.text) pageParseErrors.push(`第 ${pageNumber || '未知'} 页未找到 JSON`);
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(candidate);
    } catch (error) {
      pageParseErrors.push(`第 ${pageNumber || '未知'} 页 JSON 解析失败：${error.message}`);
      continue;
    }

    const rawPoints = Array.isArray(parsed.knowledge_points) ? parsed.knowledge_points : [];
    const validPoints = rawPoints.filter((point) => point && typeof point === 'object');
    inputCandidateCount += validPoints.length;
    uncertainNotes.push(...normalizeStringArray(parsed.uncertain_notes));
    if (!validPoints.length) continue;

    const chapterEntry = getOrCreateChapterEntry(chapterEntries, {
      number: parsed.chapter_number ?? parsed.chapterNumber,
      title: parsed.chapter_title ?? parsed.chapterTitle ?? parsed.chapter ?? '未分章',
    });
    addPages(chapterEntry.sourcePages, [pageNumber]);

    const sectionTitle = parsed.section_title ?? parsed.sectionTitle ?? parsed.section ?? '';
    const sectionNumber = parsed.section_number ?? parsed.sectionNumber;
    const sectionEntry =
      sectionTitle || sectionNumber
        ? getOrCreateSectionEntry(chapterEntry, {
            number: sectionNumber,
            title: sectionTitle,
          })
        : null;
    if (sectionEntry) addPages(sectionEntry.sourcePages, [pageNumber]);

    for (const point of validPoints) {
      const sourcePages = normalizePageArray(point.source_pages ?? point.pages);
      const fallbackPages = sourcePages.length ? sourcePages : normalizePageArray([pageNumber]);
      const normalizedPoint = {
        ...point,
        source_pages: fallbackPages,
      };
      addPages(chapterEntry.sourcePages, fallbackPages);
      if (sectionEntry) {
        addPages(sectionEntry.sourcePages, fallbackPages);
        sectionEntry.section.knowledge_points.push(normalizedPoint);
      } else {
        chapterEntry.chapter.knowledge_points.push(normalizedPoint);
      }
    }
  }

  const chapters = [...chapterEntries.values()].map((chapterEntry) => ({
    ...chapterEntry.chapter,
    source_pages: uniqueNumbers([...chapterEntry.sourcePages]),
    sections: [...chapterEntry.sectionEntries.values()].map((sectionEntry) => ({
      ...sectionEntry.section,
      source_pages: uniqueNumbers([...sectionEntry.sourcePages]),
    })),
  }));
  if (
    !chapters.some(
      (chapter) =>
        chapter.knowledge_points.length > 0 ||
        chapter.sections.some((section) => section.knowledge_points.length > 0),
    )
  ) {
    return null;
  }

  const coverageNotes = [
    '最终汇总未返回可解析知识点，已使用逐页知识点候选回退。',
    ...pageParseErrors,
  ];

  return parseKnowledgePointsJson(
    JSON.stringify({
      coverage_summary: {
        input_candidate_count: inputCandidateCount,
        output_knowledge_point_count: 0,
        expected_range: DEFAULT_TEXTBOOK_KNOWLEDGE_POINT_TARGET_RANGE,
        coverage_notes: coverageNotes,
      },
      chapters,
      knowledge_points: [],
      uncertain_notes: uniqueStrings(uncertainNotes),
    }),
  );
}

function getOrCreateChapterEntry(chapterEntries, { number, title }) {
  const heading = normalizeHeading({ number, title, kind: 'chapter' });
  const displayName = heading.displayName || '未分章';
  if (!chapterEntries.has(displayName)) {
    chapterEntries.set(displayName, {
      chapter: {
        number: heading.number,
        title: heading.title || displayName,
        display_name: displayName,
        source_pages: [],
        sections: [],
        knowledge_points: [],
      },
      sectionEntries: new Map(),
      sourcePages: new Set(),
    });
  }
  return chapterEntries.get(displayName);
}

function getOrCreateSectionEntry(chapterEntry, { number, title }) {
  const heading = normalizeHeading({ number, title, kind: 'section' });
  const displayName = heading.displayName || '未分节';
  if (!chapterEntry.sectionEntries.has(displayName)) {
    const entry = {
      section: {
        number: heading.number,
        title: heading.title || displayName,
        display_name: displayName,
        source_pages: [],
        knowledge_points: [],
      },
      sourcePages: new Set(),
    };
    chapterEntry.sectionEntries.set(displayName, entry);
    chapterEntry.chapter.sections.push(entry.section);
  }
  return chapterEntry.sectionEntries.get(displayName);
}

function addPages(target, pages) {
  for (const page of normalizePageArray(pages)) {
    target.add(page);
  }
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
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function normalizePageArray(value) {
  if (!Array.isArray(value)) return [];
  return uniqueNumbers(value.map((item) => Number(item)).filter((item) => Number.isFinite(item)));
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))];
}

function uniqueNumbers(values) {
  return [
    ...new Set(values.map((value) => Number(value)).filter((value) => Number.isFinite(value))),
  ].sort((left, right) => left - right);
}

function numberOrDefault(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined));
}
