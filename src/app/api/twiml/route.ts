import { NextRequest } from "next/server";
import { getVoice, WORKSHOP_LANGUAGES } from "@/lib/voice-catalog";
import { resolveExplorerGreeting } from "@/lib/explorer-greeting";

// Twilio's published locale defaults provide compatible voice/STT settings
// when a caller switches away from a selected English-only voice. Mandarin
// has no listed ConversationRelay default, so use Twilio's Polly Mandarin
// voice and Deepgram's documented zh-CN model.
const LANGUAGE_SETTINGS: Record<string, {
  provider: string; voice: string; transcriptionProvider: string; speechModel: string;
}> = {
  "en-US": { provider: "ElevenLabs", voice: "UgBBYS2sOqTuMpoF3BR0", transcriptionProvider: "Deepgram", speechModel: "nova-3-general" },
  "zh-CN": { provider: "Amazon", voice: "Zhiyu-Neural", transcriptionProvider: "Deepgram", speechModel: "nova-2-general" },
  "fr-FR": { provider: "ElevenLabs", voice: "a5n9pJUnAhX4fn7lx3uo", transcriptionProvider: "Google", speechModel: "telephony" },
  "hi-IN": { provider: "ElevenLabs", voice: "IvLWq57RKibBrqZGpQrC", transcriptionProvider: "Google", speechModel: "long" },
  "pt-BR": { provider: "ElevenLabs", voice: "CstacWqMhJQlnfLPxRG4", transcriptionProvider: "Google", speechModel: "telephony" },
  "ru-RU": { provider: "ElevenLabs", voice: "AB9XsbSA4eLG12t2myjN", transcriptionProvider: "Google", speechModel: "long" },
  "es-ES": { provider: "ElevenLabs", voice: "6xftrpatV0jGmFHxDjUv", transcriptionProvider: "Google", speechModel: "telephony" },
};

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
  const voice = url.searchParams.get("voice");
  const selectedTtsProvider = url.searchParams.get("ttsProvider") || "ElevenLabs";
  // Older workshop progress saved the display name instead of Twilio's value.
  const ttsProvider = selectedTtsProvider === "Amazon Polly" ? "Amazon" : selectedTtsProvider;
  const requestedLanguage = url.searchParams.get("language") || "en-US";
  const language = WORKSHOP_LANGUAGES.some(({ code }) => code === requestedLanguage)
    ? requestedLanguage : "en-US";
  const selectedVoice = getVoice(voice || undefined);
  const initialSettings = LANGUAGE_SETTINGS[language];
  const canUseRequestedVoice = (code: string) => Boolean(voice && (
    selectedVoice
      ? selectedVoice.provider === ttsProvider && selectedVoice.languages.includes(code)
      // Direct TwiML requests may supply a voice outside the curated picker.
      // Honor it only for the explicitly selected starting language.
      : code === language && ["ElevenLabs", "Google", "Amazon"].includes(ttsProvider)
  ));
  // Older saved progress can pair an English-only voice with a different
  // initial language. Use a compatible voice for the first greeting too.
  const selectedVoiceSupportsInitial = canUseRequestedVoice(language);
  const initialVoice = selectedVoiceSupportsInitial ? voice! : initialSettings.voice;
  const initialTtsProvider = selectedVoiceSupportsInitial ? ttsProvider : initialSettings.provider;
  const languageElements = WORKSHOP_LANGUAGES.map(({ code }) => {
    const useSelectedVoice = canUseRequestedVoice(code);
    const settings = LANGUAGE_SETTINGS[code];
    const provider = useSelectedVoice ? ttsProvider : settings.provider;
    const languageVoice = useSelectedVoice ? voice! : settings.voice;
    return `<Language code="${escapeXml(code)}" ttsProvider="${escapeXml(provider)}" voice="${escapeXml(languageVoice)}" transcriptionProvider="${settings.transcriptionProvider}" speechModel="${settings.speechModel}" />`;
  }).join("\n      ");
  const welcomeGreeting = resolveExplorerGreeting(
    url.searchParams.get("welcomeGreeting"), language
  );
  const agentName = url.searchParams.get("agentName") || "";
  const personality = url.searchParams.get("personality") || "";
  const enabledTools = url.searchParams.get("enabledTools");
  const handoffEnabled = url.searchParams.get("handoffEnabled") === "true";

  const paramElements = [
    agentName && `<Parameter name="agentName" value="${escapeXml(agentName)}"/>`,
    personality && `<Parameter name="personality" value="${escapeXml(personality)}"/>`,
    `<Parameter name="initialLanguage" value="${escapeXml(language)}"/>`,
    enabledTools !== null && `<Parameter name="enabledTools" value="${escapeXml(enabledTools)}"/>`,
    `<Parameter name="handoffEnabled" value="${handoffEnabled}"/>`,
  ]
    .filter(Boolean)
    .join("\n      ");

  const actionUrl = new URL("/api/connect-action", publicOrigin);
  // Twilio signs this URL, so the action can recover the initial language even
  // when ConversationRelay ends without handing back WebSocket metadata.
  if (language !== "en-US") actionUrl.searchParams.set("language", language);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect action="${escapeXml(actionUrl.toString())}" method="POST">
    <ConversationRelay
      url="${escapeXml(wsUrl)}"
      voice="${escapeXml(initialVoice)}"
      ttsProvider="${escapeXml(initialTtsProvider)}"
      language="${escapeXml(language)}"
      transcriptionProvider="${initialSettings.transcriptionProvider}"
      speechModel="${escapeXml(initialSettings.speechModel)}"
      welcomeGreeting="${escapeXml(welcomeGreeting)}"
      interruptible="any"
      reportInputDuringAgentSpeech="any"
      interruptSensitivity="low"
      dtmfDetection="true"
    >
      ${languageElements}
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
