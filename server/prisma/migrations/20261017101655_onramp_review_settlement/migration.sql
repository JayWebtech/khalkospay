-- AlterEnum
ALTER TYPE "OnrampStatus" ADD VALUE 'RESOLVED';

-- AlterTable
ALTER TABLE "OnrampOrder" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3);

