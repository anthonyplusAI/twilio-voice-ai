import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { buildSystemPrompt, WORKSHOP_LANGUAGE_CODES } from "./system-prompt.mjs";
import { getCallMessage } from "./locale-messages.mjs";
import { toolDefinitions, executeTool, HANDOFF_TOOL_NAME } from "./tools.mjs";
import { recordEvent } from "../analytics/db.mjs";

const MAX_TOOL_ITERATIONS = 5;
const SILENCE_FIRST_MS = 12000;
const SILENCE_SECOND_MS = 10000;

function recordVoiceEvent(sessionId, eventType, payload) {
  const eventId = randomUUID();
  void (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await recordEvent(sessionId, eventType, payload, eventId);
        return;
      } catch (err) {
        if (attempt < 2) {
          await delay(250 * 2 ** attempt);
        } else {
          console.error(`[analytics] Failed to record ${eventType} after retries:`, err);
        }
      }
    }
  })();
}

export function handleConversationRelayConnection(ws) {
  const openai = new OpenAI();
  let conversationHistory = [];
  let callSid = "";
  let config = {};
  let activeTools = toolDefinitions;
  let handoffAllowed = false;
  let handoffRequested = false;
  let handoffDestinationReady = false;
  let activeResponse = null;
  let relayEnded = false;
  let silenceTimer = null;
  let silenceCount = 0;
  let callStartTime = null;
  let currentLanguage = "en-US";

  function clearSilenceTimer() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function startSilenceTimer() {
    if (relayEnded) return;
    clearSilenceTimer();
    const timeout = silenceCount === 0 ? SILENCE_FIRST_MS : SILENCE_SECOND_MS;
    silenceTimer = setTimeout(async () => {
      if (activeResponse || relayEnded) return;
      silenceCount++;
      if (silenceCount >= 3) {
        console.log(`[voice-agent] [${callSid}] Ending call after prolonged silence`);
        sendToken(ws, getCallMessage(currentLanguage, "silenceFinal"), true);
        // Keep the farewell audible, but allow prompt/interrupt/DTMF to cancel
        // the pending hangup through clearSilenceTimer().
        silenceTimer = setTimeout(() => {
          silenceTimer = null;
          if (relayEnded) return;
          relayEnded = true;
          sendEnd(ws, JSON.stringify({
            reasonCode: "silence-timeout",
            language: currentLanguage,
          }));
        }, 3000);
        return;
      }
      console.log(`[voice-agent] [${callSid}] Silence nudge #${silenceCount}`);
      const nudge = silenceCount === 1
        ? getCallMessage(currentLanguage, "silenceFirst")
        : getCallMessage(currentLanguage, "silenceSecond");
      sendToken(ws, nudge, true);
      conversationHistory.push({ role: "assistant", content: nudge });
      startSilenceTimer();
    }, timeout);
  }

  function cancelActiveResponse() {
    const response = activeResponse;
    if (!response) return false;
    activeResponse = null;
    response.controller.abort();
    // Tool messages from an unfinished turn must not leak into the next request.
    conversationHistory.splice(response.historyStart);
    return true;
  }

  function startResponse(userPrompt) {
    if (relayEnded) return;
    cancelActiveResponse();
    conversationHistory.push({ role: "user", content: userPrompt });
    const response = {
      controller: new AbortController(),
      historyStart: conversationHistory.length,
    };
    activeResponse = response;
    const isCurrent = () => activeResponse === response &&
      !response.controller.signal.aborted && !relayEnded;

    void (async () => {
      try {
        const result = await streamLLMResponse(
          openai, conversationHistory, ws, callSid, activeTools, handoffAllowed,
          response.controller.signal, isCurrent,
          (langCode) => { currentLanguage = langCode; },
          () => currentLanguage
        );
        if (isCurrent() && result === "handoff") relayEnded = true;
        if (isCurrent() && result === "tool-limit") {
          const fallback = getCallMessage(currentLanguage, "toolLimit");
          sendToken(ws, fallback, true);
          conversationHistory.push({ role: "assistant", content: fallback });
        }
      } catch (err) {
        if (!isCurrent() || err.name === "AbortError") return;
        console.error(`[voice-agent] [${callSid}] LLM error:`, err.message);
        // An error after a tool call can leave an assistant tool_calls entry
        // without its matching result. Keep the caller's turn, then record the
        // fallback they actually heard.
        conversationHistory.splice(response.historyStart);
        const fallback = getCallMessage(currentLanguage, "technicalIssue");
        sendToken(ws, fallback, true);
        conversationHistory.push({ role: "assistant", content: fallback });
      } finally {
        if (activeResponse === response) {
          activeResponse = null;
          startSilenceTimer();
        }
      }
    })();
  }

  ws.on("message", async (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      console.error("[voice-agent] Invalid JSON received");
      return;
    }

    switch (message.type) {
      case "setup":
        callSid = message.callSid;
        handoffRequested = message.customParameters?.handoffEnabled === "true";
        const destination = process.env.HANDOFF_PHONE_NUMBER?.trim() || "";
        const phone = /^\+[1-9]\d{1,14}$/.test(destination)
          ? parsePhoneNumberFromString(destination)
          : null;
        handoffDestinationReady = Boolean(
          phone?.isValid() && ["US", "CA"].includes(phone.country) &&
          !["PREMIUM_RATE", "SHARED_COST"].includes(phone.getType() || "")
        );
        handoffAllowed = handoffRequested && handoffDestinationReady;
        config = {
          agentName: message.customParameters?.agentName,
          personality: message.customParameters?.personality,
          initialLanguage: SUPPORTED_LANGUAGE_CODES.has(message.customParameters?.initialLanguage)
            ? message.customParameters.initialLanguage : "en-US",
          handoffEnabled: handoffAllowed,
        };
        currentLanguage = config.initialLanguage;
        activeTools = filterTools(message.customParameters?.enabledTools, handoffAllowed);
        conversationHistory = [
          { role: "system", content: buildSystemPrompt(config) },
        ];
        callStartTime = Date.now();
        console.log(
          `[voice-agent] Call ${callSid} connected from ${message.from}`
        );
        recordVoiceEvent(callSid, "call_connected", { callSid, from: message.from });
        silenceCount = 0;
        startSilenceTimer();
        break;

      case "prompt":
        if (message.last === false) break;
        silenceCount = 0;
        clearSilenceTimer();
        console.log(`[voice-agent] [${callSid}] Caller: ${message.voicePrompt}`);
        startResponse(message.voicePrompt);
        break;

      case "interrupt":
        silenceCount = 0;
        clearSilenceTimer();
        console.log(
          `[voice-agent] [${callSid}] Interrupted after: "${message.utteranceUntilInterrupt}"`
        );
        if (cancelActiveResponse()) {
          if (message.utteranceUntilInterrupt) {
            conversationHistory.push({
              role: "assistant", content: message.utteranceUntilInterrupt,
            });
          }
        } else {
          trimHistoryToInterrupt(conversationHistory, message.utteranceUntilInterrupt);
        }
        startSilenceTimer();
        break;

      case "dtmf":
        silenceCount = 0;
        clearSilenceTimer();
        console.log(`[voice-agent] [${callSid}] DTMF: ${message.digit}`);
        cancelActiveResponse();
        if (message.digit === "1") {
          startResponse(getCallMessage(currentLanguage, "orderStatusRequest"));
        } else if (message.digit === "2") {
          if (handoffAllowed) {
            relayEnded = true;
            recordVoiceEvent(callSid, "handoff_triggered", { callSid, reason: "keypad_request" });
            sendEnd(ws, JSON.stringify({
              reasonCode: "live-agent-handoff",
              reason: "keypad_request",
              language: currentLanguage,
            }));
          } else {
            const reply = handoffRequested && !handoffDestinationReady
              ? getCallMessage(currentLanguage, "handoffUnavailable")
              : getCallMessage(currentLanguage, "handoffDisabled");
            sendToken(ws, reply, true);
            conversationHistory.push({ role: "assistant", content: reply });
            startSilenceTimer();
          }
        } else if (message.digit === "0") {
          const reply = getCallMessage(currentLanguage, "mainMenu");
          sendToken(ws, reply, true);
          conversationHistory.push({ role: "assistant", content: reply });
          startSilenceTimer();
        } else {
          const reply = getCallMessage(currentLanguage, "unknownDigit");
          sendToken(ws, reply, true);
          conversationHistory.push({ role: "assistant", content: reply });
          startSilenceTimer();
        }
        break;

      case "error":
        console.error(
          `[voice-agent] [${callSid}] Error: ${message.description}`
        );
        break;
    }
  });

  ws.on("error", (err) => {
    console.error(`[voice-agent] [${callSid}] WebSocket error:`, err.message);
    clearSilenceTimer();
  });

  ws.on("close", () => {
    relayEnded = true;
    cancelActiveResponse();
    const durationMs = callStartTime ? Date.now() - callStartTime : 0;
    console.log(`[voice-agent] Call ${callSid} disconnected`);
    recordVoiceEvent(callSid, "call_ended", { callSid, durationMs });
    clearSilenceTimer();
  });
}

