import { domainToASCII } from "node:url";

import { normalizeEmailAddresses } from "./participant-identity";

/*
 * This intentionally is not a partial Public Suffix List implementation.
 * Company inference fails closed outside an explicit, bounded set:
 *
 * - common single-label public suffixes used by business mail domains;
 * - common two-label public suffixes below the country-code registries listed
 *   in MULTI_LABEL_SUFFIX_TLDS.
 *
 * An unknown suffix, or an unknown second-level suffix below one of those
 * country-code registries, produces no company evidence.
 */
const SINGLE_LABEL_PUBLIC_SUFFIXES = new Set([
  "agency",
  "ai",
  "app",
  "at",
  "be",
  "biz",
  "ca",
  "ch",
  "cloud",
  "co",
  "com",
  "company",
  "cz",
  "de",
  "dev",
  "digital",
  "dk",
  "email",
  "es",
  "eu",
  "fi",
  "fr",
  "ie",
  "info",
  "io",
  "it",
  "me",
  "net",
  "nl",
  "no",
  "online",
  "org",
  "pl",
  "pt",
  "se",
  "site",
  "solutions",
  "store",
  "tech",
  "us",
  "xyz",
]);

const TWO_LABEL_PUBLIC_SUFFIXES = new Set([
  "co.id",
  "co.in",
  "co.jp",
  "co.ke",
  "co.kr",
  "co.nz",
  "co.uk",
  "co.za",
  "com.ar",
  "com.au",
  "com.br",
  "com.cn",
  "com.gh",
  "com.hk",
  "com.mx",
  "com.my",
  "com.ng",
  "com.ph",
  "com.pk",
  "com.pl",
  "com.sg",
  "com.tr",
  "com.tw",
  "com.ua",
  "firm.in",
  "gen.in",
  "ind.in",
  "ltd.uk",
  "me.uk",
  "ne.jp",
  "ne.kr",
  "net.ar",
  "net.au",
  "net.br",
  "net.cn",
  "net.hk",
  "net.in",
  "net.jp",
  "net.mx",
  "net.my",
  "net.nz",
  "net.ph",
  "net.pk",
  "net.sg",
  "net.tr",
  "net.tw",
  "net.ua",
  "net.za",
  "or.id",
  "or.jp",
  "or.kr",
  "org.ar",
  "org.au",
  "org.br",
  "org.cn",
  "org.hk",
  "org.in",
  "org.mx",
  "org.my",
  "org.nz",
  "org.ph",
  "org.pk",
  "org.sg",
  "org.tr",
  "org.tw",
  "org.ua",
  "org.uk",
  "org.za",
  "plc.uk",
  "web.id",
]);

const MULTI_LABEL_SUFFIX_TLDS = new Set(
  [...TWO_LABEL_PUBLIC_SUFFIXES].map(
    (suffix) => suffix.slice(suffix.lastIndexOf(".") + 1),
  ),
);

const COMMON_REGISTRY_SECOND_LEVEL_LABELS = new Set([
  "ac",
  "asso",
  "co",
  "com",
  "edu",
  "firm",
  "gen",
  "gob",
  "gov",
  "gv",
  "id",
  "ind",
  "ltd",
  "me",
  "ne",
  "net",
  "nom",
  "nome",
  "or",
  "org",
  "plc",
  "prd",
  "publ",
  "tm",
  "web",
]);

const BLOCKED_COMPANY_DOMAINS = new Set([
  // Public mailbox providers required by the company-detection boundary.
  "aol.com",
  "126.com",
  "163.com",
  "fastmail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "gmail.com",
  "googlemail.com",
  "hey.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mac.com",
  "mail.com",
  "mailbox.org",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "rocketmail.com",
  "tuta.com",
  "tutanota.com",
  "web.de",
  "yahoo.com",
  "yahoo.ca",
  "yahoo.co.jp",
  "yahoo.co.uk",
  "yahoo.de",
  "yahoo.es",
  "yahoo.fr",
  "yahoo.it",
  "ymail.com",
  "yandex.com",
  "yandex.ru",
  "zoho.com",

  // Common relay and email infrastructure domains.
  "amazonses.com",
  "anonaddy.me",
  "brevo.com",
  "customeriomail.com",
  "duck.com",
  "hubspotemail.net",
  "mailchimp.com",
  "mailjet.com",
  "mailgun.net",
  "mailgun.org",
  "mandrillapp.com",
  "postmarkapp.com",
  "privaterelay.appleid.com",
  "relay.firefox.com",
  "sendgrid.com",
  "sendgrid.net",
  "simplelogin.com",
  "sparkpostmail.com",

  // Bounded common disposable mailbox providers.
  "10minutemail.com",
  "disposablemail.com",
  "grr.la",
  "guerrillamail.com",
  "guerrillamailblock.com",
  "mailinator.com",
  "sharklasers.com",
  "temp-mail.org",
  "yopmail.com",

  // Shared hosting and tenant roots must not collapse distinct organizations
  // into one apparent business domain.
  "amazonaws.com",
  "appspot.com",
  "azurewebsites.net",
  "cloudfront.net",
  "co.com",
  "eu.com",
  "firebaseapp.com",
  "github.io",
  "gitlab.io",
  "herokuapp.com",
  "netlify.app",
  "onmicrosoft.com",
  "pages.dev",
  "uk.com",
  "us.com",
  "vercel.app",
  "web.app",
  "workers.dev",
]);

