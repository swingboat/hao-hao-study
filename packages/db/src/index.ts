/**
 * @hao/db — Prisma client 单例 + 类型重导出
 *
 * web端 / admin端 / shared 层统一从这里 import：
 *   import { prisma, Prisma } from '@hao/db';
 *
 * Next.js 在 dev 热重载时容易反复 new PrismaClient 导致连接耗尽，
 * 这里挂在 globalThis 上做 dev 单例。
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export { Prisma } from '@prisma/client';
export {
  LearningMaterialType,
  ParseEntityKind,
  SessionReviewAdviceStatus,
  SourceDocumentType,
  SourceUnitKind,
} from '@prisma/client';
export type * from '@prisma/client';
export * from './textbook-scope';
