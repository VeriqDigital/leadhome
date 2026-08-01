import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationCompanyView } from "@/lib/messaging/company-detection-service";
import { CompanySuggestion } from "./company-suggestion";

const actions = vi.hoisted(() => ({
  initialCompanyDetectionMutationState: {
    success: false,
    message: "",
  },
  mutateConversationCompanyAction: vi.fn(),
}));
const hooks = vi.hoisted(() => ({
  actionState: actions.initialCompanyDetectionMutationState as {
    success: boolean;
    changed?: boolean;
    message: string;
    companyView?: ConversationCompanyView;
  },
  pending: false,
  submittedIntent: null as "APPLY" | "DISMISS" | "RECHECK" | null,
  refresh: vi.fn(),
}));

vi.mock("@/app/actions/inbox-actions", () => actions);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: hooks.refresh }),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: () => [
      hooks.actionState,
      actions.mutateConversationCompanyAction,
      hooks.pending,
    ],
    useEffect: (effect: () => void) => effect(),
    useState: () => [hooks.submittedIntent, vi.fn()],
  };
});

function view(
  overrides: Partial<ConversationCompanyView> = {},
): ConversationCompanyView {
  return {
    conversationId: "conversation-a",
    lead: {
      id: "lead-a",
      name: "Alex Morgan",
      email: "alex@northstarroofing.com",
      company: null,
    },
    state: "SUGGESTED",
    suggestion: {
      value: "Northstar Roofing",
      source: "BUSINESS_DOMAIN",
      evidenceFingerprint: "fingerprint-a",
      evidenceSummary: "The external sender uses a business email domain.",
      evidenceDetails: [
        "Sender: alex@northstarroofing.com",
        "Domain: northstarroofing.com",
      ],
      automaticEligible: false,
    },
    canRecheck: true,
    ...overrides,
  };
}

function render(companyView: ConversationCompanyView | null) {
  return renderToStaticMarkup(
    <CompanySuggestion initialView={companyView} />,
  );
}

