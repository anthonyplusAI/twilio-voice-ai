"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- The standalone workshop package uses CommonJS. */

const http = require("node:http");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const DEFAULT_SITE_ORIGIN = "https://voice-ai-workshop.mangopebble-a9393690.centralus.azurecontainerapps.io";
const MAX_HTTP_BODY_BYTES = 16 * 1024;
const TUNNEL_SUFFIXES = [
  ".trycloudflare.com",
  ".ngrok-free.app",
  ".ngrok.app",
  ".ngrok.io",
];

function validTunnelHost(host) {
  if (typeof host !== "string" || host.length > 253) return false;
  const validLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  return host.split(".").every((label) => validLabel.test(label))
    && TUNNEL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function validTunnelUrl(value, protocol, pathname) {
  if (typeof value !== "string" || value.length > 256) return false;
  try {
    const parsed = new URL(value);
    return validTunnelHost(parsed.hostname)
      && value === `${protocol}://${parsed.hostname}${pathname}`;
  } catch {
    return false;
  }
}

function readWorkshopEnv() {
  try {
    return require("dotenv").parse(readFileSync(join(__dirname, ".env")));
  } catch {
    return {};
  }
}

function readLocalAuthToken() {
  // Read on every handshake so editing workshop/.env needs no proxy restart.
  return readWorkshopEnv().TWILIO_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || "";
}

function hostFromTwimlUrl(value) {
  if (!validTunnelUrl(value, "https", "/twiml")) return null;
  return new URL(value).hostname;
}

function resolvePublicHost(req) {
  // cloudflared may rewrite Host to localhost. Use only this tunnel's current
  // URL, never a stale manually configured URL or a direct-to-8080 tunnel.
  const stateDir = process.env.TUNNEL_STATE_DIR || "/tmp";
  const target = `http://127.0.0.1:${process.env.TUNNEL_PROXY_PORT || 8081}`;
  let recordedTarget = null;
  try {
    recordedTarget = readFileSync(join(stateDir, "cloudflared-target"), "utf8").trim();
  } catch { /* A local ngrok tunnel does not use the Codespaces state file. */ }
  if (recordedTarget !== null) {
    if (recordedTarget !== target) return null;
    try {
      const baseUrl = readFileSync(join(stateDir, "cloudflared-url"), "utf8").trim();
      return hostFromTwimlUrl(`${baseUrl}/twiml`);
    } catch {
      return null;
    }
  }

  // Local ngrok users have no cloudflared state file.
  const explicitUrl = readWorkshopEnv().TWIML_URL || process.env.TWIML_URL;
  if (explicitUrl) return hostFromTwimlUrl(explicitUrl);

  return validTunnelHost(req.headers.host) ? req.headers.host : null;
}

function matchesPublicHost(requestHost, publicHost) {
  return requestHost === publicHost
    || (typeof requestHost === "string" &&
      /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(requestHost));
}

function hostedVerifierUrl(siteOrigin) {
  const value = typeof siteOrigin === "string" ? siteOrigin.replace(/\/$/, "") : "";
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || value !== parsed.origin || parsed.username ||
      parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error("WORKSHOP_SITE_URL must be a public HTTPS origin");
  }
  return `${value}/api/verify-builder-ws`;
}

async function verifyHostedSignature(url, signature, {
  siteOrigin = process.env.WORKSHOP_SITE_URL || DEFAULT_SITE_ORIGIN,
  fetchImpl = fetch,
} = {}) {
  const endpoint = hostedVerifierUrl(siteOrigin);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, signature }),
    redirect: "error",
    signal: AbortSignal.timeout(2500),
  });
  if (response.status === 403 || response.status === 400) return false;
  if (response.status !== 200) throw new Error("Hosted signature verifier unavailable");
  const body = await response.json();
  if (!body || body.valid !== true) throw new Error("Invalid verifier response");
  return true;
}

function sendHttp(res, status) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, { "content-length": "0", connection: "close" });
  res.end();
}

function rejectUpgrade(socket, status, reason) {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    () => socket.destroy(),
  );
}

function responseHeaders(headers) {
  const filtered = { ...headers };
  for (const header of [
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade",
  ]) delete filtered[header];
  return filtered;
}

function forwardHttp(req, res, upstreamPort, publicHost) {
  const declaredLength = req.headers["content-length"];
  if (typeof declaredLength === "string" &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_HTTP_BODY_BYTES)) {
    sendHttp(res, 413);
    return;
  }

  const upstream = http.request({
    hostname: "127.0.0.1",
    port: upstreamPort,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: publicHost || req.headers.host },
  });
  let received = 0;
  let overflow = false;

  upstream.setTimeout(10000, () => upstream.destroy());
  upstream.on("response", (response) => {
    if (overflow || res.writableEnded) {
      response.resume();
      return;
    }
    res.writeHead(response.statusCode || 502, responseHeaders(response.headers));
    response.pipe(res);
  });
  upstream.on("error", () => {
    if (!overflow) sendHttp(res, 502);
  });

  req.on("data", (chunk) => {
    if (overflow) return;
    received += chunk.length;
    if (received > MAX_HTTP_BODY_BYTES) {
      overflow = true;
      upstream.destroy();
      sendHttp(res, 413);
      return;
    }
    if (!upstream.write(chunk)) req.pause();
  });
  upstream.on("drain", () => req.resume());
  req.on("end", () => {
    if (!overflow) upstream.end();
  });
  req.on("error", () => upstream.destroy());
  req.on("aborted", () => upstream.destroy());
}

