import { type Prisma, prisma } from '@hao/db';
import { createStore } from '@hao/storage';
import {
  type FigureCropAssetRecord,
  type QuestionFigure,
  createQuestionFigureCropAssets,
} from '@hao/storage/figure-crop';

interface BackfillStats {
  scanned: number;
  skipped: number;
  generated: number;
  failed: number;
}

async function main(): Promise<void> {
  const questionId = readArg('--question-id');
  const stats: BackfillStats = {
    scanned: 0,
    skipped: 0,
    generated: 0,
    failed: 0,
  };
  const store = createStore();
  const stagings = await prisma.llm_parse_staging.findMany({
    where: {
      entity_kind: 'question',
      review_status: 'accepted',
      published_id: questionId ? questionId : { not: null },
    },
    include: { upload: true },
    orderBy: { created_at: 'asc' },
  });

  for (const staging of stagings) {
    stats.scanned += 1;
    const publishedQuestionId = staging.published_id;
    const sourceSha256 = staging.upload.sha256;
    const figures = figuresFromPayload(staging.llm_payload);

    if (!publishedQuestionId || !sourceSha256 || figures.length === 0) {
      stats.skipped += 1;
      continue;
    }

    try {
      const sourcePdf = await store.get(staging.upload.file_uri);
      const assets = await createQuestionFigureCropAssets({
        store,
        sourceSha256,
        sourcePdf,
        publishedQuestionId,
        figures,
      });
      await upsertDerivedAssets(assets);
      stats.generated += assets.length;
      console.info(`figure-crop: question=${publishedQuestionId} generated=${assets.length}`);
    } catch (error) {
      stats.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `figure-crop failed: staging=${staging.id} question=${publishedQuestionId}`,
        message,
      );
    }
  }

  console.info(JSON.stringify(stats, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

function figuresFromPayload(payload: unknown): QuestionFigure[] {
  if (!payload || typeof payload !== 'object') return [];
  const figures = (payload as { figures?: unknown }).figures;
  return Array.isArray(figures) ? (figures as QuestionFigure[]) : [];
}

async function upsertDerivedAssets(assets: FigureCropAssetRecord[]): Promise<void> {
  for (const asset of assets) {
    await prisma.derived_asset.upsert({
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
        metadata: asset.metadata as unknown as Prisma.InputJsonValue,
      },
      create: {
        source_sha256: asset.source_sha256,
        processor: asset.processor,
        version: asset.version,
        asset_key: asset.asset_key,
        storage_path: asset.storage_path,
        size_bytes: asset.size_bytes,
        metadata: asset.metadata as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}
