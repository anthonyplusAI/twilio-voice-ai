import type { StepDefinition } from "@/lib/content-blocks";

export default {
    blocks: [
        {
            type: "diagram",
            variant: "architecture",
            highlight: "setup",
            showTools: true,
        },

        { type: "section", title: "Starting the Call" },

        {
            type: "concept-card",
            audience: "explorer",
            title: "",
            content:
                'In this workshop the server dials your phone, not the other way around. That takes two separate instructions from the server to Twilio. The first instruction says "please dial this phone number now" -- that is what makes your phone actually ring. The second instruction, handed over the moment you pick up, says "this is not a normal call; hand every turn to the AI agent." Both instructions have to be in place before the first call works.',
        },

        {
            type: "prose",
            audience: "builder",
            content:
                'Your server needs two things: a way to trigger an outbound call, and instructions that tell Twilio what to do when someone answers. Twilio calls these instructions TwiML -- a short XML response that says "connect this call to my AI agent via Conversation Relay."',
        },

        {
            type: "prose",
            audience: "builder",
            content: "The Codespace installed the Twilio SDK from `workshop/package.json`. If you are building locally or installation was interrupted, run this from `workshop/`:",
        },

        {
            type: "code",
            audience: "builder",
            language: "bash",
            code: "npm ci",
        },

        { type: "section", title: "The TwiML Endpoint", audience: "builder" },

        {
            type: "prose",
            audience: "builder",
            content:
                "When Twilio connects the call, it asks your server what to do. Add a `/twiml` route that tells Twilio to use Conversation Relay:",
        },

        {
            type: "code",
            audience: "builder",
            language: "javascript",
            file: "server.js",
            startLine: 8,
            highlight: ["2-17"],
            code: `const server = http.createServer((req, res) => {
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

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket server is running");
});`,
        },

        { type: "page-break" },

        {
            type: "concept-card",
            audience: "explorer",
            title: "The Welcome Greeting",
            content:
                'The very first thing you hear when you pick up is a welcome greeting. It is a single line of text, and Twilio speaks it aloud the moment the call connects -- before the AI has said a word. That way there is no awkward silence while the AI is thinking about what to say first. For now the line is a generic "Hello! How can I help you today?".',
        },

        {
            type: "image",
            audience: "explorer",
            src: "/images/illustrations/woman-looking-at-phone.svg",
            alt: "A person holding a phone to their ear, listening -- the caller hearing the agent's welcome greeting for the first time.",
            size: "md",
        },

        {
            type: "section",
            title: "Initiate the Outbound Call",
            audience: "builder",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "Add a `/call` endpoint that dials your phone and points Twilio at the TwiML route:",
        },

        {
            type: "callout",
            audience: "builder",
            variant: "info",
            content:
                "**Env vars used below.** The optional Codespace `/call` route references four variables from `workshop/.env`:\n\n- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` -- identify the account placing this outbound call\n- `TWILIO_PHONE_NUMBER` -- the number this call originates from\n- `MY_PHONE_NUMBER` -- the personal number receiving this call\n\nThe website's Call Me button uses the site's Twilio account instead. If you use your own Codespace `/call` route, the account must be upgraded: [trial accounts block ConversationRelay](https://www.twilio.com/docs/usage/trials/try-out-voice#blocked-verbs). Get the SID/token from [console.twilio.com](https://console.twilio.com) and a voice-capable number from Phone Numbers.",
        },

        {
            type: "code",
            audience: "builder",
            language: "javascript",
            file: "server.js",
            startLine: 1,
            highlight: [4, "8-11", 13, "30-48"],
            code: `require("dotenv").config();
const { WebSocketServer } = require("ws");
const http = require("http");
const twilio = require("twilio");

const PORT = 8080;

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
});`,
        },

        { type: "page-break" },

        {
            type: "concept-card",
            audience: "explorer",
            title: "The Dials Already Turned",
            content:
                "The instruction Twilio receives also carries a few settings such as which voice the agent speaks with (default is ElevenLabs), which service listens to the caller (default is Deepgram), and whether the caller is allowed to interrupt the AI mid-sentence (default is yes, by either voice or keypad). Voice and transcription choices open up in a later chapter, and interruption gets a full workout after that.",
        },

        {
            type: "prose",
            audience: "explorer",
            content:
                "Throughout all of this, the server itself never touches any audio. Twilio's side handles turning the caller's speech into text on the way in, and turning the AI's text into speech on the way out. The Builder's server only ever works with plain text -- no microphones, no speakers, no audio files.",
        },

        {
            type: "section",
            title: "Key Conversation Relay Attributes",
            audience: "builder",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "Your TwiML response included a few Conversation Relay attributes. Here is what each one does so you can tune them for your own agent later.",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "**url** -- Secure WebSocket address (`wss://`) where Twilio connects to your server. The code uses `req.headers.host`, so requests made through your public tunnel produce the tunnel's WebSocket address.",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "**welcomeGreeting** -- Twilio speaks this immediately when the call connects, before your server does anything. Avoids initial silence.",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "**ttsProvider / transcriptionProvider** -- Defaults to **ElevenLabs** (text-to-speech) and **Deepgram** (speech-to-text) when omitted, which is why the TwiML above works without specifying them. You'll set these explicitly later when you pick a voice and configure the language.",
        },

        {
            type: "callout",
            audience: "builder",
            variant: "warning",
            content:
                "The `url` must use `wss://`, not `ws://`. `wss://` is the encrypted version of WebSocket (same relationship as `https://` vs `http://`) -- a plain `ws://` connection sends JSON in the clear, so Twilio rejects it for compliance reasons. Codespace port forwarding terminates TLS for you, so your server can listen on plain HTTP internally while the outside world sees `wss://` automatically.",
        },

        {
            type: "deep-dive",
            audience: "builder",
            title: "Why your server only sees text",
            content:
                "Your server never touches raw audio. Twilio's media servers handle STT and TTS on either side of the WebSocket, so you avoid dealing with audio codecs, voice activity detection, or echo cancellation -- which you *would* have to handle with the [Media Streams](https://www.twilio.com/docs/voice/media-streams) API. Your server only works with JSON text messages.",
        },

        {
            type: "solution",
            audience: "builder",
            file: "server.js",
            language: "javascript",
            explanation:
                "The complete server after adding TwiML and the /call endpoint. The WebSocket handler is in place but does not yet send anything to an LLM.",
            code: `require("dotenv").config();
const { WebSocketServer } = require("ws");
const http = require("http");
const twilio = require("twilio");

const PORT = 8080;

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
