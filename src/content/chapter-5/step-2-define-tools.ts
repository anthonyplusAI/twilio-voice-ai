import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "section", title: "Define Tools" },

    {
      type: "concept-card",
      audience: "explorer",
      title: "Describing Tools So the AI Understands",
      content:
        "You don't teach the AI a tool by showing it code -- you describe it in plain English: what it does, when to use it, and what information it needs. The AI uses that description to pick the right tool at the right moment. A clear description is everything; a vague one makes the agent guess wrong.",
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "Each tool has a short description that tells the AI what it does and what information it needs. Think of it like writing a name tag and instruction card for each tool so the AI knows which one to grab.",
    },

    {
      type: "image",
      audience: "explorer",
      src: "/images/illustrations/grid-icon.svg",
      alt: "A grid of labeled tiles — the tool catalog the AI browses to pick the right tool for the job.",
      size: "md",
    },

    { type: "page-break", audience: "explorer" },

    { type: "section", title: "Pick Your Agent's Tools", audience: "explorer" },

    {
      type: "prose",
      audience: "explorer",
      content:
        "Your agent comes with three ready-made tools. Turn them on or off below, then listen to how the agent behaves on your next test call. With a tool turned off, the agent has to admit it cannot help with that kind of question.",
    },

    { type: "tool-picker", audience: "explorer" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Each tool is described in a JSON schema that tells the AI what it does, what parameters it needs, and when to use it. The AI reads these descriptions to decide which tool to call.",
    },

    { type: "section", title: "Tool Schema Format", audience: "builder" },

    {
      type: "callout",
      audience: "builder",
      variant: "info",
      content:
        "Create a new file `tool-handlers.js` in the same folder as `server.js`. We'll build it up in two passes: first the `tools` schema array (below), then the `toolHandlers` dispatch map. Everything exported from this one file so `server.js` can `require(\"./tool-handlers.js\")` on the next page.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Each tool definition follows this structure:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "tool-handlers.js",
      code: `const tools = [
  {
    type: "function",
    function: {
      name: "check_weather",
      description: "Get the current weather for a given city. " +
        "Use this when the caller asks about weather conditions.",
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
            description: "Temperature unit preference"
          }
        },
        required: ["city"]
      }
    }
  }
];`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "The description fields are critical. The AI reads them to decide when to use each tool and what information to provide. Vague descriptions lead to the AI picking the wrong tool, so be specific and include examples.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "tip",
      content:
        "Write tool descriptions as if you are explaining the tool to a new teammate. Include when to use it, what it returns, and any constraints. The better the description, the more accurately the AI will use the tool.",
    },

    { type: "page-break" },

    { type: "section", title: "Adding More Tools", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "**Replace the first `const tools = [...]` block in `tool-handlers.js` with this expanded array.** It keeps the weather tool and adds order lookup and a joke. Do not paste it below the first array; declaring `const tools` twice in one file causes a syntax error.",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "tool-handlers.js",
      highlight: ["19-53"],
      code: `const tools = [
  {
    type: "function",
    function: {
      name: "check_weather",
      description: "Get the current weather for a given city.",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "The city name"
          },
          unit: {
            type: "string",
            enum: ["fahrenheit", "celsius"],
            description: "Temperature unit preference"
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
        "Use this when the caller asks about an order, shipment, " +
        "or delivery status.",
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
        "Use when the caller asks for a joke, wants to laugh, " +
        "or asks you to be funny.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  }
];`,
    },

    { type: "page-break" },

    { type: "section", title: "Implementing the Tool Functions", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Now create the actual functions that run when the AI asks for a tool. For this workshop, we use sample data, but in a real product these would connect to actual services:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "tool-handlers.js",
      code: `// Map of tool name -> handler function
// Every handler accepts (args, ws). Most only use args; transfer_to_agent
// (added later) also uses ws to send an "end" message mid-call.
const toolHandlers = {
  // The schema also declares a "unit" parameter (fahrenheit|celsius);
  // this teaching version ignores it for clarity. The solution at the
  // bottom of the step wires unit conversion in.
  check_weather: async ({ city }, _ws) => {
    // In production: call a real weather API
    const mockWeather = {
      "san francisco": { temp: 60, condition: "sunny", humidity: 45 },
      "new york": { temp: 55, condition: "cloudy", humidity: 72 },
      "seattle": { temp: 48, condition: "rainy", humidity: 88 },
    };

    const weather = mockWeather[city.toLowerCase()];
    if (!weather) {
      return { error: "Weather data not available for " + city };
    }
    return {
      city,
      temperature: weather.temp,
      condition: weather.condition,
      humidity: weather.humidity + "%"
    };
  },

  lookup_order: async ({ order_id }, _ws) => {
    // In production: query your orders database
    const mockOrders = {
      "123": {
        status: "shipped",
        tracking: "1Z999AA10123456784",
        eta: "tomorrow"
      },
      "456": {
        status: "processing",
        tracking: null,
        eta: "not available yet"
      },
      "789": {
        status: "delivered",
        tracking: "1Z999AA10987654321",
        eta: "already delivered"
      }
    };

    const order = mockOrders[order_id];
    if (!order) {
      return { error: \`"\${order_id}" is not in the workshop mock data. Supported order numbers: 123, 456, or 789.\` };
    }
    return { order_id, ...order };
  },

  // Simplest possible tool: no parameters, returns a random string.
  // Good template for any zero-input action (random fact, quote of the day, etc).
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
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "Always return a result from your tool functions, even on error. If a function crashes without returning anything, the AI will not know what happened and may fabricate an answer. Return an error message like `{ error: \"Not found\" }` so the AI can tell the caller what went wrong.",
    },

    { type: "section", title: "Passing Tools to OpenAI", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Inside your existing `streamResponse`, keep its per-caller `state` and include the tools list in every request to the AI:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: [4],
      code: `const stream = await openai.chat.completions.create({
  model: "gpt-5.4-nano",
  messages: state.conversationHistory,
  tools,
  stream: true,
}, { signal: controller.signal });`,
    },

    {
      type: "solution",
      audience: "builder",
      explanation:
        "`tool-handlers.js` holds the `tools` schema plus the `toolHandlers` dispatch map and exports both. `server.js` requires that module and passes the `tools` array into every `openai.chat.completions.create` call. Switch between the two files with the tabs above the code. When copying this complete example, keep your chosen `<ConversationRelay>` settings from Chapter 3, including voice, provider, language, speech model, and welcome greeting; the `/twiml` values shown here are defaults.\n\nHeads-up on the `streamResponse` function in this solution: it is the baseline for this page only. The next page replaces it with a tool-aware version that handles tool calls and recursion. Do not invest time polishing this version -- you will overwrite it next.",
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
const { tools } = require("./tool-handlers.js");

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
- If the caller switches to a different language, respond in that language.
- When you detect a language switch, include the marker [LANG:xx-XX]
  at the very beginning of your response, where xx-XX is the BCP-47
  language code (e.g., [LANG:es-ES] for Spanish, [LANG:en-US] for English).
- Only include the marker when the language CHANGES, not on every message.\`;

const SILENCE_TIMEOUT_MS = 8000;
const MAX_SILENCE_PROMPTS = 2;
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

async function streamResponse(ws) {
  const state = stateFor(ws);
  state.activeStream?.abort();
  const controller = new AbortController();
  state.activeStream = controller;

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: state.conversationHistory,
      tools,
      stream: true,
    }, { signal: controller.signal });

    if (controller.signal.aborted || state.closed) return;
    let textBuffer = "";
    let assistantText = "";
    for await (const chunk of stream) {
      if (controller.signal.aborted || state.closed) return;
      const token = chunk.choices[0]?.delta?.content ?? "";
      if (!token) continue;
      textBuffer += token;
      assistantText += token;

      // Inspect whole sentences so a [LANG:xx-XX] marker is never spoken.
      let match;
      while ((match = textBuffer.match(/[.!?](\\s|$)/))) {
        const sentenceEnd = match.index + 1;
        processLLMResponse(ws, textBuffer.slice(0, sentenceEnd));
        textBuffer = textBuffer.slice(sentenceEnd + (match[1] ? match[1].length : 0));
      }
    }
    if (textBuffer.trim()) processLLMResponse(ws, textBuffer.trim());
    sendText(ws, "", true);
    state.conversationHistory.push({ role: "assistant", content: assistantText });
  } catch (err) {
    if (controller.signal.aborted || err.name === "AbortError" || state.closed) return;
    console.error("LLM error:", err.message);
    const apology = "I'm sorry, I'm having a technical issue. Could you say that again?";
    sendText(ws, apology, true);
    state.conversationHistory.push({ role: "assistant", content: apology });
  } finally {
    if (state.activeStream === controller) state.activeStream = null;
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
  if (state.closed || ws.readyState !== 1) return;
  state.silencePromptCount = 0;
  state.endTimer = null;
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
      resetSilenceTimer(ws);
      handleInterrupt(ws, msg);
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
      voice="21m00Tcm4TlvDq8ikWAM"
      ttsProvider="ElevenLabs"
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
      title: "How many tools should you define?",
      content:
        "There is no hard limit, but more tools means more token usage (each tool definition is included in the prompt) and more potential for the LLM to pick the wrong one. For voice AI, keep it focused: 3-8 tools that cover your core use case. If you find yourself defining 20+ tools, consider grouping related functionality into fewer, more general tools.",
    },
  ],
} satisfies StepDefinition;
