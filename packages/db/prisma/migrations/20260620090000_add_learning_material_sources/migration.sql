-- ExtendEnum
ALTER TYPE "ParseTaskKind" ADD VALUE IF NOT EXISTS 'mixed_learning_material';

-- ExtendEnum
ALTER TYPE "UploadFileType" ADD VALUE IF NOT EXISTS 'lesson_handout';
ALTER TYPE "UploadFileType" ADD VALUE IF NOT EXISTS 'workbook';
ALTER TYPE "UploadFileType" ADD VALUE IF NOT EXISTS 'exam_paper';
ALTER TYPE "UploadFileType" ADD VALUE IF NOT EXISTS 'answer_book';
ALTER TYPE "UploadFileType" ADD VALUE IF NOT EXISTS 'mixed_material';

-- CreateEnum
CREATE TYPE "ParseEntityKind" AS ENUM ('question', 'knowledge_point', 'goal_template', 'source_document', 'learning_material');

-- CreateEnum
CREATE TYPE "SourceDocumentType" AS ENUM ('textbook', 'lesson_handout', 'workbook', 'question_pack', 'exam_paper', 'answer_book', 'mixed_material');

-- CreateEnum
CREATE TYPE "SourceUnitKind" AS ENUM ('page', 'slide', 'question_region', 'explanation_region', 'text_block');

-- CreateEnum
CREATE TYPE "LearningMaterialType" AS ENUM ('concept_explanation', 'method_card', 'common_mistake', 'question_type_summary', 'exam_trend', 'textbook_deep_dive', 'solution_summary', 'study_advice');

-- AlterTable
ALTER TABLE "llm_parse_staging"
  ALTER COLUMN "entity_kind" TYPE "ParseEntityKind"
  USING ("entity_kind"::text::"ParseEntityKind");

-- CreateTable
CREATE TABLE "source_document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "upload_id" UUID NOT NULL,
    "source_type" "SourceDocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "stage" "Stage",
    "grade" "Grade",
    "provider" TEXT,
    "publisher" TEXT,
    "year" INTEGER,
    "season" TEXT,
    "exam_name" TEXT,
    "paper_name" TEXT,
    "region" TEXT,
    "lesson_no" TEXT,
    "page_count" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_unit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_document_id" UUID NOT NULL,
    "unit_kind" "SourceUnitKind" NOT NULL,
    "page_no" INTEGER,
    "slide_no" INTEGER,
    "question_no" TEXT,
    "bbox" JSONB,
    "text_snippet" TEXT,
    "derived_asset_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_material" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "material_type" "LearningMaterialType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "student_summary" TEXT,
    "subject_id" TEXT NOT NULL,
    "kp_ids" UUID[],
    "primary_kp_id" UUID,
    "source_document_id" UUID,
    "source_unit_id" UUID,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_source" (
    "question_id" UUID NOT NULL,
    "source_document_id" UUID NOT NULL,
    "source_unit_id" UUID,
    "question_no" TEXT,
    "page_no" INTEGER,
    "role" TEXT NOT NULL DEFAULT 'origin',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_source_pkey" PRIMARY KEY ("question_id","source_document_id","role")
);

-- CreateIndex
CREATE INDEX "source_document_subject_id_source_type_year_idx" ON "source_document"("subject_id", "source_type", "year");

-- CreateIndex
CREATE INDEX "source_document_title_idx" ON "source_document"("title");

-- CreateIndex
CREATE INDEX "source_unit_source_document_id_page_no_idx" ON "source_unit"("source_document_id", "page_no");

-- CreateIndex
CREATE INDEX "source_unit_source_document_id_question_no_idx" ON "source_unit"("source_document_id", "question_no");

-- CreateIndex
CREATE INDEX "learning_material_subject_id_material_type_idx" ON "learning_material"("subject_id", "material_type");

-- CreateIndex
CREATE INDEX "learning_material_primary_kp_id_idx" ON "learning_material"("primary_kp_id");

-- CreateIndex
CREATE INDEX "question_source_source_document_id_question_no_idx" ON "question_source"("source_document_id", "question_no");

-- AddForeignKey
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "content_upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_unit" ADD CONSTRAINT "source_unit_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_material" ADD CONSTRAINT "learning_material_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_material" ADD CONSTRAINT "learning_material_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_material" ADD CONSTRAINT "learning_material_source_unit_id_fkey" FOREIGN KEY ("source_unit_id") REFERENCES "source_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_source" ADD CONSTRAINT "question_source_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_source" ADD CONSTRAINT "question_source_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_source" ADD CONSTRAINT "question_source_source_unit_id_fkey" FOREIGN KEY ("source_unit_id") REFERENCES "source_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
