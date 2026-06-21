export type UploadHistoryPurpose = 'knowledge_point' | 'question' | 'mixed_learning_material';

export interface UploadHistoryRecord {
  id: string;
  file_uri: string;
  purpose: string;
}

export type UploadHistoryDeletePlan =
  | {
      ok: true;
      uploadId: string;
      fileUri: string;
      deleteStorageObject: boolean;
    }
  | {
      ok: false;
      reason: 'not_found' | 'wrong_purpose';
    };

export function buildUploadHistoryDeletePlan(
  upload: UploadHistoryRecord | null,
  expectedPurpose: UploadHistoryPurpose,
  remainingFileReferenceCount: number,
): UploadHistoryDeletePlan {
  if (!upload) return { ok: false, reason: 'not_found' };
  if (upload.purpose !== expectedPurpose) return { ok: false, reason: 'wrong_purpose' };
  return {
    ok: true,
    uploadId: upload.id,
    fileUri: upload.file_uri,
    deleteStorageObject: remainingFileReferenceCount === 0,
  };
}
