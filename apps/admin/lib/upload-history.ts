import { prisma } from '@hao/db';
import { createStore } from '@hao/storage';
import {
  type UploadHistoryDeletePlan,
  type UploadHistoryPurpose,
  buildUploadHistoryDeletePlan,
} from './upload-history-plan.ts';

export async function deleteUploadHistory(
  uploadId: string,
  expectedPurpose: UploadHistoryPurpose,
): Promise<UploadHistoryDeletePlan> {
  const upload = await prisma.content_upload.findUnique({
    where: { id: uploadId },
    select: { id: true, file_uri: true, purpose: true },
  });
  const remainingFileReferenceCount = upload
    ? await prisma.content_upload.count({
        where: { file_uri: upload.file_uri, id: { not: upload.id } },
      })
    : 0;
  const plan = buildUploadHistoryDeletePlan(upload, expectedPurpose, remainingFileReferenceCount);
  if (!plan.ok) return plan;

  await prisma.$transaction([
    prisma.llm_parse_staging.deleteMany({ where: { upload_id: plan.uploadId } }),
    prisma.llm_parse_job.deleteMany({ where: { upload_id: plan.uploadId } }),
    prisma.content_upload.delete({ where: { id: plan.uploadId } }),
  ]);

  if (plan.deleteStorageObject) {
    await createStore().delete(plan.fileUri);
  }
  return plan;
}