const LANG_MARKER_RE = /\[LANG:([a-z]{2}-[A-Z]{2})\]/g;
const LANG_MARKER_PREFIX = "[LANG:";
const LANG_MARKER_LENGTH = "[LANG:xx-XX]".length;
const SUPPORTED_LANGUAGE_CODES = new Set(WORKSHOP_LANGUAGE_CODES);

function streamOutsideLanguageMarkers(ws, pending, onLanguage) {
  while (pending) {
    const markerStart = pending.indexOf("[");
    if (markerStart < 0) {
      sendToken(ws, pending, false);
      return "";
    }
    if (markerStart > 0) {
      sendToken(ws, pending.slice(0, markerStart), false);
      pending = pending.slice(markerStart);
    }

    // A marker can be split after any character. Hold its possible prefix
    // until enough bytes arrive to distinguish it from ordinary text.
    if (LANG_MARKER_PREFIX.startsWith(pending) ||
        (pending.startsWith(LANG_MARKER_PREFIX) && pending.length < LANG_MARKER_LENGTH)) {
      return pending;
    }

    const marker = pending.slice(0, LANG_MARKER_LENGTH).match(/^\[LANG:([a-z]{2}-[A-Z]{2})\]$/);
    if (marker) {
      onLanguage(marker[1]);
      pending = pending.slice(LANG_MARKER_LENGTH);
    } else {
      sendToken(ws, "[", false);
      pending = pending.slice(1);
    }
  }
  return "";
}

