import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "diagram", variant: "architecture", highlight: "stt-tts", showTools: true },

    { type: "section", title: "Choosing a Voice" },

    {
      type: "concept-card",
      audience: "explorer",
      title: "Voice = The Agent's First Impression",
      content:
        "The voice is the very first thing the caller hears -- before the greeting even finishes, they've already decided whether this feels trustworthy or robotic. Conversation Relay gives you a choice of providers (ElevenLabs, Google, Amazon) and dozens of voices within each, from warm and conversational to crisp and professional. Picking the right one shapes how the whole agent is perceived.",
    },

    {
      type: "prose",
      content:
        "The AI's text replies are converted into spoken audio automatically. The voice the caller hears can range from warm and conversational to crisp and professional, and different providers offer different strengths.",
    },

    { type: "section", title: "Voice Providers", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Conversation Relay supports three voice providers, each with different strengths:",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**ElevenLabs (default).** Known for the most natural, human-like voices. Supports a wide range of emotions and speaking styles. This is the default provider.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**Google Cloud TTS.** Offers reliable, clear voices with excellent multilingual support. A solid choice for a wide variety of languages.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**Amazon Polly.** Provides standard and neural voices at competitive pricing. Neural voices from Polly are quite natural, and it is a good option for high-volume workloads.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "info",
      content:
        "ElevenLabs is the default voice provider. It produces the most natural-sounding voices out of the box.",
    },

    { type: "page-break" },

    { type: "section", title: "Popular Voices", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Here are some popular voices across each provider. Use these as a starting point -- each provider has many more options in their documentation.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**ElevenLabs** (use the voice ID, not the display name): Rachel `21m00Tcm4TlvDq8ikWAM` (warm, female), Drew `29vD33N1CtxCmqQRPOHJ` (confident, male), Bella `EXAVITQu4vr4xnSDxMAC` (soft, female), Antoni `ErXwobaYiN019PkySvjV` (friendly, male), Elli `MF3mGyEYCl7XYWbV9V6O` (youthful, female).",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "tip",
      content:
        "**Preview ElevenLabs voices before you pick.** Try different voices side-by-side in the [ElevenLabs Voice Tester](https://elevenlabs-voice-tester-5339-dev.twil.io/index.html), then copy the **voice ID** of the one you like (Twilio's `voice` attribute requires the ID, not the display name).",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**Google Cloud TTS:** `en-US-Neural2-C` (female), `en-US-Neural2-D` (male), `en-US-Studio-O` (female, studio quality), `en-US-Studio-Q` (male, studio quality). Google also offers newer **Chirp3 HD** voices: `en-US-Chirp3-HD-Aoede` (female), `en-US-Chirp3-HD-Charon` (male), `en-US-Chirp3-HD-Kore` (female), and six more. The naming pattern is `language-Model-Quality-VoiceName`.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**Amazon Polly** (neural voices require the `-Neural` suffix): `Joanna-Neural` (female), `Matthew-Neural` (male), `Lupe-Neural` (female, bilingual en/es), `Amy-Neural` (female, British English).",
    },

    { type: "page-break" },

    { type: "section", title: "Configuring the Voice", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "To set a specific voice, update the Conversation Relay settings in your server. Add the `voice` attribute with the voice ID (or voice name for Google and Amazon), and the `ttsProvider` attribute to select the provider:",
    },

    {
      type: "code",
      audience: "builder",
      language: "xml",
      file: "TwiML Response",
      highlight: [6, 7],
      code: `<!-- Using ElevenLabs (default provider) -->
<!-- Keep welcomeGreeting from Chapter 2; only the voice and ttsProvider
     attributes are new in this step.
     The url is filled in dynamically by your /twiml handler using
     req.headers.host — you don't hardcode the hostname. -->
<Response>
  <Connect>
    <ConversationRelay
      url="wss://<your-server-host>/ws"
      voice="21m00Tcm4TlvDq8ikWAM"
      ttsProvider="ElevenLabs"
      welcomeGreeting="Hello! How can I help you today?"
    />
  </Connect>
</Response>`,
    },

    {
      type: "code",
      audience: "builder",
      language: "xml",
      file: "TwiML Response",
      highlight: [6, 7],
      code: `<!-- Using Google Cloud TTS -->
<Response>
  <Connect>
    <ConversationRelay
      url="wss://<your-server-host>/ws"
      voice="en-US-Neural2-C"
      ttsProvider="Google"
      welcomeGreeting="Hello! How can I help you today?"
    />
  </Connect>
</Response>`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "In your server code, the voice settings go inside the TwiML that Twilio reads when a call connects:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "server.js",
      highlight: [8, 9],
      code: `// Inside your http.createServer handler. Keep welcomeGreeting
// from Chapter 2 \u2014 only voice and ttsProvider are new.
if (req.url === "/twiml" && req.method === "POST") {
  const twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="wss://\${req.headers.host}/ws"
      voice="21m00Tcm4TlvDq8ikWAM"
      ttsProvider="ElevenLabs"
      welcomeGreeting="Hello! How can I help you today?"
    />
  </Connect>
</Response>\`;

  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml);
}`,
    },

    {
      type: "callout",
      variant: "tip",
      content:
        "Match the voice to the persona you picked earlier. **Professional Concierge** pairs with a polished, clear voice. **Casual Helper** sounds best with something warmer and more relaxed. **Friendly Assistant** sits in between -- any of the defaults will land well.",
    },

    {
      type: "deep-dive",
      audience: "builder",
      title: "Voice Latency Considerations",
      content:
        "Different TTS providers have different latency profiles. ElevenLabs voices are extremely natural but may add a few extra milliseconds of processing time compared to Amazon Polly. For most use cases, the difference is negligible because Conversation Relay streams audio incrementally. However, if you are building a latency-critical application and notice delays, experiment with providers to find the best balance between voice quality and response speed.",
    },

    {
      type: "deep-dive",
      audience: "builder",
      title: "Models behind each provider",
      content:
        "`<ConversationRelay>` exposes three knobs for choosing a model: `ttsProvider`, `voice`, and (for STT) `speechModel`. You rarely pick a model by name -- it's selected implicitly from the provider default, the voice ID you pass, or, for ElevenLabs, a hyphen suffix on the voice ID.\n\n**ElevenLabs TTS models.** ElevenLabs voices run on **`flash_v2_5`** (Flash 2.5) by default. The other supported models are `flash_v2`, `turbo_v2`, and `turbo_v2_5`. To pick a non-default model, append it to the voice ID with a hyphen -- for example `voice=\"<voiceId>-turbo_v2_5\"`. Model/language support varies, so confirm the combo works for your target language before switching.\n\n**Google TTS models.** Google offers **Standard**, **WaveNet**, **Neural2**, and **Chirp3-HD** voice tiers. There is no separate model attribute -- the voice ID carries the tier. For example, `en-US-Wavenet-D` selects WaveNet and `en-US-Chirp3-HD-Aoede` selects Chirp3-HD.\n\n**Amazon Polly TTS models.** Polly has **Standard**, **Neural**, and **Generative** tiers. Same pattern as Google: the voice ID encodes the tier, so picking `Joanna-Neural` vs. `Joanna-Generative` is how you switch models.\n\n**STT models (`speechModel` attribute).** Defaults are `telephony` for Google, `nova-3-general` for Deepgram languages that support it, and `nova-2-general` for the rest. If you turn on automatic multi-language detection (`multi`), you must use `transcriptionProvider=\"Deepgram\"` with `speechModel` set to `nova-2-general` or `nova-3-general`.",
    },

    {
      type: "voice-picker",
      audience: "explorer",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Pick a voice that fits your persona and update your server. In the next step, we will configure how the agent listens to the caller.",
    },

    {
      type: "solution",
      audience: "builder",
      file: "server.js",
      language: "javascript",
      explanation:
        "The complete `server.js` at the end of this step. The only change from the previous step is inside the `/twiml` handler: the `ConversationRelay` element now declares `voice=\"21m00Tcm4TlvDq8ikWAM\"` (Rachel's ElevenLabs voice ID) and `ttsProvider=\"ElevenLabs\"` so Twilio uses that voice for the whole call. Swap in any voice/provider combo from the tables above.",
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
        "Your voice selection is saved. The agent will use this voice on your next call.",
    },
  ],
} satisfies StepDefinition;
