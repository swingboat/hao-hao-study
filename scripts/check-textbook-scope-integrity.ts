import { assertTextbookChapterLabelsCanonical, prisma } from '@hao/db';

async function main(): Promise<void> {
  await assertTextbookChapterLabelsCanonical(prisma);
  console.info('✅ textbook scope integrity check passed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
