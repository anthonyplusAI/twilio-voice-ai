import { NextRequest } from "next/server";
import twilio from "twilio";
import { getCallLimiter } from "@/lib/call-limiter.mjs";

const terminalStatuses = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);
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

  const incomingUrl = new URL(request.url);
  let publicUrl: string;
  try {
    const configured = process.env.PUBLIC_BASE_URL;
    if (!configured && process.env.NODE_ENV === "production") {
      throw new Error("PUBLIC_BASE_URL is required in production");
    }
    const origin = new URL(configured || request.url);
    if (configured && (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash)) {
      throw new Error("PUBLIC_BASE_URL must be an HTTPS origin");
    }
    publicUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, origin.origin).toString();
  } catch (error) {
    console.error("[api/call-status] Invalid public site URL:", error);
    return Response.json({ error: "Call status is temporarily unavailable" }, { status: 503 });
  }
  if (!twilio.validateRequest(authToken, signature, publicUrl, params)) {
    return Response.json({ error: "Invalid Twilio signature" }, { status: 403 });
  }
  if (params.AccountSid !== accountSid) {
    return Response.json({ error: "Wrong Twilio account" }, { status: 403 });
  }

  if (!terminalStatuses.has(params.CallStatus)) {
    return new Response(null, { status: 204 });
  }

  const reservationId = incomingUrl.searchParams.get("reservationId");
  const phoneNumber = params.To;
  const callSid = params.CallSid;
  if (!reservationId || !phoneNumber || !/^\+[1-9]\d{1,14}$/.test(phoneNumber) || !callSid) {
    return Response.json({ error: "Incomplete call callback" }, { status: 400 });
  }

  try {
    await getCallLimiter().complete(phoneNumber, reservationId, callSid);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[api/call-status] Failed to complete call reservation:", error);
    return Response.json({ error: "Call status is temporarily unavailable" }, { status: 503 });
  }
}
