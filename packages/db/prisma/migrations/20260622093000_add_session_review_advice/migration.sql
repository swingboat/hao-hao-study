-- CreateEnum
CREATE TYPE "SessionReviewAdviceStatus" AS ENUM ('pending', 'generated', 'failed');

-- CreateTable
CREATE TABLE "session_review_advice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "subject_id" TEXT NOT NULL,
    "status" "SessionReviewAdviceStatus" NOT NULL DEFAULT 'pending',
    "advice" JSONB,
    "input_snapshot" JSONB,
    "deterministic_plan" JSONB,
    "llm_metadata" JSONB,
    "diagnostics" JSONB,
    "quality_flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "prompt_version" TEXT,
    "error_message" TEXT,
    "generated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "session_review_advice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_review_advice_session_id_key" ON "session_review_advice"("session_id");

-- CreateIndex
CREATE INDEX "session_review_advice_student_id_created_at_idx" ON "session_review_advice"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "session_review_advice_subject_id_status_idx" ON "session_review_advice"("subject_id", "status");

-- AddForeignKey
ALTER TABLE "session_review_advice" ADD CONSTRAINT "session_review_advice_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "learning_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_review_advice" ADD CONSTRAINT "session_review_advice_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_review_advice" ADD CONSTRAINT "session_review_advice_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
