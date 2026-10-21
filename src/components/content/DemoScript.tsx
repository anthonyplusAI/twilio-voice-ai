"use client";

import { useProgressContext } from "@/components/layout/ProgressContext";
import { useAudienceMode } from "@/lib/AudienceContext";

const TOOL_SCRIPT: Record<string, { label: string; line: string }> = {
  check_weather: {
    label: "Weather lookup",
    line: "What is the weather in San Francisco?",
  },
  lookup_order: {
    label: "Order lookup",
    line: "Can you check the status of order 123?",
  },
  tell_joke: {
    label: "Joke",
    line: "Tell me a joke.",
  },
};

const ALL_TOOL_IDS = Object.keys(TOOL_SCRIPT);

type SpokenPrompts = {
  check_weather: string;
  lookup_order: string;
  tell_joke: string;
  interruption: string;
  handoff: string;
  handoffOff: string;
};

// The instructions remain in English for the workshop attendee, while the
// quoted phrases are ready to say in the language their Explorer agent uses.
const EXPLORER_SPOKEN: Record<string, SpokenPrompts> = {
  "en-US": {
    check_weather: "What is the weather in San Francisco?",
    lookup_order: "Can you check the status of order 123?",
    tell_joke: "Tell me a joke.",
    interruption: "Can you tell me about your services in detail?",
    handoff: "I need to speak to a person.",
    handoffOff: "Can I speak to a person?",
  },
  "zh-CN": {
    check_weather: "旧金山的天气怎么样？",
    lookup_order: "能帮我查一下订单 123 的状态吗？",
    tell_joke: "讲个笑话吧。",
    interruption: "请详细介绍一下你能提供的服务。",
    handoff: "我需要和真人客服说话。",
    handoffOff: "我可以和真人客服说话吗？",
  },
  "fr-FR": {
    check_weather: "Quel temps fait-il à San Francisco ?",
    lookup_order: "Pouvez-vous vérifier le statut de la commande 123 ?",
    tell_joke: "Racontez-moi une blague.",
    interruption: "Pouvez-vous me parler en détail de vos services ?",
    handoff: "Je voudrais parler à une personne.",
    handoffOff: "Puis-je parler à une personne ?",
  },
  "hi-IN": {
    check_weather: "सैन फ्रांसिस्को में मौसम कैसा है?",
    lookup_order: "क्या आप ऑर्डर 123 की स्थिति बता सकते हैं?",
    tell_joke: "मुझे एक चुटकुला सुनाइए।",
    interruption: "कृपया अपनी सेवाओं के बारे में विस्तार से बताइए।",
    handoff: "मुझे किसी व्यक्ति से बात करनी है।",
    handoffOff: "क्या मैं किसी व्यक्ति से बात कर सकता हूँ?",
  },
  "pt-BR": {
    check_weather: "Como está o tempo em São Francisco?",
    lookup_order: "Você pode verificar o status do pedido 123?",
    tell_joke: "Conte uma piada.",
    interruption: "Você pode me explicar seus serviços em detalhes?",
    handoff: "Preciso falar com uma pessoa.",
    handoffOff: "Posso falar com uma pessoa?",
  },
  "ru-RU": {
    check_weather: "Какая погода в Сан-Франциско?",
    lookup_order: "Можете проверить статус заказа 123?",
    tell_joke: "Расскажите анекдот.",
    interruption: "Расскажите подробнее о ваших услугах.",
    handoff: "Мне нужно поговорить с человеком.",
    handoffOff: "Можно поговорить с человеком?",
  },
  "es-ES": {
    check_weather: "¿Qué tiempo hace en San Francisco?",
    lookup_order: "¿Puedes consultar el estado del pedido 123?",
    tell_joke: "Cuéntame un chiste.",
    interruption: "¿Puedes contarme con detalle qué servicios ofreces?",
    handoff: "Necesito hablar con una persona.",
    handoffOff: "¿Puedo hablar con una persona?",
  },
};

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
  const spoken = EXPLORER_SPOKEN[progress.workshopState.language || "en-US"] ||
    EXPLORER_SPOKEN["en-US"];

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
      detail: `Say: "${isBuilder ? tool.line : spoken[toolId as keyof SpokenPrompts]}"${isBuilder ? " Skip this if you removed the tool from your code." : ""}`,
    });
  }

  steps.push({
    title: "Test interruption",
    detail: isBuilder
      ? "Ask a long question, then start talking again before the agent finishes. The agent should stop and listen."
      : `Say: "${spoken.interruption}" Then start talking again before the agent finishes. The agent should stop and listen.`,
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
      detail: `Say: "${spoken.handoff}" The agent should transfer if the workshop has a live handoff number configured; otherwise it should explain that handoff is unavailable.`,
    });
  } else {
    steps.push({
      title: "Ask for a human (handoff is off)",
      detail: `Say: "${spoken.handoffOff}" The agent should politely decline and keep trying to help.`,
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
