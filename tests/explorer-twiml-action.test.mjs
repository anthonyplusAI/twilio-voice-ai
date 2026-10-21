import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { WORKSHOP_LANGUAGE_CODES } from "../voice-agent/system-prompt.mjs";

const source = readFileSync(fileURLToPath(new URL("../src/app/api/twiml/route.ts", import.meta.url)), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const catalogSource = readFileSync(fileURLToPath(new URL("../src/lib/voice-catalog.ts", import.meta.url)), "utf8");
const catalogCode = ts.transpileModule(catalogSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loadedCatalog = { exports: {} };
vm.runInNewContext(catalogCode, { module: loadedCatalog, exports: loadedCatalog.exports });
const catalog = loadedCatalog.exports;
const greetingSource = readFileSync(fileURLToPath(new URL("../src/lib/explorer-greeting.ts", import.meta.url)), "utf8");
const greetingCode = ts.transpileModule(greetingSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loadedGreeting = { exports: {} };
vm.runInNewContext(greetingCode, { module: loadedGreeting, exports: loadedGreeting.exports });

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
    require(specifier) {
      if (specifier === "@/lib/voice-catalog") return catalog;
      if (specifier === "@/lib/explorer-greeting") return loadedGreeting.exports;
      throw new Error(`Unexpected import: ${specifier}`);
    },
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

test("Explorer sends Twilio the Amazon provider for a selected Polly voice", async () => {
  const voice = catalog.VOICE_CATALOG.find((entry) => entry.id === "Joanna-Neural");
  assert.ok(voice, "the workshop catalog should offer Joanna");

  const params = new URLSearchParams({ voice: voice.id, ttsProvider: voice.provider });
  const request = new Request(`https://workshop.example/api/twiml?${params}`, { method: "POST" });
  const response = await routeFor()(request);
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.match(xml, /voice="Joanna-Neural"/);
  assert.match(xml, /ttsProvider="Amazon"/);
});

test("Explorer keeps an English-only persona voice and switches to a compatible Spanish voice", async () => {
  const params = new URLSearchParams({ voice: "Joanna-Neural", ttsProvider: "Amazon", language: "en-US" });
  const request = new Request(`https://workshop.example/api/twiml?${params}`, { method: "POST" });
  const response = await routeFor()(request);
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.match(xml, /<ConversationRelay\b[^>]*voice="Joanna-Neural"/);
  assert.match(xml, /<Language code="en-US" ttsProvider="Amazon" voice="Joanna-Neural" transcriptionProvider="Deepgram" speechModel="nova-3-general"\s*\/>/);
  assert.match(xml, /<Language code="es-ES" ttsProvider="ElevenLabs" voice="6xftrpatV0jGmFHxDjUv" transcriptionProvider="Google" speechModel="telephony"\s*\/>/);
  assert.match(xml, /<Language code="zh-CN" ttsProvider="Amazon" voice="Zhiyu-Neural" transcriptionProvider="Deepgram" speechModel="nova-2-general"\s*\/>/);
  for (const { code } of catalog.WORKSHOP_LANGUAGES) {
    assert.ok(xml.includes(`<Language code="${code}"`),
      `${code} must be configured for mid-call switching`);
  }
});

test("Explorer preserves a multilingual voice across every selected language", async () => {
  const params = new URLSearchParams({ voice: "gUABw7pXQjhjt0kNFBTF", ttsProvider: "ElevenLabs" });
  const request = new Request(`https://workshop.example/api/twiml?${params}`, { method: "POST" });
  const response = await routeFor()(request);
  assert.equal(response.status, 200);
  const xml = await response.text();
  for (const { code } of catalog.WORKSHOP_LANGUAGES) {
    if (code === "en-US") continue;
    assert.match(xml,
      new RegExp(`<Language code="${code}" ttsProvider="ElevenLabs" voice="gUABw7pXQjhjt0kNFBTF" [^>]*\\/>`));
  }
});

test("Explorer prompt and picker advertise the same switchable languages", () => {
  assert.deepEqual([...WORKSHOP_LANGUAGE_CODES].sort(),
    [...catalog.WORKSHOP_LANGUAGES].map(({ code }) => code).sort());
});

test("Explorer passes the selected initial language to the voice agent", async () => {
  const params = new URLSearchParams({ language: "fr-FR" });
  const response = await routeFor()(new Request(`https://workshop.example/api/twiml?${params}`, { method: "POST" }));
  const xml = await response.text();
  assert.match(xml, /language="fr-FR"/);
  assert.match(xml, /<Parameter name="initialLanguage" value="fr-FR"\s*\/>/);
  assert.match(xml, /<Connect action="https:\/\/workshop\.example\/api\/connect-action\?language=fr-FR"/);

  const invalid = await routeFor()(new Request("https://workshop.example/api/twiml?language=de-DE", { method: "POST" }));
  assert.match(await invalid.text(), /<Parameter name="initialLanguage" value="en-US"\s*\/>/);
});

test("Explorer repairs an old English-only persona voice and greeting for a French-first call", async () => {
  const params = new URLSearchParams({
    voice: "s0XGIcqmceN2l7kjsqoZ",
    ttsProvider: "ElevenLabs",
    language: "fr-FR",
    welcomeGreeting: "Hey there! I'm Sam from Twilio Airways. Where can I help you fly today?",
  });
  const response = await routeFor()(new Request(`https://workshop.example/api/twiml?${params}`, { method: "POST" }));
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.match(xml, /<ConversationRelay\b[^>]*voice="a5n9pJUnAhX4fn7lx3uo"/);
  assert.match(xml, /ttsProvider="ElevenLabs"\s+language="fr-FR"\s+transcriptionProvider="Google"\s+speechModel="telephony"/);
  assert.match(xml, /welcomeGreeting="Bonjour ! Je suis Sam de Twilio Airways/);
  assert.match(xml, /<Language code="en-US" ttsProvider="ElevenLabs" voice="s0XGIcqmceN2l7kjsqoZ"/);
  assert.match(xml, /<Parameter name="initialLanguage" value="fr-FR"\s*\/>/);
});

test("Explorer keeps a custom greeting when the initial language changes", async () => {
  const params = new URLSearchParams({ language: "fr-FR", welcomeGreeting: "My custom call opening" });
  const response = await routeFor()(new Request(`https://workshop.example/api/twiml?${params}`, { method: "POST" }));
  assert.match(await response.text(), /welcomeGreeting="My custom call opening"/);
});

test("Explorer accepts a previously saved Amazon Polly voice choice", async () => {
  const params = new URLSearchParams({ voice: "Joanna-Neural", ttsProvider: "Amazon Polly" });
  const request = new Request(`https://workshop.example/api/twiml?${params}`, { method: "POST" });
  const response = await routeFor()(request);
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.match(xml, /voice="Joanna-Neural"/);
  assert.match(xml, /ttsProvider="Amazon"/);
  assert.doesNotMatch(xml, /ttsProvider="Amazon Polly"/);
});
