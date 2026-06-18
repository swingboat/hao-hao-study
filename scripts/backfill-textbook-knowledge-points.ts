import { prisma, upsertDefaultMathSeniorTextbookScope } from '@hao/db';

async function main(): Promise<void> {
  const result = await upsertDefaultMathSeniorTextbookScope(prisma);
  console.info(
    JSON.stringify(
      {
        textbook_id: result.textbookId,
        chapter_count: result.chapterCount,
        mapping_count: result.mappingCount,
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
