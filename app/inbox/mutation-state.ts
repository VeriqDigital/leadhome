export type CanonicalInboxControls = {
  id: string;
  leadId: string | null;
  lead: { id: string; name: string; email: string | null } | null;
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
