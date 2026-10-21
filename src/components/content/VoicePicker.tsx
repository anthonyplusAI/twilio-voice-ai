"use client";

import { useProgressContext } from "@/components/layout/ProgressContext";
import {
  VOICE_CATALOG,
  ENGLISH_ONLY_LANG_CODE,
  type VoiceEntry,
  type VoiceProvider,
} from "@/lib/voice-catalog";
import { resolveExplorerGreeting } from "@/lib/explorer-greeting";

function languageSummary(voice: VoiceEntry): string {
  if (
    voice.languages.length === 1 &&
    voice.languages[0] === ENGLISH_ONLY_LANG_CODE
  ) {
    return "English only";
  }
  // Multilingual voices support the full workshop language set — short-hand
  // that by counting rather than listing every label.
  return `${voice.languages.length} languages`;
}

function providerLabel(provider: string): string {
  return provider === "Amazon" ? "Amazon Polly" : provider;
}

/**
 * Groups the catalog by provider while preserving the catalog's in-order
 * ranking (English-only persona voices first, then multilingual, then the
 * other providers). A `Map` keeps insertion order, so the first provider
 * encountered wins the first slot on screen.
 */
function groupVoicesByProvider(): Array<{
  provider: VoiceProvider;
  voices: VoiceEntry[];
}> {
  const map = new Map<VoiceProvider, VoiceEntry[]>();
  for (const voice of VOICE_CATALOG) {
    if (!map.has(voice.provider)) {
      map.set(voice.provider, []);
    }
    map.get(voice.provider)!.push(voice);
  }
  return Array.from(map.entries()).map(([provider, voices]) => ({
    provider,
    voices,
  }));
}

export function VoicePicker() {
  const { progress, updateWorkshopState } = useProgressContext();

  const currentVoice = progress.workshopState.voice || "";
  const savedProvider = progress.workshopState.ttsProvider || "ElevenLabs";
  const currentProvider = savedProvider === "Amazon Polly" ? "Amazon" : savedProvider;
  const currentLanguage = progress.workshopState.language || "en-US";

  function selectVoice(voice: VoiceEntry) {
    // If the selected voice does not support the current language, snap the
    // language to the first language the voice supports. This keeps the
    // stored state coherent — LanguagePicker also disables unsupported tiles
    // when the active voice restricts the choice.
    const nextState: Record<string, string> = {
      voice: voice.id,
      ttsProvider: voice.provider,
      voiceLabel: voice.name,
    };
    if (!voice.languages.includes(currentLanguage)) {
      const nextLanguage = voice.languages[0];
      nextState.language = nextLanguage;
      const savedGreeting = progress.workshopState.welcomeGreeting;
      if (savedGreeting) {
        const localized = resolveExplorerGreeting(savedGreeting, nextLanguage);
        if (localized !== savedGreeting) nextState.welcomeGreeting = localized;
      }
    }
    updateWorkshopState(nextState);
  }

  const groups = groupVoicesByProvider();

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
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>
        <span className="text-sm font-mono text-text-primary uppercase tracking-wider">
          Choose a Voice
        </span>
      </div>

      <p className="text-sm text-text-muted mb-4">
        Select the voice your agent will use when it speaks. This takes effect
        on your next call.
      </p>

      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.provider}>
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">
              {providerLabel(group.provider)}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {group.voices.map((voice) => {
                const isActive =
                  currentVoice === voice.id &&
                  currentProvider === voice.provider;
                const isEnglishOnly =
                  voice.languages.length === 1 &&
                  voice.languages[0] === ENGLISH_ONLY_LANG_CODE;
                return (
                  <button
                    key={voice.id}
                    onClick={() => selectVoice(voice)}
                    className={`text-left p-3 rounded-lg border-2 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-twilio-red/50 ${
                      isActive
                        ? "border-twilio-red bg-twilio-red/15 shadow-[0_0_0_2px_rgba(239,34,58,0.25)]"
                        : "border-text-muted/30 bg-surface-2 hover:border-twilio-red/60 hover:bg-twilio-red/5 hover:-translate-y-0.5 active:translate-y-0 active:bg-twilio-red/10"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="text-sm font-medium text-text-primary">
                        {voice.name}
                      </div>
                      {isEnglishOnly && (
                        <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-twilio-blue/10 text-twilio-blue border border-twilio-blue/30">
                          EN only
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted leading-relaxed space-y-0.5">
                      <div>{voice.gender}</div>
                      <div>{languageSummary(voice)}</div>
                      <div className="text-twilio-red/80">{voice.type}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {currentVoice && (
        <div className="mt-4 px-3 py-2 rounded-lg bg-twilio-red/5 border border-twilio-red/20">
          <span className="text-xs text-twilio-red">
            Active: {progress.workshopState.voiceLabel || currentVoice} ({providerLabel(currentProvider)})
          </span>
        </div>
      )}

      <p className="mt-3 text-xs text-text-muted leading-relaxed">
        The voices above are a sample. Conversation Relay supports many more
        Google and Amazon Polly voices across 40+ languages -- see the{" "}
        <a
          href="https://www.twilio.com/docs/voice/conversationrelay/voice-configuration"
          target="_blank"
          rel="noopener noreferrer"
          className="text-twilio-red hover:underline focus:outline-none focus:ring-2 focus:ring-twilio-red/50 rounded"
        >
          voice configuration docs
        </a>{" "}
        for the full list. For ElevenLabs, browse the{" "}
        <a
          href="https://elevenlabs-voice-tester-5339-dev.twil.io/index.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-twilio-red hover:underline focus:outline-none focus:ring-2 focus:ring-twilio-red/50 rounded"
        >
          ElevenLabs catalog
        </a>{" "}
        in a new tab.
      </p>
    </div>
  );
}
