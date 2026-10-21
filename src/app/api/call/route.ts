import { NextRequest } from "next/server";
import twilio from "twilio";
import { validateBuilderTwimlUrl, type CallTarget } from "@/lib/call-target";

async function checkQuickTunnel(twimlUrl: string): Promise<string | null> {
  const url = new URL(twimlUrl);
  // The Builder instructions use a Cloudflare Quick Tunnel. Check that the
  // saved URL still reaches this learner's server before spending a call.
  // Other public HTTPS hosts may be deployed servers and are not fetched here.
  if (!url.hostname.toLowerCase().endsWith(".trycloudflare.com")) return null;

  if (url.port) {
    return "Use the HTTPS URL from tunnel-url without a custom port.";
  }

  // A brand-new Quick Tunnel can briefly return 530 while its edge registers.
  for (let attempt = 0; attempt < 2; attempt++) {
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
      if (!/<Response(?:\s|>)/.test(xml)) throw new Error("TwiML Response is missing");
      const relayUrl = xml.match(/<ConversationRelay\b[^>]*\burl=["']([^"']+)["']/)?.[1];
      if (!relayUrl) throw new Error("ConversationRelay is missing");
      const websocket = new URL(relayUrl);
      if (
        websocket.protocol !== "wss:" ||
        websocket.host !== url.host ||
        websocket.pathname !== "/ws"
      ) {
        throw new Error("ConversationRelay points to a different WebSocket");
      }
      return null;
    } catch {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }

  return "Your Codespace tunnel is not serving the workshop agent. Keep npm run dev running, run tunnel-url again, and paste its new /twiml URL.";
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
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
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
      { error: "phoneNumber must be in E.164 format (e.g. +15551234567)" },
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

  let twimlUrl: string;
  if (body.target === "builder") {
    const urlError = validateBuilderTwimlUrl(body.twimlUrl);
    if (urlError) {
      return Response.json({ error: urlError }, { status: 400 });
    }
    // Builder track: hand Twilio the user's own /twiml endpoint so their
    // server.js owns the entire TwiML response (voice, greeting, language,
    // ConversationRelay attributes, custom parameters, the WebSocket URL).
    // The website never wraps or rewrites it.
    twimlUrl = (body.twimlUrl as string).trim();
    const tunnelError = await checkQuickTunnel(twimlUrl);
    if (tunnelError) {
      return Response.json({ error: tunnelError }, { status: 422 });
    }
  } else {
    // Explorer track (or Builder explicitly using the built-in server): the website
    // builds the TwiML, forwarding the picker selections as query params.
    const host = request.headers.get("host") || "localhost:8080";
    const protocol = host.includes("localhost") ? "http" : "https";
    const twimlBaseUrl = `${protocol}://${host}/api/twiml`;

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

  try {
    const client = twilio(accountSid, authToken);
    const call = await client.calls.create({
      to: phoneNumber,
      from: twilioPhoneNumber,
      url: twimlUrl,
      method: "POST",
      timeLimit: 300,
    });

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
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/call] Failed to create call:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
