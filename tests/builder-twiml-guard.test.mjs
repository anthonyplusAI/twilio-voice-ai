import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { XMLValidator } from "fast-xml-parser";
import {
  parseBuilderActionTwiml,
  parseBuilderTwiml,
  renderBuilderTwiml,
} from "../src/lib/builder-twiml.mjs";

const HOST = "voice-demo.trycloudflare.com";
const TWIML_URL = "https://" + HOST + "/twiml";
const RELAY_URL = "wss://" + HOST + "/ws";
const SITE_ACTION = "https://workshop.example/api/builder-action?call=CA123";

function guidedTwiml(relativeFile) {
  const source = readFileSync(new URL(relativeFile, import.meta.url), "utf8");
  const delimiter = "\\" + String.fromCharCode(96);
  const marker = "const twiml = " + delimiter;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "the guided server must contain a TwiML response");
  const remaining = source.slice(start + marker.length);
  const end = remaining.indexOf(delimiter + ";");
  assert.notEqual(end, -1, "the guided TwiML template must close");
  return remaining.slice(0, end).replaceAll("\\" + "$" + "{req.headers.host}", HOST);
}

function initialXml(attributes, connectAttributes = "") {
  return '<Response><Connect' + connectAttributes + '><ConversationRelay ' +
    attributes + ' /></Connect></Response>';
}

function rendered(parsed) {
  const xml = renderBuilderTwiml(parsed, SITE_ACTION);
  assert.equal(XMLValidator.validate(xml), true);
  assert.ok(xml.length <= 4000, "inline TwiML must fit the CreateCall limit");
  return xml;
}

test("Chapter 2 guided TwiML is accepted and the Connect action is owned by the site", () => {
  const parsed = parseBuilderTwiml(
    guidedTwiml("../src/content/chapter-2/step-2-twiml-setup.ts"),
    TWIML_URL,
  );
  assert.deepEqual(parsed, {
    relayAttributes: {
      url: RELAY_URL,
      welcomeGreeting: "Hello! How can I help you today?",
    },
    actionUrl: null,
  });
  const xml = rendered(parsed);
  assert.match(xml, /<Connect action="https:\/\/workshop\.example\/api\/builder-action\?call=CA123">/);
  assert.match(xml, /<ConversationRelay url="wss:\/\/voice-demo\.trycloudflare\.com\/ws"/);
});

test("Chapter 6 guided TwiML keeps language defaults and proxies the handoff action", () => {
  const parsed = parseBuilderTwiml(
    guidedTwiml("../src/content/chapter-6/step-1-polish.ts"),
    TWIML_URL,
  );
  assert.equal(parsed.actionUrl, "https://" + HOST + "/call-ended");
  assert.equal(parsed.relayAttributes.voice, undefined);
  assert.equal(parsed.relayAttributes.ttsProvider, undefined);
  assert.equal(parsed.relayAttributes.dtmfDetection, "true");
  assert.equal(parsed.relayAttributes.interruptSensitivity, "medium");
  assert.equal(parsed.relayAttributes.hints, "Twilio Pizza Co., order status, transfer, refund");
  const xml = rendered(parsed);
  assert.match(xml, /welcomeGreeting="Hello! How can I help you today\?"/);
  assert.match(xml, /hints="Twilio Pizza Co., order status, transfer, refund"/);
  assert.doesNotMatch(xml, /action="\/call-ended"/);
  assert.doesNotMatch(xml, /trycloudflare\.com\/call-ended/);
});

test("bilingual Builder examples across Chapters 4 and 5 are accepted by Call Me", () => {
  for (const file of [
    "../src/content/chapter-4/step-4-language-switch.ts",
    "../src/content/chapter-5/step-2-define-tools.ts",
    "../src/content/chapter-5/step-3-handle-tools.ts",
    "../src/content/chapter-5/step-4-handoff.ts",
  ]) {
    const parsed = parseBuilderTwiml(guidedTwiml(file), TWIML_URL);
    assert.equal(parsed.relayAttributes.voice, undefined, file);
    assert.equal(parsed.relayAttributes.ttsProvider, undefined, file);
    assert.equal(parsed.relayAttributes.language, "en-US", file);
    assert.match(rendered(parsed), /<ConversationRelay /, file);
  }
});

test("the absolute same-host action URL is accepted and normalized", () => {
  const parsed = parseBuilderTwiml(initialXml(
    'url="' + RELAY_URL + '"',
    ' action="https://' + HOST + '/call-ended"',
  ), TWIML_URL);
  assert.equal(parsed.actionUrl, "https://" + HOST + "/call-ended");
});

