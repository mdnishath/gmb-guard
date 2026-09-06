-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('TELEGRAM', 'EMAIL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CheckTrigger" AS ENUM ('CRON', 'MANUAL');

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "cid" TEXT,
    "address" TEXT,
    "city" TEXT,
    "category" TEXT,
    "tag" TEXT,
    "notes" TEXT,
    "currentStatus" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "previousStatus" "ListingStatus" NOT NULL,
    "newStatus" "ListingStatus" NOT NULL,
    "rawApiResponse" JSONB NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertLog" (
    "id" TEXT NOT NULL,
    "listingId" TEXT,
    "channel" "AlertChannel" NOT NULL,
    "status" "AlertStatus" NOT NULL,
    "recipient" TEXT,
    "event" TEXT NOT NULL,
    "previousStatus" "ListingStatus",
    "newStatus" "ListingStatus",
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckRun" (
    "id" TEXT NOT NULL,
    "trigger" "CheckTrigger" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "checked" INTEGER NOT NULL,
    "changed" INTEGER NOT NULL,
    "errors" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,

    CONSTRAINT "CheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Listing_placeId_key" ON "Listing"("placeId");
CREATE INDEX "Listing_currentStatus_idx" ON "Listing"("currentStatus");
CREATE INDEX "Listing_lastCheckedAt_idx" ON "Listing"("lastCheckedAt");
CREATE INDEX "Listing_monitoringEnabled_lastCheckedAt_idx" ON "Listing"("monitoringEnabled", "lastCheckedAt");
CREATE INDEX "Listing_city_idx" ON "Listing"("city");
CREATE INDEX "Listing_category_idx" ON "Listing"("category");

-- CreateIndex
CREATE INDEX "AuditLog_listingId_checkedAt_idx" ON "AuditLog"("listingId", "checkedAt" DESC);
CREATE INDEX "AuditLog_checkedAt_idx" ON "AuditLog"("checkedAt" DESC);
CREATE INDEX "AuditLog_newStatus_checkedAt_idx" ON "AuditLog"("newStatus", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "AlertLog_createdAt_idx" ON "AlertLog"("createdAt" DESC);
CREATE INDEX "AlertLog_listingId_createdAt_idx" ON "AlertLog"("listingId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CheckRun_startedAt_idx" ON "CheckRun"("startedAt" DESC);

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertLog" ADD CONSTRAINT "AlertLog_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
