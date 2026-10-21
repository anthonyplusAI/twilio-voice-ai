import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "section", title: "What Makes a Great Voice AI Agent" },

    {
      type: "concept-card",
      audience: "explorer",
      title: "",
      content:
        "A great voice agent sounds like a person who happens to be helpful, not a bot following a script. It has a clear personality you can sense within a sentence or two. It responds quickly. It handles interruptions without losing its place. It knows what it can and cannot do, and when it should hand off to a human. Everything you have seen in this workshop -- the persona, the reflexes, the tools, the handoff -- is what adds up to that feeling.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "The agent is complete. Every part you have built contributes to a single feeling on the other end of the call: *this thing is actually helpful.* The persona from Chapter 3 sets the tone. The reflexes from Chapter 4 -- interrupts, DTMF, silence, language switches -- are what keep it from feeling robotic. The tools and handoff from Chapter 5 are what let it do real work instead of just chatting. Together those four pieces are what distinguish a voice AI agent that feels good from one that feels like a phone tree.",
    },

    {
      type: "image",
      src: "/images/illustrations/target.png",
      alt: "A target with an arrow in the bullseye — the four qualities that make a voice agent land on its feet.",
      size: "md",
    },

    { type: "section", audience: "builder", title: "Try Your Agent" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Save your latest `workshop/server.js` edits and leave `npm run dev` running in the Codespace. It restarts the server after each save. Run `tunnel-url` to get your public `/twiml` URL, then paste it below. This final call uses your Codespace code, including changes you just made.",
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "Make one final call to hear the agent with the choices you made during the workshop.",
    },

    { type: "call-me" },

    {
      type: "callout",
      audience: "explorer",
      variant: "tip",
      content:
        "The workshop site needs an upgraded Twilio account for this ConversationRelay call. If the call connects but the agent does not start, ask the facilitator to check the account and call logs; verifying a number on a trial account does not enable ConversationRelay.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "The site's Call Me button places the call from the site's upgraded Twilio account. You can also start a call from your Codespace's own upgraded Twilio account after setting `MY_PHONE_NUMBER` and the Twilio values in `workshop/.env`. Open a second Codespace terminal for the command below. [Trial accounts block ConversationRelay](https://www.twilio.com/docs/usage/trials/try-out-voice#blocked-verbs), even for a verified recipient. Either path uses the latest `server.js` code you just saved:",
    },

    {
      type: "terminal",
      audience: "builder",
      commands: `$ npm run call`,
    },

    { type: "demo-script" },

    { type: "page-break" },

    { type: "section", title: "The Four Qualities" },

    {
      type: "prose",
      content:
        "Everything the workshop has covered maps to four qualities worth aiming for in any voice AI agent you build after this:\n\n- **Personality.** The agent knows who it is and stays consistent across every turn.\n- **Responsiveness.** The caller is never left waiting for a full sentence to finish before they can speak. Interrupts, silence handling, and responding as it thinks are what buy this.\n- **Capability.** The agent can actually *do* things -- look something up, place an order, check a status -- not just talk about them.\n- **Self-awareness.** The agent knows when it is the wrong tool for the job and hands off cleanly instead of guessing.\n\nMissing any one of these and callers will feel it, even if they cannot name it.",
    },

    { type: "section", audience: "builder", title: "Checkpoint" },

    {
      type: "verify",
      audience: "builder",
      question:
        "Have you tried your agent end-to-end with at least one test call?",
    },
  
  ],
} satisfies StepDefinition;
