import "server-only";
import { prisma } from "@/lib/prisma";
import { generateSourceToken, hashSecret } from "@/lib/inbound-crypto";

export async function createInboundSource(userId: string, name: string) {
  const token = generateSourceToken();
  const source = await prisma.inboundSource.create({
    data: { userId, name, tokenHash: hashSecret(token) },
    select: { id: true, name: true },
  });
  return { ...source, token };
}

export async function rotateInboundSource(userId: string, sourceId: string) {
  const token = generateSourceToken();
  const result = await prisma.inboundSource.updateMany({
    where: { id: sourceId, userId },
    data: { tokenHash: hashSecret(token) },
  });
  return result.count === 1 ? token : null;
}

export function setInboundSourceActive(userId: string, sourceId: string, isActive: boolean) {
  return prisma.inboundSource.updateMany({
    where: { id: sourceId, userId },
    data: { isActive },
  });
}

export function deleteInboundSource(userId: string, sourceId: string) {
  return prisma.inboundSource.deleteMany({ where: { id: sourceId, userId } });
}

export async function createInboundTestLead(userId: string, sourceId: string) {
  const source = await prisma.inboundSource.findFirst({
    where: { id: sourceId, userId, isActive: true },
    select: { id: true, name: true },
  });
  if (!source) return null;

  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        userId,
        name: "LeadHome Test Lead",
        email: "test@leadhome.local",
        message: "Test submission from Website Sources settings",
        source: "WEBSITE",
        status: "NEW",
      },
      select: { id: true },
    });
    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        userId,
        type: "WEBSITE_SUBMISSION_RECEIVED",
        title: "Website submission received",
        description: `Received from ${source.name}`,
        metadata: {
          inboundSourceId: source.id,
          inboundSourceName: source.name,
          email: "test@leadhome.local",
        },
      },
    });
    return lead;
  });
}