const BUSINESS_SUFFIX_WORDS = [
  "technologies",
  "construction",
  "landscaping",
  "healthcare",
  "properties",
  "consulting",
  "electrical",
  "automotive",
  "industries",
  "insurance",
  "solutions",
  "logistics",
  "financial",
  "technology",
  "restaurant",
  "marketing",
  "services",
  "plumbing",
  "roofing",
  "partners",
  "holdings",
  "property",
  "electric",
  "heating",
  "cooling",
  "systems",
  "capital",
  "finance",
  "realty",
  "design",
  "studio",
  "dental",
  "clinic",
  "motors",
  "foods",
  "media",
  "group",
  "health",
  "legal",
  "tech",
  "food",
  "home",
  "homes",
  "law",
] as const;

function normalizedDnsName(value: string) {
  const raw = value.trim().toLowerCase();
  if (!raw || raw.endsWith(".") || raw.length > 253) return null;
  const ascii = domainToASCII(raw);
  if (!ascii || ascii.length > 253) return null;
  const labels = ascii.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    return null;
  }
  return ascii;
}

function registrableDomain(value: string) {
  const domain = normalizedDnsName(value);
  if (!domain) return null;
  const labels = domain.split(".");
  const tld = labels.at(-1)!;
  const finalTwo = labels.slice(-2).join(".");

  if (TWO_LABEL_PUBLIC_SUFFIXES.has(finalTwo)) {
    return labels.length >= 3 ? labels.slice(-3).join(".") : null;
  }
  if (
    tld.length === 2 &&
    labels.length >= 3 &&
    COMMON_REGISTRY_SECOND_LEVEL_LABELS.has(labels.at(-2)!)
  ) {
    return null;
  }
  if (MULTI_LABEL_SUFFIX_TLDS.has(tld)) {
    return null;
  }
  if (!SINGLE_LABEL_PUBLIC_SUFFIXES.has(tld)) {
    return null;
  }
  return labels.slice(-2).join(".");
}

function hasConservativeLocalPart(email: string) {
  const separator = email.lastIndexOf("@");
  const localPart = email.slice(0, separator);
  return (
    separator > 0 &&
    localPart.length <= 64 &&
    !localPart.startsWith(".") &&
    !localPart.endsWith(".") &&
    !localPart.includes("..") &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)
  );
}

function hasSystemOnlyLocalPart(email: string) {
  const localPart = email
    .slice(0, email.lastIndexOf("@"))
    .split("+", 1)[0]
    .toLowerCase();
  return new Set([
    "do-not-reply",
    "donotreply",
    "mailer-daemon",
    "no-reply",
    "noreply",
    "postmaster",
  ]).has(localPart);
}

export function isBlockedCompanyDomain(domain: string) {
  const normalized = normalizedDnsName(domain);
  if (!normalized) return true;
  const canonical = registrableDomain(normalized);
  if (!canonical) return true;
  return [...BLOCKED_COMPANY_DOMAINS].some(
    (blocked) =>
      normalized === blocked ||
      normalized.endsWith(`.${blocked}`) ||
      canonical === blocked,
  );
}

export function businessDomainFromEmail(email: string) {
  const normalizedAddresses = normalizeEmailAddresses(email);
  if (normalizedAddresses.length !== 1) return null;
  const normalizedEmail = normalizedAddresses[0];
  if (
    !hasConservativeLocalPart(normalizedEmail) ||
    hasSystemOnlyLocalPart(normalizedEmail)
  ) {
    return null;
  }
  const domain = normalizedEmail.slice(normalizedEmail.lastIndexOf("@") + 1);
  if (isBlockedCompanyDomain(domain)) return null;
  const canonical = registrableDomain(domain);
  if (!canonical) return null;
  return canonical;
}

function displayWords(value: string) {
  const pieces: string[] = [];
  let remaining = value;

  while (remaining.length > 2) {
    const suffix = BUSINESS_SUFFIX_WORDS.find(
      (candidate) =>
        remaining.endsWith(candidate) &&
        remaining.length > candidate.length + 1,
    );
    if (!suffix) break;
    pieces.unshift(suffix);
    remaining = remaining.slice(0, -suffix.length);
  }
  pieces.unshift(remaining);

  return pieces
    .filter(Boolean)
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
    .join(" ");
}

export function formatCompanyFromDomain(domain: string) {
  const normalized = normalizedDnsName(domain);
  if (!normalized || isBlockedCompanyDomain(normalized)) return null;
  const canonical = registrableDomain(normalized);
  if (!canonical) return null;
  const labels = canonical.split(".");
  const suffixLength = TWO_LABEL_PUBLIC_SUFFIXES.has(
    labels.slice(-2).join("."),
  )
    ? 2
    : 1;
  const companyLabel = labels.at(-(suffixLength + 1));
  if (
    !companyLabel ||
    companyLabel.startsWith("xn--") ||
    !/[a-z]/.test(companyLabel)
  ) {
    return null;
  }

  const display = companyLabel
    .split("-")
    .filter(Boolean)
    .map(displayWords)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return display || null;
}
