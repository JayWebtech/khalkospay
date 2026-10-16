-- CreateEnum
CREATE TYPE "OfframpStatus" AS ENUM ('AWAITING_DEPOSIT', 'CONFIRMING', 'PAYING_OUT', 'COMPLETED', 'PAYOUT_FAILED', 'REFUNDING', 'REFUNDED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('AWAITING_FUNDING', 'ACTIVE', 'CLAIMING', 'CLAIMED', 'EXPIRED', 'REFUNDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PetStatus" AS ENUM ('ALIVE', 'DEAD');

-- CreateEnum
CREATE TYPE "MealSlot" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER');

-- CreateEnum
CREATE TYPE "PetRevivalStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'EXPIRED', 'REFUNDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('DEPOSIT', 'PAYOUT', 'REFUND');

-- CreateTable
CREATE TABLE "OfframpOrder" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'app',
    "userAddress" TEXT NOT NULL,
    "nimLuna" BIGINT NOT NULL,
    "rateNgnPerNim" DECIMAL(24,8) NOT NULL,
    "grossKobo" BIGINT NOT NULL,
    "feeKobo" BIGINT NOT NULL,
    "payoutKobo" BIGINT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "status" "OfframpStatus" NOT NULL DEFAULT 'AWAITING_DEPOSIT',
    "depositTxHash" TEXT,
    "depositSubmittedAt" TIMESTAMP(3),
    "depositConfirmedAt" TIMESTAMP(3),
    "depositFrom" TEXT,
    "receivedLuna" BIGINT,
    "paystackRecipientCode" TEXT,
    "paystackTransferCode" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundTxHash" TEXT,
    "refundTxHex" TEXT,
    "refundSentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfframpOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "giftCardId" TEXT,
    "revivalId" TEXT,
    "kind" "LedgerKind" NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "debit" TEXT NOT NULL,
    "credit" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "shareCode" TEXT,
    "amountLuna" BIGINT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "redeemCodeHash" TEXT NOT NULL,
    "template" TEXT NOT NULL DEFAULT 'default',
    "senderAddress" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'AWAITING_FUNDING',
    "fundingTxHash" TEXT,
    "fundingSubmittedAt" TIMESTAMP(3),
    "fundedAt" TIMESTAMP(3),
    "fundedFrom" TEXT,
    "receivedLuna" BIGINT,
    "claimerAddress" TEXT,
    "claimTxHash" TEXT,
    "claimTxHex" TEXT,
    "claimSentAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "reclaimedAt" TIMESTAMP(3),
    "refundTxHash" TEXT,
    "refundTxHex" TEXT,
    "refundSentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pet" (
    "id" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "strength" INTEGER NOT NULL DEFAULT 70,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "status" "PetStatus" NOT NULL DEFAULT 'ALIVE',
    "aliveSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledUntil" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diedAt" TIMESTAMP(3),
    "deathReason" TEXT,
    "lastStandUsed" BOOLEAN NOT NULL DEFAULT false,
    "revivals" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PetMeal" (
    "id" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "slot" "MealSlot" NOT NULL,
    "fed" BOOLEAN NOT NULL,
    "name" TEXT,
    "score" INTEGER,
    "calories" DOUBLE PRECISION,
    "protein" DOUBLE PRECISION,
    "carbs" DOUBLE PRECISION,
    "fat" DOUBLE PRECISION,
    "fiber" DOUBLE PRECISION,
    "strengthDelta" INTEGER NOT NULL,
    "xpDelta" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PetMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PetRevival" (
    "id" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "priceLuna" BIGINT NOT NULL,
    "status" "PetRevivalStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "txHash" TEXT,
    "txSubmittedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "payer" TEXT,
    "receivedLuna" BIGINT,
    "refundTxHash" TEXT,
    "refundTxHex" TEXT,
    "refundSentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PetRevival_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "mealType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "calories" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carbs" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "fiber" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfframpOrder_reference_key" ON "OfframpOrder"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "OfframpOrder_depositTxHash_key" ON "OfframpOrder"("depositTxHash");

-- CreateIndex
CREATE INDEX "OfframpOrder_userAddress_createdAt_idx" ON "OfframpOrder"("userAddress", "createdAt");

-- CreateIndex
CREATE INDEX "OfframpOrder_status_idx" ON "OfframpOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_orderId_kind_key" ON "LedgerEntry"("orderId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_giftCardId_kind_key" ON "LedgerEntry"("giftCardId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_revivalId_kind_key" ON "LedgerEntry"("revivalId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_reference_key" ON "GiftCard"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_shareCode_key" ON "GiftCard"("shareCode");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_fundingTxHash_key" ON "GiftCard"("fundingTxHash");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_claimTxHash_key" ON "GiftCard"("claimTxHash");

-- CreateIndex
CREATE INDEX "GiftCard_senderAddress_createdAt_idx" ON "GiftCard"("senderAddress", "createdAt");

-- CreateIndex
CREATE INDEX "GiftCard_status_idx" ON "GiftCard"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Pet_ownerAddress_key" ON "Pet"("ownerAddress");

-- CreateIndex
CREATE INDEX "PetMeal_petId_createdAt_idx" ON "PetMeal"("petId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PetMeal_petId_day_slot_key" ON "PetMeal"("petId", "day", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "PetRevival_reference_key" ON "PetRevival"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "PetRevival_txHash_key" ON "PetRevival"("txHash");

-- CreateIndex
CREATE INDEX "PetRevival_petId_createdAt_idx" ON "PetRevival"("petId", "createdAt");

-- CreateIndex
CREATE INDEX "PetRevival_status_idx" ON "PetRevival"("status");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OfframpOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_revivalId_fkey" FOREIGN KEY ("revivalId") REFERENCES "PetRevival"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PetMeal" ADD CONSTRAINT "PetMeal_petId_fkey" FOREIGN KEY ("petId") REFERENCES "Pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PetRevival" ADD CONSTRAINT "PetRevival_petId_fkey" FOREIGN KEY ("petId") REFERENCES "Pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
