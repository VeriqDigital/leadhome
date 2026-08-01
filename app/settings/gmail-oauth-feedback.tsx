const gmailOAuthMessages: Record<
  string,
  { tone: "success" | "error" | "neutral"; message: string }
> = {
  connected: {
    tone: "success",
    message: "Gmail mailbox connected successfully.",
  },
  "already-connected": {
    tone: "neutral",
    message: "This Gmail mailbox is already connected to this workspace.",
  },
  conflict: {
    tone: "error",
    message: "This Gmail mailbox is already connected to another workspace.",
  },
  refresh: {
    tone: "error",
    message:
      "Google did not return the required offline access. Reconnect and approve access again.",
  },
  invalid: {
    tone: "error",
    message: "This Gmail connection request expired or is invalid. Please try again.",
  },
  provider: {
    tone: "error",
    message: "Google is temporarily unavailable. Please try connecting Gmail again.",
  },
  denied: {
    tone: "neutral",
    message: "Gmail authorization was not completed.",
  },
  configuration: {
    tone: "error",
    message:
      "Gmail could not be connected because of an unexpected configuration problem.",
  },
  persistence: {
    tone: "error",
    message:
      "Gmail authorization succeeded, but the connection could not be saved. Please try again.",
  },
  unexpected: {
    tone: "error",
    message: "Gmail could not be connected because of an unexpected problem.",
  },
  "already-starting": {
    tone: "neutral",
    message: "A Gmail connection is already starting. Please finish that request.",
  },
  disconnected: {
    tone: "success",
    message: "Gmail mailbox disconnected.",
  },
};

export function GmailOAuthFeedback({ result }: { result?: string }) {
  const feedback = result ? gmailOAuthMessages[result] : undefined;
  if (!feedback) return null;

  const toneClass =
    feedback.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
      : feedback.tone === "error"
        ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        : "border-black/10 bg-black/[0.03] text-[#4f5664] dark:text-[#c4c8d0]";

  return (
    <p role="status" className={`mb-4 rounded-xl border px-4 py-3 text-sm ${toneClass}`}>
      {feedback.message}
    </p>
  );
}
