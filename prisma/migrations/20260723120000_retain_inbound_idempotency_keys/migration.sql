DROP INDEX "InboundSubmission_expiresAt_idx";

ALTER TABLE "InboundSubmission" DROP COLUMN "expiresAt";
