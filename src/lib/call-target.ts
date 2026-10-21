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
  if (url.username || url.password || url.hash || url.search || url.port) {
    return "Enter the plain TwiML URL from tunnel-url, without credentials, a query, a port, or a fragment.";
  }

  const host = url.hostname.toLowerCase();
  const allowedTunnelHosts = [
    ".trycloudflare.com",
    ".ngrok-free.app",
    ".ngrok.app",
    ".ngrok.io",
  ];
  if (!allowedTunnelHosts.some((suffix) => host.endsWith(suffix))) {
    return "Use the public Cloudflare or ngrok tunnel URL for your Codespace's /twiml route.";
  }

  return null;
}
