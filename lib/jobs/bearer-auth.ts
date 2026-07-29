import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function hasValidBearerSecret(
  request: Request,
  expectedSecret: string | null,
): boolean {
  if (!expectedSecret) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization) return false;
  return timingSafeEqual(
    digest(authorization),
    digest(`Bearer ${expectedSecret}`),
  );
}
