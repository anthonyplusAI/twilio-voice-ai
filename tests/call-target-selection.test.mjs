import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import ts from "typescript";
import { createBuilderActionToken } from "../src/lib/builder-action-token.mjs";
import { parseBuilderTwiml, renderBuilderTwiml } from "../src/lib/builder-twiml.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const calls = [];
const analyticsEvents = [];
const preflightRequests = [];
let tunnelFailuresRemaining = 0;
let twilioFailure = null;
let limiterFailure = null;
let builderXmlOverride = null;
let preflightGate = null;
const credentials = {
  TWILIO_ACCOUNT_SID: "AC-test",
  TWILIO_AUTH_TOKEN: "test-token",
  TWILIO_PHONE_NUMBER: "+12065550100",
  OPENAI_API_KEY: "sk-test",
  PUBLIC_BASE_URL: "https://workshop.example",
};
let reserveResult = { allowed: true, reservationId: "reservation-test" };
const limiterCalls = { reserved: [], started: [], canceled: [] };
const limiter = {
  async reserve(phoneNumber) {
    limiterCalls.reserved.push(phoneNumber);
    if (limiterFailure) throw limiterFailure;
    return reserveResult;
  },
  async markStarted(phoneNumber, reservationId, callSid) {
    limiterCalls.started.push({ phoneNumber, reservationId, callSid });
  },
  async cancel(phoneNumber, reservationId) {
    limiterCalls.canceled.push({ phoneNumber, reservationId });
  },
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
      if (preflightGate) await preflightGate;
      if (tunnelFailuresRemaining > 0) {
        tunnelFailuresRemaining--;
        return new Response("Tunnel is offline", { status: 530 });
      }
      return new Response(
        builderXmlOverride || `<Response><Connect><ConversationRelay url="wss://${url.host}/ws" /></Connect></Response>`,
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
      if (twilioFailure) {
        const error = twilioFailure;
        twilioFailure = null;
        throw error;
      }
      calls.push(options);
      return { sid: "CA-test", status: "queued" };
    },
  },
});
const { POST } = loadTypeScript("src/app/api/call/route.ts", {
  twilio,
  "libphonenumber-js/max": { parsePhoneNumberFromString },
  "@/lib/call-target": callTarget,
  "@/lib/call-limiter.mjs": { getCallLimiter: () => limiter },
  "@/lib/builder-action-token.mjs": { createBuilderActionToken },
  "@/lib/builder-twiml.mjs": { parseBuilderTwiml, renderBuilderTwiml },
  "../../../../analytics/db.mjs": {
    async recordEvent(...args) {
      analyticsEvents.push(args);
    },
  },
});

function request(body, host = "workshop.example") {
  return new Request("https://workshop.example/api/call", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: host },
    body: JSON.stringify(body),
  });
}

test("Builder calls give Twilio safe instructions from the current Codespace code", async () => {
  const twimlUrl = "https://example.trycloudflare.com/twiml";
  const response = await POST(request({
    phoneNumber: "+12065550101",
    target: "builder",
    twimlUrl,
    agentConfig: { voice: "Polly.Joanna", welcomeGreeting: "hosted setting" },
  }));

  assert.equal(response.status, 200);
  const options = calls.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify({ ...options, twiml: undefined })), {
    to: "+12065550101",
    from: "+12065550100",
    timeLimit: 300,
    statusCallback: "https://workshop.example/api/call-status?reservationId=reservation-test#rc=3&rp=5xx,ct,rt",
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "completed"],
  });
  assert.match(options.twiml, /url="wss:\/\/example\.trycloudflare\.com\/ws"/);
  assert.match(options.twiml, /action="https:\/\/workshop\.example\/api\/builder-action\?token=/);
  assert.equal(options.url, undefined);
  assert.deepEqual(limiterCalls.started.at(-1), {
    phoneNumber: "+12065550101",
    reservationId: "reservation-test",
    callSid: "CA-test",
  });
  assert.equal(preflightRequests.at(-1).url, twimlUrl);
  assert.equal(preflightRequests.at(-1).options.method, "POST");
  assert.equal(preflightRequests.at(-1).options.redirect, "error");
});

