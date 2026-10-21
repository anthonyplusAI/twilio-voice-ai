import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "section", title: "Dynamic Language Switch" },

    {
      type: "concept-card",
      audience: "explorer",
      title: "Switching Languages Mid-Call",
      content:
        "Some callers start in one language and slide into another -- maybe they're more comfortable in Spanish, or they switch between English and Mandarin at home. Conversation Relay can flip both the listening and speaking language on the fly, without dropping the call. It's a small feature with a huge accessibility payoff.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Conversation Relay can switch languages **mid-call** -- both the speech-to-text side (understanding the caller) and the text-to-speech side (the voice the caller hears). If a caller switches from English to Spanish, the agent adapts instantly without dropping the call.",
    },

    {
      type: "image",
      src: "/images/illustrations/map-location.png",
      alt: "A map with location pins — a visual metaphor for meeting callers wherever they are, in whichever language they speak.",
      size: "md",
    },

    { type: "page-break" },

    { type: "section", title: "The Language Message", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "To switch languages, send a `language` message over the WebSocket. Twilio immediately updates both how it listens and which voice it uses:",
    },

    {
      type: "json-message",
      audience: "builder",
      direction: "outbound",
      messageType: "language",
      code: `{
  "type": "language",
  "ttsLanguage": "es-ES",
  "transcriptionLanguage": "es-ES"
}`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Each field is individually optional, but **at least one must be present**. You could keep transcription in English while switching just the speaking voice, but for almost every real caller the STT and TTS languages should move together -- otherwise the agent hears Spanish and answers in an English voice, or vice versa. The implementation below sends both fields on every switch for that reason.",
    },

    { type: "page-break" },

    { type: "section", title: "Detecting Language Switches", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "The LLM is the best tool for detecting language changes. When a caller switches to Spanish, the transcribed text contains Spanish words. Replace your existing `SYSTEM_PROMPT` declaration with a version that keeps your chosen persona and adds the language instructions below. `conversationHistory` already uses `SYSTEM_PROMPT`, so do not paste a second prompt variable beside it:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["3-10"],
      code: `const SYSTEM_PROMPT = \`You are a helpful voice assistant for Twilio-Mart.
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
- Only include the marker when the language CHANGES, not on every message.
\`;`,
    },

    { type: "page-break" },

    { type: "section", title: "Handling the Language Switch", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Twilio includes the active transcription language in each `prompt` message as `lang`. **Replace your existing `handlePrompt` with this version** so the first final caller turn initializes `currentLanguage` from the language you chose in Chapter 3. Do this before adding the response helper below. Until that first spoken turn, the language is unknown; a keypad-triggered response can still send an explicit switch when the AI emits a marker.",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      code: `function handlePrompt(ws, msg) {
  const state = stateFor(ws);
  if (!state.currentLanguage && typeof msg.lang === "string" && msg.lang) {
    state.currentLanguage = msg.lang;
  }
  state.conversationHistory.push({ role: "user", content: msg.voicePrompt });
  streamResponse(ws);
}`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Check the LLM's response for language markers and send the `language` message to Twilio before sending the text to be spoken:",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "info",
      content:
        "**This is a new function.** Add `processLLMResponse` to your `server.js`; it uses the per-call `stateFor(ws)` helper from Step 1.",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["1-24"],
      code: `const LANG_MARKER_REGEX = /^\\[LANG:([\\w-]+)\\]/;

