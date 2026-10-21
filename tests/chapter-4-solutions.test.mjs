import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const steps = {
  interruptions: "step-1-interruptions.ts",
  dtmf: "step-2-dtmf.ts",
  silence: "step-3-silence.ts",
  language: "step-4-language-switch.ts",
};

function loadStep(filename) {
  const url = new URL(`../src/content/chapter-4/${filename}`, import.meta.url);
  const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const contentModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: contentModule,
    exports: contentModule.exports,
  }, { filename: url.pathname });
  const step = contentModule.exports.default;
  const solution = step.blocks.find(block => block.type === "solution" && block.audience === "builder");
  assert.ok(solution, `${filename} has a complete Builder solution`);
  return { step, code: solution.code };
}

const loaded = Object.fromEntries(
  Object.entries(steps).map(([name, filename]) => [name, loadStep(filename)])
);

function guideCode(name, needle) {
  const block = loaded[name].step.blocks.find(candidate =>
    candidate.type === "code" && candidate.audience === "builder" &&
    candidate.code.includes(needle)
  );
  assert.ok(block, `${name} has a guided ${needle} snippet`);
  return block.code;
}

function makeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
      }
      now = target;
    },
  };
}

function makeHarness(code, { respond = () => [
  { choices: [{ delta: { content: "Hello." }, finish_reason: null }] },
] } = {}) {
  const clock = makeClock();
  const completions = [];
  const errors = [];
  const webSocketServers = [];
  let httpServer;

  class FakeSocket extends EventEmitter {
    constructor() {
      super();
      this.OPEN = 1;
      this.readyState = 1;
      this.messages = [];
    }
    send(payload) {
      assert.equal(this.readyState, 1, "server sends only to open sockets");
      this.messages.push(JSON.parse(payload));
    }
    receive(message) {
      this.emit("message", Buffer.from(JSON.stringify(message)));
    }
    close() {
      this.readyState = 3;
      this.emit("close");
    }
  }
  class FakeWebSocketServer extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      webSocketServers.push(this);
    }
  }
  class FakeOpenAI {
    constructor() {
      this.chat = { completions: { create: async (input, options) => {
        completions.push({
          messages: structuredClone(input.messages),
          signal: options?.signal,
        });
        const chunks = await respond(completions.length);
        return (async function* () { for (const chunk of chunks) yield chunk; })();
      } } };
    }
  }
  const fakeRequire = id => {
    if (id === "dotenv") return { config() {} };
    if (id === "ws") return { WebSocketServer: FakeWebSocketServer };
    if (id === "http") return { createServer(handler) {
      httpServer = {
        handler,
        listen(_port, callback) { callback?.(); },
      };
      return httpServer;
    } };
    if (id === "openai") return FakeOpenAI;
    if (id === "twilio") return () => ({ calls: { create: async () => ({ sid: "CA123" }) } });
    throw new Error(`Unexpected require: ${id}`);
  };
  vm.runInNewContext(code, {
    require: fakeRequire,
    process: { env: {
      OPENAI_API_KEY: "test",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "test",
    } },
    console: { log() {}, error: (...args) => errors.push(args) },
    AbortController,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  }, { filename: "server.js" });

  return {
    clock,
    completions,
    errors,
    socket() {
      const ws = new FakeSocket();
      webSocketServers[0].emit("connection", ws);
      return ws;
    },
    twiml() {
      const req = { url: "/twiml", method: "POST", headers: { host: "example.test" } };
      const res = {
        body: "",
        writeHead() {},
        end(body) { this.body = body; },
      };
      httpServer.handler(req, res);
      return res.body;
    },
  };
}

async function settle() {
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
}

test("the guided interruption refactor can be placed before the prompt declaration", () => {
  assert.doesNotThrow(() => vm.runInNewContext(
    `${guideCode("interruptions", "async function streamResponse")}\nconst SYSTEM_PROMPT = "test persona";`,
    { AbortController }
  ));
});

test("the guided language prompt replaces the active system prompt", () => {
  const prompt = guideCode("language", "LANGUAGE DETECTION:");
  assert.match(prompt, /^const SYSTEM_PROMPT = /);
  assert.match(prompt, /\[LANG:es-ES\]/);
  assert.doesNotMatch(prompt, /const systemPrompt/);
});

