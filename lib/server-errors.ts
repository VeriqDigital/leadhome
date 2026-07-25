import "server-only";

type ErrorSummary = {
  name: string;
  code?: string;
};

export function reportOperationalError(context: string, error: unknown) {
  const summary: ErrorSummary =
    error instanceof Error ? { name: error.name } : { name: "UnknownError" };
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    summary.code = error.code;
  }

  // Deliberately omit messages and stack traces because provider/database
  // errors can contain credentials, hashes, or submitted customer data.
  console.error(`[LeadHome] ${context}`, summary);
}
