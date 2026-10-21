import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const contentPath = new URL("../src/content/chapter-6/step-1-polish.ts", import.meta.url);

function extractSolution() {
  const source = readFileSync(contentPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const contentModule = { exports: {} };
  vm.runInNewContext(compiled, { module: contentModule, exports: contentModule.exports }, {
    filename: contentPath.pathname,
  });
  const step = contentModule.exports.default;
  const solution = step.blocks.find(block =>
    block.type === "solution" && block.audience === "builder" && block.files
  );
  assert.ok(solution, "final Builder solution exists");
  return {
    step,
    serverCode: solution.files.find(file => file.file === "server.js").code,
    handlersCode: solution.files.find(file => file.file === "tool-handlers.js").code,
  };
}

const { step, serverCode, handlersCode } = extractSolution();

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

function chunk(content) {
  return { choices: [{ delta: { content }, finish_reason: null }] };
}

function finish(reason = "stop") {
  return { choices: [{ delta: {}, finish_reason: reason }] };
}

function makeHarness({
  respond = () => [chunk("Hello."), finish()],
  twimlLanguage = null,
  env = {},
  configureHandlers = () => {},
} = {}) {
  const clock = makeClock();
  const completions = [];
  const logs = [];
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
      this.emit("message", Buffer.from(
        typeof message === "string" ? message : JSON.stringify(message)
      ));
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
        const call = {
          model: input.model,
          messages: structuredClone(input.messages),
          signal: options?.signal,
        };
        completions.push(call);
        const output = await respond(call, completions.length);
        if (output?.[Symbol.asyncIterator]) return output;
        return (async function* () { for (const item of output) yield item; })();
      } } };
    }
  }
  const fakeRequire = id => {
    if (id === "dotenv") return { config() {} };
    if (id === "ws") return { WebSocketServer: FakeWebSocketServer };
    if (id === "http") return { createServer(handler) {
      httpServer = {
        handler,
        port: null,
        listen(port, callback) { this.port = port; callback?.(); },
      };
      return httpServer;
    } };
    if (id === "openai") return FakeOpenAI;
    if (id === "twilio") return () => ({ calls: { create: async () => ({ sid: "CA123" }) } });
    if (id === "./tool-handlers.js") return handlersModule.exports;
    throw new Error(`Unexpected require: ${id}`);
  };

  const configuredServerCode = twimlLanguage
    ? serverCode.replace('language="en-US"', `language="${twimlLanguage}"`)
    : serverCode;
  vm.runInNewContext(configuredServerCode, {
    require: fakeRequire,
    process,
    console: {
      log: (...args) => logs.push(["log", ...args]),
      error: (...args) => logs.push(["error", ...args]),
    },
    AbortController,
    URLSearchParams,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    Date,
  }, { filename: "server.js" });

  return {
    clock,
    completions,
    logs,
    port: httpServer.port,
    socket() {
      const ws = new FakeWebSocket();
      webSocketServers[0].emit("connection", ws);
      return ws;
    },
    request(url, body = "", method = "POST") {
      const req = new EventEmitter();
      req.url = url;
      req.method = method;
      req.headers = { host: "workshop.example" };
      const res = {
        status: null,
        headers: null,
        body: "",
        writeHead(status, headers) { this.status = status; this.headers = headers; },
        end(value = "") { this.body += value; },
      };
      httpServer.handler(req, res);
      req.emit("data", Buffer.from(body));
      req.emit("end");
      return res;
    },
  };
}

async function settle() {
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
}

test("both embedded JavaScript files parse", () => {
  assert.doesNotThrow(() => new vm.Script(serverCode, { filename: "server.js" }));
  assert.doesNotThrow(() => new vm.Script(handlersCode, { filename: "tool-handlers.js" }));
});

test("the final Builder solution uses OPENAI_MODEL for requests", async () => {
  const app = makeHarness({ env: { OPENAI_MODEL: "workshop-test-model" } });
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Hello" });
  await settle();
  assert.equal(app.completions[0].model, "workshop-test-model");
  ws.close();
});

