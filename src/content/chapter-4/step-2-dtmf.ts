import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "section", title: "DTMF Detection", audience: "builder" },
    { type: "section", title: "The Keypad Still Matters", audience: "explorer" },

    {
      type: "concept-card",
      audience: "explorer",
      title: "Keypad = Accessibility + Accuracy",
      content:
        "DTMF (**D**ual-**T**one **M**ulti-**F**requency) is the old-school phone keypad -- the beeps when you press 1, 2, 3. It's still the most reliable way to capture exact info: credit card digits, account numbers, a menu selection in a noisy room. Supporting the keypad alongside natural speech makes the agent work for callers who can't speak (or just shouldn't, in a meeting) without losing the conversational feel for everyone else.",
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "**Heads up: the keypad shortcuts are fixed in this workshop** -- **1** = check order, **2** = transfer, **0** = repeat menu. They stay the same regardless of which persona you picked in Ch3, so don't expect the topic to match your agent's flavor. When a caller presses keys on their phone, Twilio detects the tone and tells the AI which key was pressed -- that's what lets the agent offer menu options like \"press 1 for support\" alongside normal conversation.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "When a caller presses keys on their phone keypad (like \"press 1 for support\"), those are **DTMF** (**D**ual-**T**one **M**ulti-**F**requency) tones -- the two-tone beeps the phone system has used since the 1960s to signal digits across the line. Twilio detects these keypresses and sends a WebSocket message with the digit, so you can build menu options alongside the AI conversation.",
    },

    {
      type: "image",
      src: "/images/illustrations/woman-looking-at-phone.svg",
      alt: "A person looking at their phone's keypad — the everyday moment of tapping a digit to answer a menu prompt.",
      size: "md",
    },

    { type: "page-break" },

    { type: "section", title: "Receiving DTMF Input", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "When a caller presses a key, Conversation Relay sends a `dtmf` message:",
    },

    {
      type: "json-message",
      audience: "builder",
      direction: "inbound",
      messageType: "dtmf",
      code: `{
  "type": "dtmf",
  "digit": "1"
}`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Each keypress arrives as a separate message. The `digit` field contains the key that was pressed: `0`-`9`, `*`, or `#`.",
    },

    { type: "page-break" },

    { type: "section", title: "Handling DTMF in the Message Switch", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Replace your `handleMessage` with this version to add a `dtmf` case, then add `handleDtmfInput` below it. Keep the per-call `stateFor(ws)` helper from Step 1 so a keypad request enters only that caller's conversation:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["5-8", "21-48"],
      code: `function handleMessage(ws, data) {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch (err) {
    console.error("Invalid Conversation Relay message:", err.message);
    return;
  }
  if (!msg || typeof msg !== "object" || stateFor(ws).closed) return;

  switch (msg.type) {
    case "dtmf":
      console.log("DTMF received:", msg.digit);
      handleDtmfInput(ws, msg.digit);
      break;

    case "prompt":
      if (msg.last !== false && typeof msg.voicePrompt === "string") handlePrompt(ws, msg);
      break;

    case "interrupt":
      handleInterrupt(ws, msg);
      break;
  }
}

// DTMF is an always-available shortcut, not a spoken IVR. The TwiML
// welcomeGreeting introduces the agent; mention the keypad options in
// your system prompt or demo script if you want callers to know about
// them ("press 1 for order status, 2 for a representative, 0 to hear
// the menu again").
function handleDtmfInput(ws, digit) {
  switch (digit) {
    case "1":
      // Inject context into the LLM conversation
      stateFor(ws).conversationHistory.push({
        role: "user",
        content: "I want to check my order status."
      });
      streamResponse(ws);
      break;

    case "2":
      sendText(ws, "Let me transfer you to a representative. " +
        "Please hold for a moment.", true);
      // Trigger handoff (covered in Chapter 5)
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
}`,
    },

    {
      type: "callout",
      audience: "builder",
      variant: "tip",
      content:
        "A good pattern is to translate keypad inputs into natural language messages and add them to the conversation history. The AI handles the actual response while the keypad provides a shortcut for common actions.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "info",
      content:
        "**Adapting the menu to your persona.** The example uses \"check my order status\" because that is a common support flow. If you picked a different persona earlier, swap the synthetic prompt so the keypad shortcut fits your agent:\n\n- **Sam (Twilio Airways)** -- `\"Can you give me an update on my flight?\"`\n- **Ms. Chen (Twilio Grand Hotel)** -- `\"What's the status of my reservation?\"`\n- **Jake (Twilio Pizza Co.)** -- `\"Where is my pizza order?\"`\n\nOption 2 (speak to a human) and option 0 (main menu) stay the same across personas.",
    },

    { type: "page-break" },

    { type: "section", title: "Sending DTMF Tones Outbound", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "You can also send keypad tones outbound -- for example, if the AI agent needs to navigate another phone system during a call transfer (like pressing 1 for English):",
    },

    {
      type: "json-message",
      audience: "builder",
      direction: "outbound",
      messageType: "sendDigits",
      code: `{
  "type": "sendDigits",
  "digits": "1234#"
}`,
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["2-6"],
      code: `// Send DTMF tones outbound (e.g., navigating another IVR)
function sendDigits(ws, digits) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: "sendDigits", digits }));
}

// Inside an active WebSocket handler, you could call:
// sendDigits(ws, "1");  // Press 1 for English
// sendDigits(ws, "3");  // Press 3 for billing`,
    },

    { type: "section", title: "Enabling DTMF Detection", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "DTMF events only arrive on the WebSocket when you opt in. Three attributes matter: (a) `dtmfDetection=\"true\"` -- this is what tells Twilio to forward `dtmf` messages at all; without it, your handler never fires; (b) `interruptible` includes `dtmf` (or `any`), so a keypress can also stop the agent mid-sentence; (c) `reportInputDuringAgentSpeech=\"any\"` so keypresses that arrive while the agent is talking are delivered, not silently dropped. Your TwiML should look like this:",
    },

    {
      type: "code",
      audience: "builder",
      language: "xml",
      file: "twiml-response",
      code: `<!-- Keep welcomeGreeting and the Chapter 3 voice/STT settings.
     dtmfDetection is the only new attribute in this step.
     The url is filled in dynamically by your /twiml handler using
     req.headers.host — you don't hardcode the hostname. -->
<Response>
  <Connect>
    <ConversationRelay
      url="wss://<your-server-host>/ws"
      voice="21m00Tcm4TlvDq8ikWAM"
      ttsProvider="ElevenLabs"
      language="en-US"
      transcriptionProvider="Deepgram"
      speechModel="nova-3-general"
      welcomeGreeting="Hello! How can I help you today?"
      dtmfDetection="true"
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
        'Setting `interruptible` to `"any"` means both speech and DTMF keypresses stop the AI from speaking. Other options are `"speech"` (voice only), `"dtmf"` (keypress only), or `"none"` (no interruptions).',
    },

    {
      type: "deep-dive",
      audience: "builder",
      title: "Collecting multi-digit input",
      content:
        "If you need to collect a multi-digit input like an account number or PIN, buffer digits separately for each call. Each keypress arrives as a separate `dtmf` message. Use a timer to detect when that caller has finished entering digits. This replaces the single-digit menu handler above when you add multi-digit collection:\n\n```javascript\nconst digitStates = new WeakMap();\n\nfunction handleDtmfInput(ws, digit) {\n  let state = digitStates.get(ws);\n  if (!state) {\n    state = { buffer: \"\", timeout: null };\n    digitStates.set(ws, state);\n  }\n  clearTimeout(state.timeout);\n\n  if (digit === \"#\") {\n    processCollectedDigits(ws, state.buffer);\n    state.buffer = \"\";\n    return;\n  }\n\n  state.buffer += digit;\n  state.timeout = setTimeout(() => {\n    processCollectedDigits(ws, state.buffer);\n    state.buffer = \"\";\n  }, 2000);\n}\n```\n\nClear `digitStates.get(ws)?.timeout` in the WebSocket close handler if you add this example.",
    },

    {
      type: "solution",
      audience: "builder",
      file: "server.js",
      language: "javascript",
      explanation:
        "Builds on the previous step by adding handleDtmfInput with a menu system, a sendDigits helper for outbound tones, and routing the dtmf message type to handleDtmfInput. DTMF is an always-available shortcut -- the welcomeGreeting already greeted the caller, so we do not auto-play a spoken menu on setup. If you replace your whole server.js with this example, preserve any Chapter 3 persona, voice, greeting, language, and transcription values you chose.",
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

    case "dtmf":
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