test("the guided language helper switches both callers independently", () => {
  const code = guideCode("language", "function processLLMResponse");
  const states = new WeakMap();
  const spoken = [];
  const context = {
    stateFor(ws) {
      if (!states.has(ws)) states.set(ws, { closed: false });
      return states.get(ws);
    },
    sendText(ws, token) { spoken.push({ ws, token }); },
    console: { log() {} },
  };
  const processResponse = vm.runInNewContext(`${code}\nprocessLLMResponse`, context);
  const first = { readyState: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } };
  const second = { readyState: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } };
  processResponse(first, "[LANG:es-ES] Hola!");
  processResponse(second, " [LANG:es-ES] Buenos días!");
  assert.equal(first.messages[0].type, "language");
  assert.equal(second.messages[0].type, "language");
  assert.deepEqual(spoken.map(item => item.token), ["Hola!", "Buenos días!"]);
});

test("the guided language step learns the TwiML starting language from the first prompt", () => {
  const promptCode = guideCode("language", "function handlePrompt");
  const responseCode = guideCode("language", "function processLLMResponse");
  const states = new WeakMap();
  const context = {
    stateFor(ws) {
      if (!states.has(ws)) states.set(ws, { conversationHistory: [], closed: false });
      return states.get(ws);
    },
    streamResponse() {},
    sendText() {},
    console: { log() {} },
  };
  const { handlePrompt, processLLMResponse } = vm.runInNewContext(
    `${promptCode}\n${responseCode}\n({ handlePrompt, processLLMResponse })`, context
  );
  const ws = { readyState: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } };
  handlePrompt(ws, { type: "prompt", lang: "es-ES", voicePrompt: "Hola" });
  assert.equal(states.get(ws).currentLanguage, "es-ES");
  processLLMResponse(ws, "[LANG:en-US] Hello.");
  assert.equal(ws.messages[0]?.ttsLanguage, "en-US");
});

test("the guided outbound DTMF helper is safe to paste at module scope", () => {
  assert.doesNotThrow(() => vm.runInNewContext(
    guideCode("dtmf", "function sendDigits"),
    {}
  ));
});

test("the guided silence handler gives two nudges before a delayed end", () => {
  const clock = makeClock();
  const states = new WeakMap();
  const spoken = [];
  const context = {
    stateFor(ws) {
      if (!states.has(ws)) states.set(ws, { closed: false });
      return states.get(ws);
    },
    sendText(_ws, token) { spoken.push(token); },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  };
  const { resetSilenceTimer } = vm.runInNewContext(
    `${guideCode("silence", "function resetSilenceTimer")}\n({ resetSilenceTimer })`,
    context
  );
  const ws = { readyState: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } };
  resetSilenceTimer(ws);
  clock.advance(16000);
  assert.equal(spoken.length, 2);
  clock.advance(8000);
  assert.match(spoken.at(-1), /call back/i);
  assert.equal(ws.messages.length, 0);
  clock.advance(6000);
  assert.equal(ws.messages[0].type, "end");
});

