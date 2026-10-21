import OpenAI from "openai";
import { buildSystemPrompt } from "./system-prompt.mjs";
import { toolDefinitions, executeTool, HANDOFF_TOOL_NAME } from "./tools.mjs";
import { recordEvent } from "../analytics/db.mjs";

const MAX_TOOL_ITERATIONS = 5;
const SILENCE_FIRST_MS = 12000;
const SILENCE_SECOND_MS = 10000;

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
        sendToken(ws, "It seems like you may have stepped away. I'll end the call now. Goodbye!", true);
        setTimeout(() => {
          sendEnd(ws);
        }, 3000);
        return;
      }
      console.log(`[voice-agent] [${callSid}] Silence nudge #${silenceCount}`);
      const nudge = silenceCount === 1
        ? "Are you still there? I'm here if you need anything."
        : "I haven't heard from you in a while. I'll hang up shortly if there's nothing else.";
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
          response.controller.signal, isCurrent
        );
        if (isCurrent() && result === "handoff") relayEnded = true;
      } catch (err) {
        if (!isCurrent() || err.name === "AbortError") return;
        console.error(`[voice-agent] [${callSid}] LLM error:`, err.message);
        // An error after a tool call can leave an assistant tool_calls entry
        // without its matching result. Keep the caller's turn, then record the
        // fallback they actually heard.
        conversationHistory.splice(response.historyStart);
        const fallback = "I'm sorry, I encountered a technical issue. Please try again.";
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
        handoffDestinationReady = /^\+[1-9]\d{1,14}$/.test(
          process.env.HANDOFF_PHONE_NUMBER?.trim() || ""
        );
        handoffAllowed = handoffRequested && handoffDestinationReady;
        config = {
          agentName: message.customParameters?.agentName,
          personality: message.customParameters?.personality,
          handoffEnabled: handoffAllowed,
        };
        activeTools = filterTools(message.customParameters?.enabledTools, handoffAllowed);
        conversationHistory = [
          { role: "system", content: buildSystemPrompt(config) },
        ];
        callStartTime = Date.now();
        console.log(
          `[voice-agent] Call ${callSid} connected from ${message.from}`
        );
        recordEvent(callSid, "call_connected", { callSid, from: message.from });
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
          startResponse("I want to check my order status.");
        } else if (message.digit === "2") {
          if (handoffAllowed) {
            relayEnded = true;
            recordEvent(callSid, "handoff_triggered", { callSid, reason: "keypad_request" });
            sendEnd(ws, JSON.stringify({
              reasonCode: "live-agent-handoff",
              reason: "keypad_request",
            }));
          } else {
            const reply = handoffRequested && !handoffDestinationReady
              ? "Live handoff is unavailable right now. I can keep helping you here."
              : "I can't transfer calls in this conversation, but I can keep helping you here.";
            sendToken(ws, reply, true);
            conversationHistory.push({ role: "assistant", content: reply });
            startSilenceTimer();
          }
        } else if (message.digit === "0") {
          const reply = "Returning to the main menu. Press 1 for order status, 2 for a representative, or just tell me what you need.";
          sendToken(ws, reply, true);
          conversationHistory.push({ role: "assistant", content: reply });
          startSilenceTimer();
        } else {
          const reply = "I didn't recognize that option. Press 1 for order status, or 2 for a representative.";
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
    recordEvent(callSid, "call_ended", { callSid, durationMs });
    clearSilenceTimer();
  });
}

const LANG_MARKER_RE = /\[LANG:([a-z]{2}-[A-Z]{2})\]/g;

async function streamLLMResponse(openai, history, ws, callSid, tools, handoffAllowed, signal, isCurrent) {
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

        // Buffer text when we see a potential partial language marker starting
        if (/\[LANG[^\]]*$/.test(pendingSend)) {
          continue;
        }

        // Check for complete language markers
        const langMatches = [...pendingSend.matchAll(LANG_MARKER_RE)];
        if (langMatches.length > 0) {
          const lastMatch = langMatches[langMatches.length - 1];
          const langCode = lastMatch[1];
          pendingSend = pendingSend.replace(LANG_MARKER_RE, "");
          console.log(`[voice-agent] [${callSid}] Language switch: ${langCode}`);
          recordEvent(callSid, "language_switched", { callSid, langCode });
          sendLanguage(ws, langCode);
        }

        if (pendingSend) {
          sendToken(ws, pendingSend, false);
        }
        pendingSend = "";
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
        recordEvent(callSid, "handoff_triggered", { callSid, reason: args.reason });

        sendEnd(ws, JSON.stringify({
          reasonCode: "live-agent-handoff",
          reason: args.reason || "caller_requested_human",
          summary: args.summary || "",
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
        recordEvent(callSid, "tool_used", { callSid, toolName: tc.name, args });
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
    break;
  }

  if (isCurrent() && iterations >= MAX_TOOL_ITERATIONS) {
    console.warn(`[voice-agent] [${callSid}] Hit tool iteration limit`);
    sendToken(ws, "I apologize, I'm having trouble completing that request.", true);
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
