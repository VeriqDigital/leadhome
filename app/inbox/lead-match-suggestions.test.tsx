import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LeadMatchCandidate,
  LeadMatchResult,
} from "@/lib/messaging/matching-service";
import { LeadMatchSuggestions } from "./lead-match-suggestions";

const actions = vi.hoisted(() => ({
  allowConversationMatchingAgainAction: vi.fn(),
  attachInboxAction: vi.fn(),
  dismissConversationMatchAction: vi.fn(),
  recheckConversationMatchesAction: vi.fn(),
}));
const hooks = vi.hoisted(() => ({
  call: 0,
  pending: [false, false, false, false] as boolean[],
}));

vi.mock("@/app/actions/inbox-actions", () => actions);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: (
      action: (payload: FormData) => void,
      initialState: unknown,
    ) => {
      const index = hooks.call++;
      return [initialState, action, hooks.pending[index] ?? false];
    },
    useEffect: vi.fn(),
  };
});

const candidate = (
  overrides: Partial<LeadMatchCandidate> = {},
): LeadMatchCandidate => ({
  leadId: "lead-a",
  name: "Mick Enev",
  email: "mick@example.com",
  company: "Veriq",
  confidence: "HIGH",
  reasonCodes: ["EXACT_SENDER_EMAIL"],
  reasons: ["Exact sender email"],
  matchedEvidence: ["EMAIL"],
  rankingInputs: {
    deterministicEvidence: 1,
    exactName: 0,
    normalizedName: "mick enev",
    stableId: "lead-a",
  },
  evidenceFingerprint: "fingerprint-a",
  ...overrides,
});

function render(
  match: LeadMatchResult | null,
  canRecheck = true,
  manuallyDetached = false,
) {
  hooks.call = 0;
  return renderToStaticMarkup(
    <LeadMatchSuggestions
      conversationId="conversation-a"
      match={match}
      canRecheck={canRecheck}
      manuallyDetached={manuallyDetached}
    />,
  );
}

