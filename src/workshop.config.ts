import type { WorkshopConfig } from "@/lib/workshop-config";

const workshopConfig: WorkshopConfig = {
  id: "voice-ai",
  title: "Build a Voice AI Agent",
  shortTitle: "twil.io/voice-workshop",
  description:
    "A guided workshop where you build a real conversational AI voice application using Twilio Conversation Relay",
  duration: "90 minutes",
  repositoryUrl: "https://github.com/anthonyplusAI/twilio-voice-ai",

  hero: {
    tagline:
      "A guided workshop with Conversation Relay",
    taglineAccent: "Conversation Relay",
    description:
      "By the end of this workshop, you\u2019ll have a working voice AI agent that calls your phone and talks to you \u2014 with a custom persona, realistic voice, tool calling, and more.",
    ctaText: "Start Workshop",
    illustration: "/images/illustrations/ai-world.png",
  },

  branding: {
    accentColor: "#EF223A",
    accentColorRgb: "239, 34, 58",
    logo: {
      src: "/images/twilio-bug-red.svg",
      alt: "Twilio",
    },
    poweredByLogo: {
      dark: "/images/powered-by-twilio-clear.png",
      light: "/images/powered-by-twilio-on-white.png",
      alt: "Powered by Twilio",
      href: "https://www.twilio.com",
    },
  },

  chapters: [
    {
      id: 1,
      slug: "mission-briefing",
      title: "Mission Briefing",
      subtitle: "Understand what we\u2019re building and get set up",
      duration: "15 min",
      badgeName: "Mission Ready",
      badgeIcon: "/images/icons/target.svg",
      particleColor: "#0263E0",
      steps: [
        { id: 1, slug: "what-were-building", title: "What We\u2019re Building" },
        { id: 2, slug: "how-it-works", title: "How It Works" },
        { id: 3, slug: "conversation-flow", title: "Conversation Flow" },
        { id: 4, slug: "setup", title: "Open Codespace" },
        { id: 5, slug: "verify", title: "Verify Setup" },
      ],
    },
    {
      id: 2,
      slug: "first-contact",
      title: "First Contact",
      subtitle: "Make your first AI-powered phone call",
      duration: "15 min",
      badgeName: "First Contact",
      badgeIcon: "/images/icons/rocketship.svg",
      particleColor: "#EF223A",
      steps: [
        { id: 1, slug: "websocket-server", title: "The Server" },
        { id: 2, slug: "twiml-setup", title: "Starting the Call" },
        { id: 3, slug: "handle-speech", title: "Listening to the Caller" },
        { id: 4, slug: "stream-response", title: "The AI Responds" },
        { id: 5, slug: "first-call", title: "Make Your First Call" },
      ],
    },
    {
      id: 3,
      slug: "identity",
      title: "Identity",
      subtitle: "Design your agent\u2019s personality and voice",
      duration: "15 min",
      badgeName: "Identity Forged",
      badgeIcon: "/images/icons/person-chat.svg",
      particleColor: "#A855F7",
      steps: [
        { id: 1, slug: "system-prompt", title: "Giving It Instructions" },
        { id: 2, slug: "persona-builder", title: "Persona Builder" },
        { id: 3, slug: "voice-selection", title: "Choosing a Voice" },
        { id: 4, slug: "language-config", title: "Language Settings" },
        { id: 5, slug: "test-identity", title: "Test Your Agent" },
      ],
    },
    {
      id: 4,
      slug: "reflexes",
      title: "Reflexes",
      subtitle: "Handle interruptions, keypad input, and conversational dynamics",
      duration: "15 min",
      badgeName: "Quick Reflexes",
      badgeIcon: "/images/icons/speedometer.svg",
      particleColor: "#F59E0B",
      steps: [
        { id: 1, slug: "interruptions", title: "Interruptions" },
        { id: 2, slug: "dtmf", title: "Keypad Input" },
        { id: 3, slug: "silence", title: "Silence & Timeouts" },
        { id: 4, slug: "language-switch", title: "Switching Languages" },
        { id: 5, slug: "test-reflexes", title: "Test Reflexes" },
      ],
    },
    {
      id: 5,
      slug: "superpowers",
      title: "Superpowers",
      subtitle: "Give your agent real abilities",
      duration: "20 min",
      badgeName: "Superpowered",
      badgeIcon: "/images/icons/integration.svg",
      particleColor: "#06B6D4",
      steps: [
        { id: 1, slug: "tool-calling", title: "How Tools Work" },
        { id: 2, slug: "define-tools", title: "Define Tools" },
        { id: 3, slug: "handle-tools", title: "Handle Tool Calls" },
        { id: 4, slug: "handoff", title: "Transfer to a Human" },
        { id: 5, slug: "test-superpowers", title: "Test Superpowers" },
      ],
    },
    {
      id: 6,
      slug: "launch",
      title: "Launch",
      subtitle: "Polish, deploy, and celebrate",
      duration: "15 min",
      badgeName: "Voice AI Builder",
      badgeIcon: "/images/icons/award-badge.svg",
      particleColor: "#F4B400",
      steps: [
        { id: 1, slug: "polish", title: "Polish Your Agent" },
        { id: 2, slug: "deploy", title: "Going Live" },
        { id: 3, slug: "showcase", title: "Showcase" },
        { id: 4, slug: "next-steps", title: "What\u2019s Next" },
      ],
    },
  ],

  sidebar: {
    widget: "custom",
    title: "Your Agent",
    fields: [
      { label: "Name", key: "agentName" },
      { label: "Voice", key: "voiceLabel" },
      { label: "Language", key: "language" },
      { label: "Tools", key: "enabledTools" },
      { label: "Handoff", key: "_handoff" },
    ],
  },

  features: {
    audienceToggle: true,
    celebrations: true,
    themeToggle: true,
  },

  defaultTheme: "dark",

  sharing: {
    enabled: true,
    eventName: "Twilio SIGNAL 2026",
    shareUrl: "https://signal.twilio.com",
    platforms: {
      x: {
        handle: "twilio",
        url: "https://x.com/twilio",
        message:
          "Just built a conversational AI voice agent at {event}! Went from zero to a fully working voice bot with custom persona, tool calling, and live agent handoff using @twilio Conversation Relay.",
        hashtags: ["TwilioSIGNAL", "VoiceAI", "ConversationalAI"],
      },
      linkedin: {
        url: "https://www.linkedin.com/company/twilio-inc-",
        message:
          "Excited to share that I just completed the \"{title}\" workshop at {event}! Built a fully functional conversational AI voice agent from scratch using Twilio Conversation Relay \u2014 complete with a custom persona, ElevenLabs voice synthesis, tool calling, and live agent handoff. Incredible hands-on session!",
      },
    },
  },
};

export default workshopConfig;
