-- AlterTable
ALTER TABLE "public"."daily_snapshots" ADD COLUMN     "autresFinSecondaire" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "freeMoneyFinSecondaire" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "liquideFinSecondaire" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "moneygramFinSecondaire" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "orangeMoneyFinSecondaire" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "ria2FinSecondaire" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "riaFinSecondaire" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "seddoFinSecondaire" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "uvMasterFinSecondaire" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "versementBankFinSecondaire" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "waveFinSecondaire" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "westernUnion2FinSecondaire" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "westernUnionFinSecondaire" BIGINT NOT NULL DEFAULT 0;
