import { describe, expect, it } from "vitest";

import {
  businessDomainFromEmail,
  formatCompanyFromDomain,
  isBlockedCompanyDomain,
} from "./email-domain";

describe("business email domains", () => {
  it("normalizes ordinary subdomains to a registrable business domain", () => {
    expect(businessDomainFromEmail(
      "Alex <alex@mail.sales.northstarroofing.com>",
    )).toBe("northstarroofing.com");
    expect(businessDomainFromEmail("alex@updates.northstar.co.uk"))
      .toBe("northstar.co.uk");
  });

  it("fails closed for malformed DNS names and unknown suffix boundaries", () => {
    for (const email of [
      "missing-at.example.com",
      "alex@-northstar.com",
      "alex@northstar..com",
      "alex..sales@northstar.com",
      "alex@northstar.invalid",
      "alex@northstar.unknown.uk",
      "alex@localhost",
      "noreply+campaign@northstar.com",
    ]) {
      expect(businessDomainFromEmail(email), email).toBeNull();
    }
  });

  it("excludes every required public mailbox provider", () => {
    for (const domain of [
      "gmail.com",
      "googlemail.com",
      "outlook.com",
      "hotmail.com",
      "live.com",
      "msn.com",
      "yahoo.com",
      "icloud.com",
      "me.com",
      "aol.com",
      "proton.me",
      "protonmail.com",
    ]) {
      expect(businessDomainFromEmail(`person@${domain}`), domain).toBeNull();
      expect(isBlockedCompanyDomain(domain), domain).toBe(true);
    }
  });

  it("blocks provider subdomains and bounded relay or disposable domains", () => {
    expect(isBlockedCompanyDomain("mail.gmail.com")).toBe(true);
    expect(isBlockedCompanyDomain("events.mailgun.org")).toBe(true);
    expect(businessDomainFromEmail("person@notify.sendgrid.net")).toBeNull();
    expect(businessDomainFromEmail("person@inbox.mailinator.com")).toBeNull();
    expect(isBlockedCompanyDomain("northstarroofing.com")).toBe(false);
  });

  it("fails closed for shared tenant roots and additional public infrastructure", () => {
    for (const email of [
      "person@tenant.onmicrosoft.com",
      "person@tenant.github.io",
      "person@tenant.co.com",
      "person@mail.com",
      "person@gmx.net",
      "person@ymail.com",
      "person@mac.com",
      "person@tuta.com",
      "person@zoho.com",
      "person@yahoo.fr",
      "person@events.postmarkapp.com",
      "person@news.customeriomail.com",
      "person@tenant.com.es",
      "person@tenant.asso.fr",
      "person@tenant.com.pt",
      "person@tenant.co.at",
    ]) {
      expect(businessDomainFromEmail(email), email).toBeNull();
    }
    expect(formatCompanyFromDomain("privaterelay.appleid.com")).toBeNull();
    expect(formatCompanyFromDomain("tenant.github.io")).toBeNull();
  });

  it("formats only canonical business domains as suggestion labels", () => {
    expect(formatCompanyFromDomain("northstarroofing.com"))
      .toBe("Northstar Roofing");
    expect(formatCompanyFromDomain("mail.north-star-construction.com"))
      .toBe("North Star Construction");
    expect(formatCompanyFromDomain("northstar.co.uk")).toBe("Northstar");
    expect(formatCompanyFromDomain("gmail.com")).toBeNull();
    expect(formatCompanyFromDomain("northstar.unknown.uk")).toBeNull();
  });
});
