import { type Prisma, prisma } from '@hao/db';
import {
  type FigureCropAssetRecord,
  type ObjectStore,
  type QuestionFigure,
  createQuestionFigureCropAssets,
  createStore,
} from '@hao/storage';

interface QuestionFigureAssetStaging {
  id: string;
  upload: {
    file_uri: string;
    sha256: string | null;
  };
  llm_payload: unknown;
}

interface DerivedAssetDb {
  derived_asset: {
    upsert(args: {
      where: {
        source_sha256_processor_version_asset_key: {
          source_sha256: string;
          processor: string;
          version: string;
          asset_key: string;
        };
      };
      update: {
        storage_path: string;
        size_bytes: number | null;
        metadata: Prisma.InputJsonValue;
      };
      create: {
        source_sha256: string;
        processor: string;
        version: string;
        asset_key: string;
        storage_path: string;
        size_bytes: number | null;
        metadata: Prisma.InputJsonValue;
      };
    }): Promise<unknown>;
  };
}

type CreateQuestionFigureCropAssets = typeof createQuestionFigureCropAssets;

export interface CreateAndPersistQuestionFigureCropAssetsInput {
  staging: QuestionFigureAssetStaging;
  publishedQuestionId: string;
  db?: DerivedAssetDb;
  store?: ObjectStore;
  createAssets?: CreateQuestionFigureCropAssets;
  warn?: (message: string) => void;
}

export interface QuestionFigureCropPersistResult {
  generated: number;
  skipped: boolean;
  warning: string | null;
}

export async function createAndPersistQuestionFigureCropAssets({
  staging,
  publishedQuestionId,
  db = prisma,
  store = createStore(),
  createAssets = createQuestionFigureCropAssets,
  warn = console.warn,
}: CreateAndPersistQuestionFigureCropAssetsInput): Promise<QuestionFigureCropPersistResult> {
  const sourceSha256 = staging.upload.sha256?.trim() ?? '';
  const figures = usableFiguresFromPayload(staging.llm_payload);

  if (!sourceSha256 || !staging.upload.file_uri || figures.length === 0) {
    return { generated: 0, skipped: true, warning: null };
  }

  try {
    const sourcePdf = await store.get(staging.upload.file_uri);
    const assets = await createAssets({
      store,
      sourceSha256,
      sourcePdf,
      publishedQuestionId,
      figures,
    });
    await upsertDerivedAssets(db, assets);
    return { generated: assets.length, skipped: false, warning: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(
      `[question-figure-assets] figure crop failed: staging=${staging.id} question=${publishedQuestionId}: ${message}`,
    );
    return { generated: 0, skipped: false, warning: message };
  }
}

function usableFiguresFromPayload(payload: unknown): QuestionFigure[] {
  if (!payload || typeof payload !== 'object') return [];
  const figures = (payload as { figures?: unknown }).figures;
  if (!Array.isArray(figures)) return [];
  return figures.filter(isUsableFigure) as QuestionFigure[];
}

function isUsableFigure(figure: unknown): figure is QuestionFigure {
  if (!figure || typeof figure !== 'object') return false;
  const candidate = figure as QuestionFigure;
  const id = typeof candidate.id === 'string' && candidate.id.trim().length > 0;
  const page = positiveIntOrNull(
    candidate.source_page ?? candidate.sourcePage ?? candidate.page_number ?? candidate.page,
  );
  return id && page != null && hasBbox(candidate.bbox);
}

function hasBbox(value: unknown): boolean {
  if (Array.isArray(value)) return value.length >= 4;
  return !!value && typeof value === 'object';
}

function positiveIntOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

async function upsertDerivedAssets(
  db: DerivedAssetDb,
  assets: FigureCropAssetRecord[],
): Promise<void> {
  for (const asset of assets) {
    const metadata = asset.metadata as unknown as Prisma.InputJsonValue;
    await db.derived_asset.upsert({
      where: {
        source_sha256_processor_version_asset_key: {
          source_sha256: asset.source_sha256,
          processor: asset.processor,
          version: asset.version,
          asset_key: asset.asset_key,
        },
      },
      update: {
        storage_path: asset.storage_path,
        size_bytes: asset.size_bytes,
        metadata,
      },
      create: {
        source_sha256: asset.source_sha256,
        processor: asset.processor,
        version: asset.version,
        asset_key: asset.asset_key,
        storage_path: asset.storage_path,
        size_bytes: asset.size_bytes,
        metadata,
      },
    });
  }
}
