import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import * as voiceAgent from "../voice-agent/handler.mjs";
import { buildSystemPrompt, WORKSHOP_LANGUAGE_CODES } from "../voice-agent/system-prompt.mjs";
import { getCallMessage } from "../voice-agent/locale-messages.mjs";

const { handleConversationRelayConnection } = voiceAgent;

class FakeWebSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  sent = [];

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  receive(payload) {
    this.emit("message", Buffer.from(JSON.stringify(payload)));
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

function startCall(handoffEnabled, enabledTools, initialLanguage) {
  const ws = new FakeWebSocket();
  handleConversationRelayConnection(ws);
  ws.receive({
    type: "setup",
    callSid: `test-${Math.random()}`,
    from: "+12065550101",
    customParameters: {
      ...(handoffEnabled === undefined ? {} : { handoffEnabled }),
      ...(enabledTools === undefined ? {} : { enabledTools }),
      ...(initialLanguage === undefined ? {} : { initialLanguage }),
    },
  });
  return ws;
}

function sseChunk(delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-workshop-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-5.4-nano",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

async function waitFor(predicate, description) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay(20);
  }
  assert.fail(description);
}

test("Explorer handoff remains available after selecting a subset of tools", () => {
  const names = voiceAgent.filterTools("check_weather", true)
    .map((tool) => tool.function.name);
  assert.deepEqual(names, ["check_weather", "transfer_to_agent"]);
});

test("An explicit empty Explorer selection enables no optional tools", () => {
  assert.deepEqual(voiceAgent.filterTools("", false), []);
});

test("Explorer system prompt honors the initial selected language", () => {
  assert.match(buildSystemPrompt({ initialLanguage: "fr-FR" }), /call starts in fr-FR/);
  assert.match(buildSystemPrompt({ initialLanguage: "de-DE" }), /call starts in en-US/);
});

test("Explorer has every fixed spoken response in each workshop language", () => {
  const keys = [
    "silenceFirst", "silenceSecond", "silenceFinal", "technicalIssue",
    "handoffUnavailable", "handoffDisabled", "mainMenu", "unknownDigit",
    "toolLimit", "orderStatusRequest",
  ];
  for (const language of WORKSHOP_LANGUAGE_CODES) {
    for (const key of keys) {
      const message = getCallMessage(language, key);
      assert.ok(typeof message === "string" && message.trim().length > 0, `${language}: ${key}`);
      if (language !== "en-US") {
        assert.notEqual(message, getCallMessage("en-US", key), `${language}: ${key}`);
      }
    }
  }
  assert.equal(getCallMessage("de-DE", "mainMenu"), getCallMessage("en-US", "mainMenu"));
});

test("Explorer keypad hints use the caller's selected language", (t) => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.HANDOFF_PHONE_NUMBER = "";
  const ws = startCall("true", "", "fr-FR");
  t.after(() => ws.close());

  for (const digit of ["0", "9", "2"]) ws.receive({ type: "dtmf", digit });
  assert.deepEqual(ws.sent.filter((message) => message.type === "text").map((message) => message.token), [
    getCallMessage("fr-FR", "mainMenu"),
    getCallMessage("fr-FR", "unknownDigit"),
    getCallMessage("fr-FR", "handoffUnavailable"),
  ]);
});

test("Explorer silence prompts and farewell use the caller's selected language", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.OPENAI_API_KEY = "sk-test";
  const ws = startCall("false", "", "fr-FR");
  t.after(() => ws.close());

  t.mock.timers.tick(12000);
  t.mock.timers.tick(10000);
  t.mock.timers.tick(10000);
  assert.deepEqual(ws.sent.filter((message) => message.type === "text").map((message) => message.token), [
    getCallMessage("fr-FR", "silenceFirst"),
    getCallMessage("fr-FR", "silenceSecond"),
    getCallMessage("fr-FR", "silenceFinal"),
  ]);
  t.mock.timers.tick(3000);
  assert.equal(ws.sent.at(-1)?.type, "end");
  assert.equal(JSON.parse(ws.sent.at(-1).handoffData).language, "fr-FR");
  assert.equal(JSON.parse(ws.sent.at(-1).handoffData).reasonCode, "silence-timeout");
});

