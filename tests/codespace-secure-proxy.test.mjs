import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import twilio from "twilio";
import WebSocket, { WebSocketServer } from "ws";

const require = createRequire(import.meta.url);
const {
  createProxyServer,
  hostedVerifierUrl,
  resolvePublicHost,
  validTunnelUrl,
  verifyHostedSignature,
} = require("../workshop/secure-proxy.js");

const host = "learner.trycloudflare.com";
const wsUrl = `wss://${host}/ws`;
const localToken = "local-twilio-test-token";
const siteToken = "hosted-twilio-test-token";
let upstream;
let upstreamWss;
let proxy;
let proxyBase;
let wsConnections = 0;
let callRequests = 0;
let siteVerifications = 0;
let siteAvailable = true;

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function signed(token, url = wsUrl) {
  return twilio.getExpectedTwilioSignature(token, url, {});
}

function requestHttp(path, { method = "GET", body = "", requestHost = host } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(`${proxyBase}${path}`, {
      method,
      headers: {
        Host: requestHost,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    request.once("error", reject);
    request.end(body);
  });
}

function attemptUpgrade(signature, path = "/ws", requestHost = host) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${proxyBase.replace("http:", "ws:")}${path}`, {
      headers: {
        Host: requestHost,
        ...(signature ? { "X-Twilio-Signature": signature } : {}),
      },
    });
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error("WebSocket handshake timed out"));
    }, 5000);
    const finish = (result) => {
      clearTimeout(timeout);
      resolve(result);
    };
    ws.once("open", () => finish({ status: 101, ws }));
    ws.once("unexpected-response", (_request, response) => {
      response.resume();
      response.once("end", () => finish({ status: response.statusCode }));
    });
    ws.once("error", reject);
  });
}

before(async () => {
  upstream = http.createServer((req, res) => {
    if (req.url === "/call") callRequests++;
    if (req.url === "/health") {
      res.writeHead(200).end("ok");
      return;
    }
    if (req.url === "/twiml" || req.url === "/call-ended") {
      res.writeHead(200, { "content-type": "text/xml" });
      res.end(`<Response host="${req.headers.host}" path="${req.url}"/>`);
      return;
    }
    res.writeHead(404).end();
  });
  upstreamWss = new WebSocketServer({ server: upstream, path: "/ws" });
  upstreamWss.on("connection", (ws, req) => {
    wsConnections++;
    ws.on("message", (message) => ws.send(`${req.headers.host}:${message}`));
  });
  const upstreamPort = await listen(upstream);

  proxy = createProxyServer({
    upstreamPort,
    resolveHost: () => host,
    readToken: () => localToken,
    validateTwilio: (token, signature, url) => twilio.validateRequest(token, signature, url, {}),
    verifySite: async (url, signature) => {
      siteVerifications++;
      if (!siteAvailable) throw new Error("Site offline");
      return twilio.validateRequest(siteToken, signature, url, {});
    },
  });
  proxyBase = `http://127.0.0.1:${await listen(proxy)}`;
});

after(async () => {
  for (const client of upstreamWss?.clients || []) client.terminate();
  proxy?.closeAllConnections();
  upstream?.closeAllConnections();
  if (proxy?.listening) await close(proxy);
  if (upstream?.listening) await close(upstream);
  await new Promise((resolve) => upstreamWss?.close(resolve));
});

test("proxy forwards only required HTTP routes and preserves the public Host", async () => {
  for (const [path, requestHost] of [["/twiml", "localhost:8081"], ["/call-ended", host]]) {
    const response = await requestHttp(path, { method: "POST", body: "CallSid=CApreflight", requestHost });
    assert.equal(response.status, 200);
    assert.match(response.body, new RegExp(`host="${host}" path="${path}"`));
  }
  assert.equal((await requestHttp("/health")).status, 200);
  assert.equal((await requestHttp("/call", { method: "POST" })).status, 404);
  assert.equal((await requestHttp("/twiml")).status, 404);
  assert.equal((await requestHttp("/admin")).status, 404);
  assert.equal(callRequests, 0);
});

test("proxy rejects oversized HTTP bodies", async () => {
  const response = await requestHttp("/twiml", { method: "POST", body: "x".repeat(16 * 1024 + 1) });
  assert.equal(response.status, 413);
});

