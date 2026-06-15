/**
 * F3 后台 runParse。admin 只负责文件读取、任务状态、进度映射和 DB 落库；
 * LLM 解析统一委托 @hao/llm 的 analyzeQuestions 公共入口。
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Prisma, prisma } from '@hao/db';
import { createStore, extOf } from '@hao/storage';
import {
  analysisFileTypeFromName,
  knowledgeRowsForQuestionContext,
  questionToStagingPayload,
  tokenUsageFromEducationUsage,
  tokenUsageTotal,
} from './education-analysis-adapter';
import {
  documentAnalysisProtocolLabel,
  getLlmProviderById,
  isDocumentAnalysisProvider,
} from './llm-providers';
import { type QuestionProgressSnapshot, runQuestionAnalysis } from './question-pipeline';

const jobWriteQueues = new Map<string, Promise<void>>();
function enqueueJobWrite(jobId: string, work: () => Promise<void>): Promise<void> {
  const prev = jobWriteQueues.get(jobId) ?? Promise.resolve();
  const next = prev.then(work, work);
  jobWriteQueues.set(jobId, next);
  return next;
}

async function patchProgress(jobId: string, snap: QuestionProgressSnapshot): Promise<void> {
  return enqueueJobWrite(jobId, async () => {
    await prisma.llm_parse_job.update({
      where: { id: jobId },
      data: { raw_response: { progress: snap } as unknown as Prisma.InputJsonValue },
    });
  });
}

export async function runQuestionParse(
  jobId: string,
  uploadId: string,
  providerId: string,
  subjectId: string,
): Promise<void> {
  const store = createStore();
  let tmpPath: string | null = null;

  try {
    const upload = await prisma.content_upload.findUnique({ where: { id: uploadId } });
    if (!upload) throw new Error('content_upload 不存在');
    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new Error(`subject ${subjectId} 不存在`);
    const provider = await getLlmProviderById(providerId);
    if (!provider) throw new Error(`llm_provider ${providerId} 不存在`);
    if (!provider.enabled) throw new Error(`llm_provider ${providerId} 已禁用`);
    if (!isDocumentAnalysisProvider(provider)) {
      throw new Error(`试题解析只支持 ${documentAnalysisProtocolLabel()} 的 Provider；当前 ${provider.id}`);
    }

    await prisma.llm_parse_job.update({
      where: { id: jobId },
      data: {
        status: 'running',
        raw_response: {
          progress: {
            phase: 'preparing',
            startedAt: new Date().toISOString(),
            lastEventAt: new Date().toISOString(),
            pagesDone: 0,
            pagesFailed: 0,
            tokenUsageSoFar: null,
            lastEvent: 'started analyzeQuestions',
          } satisfies QuestionProgressSnapshot,
        } as Prisma.InputJsonValue,
      },
    });

    const buf = await store.get(upload.file_uri);
    const tmpDir = path.join(tmpdir(), 'hao-admin-question-parse');
    await mkdir(tmpDir, { recursive: true });
    const originalName = upload.original_name ?? `${jobId}.pdf`;
    tmpPath = path.join(tmpDir, `${jobId}${extOf(originalName) || '.pdf'}`);
    await writeFile(tmpPath, buf);

    const existingKps = await prisma.knowledge_point.findMany({
      where: { subject_id: subjectId },
      select: { id: true, name: true, chapter_no: true },
      orderBy: [{ chapter_no: 'asc' }, { name: 'asc' }],
    });

    const result = await runQuestionAnalysis({
      providerId,
      file: {
        type: analysisFileTypeFromName(originalName),
        name: originalName,
        path: tmpPath,
        mimeType: upload.file_type,
      },
      subject,
      knowledge: knowledgeRowsForQuestionContext(existingKps),
      onProgress: (snap) => {
        void patchProgress(jobId, snap).catch((e) =>
          console.warn(`[analyzeQuestions job=${jobId}] progress patch fail:`, e),
        );
      },
    });

    const tokenUsage = tokenUsageFromEducationUsage(result.usage);
    const tokenUsageForDb = tokenUsageTotal(tokenUsage);
    const stagingPayloads = result.questions.map((question) =>
      questionToStagingPayload(question, subjectId),
    );

    await prisma.$transaction([
      prisma.llm_parse_staging.createMany({
        data: stagingPayloads.map((payload) => ({
          parse_job_id: jobId,
          upload_id: uploadId,
          entity_kind: 'question' as const,
          llm_payload: payload as unknown as Prisma.InputJsonValue,
        })),
      }),
      prisma.llm_parse_job.update({
        where: { id: jobId },
        data: {
          status: 'succeeded',
          request_payload: {
            entry: 'analyzeQuestions',
            file_type: analysisFileTypeFromName(originalName),
            knowledge_count: existingKps.length,
          } as Prisma.InputJsonValue,
          raw_response: {
            status: result.status,
            diagnostics: result.diagnostics,
            pageCount: result.source.page_count,
            questionCount: result.questions.length,
            llm: result.llm,
          } as unknown as Prisma.InputJsonValue,
          parsed_output: { questions: result.questions } as unknown as Prisma.InputJsonValue,
          token_usage: tokenUsageForDb
            ? (tokenUsageForDb as Prisma.InputJsonValue)
            : (Prisma.JsonNull as unknown as Prisma.InputJsonValue),
          latency_ms: typeof result.latency_ms === 'number' ? result.latency_ms : null,
          finished_at: new Date(),
          error_message: result.status === 'ok' ? null : (result.diagnostics?.parse_error ?? null),
        },
      }),
      prisma.content_upload.update({
        where: { id: uploadId },
        data: { status: 'parsed' },
      }),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[question runParse job=${jobId}] FAILED:`, msg);
    try {
      await prisma.llm_parse_job.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error_message: msg.slice(0, 500),
          finished_at: new Date(),
          raw_response: {
            progress: {
              phase: 'failed',
              startedAt: new Date().toISOString(),
              lastEventAt: new Date().toISOString(),
              pagesDone: 0,
              pagesFailed: 0,
              tokenUsageSoFar: null,
              lastEvent: msg.slice(0, 200),
              errorMessage: msg.slice(0, 500),
            } satisfies QuestionProgressSnapshot,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (patchErr) {
      console.error(`[question runParse job=${jobId}] failed-patch error:`, patchErr);
    }
  } finally {
    if (tmpPath) {
      await rm(tmpPath, { force: true }).catch(() => {});
    }
  }
}
