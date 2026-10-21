"use client";

import { useState } from "react";
import { useProgressContext } from "@/components/layout/ProgressContext";
import { resolveExplorerGreeting } from "@/lib/explorer-greeting";

const PERSONA_PRESETS = [
  {
    label: "Friendly Assistant",
    name: "Sam",
    personality:
      "warm, upbeat, and casual. You are a travel assistant at Twilio Airways, helping callers with flights, bookings, and travel questions. You chat like a helpful friend and keep things light.",
    greeting: "Hey there! I'm Sam from Twilio Airways. Where can I help you fly today?",
    voice: "s0XGIcqmceN2l7kjsqoZ",
    voiceLabel: "Lucas",
    ttsProvider: "ElevenLabs",
    // All persona presets use English-only voices, so language snaps to en-US.
    language: "en-US",
  },
  {
    label: "Professional Concierge",
    name: "Ms. Chen",
    personality:
      "polished, courteous, and efficient. You are a concierge at the Twilio Grand Hotel, assisting guests with reservations, local recommendations, and hotel services. You are professional and precise with your words.",
    greeting:
      "Good day. This is Ms. Chen at the Twilio Grand Hotel. How may I assist you?",
    voice: "uMM5TEnpKKgD758knVJO",
    voiceLabel: "Liz",
    ttsProvider: "ElevenLabs",
    language: "en-US",
  },
  {
    label: "Casual Helper",
    name: "Jake",
    personality:
      "relaxed, fun, and approachable. You work at Twilio Pizza Co., helping customers order pizza, check on delivery status, and answer menu questions. You talk like a real person and keep things chill.",
    greeting: "Yo, what's up! Jake from Twilio Pizza Co. here. What can I get started for you?",
    voice: "4e32WqNVWRquDa1OcRYZ",
    voiceLabel: "Ryan",
    ttsProvider: "ElevenLabs",
    language: "en-US",
  },
];

export function AgentConfig() {
  const { progress, updateWorkshopState } = useProgressContext();
  // Saved progress loads after the first render. Keep only edits locally so a
  // revisited step shows the hydrated values without replacing text in flight.
  const [editedName, setCustomName] = useState<string | null>(null);
  const [editedPersonality, setCustomPersonality] = useState<string | null>(null);
  const [editedGreeting, setCustomGreeting] = useState<string | null>(null);
  const customName = editedName ?? progress.workshopState.agentName ?? "";
  const customPersonality = editedPersonality ?? progress.workshopState.personality ?? "";
  const savedGreeting = progress.workshopState.welcomeGreeting;
  const customGreeting = editedGreeting ?? (savedGreeting
    ? resolveExplorerGreeting(savedGreeting, progress.workshopState.language || "en-US")
    : "");

  function applyPreset(preset: (typeof PERSONA_PRESETS)[number]) {
    setCustomName(null);
    setCustomPersonality(null);
    setCustomGreeting(null);
    updateWorkshopState({
      agentName: preset.name,
      personality: preset.personality,
      welcomeGreeting: preset.greeting,
      voice: preset.voice,
      voiceLabel: preset.voiceLabel,
      ttsProvider: preset.ttsProvider,
      language: preset.language,
    });
  }

  function applyCustom() {
    updateWorkshopState({
      agentName: customName.trim(),
      personality: customPersonality.trim(),
      welcomeGreeting: customGreeting.trim(),
    });
    setCustomName(null);
    setCustomPersonality(null);
    setCustomGreeting(null);
  }

  const activePreset = PERSONA_PRESETS.find(
    (p) =>
      p.name === progress.workshopState.agentName &&
      p.personality === progress.workshopState.personality
  );

  // "Custom" mode = the user has saved non-empty values that do not match any
  // preset. The inputs drive workshopState on blur, so a mid-typing state
  // where customName differs from the saved name also counts as editing-toward-
  // custom and should show the indicator.
  const hasSavedValues = Boolean(
    progress.workshopState.agentName ||
      progress.workshopState.personality ||
      progress.workshopState.welcomeGreeting
  );
  const customDiffersFromPreset =
    !!activePreset &&
    (customName.trim() !== activePreset.name ||
      customPersonality.trim() !== activePreset.personality ||
      resolveExplorerGreeting(customGreeting, "en-US") !== activePreset.greeting);
  const isCustom =
    (hasSavedValues && !activePreset) || customDiffersFromPreset;

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
          </svg>
        </div>
        <span className="text-sm font-mono text-text-primary uppercase tracking-wider">
          Configure Your Agent
        </span>
      </div>

      <p className="text-sm text-text-muted mb-4">
        Pick a preset persona or create your own. These settings apply to your
        next call.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
        {PERSONA_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => applyPreset(preset)}
            className={`text-left p-3 rounded-lg border-2 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-twilio-red/50 ${
              activePreset === preset
                ? "border-twilio-red bg-twilio-red/15 shadow-[0_0_0_2px_rgba(239,34,58,0.25)]"
                : "border-text-muted/30 bg-surface-2 hover:border-twilio-red/60 hover:bg-twilio-red/5 hover:-translate-y-0.5 active:translate-y-0 active:bg-twilio-red/10"
            }`}
          >
            <div className="text-sm font-medium text-text-primary">
              {preset.label}
            </div>
            <div className="text-xs text-text-muted mt-1 line-clamp-2">
              {preset.name} &mdash; {preset.personality.split(".")[0]}.
            </div>
          </button>
        ))}
      </div>

      <div
        className={`space-y-3 rounded-lg p-4 border-2 transition-colors ${
          isCustom
            ? "border-twilio-blue bg-twilio-blue/10"
            : "border-transparent"
        }`}
      >
        <div>
          <label className="block text-xs text-text-muted mb-1">
            Agent Name
          </label>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onBlur={applyCustom}
            placeholder="e.g. Aria, Sam, Ms. Chen"
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-navy-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-twilio-red/50"
          />
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1">
            Personality
          </label>
          <textarea
            value={customPersonality}
            onChange={(e) => setCustomPersonality(e.target.value)}
            onBlur={applyCustom}
            placeholder="e.g. warm, upbeat, and casual. You chat like a helpful friend."
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-navy-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-twilio-red/50 resize-none"
          />
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1">
            Welcome Greeting
          </label>
          <input
            type="text"
            value={customGreeting}
            onChange={(e) => setCustomGreeting(e.target.value)}
            onBlur={applyCustom}
            placeholder="e.g. Hey there! I'm Sam. What can I help you with?"
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-navy-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-twilio-red/50"
          />
        </div>
      </div>

      {progress.workshopState.agentName && (
        <div className="mt-4 px-3 py-2 rounded-lg bg-twilio-red/5 border border-twilio-red/20">
          <span className="text-xs text-twilio-red">
            Active: {progress.workshopState.agentName}
            {progress.workshopState.personality &&
              ` \u2014 ${progress.workshopState.personality.split(".")[0]}.`}
          </span>
        </div>
      )}
    </div>
  );
}