test("unsigned and wrongly signed WebSockets never reach the attendee server", async () => {
  const before = wsConnections;
  assert.equal((await attemptUpgrade()).status, 403);
  assert.equal((await attemptUpgrade(signed("wrong-token"))).status, 403);
  assert.equal((await attemptUpgrade(signed(localToken), "/ws?x=1")).status, 403);
  assert.equal((await attemptUpgrade(signed(localToken), "/elsewhere")).status, 403);
  assert.equal((await attemptUpgrade(signed(localToken), "/ws", "attacker.example")).status, 403);
  assert.equal(wsConnections, before);
});

test("local attendee signature upgrades and relays WebSocket frames", async () => {
  const beforeSite = siteVerifications;
  const result = await attemptUpgrade(signed(localToken), "/ws", "localhost:8081");
  assert.equal(result.status, 101);
  assert.equal(siteVerifications, beforeSite);
  const echoed = new Promise((resolve) => result.ws.once("message", (message) => resolve(String(message))));
  result.ws.send("hello");
  assert.equal(await echoed, `${host}:hello`);
  result.ws.close();
});

test("local attendee WebSocket also accepts Twilio's trailing-slash signature", async () => {
  const result = await attemptUpgrade(signed(localToken, `${wsUrl}/`));
  assert.equal(result.status, 101);
  result.ws.close();
});

test("site-signed Builder call upgrades even when attendee credentials are configured", async () => {
  const beforeSite = siteVerifications;
  const result = await attemptUpgrade(signed(siteToken));
  assert.equal(result.status, 101);
  assert.equal(siteVerifications, beforeSite + 1);
  result.ws.close();
});

test("site verifier outage fails closed", async () => {
  siteAvailable = false;
  try {
    assert.equal((await attemptUpgrade(signed(siteToken))).status, 503);
  } finally {
    siteAvailable = true;
  }
});

test("hosted verifier request is bounded to the workshop origin", async () => {
  assert.equal(hostedVerifierUrl("https://workshop.example/"), "https://workshop.example/api/verify-builder-ws");
  for (const bad of ["http://workshop.example", "https://workshop.example/path", "https://user@workshop.example"])
    assert.throws(() => hostedVerifierUrl(bad));
  assert.equal(validTunnelUrl("https://learner.ngrok-free.app/twiml", "https", "/twiml"), true);
  assert.equal(validTunnelUrl("https://learner.ngrok-free.app/call", "https", "/twiml"), false);

  let captured;
  const valid = await verifyHostedSignature(wsUrl, signed(siteToken), {
    siteOrigin: "https://workshop.example",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return Response.json({ valid: true });
    },
  });
  assert.equal(valid, true);
  assert.equal(captured.url, "https://workshop.example/api/verify-builder-ws");
  assert.deepEqual(JSON.parse(captured.options.body), { url: wsUrl, signature: signed(siteToken) });
  assert.equal(captured.options.redirect, "error");
});

test("Codespaces proxy resolves public Host from its current tunnel file", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "secure-tunnel-host-test-"));
  const previous = process.env.TUNNEL_STATE_DIR;
  const previousTwimlUrl = process.env.TWIML_URL;
  try {
    process.env.TUNNEL_STATE_DIR = stateDir;
    process.env.TWIML_URL = "https://stale.trycloudflare.com/twiml";
    writeFileSync(join(stateDir, "cloudflared-target"), "http://127.0.0.1:8081\n");
    writeFileSync(join(stateDir, "cloudflared-url"), `https://${host}\n`);
    assert.equal(resolvePublicHost({ headers: { host: "localhost:8081" } }), host);
    writeFileSync(join(stateDir, "cloudflared-target"), "http://127.0.0.1:8080\n");
    assert.equal(resolvePublicHost({ headers: { host: "localhost:8081" } }), null);
  } finally {
    if (previous === undefined) delete process.env.TUNNEL_STATE_DIR;
    else process.env.TUNNEL_STATE_DIR = previous;
    if (previousTwimlUrl === undefined) delete process.env.TWIML_URL;
    else process.env.TWIML_URL = previousTwimlUrl;
    rmSync(stateDir, { recursive: true, force: true });
  }
});
