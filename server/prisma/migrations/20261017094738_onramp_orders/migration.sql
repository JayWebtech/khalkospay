-- CreateEnum
CREATE TYPE "OnrampStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'SENDING', 'COMPLETED', 'EXPIRED', 'NEEDS_REVIEW');

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "onrampOrderId" TEXT;

-- CreateTable
CREATE TABLE "OnrampOrder" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "payoutAddress" TEXT NOT NULL,
    "fiatCurrency" TEXT NOT NULL,
    "fiatAmount" DECIMAL(24,4) NOT NULL,
    "fiatPerNim" DECIMAL(24,12) NOT NULL,
    "usdPerNim" DECIMAL(24,12) NOT NULL,
    "feeBps" INTEGER NOT NULL,
    "nimLuna" BIGINT NOT NULL,
    "status" "OnrampStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "checkoutId" TEXT,
    "checkoutUrl" TEXT,
    "checkoutExpiresAt" TIMESTAMP(3) NOT NULL,
    "chargeId" TEXT,
    "paidAmount" DECIMAL(24,4),
    "paidAt" TIMESTAMP(3),
    "payoutTxHash" TEXT,
    "payoutTxHex" TEXT,
    "payoutSentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnrampOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnrampOrder_reference_key" ON "OnrampOrder"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "OnrampOrder_checkoutId_key" ON "OnrampOrder"("checkoutId");

-- CreateIndex
CREATE UNIQUE INDEX "OnrampOrder_payoutTxHash_key" ON "OnrampOrder"("payoutTxHash");

-- CreateIndex
CREATE INDEX "OnrampOrder_walletAddress_createdAt_idx" ON "OnrampOrder"("walletAddress", "createdAt");

-- CreateIndex
CREATE INDEX "OnrampOrder_status_idx" ON "OnrampOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_onrampOrderId_kind_key" ON "LedgerEntry"("onrampOrderId", "kind");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_onrampOrderId_fkey" FOREIGN KEY ("onrampOrderId") REFERENCES "OnrampOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

