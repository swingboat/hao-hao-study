-- AlterTable
ALTER TABLE "content_upload" ADD COLUMN     "sha256" CHAR(64);

-- CreateTable
CREATE TABLE "derived_asset" (
    "source_sha256" CHAR(64) NOT NULL,
    "processor" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "asset_key" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "derived_asset_pkey" PRIMARY KEY ("source_sha256","processor","version","asset_key")
);

-- CreateIndex
CREATE INDEX "derived_asset_source_sha256_processor_idx" ON "derived_asset"("source_sha256", "processor");

-- CreateIndex
CREATE INDEX "content_upload_sha256_idx" ON "content_upload"("sha256");
