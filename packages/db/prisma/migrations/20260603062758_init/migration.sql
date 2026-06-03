-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "LearningSessionStatus" AS ENUM ('in_progress', 'completed', 'abandoned');

-- CreateEnum
CREATE TYPE "MistakeStatus" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "PracticeItemType" AS ENUM ('choice', 'fill_in');

-- CreateEnum
CREATE TYPE "LLMProtocol" AS ENUM ('openai_chat', 'google_generate_content');

-- CreateEnum
CREATE TYPE "ParseTaskKind" AS ENUM ('practice_item', 'knowledge_point', 'goal_template');

-- CreateEnum
CREATE TYPE "ParseJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "UploadFileType" AS ENUM ('exam_outline', 'textbook', 'item_pack');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('uploaded', 'parsed', 'published', 'discarded');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('pending', 'accepted', 'rejected', 'edited');

-- CreateEnum
CREATE TYPE "SessionPoolSource" AS ENUM ('error_review', 'spaced_repetition', 'new_knowledge');

-- CreateTable
CREATE TABLE "subject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "primary_subject_id" TEXT NOT NULL,
    "target_exam" TEXT NOT NULL,
    "parent_consent_at" TIMESTAMPTZ,
    "cold_start_mode" BOOLEAN NOT NULL DEFAULT true,
    "unlocked_kp_ids" UUID[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soft_deleted_at" TIMESTAMPTZ,

    CONSTRAINT "student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_point" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "chapter_no" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_point_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "content" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "solution_text" TEXT NOT NULL,
    "kp_ids" UUID[],
    "primary_kp_id" UUID NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "item_type" "PracticeItemType" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    "status" "LearningSessionStatus" NOT NULL DEFAULT 'in_progress',
    "item_ids" UUID[],
    "pool_sources" "SessionPoolSource"[],

    CONSTRAINT "learning_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_attempt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "student_answer" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "answered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_point_mastery" (
    "student_id" UUID NOT NULL,
    "subject_id" TEXT NOT NULL,
    "kp_id" UUID NOT NULL,
    "mastery_score" DOUBLE PRECISION NOT NULL,
    "peak_mastery_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "last_attempted_at" TIMESTAMPTZ,

    CONSTRAINT "knowledge_point_mastery_pkey" PRIMARY KEY ("student_id","kp_id")
);

