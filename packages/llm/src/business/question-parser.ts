// @ts-nocheck
import { parseDocumentPages, parsePdfPages, parseWordPages } from "../documents/document-parser.ts";

export async function parseQuestionPages({
  parseDocumentPagesImpl = parseDocumentPages,
  ...options
}) {
  const documentResult = await parseDocumentPagesImpl({
    ...options,
    documentType: "question",
    pagePrompt: options.pagePrompt ?? (({ pageNumber, totalPages }) => buildQuestionPagePrompt({ pageNumber, totalPages })),
    finalPrompt: options.finalPrompt ?? (({ pageResults }) => buildQuestionFinalPrompt({ pageResults }))
  });
  const parsed = parseQuestionsJson(documentResult.text);

  return {
    ...documentResult,
    question_count: parsed.questions.length,
    questions: parsed.questions,
    parse_error: parsed.error
  };
}

export async function parseWordQuestions({
  parseWordPagesImpl = parseWordPages,
  ...options
}) {
  const documentResult = await parseWordPagesImpl({
    ...options,
    pagePrompt: options.pagePrompt ?? (({ pageNumber, totalPages }) => buildQuestionPagePrompt({ pageNumber, totalPages })),
    finalPrompt: options.finalPrompt ?? (({ pageResults }) => buildQuestionFinalPrompt({ pageResults }))
  });
  const parsed = parseQuestionsJson(documentResult.text);

  return {
    ...documentResult,
    question_count: parsed.questions.length,
    questions: parsed.questions,
    parse_error: parsed.error
  };
}

export async function parsePdfQuestions({
  parsePdfPagesImpl = parsePdfPages,
  ...options
}) {
  const documentResult = await parsePdfPagesImpl({
    ...options,
    pagePrompt: options.pagePrompt ?? (({ pageNumber, totalPages }) => buildQuestionPagePrompt({ pageNumber, totalPages })),
    finalPrompt: options.finalPrompt ?? (({ pageResults }) => buildQuestionFinalPrompt({ pageResults }))
  });
  const parsed = parseQuestionsJson(documentResult.text);

  return {
    ...documentResult,
    question_count: parsed.questions.length,
    questions: parsed.questions,
    parse_error: parsed.error
  };
}

