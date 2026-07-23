import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { INBOUND_TOKEN_BYTES } from "@/lib/inbound-config";

export function generateSourceToken(): string {
  return randomBytes(INBOUND_TOKEN_BYTES).toString("base64url");
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashesMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
