import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "diagram", variant: "architecture", highlight: "llm" },

    { type: "section", title: "What Is a System Prompt?" },

    {
      type: "concept-card",
      audience: "explorer",
      title: "The System Prompt Shapes Behavior",
      content:
        "The system prompt is a single paragraph handed to the AI at the start of every call -- it's the backstory, job description, and rulebook all at once. It's why the same AI can be a cheerful pizza-ordering bot on one call and a calm medical intake nurse on the next. The words in that paragraph shape the entire personality and scope of the agent.",
    },

    {
      type: "concept-card",
      audience: "explorer",
      title: "Same Caller, Two Different Agents",
      content:
        "Imagine a caller asks, \"What are your hours?\" Given a system prompt that describes a warm pizza shop helper, the agent might reply, \"We're slinging pies until midnight tonight -- want to order something?\" Given a system prompt that describes a formal hotel concierge, the same caller gets, \"The front desk is open twenty-four hours. May I help you with a reservation?\" Same caller, same question, two completely different experiences -- and the only thing that changed was the paragraph at the top.",
    },

    {
      type: "concept-card",
      audience: "explorer",
      title: "What Lives in a Good Prompt",
      content:
        "A strong system prompt covers three things: who the agent is (a name, a role, a tone), what it should and shouldn't do (the boundaries), and how it should sound on the phone (short, conversational, no reading lists aloud). Get those three right and the agent feels like a real person. Miss any one of them and the caller hears it immediately.",
    },

    {
      type: "callout",
      audience: "explorer",
      variant: "info",
      content:
        "In the next step, you'll shape your own agent's personality -- pick a preset like Friendly Assistant or Professional Concierge, or write your own -- and then call it to hear the difference.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "The system prompt is a set of instructions you give the AI before every conversation. It defines **who** the agent is, **how** it should behave, and **what** it should (and should not) do. Think of it as the agent's backstory, personality, and operating manual rolled into one.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "For voice AI, the system prompt matters even more than in a chat app. Your caller can't skim a long paragraph or scroll back -- they hear every word in real time. So the instructions must push the AI to speak concisely, like a real person on the phone.",
    },

    { type: "page-break" },

    { type: "section", title: "Voice AI Prompt Principles", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Writing prompts for voice is different from writing prompts for chat. Keep these principles in mind:",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**1. Keep responses short.** A good voice response is one to two sentences. Long monologues lose the caller. Tell the AI to be brief and to ask follow-up questions instead of dumping information.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**2. Tell the AI to speak conversationally.** You're writing instructions the AI will read, not a script it will recite -- so bullets and structure in your prompt are fine (you'll see them in the solution below). What matters is the AI's *output*: tell it to answer the way people actually talk on the phone, not the way a web page is laid out.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**3. Ban markdown in the AI's responses.** Asterisks, headers, and bullet markers make no sense when spoken aloud -- the voice engine might read them literally (\"asterisk asterisk\"). Put an explicit rule in the prompt telling the AI not to use any formatting in what it says back.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**4. Handle edge cases.** What happens if the caller asks something off-topic? What if they're rude? Define these boundaries in the prompt so the agent stays on track.",
    },

    { type: "page-break" },

    { type: "section", title: "Adding the System Message", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Update the `messages` array in your `streamLLMResponse` -- replace the two-line version with a single line that passes `conversationHistory` directly. The old hardcoded system message goes away; it'll live in conversation history instead (you'll wire that up in the next step).",
    },

    {
      type: "prose",
      audience: "builder",
      content: "**Before** (your existing `streamLLMResponse`):",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      code: `messages: [
  { role: "system", content: "You are a helpful phone assistant..." },
  ...conversationHistory,
],`,
    },

    {
      type: "prose",
      audience: "builder",
      content: "**After:**",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      code: `messages: conversationHistory,`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "The system prompt shifts into the conversation history itself -- it becomes the first thing the AI reads for every call. Two changes:",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**1.** Pull the prompt out into a constant (so you can edit it in one place):",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["1-5"],
      code: `const SYSTEM_PROMPT = \`You are a helpful voice assistant for Twilio-Mart.
Keep your responses brief \u2014 one to two sentences at most.
Speak naturally and conversationally.
Never use markdown, bullet points, or numbered lists.
If you don't know something, say so honestly.\`;`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**2.** Seed `conversationHistory` with the system message when each call connects -- the `messages: conversationHistory` change you just made above will then send it to the LLM automatically:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: ["3-7"],
      code: `wss.on("connection", (ws) => {
  let callSid = null;
  // Seed each call with the system prompt. Every LLM turn will include
  // it, because openai.chat.completions.create receives the whole history.
  const conversationHistory = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // ...rest of the setup/prompt handlers you already have
});`,
    },

    {
      type: "callout",
      audience: "builder",
      variant: "tip",
      content:
        "Read the AI's responses out loud. If they sound natural when spoken, the prompt is on the right track. If you hear formatting characters like asterisks or bullet markers, remove them from the instructions -- the caller hears raw text.",
    },

    { type: "section", title: "Your Turn", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Write a system prompt for your agent. Think about what kind of assistant you want to build -- a restaurant booking agent, a tech support helper, a friendly concierge -- then craft a prompt that defines the personality and keeps responses voice-friendly.",
    },

    {
      type: "solution",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      explanation:
        "The complete `server.js` at the end of this step. A module-scope `SYSTEM_PROMPT` constant holds the persona, `conversationHistory` is seeded with it on every new WebSocket connection, and `streamLLMResponse` passes the whole history to OpenAI (so the hardcoded system message from before is gone). Ava is a sample persona -- adapt the prompt to your own use case.",
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

const SYSTEM_PROMPT = \`You are Ava, a friendly and professional virtual concierge
for Twilio-Mart. You help callers with appointment scheduling, general
company information, and directing them to the right department.

Guidelines:
- Keep every response to one or two sentences.
- Speak naturally as if you're having a real phone conversation.
- Never use markdown, lists, bullet points, or special formatting.
- If the caller asks about something outside Twilio-Mart, politely
  redirect them: "I'm only able to help with Twilio-Mart questions,
  but I'd be happy to transfer you to someone who can help."
- If you don't know the answer, say so and offer to connect them
  with a human agent.
- Always confirm actions before taking them: "Just to confirm, you'd
  like to book an appointment for Tuesday at 3pm, is that right?"
- Be warm and personable. Use the caller's name if they share it.\`;

const server = http.createServer(async (req, res) => {
  if (req.url === "/twiml" && req.method === "POST") {
    const twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="wss://\${req.headers.host}/ws"
      welcomeGreeting="Hello! How can I help you today?"
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

      console.log("\u{1F4DE} Call initiated:", call.sid);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ callSid: call.sid }));
    } catch (error) {
      console.error("\u274C Call error:", error.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket server is running");
});

function sendText(ws, token, last = false) {
  ws.send(JSON.stringify({ type: "text", token, last }));
}

async function streamLLMResponse(ws, conversationHistory) {
  try {
    const stream = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4-nano",
      messages: conversationHistory,
      stream: true,
    });

    let fullResponse = "";

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (!content) continue;

      fullResponse += content;
      sendText(ws, content);
    }

    sendText(ws, "", true);

    conversationHistory.push({
      role: "assistant",
      content: fullResponse,
    });

  } catch (error) {
    console.error("\u274C LLM error:", error);
    const apology = "I'm sorry, I encountered an error. Could you repeat that?";
    sendText(ws, apology, true);
    conversationHistory.push({ role: "assistant", content: apology });
  }
}

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("\u{1F4DE} New WebSocket connection");

  let callSid = null;
  const conversationHistory = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  ws.on("message", (data) => {
    const message = JSON.parse(data);

    switch (message.type) {
      case "setup":
        callSid = message.callSid;
        console.log(\`\u2705 Call started: \${callSid}\`);
        console.log(\`\u{1F464} From: \${message.from}\`);
        break;

      case "prompt":
        if (!message.last) break;

        console.log(\`\u{1F5E3}\uFE0F Caller: \${message.voicePrompt}\`);

        conversationHistory.push({
          role: "user",
          content: message.voicePrompt,
        });

        streamLLMResponse(ws, conversationHistory);
        break;

      default:
        console.log("\u26A0\uFE0F Unhandled message type:", message.type);
    }
  });

  ws.on("close", () => {
    console.log(\`\u{1F44B} Call ended: \${callSid}\`);
  });

  ws.on("error", (err) => {
    console.error("\u274C WebSocket error:", err);
  });
});

server.listen(PORT, () => {
  console.log(\`\u{1F680} Server listening on port \${PORT}\`);
});`,
    },
  ],
} satisfies StepDefinition;