for (const [name, { code }] of Object.entries(loaded)) {
  test(`${name} complete server parses`, () => {
    assert.doesNotThrow(() => new vm.Script(code, { filename: `${name}-server.js` }));
  });

  test(`${name} keeps Chapter 3 voice and transcription settings`, () => {
    const app = makeHarness(code);
    const twiml = app.twiml();
    assert.match(twiml, /voice="21m00Tcm4TlvDq8ikWAM"/);
    assert.match(twiml, /ttsProvider="ElevenLabs"/);
    assert.match(twiml, /language="en-US"/);
    assert.match(twiml, /transcriptionProvider="Deepgram"/);
    assert.match(twiml, /speechModel="nova-3-general"/);
  });

  test(`${name} keeps two callers' histories separate`, async () => {
    const app = makeHarness(code);
    const first = app.socket();
    const second = app.socket();
    first.receive({ type: "prompt", voicePrompt: "First caller" });
    second.receive({ type: "prompt", voicePrompt: "Second caller" });
    await settle();
    assert.deepEqual(app.completions[0].messages.filter(m => m.role === "user").map(m => m.content), ["First caller"]);
    assert.deepEqual(app.completions[1].messages.filter(m => m.role === "user").map(m => m.content), ["Second caller"]);
    first.close();
    second.close();
  });

  test(`${name} speaks a fallback if OpenAI rejects before streaming`, async () => {
    const app = makeHarness(code, { respond: () => { throw new Error("OpenAI unavailable"); } });
    const ws = app.socket();
    ws.receive({ type: "prompt", voicePrompt: "Hello" });
    await settle();
    assert.match(ws.messages.find(m => m.type === "text")?.token ?? "", /technical issue/i);
    ws.close();
  });

  test(`${name} remembers the spoken fallback on the next turn`, async () => {
    const app = makeHarness(code, { respond: call => {
      if (call === 1) throw new Error("OpenAI unavailable");
      return [{ choices: [{ delta: { content: "Ready." }, finish_reason: null }] }];
    } });
    const ws = app.socket();
    ws.receive({ type: "prompt", voicePrompt: "First request" });
    await settle();
    ws.receive({ type: "prompt", voicePrompt: "Second request" });
    await settle();
    assert.match(app.completions[1].messages.find(message => message.role === "assistant")?.content ?? "", /technical issue/i);
    ws.close();
  });

  test(`${name} waits for the caller's final transcription`, async () => {
    const app = makeHarness(code);
    const ws = app.socket();
    ws.receive({ type: "prompt", voicePrompt: "interim text", last: false });
    ws.receive({ type: "prompt", voicePrompt: "final text", last: true });
    await settle();
    assert.equal(app.completions.length, 1);
    assert.deepEqual(app.completions[0].messages.filter(m => m.role === "user").map(m => m.content), ["final text"]);
    ws.close();
  });

  test(`${name} ignores malformed WebSocket frames and continues`, async () => {
    const app = makeHarness(code);
    const ws = app.socket();
    assert.doesNotThrow(() => ws.emit("message", Buffer.from("{invalid")));
    ws.receive({ type: "prompt", voicePrompt: "Hello" });
    await settle();
    assert.ok(ws.messages.some(message => message.type === "text"));
    ws.close();
  });

  test(`${name} aborts only the interrupted caller's OpenAI request`, async () => {
    const app = makeHarness(code);
    const first = app.socket();
    const second = app.socket();
    first.receive({ type: "prompt", voicePrompt: "First" });
    second.receive({ type: "prompt", voicePrompt: "Second" });
    first.receive({ type: "interrupt", utteranceUntilInterrupt: "Partial reply" });
    assert.equal(app.completions[0].signal.aborted, true);
    assert.equal(app.completions[1].signal.aborted, false);
    await settle();
    assert.ok(second.messages.some(message => message.type === "text"));
    first.close();
    second.close();
  });
}

for (const name of ["silence", "language"]) {
  test(`${name} nudges twice and lets the farewell play before ending`, () => {
    const app = makeHarness(loaded[name].code);
    const ws = app.socket();
    ws.receive({ type: "setup", callSid: "CA123" });
    app.clock.advance(8000);
    assert.equal(ws.messages.filter(m => m.type === "text").length, 1);
    app.clock.advance(8000);
    assert.equal(ws.messages.filter(m => m.type === "text").length, 2);
    assert.equal(ws.messages.filter(m => m.type === "end").length, 0);
    app.clock.advance(8000);
    assert.match(ws.messages.at(-1)?.token ?? "", /call back/i);
    assert.equal(ws.messages.filter(m => m.type === "end").length, 0);
    app.clock.advance(6000);
    assert.equal(ws.messages.filter(m => m.type === "end").length, 1);
    ws.close();
  });
}

for (const name of ["dtmf", "silence", "language"]) {
  test(`${name} adds a keypad shortcut only to its caller's history`, async () => {
    const app = makeHarness(loaded[name].code);
    const first = app.socket();
    const second = app.socket();
    first.receive({ type: "dtmf", digit: "1" });
    second.receive({ type: "prompt", voicePrompt: "Second caller" });
    await settle();
    assert.deepEqual(app.completions[0].messages.filter(m => m.role === "user").map(m => m.content), ["I want to check my order status."]);
    assert.deepEqual(app.completions[1].messages.filter(m => m.role === "user").map(m => m.content), ["Second caller"]);
    first.close();
    second.close();
  });
}

