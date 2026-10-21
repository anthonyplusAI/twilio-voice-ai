import assert from "node:assert/strict";
import { test } from "node:test";
import { createAnalyticsQueue } from "../src/lib/analytics-queue.mjs";

const textEncoder = new TextEncoder();
const OCCURRED_AT = "2026-10-21T12:34:56.000Z";

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function idGenerator() {
  let sequence = 0;
  return () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
}

function queue({ storage, send, beacon = () => false, newId = idGenerator(), sessionId = "browser-session", now = () => new Date(OCCURRED_AT) }) {
  return createAnalyticsQueue({
    sessionId,
    storage,
    send,
    beacon,
    newId,
    now,
  });
}

test("a later visit retries an event left behind when the original tab closed", async () => {
  const storage = memoryStorage();
  const original = queue({
    storage,
    sessionId: "closed-tab-session",
    send: async () => { throw new Error("the closed tab never flushed"); },
  });
  original.emit("session_started", { audience: "builder" });

  const requests = [];
  const laterVisit = queue({
    storage,
    sessionId: "new-tab-session",
    send: async (body) => {
      requests.push(JSON.parse(body));
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(await laterVisit.flush(), true);
  assert.deepEqual(requests, [{
    sessionId: "closed-tab-session",
    events: [{
      id: "00000000-0000-4000-8000-000000000001",
      type: "session_started", payload: { audience: "builder" }, occurredAt: OCCURRED_AT,
    }],
  }]);
});

test("two tabs with the same session ID do not overwrite each other's pending events", async () => {
  const storage = memoryStorage();
  const newId = idGenerator();
  const first = queue({ storage, newId, send: async () => new Response(null, { status: 503 }) });
  const second = queue({ storage, newId, send: async () => new Response(null, { status: 503 }) });
  first.emit("session_started", { audience: "builder" });
  second.emit("audience_changed", { from: "builder", to: "explorer" });

  const requests = [];
  const laterVisit = queue({
    storage,
    send: async (body) => {
      requests.push(JSON.parse(body));
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(await laterVisit.flush(), true);
  assert.deepEqual(requests.flatMap((request) => request.events.map((event) => event.type)), [
    "session_started", "audience_changed",
  ]);
});

test("a failed HTTP response is retried after navigation with the same event ID", async () => {
  const storage = memoryStorage();
  const requests = [];
  let currentTime = OCCURRED_AT;
  const now = () => new Date(currentTime);
  const first = queue({
    storage,
    now,
    send: async (body) => {
      requests.push(JSON.parse(body));
      return new Response(null, { status: 503 });
    },
  });
  first.emit("session_started", { audience: "builder" });

  assert.equal(await first.flush(), false);
  currentTime = "2026-10-21T12:35:56.000Z";
  const second = queue({
    storage,
    now,
    send: async (body) => {
      requests.push(JSON.parse(body));
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(await second.flush(), true);
  assert.deepEqual(requests, [
    { sessionId: "browser-session", events: [{
      id: "00000000-0000-4000-8000-000000000001",
      type: "session_started", payload: { audience: "builder" }, occurredAt: OCCURRED_AT,
    }] },
    { sessionId: "browser-session", events: [{
      id: "00000000-0000-4000-8000-000000000001",
      type: "session_started", payload: { audience: "builder" }, occurredAt: OCCURRED_AT,
    }] },
  ]);

  const third = queue({
    storage,
    send: async () => { throw new Error("acknowledged event was sent again"); },
  });
  assert.equal(await third.flush(), true);
});

test("a rejected network request leaves its event queued for the next flush", async () => {
  const storage = memoryStorage();
  const requests = [];
  let attempts = 0;
  const pending = queue({
    storage,
    send: async (body) => {
      requests.push(JSON.parse(body));
      if (++attempts === 1) throw new Error("offline");
      return new Response(null, { status: 204 });
    },
  });
  pending.emit("progress_reset", {});

  assert.equal(await pending.flush(), false);
  assert.equal(await pending.flush(), true);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
});

test("an unexpected 200 response does not acknowledge an analytics event", async () => {
  const storage = memoryStorage();
  const pending = queue({
    storage,
    send: async () => new Response("sign-in page", { status: 200 }),
  });
  pending.emit("session_started", { audience: "builder" });

  assert.equal(await pending.flush(), false);
  const retried = queue({
    storage,
    send: async () => new Response(null, { status: 204 }),
  });
  assert.equal(await retried.flush(), true);
});

test("concurrent flushes send one request and include an event emitted during the request", async () => {
  const storage = memoryStorage();
  const requests = [];
  let finishFirst;
  const firstResponse = new Promise((resolve) => { finishFirst = resolve; });
  const pending = queue({
    storage,
    send: async (body) => {
      requests.push(JSON.parse(body));
      return requests.length === 1 ? firstResponse : new Response(null, { status: 204 });
    },
  });
  pending.emit("session_started", { audience: "builder" });
  const flushOne = pending.flush();
  const flushTwo = pending.flush();
  pending.emit("audience_changed", { from: "builder", to: "explorer" });

  assert.equal(requests.length, 1);
  finishFirst(new Response(null, { status: 204 }));
  assert.equal(await flushOne, true);
  assert.equal(await flushTwo, true);
  assert.deepEqual(requests.map((request) => request.events.map((event) => event.type)), [
    ["session_started"], ["audience_changed"],
  ]);
});

test("large queues are sent in batches within the server event count and byte limits", async () => {
  const storage = memoryStorage();
  const bodies = [];
  const pending = queue({
    storage,
    send: async (body) => {
      bodies.push(body);
      return new Response(null, { status: 204 });
    },
  });
  for (let index = 0; index < 101; index++) {
    pending.emit("badge_earned", { badgeId: `chapter-${index}` });
  }
  for (let index = 0; index < 3; index++) {
    pending.emit("agent_configured", { field: "welcomeGreeting", value: "🌍".repeat(4_000) });
  }

  assert.equal(await pending.flush(), true);
  assert.equal(bodies.flatMap((body) => JSON.parse(body).events).length, 104);
  assert.ok(bodies.length >= 3);
  for (const body of bodies) {
    assert.ok(JSON.parse(body).events.length <= 100);
    assert.ok(textEncoder.encode(body).byteLength <= 32 * 1024);
  }
});

test("an unusually escaped configuration value cannot make one event exceed the body limit", async () => {
  const bodies = [];
  const pending = queue({
    storage: memoryStorage(),
    send: async (body) => {
      bodies.push(body);
      return new Response(null, { status: 204 });
    },
  });
  pending.emit("agent_configured", { field: "welcomeGreeting", value: "\0".repeat(8_192) });

  assert.equal(await pending.flush(), true);
  assert.equal(bodies.length, 1);
  assert.ok(textEncoder.encode(bodies[0]).byteLength <= 32 * 1024);
  assert.equal(JSON.parse(bodies[0]).events[0].type, "agent_configured");
});

test("pagehide beacon keeps events available for retry after navigation", async () => {
  const storage = memoryStorage();
  let beaconBody;
  const pending = queue({
    storage,
    send: async () => { throw new Error("pagehide should not use fetch"); },
    beacon: (body) => { beaconBody = JSON.parse(body); return true; },
  });
  pending.emit("share_clicked", { platform: "x" });

  assert.equal(pending.beaconOnPagehide(), true);
  const requests = [];
  const resumed = queue({
    storage,
    send: async (body) => {
      requests.push(JSON.parse(body));
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(await resumed.flush(), true);
  assert.deepEqual(requests, [beaconBody]);
});
