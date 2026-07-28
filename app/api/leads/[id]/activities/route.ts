import { z } from "zod";
import { auth } from "@/auth";
import {
  isSupportedTimeZone,
  presentActivities,
} from "@/lib/activity-presentation";
import { getLeadActivityPage } from "@/lib/activity-service";
import { reportOperationalError } from "@/lib/server-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idSchema = z.string().cuid();
const cursorSchema = z.string().min(1).max(200);
const nowSchema = z.string().datetime({ offset: true });
const timeZoneSchema = z.string().min(1).max(100);

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "Unauthorized." }, 401);
  const { id } = await context.params;
  const searchParams = new URL(request.url).searchParams;
  const cursor = searchParams.get("cursor");
  const nowParam = searchParams.get("now");
  const timeZoneParam = searchParams.get("timeZone");
  if (
    !idSchema.safeParse(id).success ||
    (cursor && !cursorSchema.safeParse(cursor).success) ||
    (nowParam && !nowSchema.safeParse(nowParam).success) ||
    (timeZoneParam &&
      (!timeZoneSchema.safeParse(timeZoneParam).success ||
        !isSupportedTimeZone(timeZoneParam)))
  ) {
    return json({ error: "A valid activity page is required." }, 400);
  }
  try {
    const page = await getLeadActivityPage({
      ownerId: session.user.id,
      leadId: id,
      cursor,
    });
    return page
      ? json({
          items: presentActivities({
            activities: page.items,
            now: nowParam ?? new Date(),
            timeZone: timeZoneParam ?? "UTC",
          }),
          nextCursor: page.nextCursor,
        })
      : json({ error: "Activity history was not found." }, 404);
  } catch (error) {
    reportOperationalError("lead activity page lookup failed", error);
    return json({ error: "Activity history is temporarily unavailable." }, 500);
  }
}
