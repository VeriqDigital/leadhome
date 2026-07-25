import type { LeadSource, LeadStatus } from "@prisma/client";

/** Safe persisted lead values returned to interactive client forms. */
export type CanonicalLead = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  status: LeadStatus;
  estimatedValue: string | null;
  nextFollowUp: string | null;
  message: string | null;
  updatedAt: string;
};

export type LeadFormValues = {
  name: string;
  email: string;
  phone: string;
  company: string;
  source: LeadSource;
  status: LeadStatus;
  message: string;
  estimatedValue: string;
  nextFollowUp: string;
};

export type LeadFormInput = Partial<
  Pick<LeadFormValues, "name" | "source" | "status">
> & {
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
  estimatedValue?: string | null;
  nextFollowUp?: string | null;
};
