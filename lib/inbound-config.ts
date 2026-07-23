export const INBOUND_ENDPOINT = "/api/inbound/forms";
export const INBOUND_MAX_BODY_BYTES = 16 * 1024;
export const INBOUND_TOKEN_BYTES = 32;
export const INBOUND_RATE_WINDOW_SECONDS = 60;
export const INBOUND_RATE_LIMIT_DEFAULT = 20;
export const INBOUND_IDEMPOTENCY_TTL_SECONDS = 5 * 60;

export function inboundRateLimit(): number {
  const configured = Number.parseInt(process.env.INBOUND_RATE_LIMIT_PER_MINUTE ?? "", 10);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : INBOUND_RATE_LIMIT_DEFAULT;
}
