export type CallTarget = "builder" | "built-in";

/** The Builder's TwiML must be reachable by Twilio, not just by Codespaces. */
export function validateBuilderTwimlUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return "Your TwiML URL is required. Run tunnel-url in your Codespace and paste the URL here.";
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "Enter a valid TwiML URL from tunnel-url.";
  }

  if (url.protocol !== "https:") {
    return "Your TwiML URL must start with https:// so Twilio can reach it securely.";
  }
  if (url.pathname !== "/twiml") {
    return "Your TwiML URL must end in /twiml. Run tunnel-url to copy the full URL.";
  }
  if (url.username || url.password || url.hash) {
    return "Enter the plain TwiML URL from tunnel-url, without credentials or a fragment.";
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    host.startsWith("[")
  ) {
    return "Twilio needs a public hostname. Paste the public URL from tunnel-url.";
  }

  return null;
}