test("Explorer cancels a pending silence hangup when the caller responds during farewell", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.OPENAI_API_KEY = "sk-test";

  for (const reply of [
    { type: "interrupt", utteranceUntilInterrupt: "Je suis là" },
    { type: "dtmf", digit: "0" },
  ]) {
    const ws = startCall("false", "", "fr-FR");
    try {
      t.mock.timers.tick(12000);
      t.mock.timers.tick(10000);
      t.mock.timers.tick(10000);
      assert.equal(ws.sent.at(-1)?.token, getCallMessage("fr-FR", "silenceFinal"));

      ws.receive(reply);
      t.mock.timers.tick(3000);
      assert.equal(ws.sent.some((message) => message.type === "end"), false, reply.type);

      // The next silence countdown starts fresh after the caller responds.
      t.mock.timers.tick(9000);
      assert.equal(ws.sent.at(-1)?.token, getCallMessage("fr-FR", "silenceFirst"));
    } finally {
      ws.close();
    }
  }
});

test("Explorer keypad shortcut does not claim to transfer when handoff is off", async (t) => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.HANDOFF_PHONE_NUMBER = "+12065550102";
  const ws = startCall(undefined);
  t.after(() => ws.close());
  ws.receive({ type: "dtmf", digit: "2" });
  await delay(20);
  assert.doesNotMatch(ws.sent.map((message) => message.token || "").join(" "), /let me transfer/i);
  assert.equal(ws.sent.some((message) => message.type === "end"), false);
});

test("Explorer keypad shortcut initiates a real handoff when enabled", async (t) => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.HANDOFF_PHONE_NUMBER = "+12065550102";
  const ws = startCall("true", undefined, "fr-FR");
  t.after(() => ws.close());
  ws.receive({ type: "dtmf", digit: "2" });
  await delay(1600);
  const handoff = ws.sent.find((message) => message.type === "end");
  assert.ok(handoff, "The agent must end ConversationRelay so Twilio can transfer the call");
  assert.equal(JSON.parse(handoff.handoffData).reasonCode, "live-agent-handoff");
  assert.equal(JSON.parse(handoff.handoffData).language, "fr-FR");
  assert.equal(ws.sent.filter((message) => message.type === "text").length, 0,
    "the Connect action announces the transfer once after ConversationRelay ends");
});

test("Explorer explains that live handoff is unavailable without a destination", async (t) => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.HANDOFF_PHONE_NUMBER = "";
  const ws = startCall("true");
  t.after(() => ws.close());
  ws.receive({ type: "dtmf", digit: "2" });
  await delay(20);
  assert.match(ws.sent.map((message) => message.token || "").join(" "), /unavailable/i);
  assert.equal(ws.sent.some((message) => message.type === "end"), false);
});

test("Explorer keeps unsupported or premium handoff destinations in the conversation", (t) => {
  process.env.OPENAI_API_KEY = "sk-test";
  const previousDestination = process.env.HANDOFF_PHONE_NUMBER;
  t.after(() => {
    if (previousDestination === undefined) delete process.env.HANDOFF_PHONE_NUMBER;
    else process.env.HANDOFF_PHONE_NUMBER = previousDestination;
  });

  for (const destination of ["+442079460000", "+19005550100", "+1206555"]) {
    process.env.HANDOFF_PHONE_NUMBER = destination;
    const ws = startCall("true");
    try {
      ws.receive({ type: "dtmf", digit: "2" });
      assert.equal(ws.sent.some((message) => message.type === "end"), false, destination);
      assert.match(ws.sent.map((message) => message.token || "").join(""), /handoff is unavailable/i);

      ws.receive({ type: "dtmf", digit: "0" });
      assert.match(ws.sent.map((message) => message.token || "").join(""), /Returning to the main menu/);
    } finally {
      ws.close();
    }
  }
});

