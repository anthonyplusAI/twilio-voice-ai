import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const source = readFileSync(fileURLToPath(new URL("../src/app/api/twiml/route.ts", import.meta.url)), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function routeFor(env = {}) {
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded,
    exports: loaded.exports,
    process: { env: {
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://workshop.example",
      ...env,
    } },
    URL,
    Response,
    console,
  });
  return loaded.exports.POST;
}

test("Explorer action and default WebSocket use the public origin despite a forged Host", async () => {
  const request = new Request("http://localhost:8080/api/twiml", {
    method: "POST",
    headers: { Host: "attacker.example" },
  });
  const response = await routeFor()(request);
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.match(xml, /<Connect action="https:\/\/workshop\.example\/api\/connect-action" method="POST">/);
  assert.match(xml, /url="wss:\/\/workshop\.example\/ws"/);
  assert.doesNotMatch(xml, /attacker\.example/);
});

test("Explorer local development uses the request origin when no public origin is set", async () => {
  const request = new Request("http://localhost:8080/api/twiml", { method: "POST" });
  const response = await routeFor({ NODE_ENV: "development", PUBLIC_BASE_URL: undefined })(request);
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.match(xml, /action="http:\/\/localhost:8080\/api\/connect-action"/);
  assert.match(xml, /url="ws:\/\/localhost:8080\/ws"/);
});

test("Explorer TwiML fails closed without its public origin in production", async () => {
  const request = new Request("http://localhost:8080/api/twiml", { method: "POST" });
  const response = await routeFor({ PUBLIC_BASE_URL: undefined })(request);
  assert.equal(response.status, 503);
});
