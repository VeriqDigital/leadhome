import { serverEnv } from "@/lib/env";

export const INBOUND_MAX_BODY_BYTES = 16 * 1024;
export const INBOUND_TOKEN_BYTES = 32;
export const INBOUND_RATE_WINDOW_SECONDS = 60;
export const INBOUND_RATE_LIMIT_DEFAULT = 20;

export function inboundRateLimit(): number {
  return serverEnv.INBOUND_RATE_LIMIT_PER_MINUTE ?? INBOUND_RATE_LIMIT_DEFAULT;
}
