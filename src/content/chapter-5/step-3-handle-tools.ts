import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "section", title: "Handle Tool Calls" },

    {
      type: "concept-card",
      audience: "explorer",
      title: "The Tool Loop in Plain English",
      content:
        "Think of it like a cashier pausing to scan a barcode before telling you the price. When the AI decides it needs a tool, it stops and says \"please look this up for me.\" The tool runs, the answer comes back, and then the AI speaks to the caller. This back-and-forth loop is what lets a voice agent actually do things, not just talk about them.",
    },

    {
      type: "image",
      audience: "explorer",
      src: "/images/illustrations/gears.svg",
      alt: "Two interlocking gears — the tool loop turning: AI requests, tool runs, answer flows back.",
      size: "md",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Now that your tools are defined, you need to connect them to the conversation flow. When the AI decides to use a tool instead of responding with words, your code runs the tool, sends the answer back to the AI, and lets the conversation continue.",
    },

    {
      type: "image",
      audience: "builder",
      src: "/images/illustrations/gears.svg",
      alt: "Two interlocking gears — the tool loop turning: AI requests, tool runs, answer flows back.",
      size: "md",
    },

    { type: "page-break" },

    { type: "section", title: "Detecting Tool Calls in the Stream", audience: "builder" },

    {
      type: "callout",
      audience: "builder",
      variant: "info",
      content:
        "**Before you paste the code below, make these changes to `server.js`:**\n\n- [ ] Change the import near the top to `const { tools, toolHandlers } = require(\"./tool-handlers.js\");`\n- [ ] Replace your existing `streamResponse` function with the version below\n- [ ] Add `MAX_TOOL_ITERATIONS`, `SLOW_TOOLS`, and `handleToolCalls` from the second code block\n\nKeep `stateFor(ws)`, `handlePrompt`, `handleMessage`, language handling, and silence handling from Chapter 4. They continue to work with the new stream function.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "**Replace the old stream function; keep one copy.** The new `streamResponse` still uses `stateFor(ws)` so each caller has separate history and an independent OpenAI stream. If you append it beside the old function, JavaScript will use the last declaration and the page can behave differently from the code you intended to run.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "The `require(\"./tool-handlers.js\")` import must go **near the top of `server.js`**, alongside your other `require` statements. The `streamResponse` function references `tools` (passed to OpenAI) and `toolHandlers` (dispatched when a tool call fires). Without the import you'll hit `ReferenceError: tools is not defined`.",
    },

    {
      type: "visual-step",
      audience: "explorer",
      steps: [
        {
          icon: "/images/icons/voice-wave.svg",
          title: "Caller asks a question",
          description:
            '**Caller:** "Where is my order, 123?"',
        },
        {
          icon: "/images/icons/robot.svg",
          title: "AI pauses and requests a tool",
          description:
            'Instead of guessing, the AI signals: _"I need to run `lookup_order` with order number 123."_ No words go to the caller yet.',
        },
        {
          icon: "/images/icons/wrench.svg",
          title: "Tool runs and returns an answer",
          description:
            'The workshop\'s back-end runs the tool and gets back: _"Shipped. Arriving tomorrow. Tracking 1Z999AA10123456784."_',
        },
        {
          icon: "/images/icons/arrow-cycle.svg",
          title: "AI loops with the real data",
          description:
            'The AI reads the tool\'s answer and decides what to say next. It might call another tool if it still needs more — or it might be ready to reply.',
        },
        {
          icon: "/images/icons/chat-bubble.svg",
          title: "AI replies with natural words",
          description:
            '**Agent:** "Your order shipped and should arrive tomorrow. I can text you the tracking number if you\'d like."',
        },
      ],
    },

    {
      type: "callout",
      audience: "explorer",
      variant: "tip",
      content:
        "You'll hear this loop in action on your test call. Ask about the weather or an order -- whichever tools you have turned on -- and listen for that tiny pause where the AI runs the tool before answering. That pause is the loop doing its job.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Here is the high-level logic:\n\n1. Send the conversation to the AI and start listening for the reply.\n2. As the reply streams in: if it is **words**, send them to the caller sentence by sentence. If the AI is **requesting a tool**, collect those requests.\n3. If the AI asked for tools, run each one, send the results back to the AI, and let it try again with the real data.\n4. If the AI is done talking, send the last bit of text and save the reply.",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      code: `// Replace your existing streamResponse function with this one.
async function streamResponse(ws, iteration = 0) {
  const state = stateFor(ws);
  state.activeStream?.abort();
  const controller = new AbortController();
  state.activeStream = controller;
  clearTimeout(state.silenceTimer);
  state.silenceTimer = null;

  try {
    const stream = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4-nano",
      messages: state.conversationHistory,
      tools,
      stream: true,
    }, { signal: controller.signal });

    if (controller.signal.aborted || state.closed) return;
    let textBuffer = "";
    let fullAssistantText = "";
    const toolCalls = [];

    for await (const chunk of stream) {
      if (controller.signal.aborted || state.closed) return;
      const delta = chunk.choices?.[0]?.delta;
      const finishReason = chunk.choices?.[0]?.finish_reason;

      if (delta?.content) {
        textBuffer += delta.content;
        fullAssistantText += delta.content;
        let match;
        while ((match = textBuffer.match(/[.!?](\\s|$)/))) {
          const sentenceEnd = match.index + 1;
          processLLMResponse(ws, textBuffer.slice(0, sentenceEnd));
          textBuffer = textBuffer.slice(sentenceEnd + (match[1] ? match[1].length : 0));
        }
      }

      for (const tc of delta?.tool_calls || []) {
        if (tc.index === undefined) continue;
        if (!toolCalls[tc.index]) {
          toolCalls[tc.index] = {
            id: tc.id || "",
            function: { name: "", arguments: "" }
          };
        }
        if (tc.id) toolCalls[tc.index].id = tc.id;
        if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
      }

      if (finishReason === "tool_calls") {
        if (textBuffer.trim()) processLLMResponse(ws, textBuffer.trim());
        if (fullAssistantText.trim()) sendText(ws, "", true);
        await handleToolCalls(ws, toolCalls.filter(Boolean), iteration, controller, fullAssistantText.trim());
        return;
      }

      if (finishReason === "stop") {
        if (textBuffer.trim()) processLLMResponse(ws, textBuffer.trim());
        sendText(ws, "", true);
        if (fullAssistantText.trim()) {
          state.conversationHistory.push({ role: "assistant", content: fullAssistantText.trim() });
        }
        return;
      }
    }

    if (textBuffer.trim()) processLLMResponse(ws, textBuffer.trim());
    if (fullAssistantText.trim()) {
      sendText(ws, "", true);
      state.conversationHistory.push({ role: "assistant", content: fullAssistantText.trim() });
    }
  } catch (err) {
    if (controller.signal.aborted || err.name === "AbortError" || state.closed) return;
    console.error("LLM error:", err.message);
    const apology = "I'm sorry, I'm having a technical issue. Could you say that again?";
    sendText(ws, apology, true);
    state.conversationHistory.push({ role: "assistant", content: apology });
  } finally {
    if (state.activeStream === controller) {
      state.activeStream = null;
      resetSilenceTimer(ws);
    }
  }
}`,
    },

    { type: "page-break" },

    { type: "section", title: "Executing Tool Calls", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "When the AI asks for tools instead of responding with text, your server runs each tool, adds the results to the conversation, and sends everything back to the AI so it can craft a final answer:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      code: `const MAX_TOOL_ITERATIONS = 5;
const SLOW_TOOLS = ["lookup_order"];

async function handleToolCalls(ws, toolCalls, iteration, controller, assistantText) {
  const state = stateFor(ws);
  if (controller.signal.aborted || state.closed) return;
  if (iteration >= MAX_TOOL_ITERATIONS || toolCalls.length === 0) {
    sendText(ws, "I'm having trouble processing that. Can you try rephrasing?", true);
    return;
  }

  if (toolCalls.some(tc => SLOW_TOOLS.includes(tc.function.name))) {
    sendText(ws, "One moment while I look that up...", true);
  }

  const assistantToolCall = {
    role: "assistant",
    content: assistantText || null,
    tool_calls: toolCalls.map(tc => ({
      id: tc.id,
      type: "function",
      function: { name: tc.function.name, arguments: tc.function.arguments }
    }))
  };
  const toolMessages = [];

  for (const toolCall of toolCalls) {
    if (controller.signal.aborted || state.closed) return;
    const fnName = toolCall.function.name;
    let result;
    try {
      const fnArgs = JSON.parse(toolCall.function.arguments);
      console.log("Tool call:", fnName, fnArgs);
      const handler = toolHandlers[fnName];
      result = handler
        ? await handler(fnArgs, ws)
        : { error: "Unknown tool: " + fnName };
    } catch (err) {
      console.error("Tool error (" + fnName + "):", err.message);
      result = { error: "Tool failed: " + err.message };
    }

    if (controller.signal.aborted || state.closed) return;
    toolMessages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(result)
    });
  }

  if (!controller.signal.aborted && !state.closed) {
    state.conversationHistory.push(assistantToolCall, ...toolMessages);
    await streamResponse(ws, iteration + 1);
  }
}`,
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "Three things the OpenAI API is strict about: include the assistant's `tool_calls` message in history (use `content: null` if it said no words); give every tool call a `role: \"tool\"` response even when it errors; and make the tool response `content` a string such as `JSON.stringify(result)`, not a raw object.",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      code: `// Send a filler message for slow tools. Add any tool name that
// routinely takes more than ~500ms so the caller hears something
// instead of dead air while the lookup runs.
const SLOW_TOOLS = ["lookup_order"];

async function handleToolCalls(ws, toolCalls, iteration = 0) {
  const hasSlowTool = toolCalls.some(
    tc => SLOW_TOOLS.includes(tc.function.name)
  );

  if (hasSlowTool) {
    sendText(ws, "One moment while I look that up...", true);
  }

  // ... rest of the function
}`,
    },

    {
      type: "solution",
      audience: "builder",
      explanation:
        "Both files at the end of this step. `tool-handlers.js` is unchanged from the previous step. In `server.js`, the new `streamResponse` passes `tools` to OpenAI and accumulates tool-call deltas; `handleToolCalls` runs each handler and sends its result back to the model. `handlePrompt` and the per-caller state from Chapter 4 remain in place. Keep your persona, language, speech model, greeting, and other settings when copying. For the bilingual path, this `/twiml` example leaves out a fixed voice and TTS provider so Twilio selects its English or Spanish default; restore a custom voice only after verifying it in both languages. `MAX_TOOL_ITERATIONS` bounds recursion and `SLOW_TOOLS` triggers a filler message during slow lookups.",
      files: [
        {
          file: "tool-handlers.js",
          language: "javascript",
          code: `const tools = [
  {
    type: "function",
    function: {
      name: "check_weather",
      description: "Get the current weather for a given city. " +
        "Use when the caller asks about weather, temperature, " +
        "or conditions in a specific location.",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "The city name, e.g. 'San Francisco' or 'New York'"
          },
          unit: {
            type: "string",
            enum: ["fahrenheit", "celsius"],
            description: "Temperature unit (defaults to fahrenheit)"
          }
        },
        required: ["city"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "lookup_order",
      description: "Look up the status of a customer order by order ID. " +
        "Use when the caller asks about an order, shipment, or delivery.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order ID, e.g. '123'"
          }
        },
        required: ["order_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "tell_joke",
      description: "Tell the caller a short, friendly joke. " +
        "Use when the caller asks for a joke, wants to laugh, or asks you to be funny.",
      parameters: { type: "object", properties: {} }
    }
  }
];

const toolHandlers = {
  check_weather: async ({ city, unit = "fahrenheit" }, _ws) => {
    const mockWeather = {
      "san francisco": { temp: 60, condition: "sunny", humidity: 45 },
      "new york": { temp: 55, condition: "cloudy", humidity: 72 },
      "seattle": { temp: 48, condition: "rainy", humidity: 88 },
    };
    const weather = mockWeather[city.toLowerCase()];
    if (!weather) {
      return { error: "Weather data not available for " + city };
    }
    const temp = unit === "celsius"
      ? Math.round((weather.temp - 32) * 5 / 9)
      : weather.temp;
    return {
      city, temperature: temp, unit,
      condition: weather.condition,
      humidity: weather.humidity + "%"
    };
  },

  lookup_order: async ({ order_id }, _ws) => {
    const mockOrders = {
      "123": { status: "shipped", tracking: "1Z999AA10123456784", eta: "tomorrow" },
      "456": { status: "processing", tracking: null, eta: "not available yet" },
      "789": { status: "delivered", tracking: "1Z999AA10987654321", eta: "already delivered" },
    };
    const order = mockOrders[order_id];
    if (!order) {
      return { error: \`"\${order_id}" is not in the workshop mock data. Supported order numbers: 123, 456, or 789.\` };
    }
    return { order_id, ...order };
  },

  tell_joke: async (_args, _ws) => {
    const jokes = [
      "Why did the phone break up with the WebSocket? It just could not handle the constant connection.",
      "I asked Twilio how it handles rejection. It said, 'I just send another SMS.'",
      "Why did the developer go broke? Because they used up all their cache.",
      "A SQL query walks into a bar, goes up to two tables and asks: can I join you?"
    ];
    return { joke: jokes[Math.floor(Math.random() * jokes.length)] };
  }
};

module.exports = { tools, toolHandlers };`,
        },
        {
          file: "server.js",
          language: "javascript",
          code: `require("dotenv").config();
const { WebSocketServer } = require("ws");
const http = require("http");
const OpenAI = require("openai");
const twilio = require("twilio");
const { tools, toolHandlers } = require("./tool-handlers.js");

const PORT = 8080;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const SYSTEM_PROMPT = \`You are a helpful voice assistant for Twilio-Mart.
Keep your responses brief -- one to two sentences at most.
Speak naturally and conversationally.
Never use markdown, bullet points, or numbered lists.
If you don't know something, say so honestly.

LANGUAGE DETECTION:
- You can speak English and Spanish fluently.
- If the caller asks to switch languages, answer in the requested language
  on your next response, even when the request was spoken in English.
- If the caller switches to a different language, respond in that language.
- When you detect a language switch, include the marker [LANG:xx-XX]
  at the very beginning of your response, where xx-XX is the BCP-47
  language code (e.g., [LANG:es-ES] for Spanish, [LANG:en-US] for English).
- Only include the marker when the language CHANGES, not on every message.\`;

const SILENCE_TIMEOUT_MS = 8000;
const MAX_SILENCE_PROMPTS = 2;
const MAX_TOOL_ITERATIONS = 5;
const SLOW_TOOLS = ["lookup_order"];
const FAREWELL_DELAY_MS = 6000;

const LANG_MARKER_REGEX = /^\\[LANG:([\\w-]+)\\]/;

const callStates = new WeakMap();

function stateFor(ws) {
  let state = callStates.get(ws);
  if (!state) {
    state = {
      conversationHistory: [{ role: "system", content: SYSTEM_PROMPT }],
      activeStream: null,
      closed: false,
      silenceTimer: null,
      endTimer: null,
      silencePromptCount: 0,
      currentLanguage: null,
    };
    callStates.set(ws, state);
  }
  return state;
}

function sendText(ws, token, last = false) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: "text", token, last }));
}

async function streamResponse(ws, iteration = 0) {
  const state = stateFor(ws);
  state.activeStream?.abort();
  const controller = new AbortController();
  state.activeStream = controller;
  clearTimeout(state.silenceTimer);
  state.silenceTimer = null;

  try {
    const stream = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4-nano",
      messages: state.conversationHistory,
      tools,
      stream: true,
    }, { signal: controller.signal });

    if (controller.signal.aborted || state.closed) return;
    let textBuffer = "";
    let fullAssistantText = "";
    const toolCalls = [];

    for await (const chunk of stream) {
      if (controller.signal.aborted || state.closed) return;
      const delta = chunk.choices?.[0]?.delta;
      const finishReason = chunk.choices?.[0]?.finish_reason;

      if (delta?.content) {
        textBuffer += delta.content;
        fullAssistantText += delta.content;
        let match;
        while ((match = textBuffer.match(/[.!?](\\s|$)/))) {
          const sentenceEnd = match.index + 1;
          processLLMResponse(ws, textBuffer.slice(0, sentenceEnd));
          textBuffer = textBuffer.slice(sentenceEnd + (match[1] ? match[1].length : 0));
        }
      }

      for (const tc of delta?.tool_calls || []) {
        if (tc.index === undefined) continue;
        if (!toolCalls[tc.index]) {
          toolCalls[tc.index] = {
            id: tc.id || "",
            function: { name: "", arguments: "" }
          };
        }
        if (tc.id) toolCalls[tc.index].id = tc.id;
        if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
      }

      if (finishReason === "tool_calls") {
        if (textBuffer.trim()) processLLMResponse(ws, textBuffer.trim());
        if (fullAssistantText.trim()) sendText(ws, "", true);
        await handleToolCalls(ws, toolCalls.filter(Boolean), iteration, controller, fullAssistantText.trim());
        return;
      }

      if (finishReason === "stop") {
        if (textBuffer.trim()) processLLMResponse(ws, textBuffer.trim());
        sendText(ws, "", true);
        if (fullAssistantText.trim()) {
          state.conversationHistory.push({ role: "assistant", content: fullAssistantText.trim() });
        }
        return;
      }
    }

    if (textBuffer.trim()) processLLMResponse(ws, textBuffer.trim());
    if (fullAssistantText.trim()) {
      sendText(ws, "", true);
      state.conversationHistory.push({ role: "assistant", content: fullAssistantText.trim() });
    }
  } catch (err) {
    if (controller.signal.aborted || err.name === "AbortError" || state.closed) return;
    console.error("LLM error:", err.message);
    const apology = "I'm sorry, I'm having a technical issue. Could you say that again?";
    sendText(ws, apology, true);
    state.conversationHistory.push({ role: "assistant", content: apology });
  } finally {
    if (state.activeStream === controller) {
      state.activeStream = null;
      resetSilenceTimer(ws);
    }
  }
}

async function handleToolCalls(ws, toolCalls, iteration, controller, assistantText) {
  const state = stateFor(ws);
  if (controller.signal.aborted || state.closed) return;
  if (iteration >= MAX_TOOL_ITERATIONS || toolCalls.length === 0) {
    sendText(ws, "I'm having trouble processing that. Can you try rephrasing?", true);
    return;
  }

  if (toolCalls.some(tc => SLOW_TOOLS.includes(tc.function.name))) {
    sendText(ws, "One moment while I look that up...", true);
  }

  const assistantToolCall = {
    role: "assistant",
    content: assistantText || null,
    tool_calls: toolCalls.map(tc => ({
      id: tc.id,
      type: "function",
      function: { name: tc.function.name, arguments: tc.function.arguments }
    }))
  };
  const toolMessages = [];

  for (const toolCall of toolCalls) {
    if (controller.signal.aborted || state.closed) return;
    const fnName = toolCall.function.name;
    let result;
    try {
      const fnArgs = JSON.parse(toolCall.function.arguments);
      console.log("Tool call:", fnName, fnArgs);
      const handler = toolHandlers[fnName];
      result = handler
        ? await handler(fnArgs, ws)
        : { error: "Unknown tool: " + fnName };
    } catch (err) {
      console.error("Tool error (" + fnName + "):", err.message);
      result = { error: "Tool failed: " + err.message };
    }

    if (controller.signal.aborted || state.closed) return;
    toolMessages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(result)
    });
  }

  if (!controller.signal.aborted && !state.closed) {
    state.conversationHistory.push(assistantToolCall, ...toolMessages);
    await streamResponse(ws, iteration + 1);
  }
}

function handlePrompt(ws, msg) {
  const state = stateFor(ws);
  if (!state.currentLanguage && typeof msg.lang === "string" && msg.lang) {
    state.currentLanguage = msg.lang;
  }
  state.conversationHistory.push({ role: "user", content: msg.voicePrompt });
  streamResponse(ws);
}

function handleInterrupt(ws, msg) {
  console.log("Caller interrupted. Heard:", msg.utteranceUntilInterrupt);

  const state = stateFor(ws);
  state.activeStream?.abort();
  state.activeStream = null;

  const lastMsg = state.conversationHistory[state.conversationHistory.length - 1];
  if (lastMsg?.role === "assistant") {
    lastMsg.content = msg.utteranceUntilInterrupt;
  } else if (msg.utteranceUntilInterrupt) {
    state.conversationHistory.push({
      role: "assistant", content: msg.utteranceUntilInterrupt
    });
  }
}

function handleDtmfInput(ws, digit) {
  switch (digit) {
    case "1":
      stateFor(ws).conversationHistory.push({
        role: "user",
        content: "I want to check my order status.",
      });
      streamResponse(ws);
      break;

    case "2":
      sendText(ws, "Let me transfer you to a representative. " +
        "Please hold for a moment.", true);
      // Chapter 5 adds the actual transfer handoff.
      break;

    case "0":
      sendText(ws, "Returning to the main menu. " +
        "Press 1 for order status, 2 for a representative, " +
        "or just tell me what you need.", true);
      break;

    default:
      sendText(ws, "I didn't recognize that option. " +
        "Press 1 for order status, or 2 for a representative.", true);
      break;
  }
}

// Send DTMF tones outbound when another IVR needs them.
function sendDigits(ws, digits) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: "sendDigits", digits }));
}

function processLLMResponse(ws, text) {
  const state = stateFor(ws);
  text = text.trimStart();
  const match = text.match(LANG_MARKER_REGEX);
  if (match) {
    const newLang = match[1];
    if (newLang !== state.currentLanguage && !state.closed && ws.readyState === 1) {
      console.log("Switching language: " + state.currentLanguage + " -> " + newLang);
      state.currentLanguage = newLang;
      ws.send(JSON.stringify({
        type: "language",
        ttsLanguage: newLang,
        transcriptionLanguage: newLang,
      }));
    }
    text = text.replace(LANG_MARKER_REGEX, "").trim();
  }
  if (text) sendText(ws, text);
}

function resetSilenceTimer(ws) {
  const state = stateFor(ws);
  clearTimeout(state.silenceTimer);
  clearTimeout(state.endTimer);
  state.silenceTimer = null;
  state.endTimer = null;
  if (state.closed || state.activeStream || ws.readyState !== 1) return;
  state.silencePromptCount = 0;
  state.silenceTimer = setTimeout(() => handleSilence(ws), SILENCE_TIMEOUT_MS);
}

function handleSilence(ws) {
  const state = stateFor(ws);
  if (state.closed || ws.readyState !== 1) return;
  state.silenceTimer = null;
  state.silencePromptCount++;

  const prompts = [
    "Are you still there? Take your time -- I'm here whenever you're ready.",
    "I'm still here if you need anything. Is there something I can help with?",
  ];
  if (state.silencePromptCount <= MAX_SILENCE_PROMPTS) {
    sendText(ws, prompts[state.silencePromptCount - 1], true);
    state.silenceTimer = setTimeout(() => handleSilence(ws), SILENCE_TIMEOUT_MS);
    return;
  }

  sendText(ws, "I'll end the call now. Please call back anytime.", true);
  state.endTimer = setTimeout(() => {
    if (state.closed || ws.readyState !== 1) return;
    state.closed = true;
    ws.send(JSON.stringify({ type: "end" }));
  }, FAREWELL_DELAY_MS);
}

function handleMessage(ws, data) {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch (err) {
    console.error("Invalid Conversation Relay message:", err.message);
    return;
  }
  if (!msg || typeof msg !== "object" || stateFor(ws).closed) return;

  switch (msg.type) {
    case "setup":
      console.log("Call started:", msg.callSid);
      resetSilenceTimer(ws);
      break;

    case "prompt":
      resetSilenceTimer(ws);
      if (msg.last !== false && typeof msg.voicePrompt === "string") handlePrompt(ws, msg);
      break;

    case "interrupt":
      handleInterrupt(ws, msg);
      resetSilenceTimer(ws);
      break;

    case "dtmf":
      resetSilenceTimer(ws);
      console.log("DTMF received:", msg.digit);
      handleDtmfInput(ws, msg.digit);
      break;

    default:
      console.log("Unhandled message type:", msg.type);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/twiml" && req.method === "POST") {
    const twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="wss://\${req.headers.host}/ws"
      language="en-US"
      transcriptionProvider="Deepgram"
      speechModel="nova-3-general"
      welcomeGreeting="Hello! How can I help you today?"
      dtmfDetection="true"
      interruptible="any"
      interruptSensitivity="medium"
      reportInputDuringAgentSpeech="any"
    />
  </Connect>
</Response>\`;

    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml);
    return;
  }

  if (req.url === "/call" && req.method === "POST") {
    try {
      const call = await twilioClient.calls.create({
        to: process.env.MY_PHONE_NUMBER,
        from: process.env.TWILIO_PHONE_NUMBER,
        url: \`https://\${req.headers.host}/twiml\`,
      });

      console.log("Call initiated:", call.sid);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ callSid: call.sid }));
    } catch (error) {
      console.error("Call error:", error.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket server is running");
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("New WebSocket connection");

  ws.on("message", (data) => handleMessage(ws, data));

  ws.on("close", () => {
    const state = stateFor(ws);
    state.closed = true;
    state.activeStream?.abort();
    clearTimeout(state.silenceTimer);
    clearTimeout(state.endTimer);
    console.log("Call ended, timers cleared.");
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
});

server.listen(PORT, () => {
  console.log(\`Server listening on port \${PORT}\`);
});`,
        },
      ],
    },

    {
      type: "deep-dive",
      audience: "builder",
      title: "Parallel vs. sequential tool execution",
      content:
        "When the LLM requests multiple tool calls in a single response, you can execute them in parallel using `Promise.all` for better performance. However, be careful if tools have dependencies on each other -- in that case, the LLM should make them in separate requests, but it does not always do so.\n\nFor most voice AI use cases, sequential execution is fine because the latency difference is small compared to the overall conversation pace. Optimize for correctness first, then speed.",
    },
  ],
} satisfies StepDefinition;
