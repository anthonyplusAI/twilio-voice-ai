import { XMLParser, XMLValidator } from "fast-xml-parser";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_INLINE_CHARACTERS = 4000;
const MAX_SAY_CHARACTERS = 1000;
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const XML_DECLARATION_PATTERN = /^<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?\s*\?>/;
const PREDEFINED_ENTITY_PATTERN = /&(?!(?:amp|lt|gt|quot|apos);)/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const INPUT_MODES = new Set(["none", "dtmf", "speech", "any"]);
const RELAY_ATTRIBUTES = new Set([
  "url",
  "voice",
  "ttsProvider",
  "language",
  "transcriptionProvider",
  "speechModel",
  "welcomeGreeting",
  "dtmfDetection",
  "interruptible",
  "interruptSensitivity",
  "welcomeGreetingInterruptible",
  "reportInputDuringAgentSpeech",
  "hints",
  "events",
]);

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
  ignoreDeclaration: true,
  ignorePiTags: false,
  allowBooleanAttributes: false,
});

function fail(message) {
  throw new Error("Unsafe Builder TwiML: " + message);
}

function cleanXmlText(value, label, maxCharacters) {
  if (typeof value !== "string" || value.length > maxCharacters) {
    fail(label + " is too large or is not text");
  }
  for (const character of value) {
    const point = character.codePointAt(0);
    if (
      (point < 0x20 && point !== 0x09 && point !== 0x0a && point !== 0x0d) ||
      (point >= 0xd800 && point <= 0xdfff) ||
      point === 0xfffe ||
      point === 0xffff
    ) {
      fail(label + " contains an invalid XML character");
    }
  }
  return value;
}

function parseXml(xml) {
  if (typeof xml !== "string" || Buffer.byteLength(xml, "utf8") > MAX_INPUT_BYTES) {
    fail("XML input exceeds the 64 KiB size limit");
  }

  const input = xml.replace(/^\uFEFF/, "");
  const declaration = input.match(XML_DECLARATION_PATTERN);
  const body = declaration ? input.slice(declaration[0].length) : input;
  if (
    body.includes("<!") ||
    body.includes("<?") ||
    PREDEFINED_ENTITY_PATTERN.test(body)
  ) {
    fail("DTD, entities, comments, CDATA, and processing instructions are not allowed");
  }

  const validation = XMLValidator.validate(input, { allowBooleanAttributes: false });
  if (validation !== true) {
    fail("malformed XML");
  }

  let nodes;
  try {
    nodes = parser.parse(body);
  } catch {
    fail("malformed XML");
  }
  const top = elementChildren(nodes);
  if (top.length !== 1) {
    fail("expected exactly one Response element");
  }
  const root = assertElement(top[0], "Response");
  assertAttributes(root, []);
  return root;
}

function elementChildren(children) {
  if (!Array.isArray(children)) {
    fail("invalid XML element content");
  }
  const elements = [];
  for (const child of children) {
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      fail("invalid XML element content");
    }
    if (Object.keys(child).length === 1 && Object.hasOwn(child, "#text")) {
      if (typeof child["#text"] !== "string" || child["#text"].trim() !== "") {
        fail("unexpected text in XML element");
      }
      continue;
    }
    elements.push(child);
  }
  return elements;
}

function assertElement(node, name) {
  const names = Object.keys(node).filter((key) => key !== ":@");
  if (names.length !== 1 || names[0] !== name || !Array.isArray(node[name])) {
    fail("unsupported XML element; expected " + name);
  }
  return node;
}

function assertAttributes(node, allowedNames) {
  const attributes = node[":@"] ?? {};
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    fail("invalid XML attributes");
  }
  for (const name of Object.keys(attributes)) {
    if (!allowedNames.includes(name) || typeof attributes[name] !== "string") {
      fail("unsupported XML attribute: " + name);
    }
  }
  return attributes;
}

function singleChild(node, parentName, childName) {
  const children = elementChildren(node[parentName]);
  if (children.length !== 1) {
    fail("expected one " + childName + " element");
  }
  return assertElement(children[0], childName);
}

function leafText(node, name) {
  let value = "";
  for (const child of node[name]) {
    if (
      !child ||
      typeof child !== "object" ||
      Array.isArray(child) ||
      Object.keys(child).length !== 1 ||
      !Object.hasOwn(child, "#text") ||
      typeof child["#text"] !== "string"
    ) {
      fail("unexpected content inside " + name);
    }
    value += child["#text"];
  }
  return value;
}