for (const name of ["silence", "language"]) {
  test(`${name} keeps silence timers separate and cancels a pending end on activity`, () => {
    const app = makeHarness(loaded[name].code);
    const first = app.socket();
    const second = app.socket();
    first.receive({ type: "setup", callSid: "CA1" });
    app.clock.advance(4000);
    second.receive({ type: "setup", callSid: "CA2" });
    app.clock.advance(4000);
    assert.equal(first.messages.filter(message => message.type === "text").length, 1);
    assert.equal(second.messages.filter(message => message.type === "text").length, 0);
    app.clock.advance(16000);
    assert.match(first.messages.at(-1)?.token ?? "", /call back/i);
    assert.equal(second.messages.filter(message => message.type === "end").length, 0);
    first.receive({ type: "prompt", voicePrompt: "I'm here" });
    app.clock.advance(4000);
    assert.equal(first.messages.filter(message => message.type === "end").length, 0);
    first.close();
    second.close();
  });
}

test("language switching is tracked separately for two callers", async () => {
  const app = makeHarness(loaded.language.code, { respond: () => [
    { choices: [{ delta: { content: "[LANG:es-ES] Hola!" }, finish_reason: null }] },
  ] });
  const first = app.socket();
  const second = app.socket();
  first.receive({ type: "prompt", voicePrompt: "Hola" });
  second.receive({ type: "prompt", voicePrompt: "Hola" });
  await settle();
  assert.equal(first.messages.filter(m => m.type === "language").length, 1);
  assert.equal(second.messages.filter(m => m.type === "language").length, 1);
  first.close();
  second.close();
});

test("a leading space before a language marker is never spoken", async () => {
  const app = makeHarness(loaded.language.code, { respond: () => [
    { choices: [{ delta: { content: " [LANG:es-ES] Hola!" }, finish_reason: null }] },
  ] });
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Hola" });
  await settle();
  assert.equal(ws.messages[0].type, "language");
  assert.equal(ws.messages.find(message => message.type === "text" && message.token)?.token, "Hola!");
  ws.close();
});

test("a Spanish TwiML start does not mask a later switch back to English", async () => {
  const code = loaded.language.code.replace('language="en-US"', 'language="es-ES"');
  const app = makeHarness(code, { respond: turn => [
    { choices: [{ delta: {
      content: turn === 1 ? "[LANG:es-ES] Hola!" : "[LANG:en-US] Hello!",
    }, finish_reason: null }] },
  ] });
  assert.match(app.twiml(), /language="es-ES"/);
  const ws = app.socket();
  ws.receive({ type: "prompt", lang: "es-ES", voicePrompt: "Hola", last: true });
  await settle();
  assert.equal(ws.messages.filter(message => message.type === "language").length, 0);
  ws.receive({ type: "prompt", lang: "es-ES", voicePrompt: "English, please", last: true });
  await settle();
  const switchIndex = ws.messages.findIndex(message => message.type === "language");
  const englishIndex = ws.messages.findIndex(message => message.type === "text" && message.token === "Hello!");
  assert.equal(ws.messages[switchIndex]?.ttsLanguage, "en-US");
  assert.equal(ws.messages[switchIndex]?.transcriptionLanguage, "en-US");
  assert.ok(switchIndex < englishIndex, "Twilio changes language before the English text");
  assert.equal(ws.messages.filter(message => message.type === "language").length, 1);
  ws.close();
});

test("a keypad turn before speech sends an explicit language switch when a marker appears", async () => {
  const code = loaded.language.code.replace('language="en-US"', 'language="es-ES"');
  const app = makeHarness(code, { respond: () => [
    { choices: [{ delta: { content: "[LANG:en-US] Hello!" }, finish_reason: null }] },
  ] });
  const ws = app.socket();
  ws.receive({ type: "dtmf", digit: "1" });
  await settle();
  assert.equal(ws.messages[0]?.type, "language");
  assert.equal(ws.messages[0]?.ttsLanguage, "en-US");
  assert.equal(ws.messages.find(message => message.type === "text" && message.token)?.token, "Hello!");
  ws.close();
});
