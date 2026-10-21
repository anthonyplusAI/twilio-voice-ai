import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const TUNNEL_SUFFIXES = [".trycloudflare.com", ".ngrok-free.app", ".ngrok.app", ".ngrok.io"];

function isAllowedActionUrl(value) {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.pathname === "/call-ended"
      && !url.port && !url.username && !url.password && !url.search && !url.hash
      && TUNNEL_SUFFIXES.some((suffix) => url.hostname.toLowerCase().endsWith(suffix));
  } catch {
    return false;
  }
}

function signature(payload, secret) {
  return createHmac("sha256", secret)
    .update("workshop-builder-action-v1\0")
    .update(payload)
    .digest();
}

/** Bind the follow-on TwiML URL to one permitted public call. */
export function createBuilderActionToken({ actionUrl, phoneNumber, reservationId }, secret, now = Date.now) {
  if (!secret || !isAllowedActionUrl(actionUrl)
    || !/^\+[1-9]\d{1,14}$/.test(phoneNumber)
    || typeof reservationId !== "string" || !reservationId || reservationId.length > 100) {
    throw new Error("Invalid Builder action token input");
  }
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    actionUrl,
    phoneNumber,
    reservationId,
    expiresAt: now() + TOKEN_LIFETIME_MS,
  })).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

/** Return null for malformed, forged, or expired tokens. */
export function readBuilderActionToken(token, secret, now = Date.now) {
  if (!secret || typeof token !== "string" || token.length > 2048) return null;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) return null;
  const suppliedSignature = Buffer.from(match[2], "base64url");
  const expectedSignature = signature(match[1], secret);
  if (suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)) return null;

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!decoded || decoded.v !== 1
    || !isAllowedActionUrl(decoded.actionUrl)
    || !/^\+[1-9]\d{1,14}$/.test(decoded.phoneNumber)
    || typeof decoded.reservationId !== "string" || !decoded.reservationId
    || decoded.reservationId.length > 100
    || !Number.isSafeInteger(decoded.expiresAt)
    || decoded.expiresAt < now()
    || decoded.expiresAt > now() + TOKEN_LIFETIME_MS) return null;

  return decoded;
}
