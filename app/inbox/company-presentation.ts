import type { ConversationCompanyView } from "@/lib/messaging/company-detection-service";

export type CompanyPresentation = {
  attachedCompany: string | null;
  rowBadge: string | null;
};

export type CompanyPresentationLead = {
  id: string;
  name: string;
  company: string | null;
};

export function canonicalCompanyLead(
  view: ConversationCompanyView | null,
  persistedLead: CompanyPresentationLead | null,
) {
  return view ? view.lead : persistedLead;
}

function displayCompany(value: string | null | undefined) {
  const company = value?.trim();
  return company || null;
}

export function companyPresentation(
  view: ConversationCompanyView | null,
  persistedCompany: string | null = null,
): CompanyPresentation {
  const attachedCompany = displayCompany(
    view ? view.lead?.company : persistedCompany,
  );

  if (attachedCompany) {
    return {
      attachedCompany,
      rowBadge: attachedCompany,
    };
  }

  return {
    attachedCompany: null,
    rowBadge:
      view?.state === "SUGGESTED" && view.suggestion
        ? "Company suggested"
        : null,
  };
}
