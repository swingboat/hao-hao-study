/*
  Warnings:

  - Added the required column `stage` to the `student` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `grade` on the `student` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `stage` to the `subject` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('primary', 'junior', 'senior');

-- CreateEnum
CREATE TYPE "Grade" AS ENUM ('g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10', 'g11', 'g12');

-- AlterTable
ALTER TABLE "student" ADD COLUMN     "stage" "Stage" NOT NULL,
DROP COLUMN "grade",
ADD COLUMN     "grade" "Grade" NOT NULL;

-- AlterTable
ALTER TABLE "subject" ADD COLUMN     "stage" "Stage" NOT NULL;