export function buildQuestionPagePrompt({ pageNumber, totalPages }) {
  const figureId = `p${pageNumber}-fig-1`;
  const tableId = `p${pageNumber}-table-1`;

  return [
    `请解析这份试题文档第 ${pageNumber}/${totalPages} 页图片。`,
    "目标是识别本页出现的所有试题，包括跨页题目的未完部分。",
    "",
    ...buildQuestionAcceptanceRuleLines(),
    "",
    "请特别关注：",
    "- 题号、题型、题干、选项、答案区、分值；",
    "- 页面中已经给出的答案、参考答案、解析、解题过程；",
    "- 图形、表格、坐标轴、几何图、函数图像、统计图和图片材料；",
    "- 题目与图形/表格之间的对应关系；",
    "- 图形在页面上的裁剪位置，用百分比坐标给出 bbox；",
    "- bbox 只截视觉图形/表格本体，完整包含图中字母、点名、线段、坐标轴标签和图1/图2等图号，四周留少量空白；不要把题干文字、解析文字或答案文字截入 bbox；",
    "- 如果图1、图2等子图并排或上下相邻，且中间没有题干、解析或答案正文隔开，应作为一个题图组截一个 bbox；figures 只放一个对象，用 labels/subfigures 标明包含哪些子图，不要再为每个子图重复创建独立 figures；",
    "- 只有子图相距较远、被正文隔开、或属于不同小问/题干/解析区域时，才拆成多个 figures；",
    "- 跨页题目、材料题、阅读材料和小问结构。",
    "",
    `图形 id 必须带当前页码前缀，例如 ${figureId}；表格 id 必须带当前页码前缀，例如 ${tableId}。`,
    `source_page 必须填写当前实际页码 ${pageNumber}，不要默认写 1。`,
    "如果图形出现在题干、选项、小问或解析中，请在对应文本原位置插入占位符。",
    `例如题干图使用 [[figure:${figureId}]]，解析图也保留在 analysis 或 sub_questions[].analysis 的原位置。`,
    "每个图形和表格都要标明 role 和 owner_path：role 可取 stem、option、answer、analysis、sub_question、unknown；owner_path 示例为 stem、analysis、sub_questions[0].stem、sub_questions[1].analysis。",
    "如果页面中有表格，请尽量还原为 tables 的 columns/rows，不要只写进普通文本；表格也可以同时提供 bbox。",
    "",
    "请输出 JSON，不要输出 Markdown：",
    "{",
    `  "page_number": ${pageNumber},`,
    "  \"questions\": [",
    "    {",
    "      \"number\": \"1\",",
    "      \"type\": \"选择题/填空题/解答题/材料题/未知\",",
    `      "stem": "题干文本；如果图在题干中，使用 [[figure:${figureId}]] 标记原位置",`,
    `      "options": ["A. ...", "B. ...；如果图在选项中，使用 [[figure:${figureId}]] 标记原位置"],`,
    "      \"sub_questions\": [",
    "        {",
    "          \"number\": \"1\",",
    `          "stem": "小问题干；如有图，保留 [[figure:p${pageNumber}-fig-2]] 原位置",`,
    "          \"answer\": \"小问答案；没有则为空字符串\",",
    "          \"analysis\": \"小问解析；没有则为空字符串\"",
    "        }",
    "      ],",
    "      \"answer_area\": \"是否有答题区域及其说明\",",
    "      \"answer\": \"页面可见的答案/参考答案；没有则为空字符串\",",
    "      \"analysis\": \"页面可见的解析/解题过程；没有则为空字符串\",",
    "      \"figure_description\": \"题目相关图形/表格/坐标轴的文字描述\",",
    "      \"tables\": [",
    "        {",
    `          "id": "${tableId}",`,
    "          \"role\": \"stem\",",
    "          \"owner_path\": \"stem\",",
    `          "source_page": ${pageNumber},`,
    "          \"title\": \"表格标题或用途\",",
    "          \"columns\": [\"列1\", \"列2\"],",
    "          \"rows\": [[\"第1行第1列\", \"第1行第2列\"]],",
    "          \"bbox\": {",
    "            \"x\": 10,",
    "            \"y\": 20,",
    "            \"width\": 40,",
    "            \"height\": 15",
    "          }",
    "        }",
    "      ],",
    "      \"figures\": [",
    "        {",
    `          "id": "${figureId}",`,
    "          \"role\": \"stem\",",
    "          \"owner_path\": \"stem\",",
    `          "source_page": ${pageNumber},`,
    "          \"description\": \"题目图形、表格或图片材料的描述\",",
    `          "group_id": "p${pageNumber}-q1-figures",`,
    "          \"labels\": [\"图1\", \"图2\"],",
    "          \"subfigures\": [",
    "            {",
    "              \"label\": \"图1\",",
    "              \"description\": \"左侧子图描述\",",
    "              \"bbox\": { \"x\": 10, \"y\": 20, \"width\": 12, \"height\": 25 }",
    "            },",
    "            {",
    "              \"label\": \"图2\",",
    "              \"description\": \"右侧子图描述\",",
    "              \"bbox\": { \"x\": 26, \"y\": 20, \"width\": 12, \"height\": 25 }",
    "            }",
    "          ],",
    "          \"bbox\": {",
    "            \"x\": 10,",
    "            \"y\": 20,",
    "            \"width\": 30,",
    "            \"height\": 25",
    "          }",
    "        }",
    "      ],",
    `      "source_pages": [${pageNumber}],`,
    "      \"raw_text\": \"保留本题可见原文\"",
    "    }",
    "  ],",
    "  \"uncertain_notes\": []",
    "}",
    "",
    "bbox 使用页面宽高百分比，x/y 是左上角，width/height 是裁剪宽高；bbox 只截视觉图形/表格本体，要包含图中字母、点名、线段、坐标轴标签和图1/图2等图号，边缘留少量空白，不要包含题干、解析或答案正文。",
    "相邻图1/图2这类题图组的 bbox 应覆盖整个组图，包含各子图和图号；可在 subfigures 内记录每个子图的小 bbox，但不要把同一组图重复渲染为多张独立题图。",
    "如果某个图形无法完全识别或无法定位，请在 figure_description、figures 和 uncertain_notes 中说明，不要编造。"
  ].join("\n");
}

