import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import twilio from "twilio";
import { createBuilderActionToken, readBuilderActionToken } from "../src/lib/builder-action-token.mjs";
import { parseBuilderActionTwiml } from "../src/lib/builder-twiml.mjs";

const source = readFileSync(fileURLToPath(new URL("../src/app/api/builder-action/route.ts", import.meta.url)), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const credentials = {
  NODE_ENV: "production",
  PUBLIC_BASE_URL: "https://workshop.example",
  TWILIO_ACCOUNT_SID: "AC-test",
  TWILIO_AUTH_TOKEN: "test-auth-token",
};
let builderResponse = `<Response><Say>Please hold.</Say><Dial><Number>+14165550101</Number></Dial></Response>`;
const fetchedActions = [];
const loaded = { exports: {} };
vm.runInNewContext(code, {
  module: loaded,
  exports: loaded.exports,
  require(specifier) {
    if (specifier === "twilio") return twilio;
    if (specifier === "@/lib/builder-action-token.mjs") return { readBuilderActionToken };
    if (specifier === "@/lib/builder-twiml.mjs") return { parseBuilderActionTwiml };
    throw new Error(`Unexpected import: ${specifier}`);
  },
  process: { env: credentials },
  Request,
  Response,
  URL,
  URLSearchParams,
  TextDecoder,
  AbortSignal,
  fetch: async (url, options) => {
    fetchedActions.push({ url: String(url), options });
    return new Response(builderResponse, { status: 200 });
  },
  console,
});
const { POST } = loaded.exports;

function callback({ actionUrl = "https://attendee.trycloudflare.com/call-ended", signed = true, to = "+12065550101" } = {}) {
  const token = createBuilderActionToken({
    actionUrl,
    phoneNumber: "+12065550101",
    reservationId: "reservation-test",
  }, credentials.TWILIO_AUTH_TOKEN);
  const url = `https://workshop.example/api/builder-action?token=${encodeURIComponent(token)}`;
  const params = {
    AccountSid: credentials.TWILIO_ACCOUNT_SID,
    CallSid: "CA-test",
    To: to,
    HandoffData: JSON.stringify({ reasonCode: "live-agent-handoff" }),
  };
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(signed ? { "X-Twilio-Signature": twilio.getExpectedTwilioSignature(
        credentials.TWILIO_AUTH_TOKEN, url, params,
      ) } : {}),
    },
    body: new URLSearchParams(params),
  });
}

test("a signed Builder handoff can dial one Canadian number for at most one minute", async () => {
  const before = fetchedActions.length;
  const response = await POST(callback());
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<Dial timeLimit="60"><Number>\+14165550101<\/Number><\/Dial>/);
  assert.equal(fetchedActions.length, before + 1);
  assert.equal(fetchedActions.at(-1).url, "https://attendee.trycloudflare.com/call-ended");
  assert.equal(fetchedActions.at(-1).options.method, "POST");
  assert.equal(fetchedActions.at(-1).options.redirect, "error");
});

test("unsigned and mismatched Builder action callbacks cannot reach the Codespace", async () => {
  const before = fetchedActions.length;
  for (const request of [callback({ signed: false }), callback({ to: "+14165550101" })]) {
    const response = await POST(request);
    assert.equal(response.status, 403);
  }
  assert.equal(fetchedActions.length, before);
});

test("an unsigned Builder action is rejected without reading its body", async () => {
  const response = await POST({
    headers: { get: () => null },
    get body() { throw new Error("An unsigned body should not be read"); },
  });
  assert.equal(response.status, 403);
});

test("a large Builder action callback is stopped before signature parsing", async () => {
  const largeBody = "x".repeat(16 * 1024 + 1);
  const response = await POST(new Request("https://workshop.example/api/builder-action", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": "invalid",
    },
    body: largeBody,
  }));
  assert.equal(response.status, 413);
});

test("a Codespace action cannot instruct the shared account to dial internationally", async () => {
  const previous = builderResponse;
  try {
    builderResponse = `<Response><Dial><Number>+442079460000</Number></Dial></Response>`;
    const response = await POST(callback());
    assert.equal(response.status, 200);
    const xml = await response.text();
    assert.doesNotMatch(xml, /<Dial\b/);
    assert.match(xml, /handoff is unavailable/i);
  } finally {
    builderResponse = previous;
  }
});

test("a Builder call without a handoff action ends safely", async () => {
  const before = fetchedActions.length;
  const response = await POST(callback({ actionUrl: null }));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<Response><Hangup\/><\/Response>/);
  assert.equal(fetchedActions.length, before);
});
