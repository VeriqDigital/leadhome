import { z } from "zod";
import { auth } from "@/auth";
import { getConversationAnalysisJob } from "@/lib/jobs/service";
import { reportOperationalError } from "@/lib/server-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const jobIdSchema = z.string().cuid();

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

  const parsed = jobIdSchema.safeParse(
    new URL(request.url).searchParams.get("jobId"),
  );
  if (!parsed.success) {
    return json({ error: "A valid conversation analysis job is required." }, 400);
  }

  try {
    const job = await getConversationAnalysisJob(
      session.user.id,
      parsed.data,
    );
    return json({ job });
  } catch (error) {
    reportOperationalError("Conversation analysis job status lookup failed", error);
    return json(
      { error: "Conversation analysis status is unavailable." },
      500,
    );
  }
}
