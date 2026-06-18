import { buildQuestionFigureAssetKey } from '@hao/storage';
import type { QuestionFigureInput } from './question-content';

interface FigureMetadata {
  figures: readonly QuestionFigureInput[];
}

export interface FigureAssetRequest {
  questionId: string;
  figureId: string;
  assetKey: string;
}

export function buildFigureAssetRequests(
  metadataByQuestionId: ReadonlyMap<string, FigureMetadata>,
): FigureAssetRequest[] {
  const requests: FigureAssetRequest[] = [];

  for (const [questionId, metadata] of metadataByQuestionId) {
    for (const figure of metadata.figures) {
      requests.push({
        questionId,
        figureId: figure.id,
        assetKey: buildQuestionFigureAssetKey(questionId, figure.id),
      });
    }
  }

  return requests;
}
