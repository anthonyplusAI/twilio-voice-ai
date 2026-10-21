import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoot = mkdtempSync(join(tmpdir(), "workshop-events-test-"));
for (const entry of [".next", "next.config.ts", "node_modules", "package.json", "public"]) {
  symlinkSync(join(projectRoot, entry), join(fixtureRoot, entry));
}

let app;
let baseUrl;

async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

before(async () => {
  const port = await unusedPort();
  baseUrl = `http://127.0.0.1:${port}`;
  let output = "";
  app = spawn(process.execPath, [join(projectRoot, "server.mjs")], {
    cwd: fixtureRoot,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout.on("data", (chunk) => { output += chunk; });
  app.stderr.on("data", (chunk) => { output += chunk; });

  for (let i = 0; i < 80; i++) {
    if (app.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch { /* Wait for startup. */ }
    await delay(250);
  }
  throw new Error(`Workshop server did not start:\n${output}`);
});

after(() => {
  app?.kill("SIGTERM");
  rmSync(fixtureRoot, { recursive: true, force: true });
});

async function postEvents(body, headers = {}) {
  return fetch(`${baseUrl}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function eventsFor(sessionId) {
  const path = join(fixtureRoot, "data", "analytics.db");
  if (!existsSync(path)) return [];
  const db = new Database(path, { readonly: true });
  try {
    return db.prepare("SELECT event_type, payload FROM events WHERE session_id = ? ORDER BY id")
      .all(sessionId);
  } finally {
    db.close();
  }
}

test("browser analytics events are accepted and recorded", async () => {
  const sessionId = "valid-browser-session";
  const events = [
    { type: "session_started", payload: { audience: "builder" } },
    { type: "audience_changed", payload: { from: "builder", to: "explorer" } },
    { type: "step_viewed", payload: { chapterId: 2, stepId: 1, chapterSlug: "build", stepSlug: "start" } },
    { type: "step_completed", payload: { chapterId: 2, stepId: 1, chapterSlug: "build", stepSlug: "start" } },
    { type: "badge_earned", payload: { badgeId: "chapter-2" } },
    { type: "agent_configured", payload: { field: "welcomeGreeting", value: "Hello!" } },
    { type: "skip_ahead", payload: { fromStep: "intro/start", toStep: "build/start" } },
    { type: "share_clicked", payload: { platform: "linkedin" } },
    { type: "progress_reset", payload: {} },
  ];

  const response = await postEvents({ sessionId, events });
  assert.equal(response.status, 204);
  assert.deepEqual(eventsFor(sessionId).map((row) => row.event_type), events.map((event) => event.type));
});

test("a batch above 100 events is rejected before any event is recorded", async () => {
  const sessionId = "oversized-event-count";
  const events = Array.from({ length: 101 }, () => ({
    type: "session_started", payload: { audience: "builder" },
  }));

  const response = await postEvents({ sessionId, events });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /events/i);
  assert.equal(eventsFor(sessionId).length, 0);
});

test("a declared body above 32 KiB is rejected with 413", async () => {
  const sessionId = "oversized-content-length";
  const body = { sessionId, events: [{ type: "agent_configured", payload: {
    field: "personality", value: "x".repeat(33_000),
  } }] };

  const response = await postEvents(body);
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /large/i);
  assert.equal(eventsFor(sessionId).length, 0);
  assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
});

test("a chunked body above 32 KiB is rejected while streaming", async () => {
  const sessionId = "oversized-chunked-body";
  const body = JSON.stringify({ sessionId, events: [{ type: "agent_configured", payload: {
    field: "personality", value: "x".repeat(33_000),
  } }] });
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
    }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  assert.equal(status, 413);
  assert.equal(eventsFor(sessionId).length, 0);
  assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
});

test("malformed JSON and invalid session IDs receive 400", async () => {
  const malformed = await postEvents("{");
  assert.equal(malformed.status, 400);

  for (const sessionId of ["", 42, "bad\nheader"]) {
    const response = await postEvents({ sessionId, events: [] });
    assert.equal(response.status, 400, String(sessionId));
  }
});

test("invalid event shapes reject the whole batch without a partial insert", async () => {
  const cases = [
    null,
    { type: 12, payload: {} },
    { type: "call_initiated", payload: {} },
    { type: "session_started", payload: { audience: "unknown" } },
    { type: "badge_earned", payload: ["chapter-2"] },
    { type: "step_completed", payload: { chapterId: 2 } },
    { type: "session_started", payload: { audience: "builder", extra: true } },
  ];

  for (const [index, event] of cases.entries()) {
    const sessionId = `invalid-event-${index}`;
    const response = await postEvents({ sessionId, events: [
      { type: "session_started", payload: { audience: "builder" } },
      event,
    ] });
    assert.equal(response.status, 400, JSON.stringify(event));
    assert.equal(eventsFor(sessionId).length, 0);
  }
});
