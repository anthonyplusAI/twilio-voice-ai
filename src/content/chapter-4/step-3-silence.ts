import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "section", title: "Silence & Timeouts" },

    {
      type: "concept-card",
      audience: "explorer",
      title: "Silence as a Signal",
      content:
        "On a phone call, a long pause means *something* -- the caller is thinking, confused, distracted, or gone. A well-designed agent notices silence and responds: a gentle \"Are you still there?\" after a few seconds, then a polite goodbye if nothing comes back. Getting this right is the difference between an agent that feels considerate and one that feels abandoned.",
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "The agent also adjusts how sensitive it is to background noise. In a quiet room, even a soft \"um\" will register as speech. In a noisier environment, it expects louder, clearer sound so random noises don't accidentally cut the agent off.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Silence is information. When a caller goes quiet, it could mean they are thinking, confused, stepped away, or the call dropped. The agent needs to handle silence gracefully rather than sitting in dead air.",
    },

    {
      type: "image",
      src: "/images/illustrations/question-mark.svg",
      alt: "A floating question mark — the unspoken prompt behind every stretch of silence on a call.",
      size: "sm",
    },

    { type: "page-break" },

    { type: "section", title: "How Silence Detection Works", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Conversation Relay does not send a dedicated \"silence\" message. Instead, the server watches the clock while it is waiting for the caller. Pause that clock while the AI prepares and sends its reply; otherwise a slow response could trigger a nudge before the caller has a chance to answer.",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["1-20", "22-45"],
      code: `const SILENCE_TIMEOUT_MS = 8000;   // 8 seconds of silence
const MAX_SILENCE_PROMPTS = 2;      // Two nudges before farewell
const FAREWELL_DELAY_MS = 6000;     // Let Twilio speak the farewell

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
}`,
    },

    { type: "page-break" },

    { type: "section", title: "Integrating with the Message Handler", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Reset the silence timer when the call starts and whenever the caller speaks or presses a key. Replace your existing `handleMessage` with this version, keeping the per-call state from Step 1:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["1-8", "11-30"],
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
    case "setup":
      // welcomeGreeting in TwiML already speaks the greeting,
      // so just start the silence timer here -- no duplicate greeting.
      resetSilenceTimer(ws);
      break;

    case "prompt":
      resetSilenceTimer(ws);  // Caller spoke -- reset the timer
      if (msg.last !== false && typeof msg.voicePrompt === "string") handlePrompt(ws, msg);
      break;

    case "interrupt":
      handleInterrupt(ws, msg);
      resetSilenceTimer(ws);  // Restart after cancelling the old reply
      break;

    case "dtmf":
      resetSilenceTimer(ws);  // Keypress counts as activity
      handleDtmfInput(ws, msg.digit);
      break;
  }
}`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**Replace your existing `streamResponse` with this version.** It clears the silence countdown as soon as an AI reply starts, then restarts a full eight seconds when that reply finishes or falls back after an error. An interrupted reply does not restart an old timer: the `interrupt` handler above starts a new one for the caller.",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      code: `async function streamResponse(ws) {
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
    if (state.activeStream === controller) {
      state.activeStream = null;
      resetSilenceTimer(ws);
    }
  }
}`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Inside your **existing** `wss.on(\"connection\", ...)` callback, replace the Step 1 `ws.on(\"close\", ...)` handler with this version so only this call's timers are cleared:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["1-8"],
      code: `ws.on("close", () => {
  const state = stateFor(ws);
  state.closed = true;
  state.activeStream?.abort();
  clearTimeout(state.silenceTimer);
  clearTimeout(state.endTimer);
  console.log("Call ended, timers cleared.");
});`,
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "Be careful with the silence timeout value. Too short (under 5 seconds) and you will interrupt callers who are thinking. Too long (over 15 seconds) and the experience feels unresponsive. Start with 8-10 seconds and adjust based on your use case.\n\nWith the defaults, the server sends nudges 8 and 16 seconds after it finishes sending the AI reply or after the last caller activity, then a farewell after 24 seconds. It waits another 6 seconds before ending the call so the farewell can play. Tune both delays for your voice and response length.",
    },

    { type: "page-break" },

    { type: "section", title: "Interrupt Sensitivity", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Conversation Relay provides an `interruptSensitivity` attribute that controls how easily the caller's speech triggers an interrupt -- how Twilio distinguishes intentional speech from background noise:",
    },

    {
      type: "code",
      audience: "builder",
      language: "xml",
      file: "twiml-response",
      highlight: [12],
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
      dtmfDetection="true"
      interruptible="any"
      interruptSensitivity="medium"
      reportInputDuringAgentSpeech="any"
    />
  </Connect>
</Response>`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        '`interruptSensitivity` accepts `"low"`, `"medium"`, or `"high"` (the default). At `"high"`, even brief sounds can trigger an interrupt. Use `"medium"` or `"low"` in noisy environments where background sounds might be mistaken for speech.',
    },

    {
      type: "deep-dive",
      audience: "builder",
      title: "Advanced timeout strategies",
      content:
        "For production agents, consider implementing tiered timeouts based on context:\n\n**Short timeout (5s)** after asking a yes/no question -- the caller should respond quickly.\n\n**Medium timeout (10s)** for open-ended questions -- give the caller time to think.\n\n**Long timeout (20s)** when you have asked the caller to look something up, like an order number or account details.\n\nYou can track the \"expected response type\" in your conversation state and adjust the timer accordingly.",
    },

    {
      type: "solution",
      audience: "builder",
      file: "server.js",
      language: "javascript",
      explanation:
        "Builds on the previous step by adding per-call silence timers, two nudges, a delayed farewell, pausing while the AI replies, timer resets on caller activity, and cleanup on WebSocket close. If you replace your whole server.js with this example, preserve any Chapter 3 persona, voice, greeting, language, and transcription values you chose.",
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

const SILENCE_TIMEOUT_MS = 8000;
const MAX_SILENCE_PROMPTS = 2;
const FAREWELL_DELAY_MS = 6000;

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
  clearTimeout(state.silenceTimer);
  state.silenceTimer = null;

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
    if (state.activeStream === controller) {
      state.activeStream = null;
      resetSilenceTimer(ws);
    }
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
} satisfies StepDefinition;
