import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "section", title: "Time to Test" },

    { type: "agent-summary", audience: "explorer" },

    {
      type: "concept-card",
      audience: "explorer",
      title: "What to Listen For",
      content:
        "On this test call, focus on the agent's *identity* -- not whether it answers correctly. Does the voice match the tone you wanted? Does it stay in character when you ask off-topic questions? Does it politely refuse things outside its scope? If the answer to any of those is no, the persona or prompt needs another pass.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "You have crafted a system prompt, designed a persona, selected a voice, and configured the language settings. `npm run dev` restarts after you save `server.js` or an imported JavaScript file. If the server is not running, start it now. If you changed `.env`, stop it with Ctrl+C and start it again:",
    },

    { type: "terminal", audience: "builder", commands: "$ npm run dev" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Make sure your server is running and `tunnel-url` prints your `trycloudflare.com` URL so Twilio can reach your server.",
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "The button below will ring **your** phone so you can hear your configured agent in action. Keep your phone handy.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Trigger a test call using the Call Me button below:",
    },

    {
      type: "callout",
      variant: "info",
      content:
        "**Heads up.** Your persona and voice picks apply to the **next** call you trigger, not a call already in progress. To hear a new voice or persona, end the current call and press Call Me again.",
    },

    { type: "call-me" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Or trigger your own `/call` endpoint from the terminal. Send the request through the public tunnel so the server gives Twilio a reachable callback URL:",
    },

    {
      type: "terminal",
      audience: "builder",
      commands: `$ curl -X POST "$(tunnel-url call)"`,
    },

    { type: "page-break" },

    { type: "section", title: "What to Check" },

    {
      type: "prose",
      content:
        "When the call connects, listen for these things:",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**Greeting.** Does the agent introduce itself with the name and role from its persona?\n\n**Tone.** Does the agent sound like the personality that was configured? Is it formal when it should be formal, casual when it should be casual?\n\n**Boundaries.** Ask something off-topic. Does the agent stay in character and redirect the conversation?\n\n**Response length.** Are the responses short and natural, or is the agent rambling?",
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "**Greeting.** Listen for the agent introducing itself with the name and role you picked.\n\n**Tone.** Notice whether the agent sounds like the personality you configured -- formal when it should be formal, casual when it should be casual.\n\n**Boundaries.** Try asking something off-topic. The agent should stay in character and steer back to what it can help with.\n\n**Response length.** Pay attention to how long the responses are. Short and natural is the target.",
    },

    {
      type: "verify",
      audience: "builder",
      question:
        "Does your agent respond with the right personality and voice?",
      troubleshooting: [
        "Phone never rings? Check that your server is running (`npm run dev`) and `tunnel-url` returns a `trycloudflare.com` URL",
        "Voice sounds wrong? Revisit the voice picker — your choice takes effect on the next call, not the current one",
        "Agent using a different name or tone? Your system prompt probably needs stronger wording about the persona",
        "Agent breaks character on off-topic questions? Add explicit boundaries to the system prompt about what it should refuse",
        "Responses too long or rambling? Add a length rule like \"Keep every response to one or two sentences\" to the system prompt",
      ],
    },

    {
      type: "verify",
      audience: "explorer",
      question:
        "Does your agent respond with the right personality and voice?",
      troubleshooting: [
        "Voice sounds wrong? Revisit the voice picker — your choice takes effect on the next call, not the current one",
        "Agent tone feels off? Go back to the persona picker and try a different preset (or adjust the custom fields)",
        "Responses feel too long? Try the Professional Concierge preset — it tends to be briefer",
        "Agent breaks character on off-topic questions? The presets have built-in boundaries, and the agent picks up changes on the next call, not the current one",
      ],
    },

    { type: "section", title: "Iterating on the Persona" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Getting the persona right is an iterative process. A few common adjustments:",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**Responses too long?** Add explicit length constraints to the system prompt. **Voice feels off?** Try a different voice from the same provider. **Breaking character?** Strengthen the boundaries -- be very explicit about what the agent should never do.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "The system prompt is the most powerful lever for shaping behavior. Keep refining it throughout the workshop as you add new capabilities. Make sure you are happy with the basic personality and voice before moving on.",
    },

    {
      type: "prose",
      content:
        "In the next chapter, the agent gains **reflexes** \u2014 the ability to handle interruptions, detect keypad presses, manage silence, and switch languages on the fly.",
    },
  ],
} satisfies StepDefinition;