export function buildQuestionFinalPrompt({ pageResults }) {
  const pageText = pageResults
    .map((page) => [
      `第 ${page.page_number} 页：`,
      page.text
    ].join("\n"))
    .join("\n\n---\n\n");

  return [
    "下面是一份试题文档逐页视觉解析结果。",
    "请合并跨页题目，去重，并输出整份试题文档的结构化试题 JSON。",
    "",
    ...buildQuestionAcceptanceRuleLines(),
    "",
    "要求：",
    "- 保持题号顺序；",
    "- 合并跨页题目，不要重复；",
    "- 保留页面中已经给出的答案、参考答案、解析、解题过程；",
    "- 保留图形、表格、坐标轴、几何图等视觉信息的描述；",
    "- 对有图题保留 figures，并用 source_page 指向题图所在真实页面；",
    "- 严格保留逐页结果里的 figure/table id、source_page、bbox 和文本中的 [[figure:p1-fig-1]] 原位置占位符，不要重新编号，不要把 source_page 改成 1；",
    "- 区分题干图和解析图：题干图 role=stem、owner_path=stem；解析图 role=analysis、owner_path=analysis 或 sub_questions[n].analysis；不要把解析图合并到题干图列表里；",
    "- 保留小问结构 sub_questions，每个小问都要有 number、stem、answer、analysis；不要把 3 个小问压成一段普通文本；",
    "- 保留表格结构 tables，优先输出 columns/rows；表格出现在题干、解析或小问中时也要写 role 和 owner_path；",
    "- 校正 bbox 时只截视觉图形/表格本体，要完整包含图中字母、点名、线段、坐标轴标签和图1/图2等图号，四周留少量空白；不要把题干文字、解析文字或答案文字截入 bbox；",
    "- 如果图1、图2等子图并排或上下相邻，且中间没有题干、解析或答案正文隔开，应作为一个题图组截一个 bbox；figures 只保留一个组图对象，用 labels/subfigures 标明包含哪些子图，不要再为每个子图重复创建独立 figures；",
    "- 只有子图相距较远、被正文隔开、或属于不同小问/题干/解析区域时，才拆成多个 figures；",
    "- 对无法确认的内容写入 uncertain_notes，不要编造；",
    "- 只输出 JSON，不要输出 Markdown。",
    "",
    "JSON 格式：",
    "{",
    "  \"questions\": [",
    "    {",
    "      \"number\": \"1\",",
    "      \"type\": \"选择题/填空题/解答题/材料题/未知\",",
    "      \"stem\": \"题干文本；题干图使用 [[figure:p1-fig-1]] 标记原位置\",",
    "      \"options\": [\"A. ...\", \"B. ...；如果图在选项中，使用 [[figure:p1-fig-1]] 标记原位置\"],",
    "      \"sub_questions\": [",
    "        {",
    "          \"number\": \"1\",",
    "          \"stem\": \"小问题干\",",
    "          \"answer\": \"小问答案\",",
    "          \"analysis\": \"小问解析；解析图使用 [[figure:p2-fig-1]] 标记原位置\"",
    "        }",
    "      ],",
    "      \"answer_area\": \"答题区域说明\",",
    "      \"answer\": \"答案/参考答案；没有则为空字符串\",",
    "      \"analysis\": \"解析/解题过程；没有则为空字符串\",",
    "      \"figure_description\": \"图形/表格/图片材料描述\",",
    "      \"tables\": [",
    "        {",
    "          \"id\": \"p1-table-1\",",
    "          \"role\": \"stem\",",
    "          \"owner_path\": \"stem\",",
    "          \"source_page\": 1,",
    "          \"title\": \"表格标题或用途\",",
    "          \"columns\": [\"列1\", \"列2\"],",
    "          \"rows\": [[\"第1行第1列\", \"第1行第2列\"]],",
    "          \"bbox\": {",
    "            \"x\": 10,",
    "            \"y\": 20,",
    "            \"width\": 40,",
    "            \"height\": 15",
    "          }",
    "        }",
    "      ],",
    "      \"figures\": [",
    "        {",
    "          \"id\": \"p1-fig-1\",",
    "          \"role\": \"stem\",",
    "          \"owner_path\": \"stem\",",
    "          \"source_page\": 1,",
    "          \"description\": \"题干图，例如几何图、统计图、坐标轴\",",
    "          \"group_id\": \"p1-q1-figures\",",
    "          \"labels\": [\"图1\", \"图2\"],",
    "          \"subfigures\": [",
    "            {",
    "              \"label\": \"图1\",",
    "              \"description\": \"左侧子图描述\",",
    "              \"bbox\": { \"x\": 10, \"y\": 20, \"width\": 12, \"height\": 25 }",
    "            },",
    "            {",
    "              \"label\": \"图2\",",
    "              \"description\": \"右侧子图描述\",",
    "              \"bbox\": { \"x\": 26, \"y\": 20, \"width\": 12, \"height\": 25 }",
    "            }",
    "          ],",
    "          \"bbox\": {",
    "            \"x\": 10,",
    "            \"y\": 20,",
    "            \"width\": 30,",
    "            \"height\": 25",
    "          }",
    "        },",
    "        {",
    "          \"id\": \"p2-fig-1\",",
    "          \"role\": \"analysis\",",
    "          \"owner_path\": \"sub_questions[0].analysis\",",
    "          \"source_page\": 2,",
    "          \"description\": \"解析图，例如补全后的图形\",",
    "          \"bbox\": {",
    "            \"x\": 10,",
    "            \"y\": 20,",
    "            \"width\": 30,",
    "            \"height\": 25",
    "          }",
    "        }",
    "      ],",
    "      \"source_pages\": [1],",
    "      \"raw_text\": \"本题原始文本片段\"",
    "    }",
    "  ],",
    "  \"uncertain_notes\": []",
    "}",
    "",
    "bbox 使用页面宽高百分比，x/y 是左上角，width/height 是裁剪宽高；bbox 只截视觉图形/表格本体，要包含图中字母、点名、线段、坐标轴标签和图1/图2等图号，边缘留少量空白，不要包含题干、解析或答案正文。",
    "相邻图1/图2这类题图组的 bbox 应覆盖整个组图，包含各子图和图号；可在 subfigures 内记录每个子图的小 bbox，但不要把同一组图重复渲染为多张独立题图。",
    "",
    pageText
  ].join("\n");
}