test("Explorer strips a split language marker and uses that language for later keypad replies", async () => {
  const requests = [];
  const api = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (requests.length === 1) {
      for (const character of "[LANG:es-ES] Hola!") {
        response.write(sseChunk({ content: character }));
      }
    } else {
      response.write(sseChunk({ content: "Ya está." }));
    }
    response.write(sseChunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));

  const priorBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${api.address().port}/v1`;
  const ws = startCall("false", "");

  try {
    ws.receive({ type: "prompt", voicePrompt: "Please speak Spanish", last: true });
    await waitFor(
      () => ws.sent.some((message) => message.type === "text" && message.last),
      "the streamed reply should finish"
    );
    assert.equal(ws.sent[0]?.type, "language", "switch language before speaking Spanish");
    assert.deepEqual(
      { ttsLanguage: ws.sent[0].ttsLanguage, transcriptionLanguage: ws.sent[0].transcriptionLanguage },
      { ttsLanguage: "es-ES", transcriptionLanguage: "es-ES" }
    );
    assert.equal(ws.sent.filter((message) => message.type === "text")
      .map((message) => message.token).join(""), " Hola!");

    ws.receive({ type: "dtmf", digit: "0" });
    assert.equal(ws.sent.at(-1)?.token, getCallMessage("es-ES", "mainMenu"));
    ws.receive({ type: "dtmf", digit: "1" });
    await waitFor(() => requests.length === 2 &&
      ws.sent.some((message) => message.token === "Ya está.") &&
      ws.sent.filter((message) => message.type === "text" && message.last).length >= 3,
      "digit 1 should request order status in Spanish");
    assert.equal(requests[1].messages.at(-1).content, getCallMessage("es-ES", "orderStatusRequest"));
    ws.receive({ type: "dtmf", digit: "2" });
    assert.equal(ws.sent.at(-1)?.token, getCallMessage("es-ES", "handoffDisabled"));
  } finally {
    ws.close();
    if (priorBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = priorBaseUrl;
    await new Promise((resolve) => api.close(resolve));
  }
});

test("Explorer ignores a model language marker that TwiML has not configured", async () => {
  const api = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(sseChunk({ content: "[LANG:de-DE] Guten Tag" }));
    response.write(sseChunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));

  const priorBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${api.address().port}/v1`;
  const ws = startCall("false", "");

  try {
    ws.receive({ type: "prompt", voicePrompt: "Please speak German", last: true });
    await waitFor(() => ws.sent.some((message) => message.type === "text" && message.last),
      "the streamed reply should finish");
    assert.equal(ws.sent.some((message) => message.type === "language"), false);
    assert.equal(ws.sent.filter((message) => message.type === "text")
      .map((message) => message.token).join(""), " Guten Tag");
    ws.receive({ type: "dtmf", digit: "0" });
    assert.equal(ws.sent.at(-1)?.token, getCallMessage("en-US", "mainMenu"));
  } finally {
    ws.close();
    if (priorBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = priorBaseUrl;
    await new Promise((resolve) => api.close(resolve));
  }
});