test("the final copy-paste solution has a working bilingual tool-aware system prompt", async () => {
  const app = makeHarness();
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Where is order 123?" });
  await settle();
  const systemPrompt = app.completions[0].messages[0].content;
  assert.doesNotMatch(systemPrompt, /paste your SYSTEM_PROMPT|<--/i);
  assert.match(systemPrompt, /lookup_order/);
  assert.match(systemPrompt, /check_weather/);
  assert.match(systemPrompt, /transfer_to_agent/);
  assert.match(systemPrompt, /\[LANG:es-ES\]/);
  ws.close();
});

test("two callers have separate conversation histories", async () => {
  const app = makeHarness();
  const first = app.socket();
  const second = app.socket();
  first.receive({ type: "prompt", voicePrompt: "First caller" });
  second.receive({ type: "prompt", voicePrompt: "Second caller" });
  await settle();
  assert.deepEqual(app.completions[0].messages.filter(m => m.role === "user").map(m => m.content), ["First caller"]);
  assert.deepEqual(app.completions[1].messages.filter(m => m.role === "user").map(m => m.content), ["Second caller"]);
  first.close();
  second.close();
  const next = app.socket();
  next.receive({ type: "prompt", voicePrompt: "Next call" });
  await settle();
  assert.deepEqual(app.completions[2].messages.filter(m => m.role === "user").map(m => m.content), ["Next call"]);
  next.close();
});

test("interim speech transcripts wait for the final caller turn", async () => {
  const app = makeHarness();
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Where is", last: false });
  await settle();
  assert.equal(app.completions.length, 0);
  ws.receive({ type: "prompt", voicePrompt: "Where is my order?", last: true });
  await settle();
  assert.equal(app.completions.length, 1);
  assert.deepEqual(app.completions[0].messages.filter(m => m.role === "user").map(m => m.content), ["Where is my order?"]);
  ws.close();
});

test("interrupting one caller does not abort another caller's response", async () => {
  const app = makeHarness({ respond: () => ({
    [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; },
  }) });
  const first = app.socket();
  const second = app.socket();
  first.receive({ type: "prompt", voicePrompt: "First" });
  second.receive({ type: "prompt", voicePrompt: "Second" });
  await settle();
  first.receive({ type: "interrupt", utteranceUntilInterrupt: "" });
  assert.equal(app.completions[0].signal.aborted, true);
  assert.equal(app.completions[1].signal.aborted, false);
  first.close();
  second.close();
});

test("language switches are tracked per caller", async () => {
  const app = makeHarness({ respond: () => [chunk("[LANG:es-ES] Hola."), finish()] });
  const first = app.socket();
  const second = app.socket();
  first.receive({ type: "prompt", voicePrompt: "Spanish please" });
  second.receive({ type: "prompt", voicePrompt: "Spanish please" });
  await settle();
  assert.equal(first.messages.filter(m => m.type === "language").length, 1);
  assert.equal(second.messages.filter(m => m.type === "language").length, 1);
  first.close();
  second.close();
});

