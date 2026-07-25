import "server-only";

import { PrismaClient } from "@prisma/client";
import "@/lib/env";

declare global {
  var leadHomePrisma: PrismaClient | undefined;
}

export const prisma = globalThis.leadHomePrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalThis.leadHomePrisma = prisma;
