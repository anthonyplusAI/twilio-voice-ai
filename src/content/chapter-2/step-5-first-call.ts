import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "diagram", variant: "architecture", highlight: "all" },

    { type: "section", title: "Make Your First Call" },

    {
      type: "prose",
      audience: "explorer",
      content:
        "Everything is connected. Enter your phone number below and Twilio will call you so you can talk to the AI agent live.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "All the pieces are in place. Let's test it end to end.",
    },

    { type: "section", title: "Pre-Flight Checklist", audience: "builder" },

    {
      type: "prose",
      audience: "builder",
      content:
        "**1.** `OPENAI_API_KEY` is set in `workshop/.env`. Add upgraded Twilio credentials and `MY_PHONE_NUMBER` only if you plan to use `npm run call` with your own account. The workshop site's Call Me button uses the site's upgraded Twilio account to reach your server.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**2.** Your Cloudflare tunnel is running. Run `tunnel-url` in the terminal to print your public TwiML URL -- you'll need it in the widget below.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**3.** From `workshop/`, start the development server. It restarts when you save changes to `server.js` or imported JavaScript files. If you change `.env`, stop it with Ctrl+C and start it again:",
    },

    {
      type: "terminal",
      audience: "builder",
      commands: `$ npm run dev
🚀 Server listening on port 8080`,
    },

    { type: "section", title: "Call Me" },

    {
      type: "prose",
      audience: "explorer",
      content:
        "The workshop pre-wired the phone system, so nothing on your side needs setup -- just type your number below and Twilio will ring you once. You can hang up at any time.",
    },

    {
      type: "prose",
      content:
        "Enter your phone number (with country code, like +12065551234) and hit Call Me.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**Finding Your TwiML URL.** Run `tunnel-url` in your Codespace terminal -- it prints your public TwiML URL, something like `https://random-words-abc123.trycloudflare.com/twiml`. Copy that and paste it into the widget below. That's the `/twiml` route you wrote earlier in this chapter. When you click Call Me, the workshop site reads that route and passes its supported ConversationRelay settings (voice, greeting, and the `wss://.../ws` URL) to Twilio. It reads your latest saved code again on every new call.",
    },

    { type: "call-me" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Or make a call with your own upgraded Twilio account. Open a second Codespace terminal, which starts in `workshop/`. This command reads the current public `/twiml` URL and your `workshop/.env` values. The Codespace's `/call` route is local, and the public tunnel blocks direct requests to it:",
    },

    {
      type: "terminal",
      audience: "builder",
      commands: `$ npm run call`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Your phone should ring within a few seconds. Pick up and you should hear: \"Hello! How can I help you today?\" Try asking it a question or telling it a joke.",
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "Your phone should ring within a few seconds. Pick up and listen for your agent's opening greeting. The default is: \"Hello! I'm your AI assistant. How can I help you today?\" Try asking it a question or telling it a joke.",
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "Try speaking while the AI is talking -- it will pause. Later in the workshop, you'll see how the agent handles interruptions cleanly.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Watch your terminal for logs:",
    },

    {
      type: "terminal",
      audience: "builder",
      commands: `$ npm run dev
🚀 Server listening on port 8080
📞 New WebSocket connection
✅ Call started: CA1234567890abcdef1234567890abcdef
👤 From: +15551234567
🗣️ Caller: What is the capital of France?`,
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "**Call not working?** Check: (1) `tunnel-url` prints a `trycloudflare.com` URL, (2) `npm run dev` is running, (3) `OPENAI_API_KEY` is set in `.env`, and (4) your phone number is in E.164 format like `+15551234567`. For `npm run call`, also check the four Twilio and phone fields in `.env`.",
    },

    {
      type: "verify",
      audience: "builder",
      question: "Did you hear the AI respond to your voice?",
      troubleshooting: [
        "Watch your terminal while you call -- you should see logs for `📞 New WebSocket connection`, `✅ Call started`, and `🗣️ Caller: ...`",
        "No WebSocket connection logged? Make sure your server is running on port 8080 (`npm run dev`) and `tunnel-url` returns a `trycloudflare.com` URL",
        "Call connects but greeting plays then silence? The server probably isn't receiving `prompt` messages -- check that the terminal shows `🗣️ Caller: ...` logs and the WebSocket stayed open",
        "Hearing the fallback apology message? That's the OpenAI catch block -- check `OPENAI_API_KEY` and the terminal for LLM errors",
        "Call never rings? Make sure the URL ends in `/twiml`, your server logs show `POST /twiml` when you click Call Me, and the tunnel URL still resolves -- run `tunnel-url` to restart a stopped tunnel if needed",
        "Number format must be E.164 (`+15551234567`) in the Call Me input; set `MY_PHONE_NUMBER` in the same format if using `npm run call`",
        "If the call connects but ConversationRelay does not start, confirm with the facilitator that the site's Twilio account is upgraded. Twilio trials block ConversationRelay even when your phone number is verified. `npm run call` also needs an upgraded account",
      ],
    },

    {
      type: "verify",
      audience: "explorer",
      question: "Did you hear the AI respond to your voice?",
      troubleshooting: [
        "Make sure you entered your phone number with country code (like +12065551234)",
        "Check that your phone has signal and isn't on Do Not Disturb",
        "The call can take a few seconds to arrive -- give it about 10 seconds",
        "If nothing rings, try the Call Me button again",
        "Some carriers flag unknown numbers as spam -- check your recent calls",
      ],
    },

  ],
} satisfies StepDefinition;
