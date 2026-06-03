/**
 * 种子数据 — v0.1 MVP 启动时的最小冷启动数据。
 *
 * 当前为占位骨架，业务种子（学科 / 知识点 / LLM Provider 等）由
 * 后续运营端 PRD F4 的"上传教材 PDF 解析"流程填充。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 seed.ts: v0.1 MVP 种子骨架（待运营端 F4 上线后由真实数据替代）');
  // TODO: 待运营端 F4.1 上线后，从 docs/artifacts 冷启动数据包导入
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
