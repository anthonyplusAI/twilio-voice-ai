import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

let app;
let baseUrl;
let output = "";

async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

before(async () => {
  const port = await unusedPort();
  baseUrl = `http://127.0.0.1:${port}`;
  app = spawn(process.execPath, ["server.mjs"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      TWILIO_ACCOUNT_SID: "invalid-test-sid",
      TWILIO_AUTH_TOKEN: "test-token",
      TWILIO_PHONE_NUMBER: "+12065550100",
      OPENAI_API_KEY: "sk-test",
      HANDOFF_PHONE_NUMBER: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout.on("data", (chunk) => { output += chunk; });
  app.stderr.on("data", (chunk) => { output += chunk; });

  for (let i = 0; i < 80; i++) {
    if (app.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch { /* Wait for startup. */ }
    await delay(250);
  }
  throw new Error(`Workshop server did not start:\n${output}`);
});

after(() => {
  app?.kill("SIGTERM");
});

async function call(body) {
  return fetch(`${baseUrl}/api/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: "+12065550101", ...body }),
  });
}

test("Builder call without a tunnel URL is rejected before Twilio is called", async () => {
  const response = await call({ target: "builder" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /TwiML URL/i);
});

test("A call must select the Builder or hosted agent explicitly", async () => {
  const response = await call({});
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /target/i);
});

test("Malformed call payload is rejected as a client error", async () => {
  const response = await fetch(`${baseUrl}/api/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
  });
  assert.equal(response.status, 400);
});

test("Malformed Builder URL is rejected instead of using the hosted agent", async () => {
  const response = await call({ target: "builder", twimlUrl: "not-a-url" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /TwiML URL/i);
});

test("A local URL is rejected because Twilio cannot reach the Codespace", async () => {
  const response = await call({ target: "builder", twimlUrl: "https://localhost:8080/twiml" });
  assert.equal(response.status, 400);
});

test("A private IP cannot be used as a Builder TwiML URL", async () => {
  const response = await call({ target: "builder", twimlUrl: "https://10.0.0.1/twiml" });
  assert.equal(response.status, 400);
});

test("Builder URL must address the TwiML route", async () => {
  const response = await call({ target: "builder", twimlUrl: "https://example.trycloudflare.com" });
  assert.equal(response.status, 400);
});

test("Explicit hosted-agent calls cannot accidentally carry a Builder URL", async () => {
  const response = await call({ target: "built-in", twimlUrl: "https://example.trycloudflare.com/twiml" });
  assert.equal(response.status, 400);
});

test("Explorer TwiML disables handoff until the learner turns it on", async () => {
  const response = await fetch(`${baseUrl}/api/twiml`, { method: "POST" });
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.match(xml, /<Parameter name="handoffEnabled" value="false"\s*\/>/);
  assert.match(xml, /reportInputDuringAgentSpeech="any"/);
});

test("Explorer TwiML enables handoff only after an explicit true setting", async () => {
  const response = await fetch(`${baseUrl}/api/twiml?handoffEnabled=true`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<Parameter name="handoffEnabled" value="true"\s*\/>/);
});

test("Explorer TwiML preserves an explicit empty tool selection", async () => {
  const response = await fetch(`${baseUrl}/api/twiml?enabledTools=`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<Parameter name="enabledTools" value=""\s*\/>/);
});

test("Explorer lets Twilio choose the default voice for an unselected Spanish voice", async () => {
  const response = await fetch(`${baseUrl}/api/twiml?language=es-ES`, { method: "POST" });
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.match(xml, /language="es-ES"/);
  assert.doesNotMatch(xml, /\svoice=/);
});

test("Explorer keeps an explicitly selected voice", async () => {
  const response = await fetch(`${baseUrl}/api/twiml?language=es-ES&voice=es-ES-Neural2-H&ttsProvider=Google`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /voice="es-ES-Neural2-H"/);
});

test("A missing handoff destination never dials the sample phone number", async () => {
  const response = await fetch(`${baseUrl}/api/connect-action`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      HandoffData: JSON.stringify({ reasonCode: "live-agent-handoff" }),
    }),
  });
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.doesNotMatch(xml, /<Dial>/);
  assert.match(xml, /handoff is unavailable/i);
});