test("the final Builder code switches back to English after a Spanish TwiML start", async () => {
  const app = makeHarness({
    twimlLanguage: "es-ES",
    respond: (_call, turn) => [chunk(turn === 1 ? "[LANG:es-ES] Hola!" : "[LANG:en-US] Hello!"), finish()],
  });
  assert.match(app.request("/twiml").body, /language="es-ES"/);
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

test("the final Builder code can switch language on a keypad turn before speech", async () => {
  const app = makeHarness({
    twimlLanguage: "es-ES",
    respond: () => [chunk("[LANG:en-US] Hello!"), finish()],
  });
  const ws = app.socket();
  ws.receive({ type: "dtmf", digit: "1" });
  await settle();
  assert.equal(ws.messages[0]?.type, "language");
  assert.equal(ws.messages[0]?.ttsLanguage, "en-US");
  assert.equal(ws.messages.find(message => message.type === "text" && message.token)?.token, "Hello!");
  ws.close();
});

test("a language marker after leading whitespace changes voice without being spoken", async () => {
  const app = makeHarness({ respond: () => [chunk(" [LANG:es-ES] Hola. How can I help?"), finish()] });
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Spanish please" });
  await settle();
  assert.equal(ws.messages.filter(m => m.type === "language").length, 1);
  assert.doesNotMatch(ws.messages.filter(m => m.type === "text").map(m => m.token).join(" "), /\[LANG:/);
  ws.close();
});

test("closing one caller leaves another caller's silence timer running", () => {
  const app = makeHarness();
  const first = app.socket();
  const second = app.socket();
  first.receive({ type: "setup" });
  second.receive({ type: "setup" });
  first.close();
  app.clock.advance(8000);
  assert.match(second.messages.find(m => m.type === "text")?.token ?? "", /still there/i);
  second.close();
});

test("a slow answer does not trigger silence nudges and gets a fresh countdown afterward", async () => {
  let finishAnswer;
  const pendingAnswer = new Promise(resolve => { finishAnswer = resolve; });
  const app = makeHarness({ respond: () => pendingAnswer });
  const ws = app.socket();
  ws.receive({ type: "setup", callSid: "CA123" });
  ws.receive({ type: "prompt", voicePrompt: "Where is my order?", last: true });

  app.clock.advance(16000);
  assert.equal(ws.messages.filter(message => message.type === "text").length, 0);

  finishAnswer([chunk("Your order is on its way."), finish()]);
  await settle();
  assert.ok(ws.messages.some(message => message.type === "text" && /Your order/.test(message.token)));

  app.clock.advance(7999);
  assert.equal(ws.messages.filter(message => message.type === "text" && /still there/i.test(message.token)).length, 0);
  app.clock.advance(1);
  assert.equal(ws.messages.filter(message => message.type === "text" && /still there/i.test(message.token)).length, 1);
  ws.close();
});

test("a slow tool lookup does not trigger silence nudges", async () => {
  let finishLookup;
  const pendingLookup = new Promise(resolve => { finishLookup = resolve; });
  const lookupCall = {
    choices: [{ delta: { tool_calls: [{
      index: 0,
      id: "call-order",
      function: { name: "lookup_order", arguments: '{"order_id":"123"}' },
    }] }, finish_reason: null }],
  };
  const app = makeHarness({
    configureHandlers: handlers => { handlers.lookup_order = () => pendingLookup; },
    respond: (_call, number) => number === 1
      ? [lookupCall, finish("tool_calls")]
      : [chunk("Your order shipped."), finish()],
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

test("an interrupted slow answer restores the caller silence countdown", async () => {
  let finishAnswer;
  const pendingAnswer = new Promise(resolve => { finishAnswer = resolve; });
  const app = makeHarness({ respond: () => pendingAnswer });
  const ws = app.socket();
  ws.receive({ type: "setup", callSid: "CA123" });
  ws.receive({ type: "prompt", voicePrompt: "Tell me about my order", last: true });
  app.clock.advance(4000);
  ws.receive({ type: "interrupt", utteranceUntilInterrupt: "" });
  app.clock.advance(8000);
  assert.equal(ws.messages.filter(message => message.type === "text" && /still there/i.test(message.token)).length, 1);
  finishAnswer([chunk("An obsolete reply."), finish()]);
  await settle();
  assert.equal(ws.messages.filter(message => message.type === "text" && /obsolete/i.test(message.token)).length, 0);
  ws.close();
});

test("an interruption preserves the portion of a streaming answer the caller heard", async () => {
  let releaseFirstStream;
  const holdFirstStream = new Promise(resolve => { releaseFirstStream = resolve; });
  const app = makeHarness({
    respond: (_call, number) => number === 1
      ? (async function* () {
        yield chunk("I found your order. ");
        await holdFirstStream;
        yield finish();
      })()
      : [chunk("The new answer."), finish()],
  });
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Where is my order?", last: true });
  await settle();
  assert.ok(ws.messages.some(message => message.type === "text" && /I found your order/.test(message.token)));
  ws.receive({ type: "interrupt", utteranceUntilInterrupt: "I found your order." });
  ws.receive({ type: "prompt", voicePrompt: "Actually, tell me something else.", last: true });
  await settle();
  const secondHistory = app.completions[1].messages;
  assert.ok(secondHistory.some(message => message.role === "assistant" && message.content === "I found your order."));
  releaseFirstStream();
  await settle();
  ws.close();
});

test("an AI error fallback restarts the caller silence countdown", async () => {
  const app = makeHarness({ respond: () => Promise.reject(new Error("model unavailable")) });
  const ws = app.socket();
  ws.receive({ type: "setup", callSid: "CA123" });
  ws.receive({ type: "prompt", voicePrompt: "Tell me about my order", last: true });
  await settle();
  assert.ok(ws.messages.some(message => message.type === "text" && /technical issue/i.test(message.token)));
  app.clock.advance(7999);
  assert.equal(ws.messages.filter(message => message.type === "text" && /still there/i.test(message.token)).length, 0);
  app.clock.advance(1);
  assert.equal(ws.messages.filter(message => message.type === "text" && /still there/i.test(message.token)).length, 1);
  ws.close();
});

test("handoff tool ends immediately so the action URL can announce once", async () => {
  const toolCall = {
    choices: [{ delta: { tool_calls: [{
      index: 0,
      id: "call-transfer",
      function: {
        name: "transfer_to_agent",
        arguments: JSON.stringify({ reason: "Asked for a person", summary: "Order question" }),
      },
    }] }, finish_reason: null }],
  };
  const app = makeHarness({
    env: { HANDOFF_PHONE_NUMBER: "+14155552671" },
    respond: () => [toolCall, finish("tool_calls")],
  });
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Get me a person" });
  await settle();
  assert.equal(app.completions.length, 1);
  assert.equal(ws.messages.filter(m => m.type === "text").length, 0);
  const handoff = ws.messages.find(m => m.type === "end");
  assert.equal(JSON.parse(handoff.handoffData).reasonCode, "live-agent-handoff");
  const twiml = app.request("/call-ended", new URLSearchParams({
    HandoffData: handoff.handoffData,
  }).toString());
  assert.match(twiml.body, /<Say>[^<]*transfer[^<]*<\/Say>\s*<Dial>\s*<Number>\+14155552671<\/Number>\s*<\/Dial>/i);
  ws.close();
});

test("a new caller turn cancels a slow tool without leaving an orphan tool call", async () => {
  let releaseLookup;
  const lookupFinished = new Promise(resolve => { releaseLookup = resolve; });
  const lookupCall = {
    choices: [{ delta: { tool_calls: [{
      index: 0,
      id: "call-order",
      function: { name: "lookup_order", arguments: '{"order_id":"123"}' },
    }] }, finish_reason: null }],
  };
  const app = makeHarness({
    configureHandlers: handlers => {
      handlers.lookup_order = async () => lookupFinished;
    },
    respond: (_call, number) => number === 1
      ? [lookupCall, finish("tool_calls")]
      : [chunk("New answer."), finish()],
  });
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Where is order 123?" });
  await settle();
  ws.receive({ type: "prompt", voicePrompt: "Never mind. Tell me a joke." });
  await settle();
  assert.equal(app.completions.length, 2);
  assert.equal(app.completions[0].signal.aborted, true);
  assert.equal(app.completions[1].messages.some(m => m.tool_calls), false);
  releaseLookup({ order_id: "123", status: "shipped" });
  await settle();
  assert.equal(app.completions.length, 2);
  ws.close();
});

test("DTMF 2 initiates a live agent handoff", async () => {
  const app = makeHarness({ env: { HANDOFF_PHONE_NUMBER: "+14155552671" } });
  const ws = app.socket();
  ws.receive({ type: "dtmf", digit: "2" });
  await settle();
  assert.equal(ws.messages.filter(m => m.type === "text").length, 0);
  const handoff = ws.messages.find(m => m.type === "end");
  assert.equal(JSON.parse(handoff.handoffData).reasonCode, "live-agent-handoff");
  ws.close();
});

test("an unavailable transfer keeps the LLM conversation open", async () => {
  const transferCall = {
    choices: [{ delta: { tool_calls: [{
      index: 0,
      id: "call-transfer",
      function: {
        name: "transfer_to_agent",
        arguments: JSON.stringify({ reason: "Asked for a person", summary: "Order question" }),
      },
    }] }, finish_reason: null }],
  };
  const app = makeHarness({ respond: (_call, number) => number === 1
    ? [transferCall, finish("tool_calls")]
    : [chunk("I can still help."), finish()] });
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Get me a person" });
  await settle();
  assert.match(ws.messages.find(m => m.type === "text")?.token ?? "", /transfer is unavailable/i);
  assert.equal(ws.messages.filter(m => m.type === "end").length, 0);
  ws.receive({ type: "prompt", voicePrompt: "Then help me here" });
  await settle();
  assert.equal(app.completions.length, 2);
  assert.ok(ws.messages.some(m => m.type === "text" && /still help/i.test(m.token)));
  ws.close();
});

test("an unavailable transfer in a multi-tool reply leaves valid history", async () => {
  const transferAndWeather = {
    choices: [{ delta: { tool_calls: [
      { index: 0, id: "call-transfer", function: {
        name: "transfer_to_agent",
        arguments: JSON.stringify({ reason: "Asked for a person", summary: "Order question" }),
      } },
      { index: 1, id: "call-weather", function: {
        name: "check_weather",
        arguments: JSON.stringify({ city: "Boston" }),
      } },
    ] }, finish_reason: null }],
  };
  const app = makeHarness({ respond: (_call, number) => number === 1
    ? [transferAndWeather, finish("tool_calls")]
    : [chunk("I can still help."), finish()] });
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Get me a person" });
  await settle();
  ws.receive({ type: "prompt", voicePrompt: "Then help me here" });
  await settle();
  assert.equal(app.completions.length, 2);
  const history = app.completions[1].messages;
  const assistantCall = history.find(message => message.role === "assistant" && message.tool_calls);
  const toolReplies = history.filter(message => message.role === "tool");
  assert.equal(assistantCall.tool_calls.length, toolReplies.length);
  assert.ok(history.some(message =>
    message.role === "assistant" && /transfer is unavailable/i.test(message.content)
  ));
  ws.close();
});

test("DTMF 2 with an invalid transfer number leaves the caller in the relay", async () => {
  const app = makeHarness({ env: { HANDOFF_PHONE_NUMBER: "555-1234" } });
  const ws = app.socket();
  ws.receive({ type: "dtmf", digit: "2" });
  await settle();
  assert.match(ws.messages.find(m => m.type === "text")?.token ?? "", /transfer is unavailable/i);
  assert.equal(ws.messages.filter(m => m.type === "end").length, 0);
  ws.receive({ type: "prompt", voicePrompt: "Can you help me here?" });
  await settle();
  assert.equal(app.completions.length, 1);
  ws.close();
});

test("a disconnected caller cannot start a handoff", async () => {
  const app = makeHarness({ env: { HANDOFF_PHONE_NUMBER: "+14155552671" } });
  const ws = app.socket();
  ws.close();
  ws.receive({ type: "dtmf", digit: "2" });
  await settle();
  assert.equal(ws.messages.filter(m => m.type === "end").length, 0);
});

test("OpenAI creation failure produces a spoken fallback", async () => {
  const app = makeHarness({ respond: () => { throw new Error("OpenAI unavailable"); } });
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Hello" });
  await settle();
  assert.match(ws.messages.find(m => m.type === "text")?.token ?? "", /technical issue/i);
  assert.equal(ws.messages.find(m => m.type === "text")?.last, true);
  ws.close();
});

test("the next caller turn remembers the fallback the caller heard", async () => {
  const app = makeHarness({ respond: (_call, number) => {
    if (number === 1) throw new Error("OpenAI unavailable");
    return [chunk("I can help now."), finish()];
  } });
  const ws = app.socket();
  ws.receive({ type: "prompt", voicePrompt: "Hello" });
  await settle();
  ws.receive({ type: "prompt", voicePrompt: "Try again" });
  await settle();
  assert.ok(app.completions[1].messages.some(m =>
    m.role === "assistant" && /technical issue/i.test(m.content)
  ));
  ws.close();
});

test("malformed WebSocket frames are ignored without crashing the socket", () => {
  const app = makeHarness();
  const ws = app.socket();
  assert.doesNotThrow(() => ws.receive("{bad-json"));
  assert.doesNotThrow(() => ws.receive("null"));
  ws.receive({ type: "setup" });
  app.clock.advance(8000);
  assert.ok(ws.messages.some(m => m.type === "text"));
  ws.close();
});

test("TwiML forwards both speech and DTMF during agent speech", () => {
  const app = makeHarness();
  const response = app.request("/twiml");
  assert.equal(response.status, 200);
  assert.match(response.body, /reportInputDuringAgentSpeech="any"/);
  assert.doesNotMatch(response.body, /\bvoice=/);
  assert.doesNotMatch(response.body, /\bttsProvider=/);
});

test("only valid handoff data dials a representative", () => {
  const app = makeHarness({ env: { HANDOFF_PHONE_NUMBER: "+14155552671" } });
  const malformed = app.request("/call-ended", "HandoffData=%7Bbad-json");
  assert.match(malformed.body, /<Hangup\s*\/>/);
  const arbitrary = app.request("/call-ended", "HandoffData=%7B%7D");
  assert.match(arbitrary.body, /<Hangup\s*\/>/);
  const valid = app.request("/call-ended", new URLSearchParams({
    HandoffData: JSON.stringify({ reasonCode: "live-agent-handoff", reason: "help" }),
  }).toString());
  assert.match(valid.body, /<Say>[^<]*transfer[^<]*<\/Say>\s*<Dial>\s*<Number>\+14155552671<\/Number>\s*<\/Dial>/i);
  for (const number of [undefined, "555-1234", "+1555<Pay>"]) {
    const unavailable = makeHarness({ env: { HANDOFF_PHONE_NUMBER: number } });
    const response = unavailable.request("/call-ended", new URLSearchParams({
      HandoffData: JSON.stringify({ reasonCode: "live-agent-handoff" }),
    }).toString());
    assert.match(response.body, /transfer is unavailable/i);
    assert.doesNotMatch(response.body, /<Dial>|<Queue>|<Number>/);
  }
});

test("server listens on the configured PORT", () => {
  const app = makeHarness({ env: { PORT: "9090" } });
  assert.equal(app.port, 9090);
});

test("silence gives two nudges, then plays farewell before ending", () => {
  const app = makeHarness();
  const ws = app.socket();
  ws.receive({ type: "setup" });
  app.clock.advance(8000);
  assert.equal(ws.messages.filter(m => m.type === "text").length, 1);
  app.clock.advance(8000);
  assert.equal(ws.messages.filter(m => m.type === "text").length, 2);
  assert.equal(ws.messages.filter(m => m.type === "end").length, 0);
  app.clock.advance(8000);
  assert.match(ws.messages.at(-1)?.token ?? "", /call back/i);
  assert.equal(ws.messages.filter(m => m.type === "end").length, 0);
  app.clock.advance(4000);
  assert.equal(ws.messages.filter(m => m.type === "end").length, 0);
  app.clock.advance(2000);
  assert.equal(ws.messages.filter(m => m.type === "end").length, 1);
  ws.close();
});

test("prompt example uses the final server constant and describes language markers", () => {
  const promptExample = step.blocks.find(block =>
    block.type === "code" && block.audience === "builder" && block.code.includes("You are Jake")
  );
  const systemPrompt = vm.runInNewContext(`${promptExample.code}\nSYSTEM_PROMPT`, {});
  assert.match(systemPrompt, /\[LANG:xx-XX\]/);
});
