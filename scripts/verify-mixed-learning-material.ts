import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EducationAnalysisFile, LearningResourceAnalysisParserResult } from '@hao/llm';

const DEFAULT_SAMPLE_FILE =
  '/Users/huyin/Documents/Swingboat/HaoHaoStudy/高中/数学/辅导资料/高途/2024年01-秋季/【打印版PPT】第1讲《集合与逻辑重点题型全梳理》.pdf';
const DEFAULT_OUTPUT_DIR = 'results/mixed-learning-material/gotour-lesson-1';
const DEFAULT_PROVIDER_ID = 'openai-chat-gemini-3.5-flash';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type CliArgs = Record<string, string | boolean>;

interface VerificationOptions {
  filePath: string;
  subjectName: string;
  providerId?: string;
  targetId?: string;
  targetConfigPath?: string;
  apiKeyEnv: string;
  envFilePath?: string;
  outputDir: string;
  pageImageOutputDir: string;
  payloadLogPath: string;
  payloadLogLimit?: number;
  renderDpi?: number;
  concurrency?: number;
  maxRetries?: number;
  maxPageTokens?: number;
  maxFinalTokens?: number;
  loadEnv: boolean;
}

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface VerificationReport {
  sample_file: string;
  provider_id: string | null;
  target_id: string | null;
  target_config_path: string | null;
  result_path: string;
  payload_log_path: string;
  source_type: string;
  title: string;
  counts: {
    knowledge_threads: number;
    learning_materials: number;
    questions: number;
    unmapped_items: number;
  };
  material_types: string[];
  fallback_used: string | null;
  parse_error: unknown;
  validation_error: unknown;
  checks: CheckResult[];
  ok: boolean;
}

interface SchemaSafeParser {
  safeParse(value: unknown):
    | { success: true }
    | {
        success: false;
        error: { issues: unknown };
      };
}

let prismaClient: { $disconnect(): Promise<void> } | undefined;

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelp();
    return;
  }

  const options = resolveOptions(args);
  if (options.loadEnv) {
    await loadDotEnv(path.join(REPO_ROOT, '.env'));
    if (options.envFilePath) {
      await loadDotEnv(options.envFilePath);
    }
  }

  await access(options.filePath);
  await mkdir(options.outputDir, { recursive: true });
  await mkdir(options.pageImageOutputDir, { recursive: true });

  const { analyzeLearningResource, learningResourceAnalysisBatchSchema } = await import('@hao/llm');
  const { prisma } = await import('@hao/db');
  prismaClient = prisma;

  const file = buildSourceFile(options.filePath);
  const llmRequestOptions = await resolveLlmRequestOptions(options);
  const result = await analyzeLearningResource({
    file,
    ...llmRequestOptions,
    subjectName: options.subjectName,
    pageImageOutputDir: options.pageImageOutputDir,
    payloadLogPath: options.payloadLogPath,
    payloadLogLimit: options.payloadLogLimit,
    renderDpi: options.renderDpi,
    concurrency: options.concurrency,
    maxRetries: options.maxRetries,
    maxPageTokens: options.maxPageTokens,
    maxFinalTokens: options.maxFinalTokens,
  });

  const resultPath = path.join(options.outputDir, 'learning-resource-result.json');
  const reportPath = path.join(options.outputDir, 'learning-resource-report.json');
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  const report = buildVerificationReport({
    result,
    sampleFile: options.filePath,
    providerId: options.providerId,
    targetId: options.targetId,
    targetConfigPath: options.targetConfigPath,
    resultPath,
    payloadLogPath: options.payloadLogPath,
    schema: learningResourceAnalysisBatchSchema,
  });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.info(
    JSON.stringify(
      {
        ok: report.ok,
        provider_id: report.provider_id,
        target_id: report.target_id,
        result_path: resultPath,
        report_path: reportPath,
        payload_log_path: options.payloadLogPath,
        counts: report.counts,
        material_types: report.material_types,
        fallback_used: report.fallback_used,
        failed_checks: report.checks.filter((check) => !check.passed),
      },
      null,
      2,
    ),
  );

  if (!report.ok) {
    process.exitCode = 1;
  }
}

