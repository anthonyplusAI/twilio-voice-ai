import { NextRequest } from "next/server";
import twilio from "twilio";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { validateBuilderTwimlUrl, type CallTarget } from "@/lib/call-target";
import { getCallLimiter } from "@/lib/call-limiter.mjs";
import { createBuilderActionToken } from "@/lib/builder-action-token.mjs";
import { parseBuilderTwiml, renderBuilderTwiml } from "@/lib/builder-twiml.mjs";

const MAX_CALL_REQUEST_BYTES = 32 * 1024;
const MAX_CONCURRENT_BUILDER_PREFLIGHTS = 64;
let activeBuilderPreflights = 0;

class CallRequestTooLarge extends Error {}

async function readCallBody(request: NextRequest): Promise<unknown> {
  const declaredBytes = Number(request.headers.get("content-length"));
  if (declaredBytes > MAX_CALL_REQUEST_BYTES) throw new CallRequestTooLarge();

  const reader = request.body?.getReader();
  if (!reader) throw new Error("Empty call body");
  const decoder = new TextDecoder();
  let body = "";
  let bytesRead = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytesRead += chunk.value.byteLength;
    if (bytesRead > MAX_CALL_REQUEST_BYTES) {
      await reader.cancel();
      throw new CallRequestTooLarge();
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return JSON.parse(body + decoder.decode());
}

async function fetchBuilderTwiml(twimlUrl: string): Promise<string> {
  const url = new URL(twimlUrl);
  // A brand-new Quick Tunnel can briefly return 530 while its edge registers.
  const attempts = url.hostname.toLowerCase().endsWith(".trycloudflare.com") ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "CallSid=CApreflight",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty TwiML response");
      const decoder = new TextDecoder();
      let xml = "";
      let bytesRead = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytesRead += chunk.value.byteLength;
        if (bytesRead > 64 * 1024) {
          await reader.cancel();
          throw new Error("TwiML response is too large");
        }
        xml += decoder.decode(chunk.value, { stream: true });
      }
      xml += decoder.decode();
      return xml;
    } catch {
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }

  throw new Error("Your Codespace tunnel is not serving the workshop agent. Keep npm run dev running, run tunnel-url again, and paste its new /twiml URL.");
}

