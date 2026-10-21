"use client";

import { useProgressContext } from "@/components/layout/ProgressContext";

const TOOLS = [
  {
    id: "check_weather",
    name: "Check Weather",
    desc: "Tells the caller the current weather in a city.",
    tryThis: "Try asking about the weather in San Francisco in your selected language.",
  },
  {
    id: "lookup_order",
    name: "Look Up Order",
    desc: "Finds the status of a customer order by its order number.",
    tryThis: "Try asking about order 123 in your selected language.",
  },
  {
    id: "tell_joke",
    name: "Tell a Joke",
    desc: "Pulls a short joke from the agent's joke book.",
    tryThis: "Try asking for a joke in your selected language.",
  },
];

const DEFAULT_ENABLED = TOOLS.map((t) => t.id).join(",");

function parseEnabled(stored: string | undefined): Set<string> {
  if (stored === undefined) return new Set(TOOLS.map((t) => t.id));
  if (stored === "") return new Set();
  return new Set(stored.split(",").filter(Boolean));
}

export function ToolPicker() {
  const { progress, updateWorkshopState } = useProgressContext();
  const enabled = parseEnabled(progress.workshopState.enabledTools);

  function toggleTool(id: string) {
    const next = new Set(enabled);
    if (next.has(id)) {
      // Keep at least one tool enabled so the AI always has something to try
      if (next.size <= 1) return;
      next.delete(id);
    } else {
      next.add(id);
    }
    updateWorkshopState({
      enabledTools: Array.from(next).join(","),
    });
  }

  function resetDefault() {
    updateWorkshopState({ enabledTools: DEFAULT_ENABLED });
  }

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
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </div>
        <span className="text-sm font-mono text-text-primary uppercase tracking-wider">
          Pick Your Tools
        </span>
      </div>

      <p className="text-sm text-text-muted mb-4">
        Turn tools on or off to see how the agent changes. Your choices apply
        to the next test call.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {TOOLS.map((tool) => {
          const isOn = enabled.has(tool.id);
          return (
            <button
              key={tool.id}
              onClick={() => toggleTool(tool.id)}
              aria-pressed={isOn}
              className={`text-left p-3 rounded-lg border-2 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-twilio-red/50 ${
                isOn
                  ? "border-twilio-red bg-twilio-red/15 shadow-[0_0_0_2px_rgba(239,34,58,0.25)]"
                  : "border-text-muted/30 bg-surface-2 hover:border-twilio-red/60 hover:bg-twilio-red/5 hover:-translate-y-0.5 active:translate-y-0 active:bg-twilio-red/10"
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="text-sm font-medium text-text-primary">
                  {tool.name}
                </div>
                <span
                  className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    isOn
                      ? "bg-twilio-red text-white"
                      : "bg-surface-3 text-text-muted"
                  }`}
                >
                  {isOn ? "On" : "Off"}
                </span>
              </div>
              <div className="text-xs text-text-muted leading-relaxed mb-2">
                {tool.desc}
              </div>
              {isOn && (
                <div className="text-[11px] text-twilio-red/90 font-mono">
                  {tool.tryThis}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-text-muted">
          {enabled.size} of {TOOLS.length} tools enabled
        </span>
        <button
          onClick={resetDefault}
          className="text-xs text-text-muted hover:text-text-primary underline underline-offset-2"
        >
          Reset to default
        </button>
      </div>
    </div>
  );
}
