/**
 * Spoken greetings for the Explorer track. A greeting is translated only when
 * it exactly matches a workshop default or one of the three persona presets
 * (in any of the supported locales). Text written by an attendee stays theirs.
 *
 * Matching every localized variant lets someone switch Spanish → French →
 * English without losing which preset they originally selected. This also
 * repairs older saved progress that stored an English preset with a different
 * selected language.
 */

export const DEFAULT_EXPLORER_GREETING =
  "Hello! I'm your AI assistant. How can I help you today?";

const GREETINGS: ReadonlyArray<Readonly<Record<string, string>>> = [
  {
    "en-US": DEFAULT_EXPLORER_GREETING,
    "zh-CN": "你好！我是你的 AI 助手。今天有什么可以帮你？",
    "fr-FR": "Bonjour ! Je suis votre assistant IA. Comment puis-je vous aider aujourd'hui ?",
    "hi-IN": "नमस्ते! मैं आपका एआई सहायक हूँ। आज मैं आपकी कैसे मदद कर सकता हूँ?",
    "pt-BR": "Olá! Sou seu assistente de IA. Como posso ajudar você hoje?",
    "ru-RU": "Здравствуйте! Я ваш ИИ-помощник. Чем я могу вам сегодня помочь?",
    "es-ES": "¡Hola! Soy tu asistente de IA. ¿En qué puedo ayudarte hoy?",
  },
  {
    "en-US": "Hello! How can I help you today?",
    "zh-CN": "你好！今天有什么可以帮你？",
    "fr-FR": "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
    "hi-IN": "नमस्ते! आज मैं आपकी कैसे मदद कर सकता हूँ?",
    "pt-BR": "Olá! Como posso ajudar você hoje?",
    "ru-RU": "Здравствуйте! Чем я могу вам сегодня помочь?",
    "es-ES": "¡Hola! ¿En qué puedo ayudarte hoy?",
  },
  {
    "en-US": "Hey there! I'm Sam from Twilio Airways. Where can I help you fly today?",
    "zh-CN": "你好！我是 Twilio Airways 的 Sam。今天你想飞去哪里？",
    "fr-FR": "Bonjour ! Je suis Sam de Twilio Airways. Tu veux voyager où aujourd'hui ?",
    "hi-IN": "नमस्ते! मैं Twilio Airways से सैम हूँ। आज आप कहाँ उड़ना चाहेंगे?",
    "pt-BR": "Oi! Eu sou Sam, da Twilio Airways. Para onde você quer voar hoje?",
    "ru-RU": "Привет! Я Сэм из Twilio Airways. Куда хочешь полететь сегодня?",
    "es-ES": "¡Hola! Soy Sam de Twilio Airways. ¿A dónde te gustaría volar hoy?",
  },
  {
    "en-US": "Good day. This is Ms. Chen at the Twilio Grand Hotel. How may I assist you?",
    "zh-CN": "您好，我是 Twilio Grand Hotel 的陈女士。请问有什么可以帮您？",
    "fr-FR": "Bonjour. Ici Mme Chen du Twilio Grand Hotel. Comment puis-je vous aider ?",
    "hi-IN": "नमस्कार। मैं Twilio Grand Hotel से मिस चेन बोल रही हूँ। मैं आपकी क्या सहायता कर सकती हूँ?",
    "pt-BR": "Olá. Aqui é a Sra. Chen, do Twilio Grand Hotel. Como posso ajudar?",
    "ru-RU": "Здравствуйте. Это госпожа Чен из Twilio Grand Hotel. Чем я могу вам помочь?",
    "es-ES": "Hola. Le habla la señora Chen del Twilio Grand Hotel. ¿En qué puedo ayudarle?",
  },
  {
    "en-US": "Yo, what's up! Jake from Twilio Pizza Co. here. What can I get started for you?",
    "zh-CN": "嗨！我是 Twilio Pizza Co. 的 Jake。想点些什么？",
    "fr-FR": "Salut ! C'est Jake de Twilio Pizza Co. Qu'est-ce que je te sers ?",
    "hi-IN": "अरे, नमस्ते! मैं Twilio Pizza Co. से जेक हूँ। आपके लिए क्या मँगवा दूँ?",
    "pt-BR": "E aí! Aqui é o Jake, da Twilio Pizza Co. O que você gostaria de pedir?",
    "ru-RU": "Привет! Это Джейк из Twilio Pizza Co. Что хочешь заказать?",
    "es-ES": "¡Hola! Soy Jake de Twilio Pizza Co. ¿Qué te apetece pedir?",
  },
];

export function resolveExplorerGreeting(
  greeting: string | null | undefined,
  language: string,
): string {
  const candidate = greeting?.trim() || DEFAULT_EXPLORER_GREETING;
  const stock = GREETINGS.find((translations) =>
    Object.values(translations).includes(candidate),
  );
  if (!stock) return greeting!;
  return stock[language] ?? stock["en-US"];
}