export async function POST(request: NextRequest) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !twilioPhoneNumber) {
    return Response.json(
      { error: "Server is missing Twilio credentials" },
      { status: 500 }
    );
  }

  let rawBody: unknown;

  try {
    rawBody = await readCallBody(request);
  } catch (error) {
    const tooLarge = error instanceof CallRequestTooLarge;
    return Response.json(
      { error: tooLarge ? "Call request is too large" : "Invalid JSON body" },
      { status: tooLarge ? 413 : 400 }
    );
  }

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return Response.json({ error: "Call body must be an object" }, { status: 400 });
  }

  const body = rawBody as {
    phoneNumber?: unknown;
    twimlUrl?: unknown;
    target?: CallTarget;
    sessionId?: string;
    agentConfig?: {
      agentName?: string;
      voice?: string;
      ttsProvider?: string;
      language?: string;
      personality?: string;
      welcomeGreeting?: string;
      enabledTools?: string;
      handoffEnabled?: string;
    };
  };

  const phoneNumber = typeof body.phoneNumber === "string"
    ? body.phoneNumber.trim()
    : "";
  if (!phoneNumber) {
    return Response.json(
      { error: "phoneNumber is required" },
      { status: 400 }
    );
  }

  if (!/^\+[1-9]\d{1,14}$/.test(phoneNumber)) {
    return Response.json(
      { error: "Use +1 followed by your 10-digit US or Canadian phone number." },
      { status: 400 }
    );
  }

  const destination = parsePhoneNumberFromString(phoneNumber);
  if (!destination?.isValid() || !["US", "CA"].includes(destination.country || "")) {
    return Response.json(
      { error: "Call Me currently supports US and Canadian phone numbers only." },
      { status: 400 }
    );
  }
  if (["PREMIUM_RATE", "SHARED_COST"].includes(destination.getType() || "")) {
    return Response.json(
      { error: "Premium-rate or shared-cost numbers are not supported." },
      { status: 400 }
    );
  }

  const hasBuilderUrl = Object.prototype.hasOwnProperty.call(body, "twimlUrl");
  if (body.target !== "builder" && body.target !== "built-in") {
    return Response.json({ error: "Select a call target (builder or built-in)" }, { status: 400 });
  }
  if (body.target === "built-in" && hasBuilderUrl) {
    return Response.json(
      { error: "A built-in call cannot use a Builder TwiML URL" },
      { status: 400 }
    );
  }
  if (body.target === "built-in" && !process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "The hosted voice agent is missing its OpenAI API key" },
      { status: 503 }
    );
  }

  let siteOrigin: string;
  try {
    const configured = process.env.PUBLIC_BASE_URL;
    if (!configured && process.env.NODE_ENV === "production") {
      throw new Error("PUBLIC_BASE_URL is required in production");
    }
    const parsed = new URL(configured || request.url);
    if (configured && (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash)) {
      throw new Error("PUBLIC_BASE_URL must be an HTTPS origin");
    }
    siteOrigin = parsed.origin;
  } catch (error) {
    console.error("[api/call] Invalid public site URL:", error);
    return Response.json({ error: "Call Me is temporarily unavailable." }, { status: 503 });
  }
  let twimlUrl = "";
  let builderTwiml: ReturnType<typeof parseBuilderTwiml> | null = null;
  if (body.target === "builder") {
    const urlError = validateBuilderTwimlUrl(body.twimlUrl);
    if (urlError) {
      return Response.json({ error: urlError }, { status: 400 });
    }
    twimlUrl = (body.twimlUrl as string).trim();
  } else {
    // Explorer track (or Builder explicitly using the built-in server): the website
    // builds the TwiML, forwarding the picker selections as query params.
    const twimlBaseUrl = `${siteOrigin}/api/twiml`;

    const twimlParams = new URLSearchParams();
    if (body.agentConfig?.voice) twimlParams.set("voice", body.agentConfig.voice);
    if (body.agentConfig?.ttsProvider)
      twimlParams.set("ttsProvider", body.agentConfig.ttsProvider);
    if (body.agentConfig?.language)
      twimlParams.set("language", body.agentConfig.language);
    if (body.agentConfig?.agentName)
      twimlParams.set("agentName", body.agentConfig.agentName);
    if (body.agentConfig?.personality)
      twimlParams.set("personality", body.agentConfig.personality);
    if (body.agentConfig?.welcomeGreeting)
      twimlParams.set("welcomeGreeting", body.agentConfig.welcomeGreeting);
    if (typeof body.agentConfig?.enabledTools === "string")
      twimlParams.set("enabledTools", body.agentConfig.enabledTools);
    if (body.agentConfig?.handoffEnabled)
      twimlParams.set("handoffEnabled", body.agentConfig.handoffEnabled);

    const qs = twimlParams.toString();
    twimlUrl = qs ? `${twimlBaseUrl}?${qs}` : twimlBaseUrl;
  }

  let limiter: ReturnType<typeof getCallLimiter>;
  let reservationId: string;
  try {
    limiter = getCallLimiter();
    const decision = await limiter.reserve(phoneNumber);
    if (!decision.allowed) {
      const error = decision.reason === "active"
        ? "A call to this number is already in progress. Try again after it ends."
        : "This number has reached ten calls in the last hour. Try again later.";
      return Response.json(
        { error },
        {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, Math.ceil(decision.retryAfterSeconds))) },
        }
      );
    }
    reservationId = decision.reservationId;
  } catch (error) {
    console.error("[api/call] Call limit unavailable:", error);
    return Response.json(
      { error: "Call Me is temporarily unavailable. Please try again shortly." },
      { status: 503 }
    );
  }

  if (body.target === "builder") {
    // A reservation blocks concurrent fetches for the same number. The process
    // limit also bounds tunnel connections when many different numbers are used.
    if (activeBuilderPreflights >= MAX_CONCURRENT_BUILDER_PREFLIGHTS) {
      try { await limiter.cancel(phoneNumber, reservationId); } catch (error) {
        console.error("[api/call] Could not release busy Builder reservation:", error);
      }
      return Response.json(
        { error: "The workshop is handling many call requests. Try again in a moment." },
        { status: 503 }
      );
    }
    activeBuilderPreflights++;
    try {
      // Read the current Codespace TwiML for every call. Twilio receives only
      // supported ConversationRelay instructions, so the shared account
      // cannot be told to dial another number directly.
      const xml = await fetchBuilderTwiml(twimlUrl);
      builderTwiml = parseBuilderTwiml(xml, twimlUrl);
    } catch (error) {
      try { await limiter.cancel(phoneNumber, reservationId); } catch (cancelError) {
        console.error("[api/call] Could not release invalid Builder reservation:", cancelError);
      }
      const message = error instanceof Error ? error.message : "The Codespace TwiML is unavailable.";
      return Response.json({ error: message }, { status: 422 });
    } finally {
      activeBuilderPreflights--;
    }
  }

  const statusCallback = new URL("/api/call-status", siteOrigin);
  statusCallback.searchParams.set("reservationId", reservationId);

  let callInstructions: { twiml: string } | { url: string; method: "POST" };
  try {
    if (body.target === "builder") {
      const token = createBuilderActionToken({
        actionUrl: builderTwiml!.actionUrl,
        phoneNumber,
        reservationId,
      }, authToken);
      const actionCallback = new URL("/api/builder-action", siteOrigin);
      actionCallback.searchParams.set("token", token);
      callInstructions = { twiml: renderBuilderTwiml(builderTwiml!, actionCallback.toString()) };
    } else {
      callInstructions = { url: twimlUrl, method: "POST" };
    }
  } catch (error) {
    console.error("[api/call] Could not prepare Builder TwiML:", error);
    try { await limiter.cancel(phoneNumber, reservationId); } catch (cancelError) {
      console.error("[api/call] Could not release invalid Builder reservation:", cancelError);
    }
    return Response.json({ error: "The Codespace TwiML is too large or unsupported." }, { status: 422 });
  }

  try {
    const client = twilio(accountSid, authToken);
    const call = await client.calls.create({
      to: phoneNumber,
      from: twilioPhoneNumber,
      ...callInstructions,
      timeLimit: 300,
      statusCallback: statusCallback.toString(),
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["completed"],
    });

    try {
      await limiter.markStarted(phoneNumber, reservationId, call.sid);
    } catch (error) {
      // Twilio accepted the call. Keep its success response, and let the
      // signed completion callback or stale-call reconciliation clear the slot.
      console.error("[api/call] Failed to record started call:", error);
    }

    if (body.sessionId) {
      try {
        const { recordEvent } = await import("../../../../analytics/db.mjs");
        recordEvent(body.sessionId, "call_initiated", {
          callSid: call.sid,
          agentName: body.agentConfig?.agentName,
          voice: body.agentConfig?.voice,
          language: body.agentConfig?.language,
          ttsProvider: body.agentConfig?.ttsProvider,
        });
      } catch { /* analytics best-effort */ }
    }

    return Response.json({ callSid: call.sid, status: call.status });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err
      ? err.status
      : null;
    const definitelyRejected = typeof status === "number" && status >= 400 && status < 500;
    if (definitelyRejected) {
      try {
        await limiter.cancel(phoneNumber, reservationId);
      } catch (error) {
        console.error("[api/call] Failed to release a rejected call:", error);
      }
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/call] Failed to create call:", message);
    if (!definitelyRejected) {
      return Response.json(
        { error: "We could not confirm whether Twilio started this call. Wait a few minutes before trying again." },
        { status: 503 }
      );
    }
    return Response.json({ error: "Twilio could not start this call. Check the number and try again." }, { status: 500 });
  }
}
