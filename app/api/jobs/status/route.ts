import { z } from "zod";
import { auth } from "@/auth";
import { getLatestGmailSyncJob } from "@/lib/jobs/service";
import { reportOperationalError } from "@/lib/server-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const accountIdSchema = z.string().cuid();

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return json({ error: "Unauthorized." }, 401);
  }

  const parsed = accountIdSchema.safeParse(
    new URL(request.url).searchParams.get("accountId"),
  );
  if (!parsed.success) {
    return json({ error: "A valid Gmail account is required." }, 400);
  }

  try {
    const job = await getLatestGmailSyncJob(session.user.id, parsed.data);
    return json({ job });
  } catch (error) {
    reportOperationalError("Gmail job status lookup failed", error);
    return json({ error: "Gmail sync status is unavailable." }, 500);
  }
}
