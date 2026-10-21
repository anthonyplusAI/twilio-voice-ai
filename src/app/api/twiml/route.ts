import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const rawWsUrl = url.searchParams.get("wsUrl");
  const wsUrl = rawWsUrl && isValidWsUrl(rawWsUrl) ? rawWsUrl : getDefaultWsUrl(request);
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

  const host = request.headers.get("host") || "localhost:8080";
  const actionProtocol = host.includes("localhost") ? "http" : "https";
  const actionUrl = `${actionProtocol}://${host}/api/connect-action`;

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

function getDefaultWsUrl(request: NextRequest): string {
  const host = request.headers.get("host") || "localhost:8080";
  const protocol = host.includes("localhost") ? "ws" : "wss";
  return `${protocol}://${host}/ws`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
