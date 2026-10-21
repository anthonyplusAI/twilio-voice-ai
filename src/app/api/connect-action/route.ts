import { NextRequest } from "next/server";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import twilio from "twilio";

const MAX_CALLBACK_BYTES = 16 * 1024;

class CallbackBodyTooLarge extends Error {}

async function readCallbackParams(request: NextRequest): Promise<Record<string, string>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing callback body");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_CALLBACK_BYTES) {
      await reader.cancel().catch(() => {});
      throw new CallbackBodyTooLarge();
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return Object.fromEntries(new URLSearchParams(body + decoder.decode()).entries());
}

function publicCallbackUrl(request: NextRequest): string {
  const configured = process.env.PUBLIC_BASE_URL;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_BASE_URL is required in production");
  }
  const origin = new URL(configured || request.url);
  if (configured && (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash)) {
    throw new Error("PUBLIC_BASE_URL must be an HTTPS origin");
  }
  const incoming = new URL(request.url);
  if (incoming.pathname !== "/api/connect-action") throw new Error("Wrong Explorer action path");
  return new URL(`${incoming.pathname}${incoming.search}`, origin.origin).toString();
}

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  if (!authToken || !accountSid) {
    return Response.json({ error: "Server is missing Twilio credentials" }, { status: 503 });
  }

  const signature = request.headers.get("x-twilio-signature") || "";
  if (!signature) {
    return Response.json({ error: "Invalid Twilio signature" }, { status: 403 });
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
    !== "application/x-www-form-urlencoded") {
    return Response.json({ error: "Expected a form callback" }, { status: 415 });
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength))) {
      return Response.json({ error: "Invalid callback body length" }, { status: 400 });
    }
    if (Number(contentLength) > MAX_CALLBACK_BYTES) {
      return Response.json({ error: "Callback body is too large" }, { status: 413 });
    }
  }

  let params: Record<string, string>;
  try {
    params = await readCallbackParams(request);
  } catch (error) {
    if (error instanceof CallbackBodyTooLarge) {
      return Response.json({ error: "Callback body is too large" }, { status: 413 });
    }
    return Response.json({ error: "Invalid callback body" }, { status: 400 });
  }

  let callbackUrl: string;
  try {
    callbackUrl = publicCallbackUrl(request);
  } catch (error) {
    console.error("[api/connect-action] Invalid public site URL:", error);
    return Response.json({ error: "Explorer action is temporarily unavailable" }, { status: 503 });
  }
  if (!twilio.validateRequest(authToken, signature, callbackUrl, params)) {
    return Response.json({ error: "Invalid Twilio signature" }, { status: 403 });
  }
  if (params.AccountSid !== accountSid) {
    return Response.json({ error: "Wrong Twilio account" }, { status: 403 });
  }

  let handoffData: { reasonCode?: string; reason?: string } | null = null;

  try {
    const rawHandoff = params.HandoffData;
    if (rawHandoff) {
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
    const phone = destination ? parsePhoneNumberFromString(destination) : null;
    if (!destination || !/^\+[1-9]\d{1,14}$/.test(destination)
      || !phone?.isValid() || !["US", "CA"].includes(phone.country || "")
      || ["PREMIUM_RATE", "SHARED_COST"].includes(phone.getType() || "")) {
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
  <Dial timeLimit="60">${destination}</Dial>
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
