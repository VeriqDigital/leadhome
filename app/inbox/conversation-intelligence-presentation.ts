import type { ConversationAnalysisOutput } from "@/lib/ai/conversation-analysis/schema";

export const SUMMARY_COLLAPSE_LENGTH = 280;
export const INITIAL_MISSING_INFORMATION_COUNT = 4;

export function normalizeAnalysisSummary(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^summary\s*:\s*/i, "")
    .trim();
}

function parseDateOnly(value: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

const dateOnlyFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatAnalysisTimeline(
  timeline: ConversationAnalysisOutput["timeline"],
) {
  const rawText = timeline.rawText?.replace(/\s+/g, " ").trim() ?? null;
  const targetDate = parseDateOnly(timeline.targetDate);
  if (!rawText && !targetDate) return null;
  if (!targetDate) return rawText;

  const formattedDate = dateOnlyFormatter.format(targetDate);
  if (!rawText) return formattedDate;

  const rawLower = rawText.toLocaleLowerCase();
  const month = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(targetDate);
  const day = String(targetDate.getUTCDate());
  const year = String(targetDate.getUTCFullYear());
  const alreadyNamesDate =
    rawLower.includes(month.toLocaleLowerCase()) &&
    new RegExp(`\\b${day}\\b`).test(rawText);

  if (alreadyNamesDate) {
    return rawText.includes(year) ? rawText : `${rawText}, ${year}`;
  }

  // Relative phrases are more useful than repeating their normalized date.
  if (
    /\b(next|within|in\s+\d+|this|tomorrow|today|end of|start of)\b/i.test(
      rawText,
    )
  ) {
    return rawText;
  }

  return formattedDate;
}

export function validEmailHref(value: string | null) {
  if (!value) return null;
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? `mailto:${email}`
    : null;
}

export function validPhoneHref(value: string | null) {
  if (!value) return null;
  const phone = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(phone)) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function contactText(contact: ConversationAnalysisOutput["contact"]) {
  return [contact.name, contact.email, contact.phone]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

export function buildAnalysisNotes(output: ConversationAnalysisOutput) {
  const sections: string[] = [
    `Summary:\n${normalizeAnalysisSummary(output.summary)}`,
  ];
  const add = (label: string, value: string | null) => {
    if (value) sections.push(`${label}:\n${value}`);
  };

  add("Company", output.company.value);
  add("Contact", contactText(output.contact) || null);
  add("Project", output.projectType.value);

  const budget =
    output.budget.rawText ??
    (output.budget.minimumAmount !== null ||
    output.budget.maximumAmount !== null
      ? [
          output.budget.currency,
          output.budget.minimumAmount !== null &&
          output.budget.maximumAmount !== null
            ? `${output.budget.minimumAmount}–${output.budget.maximumAmount}`
            : output.budget.minimumAmount !== null
              ? `${output.budget.minimumAmount} minimum`
              : `${output.budget.maximumAmount} maximum`,
        ]
          .filter(Boolean)
          .join(" ")
      : null);
  add("Budget", budget);
  add("Timeline", formatAnalysisTimeline(output.timeline));

  if (output.actionItems.length > 0) {
    sections.push(
      `Suggested actions:\n${output.actionItems
        .map((item) => `- ${item.title}${item.description ? ` — ${item.description}` : ""}`)
        .join("\n")}`,
    );
  }
  if (output.missingInformation.length > 0) {
    sections.push(
      `Information to clarify:\n${output.missingInformation
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );
  }
  return sections.join("\n\n");
}

export async function copyTextToClipboard(
  clipboard: Pick<Clipboard, "writeText"> | undefined,
  text: string,
) {
  if (!clipboard?.writeText) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
