"use client";

import { useState, useEffect } from "react";
import { Phone, PhoneOff, Loader2 } from "lucide-react";
import { useAudienceMode } from "@/lib/AudienceContext";
import { useProgressContext } from "@/components/layout/ProgressContext";
import { useAnalyticsContext } from "@/lib/AnalyticsContext";
import { validateBuilderTwimlUrl } from "@/lib/call-target";

type CallStatus = "idle" | "calling" | "requested" | "error";

const TWIML_URL_KEY = "workshop-builder-twiml-url";

export function CallMe() {
  const { isBuilder } = useAudienceMode();
  const { progress, incrementCalls, updateWorkshopState } =
    useProgressContext();
  const { sessionId } = useAnalyticsContext();

  const [phoneNumber, setPhoneNumber] = useState(
    () => progress.workshopState.phoneNumber || ""
  );
  const [twimlUrl, setTwimlUrl] = useState("");
  const [useBuiltIn, setUseBuiltIn] = useState(false);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [callSid, setCallSid] = useState("");

  useEffect(() => {
    if (isBuilder) {
      try {
        const stored = localStorage.getItem(TWIML_URL_KEY) || "";
        queueMicrotask(() => setTwimlUrl(stored));
      } catch {
        // The field still works when browser storage is unavailable.
      }
    }
  }, [isBuilder]);

  const builderUrlError = isBuilder && !useBuiltIn
    ? validateBuilderTwimlUrl(twimlUrl)
    : null;

  async function handleCall() {
    if (!phoneNumber.trim()) return;
    if (builderUrlError) {
      setStatus("error");
      setErrorMessage(builderUrlError);
      return;
    }

    setStatus("calling");
    setErrorMessage("");
    setCallSid("");

    updateWorkshopState({ phoneNumber: phoneNumber.trim() });

    const body: Record<string, unknown> = {
      phoneNumber: phoneNumber.trim(),
      target: isBuilder && !useBuiltIn ? "builder" : "built-in",
      sessionId: sessionId.current || undefined,
      agentConfig: {
        agentName: progress.workshopState.agentName || undefined,
        voice: progress.workshopState.voice || undefined,
        ttsProvider: progress.workshopState.ttsProvider || undefined,
        language: progress.workshopState.language || undefined,
        personality: progress.workshopState.personality || undefined,
        welcomeGreeting: progress.workshopState.welcomeGreeting || undefined,
        enabledTools: progress.workshopState.enabledTools,
        handoffEnabled: progress.workshopState.handoffEnabled || undefined,
      },
    };

    if (isBuilder && !useBuiltIn) {
      body.twimlUrl = twimlUrl.trim();
    }

    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error || "Call failed");
        return;
      }

      setCallSid(data.callSid);
      setStatus("requested");
      incrementCalls();

      setTimeout(() => setStatus("idle"), 30000);
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Network error"
      );
    }
  }

  const isDisabled = status === "calling" || !phoneNumber.trim() || Boolean(builderUrlError);

  return (
    <div className="rounded-xl border border-navy-border bg-surface-1 p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Phone className="w-5 h-5 text-twilio-red" />
        <span className="text-sm font-mono text-text-primary uppercase tracking-wider">
          Call Me
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <label
            htmlFor="phone-number"
            className="block text-xs text-text-muted mb-1"
          >
            Your phone number (E.164 format)
          </label>
          <input
            id="phone-number"
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+15551234567"
            className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-navy-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-twilio-red/50"
          />
        </div>

        {isBuilder && (
          <div>
            <label
              htmlFor="twiml-url"
              className="block text-xs text-text-muted mb-1"
            >
              Your TwiML URL
            </label>
            <input
              id="twiml-url"
              type="url"
              value={twimlUrl}
              onChange={(e) => {
                const value = e.target.value;
                setTwimlUrl(value);
                try {
                  localStorage.setItem(TWIML_URL_KEY, value);
                } catch {
                  // A blocked storage write should not block calling.
                }
              }}
              placeholder="https://your-tunnel.trycloudflare.com/twiml"
              disabled={useBuiltIn}
              aria-describedby={useBuiltIn ? undefined : "twiml-url-help"}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-navy-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-twilio-red/50 disabled:opacity-50"
            />
            {!useBuiltIn && (
              <p
                id="twiml-url-help"
                className={`mt-1 text-xs ${twimlUrl.trim() && builderUrlError ? "text-error" : "text-text-muted"}`}
              >
                {twimlUrl.trim() && builderUrlError
                  ? builderUrlError
                  : "Run tunnel-url in your Codespace and paste the full URL. Your next call will use your saved server code."}
              </p>
            )}
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useBuiltIn}
                onChange={(e) => setUseBuiltIn(e.target.checked)}
                className="rounded border-navy-border"
              />
              <span className="text-xs text-text-muted">
                Use the hosted reference agent instead
              </span>
            </label>
            {useBuiltIn && (
              <p className="mt-1 text-xs text-text-muted">
                This call uses the workshop agent. Edits in your Codespace will not affect it.
              </p>
            )}
          </div>
        )}

        <button
          onClick={handleCall}
          disabled={isDisabled}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            isDisabled
              ? "bg-surface-3 text-text-muted cursor-not-allowed"
              : "bg-twilio-red text-white hover:bg-twilio-red/90 active:bg-twilio-red/80"
          }`}
        >
          {status === "calling" ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Calling...
            </>
          ) : (
            <>
              <Phone className="w-4 h-4" />
              Call Me
            </>
          )}
        </button>

        {status === "requested" && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 border border-success/20">
            <Phone className="w-4 h-4 text-success animate-pulse" />
            <span className="text-xs text-success">
              Call requested — your phone should ring shortly. Pick up and say hi.
            </span>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-error/10 border border-error/20">
            <PhoneOff className="w-4 h-4 text-error" />
            <span className="text-xs text-error">{errorMessage}</span>
          </div>
        )}

        {callSid && (
          <div className="text-[11px] text-text-muted font-mono truncate">
            Call SID: {callSid}
          </div>
        )}
      </div>
    </div>
  );
}
