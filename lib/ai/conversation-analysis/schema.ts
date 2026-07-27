import { z } from "zod";

const confidence = z.number().min(0).max(1);
const evidence = z.array(z.number().int().positive().max(10_000)).max(20);
const nullableText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable();

const companySchema = z.object({
  value: nullableText(240),
  confidence,
  evidenceMessageOrdinals: evidence,
}).strict();

const contactSchema = z.object({
  name: nullableText(200),
  email: z.string().trim().email().max(320).nullable(),
  phone: nullableText(80),
  confidence,
  evidenceMessageOrdinals: evidence,
}).strict();

const projectTypeSchema = z.object({
  value: nullableText(240),
  confidence,
  evidenceMessageOrdinals: evidence,
}).strict();

const budgetSchema = z.object({
  minimumAmount: z.number().nonnegative().max(1_000_000_000_000).nullable(),
  maximumAmount: z.number().nonnegative().max(1_000_000_000_000).nullable(),
  currency: nullableText(12),
  rawText: nullableText(240),
  confidence,
  evidenceMessageOrdinals: evidence,
}).strict().superRefine((budget, context) => {
  if (
    budget.minimumAmount !== null &&
    budget.maximumAmount !== null &&
    budget.maximumAmount < budget.minimumAmount
  ) {
    context.addIssue({
      code: "custom",
      message: "Maximum budget cannot be lower than minimum budget.",
      path: ["maximumAmount"],
    });
  }
});

const isoDate = z.iso.date();

const timelineSchema = z.object({
  targetDate: isoDate.nullable(),
  rawText: nullableText(240),
  confidence,
  evidenceMessageOrdinals: evidence,
}).strict();

const sentimentSchema = z.object({
  value: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE", "MIXED", "UNKNOWN"]),
  confidence,
}).strict();

export const conversationActionItemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: nullableText(1_000),
  owner: z.enum(["USER", "CONTACT", "UNKNOWN"]),
  dueDate: isoDate.nullable(),
  confidence,
  evidenceMessageOrdinals: evidence,
}).strict();

export const conversationAnalysisOutputSchema = z.object({
  summary: z.string().trim().min(1).max(1_600),
  company: companySchema,
  contact: contactSchema,
  projectType: projectTypeSchema,
  budget: budgetSchema,
  timeline: timelineSchema,
  sentiment: sentimentSchema,
  actionItems: z.array(conversationActionItemSchema).max(8),
  missingInformation: z.array(
    z.string().trim().min(1).max(160),
  ).max(12),
}).strict();

export type ConversationAnalysisOutput = z.infer<
  typeof conversationAnalysisOutputSchema
>;

export function parseConversationAnalysisOutput(
  value: unknown,
  includedMessageCount?: number,
) {
  const parsed = conversationAnalysisOutputSchema.parse(value);
  if (includedMessageCount === undefined) return parsed;
  const allEvidence = [
    parsed.company.evidenceMessageOrdinals,
    parsed.contact.evidenceMessageOrdinals,
    parsed.projectType.evidenceMessageOrdinals,
    parsed.budget.evidenceMessageOrdinals,
    parsed.timeline.evidenceMessageOrdinals,
    ...parsed.actionItems.map((item) => item.evidenceMessageOrdinals),
  ].flat();
  if (
    allEvidence.some(
      (ordinal) => ordinal < 1 || ordinal > includedMessageCount,
    )
  ) {
    throw new z.ZodError([{
      code: "custom",
      path: ["evidenceMessageOrdinals"],
      message: "Evidence references a message outside the supplied input.",
    }]);
  }
  return parsed;
}
