ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "name" DROP NOT NULL;

CREATE TABLE "Account" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "refresh_token" TEXT,
  "access_token" TEXT,
  "expires_at" INTEGER,
  "token_type" TEXT,
  "scope" TEXT,
  "id_token" TEXT,
  "session_state" TEXT,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "CommunicationAccountStatus" AS ENUM ('CONNECTED', 'RECONNECT_REQUIRED', 'DISCONNECTED');
ALTER TABLE "CommunicationAccount"
  ADD COLUMN "status" "CommunicationAccountStatus" NOT NULL DEFAULT 'CONNECTED',
  ADD COLUMN "grantedScopes" TEXT,
  ADD COLUMN "tokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncError" TEXT,
  ADD COLUMN "disconnectedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "CommunicationAccount_provider_providerAccountId_key" ON "CommunicationAccount"("provider", "providerAccountId");

CREATE TABLE "GmailCredential" (
  "id" TEXT NOT NULL,
  "communicationAccountId" TEXT NOT NULL,
  "encryptedRefreshToken" TEXT NOT NULL,
  "encryptedAccessToken" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GmailCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GmailCredential_communicationAccountId_key" ON "GmailCredential"("communicationAccountId");
ALTER TABLE "GmailCredential" ADD CONSTRAINT "GmailCredential_communicationAccountId_fkey" FOREIGN KEY ("communicationAccountId") REFERENCES "CommunicationAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OAuthState" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthState_tokenHash_key" ON "OAuthState"("tokenHash");
CREATE INDEX "OAuthState_userId_expiresAt_idx" ON "OAuthState"("userId", "expiresAt");