test("the initial response rejects any extra billable TwiML verbs or nested content", () => {
  const safe = initialXml('url="' + RELAY_URL + '"');
  for (const xml of [
    safe.replace("</Response>", "<Dial>+19005550100</Dial></Response>"),
    safe.replace("</Response>", "<Redirect>https://attacker.example</Redirect></Response>"),
    safe.replace("</Response>", "<Connect><Stream url=\"wss://attacker.example/ws\" /></Connect></Response>"),
    safe.replace("</Connect>", "<Say>extra</Say></Connect>"),
    safe.replace(" />", "><Parameter name=\"x\" value=\"y\" /></ConversationRelay>"),
    safe.replace("<Connect>", "<Connect method=\"GET\">"),
    safe.replace("<ConversationRelay ", "<ConversationRelay statusCallback=\"https://attacker.example\" "),
    "<Response><Connect><ConversationRelay url=\"" + RELAY_URL + "\" /></Connect></Response><Response><Hangup /></Response>",
  ]) {
    assert.throws(() => parseBuilderTwiml(xml, TWIML_URL), /TwiML|XML|attribute|element|content/i, xml);
  }
});

test("the relay WebSocket must be wss on the TwiML host at exactly /ws", () => {
  for (const url of [
    "ws://" + HOST + "/ws",
    "wss://attacker.example/ws",
    "wss://" + HOST + ":443/ws",
    "wss://" + HOST + "/other",
    "wss://" + HOST + "/ws?next=elsewhere",
    "wss://" + HOST + "/ws#fragment",
    "wss://user@" + HOST + "/ws",
    "wss://" + HOST + ".attacker.example/ws",
  ]) {
    assert.throws(
      () => parseBuilderTwiml(initialXml('url="' + url + '"'), TWIML_URL),
      /WebSocket|relay|url|host/i,
      url,
    );
  }
});

test("Builder preflight rejects Deepgram as a text-to-speech provider", () => {
  assert.throws(
    () => parseBuilderTwiml(initialXml(
      'url="' + RELAY_URL + '" ttsProvider="Deepgram"',
    ), TWIML_URL),
    /ttsProvider/,
  );
});

test("Builder action permits only /call-ended on the same host without URL tricks", () => {
  for (const action of [
    "/other",
    "/call-ended?next=other",
    "/call-ended#fragment",
    "//attacker.example/call-ended",
    "http://" + HOST + "/call-ended",
    "https://attacker.example/call-ended",
    "https://" + HOST + ":443/call-ended",
    "https://user@" + HOST + "/call-ended",
    "https://" + HOST + "/%63all-ended",
    "https://" + HOST + "/call-ended?redirect=https://attacker.example",
  ]) {
    assert.throws(
      () => parseBuilderTwiml(initialXml('url="' + RELAY_URL + '"', ' action="' + action + '"'), TWIML_URL),
      /action|url|host/i,
      action,
    );
  }
});

test("unknown XML entities, DTDs, comments, CDATA, processing instructions, and malformed XML fail closed", () => {
  const safe = initialXml('url="' + RELAY_URL + '"');
  for (const xml of [
    '<!DOCTYPE Response [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + safe,
    safe.replace(" />", ' welcomeGreeting="&evil;" />'),
    safe.replace(" />", ' welcomeGreeting="&#x3c;Dial&#x3e;" />'),
    safe.replace("<Connect>", "<!-- hidden --><Connect>"),
    safe.replace("<Connect>", "<![CDATA[hidden]]><Connect>"),
    safe.replace("<Connect>", "<?php hidden?><Connect>"),
    safe.replace("</Response>", ""),
    safe.replace('url="' + RELAY_URL + '"', 'url="' + RELAY_URL + '" url="' + RELAY_URL + '"'),
  ]) {
    assert.throws(() => parseBuilderTwiml(xml, TWIML_URL), /TwiML|XML|entity|DTD|comment|content/i, xml);
  }
});

test("predefined XML entities are decoded once and safely escaped on output", () => {
  const parsed = parseBuilderTwiml(initialXml(
    'url="' + RELAY_URL + '" welcomeGreeting="Bread &amp; butter &lt;3 &quot;today&quot;"',
  ), TWIML_URL);
  assert.equal(parsed.relayAttributes.welcomeGreeting, 'Bread & butter <3 "today"');
  assert.match(rendered(parsed), /welcomeGreeting="Bread &amp; butter &lt;3 &quot;today&quot;"/);
});

