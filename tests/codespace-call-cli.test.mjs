import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { placeCall } = require("../workshop/call.js");

const credentials = {
  TWILIO_ACCOUNT_SID: `AC${"1".repeat(32)}`,
  TWILIO_AUTH_TOKEN: "personal-test-token",
  TWILIO_PHONE_NUMBER: "+12065550100",
  MY_PHONE_NUMBER: "+12065550101",
};

test("local CLI uses the current tunnel and caps an own-account call at 300 seconds", async () => {
  let options;
  let factoryCredentials;
  const result = await placeCall({
    env: credentials,
    resolveUrl: () => "https://learner.trycloudflare.com/twiml",
    clientFactory: (sid, token) => {
      factoryCredentials = { sid, token };
      return { calls: { create: async (value) => {
        options = value;
        return { sid: "CA-test-call" };
      } } };
    },
  });
  assert.deepEqual(factoryCredentials, {
    sid: credentials.TWILIO_ACCOUNT_SID,
    token: credentials.TWILIO_AUTH_TOKEN,
  });
  assert.deepEqual(options, {
    to: credentials.MY_PHONE_NUMBER,
    from: credentials.TWILIO_PHONE_NUMBER,
    url: "https://learner.trycloudflare.com/twiml",
    method: "POST",
    timeLimit: 300,
  });
  assert.equal(result.callSid, "CA-test-call");
});

test("local ngrok caller can supply TWIML_URL without running cloudflared", async () => {
  let lookedUpTunnel = false;
  let options;
  await placeCall({
    env: { ...credentials, TWIML_URL: "https://learner.ngrok-free.app/twiml" },
    resolveUrl: () => { lookedUpTunnel = true; throw new Error("No cloudflared"); },
    clientFactory: () => ({ calls: { create: async (value) => {
      options = value;
      return { sid: "CA-test-call" };
    } } }),
  });
  assert.equal(lookedUpTunnel, false);
  assert.equal(options.url, "https://learner.ngrok-free.app/twiml");
});

test("Codespaces own-account call ignores a stale saved TWIML_URL", async () => {
  let options;
  await placeCall({
    env: {
      ...credentials,
      CODESPACES: "true",
      TWIML_URL: "https://stale.trycloudflare.com/twiml",
    },
    resolveUrl: () => "https://current.trycloudflare.com/twiml",
    clientFactory: () => ({ calls: { create: async (value) => {
      options = value;
      return { sid: "CA-test-call" };
    } } }),
  });
  assert.equal(options.url, "https://current.trycloudflare.com/twiml");
});

test("local CLI fails before Twilio on missing credentials or unsafe TwiML URLs", async () => {
  let called = false;
  const clientFactory = () => { called = true; throw new Error("Should not call Twilio"); };
  await assert.rejects(placeCall({
    env: { ...credentials, TWILIO_AUTH_TOKEN: "" },
    resolveUrl: () => "https://learner.trycloudflare.com/twiml",
    clientFactory,
  }), /TWILIO_AUTH_TOKEN/);
  for (const twimlUrl of [
    "http://learner.trycloudflare.com/twiml",
    "https://learner.trycloudflare.com/call",
    "https://learner.trycloudflare.com:443/twiml",
    "https://attacker.example/twiml",
  ]) {
    await assert.rejects(placeCall({
      env: { ...credentials, TWIML_URL: twimlUrl },
      clientFactory,
    }), /TwiML URL is invalid/);
  }
  assert.equal(called, false);
});