async function streamLLMResponse(
  openai, history, ws, callSid, tools, handoffAllowed,
  signal, isCurrent, onLanguageSwitch, getCurrentLanguage
) {
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    if (!isCurrent()) return;
    iterations++;

    const requestBody = {
      model: process.env.OPENAI_MODEL || "gpt-5.4-nano",
      messages: history,
      stream: true,
    };
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    const stream = await openai.chat.completions.create(requestBody, { signal });
    if (!isCurrent()) return;

    let fullResponse = "";
    let currentToolCalls = [];
    let hasToolCalls = false;
    let pendingSend = "";

    for await (const chunk of stream) {
      if (!isCurrent()) return;
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.tool_calls) {
        hasToolCalls = true;
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!currentToolCalls[idx]) {
            currentToolCalls[idx] = { id: "", name: "", arguments: "" };
          }
          if (tc.id) currentToolCalls[idx].id = tc.id;
          if (tc.function?.name) currentToolCalls[idx].name = tc.function.name;
          if (tc.function?.arguments)
            currentToolCalls[idx].arguments += tc.function.arguments;
        }
      }

      if (delta.content) {
        fullResponse += delta.content;
        pendingSend += delta.content;
        pendingSend = streamOutsideLanguageMarkers(ws, pendingSend, (langCode) => {
          if (!SUPPORTED_LANGUAGE_CODES.has(langCode)) {
            console.warn(`[voice-agent] [${callSid}] Ignoring unsupported language: ${langCode}`);
            return;
          }
          console.log(`[voice-agent] [${callSid}] Language switch: ${langCode}`);
          recordVoiceEvent(callSid, "language_switched", { callSid, langCode });
          sendLanguage(ws, langCode);
          onLanguageSwitch(langCode);
        });
      }
    }
    if (!isCurrent()) return;

    // Flush any remaining buffered text (e.g. partial marker that never completed)
    if (pendingSend) {
      const cleaned = pendingSend.replace(LANG_MARKER_RE, "");
      if (cleaned) {
        sendToken(ws, cleaned, false);
      }
    }

    if (hasToolCalls) {
      const validToolCalls = currentToolCalls.filter(Boolean);

      // Intercept transfer_to_agent: send `end` with handoffData instead of
      // continuing the tool loop. Twilio will POST HandoffData to the
      // <Connect action> URL, and a human agent picks up from there.
      const handoffCall = validToolCalls.find((tc) => tc.name === HANDOFF_TOOL_NAME);
      if (handoffCall) {
        if (!handoffAllowed) {
          console.log(`[voice-agent] [${callSid}] Suppressed transfer_to_agent (disabled)`);
          history.push({
            role: "assistant",
            content: null,
            tool_calls: [{
              id: handoffCall.id,
              type: "function",
              function: { name: handoffCall.name, arguments: handoffCall.arguments },
            }],
          });
          history.push({
            role: "tool",
            tool_call_id: handoffCall.id,
            content: JSON.stringify({ error: "Handoff is disabled for this call." }),
          });
          continue;
        }

        let args = {};
        try {
          args = JSON.parse(handoffCall.arguments);
        } catch {
          args = {};
        }
        console.log(`[voice-agent] [${callSid}] Handoff triggered: ${args.reason || ""}`);
        recordVoiceEvent(callSid, "handoff_triggered", { callSid, reason: args.reason });

        sendEnd(ws, JSON.stringify({
          reasonCode: "live-agent-handoff",
          reason: args.reason || "caller_requested_human",
          summary: args.summary || "",
          language: getCurrentLanguage(),
        }));
        return "handoff";
      }

      history.push({
        role: "assistant",
        content: null,
        tool_calls: validToolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of validToolCalls) {
        let args = {};
        try {
          args = JSON.parse(tc.arguments);
        } catch {
          args = {};
        }
        console.log(
          `[voice-agent] [${callSid}] Tool call: ${tc.name}(${JSON.stringify(args)})`
        );
        recordVoiceEvent(callSid, "tool_used", { callSid, toolName: tc.name, args });
        const result = executeTool(tc.name, args);
        history.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
      continue;
    }

    const cleanResponse = fullResponse.replace(LANG_MARKER_RE, "");
    if (cleanResponse) {
      history.push({ role: "assistant", content: cleanResponse });
      console.log(
        `[voice-agent] [${callSid}] Agent: ${cleanResponse.slice(0, 100)}${cleanResponse.length > 100 ? "..." : ""}`
      );
    }
    sendToken(ws, "", true);
    return;
  }

  if (isCurrent() && iterations >= MAX_TOOL_ITERATIONS) {
    console.warn(`[voice-agent] [${callSid}] Hit tool iteration limit`);
    return "tool-limit";
  }
}

