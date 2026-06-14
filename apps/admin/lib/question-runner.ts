/**
 * F3 后台 runParse —— 不要放在 server action 文件里（'use server' 模块的导出会被
 * Next 当成 client-callable action 注册）。这里是纯服务端 lib，仅由 server action
 * 内部 import + fire-and-forget 调用。
 *
 * 形态对照 apps/admin/app/admin/kps/import/actions.ts 中的 runParse；差别只是产物是
 * question staging（一行一题）+ 进度模型用 QuestionProgressSnapshot。
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Prisma, prisma } from '@hao/db';
import { redactAuthHeaders } from '@hao/llm';
import { createStore } from '@hao/storage';
import {
  QUESTION_PROMPT_VERSION,
  type QuestionProgressSnapshot,
  runQuestionAnalysis,
} from './question-pipeline';

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

/**
 * jobId 已预创建为 status='queued'；本函数把它推到 running → succeeded/failed。
 * 不抛错。
 */
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
    const provider = await prisma.llm_provider.findUnique({ where: { id: providerId } });
    if (!provider) throw new Error(`llm_provider ${providerId} 不存在`);
    if (!provider.enabled) throw new Error(`llm_provider ${providerId} 已禁用`);

    const caps = (provider.capabilities ?? {}) as { vision?: boolean };
    if (!caps.vision) {
      throw new Error(
        `Provider ${providerId} 不支持 vision（capabilities.vision=true 必需）；请改选 webex-gemini-3.1-pro 等视觉 provider`,
      );
    }
    if (!upload.sha256) {
      throw new Error(`content_upload ${uploadId} 缺 sha256，无法走 L2 流水线`);
    }

    await prisma.llm_parse_job.update({
      where: { id: jobId },
      data: {
        status: 'running',
        raw_response: {
          progress: {
            phase: 'rasterizing',
            startedAt: new Date().toISOString(),
            lastEventAt: new Date().toISOString(),
            chunksDone: 0,
            chunksFailed: 0,
            tokenUsageSoFar: null,
            lastEvent: 'started',
          } satisfies QuestionProgressSnapshot,
        } as Prisma.InputJsonValue,
      },
    });

    // pdftoppm 要本地路径 → 把 storage 里的 PDF 拷到 OS tmp
    const buf = await store.get(upload.file_uri);
    const tmpDir = path.join(tmpdir(), 'hao-admin-question-parse');
    await mkdir(tmpDir, { recursive: true });
    tmpPath = path.join(tmpDir, `${jobId}.pdf`);
    await writeFile(tmpPath, buf);

    // 同学科已有 KP 字典 → 拼进 chunk prompt 让 LLM 优先复用字面量，省去 admin 抽屉里搜映射。
    // 见 lib/question-pipeline.ts 顶部 QuestionPipelineOptions.kpDictionary 注释。
    //
    // ⚠️ 暂时禁用字典注入：实测 1235 条 KP（math_senior 当前规模）截到 500 条后仍然
    // 把 prompt 撑到 ~6KB 文本 + 3 页图，Webex Gemini 反过来把输出压到 100-200 字符
    // 截断（每片只吐一道题的题干前半段就停）—— 字典本意是辅助，结果让整管线 0 questions。
    // 等总控把 packages/llm 加上 RAG 式按页面相关性 retrieve top-K KP 字典再开。
    const kpDictionary: string[] = [];

    // prompt_version 加 `+kpdict-${count}` 后缀，方便 F7.1 审计区分"是否注入了字典 / 字典多大"。
    // 重抽 / A-B 对比时一眼知道这次跑的 prompt 实际形态。
    if (kpDictionary.length > 0) {
      await prisma.llm_parse_job.update({
        where: { id: jobId },
        data: { prompt_version: `${QUESTION_PROMPT_VERSION}+kpdict-${kpDictionary.length}` },
      });
    }

    const result = await runQuestionAnalysis({
      jobId,
      providerId,
      pdfPath: tmpPath,
      sourceSha256: upload.sha256,
      store,
      subject,
      subjectName: subject.name,
      kpDictionary,
      onProgress: (snap) => {
        void patchProgress(jobId, snap).catch((e) =>
          console.warn(`[question-pipeline job=${jobId}] progress patch fail:`, e),
        );
      },
    });

    await prisma.$transaction([
      prisma.llm_parse_staging.createMany({
        data: result.questions.map((question) => ({
          parse_job_id: jobId,
          upload_id: uploadId,
          entity_kind: 'question' as const,
          llm_payload: {
            content: question.content,
            question_type: question.question_type,
            options: question.options,
            answer: question.answer,
            solution_text: question.solution_text,
            difficulty: question.difficulty,
            kp_hints: question.kp_hints,
            // _src_page / question_no 来自 extractQuestionsFromPdf 的内部字段（默认 chunk prompt 强制 LLM 自报）
            source_hint: {
              page: question._src_page ?? null,
              question_no: question.question_no ?? null,
            },
            figures: question.figures ?? [],
            _subject_id: subjectId,
          } as unknown as Prisma.InputJsonValue,
        })),
      }),
      prisma.llm_parse_job.update({
        where: { id: jobId },
        data: {
          status: 'succeeded',
          request_payload: redactAuthHeaders({
            note: 'L2 extractQuestionsFromPdf；representative payload 见 packages/llm vision 层日志',
          }) as Prisma.InputJsonValue,
          raw_response: {
            pageCount: result.pageCount,
            questionCount: result.questions.length,
            derivedAssetCount: result.derivedAssets.length,
            chunks: result.chunks,
            boundaryRefetches: result.boundaryRefetches,
            dedup: result.dedup,
          } as Prisma.InputJsonValue,
          parsed_output: { questions: result.questions } as unknown as Prisma.InputJsonValue,
          token_usage: {
            input: result.totalTokenUsage.input,
            output: result.totalTokenUsage.output,
            total: result.totalTokenUsage.input + result.totalTokenUsage.output,
          } as Prisma.InputJsonValue,
          finished_at: new Date(),
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
              chunksDone: 0,
              chunksFailed: 0,
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
