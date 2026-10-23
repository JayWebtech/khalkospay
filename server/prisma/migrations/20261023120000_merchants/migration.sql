-- CreateEnum
CREATE TYPE "MerchantPaymentStatus" AS ENUM ('AWAITING_PAYMENT', 'CONFIRMING', 'CONFIRMED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "payoutAddress" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "phone" TEXT,
    "location" TEXT,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantPayment" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amountLuna" BIGINT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "payerAddress" TEXT,
    "status" "MerchantPaymentStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "txHash" TEXT,
    "txSubmittedAt" TIMESTAMP(3),
    "paidFrom" TEXT,
    "receivedLuna" BIGINT,
    "confirmedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_code_key" ON "Merchant"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_ownerAddress_key" ON "Merchant"("ownerAddress");

-- CreateIndex
CREATE INDEX "Merchant_payoutAddress_idx" ON "Merchant"("payoutAddress");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantPayment_reference_key" ON "MerchantPayment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantPayment_txHash_key" ON "MerchantPayment"("txHash");

-- CreateIndex
CREATE INDEX "MerchantPayment_merchantId_createdAt_idx" ON "MerchantPayment"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantPayment_recipient_status_idx" ON "MerchantPayment"("recipient", "status");

-- CreateIndex
CREATE INDEX "MerchantPayment_status_idx" ON "MerchantPayment"("status");

-- AddForeignKey
ALTER TABLE "MerchantPayment" ADD CONSTRAINT "MerchantPayment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

