import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import twilio from "twilio";

const root = fileURLToPath(new URL("..", import.meta.url));
const credentials = {
  TWILIO_ACCOUNT_SID: "AC-test",
  TWILIO_AUTH_TOKEN: "test-token",
  PUBLIC_BASE_URL: "https://workshop.example",
};
const completed = [];
const limiter = {
  async complete(phoneNumber, reservationId, callSid) {
    completed.push({ phoneNumber, reservationId, callSid });
  },
};

function loadCallback() {
  const filename = path.join(root, "src/app/api/call-status/route.ts");
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
      if (specifier === "twilio") return twilio;
      if (specifier === "@/lib/call-limiter.mjs") {
        return { getCallLimiter: () => limiter };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
    process: { env: credentials },
    Response,
    TextDecoder,
    URL,
    URLSearchParams,
    console,
  }, { filename });
  return loadedModule.exports;
}

const callbackUrl = "https://workshop.example/api/call-status?reservationId=reservation-test";
const params = {
  AccountSid: credentials.TWILIO_ACCOUNT_SID,
  CallSid: "CA0123456789abcdef0123456789abcdef",
  CallStatus: "completed",
  To: "+12065550101",
};

function request(values = params, signature = "", host) {
  return new Request(callbackUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
      ...(host ? { host } : {}),
    },
    body: new URLSearchParams(values),
  });
}

test("a signed Twilio completion releases only its own phone reservation", async () => {
  const { POST } = loadCallback();
  const signature = twilio.getExpectedTwilioSignature(
    credentials.TWILIO_AUTH_TOKEN,
    callbackUrl,
    params
  );
  const before = completed.length;
  const response = await POST(request(params, signature));
  assert.equal(response.status, 204);
  assert.deepEqual(completed.slice(before), [{
    phoneNumber: "+12065550101",
    reservationId: "reservation-test",
    callSid: params.CallSid,
  }]);
});

test("an unsigned completion cannot release a phone reservation", async () => {
  const { POST } = loadCallback();
  const before = completed.length;
  const response = await POST(request());
  assert.equal(response.status, 403);
  assert.equal(completed.length, before);
});

test("an unsigned callback is rejected without reading its body", async () => {
  const { POST } = loadCallback();
  const response = await POST({
    headers: new Headers({ "content-type": "application/x-www-form-urlencoded" }),
    url: callbackUrl,
    get body() {
      assert.fail("Unsigned callback body must not be read");
    },
    formData() {
      assert.fail("Unsigned callback form must not be parsed");
    },
  });
  assert.equal(response.status, 403);
});

test("a callback with a declared body above 16 KiB is rejected before reading", async () => {
  const { POST } = loadCallback();
  const response = await POST({
    headers: new Headers({
      "content-type": "application/x-www-form-urlencoded",
      "content-length": "16385",
      "x-twilio-signature": "present-but-invalid",
    }),
    url: callbackUrl,
    get body() {
      assert.fail("Oversized callback body must not be read");
    },
  });
  assert.equal(response.status, 413);
});

test("a streamed callback above 16 KiB is rejected during reading", async () => {
  const { POST } = loadCallback();
  let canceled = false;
  let chunks = 0;
  const body = new ReadableStream({
    pull(controller) {
      chunks += 1;
      if (chunks === 1) controller.enqueue(new TextEncoder().encode("x".repeat(8192)));
      else if (chunks === 2) controller.enqueue(new TextEncoder().encode("x".repeat(8193)));
      else controller.close();
    },
    cancel() {
      canceled = true;
    },
  }, { highWaterMark: 0 });
  const callback = new Request(callbackUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "present-but-invalid",
    },
    body,
    duplex: "half",
  });
  const response = await POST(callback);
  assert.equal(response.status, 413);
  assert.equal(canceled, true);
});

test("a signed nonterminal call event cannot release a phone reservation", async () => {
  const { POST } = loadCallback();
  const ringing = { ...params, CallStatus: "ringing" };
  const signature = twilio.getExpectedTwilioSignature(
    credentials.TWILIO_AUTH_TOKEN,
    callbackUrl,
    ringing
  );
  const before = completed.length;
  const response = await POST(request(ringing, signature));
  assert.equal(response.status, 204);
  assert.equal(completed.length, before);
});

test("a forged Host header cannot invalidate the signed public callback URL", async () => {
  const { POST } = loadCallback();
  const signature = twilio.getExpectedTwilioSignature(
    credentials.TWILIO_AUTH_TOKEN,
    callbackUrl,
    params
  );
  const response = await POST(request(params, signature, "attacker.example"));
  assert.equal(response.status, 204);
});