function resolveOptions(args: CliArgs): VerificationOptions {
  const outputDir = resolveRepoPath(stringArg(args, 'output-dir') ?? DEFAULT_OUTPUT_DIR);
  return {
    filePath: resolveRepoPath(stringArg(args, 'file') ?? DEFAULT_SAMPLE_FILE),
    subjectName: stringArg(args, 'subject-name') ?? '高中数学',
    providerId:
      stringArg(args, 'provider-id') ??
      (stringArg(args, 'target-id') ? undefined : DEFAULT_PROVIDER_ID),
    targetId: stringArg(args, 'target-id'),
    targetConfigPath: stringArg(args, 'target-config')
      ? resolveRepoPath(stringArg(args, 'target-config') ?? '')
      : undefined,
    apiKeyEnv: stringArg(args, 'api-key-env') ?? 'LLM_PROXY_API_KEY',
    envFilePath: stringArg(args, 'env-file')
      ? resolveRepoPath(stringArg(args, 'env-file') ?? '')
      : undefined,
    outputDir,
    pageImageOutputDir: resolveRepoPath(
      stringArg(args, 'page-image-output-dir') ?? path.join(outputDir, 'page-images'),
    ),
    payloadLogPath: resolveRepoPath(
      stringArg(args, 'payload-log-path') ?? path.join(outputDir, 'payload-log.ndjson'),
    ),
    payloadLogLimit: optionalNumberArg(args, 'payload-log-limit'),
    renderDpi: optionalNumberArg(args, 'render-dpi'),
    concurrency: optionalNumberArg(args, 'concurrency'),
    maxRetries: optionalNumberArg(args, 'max-retries'),
    maxPageTokens: optionalNumberArg(args, 'max-page-tokens'),
    maxFinalTokens: optionalNumberArg(args, 'max-final-tokens'),
    loadEnv: args['skip-env'] !== true,
  };
}

function resolveRepoPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(REPO_ROOT, value);
}