test("Explorer streams a tool answer through the OpenAI SDK into ConversationRelay", async () => {
  const requests = [];
  const api = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (requests.length === 1) {
      response.write(sseChunk({ tool_calls: [{
        index: 0,
        id: "call-weather",
        type: "function",
        function: { name: "check_weather", arguments: '{"city":"San Francisco"}' },
      }] }));
      response.write(sseChunk({}, "tool_calls"));
    } else {
      response.write(sseChunk({ content: "It's sunny in San Francisco." }));
      response.write(sseChunk({}, "stop"));
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));

  const priorBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.HANDOFF_PHONE_NUMBER = "+12065550102";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${api.address().port}/v1`;
  const ws = startCall("true", "check_weather");

  try {
    ws.receive({ type: "prompt", voicePrompt: "What's the weather", last: false });
    await delay(50);
    assert.equal(requests.length, 0, "interim transcripts must not start an OpenAI turn");
    ws.receive({ type: "prompt", voicePrompt: "What's the weather in San Francisco?", last: true });
    for (let i = 0; i < 100 && !ws.sent.some((message) => message.type === "text" && message.last); i++) {
      await delay(50);
    }
    assert.equal(requests.length, 2, "the model should receive a second turn with the tool result");
    assert.deepEqual(
      requests[0].tools.map((tool) => tool.function.name),
      ["check_weather", "transfer_to_agent"]
    );
    assert.match(requests[1].messages.find((message) => message.role === "tool").content, /Sunny/);
    assert.match(ws.sent.map((message) => message.token || "").join(""), /sunny in San Francisco/i);
    assert.equal(ws.sent.at(-1).last, true);
  } finally {
    ws.close();
    if (priorBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = priorBaseUrl;
    await new Promise((resolve) => api.close(resolve));
  }
});

test("Explorer does not apologize after a successful answer on the fifth model round", async () => {
  let requests = 0;
  const api = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (requests < 5) {
      response.write(sseChunk({ tool_calls: [{
        index: 0,
        id: `weather-${requests}`,
        type: "function",
        function: { name: "check_weather", arguments: '{"city":"San Francisco"}' },
      }] }));
      response.write(sseChunk({}, "tool_calls"));
    } else {
      response.write(sseChunk({ content: "The final answer is ready." }));
      response.write(sseChunk({}, "stop"));
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));

  const priorBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${api.address().port}/v1`;
  const ws = startCall("false", "check_weather");

  try {
    ws.receive({ type: "prompt", voicePrompt: "Please check again", last: true });
    await waitFor(
      () => requests === 5 && ws.sent.some((message) => message.type === "text" && message.last),
      "the fifth model round should deliver its final answer"
    );
    await delay(20);
    assert.equal(ws.sent.filter((message) => message.type === "text")
      .map((message) => message.token).join(""), "The final answer is ready.");
    assert.equal(ws.sent.filter((message) => message.type === "text" && message.last).length, 1);
  } finally {
    ws.close();
    if (priorBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = priorBaseUrl;
    await new Promise((resolve) => api.close(resolve));
  }
});

test("Explorer tool iteration limit uses the caller's selected language", async () => {
  let requests = 0;
  const api = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(sseChunk({ tool_calls: [{
      index: 0,
      id: `weather-${requests}`,
      type: "function",
      function: { name: "check_weather", arguments: '{"city":"San Francisco"}' },
    }] }));
    response.write(sseChunk({}, "tool_calls"));
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));

  const priorBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${api.address().port}/v1`;
  const ws = startCall("false", "check_weather", "pt-BR");

  try {
    ws.receive({ type: "prompt", voicePrompt: "Confira o clima", last: true });
    await waitFor(() => requests === 5 && ws.sent.some((message) => message.type === "text" && message.last),
      "the fifth tool round should end with an audible fallback");
    assert.deepEqual(ws.sent.filter((message) => message.type === "text").map((message) => message.token), [
      getCallMessage("pt-BR", "toolLimit"),
    ]);
  } finally {
    ws.close();
    if (priorBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = priorBaseUrl;
    await new Promise((resolve) => api.close(resolve));
  }
});

test("Explorer model handoff ends the relay for the transfer callback", async () => {
  let requests = 0;
  const api = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(sseChunk({ content: "[LANG:es-ES]" }));
    response.write(sseChunk({ tool_calls: [{
      index: 0,
      id: "call-transfer",
      type: "function",
      function: {
        name: "transfer_to_agent",
        arguments: '{"reason":"caller_requested_human","summary":"Caller asked for a person."}',
      },
    }] }));
    response.write(sseChunk({}, "tool_calls"));
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));

  const priorBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.HANDOFF_PHONE_NUMBER = "+12065550102";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${api.address().port}/v1`;
  const ws = startCall("true", "");

  try {
    ws.receive({ type: "prompt", voicePrompt: "I need a person", last: true });
    for (let i = 0; i < 100 && !ws.sent.some((message) => message.type === "end"); i++) {
      await delay(50);
    }
    const handoff = ws.sent.find((message) => message.type === "end");
    assert.ok(handoff);
    assert.equal(JSON.parse(handoff.handoffData).summary, "Caller asked for a person.");
    assert.equal(JSON.parse(handoff.handoffData).language, "es-ES");
    assert.equal(requests, 1, "a successful transfer must not start another model turn");
  } finally {
    ws.close();
    if (priorBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = priorBaseUrl;
    await new Promise((resolve) => api.close(resolve));
  }
});

