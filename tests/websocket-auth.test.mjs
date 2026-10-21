import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import twilio from "twilio";
import WebSocket from "ws";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const authToken = "websocket-test-auth-token";
const publicBaseUrl = "https://workshop.example";
const canonicalWebSocketUrl = "wss://workshop.example/ws";
const apps = [];
const fixtureRoots = [];
let protectedServer;

async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function startServer({ token = authToken, origin = publicBaseUrl } = {}) {
  const root = mkdtempSync(join(tmpdir(), "workshop-websocket-auth-test-"));
  for (const entry of [".next", "next.config.ts", "node_modules", "package.json", "public"]) {
    symlinkSync(join(projectRoot, entry), join(root, entry));
  }
  fixtureRoots.push(root);

  const port = await unusedPort();
  const httpUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    OPENAI_API_KEY: "websocket-auth-test-key",
  };
  delete env.TWILIO_AUTH_TOKEN;
  delete env.PUBLIC_BASE_URL;
  if (token) env.TWILIO_AUTH_TOKEN = token;
  if (origin) env.PUBLIC_BASE_URL = origin;

  let output = "";
  const app = spawn(process.execPath, [join(projectRoot, "server.mjs")], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  apps.push(app);
  app.stdout.on("data", (chunk) => { output += chunk; });
  app.stderr.on("data", (chunk) => { output += chunk; });

  for (let i = 0; i < 180; i++) {
    if (app.exitCode !== null) break;
    try {
      const response = await fetch(`${httpUrl}/health`);
      if (response.ok) return httpUrl.replace(/^http:/, "ws:");
    } catch { /* Wait for startup. */ }
    await delay(250);
  }
  throw new Error(`Workshop server did not start:\n${output}`);
}

function signed(url, token = authToken) {
  return twilio.getExpectedTwilioSignature(token, url, {});
}

async function attemptUpgrade(serverUrl, { path = "/ws", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${serverUrl}${path}`, { headers });
    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error("Timed out waiting for a WebSocket handshake"));
    }, 5000);
    const done = (result) => {
      clearTimeout(timeout);
      resolve(result);
    };
    ws.once("open", () => done({ status: 101, ws }));
    ws.once("unexpected-response", (_request, response) => {
      response.resume();
      response.once("end", () => done({ status: response.statusCode }));
    });
    ws.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

before(async () => {
  protectedServer = await startServer();
});

after(() => {
  for (const app of apps) app.kill("SIGTERM");
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

test("an unsigned WebSocket handshake receives 403", async () => {
  const result = await attemptUpgrade(protectedServer);
  assert.equal(result.status, 403);
});

test("a signature for a forged Host and forwarded scheme receives 403", async () => {
  const result = await attemptUpgrade(protectedServer, {
    headers: {
      Host: "attacker.example",
      "X-Forwarded-Proto": "http",
      "X-Twilio-Signature": signed("ws://attacker.example/ws"),
    },
  });
  assert.equal(result.status, 403);
});

test("a signature for the configured public WSS URL upgrades even with forged proxy headers", async () => {
  const result = await attemptUpgrade(protectedServer, {
    headers: {
      Host: "attacker.example",
      "X-Forwarded-Proto": "http",
      "X-Twilio-Signature": signed(canonicalWebSocketUrl),
    },
  });
  assert.equal(result.status, 101);
  result.ws.close();
});

test("a signature for the public WSS URL with a trailing slash upgrades", async () => {
  const result = await attemptUpgrade(protectedServer, {
    headers: { "X-Twilio-Signature": signed(`${canonicalWebSocketUrl}/`) },
  });
  assert.equal(result.status, 101);
  result.ws.close();
});

test("a trailing-slash signature for a forged public host receives 403", async () => {
  const result = await attemptUpgrade(protectedServer, {
    headers: {
      Host: "attacker.example",
      "X-Twilio-Signature": signed("wss://attacker.example/ws/"),
    },
  });
  assert.equal(result.status, 403);
});

test("a signature for the correct host but wrong WebSocket scheme receives 403", async () => {
  const result = await attemptUpgrade(protectedServer, {
    headers: { "X-Twilio-Signature": signed("ws://workshop.example/ws") },
  });
  assert.equal(result.status, 403);
});

test("production fails closed when the public URL is missing", async () => {
  const serverUrl = await startServer({ origin: "" });
  const result = await attemptUpgrade(serverUrl, {
    headers: { "X-Twilio-Signature": signed(canonicalWebSocketUrl) },
  });
  assert.equal(result.status, 503);
});

test("production fails closed when the Twilio auth token is missing", async () => {
  const serverUrl = await startServer({ token: "" });
  const result = await attemptUpgrade(serverUrl, {
    headers: { "X-Twilio-Signature": signed(canonicalWebSocketUrl) },
  });
  assert.equal(result.status, 503);
});