function forwardWebSocket(req, socket, head, upstreamPort, publicHost) {
  const headers = {
    host: publicHost,
    connection: "Upgrade",
    upgrade: "websocket",
    "sec-websocket-key": req.headers["sec-websocket-key"],
    "sec-websocket-version": req.headers["sec-websocket-version"],
  };
  for (const optional of ["sec-websocket-protocol", "sec-websocket-extensions", "x-twilio-signature"]) {
    if (typeof req.headers[optional] === "string") headers[optional] = req.headers[optional];
  }

  const upstream = http.request({
    hostname: "127.0.0.1",
    port: upstreamPort,
    method: "GET",
    path: "/ws",
    headers,
  });
  upstream.setTimeout(5000, () => upstream.destroy());
  upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
    if (socket.destroyed) {
      upstreamSocket.destroy();
      return;
    }
    const accept = response.headers["sec-websocket-accept"];
    if (typeof accept !== "string") {
      upstreamSocket.destroy();
      rejectUpgrade(socket, 502, "Bad Gateway");
      return;
    }

    let handshake = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n";
    handshake += `Sec-WebSocket-Accept: ${accept}\r\n`;
    for (const optional of ["sec-websocket-protocol", "sec-websocket-extensions"]) {
      const value = response.headers[optional];
      if (typeof value === "string") handshake += `${optional}: ${value}\r\n`;
    }
    socket.write(`${handshake}\r\n`);
    if (head.length) upstreamSocket.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);

    socket.pipe(upstreamSocket);
    upstreamSocket.pipe(socket);
    socket.on("error", () => upstreamSocket.destroy());
    upstreamSocket.on("error", () => socket.destroy());
  });
  upstream.on("response", (response) => {
    response.resume();
    rejectUpgrade(socket, 502, "Bad Gateway");
  });
  upstream.on("error", () => rejectUpgrade(socket, 502, "Bad Gateway"));
  socket.once("close", () => upstream.destroy());
  upstream.end();
}

function createProxyServer({
  upstreamPort = Number(process.env.TUNNEL_UPSTREAM_PORT || 8080),
  resolveHost = resolvePublicHost,
  readToken = readLocalAuthToken,
  validateTwilio = (token, signature, url) =>
    require("twilio").validateRequest(token, signature, url, {}),
  verifySite = verifyHostedSignature,
} = {}) {
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
    throw new Error("TUNNEL_UPSTREAM_PORT must be a valid port");
  }

  const server = http.createServer((req, res) => {
    const allowed = (req.method === "POST" && (req.url === "/twiml" || req.url === "/call-ended"))
      || (req.method === "GET" && req.url === "/health");
    if (!allowed) {
      sendHttp(res, 404);
      return;
    }
    const publicHost = req.url === "/health" ? null : resolveHost(req);
    if (req.url !== "/health" &&
        (!validTunnelHost(publicHost) || !matchesPublicHost(req.headers.host, publicHost))) {
      sendHttp(res, 400);
      return;
    }
    forwardHttp(req, res, upstreamPort, publicHost);
  });

  server.on("upgrade", (req, socket, head) => {
    void (async () => {
      const signature = req.headers["x-twilio-signature"];
      const publicHost = resolveHost(req);
      const url = `wss://${publicHost}/ws`;
      if (req.method !== "GET" || req.url !== "/ws" ||
          typeof signature !== "string" || !signature ||
          !validTunnelUrl(url, "wss", "/ws") ||
          !matchesPublicHost(req.headers.host, publicHost)) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }

      const token = readToken();
      let locallyValid = false;
      if (token) {
        try {
          locallyValid = validateTwilio(token, signature, url)
            || validateTwilio(token, signature, `${url}/`);
        } catch { /* Try the site's verifier for site-initiated calls. */ }
      }

      if (!locallyValid) {
        let hostedValid;
        try {
          hostedValid = await verifySite(url, signature);
        } catch {
          rejectUpgrade(socket, 503, "Service Unavailable");
          return;
        }
        if (!hostedValid) {
          rejectUpgrade(socket, 403, "Forbidden");
          return;
        }
      }

      if (!socket.destroyed) forwardWebSocket(req, socket, head, upstreamPort, publicHost);
    })().catch(() => rejectUpgrade(socket, 503, "Service Unavailable"));
  });

  return server;
}

if (require.main === module) {
  const port = Number(process.env.TUNNEL_PROXY_PORT || 8081);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("TUNNEL_PROXY_PORT must be a valid port");
  }
  createProxyServer().listen(port, "127.0.0.1", () => {
    console.log(`Secure workshop tunnel proxy listening on 127.0.0.1:${port}`);
  });
}

module.exports = {
  createProxyServer,
  hostedVerifierUrl,
  readLocalAuthToken,
  resolvePublicHost,
  validTunnelHost,
  validTunnelUrl,
  verifyHostedSignature,
};
