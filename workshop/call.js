"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- The standalone workshop package uses CommonJS. */

const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { validTunnelUrl } = require("./secure-proxy.js");

function readConfig() {
  let fileValues = {};
  try {
    fileValues = require("dotenv").parse(readFileSync(join(__dirname, ".env")));
  } catch { /* Codespaces may provide secrets as environment variables. */ }
  const config = { ...process.env };
  for (const [key, value] of Object.entries(fileValues)) {
    if (value) config[key] = value;
  }
  return config;
}

function currentTunnelUrl() {
  const helper = join(__dirname, "..", ".devcontainer", "tunnel-url");
  return execFileSync(helper, [], {
    encoding: "utf8",
    timeout: 45000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function placeCall({
  env = readConfig(),
  resolveUrl = currentTunnelUrl,
  clientFactory = (sid, token) => require("twilio")(sid, token),
} = {}) {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  const from = env.TWILIO_PHONE_NUMBER?.trim();
  const to = env.MY_PHONE_NUMBER?.trim();
  if (!sid || !token || !from || !to) {
    throw new Error("Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, and MY_PHONE_NUMBER in workshop/.env to call from your own Twilio account.");
  }
  if (!/^\+[1-9]\d{1,14}$/.test(from) || !/^\+[1-9]\d{1,14}$/.test(to)) {
    throw new Error("TWILIO_PHONE_NUMBER and MY_PHONE_NUMBER must be E.164 numbers such as +12065550101.");
  }

  // Codespaces regenerates Quick Tunnel URLs. Ignore a manually saved older
  // TWIML_URL there so an own-account demo reaches the current server code.
  const twimlUrl = env.CODESPACES === "true"
    ? await resolveUrl()
    : env.TWIML_URL?.trim() || await resolveUrl();
  if (!validTunnelUrl(twimlUrl, "https", "/twiml")) {
    throw new Error("The current TwiML URL is invalid. Run tunnel-url again, or set TWIML_URL to your public HTTPS /twiml URL.");
  }

  const client = clientFactory(sid, token);
  const call = await client.calls.create({
    to,
    from,
    url: twimlUrl,
    method: "POST",
    timeLimit: 300,
  });
  return { callSid: call.sid, twimlUrl };
}

if (require.main === module) {
  placeCall()
    .then(({ callSid }) => console.log(`Call initiated: ${callSid}`))
    .catch((error) => {
      console.error(`Call not started: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { currentTunnelUrl, placeCall, readConfig };
