import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "section", title: "Interruption Handling" },

    { type: "diagram", variant: "architecture", highlight: "websocket", showTools: true },

    {
      type: "concept-card",
      audience: "explorer",
      title: "Why Barge-In Matters",
      content:
        "Real conversations aren't turn-based. People cut each other off, change their mind mid-sentence, and repeat themselves when they feel unheard. If a voice agent insists on finishing every sentence before listening, it feels robotic fast. Barge-in is the feature that lets the caller interrupt at any moment -- without it, the agent feels robotic even if everything else is right.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Real conversations are messy. People interrupt, change their minds mid-sentence, and talk over each other. A great voice agent handles all of this gracefully. Conversation Relay has built-in **barge-in** support -- when a caller speaks while the AI is still talking, Twilio detects it, stops the AI mid-sentence, and sends a WebSocket message describing what happened.",
    },

    { type: "section", title: "How Barge-In Works", audience: "builder" },

    {
      type: "prose",
      audience: "explorer",
      content:
        "When a caller interrupts, the system immediately stops the AI's voice, notes how much the caller actually heard, and then processes whatever the caller said next. The conversation picks up from there.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Here is the flow when a caller interrupts:\n\n1. The AI agent is speaking to the caller.\n2. The caller starts talking before the agent finishes.\n3. Twilio immediately stops the agent's voice and sends an `interrupt` message over the WebSocket.\n4. The server cancels the in-flight LLM stream so it stops generating text nobody will hear.\n5. Twilio sends the caller's new speech as a `prompt` message, and the conversation continues from there.",
    },

    { type: "page-break" },

    { type: "section", title: "The Interrupt Message", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "When barge-in occurs, Conversation Relay sends this message over the WebSocket:",
    },

    {
      type: "json-message",
      audience: "builder",
      direction: "inbound",
      messageType: "interrupt",
      code: `{
  "type": "interrupt",
  "utteranceUntilInterrupt": "I can help you with your order. Let me",
  "durationUntilInterruptMs": 2340
}`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "`utteranceUntilInterrupt` tells you exactly how much of the AI's response the caller heard before they cut in. The AI needs this so it doesn't reference something it said but the caller never heard.",
    },

    {
      type: "deep-dive",
      audience: "builder",
      title: "Why utteranceUntilInterrupt matters",
      content:
        "If you do not trim the assistant message in your conversation history, the LLM will think the caller heard the entire response. This leads to confusing exchanges where the AI references information it never actually delivered. By replacing the assistant message content with `utteranceUntilInterrupt`, you give the LLM an accurate picture of the conversation so far.\n\nSome advanced implementations also add a system note like \"[caller interrupted here]\" to help the LLM understand the context shift.",
    },

    { type: "page-break" },

    { type: "section", title: "Handling the Interrupt", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "When the caller interrupts, the server needs to stop that call's AI reply and record only what the caller heard. The handler functions can live at module scope, but each WebSocket needs its own conversation history and AbortController. `stateFor(ws)` below keeps that state separate for each call.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "**This step replaces the old streaming and message handlers.** Delete the per-connection `callSid` and `conversationHistory`, the old `streamLLMResponse`, and the old `ws.on(\"message\", ...)` switch. Keep `sendText(ws, token, last = false)`. Put the helper code below **after your existing `SYSTEM_PROMPT` declaration** and before `http.createServer`; `stateFor(ws)` will create a fresh history when each call arrives. Then replace your existing `wss.on(\"connection\", ...)` callback with the second snippet below; its old close handler still references the deleted `callSid`. Keep your existing voice and transcription attributes in `/twiml` when adding the interruption attributes.",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["1-15", "17-50", "52-76"],
      code: `const callStates = new WeakMap();

function stateFor(ws) {
  let state = callStates.get(ws);
  if (!state) {
    state = {
      conversationHistory: [{ role: "system", content: SYSTEM_PROMPT }],
      activeStream: null,
      closed: false,
    };
    callStates.set(ws, state);
  }
  return state;
}

// DTMF and tool calls can also invoke this after adding a user turn.
async function streamResponse(ws) {
  const state = stateFor(ws);
  state.activeStream?.abort();
  const controller = new AbortController();
  state.activeStream = controller;

  try {
    const stream = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4-nano",
      messages: state.conversationHistory,
      stream: true,
    }, { signal: controller.signal });

    if (controller.signal.aborted || state.closed) return;
    let assistantText = "";
    for await (const chunk of stream) {
      if (controller.signal.aborted || state.closed) return;
      const token = chunk.choices[0]?.delta?.content ?? "";
      if (token) {
        assistantText += token;
        sendText(ws, token);
      }
    }
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
  stateFor(ws).conversationHistory.push({ role: "user", content: msg.voicePrompt });
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
    case "interrupt":
      handleInterrupt(ws, msg);
      break;

    case "prompt":
      if (msg.last !== false && typeof msg.voicePrompt === "string") handlePrompt(ws, msg);
      break;

    // ... other message types
  }
}`,
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["3-9"],
      code: `wss.on("connection", (ws) => {
  console.log("New WebSocket connection");
  ws.on("message", (data) => handleMessage(ws, data));
  ws.on("close", () => {
    const state = stateFor(ws);
    state.closed = true;
    state.activeStream?.abort();
    console.log("Call ended");
  });
  ws.on("error", (err) => console.error("WebSocket error:", err));
});`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "The `prompt` branch keeps the Chapter 3 final-transcript check: Conversation Relay can send interim `prompt` messages with `last: false`, and only the final transcript should start an LLM reply.",
    },

    { type: "page-break" },

    { type: "section", title: "Interruption Settings", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Interruption behavior is controlled through attributes on the Conversation Relay TwiML element. Add the two interruption attributes to your existing `/twiml` response, keeping the voice and transcription choices you made in Chapter 3:",
    },

    {
      type: "code",
      audience: "builder",
      language: "xml",
      file: "twiml-response",
      highlight: [11, 12],
      code: `<Response>
  <Connect>
    <ConversationRelay
      url="wss://<your-server-host>/ws"
      voice="21m00Tcm4TlvDq8ikWAM"
      ttsProvider="ElevenLabs"
      language="en-US"
      transcriptionProvider="Deepgram"
      speechModel="nova-3-general"
      welcomeGreeting="Hello! How can I help you today?"
      interruptible="any"
      reportInputDuringAgentSpeech="any"
    />
  </Connect>
</Response>`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "The `interruptible` attribute accepts four values:\n\n**`\"any\"`** (the default) -- both voice and DTMF keypresses interrupt. **`\"speech\"`** -- only voice interrupts, keypresses are silently collected. **`\"dtmf\"`** -- only keypresses interrupt. **`\"none\"`** -- the AI always finishes speaking before accepting new input (useful for legal disclaimers or important announcements).\n\n`reportInputDuringAgentSpeech=\"any\"` tells Twilio to forward speech and keypresses to your server even while the agent is talking. Without it, the default (`\"none\"` as of May 2025) silently drops mid-speech input, so your interrupt and DTMF handlers never fire.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "tip",
      content:
        'Keep `interruptible` set to `"any"` (the default) for natural conversation flow. Use `"none"` only for specific messages where the caller must hear the full content.',
    },

    {
      type: "callout",
      audience: "builder",
      variant: "info",
      content:
        "**Keep your Chapter 3 choices.** The complete solution below shows the example `SYSTEM_PROMPT`, voice, greeting, language, and transcription settings. If you customized any of these, carry your own values into the solution when replacing `server.js`. The new interruption logic does not require you to reset your agent's identity.",
    },

    {
      type: "solution",
      audience: "builder",
      file: "server.js",
      language: "javascript",
      explanation:
        "The complete server after this refactor: each WebSocket gets its own conversation history and AbortController through `stateFor(ws)`. `streamResponse` replaces `streamLLMResponse`, catches OpenAI errors, and works with the new prompt and interrupt handlers. The `/twiml` values shown are Chapter 3 examples; preserve your own voice, greeting, language, and transcription values if you changed them.",
      code: `require("dotenv").config();
const { WebSocketServer } = require("ws");
const http = require("http");
const OpenAI = require("openai");
const twilio = require("twilio");

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
If you don't know something, say so honestly.\`;

const callStates = new WeakMap();

function stateFor(ws) {
  let state = callStates.get(ws);
  if (!state) {
    state = {
      conversationHistory: [{ role: "system", content: SYSTEM_PROMPT }],
      activeStream: null,
      closed: false,
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
      model: process.env.OPENAI_MODEL || "gpt-5.4-nano",
      messages: state.conversationHistory,
      stream: true,
    }, { signal: controller.signal });

    if (controller.signal.aborted || state.closed) return;
    let assistantText = "";
    for await (const chunk of stream) {
      if (controller.signal.aborted || state.closed) return;
      const token = chunk.choices[0]?.delta?.content ?? "";
      if (token) {
        assistantText += token;
        sendText(ws, token);
      }
    }
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
  stateFor(ws).conversationHistory.push({ role: "user", content: msg.voicePrompt });
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
      break;

    case "prompt":
      if (msg.last !== false && typeof msg.voicePrompt === "string") handlePrompt(ws, msg);
      break;

    case "interrupt":
      handleInterrupt(ws, msg);
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
      interruptible="any"
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
    console.log("Call ended");
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
} satisfies StepDefinition;
