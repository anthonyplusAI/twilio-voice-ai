"use client";

import { useProgressContext } from "@/components/layout/ProgressContext";

export function HandoffToggle() {
  const { progress, updateWorkshopState } = useProgressContext();
  const isOn = progress.workshopState.handoffEnabled === "true";

  function toggle() {
    updateWorkshopState({
      handoffEnabled: isOn ? "false" : "true",
    });
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
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>
        <span className="text-sm font-mono text-text-primary uppercase tracking-wider">
          Live Handoff
        </span>
      </div>

      <p className="text-sm text-text-muted mb-4">
        When the caller asks for a human, should the agent hand off the call?
        This setting applies to your next test call. Off by default — flip it on
        to test handoff.
      </p>

      <button
        onClick={toggle}
        aria-pressed={isOn}
        className={`w-full text-left p-4 rounded-lg border-2 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-twilio-red/50 ${
          isOn
            ? "border-twilio-red bg-twilio-red/15 shadow-[0_0_0_2px_rgba(239,34,58,0.25)]"
            : "border-text-muted/30 bg-surface-2 hover:border-twilio-red/60 hover:bg-twilio-red/5"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary mb-1">
              {isOn ? "Handoff is on" : "Handoff is off"}
            </div>
            <div className="text-xs text-text-muted leading-relaxed">
              {isOn
                ? "If a live handoff number is configured, the agent can transfer the call when asked."
                : "The agent will politely decline requests to reach a human and keep trying to help."}
            </div>
          </div>
          <div
            className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${
              isOn ? "bg-twilio-red" : "bg-surface-4"
            }`}
          >
            <div
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                isOn ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </div>
        </div>
      </button>

      <div className="mt-4 px-3 py-2 rounded-lg bg-twilio-blue/5 border border-twilio-blue/10">
        <p className="text-xs text-text-secondary leading-relaxed">
          <span className="font-medium text-text-primary">Try it both ways.</span>{" "}
          With handoff off, ask &quot;Can I speak to a human?&quot; — the agent
          will explain it can&apos;t transfer you. Flip it on and ask again — the
          agent will transfer when a live destination is configured.
        </p>
      </div>
    </div>
  );
}
