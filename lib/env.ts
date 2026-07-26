import "server-only";

import { z } from "zod";

const serverEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required."),
  INBOUND_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_GMAIL_REDIRECT_URI: z.string().url().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().min(32).optional(),
});

const isTest = process.env.NODE_ENV === "test";
const parsedEnvironment = serverEnvironmentSchema.safeParse({
  DATABASE_URL:
    process.env.DATABASE_URL ||
    (isTest ? "postgresql://test:test@localhost:5432/leadhome_test" : undefined),
  AUTH_SECRET: process.env.AUTH_SECRET || (isTest ? "test-secret" : undefined),
  INBOUND_RATE_LIMIT_PER_MINUTE:
    process.env.INBOUND_RATE_LIMIT_PER_MINUTE || undefined,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || undefined,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || undefined,
  GOOGLE_GMAIL_REDIRECT_URI: process.env.GOOGLE_GMAIL_REDIRECT_URI || undefined,
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY || undefined,
});

if (!parsedEnvironment.success) {
  const details = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid server environment: ${details}`);
}

export const serverEnv = parsedEnvironment.data;