function processLLMResponse(ws, text) {
  const state = stateFor(ws);
  const currentLanguage = state.currentLanguage;
  text = text.trimStart();
  const match = text.match(LANG_MARKER_REGEX);

  if (match) {
    const newLang = match[1];

    if (newLang !== currentLanguage && !state.closed && ws.readyState === 1) {
      console.log(\`Switching language: \${currentLanguage || "unknown"} -> \${newLang}\`);
      state.currentLanguage = newLang;

      // Tell Twilio to switch STT and TTS
      ws.send(JSON.stringify({
        type: "language",
        ttsLanguage: newLang,
        transcriptionLanguage: newLang
      }));
    }

    // Remove the marker before sending text to Twilio
    text = text.replace(LANG_MARKER_REGEX, "").trim();
  }

  // Send the cleaned text to be spoken. streamResponse calls this per
  // sentence and emits the terminating last=true marker once the full
  // LLM response completes, so we don't set last=true here.
  if (text) sendText(ws, text);
}`,
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "The language switch takes effect immediately. Send the `language` message **before** sending the text that should be spoken in the new language. Otherwise Twilio will try to speak Spanish text with an English voice, which sounds garbled.",
    },

    { type: "page-break" },

    { type: "section", title: "Wire It Into `streamResponse`", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "**Replace your existing `streamResponse` with this version.** The old one sent every token to Twilio the moment it arrived, which would speak the `[LANG:xx-XX]` marker out loud before the helper had a chance to strip it. The fix is to buffer tokens until a sentence ends, then run each full sentence through `processLLMResponse` before speaking it.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "**This is a full replacement.** If you paste it next to your existing `streamResponse` without deleting the old one, both functions will run and the caller will hear duplicated or overlapping audio.",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["12-35", "38-44"],
      code: `async function streamResponse(ws) {
  const state = stateFor(ws);
  state.activeStream?.abort();
  const controller = new AbortController();
  state.activeStream = controller;

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: state.conversationHistory,
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

      // Flush whole sentences through processLLMResponse so the
      // [LANG:xx-XX] marker (if any) is stripped and the language
      // message reaches Twilio before any text is spoken. The
      // (\\s|$) alternation also flushes when the stream ends on
      // punctuation with no trailing whitespace (short replies
      // like "Hola!" would otherwise only flush at end-of-stream).
      let match;
      while ((match = textBuffer.match(/[.!?](\\s|$)/))) {
        const sentenceEnd = match.index + 1;
        const sentence = textBuffer.slice(0, sentenceEnd);
        processLLMResponse(ws, sentence);
        textBuffer = textBuffer.slice(sentenceEnd + (match[1] ? match[1].length : 0));
      }
    }

    // Flush trailing text after the final sentence terminator.
    if (textBuffer.trim()) {
      processLLMResponse(ws, textBuffer.trim());
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
}`,
    },

    {
      type: "callout",
      audience: "builder",
      variant: "tip",
      content:
        "Why sentence buffering, not word buffering? A marker like `[LANG:es-ES]` can arrive split across tokens (`[LANG`, `:es-`, `ES]`). Waiting for a sentence boundary guarantees the full marker is present before the regex runs, and it keeps perceived latency low because callers hear the agent speak one sentence at a time anyway.\n\nThe split pattern `/[.!?](\\s|$)/` will mis-flush on abbreviations like `Mr. Smith` or `e.g.,` and on numbers like `3.14`. For a workshop agent that is fine -- the marker only needs to be intact at the *start* of the first sentence. For a production agent you would swap in a proper sentence tokenizer (such as `compromise` or `sbd`).",
    },

    { type: "section", title: "Supported Languages", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Conversation Relay supports a wide range of BCP-47 language codes. Some commonly used ones -- pass any of these values as the `ttsLanguage` or `transcriptionLanguage` in the `language` message:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      code: `// Reference: common BCP-47 codes for Conversation Relay
// "en-US" -> English (US)
// "en-GB" -> English (UK)
// "es-ES" -> Spanish (Spain)
// "es-MX" -> Spanish (Mexico)
// "fr-FR" -> French
// "de-DE" -> German
// "it-IT" -> Italian
// "pt-BR" -> Portuguese (Brazil)
// "ja-JP" -> Japanese
// "ko-KR" -> Korean
// "zh-CN" -> Chinese (Mandarin)
// "hi-IN" -> Hindi
// "ar-SA" -> Arabic`,
    },

    {
      type: "deep-dive",
      audience: "builder",
      title: "Multi-language system prompt strategy",
      content:
        "For agents that handle multiple languages, write the system prompt in English (since most LLMs perform best with English instructions) but explicitly state that the agent should respond in the caller's language. The LLM will follow instructions in English while generating responses in the target language.\n\nSome teams maintain separate system prompts per language for cultural nuance, but for most use cases, a single English prompt with multilingual instructions works well. The key is testing -- have native speakers call the agent and verify the experience feels natural.",
    },

    {
      type: "solution",
      audience: "builder",
      file: "server.js",
      language: "javascript",
      explanation:
        "Builds on the previous step by adding a LANGUAGE DETECTION section to the system prompt, a LANG_MARKER_REGEX constant, currentLanguage tracking from Twilio's first final `prompt.lang`, and a processLLMResponse function that sends language switches. streamResponse buffers tokens into whole sentences so the marker is stripped before speech. When copying this complete example, keep your chosen `<ConversationRelay>` settings from Chapter 3, including voice, provider, language, speech model, and welcome greeting; the `/twiml` values shown here are defaults.",
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

    {
      type: "concept-card",
      audience: "explorer",
      title: "What It Sounds Like to the Caller",
      content:
        "On the test call coming up next: if you speak Spanish, start in English and switch mid-sentence. If you don't, read this phrase out loud -- *\"Hola, ¿cómo estás?\"* (roughly *\"OH-lah, KOH-moh es-TAHS\"*). Either way the agent keeps the same tone but flips to a Spanish voice that sounds natural in that language. No menu, no \"press 2 for Spanish\" -- the change happens the moment the agent hears the shift, and flips back when you return to English.",
    },
  ],
} satisfies StepDefinition;
