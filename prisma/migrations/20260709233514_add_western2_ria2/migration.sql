-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."AccountTypeEnum" ADD VALUE 'WESTERN_2';
ALTER TYPE "public"."AccountTypeEnum" ADD VALUE 'RIA_2';

-- AlterTable
ALTER TABLE "public"."daily_snapshots" ADD COLUMN     "ria2Debut" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "ria2Fin" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "westernUnion2Debut" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "westernUnion2Fin" BIGINT NOT NULL DEFAULT 0;
