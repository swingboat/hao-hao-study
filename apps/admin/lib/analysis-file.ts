import type { EducationAnalysisFile } from '@hao/llm';
import { analysisFileTypeFromName } from './education-analysis-adapter.ts';

interface StoredAnalysisFileInput {
  bytes: Buffer;
  name: string;
  path: string;
  mimeType?: string | null;
}

export function buildStoredAnalysisFile({
  bytes,
  name,
  path,
  mimeType,
}: StoredAnalysisFileInput): EducationAnalysisFile {
  const type = analysisFileTypeFromName(name, mimeType);
  return {
    type,
    name,
    path,
    mimeType: mimeType ?? undefined,
    data: type === 'pdf' || type === 'image' ? bytes.toString('base64') : undefined,
  };
}
