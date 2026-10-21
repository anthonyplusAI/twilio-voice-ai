import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

function loadModule(path, imports = {}, globals = {}) {
  const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded,
    exports: loaded.exports,
    ...globals,
    require(specifier) {
      if (specifier in imports) return imports[specifier];
      throw new Error(`Unexpected import: ${specifier}`);
    },
  });
  return loaded.exports;
}

function elements(root, type) {
  const found = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (node.type === type) found.push(node);
    visit(node.props?.children);
  }
  visit(root);
  return found;
}

function buttonContaining(root, text) {
  return elements(root, "button").find((button) =>
    renderToStaticMarkup(button).includes(text)
  );
}

const catalog = loadModule("../src/lib/voice-catalog.ts");

test("stock Explorer greetings follow all picker locales and return to the original English preset", () => {
  const { resolveExplorerGreeting } = loadModule("../src/lib/explorer-greeting.ts");
  const greetings = [
    "Hey there! I'm Sam from Twilio Airways. Where can I help you fly today?",
    "Good day. This is Ms. Chen at the Twilio Grand Hotel. How may I assist you?",
    "Yo, what's up! Jake from Twilio Pizza Co. here. What can I get started for you?",
    "Hello! I'm your AI assistant. How can I help you today?",
  ];
  for (const greeting of greetings) {
    for (const { code } of catalog.WORKSHOP_LANGUAGES) {
      const translated = resolveExplorerGreeting(greeting, code);
      assert.ok(translated.length > 10, `${code} has a spoken greeting`);
      if (code !== "en-US") assert.notEqual(translated, greeting, `${code} is translated`);
      assert.equal(resolveExplorerGreeting(translated, "en-US"), greeting,
        `${code} returns to the same preset when English is chosen again`);
    }
  }
});

test("attendee written greetings stay verbatim while a blank greeting uses a localized default", () => {
  const { resolveExplorerGreeting } = loadModule("../src/lib/explorer-greeting.ts");
  const custom = "Bonjour, moi c'est Sam. Parlons voyages !";
  assert.equal(resolveExplorerGreeting(custom, "en-US"), custom);
  assert.equal(resolveExplorerGreeting(custom, "es-ES"), custom);
  assert.match(resolveExplorerGreeting(undefined, "es-ES"), /Hola/);
  assert.match(resolveExplorerGreeting("", "fr-FR"), /Bonjour/);
});

test("LanguagePicker changes a known greeting with the selected locale and preserves a custom one", () => {
  const greeting = loadModule("../src/lib/explorer-greeting.ts");
  const updates = [];
  let state = {
    language: "en-US",
    voice: "gUABw7pXQjhjt0kNFBTF",
    welcomeGreeting: "Hey there! I'm Sam from Twilio Airways. Where can I help you fly today?",
  };
  const { LanguagePicker } = loadModule("../src/components/content/LanguagePicker.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "@/lib/voice-catalog": catalog,
    "@/lib/explorer-greeting": greeting,
    "@/components/layout/ProgressContext": {
      useProgressContext: () => ({
        progress: { workshopState: state },
        updateWorkshopState(partial) { updates.push(JSON.parse(JSON.stringify(partial))); },
      }),
    },
  });
  buttonContaining(LanguagePicker(), "French").props.onClick();
  assert.equal(updates.at(-1).language, "fr-FR");
  assert.match(updates.at(-1).welcomeGreeting, /Bonjour/);

  state = { ...state, welcomeGreeting: "Custom greeting for my workshop" };
  buttonContaining(LanguagePicker(), "Spanish").props.onClick();
  assert.equal(updates.at(-1).language, "es-ES");
  assert.equal(updates.at(-1).welcomeGreeting, undefined);
});

test("VoicePicker restores an English preset greeting when an English-only voice resets the locale", () => {
  const greeting = loadModule("../src/lib/explorer-greeting.ts");
  const updates = [];
  const frenchGreeting = greeting.resolveExplorerGreeting(
    "Hey there! I'm Sam from Twilio Airways. Where can I help you fly today?", "fr-FR"
  );
  let state = {
    language: "fr-FR",
    voice: "gUABw7pXQjhjt0kNFBTF",
    ttsProvider: "ElevenLabs",
    welcomeGreeting: frenchGreeting,
  };
  const { VoicePicker } = loadModule("../src/components/content/VoicePicker.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "@/lib/voice-catalog": catalog,
    "@/lib/explorer-greeting": greeting,
    "@/components/layout/ProgressContext": {
      useProgressContext: () => ({
        progress: { workshopState: state },
        updateWorkshopState(partial) { updates.push(JSON.parse(JSON.stringify(partial))); },
      }),
    },
  });
  buttonContaining(VoicePicker(), "Joanna").props.onClick();
  assert.equal(updates.at(-1).language, "en-US");
  assert.equal(updates.at(-1).welcomeGreeting,
    "Hey there! I'm Sam from Twilio Airways. Where can I help you fly today?");
  assert.equal(updates.at(-1).ttsProvider, "Amazon");

  state = { ...state, welcomeGreeting: "Bonjour ! Mon accueil personnalisé." };
  buttonContaining(VoicePicker(), "Joanna").props.onClick();
  assert.equal(updates.at(-1).language, "en-US");
  assert.equal(updates.at(-1).welcomeGreeting, undefined,
    "the picker must not rewrite an attendee's custom greeting");
});

