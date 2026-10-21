import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  let parsedBody: unknown;

  try {
    parsedBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (parsedBody === null || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return Response.json({ error: "JSON body must be an object" }, { status: 400 });
  }

  const body = parsedBody as {
    id?: unknown;
    nps?: number;
    comment?: string;
    name?: string;
    email?: string;
    sessionId?: string;
  };

  const eventId = body.id;
  if (eventId !== undefined &&
      (typeof eventId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId))) {
    return Response.json({ error: "id must be a UUID v4" }, { status: 400 });
  }

  const nps = Number(body.nps);
  if (!Number.isInteger(nps) || nps < 0 || nps > 10) {
    return Response.json(
      { error: "nps must be an integer between 0 and 10" },
      { status: 400 }
    );
  }

  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 320) : "";
  const sessionId = typeof body.sessionId === "string" && body.sessionId
    ? body.sessionId
    : "anonymous";

  try {
    const { recordEvent } = await import("../../../../analytics/db.mjs");
    await recordEvent(sessionId, "feedback", {
      nps,
      comment: comment || undefined,
      name: name || undefined,
      email: email || undefined,
    }, eventId);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/feedback] Failed to record feedback:", message);
    return Response.json({ error: "Failed to record feedback" }, { status: 500 });
  }
}