export function parseQuestionsJson(text) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return {
      questions: [],
      error: "No JSON object found in model output."
    };
  }

  try {
    const parsed = JSON.parse(candidate);
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.map(normalizeQuestion).filter(isLikelyQuestion)
      : [];
    return {
      questions,
      error: null,
      raw: parsed
    };
  } catch (error) {
    return {
      questions: [],
      error: error.message
    };
  }
}

function buildQuestionAcceptanceRuleLines() {
  return [
    "试题最小准入标准：",
    "- 只有存在明确作答任务的内容才放入 questions，例如求值、计算、证明、选择、填空、回答、解答、补全、写出、判断、说明理由等；",
    "- 题号或“题型”标题本身不构成试题；材料题必须包含材料后的具体小问、作答要求或答案区，不能把单独的阅读材料/说明页当成题；",
    "- 题型讲解、知识点说明、方法总结、例题分类标题、课程推广、二维码/扫码页、广告图片、纯图片说明都不是试题，应忽略或写入 uncertain_notes；",
    "- 对边界不确定的内容宁可不放入 questions，不要为了连续题号而编造题目。"
  ];
}

function normalizeQuestion(question) {
  return normalizeQuestionLike(question, {
    defaultType: "未知",
    includeRaw: true
  });
}

function isLikelyQuestion(question) {
  if (!hasQuestionContent(question)) return false;
  if (hasNonQuestionInstructionSignal(question) && !hasActionableQuestionSignal(question)) return false;
  return true;
}

function hasQuestionContent(question) {
  return Boolean(
    question.stem?.trim()
    || question.options?.length
    || question.sub_questions?.length
    || question.answer_area?.trim()
    || question.answer?.trim()
    || question.analysis?.trim()
  );
}

function hasActionableQuestionSignal(question) {
  if (question.options?.length >= 2 || question.sub_questions?.length) return true;
  return ACTIONABLE_QUESTION_PATTERN.test(questionActionSearchText(question));
}

function hasNonQuestionInstructionSignal(question) {
  return NON_QUESTION_INSTRUCTION_PATTERN.test(questionSearchText(question));
}

function questionSearchText(question) {
  const parts = [
    question.type,
    question.stem,
    question.answer_area,
    question.answer,
    question.analysis,
    question.figure_description,
    question.raw_text,
    ...(question.options ?? [])
  ];
  for (const subQuestion of question.sub_questions ?? []) {
    parts.push(
      subQuestion.number,
      subQuestion.stem,
      subQuestion.answer,
      subQuestion.analysis
    );
  }
  for (const figure of question.figures ?? []) {
    parts.push(figure.description, ...(figure.labels ?? []));
  }
  return parts.filter(Boolean).join("\n");
}

