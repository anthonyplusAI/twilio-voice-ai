import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const calls = [];
const preflightRequests = [];
let tunnelFailuresRemaining = 0;
const credentials = {
  TWILIO_ACCOUNT_SID: "AC-test",
  TWILIO_AUTH_TOKEN: "test-token",
  TWILIO_PHONE_NUMBER: "+12065550100",
  OPENAI_API_KEY: "sk-test",
};

function loadTypeScript(relativePath, dependencies = {}) {
  const filename = path.join(root, relativePath);
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const loadedModule = { exports: {} };

  vm.runInNewContext(code, {
    module: loadedModule,
    exports: loadedModule.exports,
    require(specifier) {
      if (specifier in dependencies) return dependencies[specifier];
      throw new Error(`Unexpected import in ${relativePath}: ${specifier}`);
    },
    process: { env: credentials },
    Response,
    URL,
    URLSearchParams,
    AbortSignal,
    TextDecoder,
    setTimeout,
    fetch: async (resource, options) => {
      const url = new URL(resource);
      preflightRequests.push({ url: url.href, options });
      if (tunnelFailuresRemaining > 0) {
        tunnelFailuresRemaining--;
        return new Response("Tunnel is offline", { status: 530 });
      }
      return new Response(
        `<Response><Connect><ConversationRelay url="wss://${url.host}/ws" /></Connect></Response>`,
        { status: 200 }
      );
    },
    console,
  }, { filename });

  return loadedModule.exports;
}

const callTarget = loadTypeScript("src/lib/call-target.ts");
const twilio = () => ({
  calls: {
    async create(options) {
      calls.push(options);
      return { sid: "CA-test", status: "queued" };
    },
  },
});
const { POST } = loadTypeScript("src/app/api/call/route.ts", {
  twilio,
  "@/lib/call-target": callTarget,
});

function request(body) {
  return {
    json: async () => body,
    headers: { get: () => "workshop.example" },
  };
}

test("Builder calls give Twilio the current Codespace URL unchanged", async () => {
  const twimlUrl = "https://example.trycloudflare.com/twiml";
  const response = await POST(request({
    phoneNumber: "+12065550101",
    target: "builder",
    twimlUrl,
    agentConfig: { voice: "Polly.Joanna", welcomeGreeting: "hosted setting" },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), {
    to: "+12065550101",
    from: "+12065550100",
    url: twimlUrl,
    method: "POST",
    timeLimit: 300,
  });
  assert.equal(preflightRequests.at(-1).url, twimlUrl);
  assert.equal(preflightRequests.at(-1).options.method, "POST");
  assert.equal(preflightRequests.at(-1).options.redirect, "error");
});

test("A stale Codespace tunnel is rejected before creating a Twilio call", async () => {
  tunnelFailuresRemaining = 2;
  const count = calls.length;
  const response = await POST(request({
    phoneNumber: "+12065550101",
    target: "builder",
    twimlUrl: "https://stale.trycloudflare.com/twiml",
  }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /run tunnel-url again/i);
  assert.equal(calls.length, count);
});

test("A new tunnel gets one chance to finish registering", async () => {
  tunnelFailuresRemaining = 1;
  const before = preflightRequests.length;
  const response = await POST(request({
    phoneNumber: "+12065550101",
    target: "builder",
    twimlUrl: "https://fresh.trycloudflare.com/twiml",
  }));

  assert.equal(response.status, 200);
  assert.equal(preflightRequests.length - before, 2);
  assert.equal(calls.at(-1).url, "https://fresh.trycloudflare.com/twiml");
});

test("Explorer calls use website TwiML with selected voice settings", async () => {
  const response = await POST(request({
    phoneNumber: "+12065550101",
    target: "built-in",
    agentConfig: { voice: "Polly.Joanna", language: "es-ES" },
  }));

  assert.equal(response.status, 200);
  const options = calls.at(-1);
  const url = new URL(options.url);
  assert.equal(url.origin, "https://workshop.example");
  assert.equal(url.pathname, "/api/twiml");
  assert.equal(url.searchParams.get("voice"), "Polly.Joanna");
  assert.equal(url.searchParams.get("language"), "es-ES");
});

test("An explicit empty Explorer tool selection reaches TwiML", async () => {
  const response = await POST(request({
    phoneNumber: "+12065550101",
    target: "built-in",
    agentConfig: { enabledTools: "" },
  }));

  assert.equal(response.status, 200);
  const url = new URL(calls.at(-1).url);
  assert.equal(url.searchParams.has("enabledTools"), true);
  assert.equal(url.searchParams.get("enabledTools"), "");
});
