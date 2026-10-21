import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import ts from "typescript";
import twilio from "twilio";

const source = readFileSync(fileURLToPath(new URL("../src/app/api/connect-action/route.ts", import.meta.url)), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const publicUrl = "https://workshop.example/api/connect-action";
const authToken = "test-auth-token";
const accountSid = "AC-test";

function routeFor(destination, env = {}) {
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded,
    exports: loaded.exports,
    require(specifier) {
      if (specifier === "libphonenumber-js/max") return { parsePhoneNumberFromString };
      if (specifier === "twilio") return twilio;
      throw new Error(`Unexpected import: ${specifier}`);
    },
    process: {
      env: {
        HANDOFF_PHONE_NUMBER: destination,
        TWILIO_ACCOUNT_SID: accountSid,
        TWILIO_AUTH_TOKEN: authToken,
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://workshop.example",
        ...env,
      },
    },
    Request,
    Response,
    URL,
    URLSearchParams,
    TextDecoder,
    console,
  });
  return loaded.exports.POST;
}

function handoffRequest({
  signed = true,
  params = {},
  requestUrl = publicUrl,
  signingUrl = publicUrl,
  headers = {},
  body,
} = {}) {
  const fields = {
    AccountSid: accountSid,
    CallSid: "CA-test",
    HandoffData: JSON.stringify({ reasonCode: "live-agent-handoff" }),
    ...params,
  };
  return new Request(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(signed ? { "X-Twilio-Signature": twilio.getExpectedTwilioSignature(
        authToken, signingUrl, fields,
      ) } : {}),
      ...headers,
    },
    body: body ?? new URLSearchParams(fields),
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}

test("a signed Explorer handoff dials only a short US or Canadian call", async () => {
  for (const phone of ["+12065550101", "+14165550101"]) {
    const response = await routeFor(phone)(handoffRequest());
    assert.equal(response.status, 200);
    assert.match(await response.text(), new RegExp(`<Dial timeLimit="60">\\${phone}</Dial>`));
  }
});

test("Explorer handoff refuses international and premium-rate destinations", async () => {
  for (const phone of ["+442079460000", "+12425550123", "+19005550100"]) {
    const response = await routeFor(phone)(handoffRequest());
    const xml = await response.text();
    assert.doesNotMatch(xml, /<Dial\b/);
    assert.match(xml, /handoff is unavailable/i);
  }
});

test("a signed Explorer callback without handoff data ends the call normally", async () => {
  const response = await routeFor("+12065550101")(
    handoffRequest({ params: { HandoffData: "" } }),
  );
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.match(xml, /Thank you for calling\. Goodbye\./);
  assert.doesNotMatch(xml, /<Dial\b/);
});

test("an unsigned Explorer callback is rejected without reading its body", async () => {
  const request = {
    headers: new Headers({ "Content-Type": "application/x-www-form-urlencoded" }),
    get body() { throw new Error("The unsigned body should not be read"); },
  };
  const response = await routeFor("+12065550101")(request);
  assert.equal(response.status, 403);
});

test("a forged signature or account cannot trigger an Explorer handoff", async () => {
  const route = routeFor("+12065550101");
  for (const request of [
    handoffRequest({ signingUrl: "https://attacker.example/api/connect-action" }),
    handoffRequest({ params: { AccountSid: "AC-other" } }),
  ]) {
    const response = await route(request);
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /<Dial\b/);
  }
});

test("Explorer callback rejects oversized declared bodies before reading", async () => {
  const request = {
    url: publicUrl,
    headers: new Headers({
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": "present",
      "Content-Length": String(16 * 1024 + 1),
    }),
    get body() { throw new Error("An oversized body should not be read"); },
  };
  const response = await routeFor("+12065550101")(request);
  assert.equal(response.status, 413);
});

test("Explorer callback caps streamed bodies without Content-Length", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("HandoffData="));
      controller.enqueue(new Uint8Array(16 * 1024));
      controller.close();
    },
  });
  const request = handoffRequest({ body });
  assert.equal(request.headers.has("content-length"), false);
  const response = await routeFor("+12065550101")(request);
  assert.equal(response.status, 413);
});

test("Explorer callback requires a form body and production public origin", async () => {
  const wrongType = handoffRequest({ headers: { "Content-Type": "application/json" } });
  assert.equal((await routeFor("+12065550101")(wrongType)).status, 415);

  const missingOrigin = routeFor("+12065550101", { PUBLIC_BASE_URL: undefined });
  assert.equal((await missingOrigin(handoffRequest())).status, 503);
});

test("Explorer callback accepts the development URL when no public origin is configured", async () => {
  const localUrl = "http://localhost:8080/api/connect-action";
  const route = routeFor("+12065550101", { NODE_ENV: "development", PUBLIC_BASE_URL: undefined });
  const response = await route(handoffRequest({ requestUrl: localUrl, signingUrl: localUrl }));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<Dial timeLimit="60">\+12065550101<\/Dial>/);
});
