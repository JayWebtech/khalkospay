-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "OfframpOrder" ADD COLUMN     "livemode" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "partnerId" TEXT,
ADD COLUMN     "partnerReference" TEXT,
ADD COLUMN     "refundAddress" TEXT,
ADD COLUMN     "sandboxPayoutFails" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "userAddress" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT,
    "webhookUrlTest" TEXT,
    "webhookUrlLive" TEXT,
    "webhookSecretTest" TEXT NOT NULL,
    "webhookSecretLive" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerApiKey" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerWebhookEvent" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "type" TEXT NOT NULL,
    "orderId" TEXT,
    "payload" TEXT NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerWebhookDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER,
    "error" TEXT,
    "responseBody" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerIdempotencyKey" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER,
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerApiKey_prefix_key" ON "PartnerApiKey"("prefix");

-- CreateIndex
CREATE INDEX "PartnerApiKey_partnerId_idx" ON "PartnerApiKey"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerWebhookEvent_status_nextAttemptAt_idx" ON "PartnerWebhookEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PartnerWebhookEvent_partnerId_livemode_createdAt_idx" ON "PartnerWebhookEvent"("partnerId", "livemode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerWebhookEvent_orderId_type_key" ON "PartnerWebhookEvent"("orderId", "type");

-- CreateIndex
CREATE INDEX "PartnerWebhookDelivery_eventId_idx" ON "PartnerWebhookDelivery"("eventId");

-- CreateIndex
CREATE INDEX "PartnerIdempotencyKey_createdAt_idx" ON "PartnerIdempotencyKey"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerIdempotencyKey_partnerId_livemode_key_key" ON "PartnerIdempotencyKey"("partnerId", "livemode", "key");

-- CreateIndex
CREATE INDEX "OfframpOrder_partnerId_livemode_createdAt_idx" ON "OfframpOrder"("partnerId", "livemode", "createdAt");

-- AddForeignKey
ALTER TABLE "OfframpOrder" ADD CONSTRAINT "OfframpOrder_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApiKey" ADD CONSTRAINT "PartnerApiKey_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerWebhookEvent" ADD CONSTRAINT "PartnerWebhookEvent_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerWebhookEvent" ADD CONSTRAINT "PartnerWebhookEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OfframpOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerWebhookDelivery" ADD CONSTRAINT "PartnerWebhookDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PartnerWebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerIdempotencyKey" ADD CONSTRAINT "PartnerIdempotencyKey_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

