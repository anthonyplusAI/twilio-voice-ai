import twilio from "twilio";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 20 * 1024;
const MAX_WEBSOCKET_BODY_BYTES = 1024;
const TUNNEL_SUFFIXES = [
  ".trycloudflare.com",
  ".ngrok-free.app",
  ".ngrok.app",
  ".ngrok.io",
];

class BodyTooLarge extends Error {}

async function readBoundedBody(request: Request): Promise<{ body: unknown; bytes: number }> {
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
  return { body: JSON.parse(body + decoder.decode()), bytes: byteLength };
}

function allowedTunnelUrl(value: unknown, protocol: "wss" | "https", pathname: "/ws" | "/call-ended"): value is string {
  if (typeof value !== "string" || value.length > 256) return false;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  const host = parsed.hostname;
  const validLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  return value === `${protocol}://${host}${pathname}`
    && host.split(".").every((label) => validLabel.test(label))
    && TUNNEL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const noStore = { "Cache-Control": "no-store" };

/** Verify the WebSocket handshake or action callback used by a Builder Codespace. */
export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return Response.json({ valid: false }, { status: 503, headers: noStore });
  }

  let body: unknown;
  let bytes: number;
  try {
    ({ body, bytes } = await readBoundedBody(request));
  } catch (error) {
    return Response.json(
      { valid: false },
      { status: error instanceof BodyTooLarge ? 413 : 400, headers: noStore },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ valid: false }, { status: 400, headers: noStore });
  }

  const { url, signature, params } = body as {
    url?: unknown; signature?: unknown; params?: unknown;
  };
  const websocket = allowedTunnelUrl(url, "wss", "/ws");
  const action = allowedTunnelUrl(url, "https", "/call-ended");
  if ((!websocket && !action) || typeof signature !== "string" ||
      !/^[A-Za-z0-9+/]{27}=$/.test(signature)) {
    return Response.json({ valid: false }, { status: 400, headers: noStore });
  }
  if (websocket && bytes > MAX_WEBSOCKET_BODY_BYTES) {
    return Response.json({ valid: false }, { status: 413, headers: noStore });
  }
  if ((websocket && Object.hasOwn(body, "params")) ||
      (action && (!params || typeof params !== "object" || Array.isArray(params) ||
        Object.values(params).some((value) => typeof value !== "string")))) {
    return Response.json({ valid: false }, { status: 400, headers: noStore });
  }

  let valid = false;
  try {
    const formParams = action ? params as Record<string, string> : {};
    valid = twilio.validateRequest(authToken, signature, url, formParams);
    // Twilio's WebSocket security guide documents this trailing-slash variant.
    if (websocket && !valid) valid = twilio.validateRequest(authToken, signature, `${url}/`, {});
  } catch { /* Malformed signatures fail closed. */ }

  return Response.json({ valid }, { status: valid ? 200 : 403, headers: noStore });
}