describe("Smart Lead Match Inbox UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.call = 0;
    hooks.pending = [false, false, false, false];
  });

  it("renders an exact match with explainable evidence and the canonical lead controls", () => {
    const exact: LeadMatchResult = {
      kind: "MATCHED",
      automaticMatch: candidate(),
      possibleMatches: [],
      noMatch: null,
      reason: "Exact sender email",
      evidenceFingerprint: "conversation-fingerprint",
    };

    const markup = render(exact);

    expect(markup).toContain("Exact match found");
    expect(markup).toContain("Mick Enev");
    expect(markup).toContain("Veriq");
    expect(markup).toContain("mick@example.com");
    expect(markup).toContain("Exact sender email");
    expect(markup).toContain('aria-label="Why Mick Enev was suggested"');
    expect(markup).toContain("Attach to lead");
    expect(markup).toContain('name="conversationId"');
    expect(markup).toContain('value="conversation-a"');
    expect(markup).toContain('name="leadId"');
    expect(markup).toContain('value="lead-a"');
    expect(markup).toContain('href="/leads/lead-a"');
    expect(markup).toContain("Inspect lead");
    expect(markup).toContain('href="#attached-lead-control"');
    expect(markup).toContain("Choose another lead");
  });

  it("renders a bounded possible-match list without implying certainty", () => {
    const possible: LeadMatchResult = {
      kind: "AMBIGUOUS",
      automaticMatch: null,
      possibleMatches: [
        candidate({
          confidence: "MEDIUM",
          reasonCodes: ["MULTIPLE_LEADS_SHARE_EMAIL"],
          reasons: ["Multiple leads share this email"],
        }),
        candidate({
          leadId: "lead-b",
          name: "Mick Enev (West)",
          email: null,
          company: null,
          confidence: "LOW",
          reasonCodes: ["EXACT_PARTICIPANT_NAME"],
          reasons: ["Exact participant name"],
          matchedEvidence: ["NAME"],
          evidenceFingerprint: "fingerprint-b",
          rankingInputs: {
            deterministicEvidence: 0,
            exactName: 1,
            normalizedName: "mick enev west",
            stableId: "lead-b",
          },
        }),
      ],
      noMatch: null,
      reason: "Possible lead matches found",
      evidenceFingerprint: "conversation-fingerprint",
    };

    const markup = render(possible);

    expect(markup).toContain("Possible match");
    expect(markup).toContain("Review these suggestions before attaching a lead.");
    expect(markup).toContain("Multiple leads share this email");
    expect(markup).toContain("Exact participant name");
    expect(markup).toContain('href="/leads/lead-a"');
    expect(markup).toContain('href="/leads/lead-b"');
    expect(markup.match(/Attach to lead/g)).toHaveLength(2);
    expect(markup.match(/Dismiss suggestion/g)).toHaveLength(2);
  });

  it("renders a no-match state as a safe bounded recheck instead of a candidate", () => {
    const noMatch: LeadMatchResult = {
      kind: "NO_MATCH",
      automaticMatch: null,
      possibleMatches: [],
      noMatch: {
        code: "NO_CREDIBLE_MATCH",
        reason: "No credible lead match was found",
      },
      reason: "No credible lead match was found",
      evidenceFingerprint: "conversation-fingerprint",
    };

    const markup = render(noMatch);

    expect(markup).toContain(
      "Check this conversation against your current leads.",
    );
    expect(markup).toContain("Recheck matches");
    expect(markup).not.toContain("Attach to lead");
    expect(markup).not.toContain("Inspect lead");
    expect(render(noMatch, false)).toBe("");
  });

  it("renders an accessible recovery control only for a manual detach", () => {
    const detached: LeadMatchResult = {
      kind: "NO_MATCH",
      automaticMatch: null,
      possibleMatches: [],
      noMatch: {
        code: "MANUALLY_DETACHED",
        reason: "Conversation was manually detached",
      },
      reason: "Conversation was manually detached",
      evidenceFingerprint: "conversation-fingerprint",
    };

    const markup = render(detached, false, true);

    expect(markup).toContain(
      "Automatic matching is paused because this conversation was manually detached.",
    );
    expect(markup).toContain('aria-label="Allow matching again"');
    expect(markup).toContain("Allow matching again");
    expect(markup).not.toContain("Recheck matches");

    hooks.pending = [false, false, false, true];
    const pending = render(detached, false, true);
    expect(pending).toContain("Allowing matching…");
    expect(pending).toMatch(
      /<button[^>]*aria-label="Allow matching again"[^>]*disabled=""/,
    );
  });

  it("disables actions and exposes a clear label while each request is pending", () => {
    const possible: LeadMatchResult = {
      kind: "AMBIGUOUS",
      automaticMatch: null,
      possibleMatches: [candidate()],
      noMatch: null,
      reason: "Possible lead match",
      evidenceFingerprint: "conversation-fingerprint",
    };

    hooks.pending = [true, false, false, false];
    const attaching = render(possible);
    expect(attaching).toContain("Attaching…");
    expect(attaching).toMatch(/<button disabled=""[^>]*>Attaching…<\/button>/);

    hooks.pending = [false, true, false, false];
    const dismissing = render(possible);
    expect(dismissing).toContain("Dismissing…");
    expect(dismissing).toMatch(
      /<button disabled=""[^>]*>Dismissing…<\/button>/,
    );

    hooks.pending = [false, false, true, false];
    const rechecking = render(possible);
    expect(rechecking).toContain("Checking…");
    expect(rechecking).toMatch(
      /<button[^>]*disabled=""[^>]*>Checking…<\/button>/,
    );
  });

  it("integrates only a bounded read evaluation into Inbox rendering", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain(
      "evaluateStoredConversationMatch(user.id, selectedId)",
    );
    expect(source).toContain("<LeadMatchSuggestions");
    expect(source).toContain(
      "conversationMatchPresentation({",
    );
    expect(source).toContain(
      "{presentation.badge && <Badge text={presentation.badge}/>",
    );
    expect(source).not.toContain("reevaluateConversationLeadMatch(");
    expect(source).not.toContain("dismissConversationLeadMatch(");
  });

  it("uses Recheck matches consistently for every recheck control", () => {
    const possible: LeadMatchResult = {
      kind: "AMBIGUOUS",
      automaticMatch: null,
      possibleMatches: [candidate()],
      noMatch: null,
      reason: "Possible match",
      evidenceFingerprint: "conversation-fingerprint",
    };
    const markup = render(possible);

    expect(markup).toContain('aria-label="Recheck matches"');
    expect(markup).toContain(">Recheck matches</button>");
    expect(markup).not.toContain(">Recheck</button>");
  });
});