test("input and inline output have hard size limits", () => {
  assert.throws(
    () => parseBuilderTwiml(" ".repeat(65_537) + initialXml('url="' + RELAY_URL + '"'), TWIML_URL),
    /large|size|limit/i,
  );
  const parsed = parseBuilderTwiml(initialXml(
    'url="' + RELAY_URL + '" welcomeGreeting="' + "a".repeat(4_000) + '"',
  ), TWIML_URL);
  assert.throws(() => renderBuilderTwiml(parsed, SITE_ACTION), /large|size|limit/i);
});

test("rendering rejects an unsafe site action URL", () => {
  const parsed = parseBuilderTwiml(initialXml('url="' + RELAY_URL + '"'), TWIML_URL);
  for (const url of [
    "http://workshop.example/api/builder-action",
    "https://user@workshop.example/api/builder-action",
    "https://workshop.example:443/api/builder-action",
    "https://workshop.example/api/builder-action#frag",
  ]) {
    assert.throws(() => renderBuilderTwiml(parsed, url), /action|url|https/i, url);
  }
});

test("Chapter 6 handoff action is reduced to one US/Canada Dial of at most 60 seconds", () => {
  for (const number of ["+12065550101", "+14165550101"]) {
    const xml = parseBuilderActionTwiml(
      "<Response><Say>Please hold while I transfer you.</Say><Dial><Number>" +
      number + "</Number></Dial></Response>",
    );
    assert.equal(XMLValidator.validate(xml), true);
    assert.match(xml, /<Say>Please hold while I transfer you\.<\/Say>/);
    assert.match(xml, /<Dial timeLimit="60"><Number>/);
    assert.ok(xml.includes("<Number>" + number + "</Number>"));
    assert.doesNotMatch(xml, /<Redirect|<Queue|<Conference/);
  }
});

test("Chapter 6 goodbye and unavailable handoff actions preserve Say then Hangup", () => {
  for (const speech of [
    "Thank you for calling. Goodbye!",
    "Sorry, live transfer is unavailable right now. Please call back later.",
  ]) {
    const xml = parseBuilderActionTwiml("<Response><Say>" + speech + "</Say><Hangup /></Response>");
    assert.equal(XMLValidator.validate(xml), true);
    assert.match(xml, /<Hangup\s*\/>/);
    assert.match(xml, new RegExp("<Say>" + speech.replaceAll(".", "\\.") + "</Say>"));
  }
});

test("action TwiML rejects extra calls, redirects, recording, URL attributes, and unsupported destinations", () => {
  for (const xml of [
    "<Response><Dial><Number>+19005550100</Number></Dial></Response>",
    "<Response><Dial><Number>+442079460000</Number></Dial></Response>",
    "<Response><Dial><Number>+12065550101</Number><Number>+14165550101</Number></Dial></Response>",
    "<Response><Dial>+12065550101</Dial></Response>",
    "<Response><Dial><Client>other</Client></Dial></Response>",
    '<Response><Dial action="https://attacker.example"><Number>+12065550101</Number></Dial></Response>',
    '<Response><Dial timeLimit="9999"><Number>+12065550101</Number></Dial></Response>',
    '<Response><Dial><Number statusCallback="https://attacker.example">+12065550101</Number></Dial></Response>',
    '<Response><Say voice="alice">Hello</Say><Hangup /></Response>',
    "<Response><Say>Hi</Say><Redirect>https://attacker.example</Redirect></Response>",
    "<Response><Record /><Hangup /></Response>",
    "<Response><Hangup /><Say>after</Say></Response>",
    "<Response><Say>only</Say></Response>",
  ]) {
    assert.throws(() => parseBuilderActionTwiml(xml), /TwiML|XML|number|destination|attribute|element|content/i, xml);
  }
});

test("action Say text is escaped and cannot smuggle a second verb", () => {
  const xml = parseBuilderActionTwiml(
    "<Response><Say>Thanks &amp; goodbye &lt;Dial&gt;</Say><Hangup /></Response>",
  );
  assert.equal(XMLValidator.validate(xml), true);
  assert.match(xml, /<Say>Thanks &amp; goodbye &lt;Dial&gt;<\/Say>/);
  assert.doesNotMatch(xml, /<Dial>/);
});