function sendToken(ws, token, last) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type: "text", token, last }));
}

function sendEnd(ws, handoffData) {
  if (ws.readyState !== ws.OPEN) return;
  const msg = { type: "end" };
  if (handoffData) {
    msg.handoffData = handoffData;
  }
  ws.send(JSON.stringify(msg));
}

function sendLanguage(ws, langCode) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({
    type: "language",
    ttsLanguage: langCode,
    transcriptionLanguage: langCode,
  }));
}

export function filterTools(enabledParam, handoffEnabled = false) {
  const allow = enabledParam === undefined || enabledParam === null
    ? new Set(toolDefinitions.map((tool) => tool.function.name))
    : new Set(
        String(enabledParam)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );
  if (handoffEnabled) {
    allow.add(HANDOFF_TOOL_NAME);
  } else {
    allow.delete(HANDOFF_TOOL_NAME);
  }
  return toolDefinitions.filter((t) => allow.has(t.function.name));
}

function trimHistoryToInterrupt(history, partialUtterance) {
  const lastMessage = history.at(-1);
  if (lastMessage?.role === "assistant" && !lastMessage.tool_calls) {
    if (partialUtterance) {
      history[history.length - 1] = { role: "assistant", content: partialUtterance };
    } else {
      history.pop();
    }
  }
}
