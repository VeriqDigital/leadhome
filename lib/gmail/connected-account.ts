import "server-only";

import { prisma } from "@/lib/prisma";

export async function getConnectedGmailAddress(ownerId: string) {
  const account = await prisma.communicationAccount.findFirst({
    where: {
      ownerId,
      provider: "GMAIL",
      status: "CONNECTED",
      address: { not: null },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { address: true },
  });
  return account?.address?.trim() || null;
}