test("Explorer interruption stops the old stream and keeps the heard reply for the next prompt", async () => {
  const requests = [];
  let firstResponse;
  let firstStreamClosed = false;
  const api = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (requests.length === 1) {
      firstResponse = response;
      response.on("close", () => { firstStreamClosed = true; });
      response.write(sseChunk({ content: "Opening answer. " }));
      return;
    }
    response.write(sseChunk({ content: "New answer." }));
    response.write(sseChunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));

  const priorBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${api.address().port}/v1`;
  const ws = startCall("false", "");

  try {
    ws.receive({ type: "prompt", voicePrompt: "First question", last: true });
    await waitFor(
      () => ws.sent.some((message) => message.token?.includes("Opening answer")),
      "the first reply should begin streaming"
    );

    ws.receive({ type: "interrupt", utteranceUntilInterrupt: "Opening" });
    ws.receive({ type: "prompt", voicePrompt: "Second question", last: true });

    await waitFor(
      () => requests.length === 2 && ws.sent.some((message) => message.token === "New answer."),
      "the final prompt after interruption should reach OpenAI and receive a reply"
    );
    await waitFor(() => firstStreamClosed, "interruption should close the old OpenAI stream");
    assert.deepEqual(
      requests[1].messages.slice(-3),
      [
        { role: "user", content: "First question" },
        { role: "assistant", content: "Opening" },
        { role: "user", content: "Second question" },
      ]
    );

    if (!firstResponse.destroyed) {
      firstResponse.write(sseChunk({ content: "STALE RESPONSE" }));
      firstResponse.end("data: [DONE]\n\n");
    }
    await delay(50);
    assert.equal(ws.sent.some((message) => message.token?.includes("STALE RESPONSE")), false);
  } finally {
    ws.close();
    firstResponse?.end();
    if (priorBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = priorBaseUrl;
    await new Promise((resolve) => api.close(resolve));
  }
});

test("Explorer keypad transfer preempts an unfinished tool stream", async () => {
  let firstResponse;
  const api = createServer(async (request, response) => {
    await new Promise((resolve) => {
      request.on("end", resolve);
      request.resume();
    });
    response.writeHead(200, { "content-type": "text/event-stream" });
    firstResponse = response;
    response.write(sseChunk({ tool_calls: [{
      index: 0,
      id: "call-transfer",
      type: "function",
      function: {
        name: "transfer_to_agent",
        arguments: '{"reason":"model_request","summary":"Old tool stream."}',
      },
    }] }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));

  const priorBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.HANDOFF_PHONE_NUMBER = "+12065550102";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${api.address().port}/v1`;
  const ws = startCall("true", "");

  try {
    ws.receive({ type: "prompt", voicePrompt: "Please transfer me", last: true });
    await waitFor(() => Boolean(firstResponse), "the model tool stream should be open");
    ws.receive({ type: "dtmf", digit: "2" });
    await waitFor(
      () => ws.sent.some((message) => message.type === "end"),
      "digit 2 should transfer immediately while a tool stream is unfinished"
    );
    assert.equal(
      JSON.parse(ws.sent.find((message) => message.type === "end").handoffData).reason,
      "keypad_request"
    );
    if (!firstResponse.destroyed) {
      firstResponse.write(sseChunk({}, "tool_calls"));
      firstResponse.end("data: [DONE]\n\n");
    }
    await delay(50);
    assert.equal(ws.sent.filter((message) => message.type === "end").length, 1);
  } finally {
    ws.close();
    firstResponse?.end();
    if (priorBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = priorBaseUrl;
    await new Promise((resolve) => api.close(resolve));
  }
});