test("Twilio receives a signed retryable call analytics callback for a workshop session", async () => {
  const response = await POST(request({
    phoneNumber: "+12065550101",
    target: "built-in",
    sessionId: "session-test",
  }));
  assert.equal(response.status, 200);
  const options = calls.at(-1);
  const callback = new URL(options.statusCallback);
  assert.equal(callback.searchParams.get("reservationId"), "reservation-test");
  assert.equal(callback.searchParams.get("sessionId"), "session-test");
  assert.equal(callback.hash, "#rc=3&rp=5xx,ct,rt");
  assert.deepEqual(JSON.parse(JSON.stringify(options.statusCallbackEvent)), ["initiated", "completed"]);
  assert.deepEqual(JSON.parse(JSON.stringify(analyticsEvents.at(-1))), [
    "session-test", "call_initiated", { callSid: "CA-test" }, "call-init:CA-test",
  ]);
});

test("A stale Codespace tunnel is rejected before creating a Twilio call", async () => {
  tunnelFailuresRemaining = 2;
  const count = calls.length;
  const canceled = limiterCalls.canceled.length;
  const response = await POST(request({
    phoneNumber: "+12065550101",
    target: "builder",
    twimlUrl: "https://stale.trycloudflare.com/twiml",
  }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /run tunnel-url again/i);
  assert.equal(calls.length, count);
  assert.equal(limiterCalls.canceled.length, canceled + 1);
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
  assert.match(calls.at(-1).twiml, /wss:\/\/fresh\.trycloudflare\.com\/ws/);
});

test("saving a changed Codespace greeting changes the next Builder call", async () => {
  const twimlUrl = "https://edited.trycloudflare.com/twiml";
  const body = { phoneNumber: "+12065550101", target: "builder", twimlUrl };
  try {
    builderXmlOverride = `<Response><Connect><ConversationRelay url="wss://edited.trycloudflare.com/ws" welcomeGreeting="First greeting" /></Connect></Response>`;
    assert.equal((await POST(request(body))).status, 200);
    assert.match(calls.at(-1).twiml, /First greeting/);

    builderXmlOverride = `<Response><Connect><ConversationRelay url="wss://edited.trycloudflare.com/ws" welcomeGreeting="Updated greeting" /></Connect></Response>`;
    assert.equal((await POST(request(body))).status, 200);
    assert.match(calls.at(-1).twiml, /Updated greeting/);
  } finally {
    builderXmlOverride = null;
  }
});

test("unsafe Codespace TwiML is refused before using Twilio", async () => {
  const before = calls.length;
  const canceled = limiterCalls.canceled.length;
  try {
    builderXmlOverride = `<Response><Dial><Number>+442079460000</Number></Dial></Response>`;
    const response = await POST(request({
      phoneNumber: "+12065550101",
      target: "builder",
      twimlUrl: "https://unsafe.trycloudflare.com/twiml",
    }));
    assert.equal(response.status, 422);
    assert.equal(calls.length, before);
    assert.equal(limiterCalls.canceled.length, canceled + 1);
  } finally {
    builderXmlOverride = null;
  }
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

test("a forged Host header cannot change Twilio's website or callback URL", async () => {
  const response = await POST(request({
    phoneNumber: "+12065550103",
    target: "built-in",
  }, "attacker.example"));
  assert.equal(response.status, 200);
  assert.equal(new URL(calls.at(-1).url).origin, "https://workshop.example");
  assert.equal(new URL(calls.at(-1).statusCallback).origin, "https://workshop.example");
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

test("Call Me rejects destinations outside the US and Canada before starting a call", async () => {
  const before = calls.length;
  for (const phoneNumber of ["+442079460000", "+12425550123"]) {
    const response = await POST(request({
      phoneNumber,
      target: "built-in",
    }));
    assert.equal(response.status, 400, phoneNumber);
  }
  assert.equal(calls.length, before);
});

test("Call Me rejects a US premium-rate destination before starting a call", async () => {
  const before = calls.length;
  const response = await POST(request({
    phoneNumber: "+19005550100",
    target: "built-in",
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /premium-rate/i);
  assert.equal(calls.length, before);
});

test("Call Me refuses a second active call before using Twilio", async () => {
  reserveResult = { allowed: false, reason: "active", retryAfterSeconds: 60 };
  const before = calls.length;
  try {
    const response = await POST(request({
      phoneNumber: "+14165550123",
      target: "built-in",
    }));
    assert.equal(response.status, 429);
    assert.equal(calls.length, before);
  } finally {
    reserveResult = { allowed: true, reservationId: "reservation-test" };
  }
});

test("Call Me refuses an eleventh started call within an hour", async () => {
  reserveResult = { allowed: false, reason: "hourly", retryAfterSeconds: 600 };
  const before = calls.length;
  const preflightsBefore = preflightRequests.length;
  try {
    const response = await POST(request({
      phoneNumber: "+14165550123",
      target: "builder",
      twimlUrl: "https://canada.trycloudflare.com/twiml",
    }));
    assert.equal(response.status, 429);
    assert.equal(calls.length, before);
    assert.equal(preflightRequests.length, preflightsBefore);
  } finally {
    reserveResult = { allowed: true, reservationId: "reservation-test" };
  }
});

test("Call Me rejects a large JSON body before using the limiter or Twilio", async () => {
  const reservedBefore = limiterCalls.reserved.length;
  const callsBefore = calls.length;
  const response = await POST(request({
    phoneNumber: "+12065550101",
    target: "built-in",
    agentConfig: { welcomeGreeting: "x".repeat(33 * 1024) },
  }));
  assert.equal(response.status, 413);
  assert.equal(limiterCalls.reserved.length, reservedBefore);
  assert.equal(calls.length, callsBefore);
});

test("Builder preflight connections are bounded even across different numbers", async () => {
  let releasePreflights;
  preflightGate = new Promise((resolve) => { releasePreflights = resolve; });
  const before = preflightRequests.length;
  const canceledBefore = limiterCalls.canceled.length;
  const started = Array.from({ length: 64 }, (_, index) => POST(request({
    phoneNumber: `+1206555${String(1000 + index)}`,
    target: "builder",
    twimlUrl: "https://bound.trycloudflare.com/twiml",
  })));
  try {
    for (let attempt = 0; attempt < 200 && preflightRequests.length < before + 64; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(preflightRequests.length, before + 64);

    const overflow = await POST(request({
      phoneNumber: "+12065551064",
      target: "builder",
      twimlUrl: "https://bound.trycloudflare.com/twiml",
    }));
    assert.equal(overflow.status, 503);
    assert.equal(preflightRequests.length, before + 64);
    assert.equal(limiterCalls.canceled.length, canceledBefore + 1);
  } finally {
    preflightGate = null;
    releasePreflights();
    const responses = await Promise.all(started);
    assert.equal(responses.filter((response) => response.status === 200).length, 64);
  }
});

test("A storage outage stops a call before Twilio can charge for it", async () => {
  limiterFailure = new Error("Storage unavailable");
  const before = calls.length;
  try {
    const response = await POST(request({
      phoneNumber: "+12065550102",
      target: "built-in",
    }));
    assert.equal(response.status, 503);
    assert.equal(calls.length, before);
  } finally {
    limiterFailure = null;
  }
});

test("A Twilio 4xx rejection frees the reserved call slot", async () => {
  twilioFailure = Object.assign(new Error("Twilio test failure"), { status: 400 });
  const before = limiterCalls.canceled.length;
  const response = await POST(request({
    phoneNumber: "+12065550102",
    target: "built-in",
  }));
  assert.equal(response.status, 500);
  assert.deepEqual(limiterCalls.canceled.slice(before), [{
    phoneNumber: "+12065550102",
    reservationId: "reservation-test",
  }]);
});

test("An ambiguous Twilio transport failure keeps the reservation until reconciled", async () => {
  const before = limiterCalls.canceled.length;
  for (const error of [
    new Error("Connection reset after sending request"),
    Object.assign(new Error("Twilio gateway error"), { status: 500 }),
  ]) {
    twilioFailure = error;
    const response = await POST(request({
      phoneNumber: "+12065550102",
      target: "built-in",
    }));
    assert.equal(response.status, 503);
  }
  assert.equal(limiterCalls.canceled.length, before);
});
