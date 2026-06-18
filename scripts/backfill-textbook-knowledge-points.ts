import {
  backfillPublishedTextbookScopes,
  prisma,
  upsertDefaultMathSeniorTextbookScope,
} from '@hao/db';

async function main(): Promise<void> {
  const fallback = await upsertDefaultMathSeniorTextbookScope(prisma);
  const published = await backfillPublishedTextbookScopes(prisma);
  console.info(
    JSON.stringify(
      {
        fallback_textbook: {
          textbook_id: fallback.textbookId,
          chapter_count: fallback.chapterCount,
          mapping_count: fallback.mappingCount,
        },
        published_textbooks: {
          textbook_count: published.textbookCount,
          chapter_count: published.chapterCount,
          mapping_count: published.mappingCount,
          textbooks: published.textbooks,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