function questionActionSearchText(question) {
  const parts = [
    question.stem,
    question.answer_area,
    question.answer,
    question.analysis,
    question.raw_text,
    ...(question.options ?? [])
  ];
  for (const subQuestion of question.sub_questions ?? []) {
    parts.push(
      subQuestion.stem,
      subQuestion.answer,
      subQuestion.analysis
    );
  }
  return parts
    .filter(Boolean)
    .join("\n")
    .replace(/(?:选择|填空|解答|判断|材料|计算|证明)题/g, "");
}

const ACTIONABLE_QUESTION_PATTERN = /(?<!要)求|计算|证明|选择|选出|填空|填写|回答|解答|完成|补全|写出|列出|判断|化简|解方程|作图|画出|说明理由|请说明|问[:：]|多少|哪(?:个|项|一项)|下列|正确|错误|_{2,}|____|（\s*）|\(\s*\)|\?|？/;
const NON_QUESTION_INSTRUCTION_PATTERN = /题型\s*[一二三四五六七八九十\d]+|题型讲解|知识点|方法总结|考点|技巧|口诀|扫码|二维码|公众号|课程|视频|讲解|例题|广告|LOOK AT ME|看成一个整体|插空法|捆绑法/i;

function extractJsonCandidate(text) {
  const value = String(text ?? "").trim();
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return value.slice(start, end + 1);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function normalizePageArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function normalizeAnalysis(question) {
  const value = question.analysis ?? question.explanation ?? question.solution ?? question.answer_analysis;
  return value == null ? undefined : String(value);
}

function normalizeQuestionLike(question, { defaultType, includeRaw } = {}) {
  const normalized = omitUndefined({
    number: question.number == null ? "" : String(question.number),
    type: question.type == null ? defaultType : String(question.type),
    stem: question.stem == null ? "" : String(question.stem),
    options: normalizeStringArray(question.options),
    sub_questions: normalizeSubQuestions(question.sub_questions),
    answer_area: question.answer_area == null ? undefined : String(question.answer_area),
    answer: question.answer == null ? undefined : String(question.answer),
    analysis: normalizeAnalysis(question),
    source_pages: normalizePageArray(question.source_pages),
    related_knowledge_points: normalizeRelatedKnowledgePoints(
      question.related_knowledge_points
        ?? question.relatedKnowledgePoints
        ?? question.knowledge_points
        ?? question.knowledgePoints
    ),
    figure_description: question.figure_description == null ? undefined : String(question.figure_description),
    tables: normalizeTables(question.tables),
    figures: normalizeFigures(question.figures),
    raw_text: question.raw_text == null ? undefined : String(question.raw_text),
    raw: includeRaw ? question : undefined
  });
  return normalized;
}

function normalizeSubQuestions(value) {
  if (!Array.isArray(value)) return undefined;
  const subQuestions = value
    .filter((item) => item && typeof item === "object")
    .map((item) => normalizeQuestionLike(item, { includeRaw: false }));
  return subQuestions.length ? subQuestions : undefined;
}

function normalizeRelatedKnowledgePoints(value) {
  if (!Array.isArray(value)) return undefined;
  const points = value
    .map((point) => {
      if (typeof point === "string") {
        const name = point.trim();
        return name ? { name } : null;
      }
      if (!point || typeof point !== "object") return null;
      const normalized = omitUndefined({
        id: point.id == null ? undefined : String(point.id),
        name: point.name == null ? undefined : String(point.name),
        chapter: point.chapter == null && point.chapter_title == null && point.chapterTitle == null
          ? undefined
          : String(point.chapter ?? point.chapter_title ?? point.chapterTitle),
        section: point.section == null && point.section_title == null && point.sectionTitle == null
          ? undefined
          : String(point.section ?? point.section_title ?? point.sectionTitle),
        confidence: numberOrUndefined(point.confidence),
        reason: point.reason == null ? undefined : String(point.reason)
      });
      return Object.keys(normalized).length > 0 ? normalized : null;
    })
    .filter(Boolean);
  return points.length ? points : undefined;
}

function normalizeTables(value) {
  if (!Array.isArray(value)) return undefined;
  const tables = value
    .map((table) => {
      if (!table || typeof table !== "object") return null;
      const columns = normalizeTableColumns(table);
      const rows = normalizeTableRows(table.rows ?? table.body ?? table.cells, columns);
      const normalized = omitUndefined({
        id: table.id == null ? undefined : String(table.id),
        role: normalizeRole(table.role ?? table.kind ?? table.placement),
        owner_path: table.owner_path == null && table.ownerPath == null ? undefined : String(table.owner_path ?? table.ownerPath),
        source_page: numberOrUndefined(table.source_page ?? table.sourcePage ?? table.page_number ?? table.page),
        title: table.title == null && table.caption == null ? undefined : String(table.title ?? table.caption),
        columns: columns.length ? columns : undefined,
        rows: rows.length ? rows : undefined,
        description: table.description == null ? undefined : String(table.description),
        bbox: normalizeFigureBox(table.bbox ?? table.bounding_box ?? table.boundingBox)
      });
      return Object.keys(normalized).length > 0 ? normalized : null;
    })
    .filter(Boolean);
  return tables.length ? tables : undefined;
}

function normalizeTableColumns(table) {
  const value = table.columns ?? table.headers ?? table.header;
  if (Array.isArray(value)) return value.map((item) => String(item));
  const rows = table.rows ?? table.body ?? table.cells;
  if (!Array.isArray(rows) || !rows.length || !rows[0] || Array.isArray(rows[0]) || typeof rows[0] !== "object") return [];
  return Object.keys(rows[0]);
}

function normalizeTableRows(value, columns) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    if (Array.isArray(row)) return row.map((cell) => String(cell ?? ""));
    if (row && typeof row === "object") {
      const keys = columns.length ? columns : Object.keys(row);
      return keys.map((key) => String(row[key] ?? ""));
    }
    return [String(row ?? "")];
  });
}

