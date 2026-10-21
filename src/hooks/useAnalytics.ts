"use client";

import { useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { createAnalyticsQueue } from "@/lib/analytics-queue.mjs";

const SESSION_KEY = "workshop-analytics-session";
const FLUSH_INTERVAL_MS = 5000;

let fallbackSessionId = "";
let activeSessionId = "";
let activeQueue: ReturnType<typeof createAnalyticsQueue> | null = null;

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getPendingStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getSessionId(storage: Storage | null): string {
  let id = "";
  try {
    id = storage?.getItem(SESSION_KEY) ?? "";
  } catch { /* Keep a stable in-memory session when storage is unavailable. */ }
  if (!id) {
    id = fallbackSessionId || crypto.randomUUID();
    try {
      storage?.setItem(SESSION_KEY, id);
    } catch { /* Analytics can still use the in-memory session. */ }
  }
  fallbackSessionId = id;
  return id;
}

function browserQueue() {
  if (typeof window === "undefined") return null;
  const id = getSessionId(getSessionStorage());
  if (!activeQueue || activeSessionId !== id) {
    activeSessionId = id;
    activeQueue = createAnalyticsQueue({
      sessionId: id,
      storage: getPendingStorage(),
      send: (body: string) => fetch("/api/events", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }),
      beacon: (body: string) =>
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" })),
      newId: () => crypto.randomUUID(),
    });
  }
  return activeQueue;
}

function flushQueue(queue: ReturnType<typeof createAnalyticsQueue> | null) {
  if (!queue) return;
  void queue.flush().catch((error: unknown) => {
    console.error("[analytics] Could not flush pending events", error);
  });
}

export function useAnalytics() {
  const sessionId = useRef("");

  const getQueue = useCallback(() => {
    const queue = browserQueue();
    if (queue) sessionId.current = activeSessionId;
    return queue;
  }, []);

  const flush = useCallback(() => {
    flushQueue(getQueue());
  }, [getQueue]);

  // CallMe reads this ref in its click handler. A layout effect fills it
  // during hydration, before the visitor can interact with the page.
  useLayoutEffect(() => {
    getQueue();
  }, [getQueue]);

  useEffect(() => {
    flush(); // Retry events saved before a navigation or reload.
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);
    const onPagehide = () => getQueue()?.beaconOnPagehide();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") flush();
    };
    window.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPagehide);
    return () => {
      clearInterval(interval);
      window.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPagehide);
      flush();
    };
  }, [flush, getQueue]);

  const emit = useCallback((type: string, payload?: Record<string, unknown>) => {
    const queue = getQueue();
    queue?.emit(type, payload);
    flushQueue(queue);
  }, [getQueue]);

  return { emit, sessionId };
}
