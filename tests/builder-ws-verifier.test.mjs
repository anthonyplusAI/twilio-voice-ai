import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import twilio from "twilio";

const source = readFileSync(fileURLToPath(new URL("../src/app/api/verify-builder-ws/route.ts", import.meta.url)), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const token = "site-ws-verifier-test-token";
const url = "wss://learner.trycloudflare.com/ws";

function routeFor(authToken = token) {
  const loaded = { exports: {} };
  vm.runInNewContext(compiled, {
    module: loaded,
    exports: loaded.exports,
    require(specifier) {
      if (specifier === "twilio") return twilio;
      throw new Error(`Unexpected import: ${specifier}`);
    },
    process: { env: { TWILIO_AUTH_TOKEN: authToken } },
    Request,
    Response,
    URL,
    TextDecoder,
  });
  return loaded.exports.POST;
}

function verifyRequest(wsUrl, signature = twilio.getExpectedTwilioSignature(token, wsUrl, {})) {
  return new Request("https://workshop.example/api/verify-builder-ws", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: wsUrl, signature }),
  });
}

test("hosted verifier accepts a site-signed Builder WebSocket handshake", async () => {
  const response = await routeFor()(verifyRequest(url));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { valid: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("hosted verifier accepts Twilio's documented WebSocket trailing-slash signature", async () => {
  const signature = twilio.getExpectedTwilioSignature(token, `${url}/`, {});
  const response = await routeFor()(verifyRequest(url, signature));
  assert.equal(response.status, 200);
});

test("hosted verifier rejects unsigned and wrong-token handshakes", async () => {
  const route = routeFor();
  const wrongSignature = twilio.getExpectedTwilioSignature("other-token", url, {});
  assert.equal((await route(verifyRequest(url, wrongSignature))).status, 403);
  assert.equal((await route(verifyRequest(url, "bad"))).status, 400);
});

test("hosted verifier allows only exact public tunnel WSS /ws URLs", async () => {
  const route = routeFor();
  for (const badUrl of [
    "wss://attacker.example/ws",
    "ws://learner.trycloudflare.com/ws",
    "wss://learner.trycloudflare.com:443/ws",
    "wss://learner.trycloudflare.com/ws?next=/x",
    "wss://learner.trycloudflare.com/ws/",
    "wss://user@learner.trycloudflare.com/ws",
    "wss://learner.trycloudflare.com.evil.example/ws",
    "wss://learner.trycloudflare.com/%77s",
  ]) {
    assert.equal((await route(verifyRequest(badUrl))).status, 400, badUrl);
  }
  const ngrokUrl = "wss://learner.ngrok-free.app/ws";
  assert.equal((await route(verifyRequest(ngrokUrl))).status, 200);
});

test("hosted verifier bounds requests and fails closed without the site token", async () => {
  const route = routeFor();
  const oversized = new Request("https://workshop.example/api/verify-builder-ws", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "x".repeat(1025),
  });
  assert.equal((await route(oversized)).status, 413);
  assert.equal((await routeFor("")(verifyRequest(url))).status, 503);
});