function normalizeRole(value) {
  return value == null ? undefined : String(value);
}

function normalizeFigures(value) {
  if (!Array.isArray(value)) return undefined;
  const figures = value
    .map((figure) => {
      if (!figure || typeof figure !== "object") return null;
      return omitUndefined({
        id: figure.id == null ? undefined : String(figure.id),
        group_id: figure.group_id == null && figure.groupId == null ? undefined : String(figure.group_id ?? figure.groupId),
        role: normalizeRole(figure.role ?? figure.kind ?? figure.placement),
        owner_path: figure.owner_path == null && figure.ownerPath == null ? undefined : String(figure.owner_path ?? figure.ownerPath),
        source_page: numberOrUndefined(figure.source_page ?? figure.sourcePage ?? figure.page_number ?? figure.page),
        description: figure.description == null ? undefined : String(figure.description),
        label: figure.label == null ? undefined : String(figure.label),
        labels: normalizeFigureLabels(figure.labels ?? figure.label_list ?? figure.labelList),
        subfigures: normalizeSubfigures(figure.subfigures ?? figure.sub_figures ?? figure.subFigures),
        bbox: normalizeFigureBox(figure.bbox ?? figure.bounding_box ?? figure.boundingBox)
      });
    })
    .filter((figure) => figure && Object.keys(figure).length > 0);
  return figures.length ? figures : undefined;
}

function normalizeFigureLabels(value) {
  if (Array.isArray(value)) {
    const labels = value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    return labels.length ? labels : undefined;
  }
  if (value == null) return undefined;
  const labels = String(value)
    .split(/[，,、;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return labels.length ? labels : undefined;
}

function normalizeSubfigures(value) {
  if (!Array.isArray(value)) return undefined;
  const subfigures = value
    .map((subfigure) => {
      if (!subfigure || typeof subfigure !== "object") return null;
      const normalized = omitUndefined({
        id: subfigure.id == null ? undefined : String(subfigure.id),
        label: subfigure.label == null ? undefined : String(subfigure.label),
        description: subfigure.description == null ? undefined : String(subfigure.description),
        bbox: normalizeFigureBox(subfigure.bbox ?? subfigure.bounding_box ?? subfigure.boundingBox)
      });
      return Object.keys(normalized).length > 0 ? normalized : null;
    })
    .filter(Boolean);
  return subfigures.length ? subfigures : undefined;
}

function numberOrUndefined(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeFigureBox(value) {
  if (!value || typeof value !== "object") return undefined;
  const box = omitUndefined({
    x: numberOrUndefined(value.x ?? value.left),
    y: numberOrUndefined(value.y ?? value.top),
    width: numberOrUndefined(value.width ?? value.w),
    height: numberOrUndefined(value.height ?? value.h)
  });
  return ["x", "y", "width", "height"].every((key) => Number.isFinite(box[key])) ? box : undefined;
}

function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined));
}
