import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationContactExtractionView } from "@/lib/messaging/contact-extraction-service";
import { ContactSuggestions } from "./contact-suggestions";

const actions = vi.hoisted(() => ({
  initialContactExtractionMutationState: {
    success: false,
    message: "",
  },
  mutateConversationContactAction: vi.fn(),
}));
const hooks = vi.hoisted(() => ({
  actionState: actions.initialContactExtractionMutationState as {
    success: boolean;
    changed?: boolean;
    message: string;
    contactView?: ConversationContactExtractionView;
    appliedFields?: Array<"name" | "email" | "phone">;
    skippedFields?: Array<"name" | "email" | "phone">;
  },
  pending: false,
  submittedCommand: null as string | null,
}));

vi.mock("@/app/actions/inbox-actions", () => actions);
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: () => [
      hooks.actionState,
      actions.mutateConversationContactAction,
      hooks.pending,
    ],
    useState: () => [hooks.submittedCommand, vi.fn()],
  };
});

const evidenceEmail = "a".repeat(64);
const reviewEmail = "b".repeat(64);
const evidencePhone = "c".repeat(64);
const reviewPhone = "d".repeat(64);

function view(
  overrides: Partial<ConversationContactExtractionView> = {},
): ConversationContactExtractionView {
  return {
    conversationId: "conversation-a",
    lead: {
      id: "lead-a",
      name: "Alex Morgan",
      email: null,
      phone: null,
    },
    state: "READY",
    suggestions: [
      {
        field: "email",
        candidateValue: "alex@northstarroofing.com",
        currentValue: null,
        source: "external_sender",
        reasonCode: "EXTERNAL_SENDER_EMAIL",
        explanation: "Found on the external sender.",
        evidenceFingerprint: evidenceEmail,
        reviewFingerprint: reviewEmail,
        conflict: false,
      },
    ],
    ambiguous: false,
    ambiguousFields: [],
    refreshing: false,
    reviewFingerprint: reviewEmail,
    canRecheck: true,
    evaluatedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function phoneSuggestion(conflict = true) {
  return {
    field: "phone" as const,
    candidateValue: "+1 312 555 0175",
    currentValue: conflict ? "+1 312 555 0100" : null,
    source: "conversation_analysis" as const,
    reasonCode: "ANALYSIS_CONTACT_PHONE" as const,
    explanation: "Found in reviewed conversation analysis.",
    evidenceFingerprint: evidencePhone,
    reviewFingerprint: reviewPhone,
    conflict,
  };
}

function render(contactView: ConversationContactExtractionView | null) {
  return renderToStaticMarkup(
    <ContactSuggestions initialView={contactView} />,
  );
}

describe("reviewed contact extraction Inbox UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.actionState = actions.initialContactExtractionMutationState;
    hooks.pending = false;
    hooks.submittedCommand = null;
  });

  it("reads only the selected conversation and places review after controls", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain(
      "selectedId\n        ? getConversationContactExtractionView(user.id, selectedId)",
    );
    expect(source.indexOf("<ContactSuggestions")).toBeGreaterThan(
      source.indexOf("<ConversationControls"),
    );
    expect(source.indexOf("<ContactSuggestions")).toBeLessThan(
      source.indexOf("<ConversationIntelligenceCard"),
    );
  });

  it("shows current and suggested values with a closed individual action contract", () => {
    const markup = render(view());

    expect(markup).toContain("Reviewed contact extraction");
    expect(markup).toContain("Current");
    expect(markup).toContain("Not set");
    expect(markup).toContain("Suggested");
    expect(markup).toContain("alex@northstarroofing.com");
    expect(markup).toContain("Found on the external sender.");
    expect(markup).toContain('name="conversationId"');
    expect(markup).toContain('name="expectedLeadId"');
    expect(markup).toContain('name="field" value="email"');
    expect(markup).toContain('name="evidenceFingerprint"');
    expect(markup).toContain('name="reviewFingerprint"');
    expect(markup).toContain('value="APPLY"');
    expect(markup).toContain('aria-label="Apply suggested email"');
    expect(markup).toContain("action-primary");
    expect(markup).toContain("dark:bg-[#17181c]");
    expect(markup).toContain("dark:text-white");
    expect(markup).toContain("sm:flex-row");
    expect(markup).toContain("[overflow-wrap:anywhere]");
    expect(markup).not.toContain('name="candidateValue"');
    expect(markup).not.toContain('name="source"');
    expect(markup).not.toContain('name="ownerId"');
  });

  it("requires an explicit replacement decision for a conflicting field", () => {
    const markup = render(view({ suggestions: [phoneSuggestion()] }));

    expect(markup).toContain("+1 312 555 0100");
    expect(markup).toContain("+1 312 555 0175");
    expect(markup).toContain("Conflict — applying this suggestion replaces the current value.");
    expect(markup).toContain('value="REPLACE"');
    expect(markup).toContain('aria-label="Replace current phone"');
    expect(markup).toContain("Replace current value");
    expect(markup).not.toContain('value="APPLY_ALL"');
  });

  it("offers bounded bulk decisions only when multiple active suggestions qualify", () => {
    const markup = render(view({
      suggestions: [view().suggestions[0], phoneSuggestion()],
    }));

    expect(markup).toContain('value="APPLY_ALL"');
    expect(markup).toContain("Apply available fields");
    expect(markup).toContain('value="DISMISS_ALL"');
    expect(markup).toContain("Dismiss all");

    const applyAvailableForm = markup.match(
      /<form[^>]*>(?:(?!<\/form>)[\s\S])*value="APPLY_ALL"(?:(?!<\/form>)[\s\S])*<\/form>/,
    )?.[0];
    const dismissAllForm = markup.match(
      /<form[^>]*>(?:(?!<\/form>)[\s\S])*value="DISMISS_ALL"(?:(?!<\/form>)[\s\S])*<\/form>/,
    )?.[0];
    expect(applyAvailableForm?.match(/name="reviewFingerprint"/g)).toHaveLength(1);
    expect(applyAvailableForm).toContain(`value="${reviewEmail}"`);
    expect(applyAvailableForm).not.toContain(`value="${reviewPhone}"`);
    expect(dismissAllForm?.match(/name="reviewFingerprint"/g)).toHaveLength(2);

    const conflictsOnly = render(view({
      suggestions: [
        { ...view().suggestions[0], currentValue: "old@example.com", conflict: true },
        phoneSuggestion(),
      ],
    }));
    expect(conflictsOnly).not.toContain('value="APPLY_ALL"');
    expect(conflictsOnly).toContain('value="DISMISS_ALL"');

    const single = render(view());
    expect(single).not.toContain('value="APPLY_ALL"');
    expect(single).not.toContain('value="DISMISS_ALL"');
  });

  it("renders the panel for active suggestions or a canonical explanation", () => {
    expect(render(view({
      state: "NO_SUGGESTIONS",
      suggestions: [],
      reviewFingerprint: null,
    }))).toBe("");
    expect(render(view({
      lead: null,
      state: "NOT_APPLICABLE",
      suggestions: [],
      reviewFingerprint: null,
      canRecheck: false,
    }))).toBe("");

    const ambiguous = render(view({
      state: "AMBIGUOUS",
      suggestions: [],
      ambiguous: true,
      ambiguousFields: ["name"],
      reviewFingerprint: null,
    }));
    expect(ambiguous).toContain("Reviewed contact extraction");
    expect(ambiguous).toContain("Conflicting contact identity detected");
    expect(ambiguous).toContain("Confirm the contact manually.");
  });

  it("shows deterministic evidence without actions while analysis is active", () => {
    const markup = render(view({
      state: "REFRESHING",
      refreshing: true,
      reviewFingerprint: null,
    }));

    expect(markup).toContain("Contact details will refresh after analysis completes.");
    expect(markup).toContain("alex@northstarroofing.com");
    expect(markup).toContain("Available after analysis");
    expect(markup).not.toContain('value="APPLY"');
    expect(markup).not.toContain('value="DISMISS"');
    expect(markup).not.toContain('value="RECHECK"');
  });

  it("keeps an unambiguous phone actionable beside a name conflict", () => {
    const markup = render(view({
      state: "PARTIAL",
      ambiguous: true,
      ambiguousFields: ["name"],
      suggestions: [phoneSuggestion(false)],
    }));

    expect(markup).toContain("Phone number available to review");
    expect(markup).toContain("Conflicting contact identity detected.");
    expect(markup).toContain("+1 312 555 0175");
    expect(markup).toContain('value="APPLY"');
  });

  it("disables every control and announces the submitted command while pending", () => {
    hooks.pending = true;
    hooks.submittedCommand = "REPLACE:phone";

    const markup = render(view({ suggestions: [phoneSuggestion()] }));

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-label="Replacing current phone"');
    expect(markup).toContain("Replacing…");
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
  });

  it("gives a pending dismissal an accessible name", () => {
    hooks.pending = true;
    hooks.submittedCommand = "DISMISS:email";

    const markup = render(view());

    expect(markup).toContain(
      'aria-label="Dismissing email suggestion"',
    );
    expect(markup).toContain("Dismissing…");
  });

  it("renders returned canonical state immediately and announces results", () => {
    const canonical = view({
      lead: {
        ...view().lead!,
        email: "alex@northstarroofing.com",
      },
      state: "NO_SUGGESTIONS",
      suggestions: [],
      reviewFingerprint: null,
      canRecheck: false,
    });
    hooks.actionState = {
      success: true,
      changed: true,
      message: "Contact detail applied.",
      contactView: canonical,
      appliedFields: ["email"],
      skippedFields: [],
    };

    const markup = render(canonical);

    expect(markup).toContain('role="status"');
    expect(markup).toContain("Contact detail applied.");
    expect(markup).toContain("Updated lead contact");
    expect(markup).toContain("alex@northstarroofing.com");
    expect(markup).not.toContain("Reviewed contact extraction");
  });

  it("prefers a newer canonical prop over a prior action result", () => {
    hooks.actionState = {
      success: true,
      changed: true,
      message: "Earlier contact update completed.",
      contactView: view({
        state: "NO_SUGGESTIONS",
        suggestions: [],
        reviewFingerprint: null,
      }),
    };
    const latest = view({ suggestions: [phoneSuggestion()] });

    const markup = render(latest);

    expect(markup).toContain("+1 312 555 0175");
    expect(markup).toContain("Replace current value");
    expect(markup).not.toContain("alex@northstarroofing.com");
    expect(markup).not.toContain("Earlier contact update completed.");
  });

  it("clears old action feedback when canonical state enters reanalysis", () => {
    hooks.actionState = {
      success: true,
      changed: true,
      message: "Earlier contact update completed.",
      contactView: view(),
    };
    const refreshing = view({
      state: "REFRESHING",
      refreshing: true,
      reviewFingerprint: null,
    });

    const markup = render(refreshing);

    expect(markup).toContain("Contact details will refresh after analysis completes.");
    expect(markup).not.toContain("Earlier contact update completed.");
    expect(markup).not.toContain('value="APPLY"');
  });

  it("keeps a dismissed suggestion absent after canonical refresh", () => {
    const dismissed = view({
      state: "NO_SUGGESTIONS",
      suggestions: [],
      reviewFingerprint: null,
    });
    hooks.actionState = {
      success: true,
      changed: true,
      message: "Contact suggestion dismissed.",
      contactView: dismissed,
    };

    const markup = render(dismissed);

    expect(markup).toContain("Contact suggestion dismissed.");
    expect(markup).not.toContain("Reviewed contact extraction");
    expect(markup).not.toContain("alex@northstarroofing.com");
  });

  it("shows deterministic suggestions without implying Intelligence ran", () => {
    const markup = render(view());

    expect(markup).toContain("Found on the external sender.");
    expect(markup).not.toContain("Conversation analysis");
    expect(markup).not.toContain("Enable Conversation Intelligence");
  });

  it("announces stale results and displays the newest canonical conflict", () => {
    const latest = view({ suggestions: [phoneSuggestion()] });
    hooks.actionState = {
      success: false,
      changed: false,
      message: "The attached lead or contact evidence changed.",
      contactView: latest,
    };

    const markup = render(latest);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("The attached lead or contact evidence changed.");
    expect(markup).toContain("Replace current value");
    expect(markup).not.toContain("alex@northstarroofing.com");
  });
});