describe("company suggestion Inbox UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.actionState = actions.initialCompanyDetectionMutationState;
    hooks.pending = false;
    hooks.submittedIntent = null;
  });

  it("labels the attached lead and company separately", () => {
    const inboxPage = readFileSync(
      new URL("./page.tsx", import.meta.url),
      "utf8",
    );

    expect(inboxPage).toContain("Lead name:");
    expect(inboxPage).toContain("Company name:");
    expect(inboxPage).not.toContain("Attached lead:");
  });

  it("renders suggestion evidence and one canonical mutation form", () => {
    const markup = render(view());
    const globalStyles = readFileSync(
      new URL("../globals.css", import.meta.url),
      "utf8",
    );

    expect(markup).toContain("Suggested company");
    expect(markup).toContain("Northstar Roofing");
    expect(markup).toContain("Detected from sender domain");
    expect(markup).toContain("Inspect evidence");
    expect(markup).toContain("The external sender uses a business email domain.");
    expect(markup.match(/<form/g)).toHaveLength(1);
    expect(markup).toContain('name="conversationId"');
    expect(markup).toContain('value="conversation-a"');
    expect(markup).toContain('name="expectedLeadId"');
    expect(markup).toContain('value="lead-a"');
    expect(markup).toContain('name="evidenceFingerprint"');
    expect(markup).toContain('value="fingerprint-a"');
    expect(markup).toContain('name="intent"');
    expect(markup).toContain('value="APPLY"');
    expect(markup).toContain('value="DISMISS"');
    expect(markup).toContain('value="RECHECK"');
    expect(markup).toContain('aria-label="Apply company"');
    expect(markup).toContain("company-apply-button");
    expect(globalStyles).toContain(
      ".dark .inbox-shell .company-apply-button",
    );
    expect(globalStyles).toContain("background: #fbbf24 !important");
    expect(globalStyles).toContain("color: #1c1400 !important");
    expect(markup).toContain('aria-label="Dismiss company suggestion"');
    expect(markup).toContain('aria-label="Recheck company"');
  });

  it.each([
    {
      source: "DOMAIN_ASSOCIATION" as const,
      label: "Matched from a known company domain",
    },
    {
      source: "STRUCTURED_ANALYSIS" as const,
      label: "Detected from structured conversation details",
    },
    {
      source: "BUSINESS_DOMAIN" as const,
      label: "Detected from sender domain",
    },
  ])("describes $source evidence clearly", ({ source, label }) => {
    expect(render(view({
      suggestion: {
        ...view().suggestion!,
        source,
      },
    }))).toContain(label);
  });

  it("renders an accessible recheck when there is no active suggestion", () => {
    const markup = render(view({
      state: "NO_SUGGESTION",
      suggestion: null,
    }));

    expect(markup).toContain("Company not detected");
    expect(markup).toContain('aria-label="Recheck company"');
    expect(markup).toContain('name="intent"');
    expect(markup).toContain('value="RECHECK"');
    expect(markup).not.toContain('name="evidenceFingerprint"');
    expect(markup).not.toContain("Apply company");
  });

  it("hides controls for unattached leads, existing companies, and non-recheckable states", () => {
    expect(render(view({
      lead: null,
      state: "NOT_APPLICABLE",
      suggestion: null,
      canRecheck: false,
    }))).toBe("");
    expect(render(view({
      lead: {
        ...view().lead!,
        company: "Northstar Roofing",
      },
      state: "COMPANY_PRESENT",
      suggestion: null,
      canRecheck: false,
    }))).toBe("");
    expect(render(view({
      state: "NO_SUGGESTION",
      suggestion: null,
      canRecheck: false,
    }))).toBe("");
  });

  it.each([
    {
      intent: "APPLY" as const,
      pendingLabel: "Applying…",
      accessibleName: "Applying company",
    },
    {
      intent: "DISMISS" as const,
      pendingLabel: "Dismissing…",
      accessibleName: "Dismissing company suggestion",
    },
  ])(
    "shows only the $intent pending label and disables every mutation control",
    ({ intent, pendingLabel, accessibleName }) => {
      hooks.pending = true;
      hooks.submittedIntent = intent;

      const markup = render(view());

      expect(markup).toContain(`aria-label="${accessibleName}"`);
      expect(markup).toContain(pendingLabel);
      expect(markup.match(/disabled=""/g)).toHaveLength(3);
      expect(markup).toContain('aria-busy="true"');
    },
  );

  it("shows Recheck pending state alongside an active suggestion", () => {
    hooks.pending = true;
    hooks.submittedIntent = "RECHECK";

    const markup = render(view());

    expect(markup).toContain('aria-label="Checking company"');
    expect(markup).toContain("Checking…");
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
  });

  it("shows a checking state and disables recheck while pending", () => {
    hooks.pending = true;
    hooks.submittedIntent = "RECHECK";

    const markup = render(view({
      state: "NO_SUGGESTION",
      suggestion: null,
    }));

    expect(markup).toContain('aria-label="Checking company"');
    expect(markup).toContain("Checking…");
    expect(markup.match(/disabled=""/g)).toHaveLength(1);
  });

  it("refreshes server-rendered state whenever a mutation returns a canonical view", () => {
    hooks.actionState = {
      success: true,
      changed: true,
      message: "Company applied.",
      companyView: view({
        lead: {
          ...view().lead!,
          company: "Northstar Roofing",
        },
        state: "COMPANY_PRESENT",
        suggestion: null,
        canRecheck: false,
      }),
    };

    render(view());

    expect(hooks.refresh).toHaveBeenCalledTimes(1);
  });

  it("announces action results without replacing canonical company state locally", () => {
    hooks.actionState = {
      success: false,
      message: "The lead or company changed before this request was completed.",
    };

    const markup = render(view());

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(
      "The lead or company changed before this request was completed.",
    );
    expect(markup).toContain("Northstar Roofing");
  });
});
