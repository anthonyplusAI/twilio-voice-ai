/**
 * Explorer-facing ElevenLabs voice catalog. This is the single source of truth
 * that VoicePicker, LanguagePicker, and AgentConfig read from so the three
 * widgets stay in sync.
 *
 * Two voice shapes:
 * - "English only" voices (languages: [ENGLISH_ONLY_LANG_CODE]) are trained on
 *   US English only. When one is selected, LanguagePicker disables non-English
 *   tiles so the attendee cannot put the agent in a state that will not work.
 * - "Multilingual" voices support the seven workshop languages and can be
 *   paired with any of them.
 *
 * Voice IDs come from the ElevenLabs voice library and have been verified to
 * render with Twilio Conversation Relay + ElevenLabs as the ttsProvider.
 */

export const ENGLISH_ONLY_LANG_CODE = "en-US";

/**
 * The seven languages the workshop's multilingual voices support. Both
 * VoicePicker and LanguagePicker use this list.
 */
export const WORKSHOP_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "en-US", label: "English (US)" },
  { code: "zh-CN", label: "Chinese (Mandarin)" },
  { code: "fr-FR", label: "French" },
  { code: "hi-IN", label: "Hindi" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "ru-RU", label: "Russian" },
  { code: "es-ES", label: "Spanish (Spain)" },
];

export type VoiceProvider = "ElevenLabs" | "Google" | "Amazon";

export type VoiceEntry = {
  id: string;
  name: string;
  provider: VoiceProvider;
  gender: "Male" | "Female";
  /**
   * BCP-47 codes this voice supports. English-only voices list exactly one
   * code (ENGLISH_ONLY_LANG_CODE); multilingual voices list all seven
   * workshop languages.
   */
  languages: string[];
  /** Short tone descriptor shown on the tile ("Friendly", "Smooth", etc). */
  type: string;
};

const ALL_WORKSHOP_LANG_CODES = WORKSHOP_LANGUAGES.map((l) => l.code);

/**
 * Curated list of voices Explorers can pick from. Order matters —
 * the three persona-tied English-only voices are first so they align with the
 * persona presets in AgentConfig, then the six multilingual voices follow.
 * Google + Amazon Polly entries can be added here later; VoicePicker groups by
 * provider at render time.
 */
export const VOICE_CATALOG: VoiceEntry[] = [
  // ElevenLabs English-only — matched 1:1 with persona presets in AgentConfig.
  {
    id: "s0XGIcqmceN2l7kjsqoZ",
    name: "Lucas",
    provider: "ElevenLabs",
    gender: "Male",
    languages: [ENGLISH_ONLY_LANG_CODE],
    type: "Friendly",
  },
  {
    id: "uMM5TEnpKKgD758knVJO",
    name: "Liz",
    provider: "ElevenLabs",
    gender: "Female",
    languages: [ENGLISH_ONLY_LANG_CODE],
    type: "Professional",
  },
  {
    id: "4e32WqNVWRquDa1OcRYZ",
    name: "Ryan",
    provider: "ElevenLabs",
    gender: "Male",
    languages: [ENGLISH_ONLY_LANG_CODE],
    type: "Casual",
  },

  // ElevenLabs multilingual — available across all seven workshop languages.
  {
    id: "gUABw7pXQjhjt0kNFBTF",
    name: "Andrew",
    provider: "ElevenLabs",
    gender: "Male",
    languages: ALL_WORKSHOP_LANG_CODES,
    type: "Smooth",
  },
  {
    id: "4YYIPFl9wE5c4L2eu2Gb",
    name: "Burt",
    provider: "ElevenLabs",
    gender: "Male",
    languages: ALL_WORKSHOP_LANG_CODES,
    type: "Deep",
  },
  {
    id: "FVQMzxJGPUBtfz1Azdoy",
    name: "Danielle",
    provider: "ElevenLabs",
    gender: "Female",
    languages: ALL_WORKSHOP_LANG_CODES,
    type: "Gentle",
  },
  {
    id: "OYWwCdDHouzDwiZJWOOu",
    name: "David",
    provider: "ElevenLabs",
    gender: "Male",
    languages: ALL_WORKSHOP_LANG_CODES,
    type: "Cowboy",
  },
  {
    id: "XfNU2rGpBa01ckF309OY",
    name: "Nichalia",
    provider: "ElevenLabs",
    gender: "Female",
    languages: ALL_WORKSHOP_LANG_CODES,
    type: "Friendly",
  },
  {
    id: "SaqYcK3ZpDKBAImA8AdW",
    name: "Jane Doe",
    provider: "ElevenLabs",
    gender: "Female",
    languages: ALL_WORKSHOP_LANG_CODES,
    type: "Narration",
  },

  // Google TTS — the language code prefix in the voice ID (e.g. en-US-...) is
  // the language that voice speaks. Twilio's TTS voices docs list Google
  // voices as monolingual, so each entry carries exactly one language. Just
  // two voices here as a sample — Twilio supports many more.
  {
    id: "en-US-Chirp3-HD-Aoede",
    name: "Aoede",
    provider: "Google",
    gender: "Female",
    languages: [ENGLISH_ONLY_LANG_CODE],
    type: "Generative",
  },
  {
    id: "en-US-Chirp3-HD-Charon",
    name: "Charon",
    provider: "Google",
    gender: "Male",
    languages: [ENGLISH_ONLY_LANG_CODE],
    type: "Generative",
  },

  // Amazon Polly — Twilio's TTS voices docs treat most Polly voices as
  // monolingual. A few bilingual voices are marked with an asterisk on the
  // TTS voices page; add those with a multi-entry languages list when
  // curating them.
  {
    id: "Joanna-Neural",
    name: "Joanna",
    provider: "Amazon",
    gender: "Female",
    languages: [ENGLISH_ONLY_LANG_CODE],
    type: "Neural",
  },
  {
    id: "Matthew-Neural",
    name: "Matthew",
    provider: "Amazon",
    gender: "Male",
    languages: [ENGLISH_ONLY_LANG_CODE],
    type: "Neural",
  },
  // Amy (en-GB) removed from the Explorer catalog: the LanguagePicker only
  // offers en-US right now, so selecting an en-GB-only voice would leave the
  // picker in a state with no valid language. Re-add when en-GB joins
  // WORKSHOP_LANGUAGES.
];

/**
 * Returns true if the voice ID matches an English-only voice in the catalog.
 * Used by LanguagePicker to lock non-English languages when appropriate.
 */
export function isEnglishOnlyVoice(voiceId: string | undefined): boolean {
  if (!voiceId) return false;
  const voice = VOICE_CATALOG.find((v) => v.id === voiceId);
  return !!voice && voice.languages.length === 1 &&
    voice.languages[0] === ENGLISH_ONLY_LANG_CODE;
}

/** Find a voice entry by its ID. */
export function getVoice(voiceId: string | undefined): VoiceEntry | undefined {
  if (!voiceId) return undefined;
  return VOICE_CATALOG.find((v) => v.id === voiceId);
}