-- CreateTable
CREATE TABLE "mistake_book_entry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "status" "MistakeStatus" NOT NULL DEFAULT 'open',
    "error_count" INTEGER NOT NULL DEFAULT 1,
    "consecutive_correct_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "mistake_book_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spaced_review" (
    "student_id" UUID NOT NULL,
    "kp_id" UUID NOT NULL,
    "next_review_at" TIMESTAMPTZ NOT NULL,
    "idx" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "spaced_review_pkey" PRIMARY KEY ("student_id","kp_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_provider" (
    "id" TEXT NOT NULL,
    "protocol" "LLMProtocol" NOT NULL,
    "endpoint" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "auth_env_var" TEXT NOT NULL,
    "default_params" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_upload" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uploader_id" TEXT NOT NULL,
    "file_uri" TEXT NOT NULL,
    "file_type" "UploadFileType" NOT NULL,
    "purpose" "ParseTaskKind" NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'uploaded',
    "original_name" TEXT,
    "size_bytes" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_parse_job" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "upload_id" UUID NOT NULL,
    "task_kind" "ParseTaskKind" NOT NULL,
    "provider_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "status" "ParseJobStatus" NOT NULL DEFAULT 'queued',
    "request_payload" JSONB,
    "raw_response" JSONB,
    "parsed_output" JSONB,
    "token_usage" JSONB,
    "latency_ms" INTEGER,
    "cost_estimate" DECIMAL(10,6),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,

    CONSTRAINT "llm_parse_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_parse_staging" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parse_job_id" UUID NOT NULL,
    "upload_id" UUID NOT NULL,
    "entity_kind" "ParseTaskKind" NOT NULL,
    "llm_payload" JSONB NOT NULL,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'pending',
    "review_payload" JSONB,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ,
    "published_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_parse_staging_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_username_key" ON "student"("username");

-- CreateIndex
CREATE INDEX "student_username_idx" ON "student"("username");

-- CreateIndex
CREATE INDEX "student_soft_deleted_at_idx" ON "student"("soft_deleted_at");

-- CreateIndex
CREATE INDEX "knowledge_point_subject_id_chapter_no_idx" ON "knowledge_point"("subject_id", "chapter_no");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_point_subject_id_name_key" ON "knowledge_point"("subject_id", "name");

-- CreateIndex
CREATE INDEX "practice_item_primary_kp_id_idx" ON "practice_item"("primary_kp_id");

-- CreateIndex
CREATE INDEX "practice_item_difficulty_idx" ON "practice_item"("difficulty");

-- CreateIndex
CREATE INDEX "learning_session_student_id_started_at_idx" ON "learning_session"("student_id", "started_at");

-- CreateIndex
CREATE INDEX "learning_session_status_idx" ON "learning_session"("status");

-- CreateIndex
CREATE INDEX "practice_attempt_student_id_answered_at_idx" ON "practice_attempt"("student_id", "answered_at");

-- CreateIndex
CREATE INDEX "practice_attempt_item_id_is_correct_idx" ON "practice_attempt"("item_id", "is_correct");

-- CreateIndex
CREATE INDEX "knowledge_point_mastery_student_id_mastery_score_idx" ON "knowledge_point_mastery"("student_id", "mastery_score");

-- CreateIndex
CREATE INDEX "mistake_book_entry_student_id_status_idx" ON "mistake_book_entry"("student_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mistake_book_entry_student_id_item_id_key" ON "mistake_book_entry"("student_id", "item_id");

-- CreateIndex
CREATE INDEX "spaced_review_next_review_at_idx" ON "spaced_review"("next_review_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log"("action", "created_at");

-- CreateIndex
CREATE INDEX "content_upload_uploader_id_created_at_idx" ON "content_upload"("uploader_id", "created_at");

-- CreateIndex
CREATE INDEX "llm_parse_job_upload_id_created_at_idx" ON "llm_parse_job"("upload_id", "created_at");

-- CreateIndex
CREATE INDEX "llm_parse_job_provider_id_status_idx" ON "llm_parse_job"("provider_id", "status");

-- CreateIndex
CREATE INDEX "llm_parse_staging_upload_id_review_status_idx" ON "llm_parse_staging"("upload_id", "review_status");

-- CreateIndex
CREATE INDEX "llm_parse_staging_parse_job_id_idx" ON "llm_parse_staging"("parse_job_id");

-- AddForeignKey
ALTER TABLE "student" ADD CONSTRAINT "student_primary_subject_id_fkey" FOREIGN KEY ("primary_subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_point" ADD CONSTRAINT "knowledge_point_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_session" ADD CONSTRAINT "learning_session_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_attempt" ADD CONSTRAINT "practice_attempt_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "learning_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_attempt" ADD CONSTRAINT "practice_attempt_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_attempt" ADD CONSTRAINT "practice_attempt_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "practice_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_point_mastery" ADD CONSTRAINT "knowledge_point_mastery_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_point_mastery" ADD CONSTRAINT "knowledge_point_mastery_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_point_mastery" ADD CONSTRAINT "knowledge_point_mastery_kp_id_fkey" FOREIGN KEY ("kp_id") REFERENCES "knowledge_point"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mistake_book_entry" ADD CONSTRAINT "mistake_book_entry_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mistake_book_entry" ADD CONSTRAINT "mistake_book_entry_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "practice_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaced_review" ADD CONSTRAINT "spaced_review_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaced_review" ADD CONSTRAINT "spaced_review_kp_id_fkey" FOREIGN KEY ("kp_id") REFERENCES "knowledge_point"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_parse_job" ADD CONSTRAINT "llm_parse_job_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "content_upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_parse_job" ADD CONSTRAINT "llm_parse_job_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "llm_provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_parse_staging" ADD CONSTRAINT "llm_parse_staging_parse_job_id_fkey" FOREIGN KEY ("parse_job_id") REFERENCES "llm_parse_job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_parse_staging" ADD CONSTRAINT "llm_parse_staging_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "content_upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
