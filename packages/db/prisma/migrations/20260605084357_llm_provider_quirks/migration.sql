-- AlterTable
ALTER TABLE "llm_provider" ADD COLUMN     "max_output_tokens" INTEGER,
ADD COLUMN     "output_normalizers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "quirks" JSONB NOT NULL DEFAULT '{}';
