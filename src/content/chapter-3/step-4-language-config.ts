import type { StepDefinition } from "@/lib/content-blocks";

export default {
    blocks: [
        { type: "section", title: "Speech-to-Text Configuration", audience: "builder" },
        { type: "section", title: "How the Agent Understands You", audience: "explorer" },

        {
            type: "concept-card",
            audience: "explorer",
            title: "Speech Recognition",
            content:
                "Your AI agent automatically converts the caller's spoken words into text using speech-to-text technology. This happens behind the scenes so the agent can understand and respond to anything the caller says. You choose the language (English, Spanish, and many more) and the system handles the rest. For most conversations the defaults work perfectly.",
        },

        {
            type: "image",
            audience: "explorer",
            src: "/images/illustrations/rotary-phone.svg",
            alt: "A classic rotary phone — evoking the timeless act of speaking into a receiver, now understood and transcribed by the AI.",
            size: "md",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "Your agent already turns the caller's voice into text automatically. In this step, you can fine-tune how that works -- choosing which language the system listens for and which speech recognition engine it uses for better accuracy.",
        },

        {
            type: "section",
            title: "Speech Recognition Providers",
            audience: "builder",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "**Deepgram** is the default provider — fast, low-latency, and optimized for English. **Google Cloud Speech-to-Text** offers stronger multilingual support across dozens of languages.",
        },

        {
            type: "section",
            title: "Configuring Language and Provider",
            audience: "builder",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "You configure speech recognition settings in your Conversation Relay instructions. The key settings are: **`language`** — the language code the caller will speak (e.g., `en-US` for English, `es-ES` for Spanish). **`transcriptionProvider`** — which service listens to the caller: `Deepgram` (default) or `Google`. **`speechModel`** — the specific recognition model, balancing speed vs. accuracy. `nova-3-general` is the Deepgram default for supported languages; for unsupported languages, Deepgram falls back to `nova-2-general` automatically.",
        },

        {
            type: "code",
            audience: "builder",
            language: "xml",
            file: "TwiML Response",
            highlight: [7, 8, 9],
            code: `<!-- Keep welcomeGreeting from Chapter 2;
     language, transcriptionProvider, and speechModel are new in this step.
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
    />
  </Connect>
</Response>`,
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "Here is the same configuration using Google as the speech recognition provider, with Spanish as the language. Notice that `voice` and `ttsProvider` also switch to Google here -- ElevenLabs' Spanish voice coverage is narrower than Google's, so for non-English you often pair Google STT with a Google TTS voice. If you are staying in English, keep the ElevenLabs voice you picked earlier.",
        },

        {
            type: "code",
            audience: "builder",
            language: "xml",
            file: "TwiML Response",
            highlight: ["5-9"],
            code: `<!-- Same setup, Google providers in Spanish.
     The url is filled in dynamically by your /twiml handler — the placeholder
     is only there so the example shows where it lives. -->
<Response>
  <Connect>
    <ConversationRelay
      url="wss://<your-server-host>/ws"
      voice="es-ES-Neural2-H"
      ttsProvider="Google"
      language="es-ES"
      transcriptionProvider="Google"
      speechModel="telephony"
      welcomeGreeting="¡Hola! ¿En qué puedo ayudarte hoy?"
    />
  </Connect>
</Response>`,
        },

        { type: "page-break" },

        { type: "section", title: "Supported Languages" },

        {
            type: "image",
            src: "/images/illustrations/hugging-earth.svg",
            alt: "A person hugging the Earth — a warm visual for language support spanning the globe.",
            size: "md",
        },

        {
            type: "concept-card",
            title: "Supported Languages",
            content:
                "30+ languages are supported, each with regional variants so the agent can match how a caller actually speaks -- US English vs. British English, European Spanish vs. Mexican Spanish, and so on. That matters for tone as much as translation: a brand that wants to sound local in São Paulo can pick Brazilian Portuguese specifically, instead of a generic European Portuguese voice.",
        },

        {
            type: "callout",
            audience: "builder",
            variant: "tip",
            content:
                "If your agent handles a single language, set the `language` attribute explicitly. This helps the speech recognizer optimize for that language and improves accuracy. You should also tell your AI to respond in the same language via the system prompt.",
        },

        { type: "page-break" },

        {
            type: "section",
            title: "Putting It All Together",
            audience: "builder",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "Update your TwiML endpoint to include both voice and language configuration:",
        },

        {
            type: "code",
            audience: "builder",
            language: "javascript",
            file: "server.js",
            highlight: [10, 11, 12],
            code: `// Inside your http.createServer handler. Keep welcomeGreeting
// from Chapter 2 \u2014 language, transcriptionProvider,
// and speechModel are new in this step.
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
    />
  </Connect>
</Response>\`;

  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml);
}`,
        },

        {
            type: "deep-dive",
            audience: "builder",
            title: "Transcription Accuracy Considerations",
            content:
                "STT accuracy is affected by several factors beyond provider choice. Background noise, accents, speaking speed, and domain-specific vocabulary all play a role.\n\n**Phone audio is lower quality.** Phone calls typically use 8kHz narrowband audio. Conversation Relay defaults to Deepgram's `nova-3-general` (or `nova-2-general` for languages that don't support Nova 3) and Google's `telephony` model — both tuned for real-time conversational audio.\n\n**Domain vocabulary matters.** If your agent handles medical, legal, or technical conversations, the transcriber may struggle with jargon. Have your LLM ask for clarification when it encounters ambiguous terms.\n\n**Latency vs. accuracy trade-off.** Some models prioritize speed while others prioritize accuracy by waiting for more audio context. For real-time conversations, lower latency is usually preferred.\n\n**Provider strengths.** Deepgram excels at real-time English transcription with very low latency. Google Cloud Speech-to-Text shines for multilingual support and is a good choice if you need non-English languages or already use Google Cloud TTS.",
        },

        {
            type: "language-picker",
            audience: "explorer",
        },

        {
            type: "callout",
            variant: "warning",
            audience: "builder",
            content:
                'Make sure your system prompt language matches the `language` attribute. If you set `language="es-ES"` but your system prompt is in English, the AI will respond in English and the caller experience will be inconsistent.',
        },

        {
            type: "solution",
            audience: "builder",
            file: "server.js",
            language: "javascript",
            explanation:
                'The complete `server.js` at the end of this step. Building on the voice-selection step, the `/twiml` handler now also declares `language="en-US"`, `transcriptionProvider="Deepgram"`, and `speechModel="nova-3-general"` so the speech recognizer is tuned for English phone audio. Swap the language code and provider to match the caller\'s language.',
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
      voice="21m00Tcm4TlvDq8ikWAM"
      ttsProvider="ElevenLabs"
      language="en-US"
      transcriptionProvider="Deepgram"
      speechModel="nova-3-general"
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

        {
            type: "prose",
            audience: "explorer",
            content:
                "Your language selection is saved. The agent will listen for and speak this language on your next call.",
        },
    ],
} satisfies StepDefinition;
