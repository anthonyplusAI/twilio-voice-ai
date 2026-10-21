import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "diagram", variant: "architecture", highlight: "llm", showTools: true },

    { type: "section", title: "The AI Responds" },

    {
      type: "concept-card",
      audience: "explorer",
      title: "How the AI Talks Back",
      content:
        "The server sends the caller's words to an AI model. Instead of waiting for the full reply, each word is sent to Twilio as it is generated -- so the caller hears the AI start talking almost immediately, just like a real conversation.",
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "This is a big part of why the agent feels natural. Older phone bots pause after every question and play a pre-recorded response, which makes them sound like they are reading from a script. Streaming the reply word by word means the AI starts answering the moment it has something to say, not after it finishes thinking.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Send the caller's words to OpenAI, stream the response token by token, and forward each token to Twilio. The caller hears speech within milliseconds instead of waiting seconds for the full reply.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "The Codespace installed the OpenAI SDK from `workshop/package.json`. If you are building locally or installation was interrupted, run this from `workshop/`:",
    },

    {
      type: "code",
      audience: "builder",
      language: "bash",
      code: "npm ci",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Add the import and client at the top of `server.js`:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      startLine: 1,
      highlight: [5, "13-15"],
      code: `require("dotenv").config();
const { WebSocketServer } = require("ws");
const http = require("http");
const twilio = require("twilio");
const OpenAI = require("openai");

const PORT = 8080;

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});`,
    },

    { type: "page-break" },

    { type: "section", title: "Outbound Text Messages", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Your server sends text back to Twilio as JSON messages. Each carries a piece of the reply. Set `last: false` on every chunk except the final one -- `last: true` tells Twilio the response is complete.",
    },

    {
      type: "json-message",
      audience: "builder",
      direction: "outbound",
      messageType: "text (streaming token)",
      code: `{
  "type": "text",
  "token": "Sure, I'd be happy to ",
  "last": false
}`,
    },

    {
      type: "json-message",
      audience: "builder",
      direction: "outbound",
      messageType: "text (final token)",
      code: `{
  "type": "text",
  "token": "help. What's going on?",
  "last": true
}`,
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "You **must** send exactly one message with `last: true` to end the response. Missing it causes silence. Sending it more than once creates separate utterances.",
    },

    { type: "page-break" },

    { type: "section", title: "Streaming Implementation", audience: "builder" },

    {
      type: "callout",
      audience: "builder",
      variant: "info",
      content:
        "**Heads up — this function will evolve.** You'll build `streamLLMResponse` here as the simplest possible version: take a prompt, stream a reply. Over the next few chapters it gets refactored (later it moves to module scope and is renamed `streamResponse`) and replaced twice (once for language switching, once for tool calling). That's expected — every refactor is signposted where it happens. Start with the small version here.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Create a helper and a streaming function that forwards each token to Twilio:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      startLine: 60,
      highlight: ["1-44"],
      code: `function sendText(ws, token, last = false) {
  ws.send(JSON.stringify({ type: "text", token, last }));
}

async function streamLLMResponse(ws, conversationHistory) {
  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: [
        {
          role: "system",
          content: "You are a helpful phone assistant. Keep responses concise and conversational -- the caller is listening, not reading.",
        },
        ...conversationHistory,
      ],
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
    console.error("❌ LLM error:", error);
    const apology = "I'm sorry, I encountered an error. Could you repeat that?";
    sendText(ws, apology, true);
    // Keep history aligned: add a matching assistant turn so subsequent
    // calls do not see two user turns in a row.
    conversationHistory.push({ role: "assistant", content: apology });
  }
}`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Find the `case \"prompt\":` block in your `wss.on(\"message\", ...)` handler (look for the `// TODO: Send to LLM and stream response back` comment you added earlier) and replace the whole block with this -- the highlighted line is the new call to your streaming function:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: [11],
      code: `      case "prompt":
        if (!message.last) break;

        console.log(\`🗣️ Caller: \${message.voicePrompt}\`);

        conversationHistory.push({
          role: "user",
          content: message.voicePrompt,
        });

        streamLLMResponse(ws, conversationHistory);

        break;`,
    },

    {
      type: "callout",
      audience: "builder",
      variant: "tip",
      content:
        "No `await` -- the function streams in the background so your server can keep handling incoming messages (new prompts, setup events) while tokens are still streaming.",
    },

    {
      type: "deep-dive",
      audience: "builder",
      title: "Why stream instead of waiting for the full response?",
      content:
        "A full LLM response can take 2-5 seconds to generate. If you wait for the complete response before sending it, the caller sits in silence for that entire duration -- which feels unnatural and broken on a phone call. By streaming tokens as they arrive, Twilio can begin text-to-speech within 200-500ms. The caller hears the AI start speaking almost immediately, just like a real conversation.",
    },

    {
      type: "solution",
      audience: "builder",
      file: "server.js",
      language: "javascript",
      explanation:
        "The complete server with OpenAI streaming. Each token is forwarded to Twilio as a text message, and the full response is saved to conversation history.",
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

      console.log("📞 Call initiated:", call.sid);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ callSid: call.sid }));
    } catch (error) {
      console.error("❌ Call error:", error.message);
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
      model: "gpt-5.4-nano",
      messages: [
        {
          role: "system",
          content: "You are a helpful phone assistant. Keep responses concise and conversational -- the caller is listening, not reading.",
        },
        ...conversationHistory,
      ],
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
    console.error("❌ LLM error:", error);
    const apology = "I'm sorry, I encountered an error. Could you repeat that?";
    sendText(ws, apology, true);
    conversationHistory.push({ role: "assistant", content: apology });
  }
}

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("📞 New WebSocket connection");

  let callSid = null;
  const conversationHistory = [];

  ws.on("message", (data) => {
    const message = JSON.parse(data);

    switch (message.type) {
      case "setup":
        callSid = message.callSid;
        console.log(\`✅ Call started: \${callSid}\`);
        console.log(\`👤 From: \${message.from}\`);
        break;

      case "prompt":
        if (!message.last) break;

        console.log(\`🗣️ Caller: \${message.voicePrompt}\`);

        conversationHistory.push({
          role: "user",
          content: message.voicePrompt,
        });

        streamLLMResponse(ws, conversationHistory);
        break;

      default:
        console.log("⚠️ Unhandled message type:", message.type);
    }
  });

  ws.on("close", () => {
    console.log(\`👋 Call ended: \${callSid}\`);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err);
  });
});

server.listen(PORT, () => {
  console.log(\`🚀 Server listening on port \${PORT}\`);
});`,
    },
  ],
} satisfies StepDefinition;