test("Explorer demo offers spoken prompts in its selected language while Builder remains English", () => {
  let isBuilder = false;
  let selectedLanguage = "es-ES";
  let handoffEnabled = "true";
  const { DemoScript } = loadModule("../src/components/content/DemoScript.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "@/components/layout/ProgressContext": {
      useProgressContext: () => ({ progress: { workshopState: {
        language: selectedLanguage,
        handoffEnabled,
      } } }),
    },
    "@/lib/AudienceContext": {
      useAudienceMode: () => ({ isBuilder }),
    },
  });
  const explorerHtml = renderToStaticMarkup(createElement(DemoScript));
  assert.match(explorerHtml, /¿Qué tiempo hace en San Francisco\?/);
  assert.match(explorerHtml, /pedido 123/);
  assert.match(explorerHtml, /Necesito hablar con una persona/);
  assert.doesNotMatch(explorerHtml, /Say: &quot;Tell me a joke/);

  handoffEnabled = "false";
  assert.match(renderToStaticMarkup(createElement(DemoScript)), /¿Puedo hablar con una persona/);

  for (const { code } of catalog.WORKSHOP_LANGUAGES) {
    selectedLanguage = code;
    const html = renderToStaticMarkup(createElement(DemoScript));
    assert.match(html, /pedido 123|commande 123|订单 123|ऑर्डर 123|заказа 123|order 123/,
      `${code} still gives an order lookup example`);
    if (code !== "en-US") {
      assert.doesNotMatch(html, /Say: &quot;What is the weather in San Francisco/,
        `${code} should use a spoken weather prompt in the selected language`);
    }
  }

  isBuilder = true;
  const builderHtml = renderToStaticMarkup(createElement(DemoScript));
  assert.match(builderHtml, /What is the weather in San Francisco/);
  assert.match(builderHtml, /I need to speak to a person/);
});

test("Explorer Call Me localizes an old saved stock greeting at call time", async () => {
  const greeting = loadModule("../src/lib/explorer-greeting.ts");
  let requestBody;
  const state = {
    phoneNumber: "+12065550101",
    language: "fr-FR",
    welcomeGreeting: "Hey there! I'm Sam from Twilio Airways. Where can I help you fly today?",
  };
  const { CallMe } = loadModule("../src/components/CallMe.tsx", {
    "react": {
      useState: (initial) => [initial, () => {}],
      useEffect: () => {},
    },
    "react/jsx-runtime": jsxRuntime,
    "lucide-react": { Phone() {}, PhoneOff() {}, Loader2() {} },
    "@/lib/AudienceContext": { useAudienceMode: () => ({ isBuilder: false }) },
    "@/components/layout/ProgressContext": { useProgressContext: () => ({
      progress: { workshopState: state },
      incrementCalls() {},
      updateWorkshopState() {},
    }) },
    "@/lib/AnalyticsContext": { useAnalyticsContext: () => ({ sessionId: { current: "test" } }) },
    "@/lib/call-target": { validateBuilderTwimlUrl: () => null },
    "@/lib/explorer-greeting": greeting,
  }, {
    fetch: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: false, json: async () => ({ error: "expected test stop" }) };
    },
  });
  const ui = CallMe();
  assert.equal(elements(ui, "input")[0].props.value, "+12065550101");
  await buttonContaining(ui, "Call Me").props.onClick();
  assert.match(requestBody.agentConfig.welcomeGreeting, /Bonjour/);
  assert.equal(requestBody.agentConfig.language, "fr-FR");
});

test("AgentSummary shows the greeting the next Explorer call will actually use", () => {
  const greeting = loadModule("../src/lib/explorer-greeting.ts");
  const { AgentSummary } = loadModule("../src/components/content/AgentSummary.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "@/lib/explorer-greeting": greeting,
    "@/components/layout/ProgressContext": { useProgressContext: () => ({
      progress: { workshopState: {
        language: "fr-FR",
        welcomeGreeting: "Hey there! I'm Sam from Twilio Airways. Where can I help you fly today?",
      } },
    }) },
  });
  const html = renderToStaticMarkup(createElement(AgentSummary));
  assert.match(html, /Bonjour/);
  assert.doesNotMatch(html, /Hey there/);
});
