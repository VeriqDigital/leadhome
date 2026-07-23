import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((value) => value || null);

export const inboundLeadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().trim().toLowerCase().optional().nullable(),
  phone: optionalText(40),
  company: optionalText(120),
  message: optionalText(2000),
  estimatedValue: z.number().finite().min(0).max(999999999).optional().nullable(),
});

export const inboundSourceNameSchema = z.string().trim().min(2).max(100);
export const inboundSourceIdSchema = z.cuid();
export const idempotencyKeySchema = z.string().min(8).max(200);

export type InboundLeadInput = z.infer<typeof inboundLeadSchema>;
