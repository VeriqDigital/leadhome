import { TaskPriority, TaskStatus, TaskType } from "@prisma/client";
import { z } from "zod";
import { optionalTrimmedText } from "@/lib/schema-helpers";

const optionalId = z
  .union([z.literal(""), z.cuid()])
  .optional()
  .transform((value) => value || null);

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(160),
  description: optionalTrimmedText(2000),
  type: z.enum(TaskType),
  priority: z.enum(TaskPriority),
  status: z.enum(TaskStatus).default("OPEN"),
  dueAt: z
    .union([
      z.literal(""),
      z.iso.datetime({ offset: true }),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid due date."),
    ])
    .optional()
    .transform((value, context) => {
      if (!value) return null;
      // Date-only tasks are stored at local noon to preserve their calendar day.
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T12:00:00`)
        : new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        context.addIssue({
          code: "custom",
          message: "Enter a valid due date.",
        });
        return z.NEVER;
      }
      return parsed;
    }),
  leadId: optionalId,
  conversationId: optionalId,
});

// Legacy follow-up tasks use a deterministic prefix plus the original Lead CUID.
// Keep this narrow while allowing normal app-created CUID task IDs.
export const taskIdSchema = z.union([
  z.cuid(),
  z.string().regex(/^legacy-follow-up-c[a-z0-9]{24}$/),
]);
export type TaskInput = z.infer<typeof taskInputSchema>;

export function taskValues(formData: FormData) {
  return {
    title: formData.get("title"),
    description: formData.get("description"),
    type: formData.get("type"),
    priority: formData.get("priority"),
    status: formData.get("status") || "OPEN",
    dueAt: formData.get("dueAt"),
    leadId: formData.get("leadId"),
    conversationId: formData.get("conversationId"),
  };
}
