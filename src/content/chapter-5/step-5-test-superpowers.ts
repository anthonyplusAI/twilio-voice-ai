import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "section", title: "Test Superpowers" },

    {
      type: "image",
      src: "/images/illustrations/superhero.svg",
      alt: "A superhero in flight — your agent's new powers, ready to be put to the test.",
      size: "md",
    },

    {
      type: "concept-card",
      audience: "explorer",
      title: "What a Great Test Call Looks Like",
      content:
        "A good test call has three beats: ask something the tool should answer, ask something only a human should handle, and see if the agent makes the right choice each time. If the weather question gets a weather answer and the sensitive request gets a graceful handoff, the agent has real superpowers.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Your agent now has real capabilities. Let us test tool calling and handoff to make sure everything is wired up correctly. Keep `npm run dev` running (start it if needed) and check that `tunnel-url` prints your current `trycloudflare.com` URL. Saved JavaScript changes restart the server automatically.",
    },

    {
      type: "terminal",
      audience: "builder",
      commands: `$ npm run dev
Server listening on port 8080`,
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "Use the Call Me button below to trigger a test call:",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Trigger a test call using the Call Me button below:",
    },

    { type: "call-me" },

    {
      type: "prose",
      audience: "explorer",
      content:
        "Speak each request below in the language you selected for your agent. Say city names and order numbers clearly; the agent should answer in that language too.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Or make a call with your own upgraded Twilio account. Open a second Codespace terminal and run the local command, which uses your current public `/twiml` URL; the public tunnel blocks direct `/call` requests:",
    },

    {
      type: "terminal",
      audience: "builder",
      commands: `$ npm run call`,
    },

    { type: "page-break" },

    { type: "section", title: "Test 1: Weather Tool" },

    {
      type: "prose",
      audience: "builder",
      content:
        'When the phone rings, answer and ask: "What is the weather in San Francisco?"',
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "When the phone rings, answer and ask for the weather in San Francisco, using the language you selected.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        'Watch your terminal. You should see:\n\n1. The `prompt` message with the transcribed speech.\n2. A log line showing `Tool call: check_weather { city: "San Francisco" }`.\n3. The tool result being added to the conversation.\n4. The LLM\'s natural language response being streamed to Twilio.',
    },

    {
      type: "prose",
      audience: "builder",
      content:
        'The agent should say something like: "It is currently 60 degrees and sunny in San Francisco."',
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "The agent should report the sample conditions and temperature for San Francisco in your selected language.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "info",
      content:
        "If the agent makes up weather data instead of using the tool, double-check that you are passing the tools list when calling the AI. Without it, the AI does not know any tools exist and will guess instead.",
    },

    { type: "section", title: "Test 2: Order Lookup Tool" },

    {
      type: "prose",
      content:
        "The workshop pre-loaded a few sample orders you can ask about (`123`, `456`, `789`). Any of them work — they are fake orders built into the workshop's tool so every attendee gets a live lookup without needing a real database behind the agent.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        'Try: "Can you check the status of order 123?"',
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "In your selected language, ask the agent to check the status of order 123.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        'The agent should look up the order and report the shipping status and delivery date. Then try an order that does not exist: "What about order 999?" The agent should let the caller know that order is not in the mock data.',
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "The agent should report the mock shipping status and delivery date in your selected language. Then ask about order 999 in that language; it should explain that the order is not in the sample data.",
    },

    { type: "page-break" },

    {
      type: "deep-dive",
      audience: "builder",
      title: "Optional Test: Multi-Tool Call",
      content:
        'Ask a question that needs multiple lookups at once: "What is the weather in Seattle, and can you check order 456?" The agent should answer both questions in one response. If it only answers half, make sure `handleToolCalls` loops over every entry in `toolCalls` before calling `streamResponse` again.',
    },

    {
      type: "deep-dive",
      audience: "explorer",
      title: "Optional Test: Multi-Tool Call",
      content:
        "In your selected language, ask one question about the weather in Seattle and the status of order 123. The agent should answer both parts in a single reply. This test only works when both tools are on in the tool picker -- if one is off, the agent can only answer the half it still has a tool for.",
    },

    {
      type: "deep-dive",
      audience: "builder",
      title: "Optional Test: Joke Tool",
      content:
        'Ask the agent: "Tell me a joke." The agent should call your `tell_joke` handler and come back with one of the strings you defined earlier. It is the simplest tool shape in the chapter -- a `function` with an empty `parameters` object and a handler that picks a random string -- so if it fires correctly, tool dispatch is wired end-to-end.',
    },

    {
      type: "deep-dive",
      audience: "explorer",
      title: "Optional Test: Joke Tool",
      content:
        "In your selected language, ask the agent for a joke. It should use its **Tell a Joke** tool and come back with a short one-liner. This test only works when Tell a Joke is on in the tool picker -- if it is off, the agent will either make one up or explain it can not.",
    },

    { type: "section", title: "Test 3: Handoff" },

    {
      type: "prose",
      audience: "builder",
      content:
        'Say: "I need to speak with a real person." or "Transfer me to an agent." With a valid `HANDOFF_PHONE_NUMBER`, the AI should end the relay and Twilio should announce and start the transfer. Without one, the AI should explain that live handoff is unavailable and continue the conversation.',
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "In your selected language, ask to speak with a real person. What happens next depends on your Live Handoff toggle. If Handoff is **on** and the facilitator configured a reachable destination, the agent should start a transfer. If Handoff is **off** (the default), it should politely decline and keep trying to help. If Handoff is on but no destination is configured, it should explain that live transfer is unavailable and stay on the call.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "To test a live transfer, set `HANDOFF_PHONE_NUMBER` in `workshop/.env` to a second reachable phone, different from the caller's phone, in E.164 format, such as `+12065551234`, then restart `npm run dev`. An empty or placeholder destination cannot complete a handoff. The workshop site's Call Me button uses the site's Twilio account; `npm run call` uses the account in `.env`. Whichever account places the call must be upgraded for ConversationRelay. A verified number on a trial account is not enough.",
    },

    { type: "section", title: "Checkpoint" },

    {
      type: "verify",
      audience: "builder",
      question:
        "Did weather and order lookup work, and did handoff match your destination setup?",
      troubleshooting: [
        "Agent made up weather instead of calling the tool? Confirm you're passing `tools: tools` to `openai.chat.completions.create()` in `streamResponse`",
        "Order lookup returned nothing? Check the terminal for `Tool call: lookup_order` — if missing, the LLM isn't picking the tool. Tighten the tool description",
        "Handoff didn't trigger? Verify the `transfer_to_agent` tool is in your `tools` array and its handler is sending the `end` message with `handoffData`",
        "Second turn crashes with an OpenAI 400 error about missing tool responses? You're skipping the `role: \"tool\"` message with `tool_call_id` — OpenAI requires exactly one per tool call before the next request",
        "Nothing happening at all? Confirm `npm run dev` is running and `tunnel-url` returns a `trycloudflare.com` URL",
        "Tried the optional multi-tool test and only got half an answer? Make sure `handleToolCalls` loops over every entry in `toolCalls` before calling `streamResponse` again",
      ],
    },

    {
      type: "verify",
      audience: "explorer",
      question:
        "Did the agent use its selected tools and respond correctly to a handoff request?",
      troubleshooting: [
        "Weather answer skipped the sample tool data? Head back to Pick Your Tools and confirm Check Weather is toggled on",
        "Order lookup didn't return the mock shipping status? Check that Look Up Order is on, and try the exact order number 123",
        "Agent only answered half of a two-part question? That's normal on the first try — phone it again and say both parts in one sentence",
        "Asked for a human and nothing happened? Handoff is off by default. If you turned it on but the agent says transfer is unavailable, ask the facilitator whether a live destination is configured",
        "Call never connected? Re-enter your phone number in the Call Me box and try again",
      ],
    },

    {
      type: "prose",
      audience: "explorer",
      content:
        "With tool calling in place, the agent can look up workshop sample data and take actions based on those results. It can also pass the call to a human when live handoff is configured.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "With tool calling and handoff working, your agent can now look up information, take actions based on it, and hand off to a human agent when the caller asks for one or the AI determines it is the right call.",
    },
  ],
} satisfies StepDefinition;
