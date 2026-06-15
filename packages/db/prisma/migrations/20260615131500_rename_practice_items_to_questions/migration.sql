-- Rename the early v0.1 "practice item" naming to the project-wide "question" naming.
--
-- Current fresh databases already get question/question_attempt from the edited init
-- migration, so every operation below is guarded: old local databases are upgraded,
-- while fresh databases treat this migration as a no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'PracticeItemType'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'QuestionType'
  ) THEN
    ALTER TYPE "PracticeItemType" RENAME TO "QuestionType";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typnamespace = 'public'::regnamespace
      AND t.typname = 'ParseTaskKind'
      AND e.enumlabel = 'practice_item'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typnamespace = 'public'::regnamespace
      AND t.typname = 'ParseTaskKind'
      AND e.enumlabel = 'question'
  ) THEN
    ALTER TYPE "ParseTaskKind" RENAME VALUE 'practice_item' TO 'question';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typnamespace = 'public'::regnamespace
      AND t.typname = 'UploadFileType'
      AND e.enumlabel = 'item_pack'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typnamespace = 'public'::regnamespace
      AND t.typname = 'UploadFileType'
      AND e.enumlabel = 'question_pack'
  ) THEN
    ALTER TYPE "UploadFileType" RENAME VALUE 'item_pack' TO 'question_pack';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.practice_item') IS NOT NULL
     AND to_regclass('public.question') IS NULL THEN
    ALTER TABLE "practice_item" RENAME TO "question";
  END IF;

  IF to_regclass('public.practice_attempt') IS NOT NULL
     AND to_regclass('public.question_attempt') IS NULL THEN
    ALTER TABLE "practice_attempt" RENAME TO "question_attempt";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'question'
      AND column_name = 'item_type'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'question'
      AND column_name = 'question_type'
  ) THEN
    ALTER TABLE "question" RENAME COLUMN "item_type" TO "question_type";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'question_attempt'
      AND column_name = 'item_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'question_attempt'
      AND column_name = 'question_id'
  ) THEN
    ALTER TABLE "question_attempt" RENAME COLUMN "item_id" TO "question_id";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'learning_session'
      AND column_name = 'item_ids'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'learning_session'
      AND column_name = 'question_ids'
  ) THEN
    ALTER TABLE "learning_session" RENAME COLUMN "item_ids" TO "question_ids";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mistake_book_entry'
      AND column_name = 'item_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mistake_book_entry'
      AND column_name = 'question_id'
  ) THEN
    ALTER TABLE "mistake_book_entry" RENAME COLUMN "item_id" TO "question_id";
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.question') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.question'::regclass
        AND conname = 'practice_item_pkey'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.question'::regclass
        AND conname = 'question_pkey'
    ) THEN
      ALTER TABLE "question" RENAME CONSTRAINT "practice_item_pkey" TO "question_pkey";
    END IF;

    IF to_regclass('public.practice_item_primary_kp_id_idx') IS NOT NULL
       AND to_regclass('public.question_primary_kp_id_idx') IS NULL THEN
      ALTER INDEX "practice_item_primary_kp_id_idx" RENAME TO "question_primary_kp_id_idx";
    END IF;

    IF to_regclass('public.practice_item_difficulty_idx') IS NOT NULL
       AND to_regclass('public.question_difficulty_idx') IS NULL THEN
      ALTER INDEX "practice_item_difficulty_idx" RENAME TO "question_difficulty_idx";
    END IF;
  END IF;

  IF to_regclass('public.question_attempt') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.question_attempt'::regclass
        AND conname = 'practice_attempt_pkey'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.question_attempt'::regclass
        AND conname = 'question_attempt_pkey'
    ) THEN
      ALTER TABLE "question_attempt" RENAME CONSTRAINT "practice_attempt_pkey" TO "question_attempt_pkey";
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.question_attempt'::regclass
        AND conname = 'practice_attempt_session_id_fkey'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.question_attempt'::regclass
        AND conname = 'question_attempt_session_id_fkey'
    ) THEN
      ALTER TABLE "question_attempt" RENAME CONSTRAINT "practice_attempt_session_id_fkey" TO "question_attempt_session_id_fkey";
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.question_attempt'::regclass
        AND conname = 'practice_attempt_student_id_fkey'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.question_attempt'::regclass
        AND conname = 'question_attempt_student_id_fkey'
    ) THEN
      ALTER TABLE "question_attempt" RENAME CONSTRAINT "practice_attempt_student_id_fkey" TO "question_attempt_student_id_fkey";
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.question_attempt'::regclass
        AND conname = 'practice_attempt_item_id_fkey'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.question_attempt'::regclass
        AND conname = 'question_attempt_question_id_fkey'
    ) THEN
      ALTER TABLE "question_attempt" RENAME CONSTRAINT "practice_attempt_item_id_fkey" TO "question_attempt_question_id_fkey";
    END IF;

    IF to_regclass('public.practice_attempt_student_id_answered_at_idx') IS NOT NULL
       AND to_regclass('public.question_attempt_student_id_answered_at_idx') IS NULL THEN
      ALTER INDEX "practice_attempt_student_id_answered_at_idx" RENAME TO "question_attempt_student_id_answered_at_idx";
    END IF;

    IF to_regclass('public.practice_attempt_item_id_is_correct_idx') IS NOT NULL
       AND to_regclass('public.question_attempt_question_id_is_correct_idx') IS NULL THEN
      ALTER INDEX "practice_attempt_item_id_is_correct_idx" RENAME TO "question_attempt_question_id_is_correct_idx";
    END IF;
  END IF;

  IF to_regclass('public.mistake_book_entry') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.mistake_book_entry'::regclass
        AND conname = 'mistake_book_entry_item_id_fkey'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.mistake_book_entry'::regclass
        AND conname = 'mistake_book_entry_question_id_fkey'
    ) THEN
      ALTER TABLE "mistake_book_entry" RENAME CONSTRAINT "mistake_book_entry_item_id_fkey" TO "mistake_book_entry_question_id_fkey";
    END IF;

    IF to_regclass('public.mistake_book_entry_student_id_item_id_key') IS NOT NULL
       AND to_regclass('public.mistake_book_entry_student_id_question_id_key') IS NULL THEN
      ALTER INDEX "mistake_book_entry_student_id_item_id_key" RENAME TO "mistake_book_entry_student_id_question_id_key";
    END IF;
  END IF;
END $$;

UPDATE "audit_log"
SET "target_type" = 'question'
WHERE "target_type" = 'practice_item';

UPDATE "audit_log"
SET "target_type" = 'question_attempt'
WHERE "target_type" = 'practice_attempt';
