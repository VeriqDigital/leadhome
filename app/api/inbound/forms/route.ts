import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { INBOUND_RATE_WINDOW_SECONDS, inboundRateLimit } from "@/lib/inbound-config";
import { hashSecret, hashesMatch } from "@/lib/inbound-crypto";
import { bearerToken, BodyTooLargeError, readLimitedJson, requestIp } from "@/lib/inbound-request";
import { idempotencyKeySchema, inboundLeadSchema } from "@/lib/inbound-validation";

export const runtime = "nodejs";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

function json(body: object, status: number, extraHeaders?: Record<string, string>) {
  return Response.json(body, { status, headers: { ...responseHeaders, ...extraHeaders } });
}

const unauthorized = () => json({ success: false, error: "Unauthorized" }, 401);

export async function POST(request: Request) {
  // Browser-to-API submissions are intentionally disabled. Tokens belong only on servers.
  if (request.headers.has("origin")) {
    return json({ success: false, error: "Browser requests are not allowed" }, 403);
  }

  const token = bearerToken(request);
  if (!token) return unauthorized();

  try {
    const candidateHash = hashSecret(token);
    const source = await prisma.inboundSource.findUnique({
      where: { tokenHash: candidateHash },
      select: { id: true, userId: true, name: true, tokenHash: true, isActive: true },
    });
    if (!source?.isActive || !hashesMatch(candidateHash, source.tokenHash)) {
      return unauthorized();
    }

    const now = new Date();
    const windowMs = INBOUND_RATE_WINDOW_SECONDS * 1000;
    const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const ipHash = hashSecret(requestIp(request));
    await prisma.inboundRateLimit.deleteMany({
      where: { sourceId: source.id, windowStart: { lt: windowStart } },
    });
    const rate = await prisma.inboundRateLimit.upsert({
      where: { sourceId_ipHash_windowStart: { sourceId: source.id, ipHash, windowStart } },
      create: { sourceId: source.id, ipHash, windowStart },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
    if (rate.count > inboundRateLimit()) {
      return json(
        { success: false, error: "Too many requests" },
        429,
        { "Retry-After": String(INBOUND_RATE_WINDOW_SECONDS) },
      );
    }

    let rawPayload: unknown;
    try {
      rawPayload = await readLimitedJson(request);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return json({ success: false, error: "Request body too large" }, 413);
      }
      return json({ success: false, error: "Malformed JSON" }, 400);
    }
    const payload = inboundLeadSchema.safeParse(rawPayload);
    if (!payload.success) {
      return json({ success: false, error: "Invalid payload" }, 400);
    }

    const rawIdempotencyKey = request.headers.get("idempotency-key");
    const parsedKey = rawIdempotencyKey
      ? idempotencyKeySchema.safeParse(rawIdempotencyKey)
      : null;
    if (parsedKey && !parsedKey.success) {
      return json({ success: false, error: "Invalid idempotency key" }, 400);
    }
    const idempotencyHash = parsedKey?.success ? hashSecret(parsedKey.data) : null;

    if (idempotencyHash) {
      const existing = await prisma.inboundSubmission.findUnique({
        where: { sourceId_idempotencyHash: { sourceId: source.id, idempotencyHash } },
        select: { leadId: true },
      });
      if (existing) {
        return json({ success: true, id: existing.leadId, deduplicated: true }, 200);
      }
    }

    const createLead = async (tx: Prisma.TransactionClient) => {
      const created = await tx.lead.create({
        data: {
          ...payload.data,
          userId: source.userId,
          source: "WEBSITE",
          status: "NEW",
        },
        select: { id: true },
      });
      await tx.leadActivity.create({
        data: {
          leadId: created.id,
          userId: source.userId,
          type: "WEBSITE_SUBMISSION_RECEIVED",
          title: "Website submission received",
          description: `Received from ${source.name}`,
          metadata: {
            inboundSourceId: source.id,
            inboundSourceName: source.name,
            estimatedValue: payload.data.estimatedValue ?? null,
            company: payload.data.company ?? null,
            email: payload.data.email ?? null,
            phone: payload.data.phone ?? null,
          },
        },
      });
      return created;
    };

    let lead: { id: string };
    if (idempotencyHash) {
      try {
        lead = await prisma.$transaction(async (tx) => {
          const created = await createLead(tx);
          await tx.inboundSubmission.create({
            data: {
              sourceId: source.id,
              idempotencyHash,
              leadId: created.id,
            },
          });
          return created;
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await prisma.inboundSubmission.findUnique({
            where: { sourceId_idempotencyHash: { sourceId: source.id, idempotencyHash } },
            select: { leadId: true },
          });
          if (existing) {
            return json({ success: true, id: existing.leadId, deduplicated: true }, 200);
          }
        }
        throw error;
      }
    } else {
      lead = await prisma.$transaction(createLead);
    }

    return json({ success: true, id: lead.id, deduplicated: false }, 201);
  } catch {
    return json({ success: false, error: "Unable to process request" }, 500);
  }
}
