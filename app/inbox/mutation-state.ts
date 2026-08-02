import type { ConversationCompanyView } from "@/lib/messaging/company-detection-service";
import type {
  ContactField,
  ConversationContactExtractionView,
} from "@/lib/messaging/contact-extraction-service";

export type CanonicalInboxControls = {
  id: string;
  leadId: string | null;
  lead: {
    id: string;
    name: string;
    email: string | null;
    company: string | null;
  } | null;
  classification:
    | "UNKNOWN"
    | "LEAD"
    | "CUSTOMER"
    | "NEWSLETTER"
    | "SPAM"
    | "INTERNAL"
    | "SYSTEM";
  reviewState: "NEEDS_REVIEW" | "MATCHED" | "IGNORED" | "RESOLVED";
  status: "OPEN" | "CLOSED" | "ARCHIVED";
  updatedAt: string;
};

export type InboxMutationState =
  | {
      success: true;
      changed: boolean;
      message: string;
      conversation: CanonicalInboxControls;
    }
  | {
      success: false;
      message: string;
      errors?: Record<string, string[]>;
    };

export const initialInboxMutationState: InboxMutationState = {
  success: false,
  message: "",
};

export type CompanyDetectionMutationState = {
  success: boolean;
  changed?: boolean;
  message: string;
  companyView?: ConversationCompanyView;
};

export const initialCompanyDetectionMutationState:
  CompanyDetectionMutationState = {
    success: false,
    message: "",
  };

export type ContactExtractionMutationState = {
  success: boolean;
  changed?: boolean;
  message: string;
  contactView?: ConversationContactExtractionView;
  appliedFields?: ContactField[];
  skippedFields?: ContactField[];
};

export const initialContactExtractionMutationState:
  ContactExtractionMutationState = {
    success: false,
    message: "",
  };
