CREATE TABLE "InboundSource" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InboundSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InboundRateLimit" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "ipHash" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InboundRateLimit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InboundSubmission" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "idempotencyHash" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundSource_tokenHash_key" ON "InboundSource"("tokenHash");
CREATE INDEX "InboundSource_userId_createdAt_idx" ON "InboundSource"("userId", "createdAt");
CREATE UNIQUE INDEX "InboundRateLimit_sourceId_ipHash_windowStart_key" ON "InboundRateLimit"("sourceId", "ipHash", "windowStart");
CREATE INDEX "InboundRateLimit_windowStart_idx" ON "InboundRateLimit"("windowStart");
CREATE UNIQUE INDEX "InboundSubmission_sourceId_idempotencyHash_key" ON "InboundSubmission"("sourceId", "idempotencyHash");
CREATE INDEX "InboundSubmission_expiresAt_idx" ON "InboundSubmission"("expiresAt");
CREATE INDEX "InboundSubmission_leadId_idx" ON "InboundSubmission"("leadId");

ALTER TABLE "InboundSource" ADD CONSTRAINT "InboundSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundRateLimit" ADD CONSTRAINT "InboundRateLimit_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "InboundSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundSubmission" ADD CONSTRAINT "InboundSubmission_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "InboundSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundSubmission" ADD CONSTRAINT "InboundSubmission_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
