import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "section", title: "Live Agent Handoff" },

    { type: "diagram", variant: "architecture", highlight: "handoff" },

    {
      type: "concept-card",
      audience: "explorer",
      title: "When the AI Steps Aside",
      content:
        "The best AI agents know when to give up. A sensitive complaint, a scared caller, or a request the model cannot handle -- that is when it passes the call to a human. A clean handoff includes a short summary of what happened so the human does not have to start from zero.",
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "Sometimes the caller needs a human -- for complex complaints, sensitive account changes, or when the AI cannot solve the problem. A smooth handoff from AI to a live agent keeps the experience seamless.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "No AI agent can handle every situation. Sometimes the caller needs a human -- for complex complaints, sensitive account changes, or when the AI cannot solve the problem. A smooth handoff from AI to a live agent is essential for production voice systems.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "info",
      content:
        "**Handoff is different from your other tools.** `check_weather` and `lookup_order` *continue* the conversation -- the AI gets data back and keeps talking. Handoff *ends* the AI session. Once the `end` message is sent, Twilio closes the WebSocket and the AI is out of the call entirely; the human picks up from there. You'll wire it into the same `tools` array for convenience, but mentally it belongs in its own category: a control-flow primitive, not a data lookup.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "**Keep regulated data out of the LLM.** Card numbers (PCI), Social Security numbers, and Protected Health Information (PHI) should never land in your `conversationHistory`, your LLM provider's logs, or your stdout. Two Twilio patterns for handling this:\n\n- **Card data (PCI):** do not ask the LLM to capture it. Use Twilio's [`<Pay>` verb](https://www.twilio.com/docs/voice/tutorials/how-capture-your-first-payment-using-pay) or the [Payments API](https://www.twilio.com/docs/voice/api/payment-resource) -- both capture DTMF on a PCI-compliant path that bypasses your app entirely.\n- **Health data (HIPAA):** [Conversation Relay became HIPAA-eligible on March 17, 2025](https://www.twilio.com/en-us/changelog/conversationrelay-is-now-hipaa-eligible). Eligibility still requires a signed BAA with Twilio *and* that your LLM provider is covered under its own BAA before PHI touches your pipeline.\n\nPractical rule: instruct the system prompt to refuse card numbers and PHI and call `transfer_to_agent` instead.",
    },

    { type: "page-break" },

    { type: "section", title: "How Handoff Works" },

    {
      type: "image",
      src: "/images/illustrations/directional-sign.svg",
      alt: "A directional signpost — the agent deciding which path the call should take when a human is needed.",
      size: "md",
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "When the AI decides the caller needs a human, it closes the AI session and sends the server a summary of the conversation. The server can then transfer the call to a real person. The forwarded phone in this workshop does not display that summary; a real support system would show it to the person answering.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "When the AI decides the caller needs a human, your server sends a special \"end\" message to Twilio with a summary of the conversation. Twilio then closes the AI session and asks your server what to do next -- your server responds with instructions to transfer the call to a real person.",
    },

    {
      type: "callout",
      audience: "explorer",
      variant: "info",
      content:
        "For the caller, a good handoff starts with a clear transfer announcement. In this workshop, Twilio says it will transfer the call before dialing the human. The person answering the forwarded phone does not receive the summary. A production agent workspace should receive it so the caller does not have to repeat everything.",
    },

    {
      type: "callout",
      audience: "explorer",
      variant: "warning",
      content:
        "**Some information should never reach the AI.** Credit card numbers (PCI) and medical details (HIPAA) have strict rules about where data can travel. A good voice AI recognizes those moments and hands off to a human or a specialized secure flow instead of asking the caller to read the numbers aloud. Conversation Relay itself is [HIPAA-eligible as of March 17, 2025](https://www.twilio.com/en-us/changelog/conversationrelay-is-now-hipaa-eligible), but your LLM and the rest of your stack also need to qualify before any real health data travels through them.",
    },

    { type: "handoff-toggle", audience: "explorer" },

    { type: "page-break" },

    { type: "section", title: "The End Message with Handoff", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content: "To trigger a handoff, send this message to Twilio:",
    },

    {
      type: "json-message",
      audience: "builder",
      direction: "outbound",
      messageType: "end",
      code: `{
  "type": "end",
  "handoffData": "{\\"reasonCode\\":\\"live-agent-handoff\\",\\"reason\\":\\"billing_dispute\\",\\"summary\\":\\"Caller wants to dispute a charge of $49.99 on order 123. AI was unable to process the refund.\\",\\"callerId\\":\\"+15551234567\\"}"
}`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "The `handoffData` field carries context about the conversation to your action URL. This example logs `summary` in the Codespace terminal; the dialed phone does not receive it. A production agent workspace or routing system can attach that summary to the transferred call. `reasonCode: \"live-agent-handoff\"` marks this as a handoff; any other fields inside `handoffData` (`reason`, `summary`, `callerId`, order/account numbers) are yours to define.",
    },

    { type: "page-break" },

    { type: "section", title: "Setting Up the Action URL", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "You need to tell Twilio where to go after the AI session ends. Add an `action` attribute that points to a new route on your server:",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "**Update your existing `/twiml` response -- don't create a new one.** You already have a `<ConversationRelay>` element from earlier. Add `action=\"/call-ended\"` to the surrounding `<Connect>` on *that* response, then add the `/call-ended` route below to the same `server.js`. If you forget the `action` attribute, Twilio has no URL to POST `handoffData` to when the session ends, and the `end` message will close the WebSocket without triggering any transfer TwiML -- the call will just hang up.",
    },

    {
      type: "code",
      audience: "builder",
      language: "xml",
      file: "twiml-response",
      highlight: [6],
      code: `<!-- The only change vs. your existing TwiML is the new action="/call-ended"
     on <Connect>. Keep every other attribute you already have — voice,
     ttsProvider, welcomeGreeting, language, interruptible, etc. — untouched;
     the snippet below just shows where the new attribute goes. The
     Chirp3 / Google values are example placeholders only — do NOT swap
     the voice and ttsProvider picks you made earlier for these. -->
<Response>
  <Connect action="/call-ended">
    <ConversationRelay
      url="wss://<your-server-host>/ws"
      voice="en-US-Chirp3-HD-Aoede"
      ttsProvider="Google"
      welcomeGreeting="Hi, I'm your assistant. How can I help?"
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
        "When the AI session ends, Twilio asks your server what to do next. Your server checks whether the AI requested a handoff and responds with the right instructions:",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "info",
      content:
        "Add a second reachable phone number to your Codespace's `workshop/.env`, for example `HANDOFF_PHONE_NUMBER=+14155552671` for a teammate or facilitator. Use a number different from the phone receiving Call Me so the transfer can ring a person. It must be in E.164 format. Public Codespaces do not have this value preconfigured. Restart `npm run dev` after editing `.env` so the server loads it. Without a valid number, the agent will say live transfer is unavailable; the action URL also refuses to dial a placeholder. The workshop site's Call Me button uses the site's Twilio account (ask the facilitator); your Codespace's `/call` route uses the credentials in your `.env`. **Whichever account places the call must be upgraded for `<ConversationRelay>`**; [trial accounts block that noun](https://www.twilio.com/docs/usage/trials/try-out-voice#blocked-verbs), so verifying a phone number alone is insufficient. In production, you can replace the single number with a SIP endpoint or TaskRouter routing.",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["1-35"],
      code: `// Inside your http.createServer handler, add a route for the action URL:
if (req.url === "/call-ended" && req.method === "POST") {
  let body = "";
  req.on("data", (chunk) => body += chunk);
  req.on("end", () => {
    const params = new URLSearchParams(body);
    const handoffData = params.get("HandoffData");

    let twiml;
    let data = null;
    if (handoffData) {
      try { data = JSON.parse(handoffData); } catch {}
    }

    const handoffNumber = process.env.HANDOFF_PHONE_NUMBER || "";
    const canTransfer = /^\\+[1-9]\\d{1,14}$/.test(handoffNumber);

    if (data?.reasonCode === "live-agent-handoff" && canTransfer) {
      // AI requested a handoff -- transfer the call
      console.log("Handoff requested:", data.reason);
      console.log("Summary:", data.summary);

      twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please hold while I transfer you to a representative.</Say>
  <Dial><Number>\${handoffNumber}</Number></Dial>
</Response>\`;
    } else if (data?.reasonCode === "live-agent-handoff") {
      twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, live transfer is unavailable right now. Please call back later.</Say>
  <Hangup />
</Response>\`;
    } else {
      // Normal call end (or unrecognized reasonCode) -- just hang up
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
}`,
    },

    { type: "page-break" },

    { type: "section", title: "Triggering Handoff from a Tool Call", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Give the AI a `transfer_to_agent` tool. Add this to the `tools` array and `toolHandlers` object in `tool-handlers.js` (alongside the tools you defined earlier). When the AI decides the caller needs a human, the handler checks the destination and sends `end` immediately. The `/call-ended` TwiML speaks the transfer announcement once before dialing:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "tool-handlers.js",
      highlight: ["1-56"],
      code: `// Add to your tools array (alongside check_weather, lookup_order)
{
  type: "function",
  function: {
    name: "transfer_to_agent",
    description: "Transfer the caller to a live human agent. " +
      "Call this tool IMMEDIATELY when the caller asks for a human, " +
      "person, representative, agent, or someone else -- do not ask " +
      "follow-up questions first. Also call it when the caller's issue " +
      "involves billing disputes, account changes, or anything you " +
      "cannot resolve after one attempt.",
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

// Add to your toolHandlers object (alongside the other handlers)
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
}`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Update your existing `handleToolCalls` loop in `server.js` too. Collect each result before saving the tool exchange to this caller's history. If the handler sent `end`, stop instead of asking the LLM for another response; the action URL will speak before dialing. If the destination is unavailable, the handler has already spoken an honest fallback, so record that response and keep the caller in Conversation Relay. Leave the normal recursive response in place for weather, orders, and jokes. Add `transferring: false` to the object created by `stateFor(ws)`; when it becomes true, ignore new prompts in `handleMessage` until the WebSocket closes.",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      code: `// Inside your existing handleToolCalls loop, after running the handler:
toolMessages.push({
  role: "tool",
  tool_call_id: toolCall.id,
  content: JSON.stringify(result)
});

if (fnName === "transfer_to_agent" &&
    (result?.status === "transferring" || result?.status === "unavailable")) {
  // A handoff stops this loop, so omit any later, unhandled tool calls.
  assistantToolCall.tool_calls.length = toolMessages.length;
  state.conversationHistory.push(assistantToolCall, ...toolMessages);
  if (result.status === "transferring") {
    state.transferring = true;
    clearTimeout(state.silenceTimer);
    clearTimeout(state.endTimer);
  } else {
    state.conversationHistory.push({
      role: "assistant",
      content: "Sorry, live transfer is unavailable right now. I can still help here."
    });
  }
  return;
}

// Keep your existing state.conversationHistory.push(assistantToolCall, ...toolMessages)
// and await streamResponse(ws, iteration + 1) after the loop for other tools.`,
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      code: `// In stateFor(ws), add transferring: false to the new state object.
// In handleMessage, after parsing the message:
const state = stateFor(ws);
if (state.closed || state.transferring) return;`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Make keypad option 2 call that same handler. The older DTMF menu only *said* it would transfer; it never sent `end`. Change `handleDtmfInput` to `async function handleDtmfInput(ws, digit)`, then replace its `case \"2\"` with the block below. It stops any reply already streaming and checks the configured destination before sending handoff data. The existing `handleMessage` call can stay as it is.",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      code: `case "2": {
  const state = stateFor(ws);
  state.activeStream?.abort();
  state.activeStream = null;
  try {
    const result = await toolHandlers.transfer_to_agent({
      reason: "caller selected keypad option 2",
      department: "general",
      summary: "Caller requested a human representative by keypad."
    }, ws);
    if (result?.status === "transferring") {
      state.transferring = true;
      clearTimeout(state.silenceTimer);
      clearTimeout(state.endTimer);
    } else {
      resetSilenceTimer(ws);
    }
  } catch (err) {
    console.error("Handoff error:", err.message);
    sendText(ws, "Sorry, live transfer is unavailable right now.", true);
    resetSilenceTimer(ws);
  }
  break;
}`,
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "The transfer handler sends `end` without an audio delay. Twilio then runs the `/call-ended` TwiML in order: one `<Say>` announcement followed by `<Dial>`. Keep the announcement in that action response so there is no timed WebSocket sentence to clip or repeat.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "error",
      content:
        "**Do not pass sensitive information (credit card numbers, social security numbers, health records) through `handoffData` or through the AI.** This data gets logged by Twilio and stored on your server. If the caller needs to share payment or personal details, let the human agent collect it after the transfer -- not the AI.",
    },

    {
      type: "solution",
      audience: "builder",
      explanation:
        "Both files at the end of this step. `tool-handlers.js` adds the `transfer_to_agent` tool and handler alongside the earlier tools. `server.js` stops the LLM loop after handoff, sends keypad option 2 through that handler, adds `action=\"/call-ended\"` on `<Connect>`, and only dials a configured E.164 number from the `/call-ended` route. When copying this complete example, keep your chosen `<ConversationRelay>` settings from Chapter 3, including voice, provider, language, speech model, and welcome greeting; the `/twiml` values shown here are defaults.",
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
      transferring: false,
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

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
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
    if (state.activeStream === controller) state.activeStream = null;
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

    if (fnName === "transfer_to_agent" &&
        (result?.status === "transferring" || result?.status === "unavailable")) {
      assistantToolCall.tool_calls.length = toolMessages.length;
      state.conversationHistory.push(assistantToolCall, ...toolMessages);
      if (result.status === "transferring") {
        state.transferring = true;
        clearTimeout(state.silenceTimer);
        clearTimeout(state.endTimer);
      } else {
        state.conversationHistory.push({
          role: "assistant",
          content: "Sorry, live transfer is unavailable right now. I can still help here."
        });
      }
      return;
    }
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

async function handleDtmfInput(ws, digit) {
  switch (digit) {
    case "1":
      stateFor(ws).conversationHistory.push({
        role: "user",
        content: "I want to check my order status.",
      });
      streamResponse(ws);
      break;

    case "2": {
      const state = stateFor(ws);
      state.activeStream?.abort();
      state.activeStream = null;
      try {
        const result = await toolHandlers.transfer_to_agent({
          reason: "caller selected keypad option 2",
          department: "general",
          summary: "Caller requested a human representative by keypad."
        }, ws);
        if (result?.status === "transferring") {
          state.transferring = true;
          clearTimeout(state.silenceTimer);
          clearTimeout(state.endTimer);
        } else {
          resetSilenceTimer(ws);
        }
      } catch (err) {
        console.error("Handoff error:", err.message);
        sendText(ws, "Sorry, live transfer is unavailable right now.", true);
        resetSilenceTimer(ws);
      }
      break;
    }

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
  if (state.closed || state.transferring || ws.readyState !== 1) return;
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
  if (!msg || typeof msg !== "object") return;
  const state = stateFor(ws);
  if (state.closed || state.transferring) return;

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
  <Connect action="/call-ended">
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

  if (req.url === "/call-ended" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => body += chunk);
    req.on("end", () => {
      const params = new URLSearchParams(body);
      const handoffData = params.get("HandoffData");

      let twiml;
      let data = null;
      if (handoffData) {
        try { data = JSON.parse(handoffData); } catch {}
      }

      const handoffNumber = process.env.HANDOFF_PHONE_NUMBER || "";
      const canTransfer = /^\\+[1-9]\\d{1,14}$/.test(handoffNumber);

      if (data?.reasonCode === "live-agent-handoff" && canTransfer) {
        console.log("Handoff requested:", data.reason);
        console.log("Summary:", data.summary);

        twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please hold while I transfer you to a representative.</Say>
  <Dial><Number>\${handoffNumber}</Number></Dial>
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
      title: "Advanced routing strategies",
      content:
        "The action URL gives you full control over what happens after handoff. Some common patterns:\n\n**Dial a specific number** -- route to different phone numbers based on department or priority.\n**Enqueue** -- place the caller in a Twilio TaskRouter queue for skills-based routing.\n**Conference** -- bring the AI and human agent together for a warm handoff where the AI introduces the caller.\n**Callback** -- if no agents are available, offer to call the customer back.",
    },
  ],
} satisfies StepDefinition;
