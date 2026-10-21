import { NextRequest } from "next/server";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import twilio from "twilio";

const MAX_CALLBACK_BYTES = 16 * 1024;

// <Say> uses a separate voice format from ConversationRelay. These Polly
// voices are paired with locales listed in Twilio's Text-to-Speech catalog.
const SPOKEN_MESSAGES: Record<string, {
  voice: string; hold: string; unavailable: string; goodbye: string;
}> = {
  "en-US": { voice: "Polly.Joanna", hold: "Please hold while we connect you to an agent.", unavailable: "Sorry, live handoff is unavailable right now. Goodbye.", goodbye: "Thank you for calling. Goodbye." },
  "zh-CN": { voice: "Polly.Zhiyu-Neural", hold: "请稍等，我们正在为您转接客服。", unavailable: "抱歉，当前无法转接人工客服。再见。", goodbye: "感谢您的来电。再见。" },
  "fr-FR": { voice: "Polly.Mathieu", hold: "Veuillez patienter pendant que nous vous mettons en relation avec un conseiller.", unavailable: "Désolé, le transfert vers un conseiller est indisponible pour le moment. Au revoir.", goodbye: "Merci de votre appel. Au revoir." },
  "hi-IN": { voice: "Polly.Aditi", hold: "कृपया प्रतीक्षा करें, हम आपको एक प्रतिनिधि से जोड़ रहे हैं।", unavailable: "क्षमा करें, अभी आपको प्रतिनिधि से नहीं जोड़ सकते। अलविदा।", goodbye: "कॉल करने के लिए धन्यवाद। अलविदा।" },
  "pt-BR": { voice: "Polly.Camila", hold: "Aguarde enquanto conectamos você a um atendente.", unavailable: "Desculpe, a transferência para um atendente está indisponível no momento. Até logo.", goodbye: "Obrigado por ligar. Até logo." },
  "ru-RU": { voice: "Polly.Tatyana", hold: "Пожалуйста, подождите, мы соединяем вас с оператором.", unavailable: "Извините, сейчас перевод на оператора недоступен. До свидания.", goodbye: "Спасибо за звонок. До свидания." },
  "es-ES": { voice: "Polly.Conchita", hold: "Espera mientras te comunicamos con un agente.", unavailable: "Lo sentimos, no podemos transferirte a un agente ahora mismo. Adiós.", goodbye: "Gracias por llamar. Adiós." },
};

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

  let handoffData: { reasonCode?: string; reason?: string; language?: string } | null = null;

  try {
    const rawHandoff = params.HandoffData;
    if (rawHandoff) {
      handoffData = JSON.parse(rawHandoff);
    }
  } catch {
    // No handoff data or parse error — normal call end
  }

  const initialLanguage = new URL(request.url).searchParams.get("language");
  const language = handoffData?.language && Object.hasOwn(SPOKEN_MESSAGES, handoffData.language)
    ? handoffData.language
    : initialLanguage && Object.hasOwn(SPOKEN_MESSAGES, initialLanguage)
      ? initialLanguage
      : "en-US";
  const spoken = SPOKEN_MESSAGES[language];
  const say = (message: string) => `<Say language="${language}" voice="${spoken.voice}">${message}</Say>`;

  // The relay already played a full farewell before ending for silence.
  if (handoffData?.reasonCode === "silence-timeout") {
    return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Hangup/></Response>", {
      headers: { "Content-Type": "application/xml" },
    });
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
  ${say(spoken.unavailable)}
  <Hangup/>
</Response>`, {
        headers: { "Content-Type": "application/xml" },
      });
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say(spoken.hold)}
  <Dial timeLimit="60">${destination}</Dial>
</Response>`;

    return new Response(twiml.trim(), {
      headers: { "Content-Type": "application/xml" },
    });
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say(spoken.goodbye)}
  <Hangup/>
</Response>`;

  return new Response(twiml.trim(), {
    headers: { "Content-Type": "application/xml" },
  });
}
