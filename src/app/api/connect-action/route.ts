import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  let handoffData: { reasonCode?: string; reason?: string } | null = null;

  try {
    const formData = await request.formData();
    const rawHandoff = formData.get("HandoffData");
    if (rawHandoff && typeof rawHandoff === "string") {
      handoffData = JSON.parse(rawHandoff);
    }
  } catch {
    // No handoff data or parse error — normal call end
  }

  if (handoffData?.reasonCode === "live-agent-handoff") {
    console.log(
      `[connect-action] Handoff requested: ${handoffData.reason || "no reason provided"}`
    );
    const destination = process.env.HANDOFF_PHONE_NUMBER?.trim();
    if (!destination || !/^\+[1-9]\d{1,14}$/.test(destination)) {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, live handoff is unavailable right now. Goodbye.</Say>
  <Hangup/>
</Response>`, {
        headers: { "Content-Type": "application/xml" },
      });
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please hold while we connect you to an agent.</Say>
  <Dial>${destination}</Dial>
</Response>`;

    return new Response(twiml.trim(), {
      headers: { "Content-Type": "application/xml" },
    });
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for calling. Goodbye.</Say>
  <Hangup/>
</Response>`;

  return new Response(twiml.trim(), {
    headers: { "Content-Type": "application/xml" },
  });
}
