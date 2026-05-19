-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."AccountType" ADD VALUE 'SEDDO';
ALTER TYPE "public"."AccountType" ADD VALUE 'VERSEMENT_BANK';

-- AlterTable
ALTER TABLE "public"."daily_snapshots" ADD COLUMN     "seddoDebut" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "seddoFin" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "versementBankDebut" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "versementBankFin" BIGINT NOT NULL DEFAULT 0;
