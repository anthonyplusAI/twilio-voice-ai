import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  let publicOrigin: URL;
  try {
    publicOrigin = getPublicOrigin(request);
  } catch (error) {
    console.error("[api/twiml] Invalid public site URL:", error);
    return Response.json({ error: "Explorer calls are temporarily unavailable" }, { status: 503 });
  }

  const url = new URL(request.url);
  const rawWsUrl = url.searchParams.get("wsUrl");
  const wsUrl = rawWsUrl && isValidWsUrl(rawWsUrl) ? rawWsUrl : getDefaultWsUrl(publicOrigin);
  // When no voice is selected, ConversationRelay chooses a default for the
  // requested language. A fixed English voice can break a Spanish-first call.
  const voice = url.searchParams.get("voice");
  const ttsProvider = url.searchParams.get("ttsProvider") || "ElevenLabs";
  const language = url.searchParams.get("language") || "en-US";
  const transcriptionProvider =
    url.searchParams.get("transcriptionProvider") || "Deepgram";
  const welcomeGreeting =
    url.searchParams.get("welcomeGreeting") ||
    "Hello! I'm your AI assistant. How can I help you today?";
  const agentName = url.searchParams.get("agentName") || "";
  const personality = url.searchParams.get("personality") || "";
  const enabledTools = url.searchParams.get("enabledTools");
  const handoffEnabled = url.searchParams.get("handoffEnabled") === "true";

  const paramElements = [
    agentName && `<Parameter name="agentName" value="${escapeXml(agentName)}"/>`,
    personality && `<Parameter name="personality" value="${escapeXml(personality)}"/>`,
    enabledTools !== null && `<Parameter name="enabledTools" value="${escapeXml(enabledTools)}"/>`,
    `<Parameter name="handoffEnabled" value="${handoffEnabled}"/>`,
  ]
    .filter(Boolean)
    .join("\n      ");

  const actionUrl = new URL("/api/connect-action", publicOrigin).toString();

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect action="${escapeXml(actionUrl)}" method="POST">
    <ConversationRelay
      url="${escapeXml(wsUrl)}"
      ${voice ? `voice="${escapeXml(voice)}"` : ""}
      ttsProvider="${escapeXml(ttsProvider)}"
      language="${escapeXml(language)}"
      transcriptionProvider="${escapeXml(transcriptionProvider)}"
      welcomeGreeting="${escapeXml(welcomeGreeting)}"
      interruptible="any"
      reportInputDuringAgentSpeech="any"
      interruptSensitivity="low"
      dtmfDetection="true"
    >
      ${paramElements}
    </ConversationRelay>
  </Connect>
</Response>`;

  return new Response(twiml.trim(), {
    headers: { "Content-Type": "application/xml" },
  });
}

function isValidWsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "ws:" || parsed.protocol === "wss:";
  } catch {
    return false;
  }
}

function getPublicOrigin(request: NextRequest): URL {
  const configured = process.env.PUBLIC_BASE_URL;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("PUBLIC_BASE_URL is required in production");
  }
  const origin = new URL(configured || request.url);
  if (configured && (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash)) {
    throw new Error("PUBLIC_BASE_URL must be an HTTPS origin");
  }
  return origin;
}

function getDefaultWsUrl(origin: URL): string {
  const protocol = origin.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${origin.host}/ws`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
