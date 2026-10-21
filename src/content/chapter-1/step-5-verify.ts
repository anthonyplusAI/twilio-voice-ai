import type { StepDefinition } from "@/lib/content-blocks";

export default {
    blocks: [
        {
            type: "builder-only",
            audience: "explorer",
            illustration: "/images/illustrations/lego-building.svg",
            context:
                "**You can skip ahead whenever you are ready.** 'The Builder' is finishing a quick setup check before the first phone call.\n\n**What they are doing:** Grabbing the public URL of their tunnel -- a small program that the Codespace started automatically and that gives Twilio a way to reach their server. They just need to copy the URL from their terminal. Takes less than a minute.\n\n**What comes next:** In the next chapter the agent takes its first call. That is where you will actually hear it.",
        },

        {
            type: "section",
            title: "Get Your Public Tunnel URL",
            audience: "builder",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "Twilio needs a public URL to reach your server. Your Codespace boots a Cloudflare tunnel automatically. It sends a free `https://*.trycloudflare.com` URL to a protected local proxy on port 8081, which forwards the workshop's TwiML and voice WebSocket traffic to your server on port 8080. No signup or port-visibility settings are needed.",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "The tunnel URL usually appears in your terminal when the Codespace starts. Run this any time to get the current URL; the helper waits for a slow tunnel or starts it again if it stopped:",
        },

        {
            type: "terminal",
            audience: "builder",
            commands: `$ tunnel-url
https://random-words-abc123.trycloudflare.com/twiml`,
        },

        {
            type: "callout",
            audience: "builder",
            variant: "tip",
            content:
                "**Save this URL** -- you'll paste it into the Call Me widget in the next chapter. Quick Tunnel URLs can change when the tunnel or Codespace restarts. Run `tunnel-url` again before a call and paste the new URL if it changed. Keep Codespaces port 8080 private in the Ports tab; making it public bypasses the protected tunnel.",
        },

        {
            type: "deep-dive",
            audience: "builder",
            title: "Why a tunnel and not the Codespace's own URL?",
            content:
                "GitHub Codespaces does forward port 8080 to a `https://<codespace>-8080.app.github.dev` URL, but GitHub serves an HTML \"You are about to access a development port\" warning page on the first request -- meant to protect humans from phishing links. Twilio is a server, not a human; it can't click \"Continue,\" so the warning blocks every webhook. Cloudflare Tunnel skips that interstitial: it forwards `https://*.trycloudflare.com` to the protected proxy on `localhost:8081`, which passes the allowed request to your server on port 8080. The response Twilio gets is your TwiML XML, not GitHub's warning page. Public requests to `/call` are blocked at the proxy.",
        },

        {
            type: "deep-dive",
            audience: "builder",
            title: "Fallback: Local Dev + ngrok",
            content:
                "If Codespaces is unavailable or you prefer local development, install Node.js 20+, clone the [repository](https://github.com/anthonyplusAI/twilio-voice-ai), and run `npm ci` from the `workshop/` folder. Create `workshop/.env` with the credentials and phone numbers shown in the previous step. When you create `server.js` in Chapter 2, run `npm run dev` from `workshop/`. In a second terminal at the repository root, run `node workshop/secure-proxy.js`; in a third, run `ngrok http 8081`. Add `TWIML_URL=https://<your-ngrok-domain>/twiml` to `workshop/.env` using ngrok's actual HTTPS domain. Paste that same URL into the Call Me widget. For an own-account call, run `npm run call` from `workshop/`. The ngrok free tier requires an account/authtoken, and its URL can change when it restarts; update `TWIML_URL` when it does. Do not point ngrok directly at port 8080 because that bypasses the proxy's public `/call` block and WebSocket signature check.",
        },

        { type: "page-break" },

        { type: "section", title: "Verify Your Setup", audience: "builder" },

        {
            type: "prose",
            audience: "builder",
            content:
                "Before diving into code in the next chapter, check the pieces needed for the workshop site's Call Me button. The optional `npm run call` command needs your own Twilio credentials and phone number, noted below.",
        },

        { type: "section", title: "Pre-Flight Checklist", audience: "builder" },

        {
            type: "prose",
            audience: "builder",
            content:
                "**1. Codespace is running** -- You have a Codespace open with the terminal ready.",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "**2. OpenAI key is loaded** -- You added a working `OPENAI_API_KEY` to `workshop/.env`. The workshop site supplies the upgraded Twilio account for Call Me. Add upgraded Twilio credentials to your Codespace only if you will use `npm run call`.",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "**3. Phone is ready** -- Keep a phone nearby to receive Call Me. Set `MY_PHONE_NUMBER` in `workshop/.env` only if you will also use `npm run call`.",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "**4. Tunnel is running** -- Run `tunnel-url` in the terminal. You should get back a `https://*.trycloudflare.com/twiml` URL. The helper restarts a stopped tunnel; if it still fails, check `/tmp/cloudflared.log` and run `bash ../.devcontainer/start-tunnel.sh` from `workshop/`.",
        },

        {
            type: "callout",
            audience: "builder",
            variant: "tip",
            content:
                "The workshop site's Call Me button uses the site's Twilio account, even when it calls your Codespace code. `npm run call` uses the Twilio credentials in `workshop/.env`. The Codespace's `/call` route is local; the public tunnel blocks it so strangers cannot charge your account. Whichever account places the call must be upgraded to use ConversationRelay; [Twilio trials block it](https://www.twilio.com/docs/usage/trials/try-out-voice#blocked-verbs), even when the recipient number is verified. Ask the facilitator if the site's account has been upgraded before the first call.",
        },

        { type: "section", title: "Ready to Build", audience: "builder" },

        {
            type: "prose",
            audience: "builder",
            content:
                "If everything checks out, you are ready to start building. In the next chapter, you will set up your server, connect it to Twilio, wire in the AI, and make your first AI phone call.",
        },

        {
            type: "verify",
            audience: "builder",
            question:
                "Is your Codespace running with an OpenAI key, a tunnel URL, and a phone nearby to receive calls?",
            troubleshooting: [
                "Codespace not loading? Try refreshing the browser tab or reopening from github.com/codespaces",
                "OpenAI key missing? Get a working key from the facilitator or your own account and put it in workshop/.env",
                "Using `npm run call`? Add upgraded Twilio credentials and set MY_PHONE_NUMBER to your real E.164 number (e.g., +12065551234)",
                "`tunnel-url` failed? Check /tmp/cloudflared.log, run `bash ../.devcontainer/start-tunnel.sh` from workshop/, then try `tunnel-url` again",
            ],
        },
    ],
} satisfies StepDefinition;
