"use client";

import { useProgressContext } from "@/components/layout/ProgressContext";
import { resolveExplorerGreeting } from "@/lib/explorer-greeting";

const LANGUAGE_LABELS: Record<string, string> = {
  "en-US": "English (US)",
  "en-GB": "English (UK)",
  "es-ES": "Spanish (Spain)",
  "es-MX": "Spanish (Mexico)",
  "fr-FR": "French",
  "fr-CA": "French (Canada)",
  "de-DE": "German",
  "pt-BR": "Portuguese (Brazil)",
  "ja-JP": "Japanese",
  "ko-KR": "Korean",
  "zh-CN": "Chinese (Mandarin)",
  "it-IT": "Italian",
  "hi-IN": "Hindi",
  "ru-RU": "Russian",
};

export function AgentSummary() {
  const { progress } = useProgressContext();
  const s = progress.workshopState;

  const name = s.agentName?.trim() || "Your Agent";
  const personality = s.personality?.trim();
  const greeting = resolveExplorerGreeting(s.welcomeGreeting, s.language || "en-US");
  const voiceLabel = s.voiceLabel?.trim();
  const ttsProvider = s.ttsProvider?.trim();
  const voiceId = s.voice?.trim();
  const voiceDisplay =
    [ttsProvider, voiceLabel, voiceId].filter(Boolean).join(", ") || null;
  const languageCode = s.language || "en-US";
  const languageLabel = LANGUAGE_LABELS[languageCode] || languageCode;

  const tone = personality ? personality.split(".")[0].trim() : null;

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
            <path d="M12 2l2.09 6.26L20 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 5.91-1.01L12 2z" />
          </svg>
        </div>
        <span className="text-sm font-mono text-text-primary uppercase tracking-wider">
          Meet Your Agent
        </span>
      </div>

      <div className="mb-5 pb-5 border-b border-navy-border">
        <div className="text-xs text-text-muted mb-1">Name</div>
        <div className="text-2xl font-semibold text-text-primary">{name}</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SummaryRow label="Tone" value={tone} fallback="No personality set" />
        <SummaryRow
          label="Voice"
          value={voiceDisplay}
          fallback="No voice selected"
        />
        <SummaryRow label="Language" value={languageLabel} />
        <SummaryRow
          label="Greeting"
          value={greeting}
        />
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  fallback,
}: {
  label: string;
  value: string | null | undefined;
  fallback?: string;
}) {
  const hasValue = Boolean(value);
  return (
    <div>
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div
        className={`text-sm ${
          hasValue ? "text-text-primary" : "text-text-muted/60 italic"
        }`}
      >
        {hasValue ? value : fallback}
      </div>
    </div>
  );
}
