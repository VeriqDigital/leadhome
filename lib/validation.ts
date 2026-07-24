import { LeadSource, LeadStatus } from "@prisma/client";
import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => value || null);
export const credentialsSchema = z.object({ email: z.email("Enter a valid email address.").trim().toLowerCase(), password: z.string().min(1, "Enter your password.") });
export const registerSchema = credentialsSchema.extend({ name: z.string().trim().min(2, "Name must be at least 2 characters.").max(80), password: z.string().min(8, "Password must be at least 8 characters.").regex(/[A-Za-z]/, "Password must contain a letter.").regex(/[0-9]/, "Password must contain a number.") });
export const leadSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120), email: z.union([z.literal(""), z.email("Enter a valid email.")]).transform((value) => value || null),
  phone: optionalText(40), company: optionalText(120), source: z.enum(LeadSource), status: z.enum(LeadStatus), message: optionalText(2000),
  estimatedValue: z.union([z.literal(""), z.coerce.number().min(0, "Value cannot be negative.").max(999999999)]).transform((value) => value === "" ? null : value),
  nextFollowUpDate: z.string().optional().transform((value) => value ? new Date(`${value}T12:00:00`) : null),
});
export const leadIdSchema = z.cuid();
export type CanonicalLead = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  status: LeadStatus;
  estimatedValue: string | null;
  nextFollowUp: string | null;
  message: string | null;
  updatedAt: string;
};
export type ActionState = {
  success?: boolean;
  changed?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
  lead?: CanonicalLead;
};