async function resolveLlmRequestOptions(
  options: VerificationOptions,
): Promise<Record<string, unknown>> {
  if (!options.targetId) {
    if (!options.providerId) throw new Error('providerId or targetId is required');
    return { providerId: options.providerId };
  }

  if (!options.targetConfigPath) {
    throw new Error('--target-config is required when --target-id is provided');
  }

  const apiKey = process.env[options.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`env var ${options.apiKeyEnv} not set; required by target ${options.targetId}`);
  }

  return {
    llmConfig: await readJsonObject(options.targetConfigPath),
    llmTargetId: options.targetId,
    apiKey,
  };
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object in ${filePath}`);
  }
  return parsed as Record<string, unknown>;
}

function buildVerificationReport({
  result,
  sampleFile,
  providerId,
  targetId,
  targetConfigPath,
  resultPath,
  payloadLogPath,
  schema,
}: {
  result: LearningResourceAnalysisParserResult;
  sampleFile: string;
  providerId?: string;
  targetId?: string;
  targetConfigPath?: string;
  resultPath: string;
  payloadLogPath: string;
  schema: SchemaSafeParser;
}): VerificationReport {
  const schemaResult = schema.safeParse(result);
  const haystack = searchableText(result);
  const learningMaterials = flattenLearningMaterialsFromKnowledgeThreads(result.knowledge_threads);
  const questions = flattenQuestionsFromKnowledgeThreads(result.knowledge_threads);
  const materialTypes = uniqueSorted(learningMaterials.map((item) => item.material_type));
  const sourceType = result.source_document.source_type;
  const title = result.source_document.title;
  const missingAnswerViolations = questions.filter(
    (question) => question.quality_status === 'missing_answer' && question.answer !== '',
  );
  const missingSolutionViolations = questions.filter(
    (question) => question.quality_status === 'missing_solution' && question.solution_text !== '',
  );
  const materialSourceRefViolations = learningMaterials.filter(
    (item) => !Number.isInteger(item.source_ref.page) || item.source_ref.page < 1,
  );
  const questionSourceRefViolations = questions.filter(
    (question) => !Number.isInteger(question.source_ref.page) || question.source_ref.page < 1,
  );

  const checks: CheckResult[] = [
    {
      name: 'zod_schema',
      passed: schemaResult.success,
      detail: schemaResult.success ? 'schema ok' : JSON.stringify(schemaResult.error.issues),
    },
    {
      name: 'source_type',
      passed: ['lesson_handout', 'mixed_material'].includes(sourceType),
      detail: sourceType,
    },
    {
      name: 'title',
      passed: title.includes('集合与逻辑重点题型全梳理'),
      detail: title,
    },
    {
      name: 'learning_material_count',
      passed: learningMaterials.length >= 8,
      detail: String(learningMaterials.length),
    },
    {
      name: 'required_material_types',
      passed: ['method_card', 'common_mistake', 'question_type_summary'].every((type) =>
        materialTypes.includes(type),
      ),
      detail: materialTypes.join(', '),
    },
    {
      name: 'source_ref_page',
      passed: materialSourceRefViolations.length === 0 && questionSourceRefViolations.length === 0,
      detail: `learning_materials=${materialSourceRefViolations.length}; questions=${questionSourceRefViolations.length}`,
    },
    {
      name: 'missing_answer_empty',
      passed: missingAnswerViolations.length === 0,
      detail: String(missingAnswerViolations.length),
    },
    {
      name: 'missing_solution_empty',
      passed: missingSolutionViolations.length === 0,
      detail: String(missingSolutionViolations.length),
    },
    {
      name: 'content_param_back_substitution_distinctness',
      passed: includesAll(haystack, ['回代']) && includesAny(haystack, ['互异', '互异性']),
      detail: 'expects 回代 + 互异性',
    },
    {
      name: 'content_subset_relation_parameter',
      passed:
        includesAny(haystack, ['子集关系', '包含关系', 'A⊆', 'B⊆', '⊆']) &&
        includesAny(haystack, ['求参', '参数']),
      detail: 'expects 子集关系/包含关系 + 求参/参数',
    },
    {
      name: 'content_set_operation_parameter',
      passed:
        includesAny(haystack, ['集合运算', '交集', '并集', '补集']) &&
        includesAny(haystack, ['求参', '参数']),
      detail: 'expects 集合运算/交并补 + 求参/参数',
    },
    {
      name: 'content_subset_count_formula',
      passed: includesAny(haystack, ['子集个数', '真子集个数', '2^n', '2 的 n 次']),
      detail: 'expects 子集个数公式',
    },
    {
      name: 'content_empty_set_case_discussion',
      passed:
        includesAny(haystack, ['空集', '∅']) &&
        includesAny(haystack, ['分类讨论', '分情况', '讨论']),
      detail: 'expects 空集 + 分类讨论',
    },
  ];

  return {
    sample_file: sampleFile,
    provider_id: providerId ?? null,
    target_id: targetId ?? null,
    target_config_path: targetConfigPath ?? null,
    result_path: resultPath,
    payload_log_path: payloadLogPath,
    source_type: sourceType,
    title,
    counts: {
      knowledge_threads: result.knowledge_threads.length,
      learning_materials: learningMaterials.length,
      questions: questions.length,
      unmapped_items: result.unmapped_items.length,
    },
    material_types: materialTypes,
    fallback_used:
      typeof result.diagnostics.fallback_used === 'string'
        ? result.diagnostics.fallback_used
        : null,
    parse_error: result.diagnostics.parse_error ?? null,
    validation_error: result.diagnostics.validation_error ?? null,
    checks,
    ok: checks.every((check) => check.passed),
  };
}

function buildSourceFile(filePath: string): EducationAnalysisFile {
  const extension = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);

  if (extension === '.pdf') {
    return { type: 'pdf', name, path: filePath, mimeType: 'application/pdf' };
  }
  if (extension === '.docx') {
    return {
      type: 'word',
      name,
      path: filePath,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  if (extension === '.doc') {
    return { type: 'word', name, path: filePath, mimeType: 'application/msword' };
  }
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    const imageSubtype = extension === '.jpg' ? 'jpeg' : extension.slice(1);
    return { type: 'image', name, path: filePath, mimeType: `image/${imageSubtype}` };
  }

  throw new Error(`Unsupported sample file type: ${extension || '(none)'}`);
}

const MATERIAL_THREAD_GROUPS = [
  ['method_card', 'method_cards'],
  ['common_mistake', 'common_mistakes'],
  ['question_type_summary', 'question_type_summaries'],
  ['exam_trend', 'exam_trends'],
  ['textbook_deep_dive', 'textbook_deep_dives'],
  ['solution_summary', 'solution_summaries'],
  ['concept_explanation', 'concept_explanations'],
  ['study_advice', 'study_advice'],
] as const;

function flattenLearningMaterialsFromKnowledgeThreads(
  threads: LearningResourceAnalysisParserResult['knowledge_threads'],
) {
  return threads.flatMap((thread) =>
    MATERIAL_THREAD_GROUPS.flatMap(([materialType, key]) =>
      thread[key].map((item) => ({
        ...item,
        material_type: materialType,
      })),
    ),
  );
}

function flattenQuestionsFromKnowledgeThreads(
  threads: LearningResourceAnalysisParserResult['knowledge_threads'],
) {
  return threads.flatMap((thread) => thread.questions);
}

function searchableText(result: LearningResourceAnalysisParserResult): string {
  const learningMaterials = flattenLearningMaterialsFromKnowledgeThreads(result.knowledge_threads);
  const questions = flattenQuestionsFromKnowledgeThreads(result.knowledge_threads);

  return [
    result.source_document.title,
    result.source_document.exam_name,
    result.source_document.paper_name,
    ...result.knowledge_threads.flatMap((thread) => [
      thread.knowledge_point.name,
      thread.knowledge_point.brief,
      ...thread.source_refs.map((sourceRef) => sourceRef.text_snippet ?? ''),
    ]),
    ...learningMaterials.flatMap((item) => [
      item.title,
      item.content,
      item.student_summary ?? '',
      item.kp_hints?.join(' ') ?? '',
      item.source_ref.text_snippet ?? '',
    ]),
    ...questions.flatMap((question) => [
      question.content,
      question.answer,
      question.solution_text,
      question.kp_hints?.join(' ') ?? '',
      question.source_ref.text_snippet ?? '',
    ]),
    ...result.unmapped_items.flatMap((item) => [
      item.title,
      item.content,
      item.suggested_kp_hints.join(' '),
      item.source_ref.text_snippet ?? '',
    ]),
  ].join('\n');
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) continue;

    const normalized = token.slice(2);
    const equalsIndex = normalized.indexOf('=');
    if (equalsIndex >= 0) {
      args[normalized.slice(0, equalsIndex)] = normalized.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[normalized] = next;
      index += 1;
    } else {
      args[normalized] = true;
    }
  }
  return args;
}

function stringArg(args: CliArgs, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function optionalNumberArg(args: CliArgs, name: string): number | undefined {
  const value = stringArg(args, name);
  if (!value) return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric argument --${name}: ${value}`);
  }
  return parsed;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function includesAll(text: string, needles: string[]): boolean {
  return needles.every((needle) => text.includes(needle));
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

async function loadDotEnv(envPath: string): Promise<void> {
  try {
    const text = await readFile(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex <= 0) continue;

      const key = trimmed.slice(0, equalsIndex).trim();
      const rawValue = trimmed.slice(equalsIndex + 1).trim();
      if (!key || process.env[key]) continue;

      process.env[key] = stripEnvQuotes(rawValue);
    }
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
}

function stripEnvQuotes(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function printHelp(): void {
  console.info(`
Usage:
  pnpm llm:verify-learning-resource [options]

Runs @hao/llm analyzeLearningResource and validates knowledge-thread output.

Options:
  --file <path>                    sample PDF/Word/image path
  --subject-name <name>            subject name, default: 高中数学
  --provider-id <id>               llm_provider id, default: ${DEFAULT_PROVIDER_ID}
  --target-config <path>           direct target config JSON path
  --target-id <id>                 direct target id from --target-config
  --api-key-env <name>             API key env for direct target, default: LLM_PROXY_API_KEY
  --env-file <path>                extra env file loaded after repo .env
  --output-dir <path>              output directory, default: ${DEFAULT_OUTPUT_DIR}
  --page-image-output-dir <path>   rendered page image directory
  --payload-log-path <path>        LLM payload NDJSON path
  --payload-log-limit <number>     maximum payloads written by lower layer
  --render-dpi <number>            PDF render DPI
  --concurrency <number>           page-level LLM concurrency
  --max-retries <number>           page-level retry count
  --max-page-tokens <number>       page call token budget
  --max-final-tokens <number>      final synthesis token budget
  --skip-env                       do not load .env automatically
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient?.$disconnect();
  });