test("Explorer includes a spoken API error fallback in the next model turn", async () => {
  const requests = [];
  const api = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    if (requests.length === 1) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Mock bad request", type: "invalid_request_error" } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(sseChunk({ content: "Recovered answer." }));
    response.write(sseChunk({}, "stop"));
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));

  const priorBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${api.address().port}/v1`;
  const ws = startCall("false", "");

  try {
    ws.receive({ type: "prompt", voicePrompt: "First question", last: true });
    await waitFor(
      () => ws.sent.some((message) => message.token?.includes("technical issue")),
      "a failed OpenAI request should produce an audible fallback"
    );
    ws.receive({ type: "prompt", voicePrompt: "Second question", last: true });
    await waitFor(
      () => requests.length === 2 && ws.sent.some((message) => message.token === "Recovered answer."),
      "a second prompt should still reach OpenAI"
    );
    assert.deepEqual(requests[1].messages.slice(-3), [
      { role: "user", content: "First question" },
      { role: "assistant", content: "I'm sorry, I encountered a technical issue. Please try again." },
      { role: "user", content: "Second question" },
    ]);
  } finally {
    ws.close();
    if (priorBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = priorBaseUrl;
    await new Promise((resolve) => api.close(resolve));
  }
});

test("Explorer API error fallback uses the caller's selected language", async () => {
  const api = createServer((_request, response) => {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Mock bad request", type: "invalid_request_error" } }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));

  const priorBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${api.address().port}/v1`;
  const ws = startCall("false", "", "fr-FR");

  try {
    ws.receive({ type: "prompt", voicePrompt: "Bonjour", last: true });
    await waitFor(() => ws.sent.some((message) => message.type === "text" && message.last),
      "the failed model request should produce an audible fallback");
    assert.equal(ws.sent.find((message) => message.type === "text")?.token,
      getCallMessage("fr-FR", "technicalIssue"));
  } finally {
    ws.close();
    if (priorBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = priorBaseUrl;
    await new Promise((resolve) => api.close(resolve));
  }
});

test("Explorer unknown keypad input cancels a tool round without orphaned history", async () => {
  const requests = [];
  let toolRoundResponse;
  const api = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (requests.length === 1) {
      response.write(sseChunk({ tool_calls: [{
        index: 0,
        id: "call-weather",
        type: "function",
        function: { name: "check_weather", arguments: '{"city":"San Francisco"}' },
      }] }));
      response.write(sseChunk({}, "tool_calls"));
      response.end("data: [DONE]\n\n");
    } else if (requests.length === 2) {
      toolRoundResponse = response;
      response.write(sseChunk({ content: "Checking the weather. " }));
    } else {
      response.write(sseChunk({ content: "Fresh answer." }));
      response.write(sseChunk({}, "stop"));
      response.end("data: [DONE]\n\n");
    }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));

  const priorBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${api.address().port}/v1`;
  const ws = startCall("false", "check_weather");

  try {
    ws.receive({ type: "prompt", voicePrompt: "What's the weather?", last: true });
    await waitFor(
      () => requests.length === 2 && ws.sent.some((message) => message.token?.includes("Checking the weather")),
      "the tool result should have reached a second model round"
    );
    assert.ok(requests[1].messages.some((message) => message.role === "tool"));

    ws.receive({ type: "dtmf", digit: "9" });
    await waitFor(
      () => ws.sent.some((message) => message.token?.includes("didn't recognize")),
      "an unknown digit should get an immediate keypad hint"
    );
    ws.receive({ type: "prompt", voicePrompt: "Something else", last: true });
    await waitFor(
      () => requests.length === 3 && ws.sent.some((message) => message.token === "Fresh answer."),
      "the caller should be able to continue after an unknown digit"
    );
    assert.equal(requests[2].messages.some((message) => message.role === "tool" || message.tool_calls), false);
    assert.deepEqual(requests[2].messages.slice(-3), [
      { role: "user", content: "What's the weather?" },
      { role: "assistant", content: "I didn't recognize that option. Press 1 for order status, or 2 for a representative." },
      { role: "user", content: "Something else" },
    ]);
  } finally {
    ws.close();
    toolRoundResponse?.end();
    if (priorBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = priorBaseUrl;
    await new Promise((resolve) => api.close(resolve));
  }
});
