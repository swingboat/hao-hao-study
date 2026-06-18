-- CreateTable
CREATE TABLE "textbook" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" TEXT NOT NULL,
    "stage" "Stage" NOT NULL,
    "title" TEXT NOT NULL,
    "edition" TEXT,
    "publisher" TEXT,
    "volume" TEXT,
    "source_upload_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "textbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "textbook_chapter" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "textbook_id" UUID NOT NULL,
    "chapter_no" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "textbook_chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "textbook_knowledge_point" (
    "textbook_id" UUID NOT NULL,
    "chapter_id" UUID,
    "kp_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "source_pages" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "textbook_knowledge_point_pkey" PRIMARY KEY ("textbook_id","kp_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "textbook_source_upload_id_key" ON "textbook"("source_upload_id");

-- CreateIndex
CREATE INDEX "textbook_subject_id_stage_idx" ON "textbook"("subject_id", "stage");

-- CreateIndex
CREATE INDEX "textbook_title_idx" ON "textbook"("title");

-- CreateIndex
CREATE UNIQUE INDEX "textbook_chapter_textbook_id_chapter_no_key" ON "textbook_chapter"("textbook_id", "chapter_no");

-- CreateIndex
CREATE INDEX "textbook_chapter_textbook_id_sort_order_idx" ON "textbook_chapter"("textbook_id", "sort_order");

-- CreateIndex
CREATE INDEX "textbook_knowledge_point_kp_id_idx" ON "textbook_knowledge_point"("kp_id");

-- CreateIndex
CREATE INDEX "textbook_knowledge_point_textbook_id_chapter_id_sort_order_idx" ON "textbook_knowledge_point"("textbook_id", "chapter_id", "sort_order");

-- AddForeignKey
ALTER TABLE "textbook" ADD CONSTRAINT "textbook_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "textbook" ADD CONSTRAINT "textbook_source_upload_id_fkey" FOREIGN KEY ("source_upload_id") REFERENCES "content_upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "textbook_chapter" ADD CONSTRAINT "textbook_chapter_textbook_id_fkey" FOREIGN KEY ("textbook_id") REFERENCES "textbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "textbook_knowledge_point" ADD CONSTRAINT "textbook_knowledge_point_textbook_id_fkey" FOREIGN KEY ("textbook_id") REFERENCES "textbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "textbook_knowledge_point" ADD CONSTRAINT "textbook_knowledge_point_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "textbook_chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "textbook_knowledge_point" ADD CONSTRAINT "textbook_knowledge_point_kp_id_fkey" FOREIGN KEY ("kp_id") REFERENCES "knowledge_point"("id") ON DELETE CASCADE ON UPDATE CASCADE;
