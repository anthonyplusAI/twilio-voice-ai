import type { StepDefinition } from "@/lib/content-blocks";

export default {
    blocks: [
        {
            type: "section",
            title: "Back to Your Codespace",
            audience: "builder",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "You opened your Codespace earlier. It should be ready now -- if the terminal is showing a prompt, you're good. If it is still loading, give it another minute.",
        },

        {
            type: "concept-card",
            audience: "builder",
            title: "Why Codespaces?",
            content:
                "GitHub Codespaces gives every attendee the same Node.js workspace in the cloud, with the project dependencies installed. Add an OpenAI API key, then start building. The workshop site's Call Me button will ask for your phone number when you call.",
        },

        {
            type: "callout",
            variant: "tip",
            audience: "builder",
            content:
                "**Didn't open it yet?** Launch it now at [codespaces.new/anthonyplusAI/twilio-voice-ai](https://codespaces.new/anthonyplusAI/twilio-voice-ai) and let it finish initializing before moving on.",
        },

        {
            type: "callout",
            variant: "backup-plan",
            audience: "builder",
            content:
                "**Codespace won't open or your org has it disabled?** Two backup paths:\n\n**Option 1 — Run locally.** Clone [the repo](https://github.com/anthonyplusAI/twilio-voice-ai), run `npm ci` in the `workshop/` folder, and use [ngrok](https://ngrok.com) to expose the repository's protected proxy on port 8081 to Twilio. Full instructions for the ngrok fallback are coming up at the end of this chapter. Requires Node.js 20+ installed on your laptop.\n\n**Option 2 (easier) — Switch to Explorer mode.** Explorer track is the observer path; you follow along with the concepts without writing code. Flip the track toggle at the top of the page and pair with a Builder next to you -- you'll still hear the agent and make test calls, just from the caller's side.",
        },

        {
            type: "callout",
            variant: "info",
            audience: "builder",
            content:
                "**About the two folders.** The Codespace has both `workshop/` and `voice-agent/` at the repo root. `workshop/` is where you'll paste every code snippet in this workshop -- treat it as your own. `voice-agent/` is the finished hosted reference used by Explorer calls; peek at it if you get stuck, but edit `workshop/` for your Builder calls.",
        },

        {
            type: "builder-only",
            audience: "explorer",
            context:
                "**You can skip ahead whenever you're ready.** 'The Builder' is busy for a few minutes on this step.\n\n**What they are doing:** Adding an OpenAI API key to the agent's config file. They may also add upgraded Twilio credentials if they want to place calls with `npm run call`; the workshop site's Call Me button uses the site's account.\n\n**What comes next:** In the next chapter the agent takes its first call. That is where you will actually hear it.",
        },

        { type: "page-break" },

        {
            type: "section",
            title: "Fill In Your .env File",
            audience: "builder",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "Your Codespace creates `workshop/.env` on first boot. Public attendees do not receive repository Codespaces secrets, so the credential values are usually blank. Open the file from the explorer on the left; if you don't see it yet, give the Codespace another minute to finish initializing. Your edits are kept if the container is rebuilt.",
        },

        {
            type: "callout",
            variant: "info",
            audience: "builder",
            content:
                "**Get an OpenAI API key from [twil.io/keys](https://twil.io/keys) or your own OpenAI account.** Paste it into `workshop/.env`. Your facilitator may show a key on a slide. The workshop site's Call Me button uses the site's upgraded Twilio account; Codespace Twilio values are optional for that call. If you want to use `npm run call` with your own account, also add upgraded Twilio credentials supplied by the facilitator or your own account.",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "Here is the file layout. Replace the OpenAI placeholder with a real key. Fill the Twilio and phone fields only for the features you plan to test:",
        },

        {
            type: "code",
            audience: "builder",
            code: `# Needed only for npm run call with your own Twilio account
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Needed for your Codespace agent on either call route
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Optional: a second phone for live transfer
HANDOFF_PHONE_NUMBER=

# Set this for npm run call (include country code)
MY_PHONE_NUMBER=`,
            language: "bash",
            file: "workshop/.env",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "If you plan to run `npm run call`, update `MY_PHONE_NUMBER` with your real phone number in E.164 format (international format — country code plus number, no spaces or dashes, e.g. `+12065551234`). The workshop site's Call Me button asks for your number in its own form. To test a live handoff in Chapter 5, set `HANDOFF_PHONE_NUMBER` to a second reachable phone, such as a teammate's, that is different from the caller's phone.",
        },

        {
            type: "callout",
            variant: "tip",
            audience: "builder",
            content:
                "**Save the file** (Cmd/Ctrl + S) after pasting. The workshop server reads `.env` at startup. If you change `.env` after starting the server, stop it with Ctrl+C and run `npm run dev` again.",
        },

        {
            type: "callout",
            variant: "error",
            audience: "builder",
            content:
                "Facilitator-shared API keys are active only during this workshop session and may be revoked after it ends. Do not commit them to git or share them outside the room.",
        },

        {
            type: "callout",
            variant: "tip",
            audience: "builder",
            content:
                "**Want to use your own accounts after the workshop?** Get an [OpenAI API key](https://platform.openai.com/api-keys) and, for `npm run call`, an [upgraded Twilio account](https://www.twilio.com/docs/usage/trials/try-out-voice#blocked-verbs). [Enable Conversation Relay](https://www.twilio.com/docs/voice/conversationrelay/onboarding#configuration-steps-in-the-twilio-console) by accepting its AI/ML features addendum in that account's Voice settings. Replace the values in `.env` to use them from your Codespace. The workshop site's Call Me button still places calls from the site's separate Twilio account. Twilio trials block ConversationRelay, even for verified numbers.",
        },

        {
            type: "verify",
            audience: "builder",
            question: "Is your Codespace open and the terminal ready?",
            troubleshooting: [
                "Make sure you are signed into GitHub before clicking the Codespace link",
                "If the Codespace is stuck loading, try refreshing the browser tab",
                "Check that the terminal shows the workshop/ directory as your working directory",
            ],
        },
    ],
} satisfies StepDefinition;