function parseSourceUrl(rawUrl) {
  if (typeof rawUrl !== "string") {
    fail("invalid Builder TwiML URL");
  }
  const authority = /^https:\/\/([^/?#]+)/.exec(rawUrl)?.[1];
  let source;
  try {
    source = new URL(rawUrl);
  } catch {
    fail("invalid Builder TwiML URL");
  }
  if (
    source.protocol !== "https:" ||
    source.pathname !== "/twiml" ||
    source.hash ||
    source.username ||
    source.password ||
    source.port ||
    !authority ||
    authority !== source.hostname ||
    !DOMAIN_PATTERN.test(source.hostname) ||
    source.hostname.includes("..") ||
    !source.hostname.includes(".")
  ) {
    fail("Builder TwiML URL must be a public HTTPS /twiml endpoint without a port");
  }
  return source;
}

function validateRelayUrl(rawUrl, sourceHost = null) {
  const authority = /^wss:\/\/([^/?#]+)\/ws$/.exec(rawUrl)?.[1];
  if (
    !authority ||
    !DOMAIN_PATTERN.test(authority) ||
    authority.includes("..") ||
    !authority.includes(".") ||
    (sourceHost !== null && authority !== sourceHost)
  ) {
    fail("ConversationRelay WebSocket URL must be wss on the TwiML host at /ws");
  }
  return "wss://" + authority + "/ws";
}

function validateBuilderActionUrl(value, sourceHost) {
  if (value === undefined) {
    return null;
  }
  if (value === "/call-ended") {
    return "https://" + sourceHost + "/call-ended";
  }
  const authority = /^https:\/\/([^/?#]+)\/call-ended$/.exec(value)?.[1];
  if (authority !== sourceHost) {
    fail("Connect action URL must be /call-ended on the TwiML host");
  }
  return "https://" + sourceHost + "/call-ended";
}

function validateRelayAttributes(input, sourceHost = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("invalid ConversationRelay attributes");
  }
  const attributes = {};
  for (const [name, rawValue] of Object.entries(input)) {
    if (!RELAY_ATTRIBUTES.has(name)) {
      fail("unsupported ConversationRelay attribute: " + name);
    }
    const value = cleanXmlText(rawValue, name, MAX_INLINE_CHARACTERS);
    switch (name) {
      case "url":
        attributes.url = validateRelayUrl(value, sourceHost);
        continue;
      case "voice":
      case "speechModel":
        if (!TOKEN_PATTERN.test(value)) fail("invalid " + name + " attribute");
        break;
      case "ttsProvider":
        if (!["Amazon", "ElevenLabs", "Google"].includes(value)) {
          fail("invalid ttsProvider attribute");
        }
        break;
      case "transcriptionProvider":
        if (!["Deepgram", "Google"].includes(value)) {
          fail("invalid transcriptionProvider attribute");
        }
        break;
      case "language":
        if (!LANGUAGE_PATTERN.test(value)) fail("invalid language attribute");
        break;
      case "dtmfDetection":
        if (!["true", "false"].includes(value)) fail("invalid dtmfDetection attribute");
        break;
      case "interruptible":
        if (!INPUT_MODES.has(value) && !["true", "false"].includes(value)) {
          fail("invalid interruptible attribute");
        }
        break;
      case "welcomeGreetingInterruptible":
      case "reportInputDuringAgentSpeech":
        if (!INPUT_MODES.has(value)) fail("invalid " + name + " attribute");
        break;
      case "interruptSensitivity":
        if (!["low", "medium", "high"].includes(value)) {
          fail("invalid interruptSensitivity attribute");
        }
        break;
      case "events": {
        const events = value.split(" ");
        if (
          events.length === 0 ||
          events.length > 2 ||
          new Set(events).size !== events.length ||
          events.some((event) => !["speaker-events", "tokens-played"].includes(event))
        ) {
          fail("invalid events attribute");
        }
        break;
      }
      case "welcomeGreeting":
      case "hints":
        break;
      default:
        fail("unsupported ConversationRelay attribute: " + name);
    }
    attributes[name] = value;
  }
  if (!Object.hasOwn(attributes, "url")) {
    fail("ConversationRelay WebSocket URL is required");
  }
  return attributes;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function ensureInlineSize(xml) {
  if (xml.length > MAX_INLINE_CHARACTERS || Buffer.byteLength(xml, "utf8") > MAX_INLINE_CHARACTERS) {
    fail("rendered TwiML exceeds the 4000 character size limit");
  }
  return xml;
}

function validateSiteActionUrl(rawUrl) {
  if (typeof rawUrl !== "string") {
    fail("site action URL must be absolute HTTPS");
  }
  const authority = /^https:\/\/([^/?#]+)\//.exec(rawUrl)?.[1];
  let action;
  try {
    action = new URL(rawUrl);
  } catch {
    fail("site action URL must be absolute HTTPS");
  }
  if (
    action.protocol !== "https:" ||
    !authority ||
    authority !== action.hostname ||
    action.username ||
    action.password ||
    action.port ||
    action.hash ||
    !DOMAIN_PATTERN.test(action.hostname) ||
    action.hostname.includes("..") ||
    !action.hostname.includes(".")
  ) {
    fail("site action URL must be absolute HTTPS without credentials, a port, or a fragment");
  }
  return action.href;
}

/**
 * Accept only the ConversationRelay shape used by the Builder chapters.
 * The returned action URL is absolute so the site can safely proxy /call-ended.
 */
export function parseBuilderTwiml(xml, twimlUrl) {
  const source = parseSourceUrl(twimlUrl);
  const response = parseXml(xml);
  const connect = singleChild(response, "Response", "Connect");
  const connectAttributes = assertAttributes(connect, ["action"]);
  const relay = singleChild(connect, "Connect", "ConversationRelay");
  const relayAttributes = validateRelayAttributes(
    assertAttributes(relay, [...RELAY_ATTRIBUTES]),
    source.hostname,
  );
  if (elementChildren(relay.ConversationRelay).length !== 0) {
    fail("ConversationRelay child elements are not supported");
  }
  return {
    relayAttributes,
    actionUrl: validateBuilderActionUrl(connectAttributes.action, source.hostname),
  };
}

/** Render TwiML owned by the site, preserving safe Builder voice settings. */
export function renderBuilderTwiml(parsed, siteActionUrl) {
  if (!parsed || typeof parsed !== "object") {
    fail("invalid parsed Builder TwiML");
  }
  const relayAttributes = validateRelayAttributes(parsed.relayAttributes);
  const actionUrl = validateSiteActionUrl(siteActionUrl);
  const renderedAttributes = Object.entries(relayAttributes)
    .map(([name, value]) => " " + name + '="' + escapeXml(value) + '"')
    .join("");
  return ensureInlineSize(
    XML_DECLARATION + '<Response><Connect action="' + escapeXml(actionUrl) +
    '"><ConversationRelay' + renderedAttributes + ' /></Connect></Response>',
  );
}

function validHandoffNumber(value) {
  const number = value.trim();
  if (!/^\+[1-9]\d{1,14}$/.test(number)) {
    fail("Dial destination must be an E.164 phone number");
  }
  const parsed = parsePhoneNumberFromString(number);
  if (
    !parsed ||
    !parsed.isValid() ||
    !["US", "CA"].includes(parsed.country) ||
    ["PREMIUM_RATE", "SHARED_COST"].includes(parsed.getType()) ||
    parsed.number !== number
  ) {
    fail("Dial destination must be a valid US or Canada non-premium phone number");
  }
  return number;
}

/**
 * Return a fresh, bounded TwiML document for a Builder's handoff action.
 * No incoming verb or attribute is copied into the output.
 */
export function parseBuilderActionTwiml(xml) {
  const response = parseXml(xml);
  const children = elementChildren(response.Response);
  if (children.length < 1 || children.length > 2) {
    fail("action response must contain an optional Say and one Hangup or Dial");
  }
  let say = null;
  let terminal = children[0];
  if (children.length === 2) {
    const sayNode = assertElement(children[0], "Say");
    assertAttributes(sayNode, []);
    say = cleanXmlText(leafText(sayNode, "Say"), "Say text", MAX_SAY_CHARACTERS);
    if (say.trim() === "") fail("Say text must not be empty");
    terminal = children[1];
  }

  const terminalName = Object.keys(terminal).find((key) => key !== ":@");
  let ending;
  if (terminalName === "Hangup") {
    const hangup = assertElement(terminal, "Hangup");
    assertAttributes(hangup, []);
    if (leafText(hangup, "Hangup").trim() !== "") {
      fail("Hangup must not contain text");
    }
    ending = "<Hangup />";
  } else if (terminalName === "Dial") {
    const dial = assertElement(terminal, "Dial");
    assertAttributes(dial, []);
    const number = singleChild(dial, "Dial", "Number");
    assertAttributes(number, []);
    ending = '<Dial timeLimit="60"><Number>' +
      validHandoffNumber(leafText(number, "Number")) +
      "</Number></Dial>";
  } else {
    fail("action response must end with Hangup or Dial");
  }

  return ensureInlineSize(
    XML_DECLARATION + "<Response>" +
    (say === null ? "" : "<Say>" + escapeXml(say) + "</Say>") +
    ending + "</Response>",
  );
}
