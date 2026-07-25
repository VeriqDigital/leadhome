import { z } from "zod";
import { optionalTrimmedText } from "@/lib/schema-helpers";

export const inboundLeadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().trim().toLowerCase().optional().nullable(),
  phone: optionalTrimmedText(40),
  company: optionalTrimmedText(120),
  message: optionalTrimmedText(2000),
  estimatedValue: z.number().finite().min(0).max(999999999).optional().nullable(),
});

export const inboundSourceNameSchema = z.string().trim().min(2).max(100);
export const inboundSourceIdSchema = z.cuid();
export const idempotencyKeySchema = z.string().min(8).max(200);
