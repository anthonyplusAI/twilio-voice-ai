import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const chapter5Steps = [
  "step-2-define-tools.ts",
  "step-3-handle-tools.ts",
  "step-4-handoff.ts",
];

function extractSolution(stepFile = "step-4-handoff.ts") {
  const contentPath = new URL(`../src/content/chapter-5/${stepFile}`, import.meta.url);
  const source = readFileSync(contentPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const contentModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: contentModule,
    exports: contentModule.exports,
  }, { filename: contentPath.pathname });
  const solution = contentModule.exports.default.blocks.find(block =>
    block.type === "solution" && block.audience === "builder" && block.files
  );
  assert.ok(solution, "Chapter 5 handoff solution exists");
  return {
    serverCode: solution.files.find(file => file.file === "server.js").code,
    handlersCode: solution.files.find(file => file.file === "tool-handlers.js").code,
  };
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

function toolCall(name, args = {}) {
  return [
    { choices: [{ delta: { tool_calls: [{
      index: 0,
      id: "call_1",
      function: { name, arguments: JSON.stringify(args) },
    }] }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  ];
}

function makeHarness({
  stepFile = "step-4-handoff.ts",
  twimlLanguage = null,
  env = {},
  configureHandlers = () => {},
  respond = () => [
    { choices: [{ delta: { content: "I can help." }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
  ],
} = {}) {
  const { serverCode: exampleServerCode, handlersCode } = extractSolution(stepFile);
  const serverCode = twimlLanguage
    ? exampleServerCode.replace('language="en-US"', `language="${twimlLanguage}"`)
    : exampleServerCode;
  const clock = makeClock();
  const completions = [];
  const handlersModule = { exports: {} };
  const process = { env: {
    OPENAI_API_KEY: "test-key",
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "test-token",
    ...env,
  } };
  vm.runInNewContext(handlersCode, {
    module: handlersModule,
    exports: handlersModule.exports,
    process,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    Date,
    Math,
  }, { filename: "tool-handlers.js" });
  configureHandlers(handlersModule.exports.toolHandlers);

  const webSocketServers = [];
  let httpServer;
  class FakeWebSocket extends EventEmitter {
    constructor() {
      super();
      this.OPEN = 1;
      this.readyState = 1;
      this.messages = [];
    }
    send(payload) {
      assert.equal(this.readyState, 1, "server sends only to an open socket");
      this.messages.push(JSON.parse(payload));
    }
    receive(message) {
      this.emit("message", Buffer.from(JSON.stringify(message)));
    }
    receiveRaw(value) {
      this.emit("message", Buffer.from(value));
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
      this.chat = { completions: { create: async input => {
        completions.push(structuredClone(input.messages));
        const chunks = await respond(completions.length);
        if (chunks?.[Symbol.asyncIterator]) return chunks;
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
    if (id === "./tool-handlers.js") return handlersModule.exports;
    throw new Error(`Unexpected require: ${id}`);
  };
  vm.runInNewContext(serverCode, {
    require: fakeRequire,
    process,
    console: { log() {}, error() {} },
    AbortController,
    URLSearchParams,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  }, { filename: "server.js" });

  return {
    clock,
    completions,
    handlers: handlersModule.exports.toolHandlers,
    socket() {
      const ws = new FakeWebSocket();
      webSocketServers[0].emit("connection", ws);
      return ws;
    },
    request(url, body = "") {
      const req = new EventEmitter();
      req.url = url;
      req.method = "POST";
      req.headers = { host: "example.test" };
      const res = {
        body: "",
        writeHead() {},
        end(value = "") { this.body += value; },
      };
      httpServer.handler(req, res);
      req.emit("data", Buffer.from(body));
      req.emit("end");
      return res.body;
    },
  };
}

async function settle() {
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
}

test("handoff tool ends immediately so the action URL can announce once", async () => {
  const app = makeHarness({
    env: { HANDOFF_PHONE_NUMBER: "+14155552671" },
    respond: () => toolCall("transfer_to_agent", {
      reason: "caller asked for a human",
      summary: "Needs account help",
    }),
  });
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Can I speak to a person?" });
  await settle();
  assert.equal(app.completions.length, 1);
  assert.equal(ws.messages.filter(message => message.type === "text").length, 0);
  assert.equal(ws.messages.filter(message => message.type === "end").length, 1);
  assert.equal(JSON.parse(ws.messages.at(-1).handoffData).reasonCode, "live-agent-handoff");
  const twiml = app.request("/call-ended", new URLSearchParams({
    HandoffData: ws.messages.at(-1).handoffData,
  }).toString());
  assert.match(twiml, /<Say>[^<]*transfer[^<]*<\/Say>\s*<Dial><Number>\+14155552671<\/Number><\/Dial>/i);
  ws.close();
});

test("DTMF 2 uses the same handoff path", async () => {
  const app = makeHarness({ env: { HANDOFF_PHONE_NUMBER: "+14155552671" } });
  const ws = app.socket();
  ws.receive({ type: "dtmf", digit: "2" });
  await settle();
  assert.equal(app.completions.length, 0);
  assert.equal(ws.messages.filter(message => message.type === "text").length, 0);
  assert.equal(ws.messages.filter(message => message.type === "end").length, 1);
  ws.close();
});

test("DTMF handoff does not nudge while its transfer check is pending", async () => {
  let finishTransfer;
  const pendingTransfer = new Promise(resolve => { finishTransfer = resolve; });
  const app = makeHarness({
    configureHandlers: handlers => { handlers.transfer_to_agent = () => pendingTransfer; },
  });
  const ws = app.socket();
  ws.receive({ type: "setup", callSid: "CA123" });
  ws.receive({ type: "dtmf", digit: "2" });
  app.clock.advance(16000);
  assert.equal(ws.messages.filter(message => message.type === "text" && /still there|still here/i.test(message.token)).length, 0);
  finishTransfer({ status: "unavailable" });
  await settle();
  app.clock.advance(8000);
  assert.equal(ws.messages.filter(message => message.type === "text" && /still there/i.test(message.token)).length, 1);
  ws.close();
});

test("handoff tool reports unavailable when no transfer number is configured", async () => {
  const app = makeHarness({
    respond: () => toolCall("transfer_to_agent", {
      reason: "caller asked for a human",
      summary: "Needs account help",
    }),
  });
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Can I speak to a person?" });
  await settle();
  assert.equal(app.completions.length, 1);
  assert.match(ws.messages.find(message => message.type === "text")?.token ?? "", /transfer is unavailable/i);
  app.clock.advance(2000);
  assert.equal(ws.messages.filter(message => message.type === "end").length, 0);
  ws.close();
});

test("an invalid keypad handoff destination keeps the caller in ConversationRelay", async () => {
  const app = makeHarness({ env: { HANDOFF_PHONE_NUMBER: "555-1234" } });
  const ws = app.socket();
  ws.receive({ type: "dtmf", digit: "2" });
  await settle();
  assert.match(ws.messages.find(message => message.type === "text")?.token ?? "", /transfer is unavailable/i);
  assert.equal(ws.messages.filter(message => message.type === "end").length, 0);
  ws.receive({ type: "prompt", voicePrompt: "Can you still help me?" });
  await settle();
  assert.equal(app.completions.length, 1);
  ws.close();
});

test("an unavailable handoff in a multi-tool reply leaves valid history", async () => {
  const app = makeHarness({ respond: number => number === 1 ? [
    { choices: [{ delta: { tool_calls: [
      { index: 0, id: "call_transfer", function: {
        name: "transfer_to_agent",
        arguments: JSON.stringify({ reason: "asked for a human", summary: "Needs help" }),
      } },
      { index: 1, id: "call_weather", function: {
        name: "check_weather",
        arguments: JSON.stringify({ city: "Boston" }),
      } },
    ] }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  ] : [
    { choices: [{ delta: { content: "I can still help." }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
  ] });
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Can I talk to a person?" });
  await settle();
  ws.receive({ type: "prompt", voicePrompt: "Then help me here." });
  await settle();
  assert.equal(app.completions.length, 2);
  const secondHistory = app.completions[1];
  const assistantCall = secondHistory.find(message => message.role === "assistant" && message.tool_calls);
  const toolReplies = secondHistory.filter(message => message.role === "tool");
  assert.equal(assistantCall.tool_calls.length, toolReplies.length);
  assert.ok(secondHistory.some(message =>
    message.role === "assistant" && /transfer is unavailable/i.test(message.content)
  ));
  ws.close();
});

test("action URL dials only a valid E.164 handoff destination", () => {
  const valid = makeHarness({ env: { HANDOFF_PHONE_NUMBER: "+14155552671" } });
  const body = new URLSearchParams({ HandoffData: JSON.stringify({ reasonCode: "live-agent-handoff" }) });
  assert.match(valid.request("/call-ended", body.toString()), /<Number>\+14155552671<\/Number>/);

  for (const value of [undefined, "555-1234", "+1555<Pay>"]) {
    const app = makeHarness({ env: { HANDOFF_PHONE_NUMBER: value } });
    const xml = app.request("/call-ended", body.toString());
    assert.match(xml, /transfer is unavailable/i);
    assert.doesNotMatch(xml, /<Dial>|<Queue>|<Number>/);
  }
});

test("malformed HandoffData ends normally without throwing or dialing", () => {
  const app = makeHarness({ env: { HANDOFF_PHONE_NUMBER: "+14155552671" } });
  const xml = app.request("/call-ended", "HandoffData=%7Bbad-json");
  assert.match(xml, /<Hangup\s*\/>/);
  assert.doesNotMatch(xml, /<Dial>|<Queue>/);
});

for (const stepFile of chapter5Steps.slice(1)) {
  test(`${stepFile} gives an order tool result back to OpenAI before replying`, async () => {
    const app = makeHarness({
      stepFile,
      respond: index => index === 1
        ? toolCall("lookup_order", { order_id: "123" })
        : [
          { choices: [{ delta: { content: "Your order shipped." }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ],
    });
    const ws = app.socket();
    ws.receive({ type: "prompt", voicePrompt: "Where is order 123?" });
    await settle();
    assert.equal(app.completions.length, 2);
    const toolResult = app.completions[1].find(message => message.role === "tool");
    assert.equal(JSON.parse(toolResult.content).status, "shipped");
    assert.match(ws.messages.filter(message => message.type === "text").map(message => message.token).join(""), /Your order shipped/);
    ws.close();
  });

  test(`${stepFile} drops an interrupted slow tool call before the next LLM turn`, async () => {
    let releaseLookup;
    const pendingLookup = new Promise(resolve => { releaseLookup = resolve; });
    const app = makeHarness({
      stepFile,
      configureHandlers: handlers => { handlers.lookup_order = async () => pendingLookup; },
      respond: number => number === 1 ? toolCall("lookup_order", { order_id: "123" }) : [
        { choices: [{ delta: { content: "New answer." }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ],
    });
    const ws = app.socket();
    ws.receive({ type: "prompt", voicePrompt: "Where is order 123?" });
    await settle();
    ws.receive({ type: "prompt", voicePrompt: "Never mind. Tell me a joke." });
    await settle();
    assert.equal(app.completions.length, 2);
    assert.equal(app.completions[1].some(message => message.tool_calls), false);
    releaseLookup({ order_id: "123", status: "shipped" });
    await settle();
    assert.equal(app.completions.length, 2);
    ws.close();
  });

  test(`${stepFile} does not mistake a slow tool lookup for caller silence`, async () => {
    let finishLookup;
    const pendingLookup = new Promise(resolve => { finishLookup = resolve; });
    const app = makeHarness({
      stepFile,
      configureHandlers: handlers => { handlers.lookup_order = () => pendingLookup; },
      respond: number => number === 1 ? toolCall("lookup_order", { order_id: "123" }) : [
        { choices: [{ delta: { content: "Your order shipped." }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ],
    });
    const ws = app.socket();
    ws.receive({ type: "setup", callSid: "CA123" });
    ws.receive({ type: "prompt", voicePrompt: "Where is order 123?", last: true });
    await settle();

    app.clock.advance(16000);
    assert.equal(ws.messages.filter(message => message.type === "text" && /still there|still here/i.test(message.token)).length, 0);

    finishLookup({ order_id: "123", status: "shipped" });
    await settle();
    assert.ok(ws.messages.some(message => message.type === "text" && /Your order shipped/.test(message.token)));
    app.clock.advance(8000);
    assert.equal(ws.messages.filter(message => message.type === "text" && /still there/i.test(message.token)).length, 1);
    ws.close();
  });
}

for (const stepFile of chapter5Steps) {
  test(`${stepFile} remembers the spoken part of an interrupted stream`, async () => {
    let releaseFirstStream;
    const holdFirstStream = new Promise(resolve => { releaseFirstStream = resolve; });
    const app = makeHarness({
      stepFile,
      respond: number => number === 1
        ? (async function* () {
          yield { choices: [{ delta: { content: "I found your order. " }, finish_reason: null }] };
          await holdFirstStream;
        })()
        : [
          { choices: [{ delta: { content: "A new answer." }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ],
    });
    const ws = app.socket();
    ws.receive({ type: "prompt", voicePrompt: "Where is my order?", last: true });
    await settle();
    assert.ok(ws.messages.some(message => message.type === "text" && /I found your order/.test(message.token)));
    ws.receive({ type: "interrupt", utteranceUntilInterrupt: "I found your order." });
    ws.receive({ type: "prompt", voicePrompt: "Actually, tell me something else.", last: true });
    await settle();
    const secondHistory = app.completions[1];
    assert.ok(secondHistory.some(message => message.role === "assistant" && message.content === "I found your order."));
    releaseFirstStream();
    await settle();
    ws.close();
  });

  test(`${stepFile} waits for a slow answer before starting the silence countdown`, async () => {
    let finishAnswer;
    const pendingAnswer = new Promise(resolve => { finishAnswer = resolve; });
    const app = makeHarness({ stepFile, respond: () => pendingAnswer });
    const ws = app.socket();
    ws.receive({ type: "setup", callSid: "CA123" });
    ws.receive({ type: "prompt", voicePrompt: "Where is my order?", last: true });
    app.clock.advance(4000);
    ws.receive({ type: "prompt", voicePrompt: "Wait, one more thing", last: false });
    app.clock.advance(12000);
    assert.equal(ws.messages.filter(message => message.type === "text").length, 0);

    finishAnswer([
      { choices: [{ delta: { content: "Your order is on its way." }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);
    await settle();
    assert.ok(ws.messages.some(message => message.type === "text" && /Your order/.test(message.token)));

    app.clock.advance(7999);
    assert.equal(ws.messages.filter(message => message.type === "text" && /still there/i.test(message.token)).length, 0);
    app.clock.advance(1);
    assert.equal(ws.messages.filter(message => message.type === "text" && /still there/i.test(message.token)).length, 1);
    ws.close();
  });

  test(`${stepFile} starts a silence countdown when a slow answer is interrupted`, async () => {
    let finishAnswer;
    const pendingAnswer = new Promise(resolve => { finishAnswer = resolve; });
    const app = makeHarness({ stepFile, respond: () => pendingAnswer });
    const ws = app.socket();
    ws.receive({ type: "setup", callSid: "CA123" });
    ws.receive({ type: "prompt", voicePrompt: "Tell me about my order", last: true });
    app.clock.advance(4000);
    ws.receive({ type: "interrupt", utteranceUntilInterrupt: "" });
    app.clock.advance(7999);
    assert.equal(ws.messages.filter(message => message.type === "text").length, 0);
    app.clock.advance(1);
    assert.equal(ws.messages.filter(message => message.type === "text" && /still there/i.test(message.token)).length, 1);
    finishAnswer([
      { choices: [{ delta: { content: "An obsolete reply." }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);
    await settle();
    assert.equal(ws.messages.filter(message => message.type === "text" && /obsolete/i.test(message.token)).length, 0);
    ws.close();
  });

  test(`${stepFile} restarts the silence timer after an AI error fallback`, async () => {
    const app = makeHarness({
      stepFile,
      respond: () => { throw new Error("model unavailable"); },
    });
    const ws = app.socket();
    ws.receive({ type: "setup", callSid: "CA123" });
    ws.receive({ type: "prompt", voicePrompt: "Tell me about my order", last: true });
    await settle();
    assert.ok(ws.messages.some(message => message.type === "text" && /technical issue/i.test(message.token)));
    app.clock.advance(8000);
    assert.equal(ws.messages.filter(message => message.type === "text" && /still there/i.test(message.token)).length, 1);
    ws.close();
  });

  test(`${stepFile} resolves advertised delivered order 789`, async () => {
    const app = makeHarness({ stepFile });
    const order = await app.handlers.lookup_order({ order_id: "789" });
    assert.equal(order.status, "delivered");
    assert.equal(order.eta, "already delivered");
  });

  test(`${stepFile} retains the bilingual voice and transcription settings`, () => {
    const app = makeHarness({ stepFile });
    const xml = app.request("/twiml");
    assert.doesNotMatch(xml, /\bvoice=/);
    assert.doesNotMatch(xml, /\bttsProvider=/);
    assert.match(xml, /language="en-US"/);
    assert.match(xml, /transcriptionProvider="Deepgram"/);
    assert.match(xml, /speechModel="nova-3-general"/);
  });

  test(`${stepFile} keeps two callers' histories separate`, async () => {
    const app = makeHarness({ stepFile });
    const first = app.socket();
    const second = app.socket();
    first.receive({ type: "prompt", voicePrompt: "First caller" });
    second.receive({ type: "prompt", voicePrompt: "Second caller" });
    await settle();
    assert.deepEqual(app.completions[0].filter(message => message.role === "user").map(message => message.content), ["First caller"]);
    assert.deepEqual(app.completions[1].filter(message => message.role === "user").map(message => message.content), ["Second caller"]);
    first.close();
    second.close();
    const third = app.socket();
    third.receive({ type: "prompt", voicePrompt: "New call" });
    await settle();
    assert.deepEqual(app.completions[2].filter(message => message.role === "user").map(message => message.content), ["New call"]);
    third.close();
  });

  test(`${stepFile} waits for the final caller transcript before calling OpenAI`, async () => {
    const app = makeHarness({ stepFile });
    const ws = app.socket();
    ws.receive({ type: "prompt", voicePrompt: "I need", last: false });
    ws.receive({ type: "prompt", voicePrompt: "I need help with my order", last: true });
    await settle();
    assert.equal(app.completions.length, 1);
    assert.deepEqual(app.completions[0].filter(message => message.role === "user").map(message => message.content), ["I need help with my order"]);
    ws.close();
  });

  test(`${stepFile} keeps each caller's silence timer on the right socket`, () => {
    const app = makeHarness({ stepFile });
    const first = app.socket();
    const second = app.socket();
    first.receive({ type: "setup", callSid: "CA-first" });
    second.receive({ type: "setup", callSid: "CA-second" });
    first.close();
    app.clock.advance(8000);
    assert.equal(first.messages.filter(message => message.type === "text").length, 0);
    assert.match(second.messages.find(message => message.type === "text")?.token ?? "", /still there/i);
    second.close();
  });

  test(`${stepFile} handles malformed WebSocket messages without crashing`, () => {
    const app = makeHarness({ stepFile });
    const ws = app.socket();
    assert.doesNotThrow(() => ws.receiveRaw("{bad-json"));
    ws.close();
  });

  test(`${stepFile} changes language independently for each caller`, async () => {
    const app = makeHarness({
      stepFile,
      respond: () => [
        { choices: [{ delta: { content: "[LANG:es-ES] Hola!" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ],
    });
    const first = app.socket();
    const second = app.socket();
    first.receive({ type: "prompt", voicePrompt: "Hola" });
    second.receive({ type: "prompt", voicePrompt: "Hola" });
    await settle();
    assert.equal(first.messages.filter(message => message.type === "language").length, 1);
    assert.equal(second.messages.filter(message => message.type === "language").length, 1);
    assert.doesNotMatch(first.messages.filter(message => message.type === "text").map(message => message.token).join(""), /\[LANG:/);
    assert.doesNotMatch(second.messages.filter(message => message.type === "text").map(message => message.token).join(""), /\[LANG:/);
    first.close();
    second.close();
  });

  test(`${stepFile} switches back to English after a Spanish TwiML start`, async () => {
    const app = makeHarness({
      stepFile,
      twimlLanguage: "es-ES",
      respond: turn => [
        { choices: [{ delta: {
          content: turn === 1 ? "[LANG:es-ES] Hola!" : "[LANG:en-US] Hello!",
        }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ],
    });
    assert.match(app.request("/twiml"), /language="es-ES"/);
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

  test(`${stepFile} strips a language marker after leading whitespace`, async () => {
    const app = makeHarness({
      stepFile,
      respond: () => [
        { choices: [{ delta: { content: "  [LANG:es-ES] Hola!" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ],
    });
    const ws = app.socket();
    ws.receive({ type: "prompt", voicePrompt: "Hola" });
    await settle();
    assert.equal(ws.messages.filter(message => message.type === "language").length, 1);
    assert.doesNotMatch(ws.messages.filter(message => message.type === "text").map(message => message.token).join(""), /\[LANG:/);
    ws.close();
  });

  test(`${stepFile} remembers an audible LLM error on the next caller turn`, async () => {
    const app = makeHarness({
      stepFile,
      respond: index => {
        if (index === 1) throw new Error("OpenAI unavailable");
        return [
          { choices: [{ delta: { content: "I can help now." }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ];
      },
    });
    const ws = app.socket();
    ws.receive({ type: "prompt", voicePrompt: "Hello" });
    await settle();
    assert.match(ws.messages.find(message => message.type === "text")?.token ?? "", /technical issue/i);
    ws.receive({ type: "prompt", voicePrompt: "Are you there?" });
    await settle();
    assert.match(app.completions[1].find(message => message.role === "assistant")?.content ?? "", /technical issue/i);
    ws.close();
  });
}
