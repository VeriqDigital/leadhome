import "server-only";

import { z } from "zod";

const serverEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required."),
  INBOUND_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().optional(),
});

const isTest = process.env.NODE_ENV === "test";
const parsedEnvironment = serverEnvironmentSchema.safeParse({
  DATABASE_URL:
    process.env.DATABASE_URL ||
    (isTest ? "postgresql://test:test@localhost:5432/leadhome_test" : undefined),
  AUTH_SECRET: process.env.AUTH_SECRET || (isTest ? "test-secret" : undefined),
  INBOUND_RATE_LIMIT_PER_MINUTE:
    process.env.INBOUND_RATE_LIMIT_PER_MINUTE || undefined,
});

if (!parsedEnvironment.success) {
  const details = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid server environment: ${details}`);
}

export const serverEnv = parsedEnvironment.data;
