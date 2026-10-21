import type { StepDefinition } from "@/lib/content-blocks";

export default {
    blocks: [
        {
            type: "image",
            src: "/images/illustrations/conversation-relay-hero.png",
            alt: "A person on a phone call with a virtual AI voice agent",
            size: "md",
        },

        {
            type: "prose",
            content:
                "In this workshop, you'll create a **voice AI agent** that you can talk to over a real phone call. It listens to what you say, sends your words to an AI, and speaks the reply back -- all in real time over Twilio's phone network.",
        },

        {
            type: "concept-card",
            audience: "explorer",
            title: "What You'll See",
            content:
                "A voice AI agent that calls your phone and has a natural conversation with you -- handling interruptions, using tools, and even handing off to a human. You'll experience each piece coming together step by step.",
        },

        {
            type: "concept-card",
            audience: "builder",
            title: "What You'll Build",
            content:
                "A Node.js WebSocket server that connects to Twilio's phone network through Conversation Relay. Your server receives the caller's words as text, sends them to an LLM, and streams the reply back -- Twilio handles all the audio. By the end, your agent will have a custom personality, real-time tool calling, and live handoff to a human.",
        },

        {
            type: "section",
            title: "Open Your Codespace Now",
            audience: "builder",
        },

        {
            type: "prose",
            audience: "builder",
            content:
                "You will be writing code in a few minutes. Open your Codespace in a new tab now so it can warm up in the background while you read the rest of this chapter.",
        },

        {
            type: "visual-step",
            audience: "builder",
            steps: [
                {
                    icon: "/images/icons/globe.svg",
                    title: "Open your Codespace",
                    description:
                        "Click this link in a new tab: [codespaces.new/anthonyplusAI/twilio-voice-ai](https://codespaces.new/anthonyplusAI/twilio-voice-ai)",
                },
                {
                    icon: "/images/icons/settings.svg",
                    title: "Leave it loading in the background",
                    description:
                        "GitHub spins up a cloud VS Code with everything pre-installed. Come back to this tab and keep reading -- your Codespace will be ready by the time you need it.",
                },
            ],
        },

        {
            type: "callout",
            variant: "info",
            audience: "builder",
            content:
                "**A free GitHub account opens your Codespace.** If you do not have one, create it at [github.com](https://github.com). You will add an OpenAI API key in a later step. You only need your own upgraded Twilio credentials if you place calls with `npm run call`; the workshop site's Call Me button uses the site's account.",
        },

        { type: "page-break" },

        { type: "section", title: "What is Conversation Relay?" },

        {
            type: "image",
            src: "/images/illustrations/conversation-relay-how-works.png",
            alt: "Diagram showing Conversation Relay bridging a phone call and an AI model",
            size: "md",
        },

        {
            type: "prose",
            content:
                "AI models read and write **text**, but phone calls are **audio**. Something has to translate between the two. That's what **Conversation Relay** does -- it sits between the server and a live phone call, converting speech to text on the way in and text to speech on the way out.",
        },

        {
            type: "concept-card",
            audience: "explorer",
            title: "Conversation Relay",
            content:
                "Twilio handles all the hard parts -- turning speech into text, turning text back into speech, and detecting when someone interrupts. The server just deals with plain text: the caller speaks, their words arrive as text; the AI sends text back, and the caller hears it as a natural voice.",
        },

        {
            type: "deep-dive",
            audience: "explorer",
            title: "Note: Two Words You'll See in this Workshop",
            content:
                "**The Builder** is someone next to you who picked the technical track of this workshop. They are the one writing code. Whenever the workshop says \"the Builder\" it means that person.\n\n**The server** is just a program running in the cloud -- the piece the Builder is wiring together during the workshop, sitting between the phone call and the AI. You do not need to write or run any server code; just know that \"the server\" is the connector that makes the whole thing work.",
        },

        {
            type: "concept-card",
            audience: "builder",
            title: "Conversation Relay",
            content:
                "Conversation Relay opens a WebSocket to your server. When the caller speaks, you get a `prompt` message with the transcribed text. You send back `text` messages with the AI's reply, and Twilio synthesizes them into speech. Your server never touches audio -- just JSON over a WebSocket.",
        },

        { type: "page-break" },

        { type: "section", title: "What You Will Learn" },

        {
            type: "prose",
            content: "Six chapters, each building on the last:",
        },

        {
            type: "visual-step",
            audience: "explorer",
            steps: [
                {
                    icon: "/images/icons/target.svg",
                    title: "Chapter 1 -- Mission Briefing",
                    description:
                        "Understand the architecture and how all the pieces fit together.",
                },
                {
                    icon: "/images/icons/rocketship.svg",
                    title: "Chapter 2 -- First Contact",
                    description:
                        "See the server come online and hear the agent speak for the first time.",
                },
                {
                    icon: "/images/icons/person-chat.svg",
                    title: "Chapter 3 -- Identity",
                    description:
                        "Watch the agent get a personality, a custom voice, and language settings.",
                },
                {
                    icon: "/images/icons/speedometer.svg",
                    title: "Chapter 4 -- Reflexes",
                    description:
                        "See how the agent handles interruptions, keypad presses, silence, and language switching.",
                },
                {
                    icon: "/images/icons/integration.svg",
                    title: "Chapter 5 -- Superpowers",
                    description:
                        "Watch the agent look up live data, answer real questions, and hand off to a human.",
                },
                {
                    icon: "/images/icons/award-badge.svg",
                    title: "Chapter 6 -- Launch",
                    description:
                        "See the finished agent in action and explore what comes next.",
                },
            ],
        },

        {
            type: "visual-step",
            audience: "builder",
            steps: [
                {
                    icon: "/images/icons/target.svg",
                    title: "Chapter 1 -- Mission Briefing",
                    description:
                        "Understand the architecture, set up your environment, and get ready to code.",
                },
                {
                    icon: "/images/icons/rocketship.svg",
                    title: "Chapter 2 -- First Contact",
                    description:
                        "Set up your server, connect it to Twilio, and make your first AI phone call.",
                },
                {
                    icon: "/images/icons/person-chat.svg",
                    title: "Chapter 3 -- Identity",
                    description:
                        "Give your agent a personality with custom instructions and choose a voice that fits.",
                },
                {
                    icon: "/images/icons/speedometer.svg",
                    title: "Chapter 4 -- Reflexes",
                    description:
                        "Handle interruptions, detect keypad presses, manage silence, and switch languages mid-call.",
                },
                {
                    icon: "/images/icons/integration.svg",
                    title: "Chapter 5 -- Superpowers",
                    description:
                        "Give your agent tools -- look up data, check databases -- and hand off to a human when needed.",
                },
                {
                    icon: "/images/icons/award-badge.svg",
                    title: "Chapter 6 -- Launch",
                    description:
                        "Polish your agent, explore deployment options, and showcase what you've built.",
                },
            ],
        },

        {
            type: "callout",
            variant: "info",
            content:
                "Each chapter takes about 10-20 minutes. You can complete the entire workshop in a single session or work through it chapter by chapter at your own pace. Every step builds on the previous one, so **we recommend going in order.**",
        },

        {
            type: "concept-card",
            audience: "explorer",
            title: "What You'll Walk Away With",
            content:
                "By the end of this workshop, you'll understand how voice AI agents work end to end -- from the phone call coming in, through the speech-to-text translation, to the AI generating a response. You'll see a working agent handle real conversations with interruptions, live data lookups, and handoffs to humans, and you'll know exactly how each piece fits together.",
        },

        {
            type: "concept-card",
            audience: "builder",
            title: "What You'll Walk Away With",
            content:
                "By the end of this workshop, you'll have a working voice AI agent running on your machine -- a WebSocket server that handles real phone calls, streams LLM responses in real time, executes tool calls, and hands off to a human. You'll own every line of code and understand how each piece connects.",
        },
    ],
} satisfies StepDefinition;
