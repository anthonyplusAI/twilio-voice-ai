"use client";

import { useProgressContext } from "@/components/layout/ProgressContext";
import {
  WORKSHOP_LANGUAGES,
  ENGLISH_ONLY_LANG_CODE,
  isEnglishOnlyVoice,
  getVoice,
} from "@/lib/voice-catalog";
import { resolveExplorerGreeting } from "@/lib/explorer-greeting";

export function LanguagePicker() {
  const { progress, updateWorkshopState } = useProgressContext();

  const currentLang = progress.workshopState.language || ENGLISH_ONLY_LANG_CODE;
  const currentVoiceId = progress.workshopState.voice;
  const englishOnly = isEnglishOnlyVoice(currentVoiceId);
  const lockedVoice = englishOnly ? getVoice(currentVoiceId) : undefined;

  function selectLanguage(code: string, disabled: boolean) {
    if (disabled) return;
    const nextState: Record<string, string> = { language: code };
    const savedGreeting = progress.workshopState.welcomeGreeting;
    if (savedGreeting) {
      const localized = resolveExplorerGreeting(savedGreeting, code);
      if (localized !== savedGreeting) nextState.welcomeGreeting = localized;
    }
    updateWorkshopState(nextState);
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
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </div>
        <span className="text-sm font-mono text-text-primary uppercase tracking-wider">
          Choose a Language
        </span>
      </div>

      <p className="text-sm text-text-muted mb-2">
        Select the language your agent will listen for and speak. This
        configures both speech recognition and text-to-speech.
      </p>
      <p className="text-xs text-text-muted mb-4">
        Conversation Relay supports 40+ languages -- these seven are the ones
        this workshop&apos;s voices cover. Preset greetings follow your choice;
        custom greetings stay as you wrote them.
      </p>

      {englishOnly && lockedVoice && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-twilio-blue/10 border border-twilio-blue/30">
          <p className="text-xs text-twilio-blue leading-relaxed">
            <span className="font-semibold">{lockedVoice.name} only speaks English.</span>{" "}
            Other languages are locked. Pick a different voice in the Choose a
            Voice widget to unlock them.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {WORKSHOP_LANGUAGES.map((lang) => {
          const isActive = currentLang === lang.code;
          const disabled = englishOnly && lang.code !== ENGLISH_ONLY_LANG_CODE;
          return (
            <button
              key={lang.code}
              onClick={() => selectLanguage(lang.code, disabled)}
              disabled={disabled}
              aria-disabled={disabled}
              className={`text-left p-3 rounded-lg border transition-colors ${
                disabled
                  ? "border-navy-border bg-surface-2/40 text-text-muted/40 cursor-not-allowed"
                  : isActive
                    ? "border-twilio-red bg-twilio-red/10 cursor-pointer"
                    : "border-navy-border bg-surface-2 hover:border-text-muted/30 cursor-pointer"
              }`}
            >
              <div
                className={`text-sm font-medium ${
                  disabled ? "text-text-muted/50" : "text-text-primary"
                }`}
              >
                {lang.label}
              </div>
              <div
                className={`text-xs font-mono ${
                  disabled ? "text-text-muted/40" : "text-text-muted"
                }`}
              >
                {lang.code}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 px-3 py-2 rounded-lg bg-twilio-red/5 border border-twilio-red/20">
        <span className="text-xs text-twilio-red">
          Active:{" "}
          {WORKSHOP_LANGUAGES.find((l) => l.code === currentLang)?.label ||
            currentLang}
        </span>
      </div>
    </div>
  );
}
