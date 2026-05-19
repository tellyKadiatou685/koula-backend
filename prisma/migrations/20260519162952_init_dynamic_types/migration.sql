/*
  Warnings:

  - Changed the type of `type` on the `accounts` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "public"."AccountTypeEnum" AS ENUM ('LIQUIDE', 'ORANGE_MONEY', 'WAVE', 'UV_MASTER', 'FREE_MONEY', 'WESTERN_UNION', 'RIA', 'MONEYGRAM', 'SEDDO', 'VERSEMENT_BANK', 'AUTRES');

-- AlterTable
ALTER TABLE "public"."accounts" DROP COLUMN "type",
ADD COLUMN     "type" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."daily_snapshots" ADD COLUMN     "customTypesData" JSONB DEFAULT '{}';

-- DropEnum
DROP TYPE "public"."AccountType";

-- CreateIndex
CREATE INDEX "accounts_userId_type_idx" ON "public"."accounts"("userId", "type");

-- CreateIndex
CREATE INDEX "accounts_type_idx" ON "public"."accounts"("type");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_userId_type_key" ON "public"."accounts"("userId", "type");
