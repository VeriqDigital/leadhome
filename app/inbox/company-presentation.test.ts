import { describe, expect, it } from "vitest";
import type { ConversationCompanyView } from "@/lib/messaging/company-detection-service";
import {
  canonicalCompanyLead,
  companyPresentation,
} from "./company-presentation";

function companyView(
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
    state: "NO_SUGGESTION",
    suggestion: null,
    canRecheck: true,
    ...overrides,
  };
}

describe("canonical company presentation", () => {
  it("uses a canonical attached company in both the detail and row presentation", () => {
    expect(companyPresentation(companyView({
      lead: {
        id: "lead-a",
        name: "Alex Morgan",
        email: "alex@northstarroofing.com",
        company: "Northstar Roofing",
      },
      state: "COMPANY_PRESENT",
      canRecheck: false,
    }))).toEqual({
      attachedCompany: "Northstar Roofing",
      rowBadge: "Northstar Roofing",
    });
  });

  it("shows a suggestion badge without presenting the suggestion as saved data", () => {
    expect(companyPresentation(companyView({
      state: "SUGGESTED",
      suggestion: {
        value: "Northstar Roofing",
        source: "BUSINESS_DOMAIN",
        evidenceFingerprint: "fingerprint-a",
        evidenceSummary: "The external sender uses a business domain.",
        evidenceDetails: ["Sender: alex@northstarroofing.com"],
        automaticEligible: false,
      },
    }))).toEqual({
      attachedCompany: null,
      rowBadge: "Company suggested",
    });
  });

  it("uses the persisted company fallback for an unselected Inbox row", () => {
    expect(companyPresentation(null, " Acme Services ")).toEqual({
      attachedCompany: "Acme Services",
      rowBadge: "Acme Services",
    });
  });

  it("lets selected canonical state override a stale persisted fallback", () => {
    expect(companyPresentation(companyView(), "Stale Company")).toEqual({
      attachedCompany: null,
      rowBadge: null,
    });
  });

  it("uses one canonical lead snapshot when a parallel persisted read is stale", () => {
    const canonical = companyView({
      lead: {
        id: "lead-b",
        name: "Current Lead",
        email: "current@northstarroofing.com",
        company: "Northstar Roofing",
      },
      state: "COMPANY_PRESENT",
      canRecheck: false,
    });

    expect(canonicalCompanyLead(canonical, {
      id: "lead-a",
      name: "Stale Lead",
      company: "Stale Company",
    })).toEqual(canonical.lead);
  });

  it("shows neither company nor suggestion for an unattached conversation", () => {
    expect(companyPresentation(companyView({
      lead: null,
      state: "NOT_APPLICABLE",
      canRecheck: false,
    }))).toEqual({
      attachedCompany: null,
      rowBadge: null,
    });
  });
});
