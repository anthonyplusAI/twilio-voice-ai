import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "section", title: "Polish Your Agent" },

    {
      type: "concept-card",
      audience: "explorer",
      title: "The Line Between Demo and Product",
      content:
        "A working prototype handles the expected path: a clear caller, a good line, a question the agent is ready for. A polished agent handles the rest -- poor audio, a frustrated caller, off-hours traffic. Polish is the set of small choices (tone, error messages, logging, graceful fallbacks) that close the gap between the two.",
    },

    {
      type: "image",
      audience: "explorer",
      src: "/images/illustrations/growth.png",
      alt: "A growing plant — the agent maturing from working prototype into a dependable product through small, steady refinements.",
      size: "md",
    },

    {
      type: "concept-card",
      audience: "explorer",
      title: "Polish in Practice",
      content:
        "Polish is almost never a flashy feature -- it's the small behaviors you only notice when they're missing. A polished agent says \"give me a moment to check that for you\" before a slow lookup; a rough agent goes silent and the caller assumes the line dropped. A polished agent admits when it doesn't know something and offers to connect a human; a rough agent guesses and gives the wrong answer. A polished agent ends cleanly when the caller hangs up; a rough agent leaves timers running in the background. None of these land in a demo -- they only matter when the caller is real.",
    },

    {
      type: "callout",
      audience: "explorer",
      variant: "info",
      content:
        "You've already done most of your polish work -- you chose the name, the tone, the voice, the language, and the tools the agent can reach. This step is a chance to look back at those choices with fresh eyes now that you've heard the agent in action. Does the name still fit? Is the voice the right match for the tone? Is anything missing that came up when you tested?",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "The agent works end to end. Before launch, a polishing pass makes it feel professional and reliable.",
    },

    { type: "section", audience: "builder", title: "Refine Your System Prompt" },

    {
      type: "prose",
      audience: "builder",
      content:
        "The system prompt is the single biggest lever for agent quality. Review it against this checklist:",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**Identity** -- Does the prompt clearly define who the agent is, what company it works for, and its role?\n**Boundaries** -- Does it specify what the agent should NOT do (e.g., make promises, share internal information)?\n**Tone** -- Is the tone appropriate for your use case? Customer support should be warm and helpful; a scheduling bot can be more concise.\n**Edge cases** -- Does it handle off-topic questions, profanity, or requests for competitors?\n**Conciseness** -- Voice responses should be shorter than text chat. Tell the AI to keep answers brief and conversational.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "info",
      content:
        "**Apply this to your persona.** The \"Jake\" example below is one worked version of the checklist -- use it as a reference pattern, not a replacement for the persona you picked earlier. Keep your agent's name and company, then layer on the missing pieces (capabilities, boundaries, tone specifics) using this as the template.",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      code: `const SYSTEM_PROMPT = \`You are Jake from Twilio Pizza Co.

PERSONALITY:
- Warm, professional, and concise
- Use natural conversational language (contractions, simple words)
- Keep responses under 2-3 sentences when possible
- Never say "As an AI" or reference being a language model

CAPABILITIES:
- Check order status (use lookup_order tool)
- Provide weather information (use check_weather tool)
- Transfer to human agents when needed (use transfer_to_agent tool)

BOUNDARIES:
- Never make promises about refunds or policy exceptions
- Do not share internal pricing or systems information
- If asked about competitors, politely redirect to Twilio Pizza Co.
- For account changes (password, email, billing), always transfer to a human

VOICE GUIDELINES:
- Speak in short, clear sentences
- Avoid lists longer than 3 items (offer to go one by one)
- Confirm important details by repeating them back
- Use filler phrases naturally: "Let me check that for you"

LANGUAGE DETECTION:
- You can speak English and Spanish fluently.
- If the caller switches languages, respond in that language.
- Begin the first response after a switch with [LANG:xx-XX], where
  xx-XX is the language code (for example, [LANG:es-ES]).
- Only include the marker when the language changes.
\`;`,
    },

    { type: "page-break" },

    { type: "section", audience: "builder", title: "Optimize Voice Settings" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Fine-tune the Conversation Relay voice settings for the best caller experience:",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "info",
      content:
        "**This replaces the `<ConversationRelay>` element in your existing `/twiml` handler** -- don't paste it as a second route. You already have a TwiML response with `dtmfDetection`, `interruptible`, and `reportInputDuringAgentSpeech` from the reflexes chapter, plus `language`, `transcriptionProvider`, and `speechModel` from the language configuration step; this step adds new attributes (`voice`, `ttsProvider`, `interruptSensitivity`, `welcomeGreetingInterruptible`, `hints`) onto the same element and introduces `action=\"/call-ended\"` on `<Connect>`.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "info",
      content:
        "For live handoff, put a second reachable phone number in your Codespace's `workshop/.env`, for example `HANDOFF_PHONE_NUMBER=+14155552671` for a teammate or facilitator, then restart `npm run dev`. Use a number different from the phone receiving Call Me so the transfer can ring a person. The value must be E.164. Public Codespaces do not have a destination preconfigured; without one, the agent says live transfer is unavailable and keeps the conversation open. The workshop site's Call Me button uses the site's Twilio account (ask the facilitator); your Codespace's `/call` route uses the credentials in your `.env`. **Whichever account places the call must be upgraded for `<ConversationRelay>`**; [trial accounts block that noun](https://www.twilio.com/docs/usage/trials/try-out-voice#blocked-verbs), so verifying a phone number alone is insufficient.",
    },

    {
      type: "code",
      audience: "builder",
      language: "xml",
      file: "twiml-response",
      highlight: [11, 12, 13],
      code: `<Response>
  <Connect action="/call-ended">
    <ConversationRelay
      url="wss://<your-server-host>/ws"
      voice="en-US-Chirp3-HD-Aoede"
      ttsProvider="Google"
      language="en-US"
      transcriptionProvider="Deepgram"
      speechModel="nova-3-general"
      dtmfDetection="true"
      interruptible="any"
      interruptSensitivity="medium"
      welcomeGreeting="Hello! How can I help you today?"
      welcomeGreetingInterruptible="speech"
      reportInputDuringAgentSpeech="any"
      hints="Twilio Pizza Co., order status, transfer, refund"
    />
  </Connect>
</Response>`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**`welcomeGreetingInterruptible`** -- same values as `interruptible` (`none`, `dtmf`, `speech`, `any`); applies only to the welcome greeting. Platform default is `\"any\"`; `\"speech\"` is a good explicit choice because callers can interject without accidentally triggering on a DTMF tone.\n\n**`reportInputDuringAgentSpeech`** -- controls whether Twilio forwards speech or DTMF that arrives *while* the agent is talking, without interrupting. Default is `\"none\"`. Keep it at `\"any\"` here so both spoken interruptions and keypad shortcuts reach the server.\n\n**`hints`** -- comma-separated phrases the transcriber should bias toward. If the agent deals with proper nouns, product SKUs, or acronyms, listing them here improves recognition accuracy.\n\n**`events`** -- optional space-separated `speaker-events` and `tokens-played` notifications for deeper speech playback diagnostics. The handoff below does not depend on those events because its announcement is a single `<Say>` in the action response.",
    },

    { type: "page-break" },

    { type: "section", audience: "builder", title: "Pre-Launch Checklist" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Work through each item before considering the agent ready for real callers:",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**Error handling** -- Does the agent recover gracefully when the AI service is slow, a tool fails, or the network hiccups?\n**Conversation length limits** -- Is the conversation history trimmed or summarized after ~20 exchanges to avoid growing too long?\n**Clean call endings** -- Does the agent clear timers and close connections when a call ends?\n**Logging** -- Is there enough to troubleshoot problems without exposing sensitive caller data?\n**Timeouts** -- Are all outside calls (AI, tools, services) time-limited so the caller never waits forever?\n**Rate limiting** -- Is there protection against a single caller making excessive requests?",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "tip",
      content:
        "Record a few test calls and listen to them critically. You'll catch pacing issues, awkward phrasing, and edge cases you miss during interactive testing. Pay special attention to the first 5 seconds -- that's when the caller decides if they're talking to a competent system.",
    },

    { type: "page-break" },

    { type: "section", audience: "builder", title: "Handle Inbound `error` Messages" },

    {
      type: "prose",
      audience: "builder",
      content:
        "When something goes wrong on Twilio's side -- voice generation fails, transcription times out, or a message is malformed -- Twilio sends an error message so the server can react gracefully instead of leaving the caller in silence.",
    },

    {
      type: "json-message",
      audience: "builder",
      direction: "inbound",
      messageType: "error",
      code: `{
  "type": "error",
  "description": "Failed to synthesize speech"
}`,
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["12-21"],
      code: `function handleMessage(ws, state, data) {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch (err) {
    console.error("Invalid Conversation Relay message:", err.message);
    return;
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;

  switch (msg.type) {
    // ... existing cases (setup, prompt, interrupt, dtmf) ...

    case "error":
      // Log the fault and fall back to a graceful spoken recovery.
      // Don't try to retry automatically -- a second failure in a row
      // would just burn time while the caller waits in silence.
      console.error("⚠️ Conversation Relay error:", msg.description);
      sendText(ws, state,
        "I'm having a brief technical issue. " +
        "Could you say that again?",
        true,
      );
      break;
  }
}`,
    },

    {
      type: "callout",
      audience: "builder",
      variant: "tip",
      content:
        "In production, also emit a structured log entry here (with the `callSid` and conversation context) so the error shows up in your observability dashboard. Lost audio is invisible to the caller until they notice the agent isn't responding -- catch it on the server side.",
    },

    { type: "section", audience: "builder", title: "Handle AI Errors Gracefully" },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      code: `async function streamResponse(ws, state, iteration = 0) {
  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: state.conversationHistory,
      tools: tools,
      stream: true,
    });

    // ... streaming logic ...

  } catch (err) {
    console.error("❌ LLM error:", err.message);

    if (err.name === "AbortError") {
      // Expected -- stream was cancelled due to interrupt
      return;
    }

    // Keep the spoken fallback in this call's history for the next turn.
    const fallback = "I'm sorry, I'm having a technical issue. " +
      "Could you repeat that, or would you like me to " +
      "transfer you to a team member?";
    sendText(ws, state, fallback, true);
    state.conversationHistory.push({ role: "assistant", content: fallback });
  }
}`,
    },

    {
      type: "deep-dive",
      audience: "builder",
      title: "Monitoring in production",
      content:
        "For production agents, track these metrics:\n\n**Response latency** -- time from caller speech to first AI audio\n**Interruption rate** -- how often callers interrupt (high rate suggests slow or irrelevant responses)\n**Handoff rate** -- percentage of calls that need a human\n**Call duration** -- average and distribution\n**Tool success rate** -- how often tools return errors\n**Silence timeout rate** -- how often calls end due to silence",
    },

    {
      type: "solution",
      audience: "builder",
      explanation:
        "Both files at the end of the workshop. `tool-handlers.js` validates the live handoff destination before ending the AI session. The action URL speaks the transfer announcement once before dialing. `server.js` is the complete polished version with tool calling, interruptions, DTMF, silence detection, language switching, handoff support, and error handling. Each WebSocket connection keeps its own conversation state. When copying this complete example, keep your chosen `<ConversationRelay>` settings, including voice, provider, language, speech model, and welcome greeting; the `/twiml` values shown here are defaults.",
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
  },
  {
    type: "function",
    function: {
      name: "transfer_to_agent",
      description: "Transfer the caller to a live human agent. " +
        "Use this when the caller explicitly requests a human, " +
        "or when you cannot resolve their issue.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Brief reason for the transfer"
          },
          department: {
            type: "string",
            enum: ["billing", "technical", "general"],
            description: "Department to route to"
          },
          summary: {
            type: "string",
            description: "Summary of the conversation so far"
          }
        },
        required: ["reason", "summary"]
      }
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
  },

  transfer_to_agent: async ({ reason, department, summary }, ws) => {
    if (ws.readyState !== 1) return { status: "closed" };
    const handoffNumber = process.env.HANDOFF_PHONE_NUMBER || "";
    if (!/^\\+[1-9]\\d{1,14}$/.test(handoffNumber)) {
      ws.send(JSON.stringify({
        type: "text",
        token: "Sorry, live transfer is unavailable right now. " +
          "I can still help here.",
        last: true
      }));
      return { status: "unavailable" };
    }

    // The action URL speaks the transfer announcement before dialing.
    ws.send(JSON.stringify({
      type: "end",
      handoffData: JSON.stringify({
        reasonCode: "live-agent-handoff",
        reason,
        department: department || "general",
        summary,
        timestamp: new Date().toISOString()
      })
    }));

    return { status: "transferring" };
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

const PORT = Number(process.env.PORT || 8080);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// --- System prompt ---
// Paste your persona's SYSTEM_PROMPT here, layered with the
// PERSONALITY / CAPABILITIES / BOUNDARIES / VOICE GUIDELINES / LANGUAGE
// DETECTION structure shown in the Jake example above. Don't overwrite
// your persona with the example verbatim.

const SYSTEM_PROMPT = \`<-- paste your SYSTEM_PROMPT here -->\`;

// Each WebSocket connection gets its own conversation and timers.
const SILENCE_TIMEOUT_MS = 8000;
const MAX_SILENCE_PROMPTS = 2;
const FAREWELL_DELAY_MS = 6000;

const LANG_MARKER_REGEX = /^\\[LANG:([\\w-]+)\\]/;

// --- Helpers ---

function createCallState() {
  return {
    conversationHistory: [{ role: "system", content: SYSTEM_PROMPT }],
    activeStream: null,
    silenceTimer: null,
    endTimer: null,
    silencePromptCount: 0,
    currentLanguage: null,
    ending: false,
    closed: false,
  };
}

function clearCallTimers(state) {
  clearTimeout(state.silenceTimer);
  clearTimeout(state.endTimer);
  state.silenceTimer = null;
  state.endTimer = null;
}

function sendMessage(ws, state, message) {
  if (state.closed || ws.readyState !== 1) return;
  ws.send(JSON.stringify(message));
}

function sendText(ws, state, token, last = false) {
  sendMessage(ws, state, { type: "text", token, last });
}

function cancelActiveStream(state) {
  state.activeStream?.abort();
  state.activeStream = null;
}

// --- LLM streaming with tool-call support ---

const MAX_TOOL_ITERATIONS = 5;
const SLOW_TOOLS = ["lookup_order"];

async function streamResponse(ws, state, iteration = 0) {
  if (state.closed || state.ending) return;
  const controller = new AbortController();
  state.activeStream = controller;
  let textBuffer = "";
  let fullAssistantText = "";
  let toolCalls = [];

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: state.conversationHistory,
      tools: tools,
      stream: true,
    }, { signal: controller.signal });

    if (controller.signal.aborted || state.closed || state.ending) return;

    for await (const chunk of stream) {
      if (controller.signal.aborted || state.closed || state.ending) return;
      const delta = chunk.choices[0]?.delta;
      const finishReason = chunk.choices[0]?.finish_reason;

      if (delta?.content) {
        textBuffer += delta.content;
        fullAssistantText += delta.content;
        const sentenceEnd = textBuffer.search(/[.!?]\\s/);
        if (sentenceEnd !== -1) {
          const sentence = textBuffer.slice(0, sentenceEnd + 1);
          processLLMResponse(ws, state, sentence);
          textBuffer = textBuffer.slice(sentenceEnd + 2);
        }
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index !== undefined) {
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
        }
      }

      if (finishReason === "tool_calls") {
        await handleToolCalls(ws, state, toolCalls, iteration, controller.signal);
        return;
      }

      if (finishReason === "stop") {
        if (textBuffer.trim()) {
          processLLMResponse(ws, state, textBuffer.trim());
          textBuffer = "";
        }
        sendText(ws, state, "", true);
        if (fullAssistantText.trim()) {
          state.conversationHistory.push({
            role: "assistant",
            content: fullAssistantText.trim(),
          });
        }
        return;
      }
    }
  } catch (err) {
    if (controller.signal.aborted || err.name === "AbortError" ||
        state.closed || state.ending) return;

    console.error("LLM error:", err.message);
    const fallback = "I'm sorry, I'm having a technical issue. " +
      "Could you repeat that, or would you like me to " +
      "transfer you to a team member?";
    sendText(ws, state, fallback, true);
    state.conversationHistory.push({ role: "assistant", content: fallback });
  } finally {
    // A recursive tool response may already have installed a new controller.
    if (state.activeStream === controller) state.activeStream = null;
  }
}

async function handleToolCalls(ws, state, toolCalls, iteration, signal) {
  if (signal.aborted || state.closed || state.ending) return;
  if (iteration >= MAX_TOOL_ITERATIONS) {
    sendText(ws, state, "I'm having trouble processing that. Can you try rephrasing?", true);
    return;
  }

  if (toolCalls.some(tc => SLOW_TOOLS.includes(tc.function.name))) {
    sendText(ws, state, "One moment while I look that up...", true);
  }

  const assistantToolCall = {
    role: "assistant",
    content: null,
    tool_calls: toolCalls.map(tc => ({
      id: tc.id,
      type: "function",
      function: { name: tc.function.name, arguments: tc.function.arguments }
    }))
  };
  const toolMessages = [];

  for (const toolCall of toolCalls) {
    if (signal.aborted || state.closed || state.ending) return;
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
      result = { error: "Tool failed: " + err.message };
    }

    if (signal.aborted || state.closed || state.ending) return;
    toolMessages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(result)
    });

    if (fnName === "transfer_to_agent" &&
        (result?.status === "transferring" || result?.status === "unavailable")) {
      // This loop stops here; omit any later, unhandled parallel tool calls.
      assistantToolCall.tool_calls.length = toolMessages.length;
      state.conversationHistory.push(assistantToolCall, ...toolMessages);
      if (result.status === "transferring") {
        state.ending = true;
        clearCallTimers(state);
      } else {
        state.conversationHistory.push({
          role: "assistant",
          content: "Sorry, live transfer is unavailable right now. I can still help here."
        });
      }
      return;
    }
  }

  if (signal.aborted || state.closed || state.ending) return;
  state.conversationHistory.push(assistantToolCall, ...toolMessages);
  await streamResponse(ws, state, iteration + 1);
}

// --- Conversation handlers ---

function handleInterrupt(state, msg) {
  console.log("Caller interrupted. Heard:", msg.utteranceUntilInterrupt);

  cancelActiveStream(state);

  const lastMsg = state.conversationHistory[state.conversationHistory.length - 1];
  if (lastMsg?.role === "assistant" &&
      typeof msg.utteranceUntilInterrupt === "string") {
    lastMsg.content = msg.utteranceUntilInterrupt;
  }
}

async function handleDtmfInput(ws, state, digit) {
  cancelActiveStream(state);
  switch (digit) {
    case "1":
      state.conversationHistory.push({
        role: "user",
        content: "I want to check my order status."
      });
      streamResponse(ws, state);
      break;

    case "2":
      state.ending = true;
      clearCallTimers(state);
      try {
        const result = await toolHandlers.transfer_to_agent({
          reason: "Caller pressed 2 for a representative",
          department: "general",
          summary: "Caller requested a representative using the keypad."
        }, ws);
        if (result?.status === "transferring") break;
        state.ending = false;
        if (result?.status !== "unavailable") {
          sendText(ws, state, "I'm sorry, I couldn't start the transfer. " +
            "Please try again.", true);
        }
        resetSilenceTimer(ws, state);
      } catch (err) {
        state.ending = false;
        console.error("Handoff error:", err.message);
        sendText(ws, state, "I'm sorry, I couldn't start the transfer. " +
          "Please try again.", true);
        resetSilenceTimer(ws, state);
      }
      break;

    case "0":
      sendText(ws, state, "Returning to the main menu. " +
        "Press 1 for order status, 2 for a representative, " +
        "or just tell me what you need.", true);
      break;

    default:
      sendText(ws, state, "I didn't recognize that option. " +
        "Press 1 for order status, or 2 for a representative.", true);
      break;
  }
}

// --- Silence detection ---

function resetSilenceTimer(ws, state) {
  clearCallTimers(state);
  state.silencePromptCount = 0;
  if (state.closed || state.ending) return;

  state.silenceTimer = setTimeout(() => {
    handleSilence(ws, state);
  }, SILENCE_TIMEOUT_MS);
}

function handleSilence(ws, state) {
  if (state.closed || state.ending) return;
  state.silenceTimer = null;
  state.silencePromptCount++;

  if (state.silencePromptCount > MAX_SILENCE_PROMPTS) {
    sendText(ws, state, "I'll end the call now. Please call back anytime.", true);
    // Give the short farewell time to play before ending the relay.
    state.endTimer = setTimeout(() => {
      sendMessage(ws, state, { type: "end" });
      state.ending = true;
      clearCallTimers(state);
    }, FAREWELL_DELAY_MS);
    return;
  }

  const prompts = [
    "Are you still there? Take your time -- I'm here whenever you're ready.",
    "I'm still here if you need anything. Is there something I can help with?",
  ];

  sendText(ws, state, prompts[state.silencePromptCount - 1], true);

  state.silenceTimer = setTimeout(() => {
    handleSilence(ws, state);
  }, SILENCE_TIMEOUT_MS);
}

// --- Language switching ---

function processLLMResponse(ws, state, text) {
  text = text.trimStart();
  const match = text.match(LANG_MARKER_REGEX);

  if (match) {
    const newLang = match[1];

    if (newLang !== state.currentLanguage) {
      console.log(\`Switching language: \${state.currentLanguage} -> \${newLang}\`);
      state.currentLanguage = newLang;

      sendMessage(ws, state, {
        type: "language",
        ttsLanguage: newLang,
        transcriptionLanguage: newLang
      });
    }

    text = text.replace(LANG_MARKER_REGEX, "").trim();
  }

  if (text) {
    sendText(ws, state, text);
  }
}

// --- WebSocket message dispatcher ---

function handleMessage(ws, state, data) {
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch (err) {
    console.error("Invalid Conversation Relay message:", err.message);
    return;
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg) ||
      state.closed || state.ending) return;

  switch (msg.type) {
    case "setup":
      resetSilenceTimer(ws, state);
      break;

    case "prompt":
      if (msg.last === false || typeof msg.voicePrompt !== "string") break;
      if (!state.currentLanguage && typeof msg.lang === "string" && msg.lang) {
        state.currentLanguage = msg.lang;
      }
      cancelActiveStream(state);
      resetSilenceTimer(ws, state);
      state.conversationHistory.push({ role: "user", content: msg.voicePrompt });
      streamResponse(ws, state);
      break;

    case "interrupt":
      resetSilenceTimer(ws, state);
      handleInterrupt(state, msg);
      break;

    case "dtmf":
      resetSilenceTimer(ws, state);
      handleDtmfInput(ws, state, msg.digit);
      break;

    case "error":
      console.error("Conversation Relay error:", msg.description);
      sendText(ws, state,
        "I'm having a brief technical issue. " +
        "Could you say that again?",
        true,
      );
      break;

    default:
      console.log("Unhandled message type:", msg.type);
  }
}

// --- HTTP server ---

const server = http.createServer(async (req, res) => {
  if (req.url === "/twiml" && req.method === "POST") {
    const twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect action="/call-ended">
    <ConversationRelay
      url="wss://\${req.headers.host}/ws"
      voice="en-US-Chirp3-HD-Aoede"
      ttsProvider="Google"
      language="en-US"
      transcriptionProvider="Deepgram"
      speechModel="nova-3-general"
      dtmfDetection="true"
      interruptible="any"
      interruptSensitivity="medium"
      welcomeGreeting="Hello! How can I help you today?"
      welcomeGreetingInterruptible="speech"
      reportInputDuringAgentSpeech="any"
      hints="Twilio Pizza Co., order status, transfer, refund"
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

  if (req.url === "/call-ended" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => body += chunk);
    req.on("end", () => {
      const params = new URLSearchParams(body);
      const handoffData = params.get("HandoffData");
      let data = null;
      if (handoffData) {
        try {
          data = JSON.parse(handoffData);
        } catch (err) {
          console.error("Invalid HandoffData:", err.message);
        }
      }

      const handoffNumber = process.env.HANDOFF_PHONE_NUMBER || "";
      const canTransfer = /^\\+[1-9]\\d{1,14}$/.test(handoffNumber);
      let twiml;
      if (data?.reasonCode === "live-agent-handoff" && canTransfer) {
        console.log("Handoff requested:", data.reason);
        console.log("Summary:", data.summary);
        twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please hold while I transfer you to a representative.</Say>
  <Dial>
    <Number>\${handoffNumber}</Number>
  </Dial>
</Response>\`;
      } else if (data?.reasonCode === "live-agent-handoff") {
        twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, live transfer is unavailable right now. Please call back later.</Say>
  <Hangup />
</Response>\`;
      } else {
        twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for calling. Goodbye!</Say>
  <Hangup />
</Response>\`;
      }

      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(twiml);
    });
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket server is running");
});

// --- WebSocket server ---

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("New WebSocket connection");
  const state = createCallState();

  ws.on("message", (data) => handleMessage(ws, state, data));

  ws.on("close", () => {
    state.closed = true;
    cancelActiveStream(state);
    clearCallTimers(state);
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
  ],
} satisfies StepDefinition;
