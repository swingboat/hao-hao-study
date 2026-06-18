-- CreateEnum
CREATE TYPE "PlannerPreferenceMode" AS ENUM ('auto', 'custom');

-- CreateTable
CREATE TABLE "student_planner_preference" (
    "student_id" UUID NOT NULL,
    "mode" "PlannerPreferenceMode" NOT NULL DEFAULT 'auto',
    "weights" JSONB NOT NULL DEFAULT '{"new_knowledge":40,"mistake_variant":30,"spaced_review":30,"feynman_check":0}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_planner_preference_pkey" PRIMARY KEY ("student_id")
);

-- AddForeignKey
ALTER TABLE "student_planner_preference" ADD CONSTRAINT "student_planner_preference_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
