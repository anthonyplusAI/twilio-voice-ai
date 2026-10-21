import twilio from "twilio";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024;
const TUNNEL_SUFFIXES = [
  ".trycloudflare.com",
  ".ngrok-free.app",
  ".ngrok.app",
  ".ngrok.io",
];

class BodyTooLarge extends Error {}

async function readBoundedBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_BODY_BYTES) throw new BodyTooLarge();

  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");

  const decoder = new TextDecoder();
  let body = "";
  let byteLength = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteLength += chunk.value.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return JSON.parse(body + decoder.decode());
}

function allowedWebSocketUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 256) return false;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  const host = parsed.hostname;
  const validLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  return value === `wss://${host}/ws`
    && host.split(".").every((label) => validLabel.test(label))
    && TUNNEL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const noStore = { "Cache-Control": "no-store" };

/** Verify only the WebSocket handshake URL used by a Builder Codespace. */
export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return Response.json({ valid: false }, { status: 503, headers: noStore });
  }

  let body: unknown;
  try {
    body = await readBoundedBody(request);
  } catch (error) {
    return Response.json(
      { valid: false },
      { status: error instanceof BodyTooLarge ? 413 : 400, headers: noStore },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ valid: false }, { status: 400, headers: noStore });
  }

  const { url, signature } = body as { url?: unknown; signature?: unknown };
  if (!allowedWebSocketUrl(url) || typeof signature !== "string" ||
      !/^[A-Za-z0-9+/]{27}=$/.test(signature)) {
    return Response.json({ valid: false }, { status: 400, headers: noStore });
  }

  let valid = false;
  try {
    valid = twilio.validateRequest(authToken, signature, url, {});
    // Twilio's WebSocket security guide documents this trailing-slash variant.
    if (!valid) valid = twilio.validateRequest(authToken, signature, `${url}/`, {});
  } catch { /* Malformed signatures fail closed. */ }

  return Response.json({ valid }, { status: valid ? 200 : 403, headers: noStore });
}
