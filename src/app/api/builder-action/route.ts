import { NextRequest } from "next/server";
import twilio from "twilio";
import { readBuilderActionToken } from "@/lib/builder-action-token.mjs";
import { parseBuilderActionTwiml } from "@/lib/builder-twiml.mjs";

const MAX_CALLBACK_BYTES = 16 * 1024;
const MAX_TWIML_BYTES = 64 * 1024;
const unavailableTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>Sorry, the live handoff is unavailable. Goodbye.</Say><Hangup/></Response>`;

async function readText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response body");
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("Response is too large");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
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
  if (incoming.pathname !== "/api/builder-action") throw new Error("Wrong Builder action path");
  return new URL(`${incoming.pathname}${incoming.search}`, origin.origin).toString();
}

function twimlResponse(xml: string): Response {
  return new Response(xml, {
    headers: { "Content-Type": "application/xml", "Cache-Control": "no-store" },
  });
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
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return Response.json({ error: "Invalid action callback content type" }, { status: 415 });
  }
  if (Number(request.headers.get("content-length")) > MAX_CALLBACK_BYTES) {
    return Response.json({ error: "Action callback body is too large" }, { status: 413 });
  }

  let rawForm: string;
  try {
    const bodyResponse = new Response(request.body);
    rawForm = await readText(bodyResponse, MAX_CALLBACK_BYTES);
  } catch {
    return Response.json({ error: "Invalid action callback body" }, { status: 413 });
  }
  const form = new URLSearchParams(rawForm);
  const params = Object.fromEntries(form.entries());

  let callbackUrl: string;
  try {
    callbackUrl = publicCallbackUrl(request);
  } catch (error) {
    console.error("[api/builder-action] Invalid public site URL:", error);
    return Response.json({ error: "Builder action is temporarily unavailable" }, { status: 503 });
  }
  if (!twilio.validateRequest(authToken, signature, callbackUrl, params)) {
    return Response.json({ error: "Invalid Twilio signature" }, { status: 403 });
  }

  const token = new URL(request.url).searchParams.get("token");
  const details = readBuilderActionToken(token, authToken);
  if (!details || params.AccountSid !== accountSid
    || !params.CallSid || params.To !== details.phoneNumber) {
    return Response.json({ error: "Invalid Builder action" }, { status: 403 });
  }
  if (!details.actionUrl) return twimlResponse("<Response><Hangup/></Response>");

  try {
    const response = await fetch(details.actionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Builder action returned HTTP ${response.status}`);
    const xml = await readText(response, MAX_TWIML_BYTES);
    return twimlResponse(parseBuilderActionTwiml(xml));
  } catch (error) {
    console.error("[api/builder-action] Rejected Builder action TwiML:", error);
    return twimlResponse(unavailableTwiml);
  }
}
