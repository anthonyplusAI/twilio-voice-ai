"use client";

import { useProgressContext } from "@/components/layout/ProgressContext";
import { useAudienceMode } from "@/lib/AudienceContext";

const TOOL_SCRIPT: Record<string, { label: string; line: string }> = {
  check_weather: {
    label: "Weather lookup",
    line: '"What is the weather in San Francisco?"',
  },
  lookup_order: {
    label: "Order lookup",
    line: '"Can you check the status of order 123?"',
  },
  tell_joke: {
    label: "Joke",
    line: '"Tell me a joke."',
  },
};

const ALL_TOOL_IDS = Object.keys(TOOL_SCRIPT);

function parseEnabledTools(stored: string | undefined): string[] {
  if (stored === undefined) return ALL_TOOL_IDS;
  if (stored === "") return [];
  return stored
    .split(",")
    .map((id) => id.trim())
    .filter((id) => TOOL_SCRIPT[id]);
}

export function DemoScript() {
  const { isBuilder } = useAudienceMode();
  const { progress } = useProgressContext();
  const enabledTools = parseEnabledTools(progress.workshopState.enabledTools);
  const handoffOn = progress.workshopState.handoffEnabled === "true";

  const steps: { title: string; detail: string }[] = [
    {
      title: isBuilder ? "Hear your latest code" : "Hear your configured agent",
      detail: isBuilder
        ? "Use Call Me above with your Codespace TwiML URL. Watch the Codespace terminal for the call, then ask about a persona detail you changed in server.js."
        : "Use Call Me above, then listen for the name, voice, and greeting you selected.",
    },
  ];

  // Explorer picks live in this app. Builder capabilities live in their own
  // server.js, which the hosted app cannot inspect.
  for (const toolId of isBuilder ? ALL_TOOL_IDS : enabledTools) {
    const tool = TOOL_SCRIPT[toolId];
    steps.push({
      title: `Test the ${tool.label}`,
      detail: `Say: ${tool.line}${isBuilder ? " Skip this if you removed the tool from your code." : ""}`,
    });
  }

  steps.push({
    title: "Test interruption",
    detail:
      "Ask a long question, then start talking again before the agent finishes. The agent should stop and listen.",
  });

  if (isBuilder || enabledTools.includes("lookup_order")) {
    steps.push({
      title: "Try the keypad",
      detail: isBuilder
        ? "Press 1 mid-call to test the order shortcut if you kept the order tool in your code."
        : "Press 1 on your phone mid-call to test the order shortcut.",
    });
  }

  if (isBuilder) {
    steps.push({
      title: "Request a human",
      detail:
        'If HANDOFF_PHONE_NUMBER is set in your Codespace, say: "I need to speak to a person." The agent should transfer the call.',
    });
  } else if (handoffOn) {
    steps.push({
      title: "Request a human",
      detail: 'Say: "I need to speak to a person." The agent should transfer if the workshop has a live handoff number configured; otherwise it should explain that handoff is unavailable.',
    });
  } else {
    steps.push({
      title: "Ask for a human (handoff is off)",
      detail:
        'Say: "Can I speak to a person?" The agent should politely decline and keep trying to help.',
    });
  }

  const hasAnyTools = isBuilder || enabledTools.length > 0;

  return (
    <div className="rounded-xl border border-navy-border bg-surface-1 p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 rounded-lg bg-twilio-red/15 flex items-center justify-center text-twilio-red">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </div>
        <span className="text-sm font-mono text-text-primary uppercase tracking-wider">
          Your Demo Script
        </span>
      </div>

      <p className="text-sm text-text-muted mb-4">
        {isBuilder
          ? "These prompts test the code running in your Codespace. Use the ones that match the capabilities you kept."
          : "This script follows your tool and handoff choices. Change a choice and the script updates."}
      </p>

      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <div className="shrink-0 w-6 h-6 rounded-full bg-twilio-red/15 text-twilio-red flex items-center justify-center text-xs font-mono font-semibold">
              {i + 1}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-text-primary">
                {step.title}
              </div>
              <div className="text-xs text-text-muted leading-relaxed mt-0.5">
                {step.detail}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {!hasAnyTools && (
        <div className="mt-4 px-3 py-2 rounded-lg bg-twilio-red/5 border border-twilio-red/20">
          <span className="text-xs text-twilio-red">
            All tools are currently off. Turn at least one on in Chapter 5 if
            you want the demo to cover tool calling.
          </span>
        </div>
      )}
    </div>
  );
}
