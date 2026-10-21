import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { getDb } from "../analytics/db.mjs";
import { getAllMetrics } from "../analytics/queries.mjs";

const originalCwd = process.cwd();
const fixtureRoot = mkdtempSync(join(tmpdir(), "workshop-analytics-queries-"));
process.chdir(fixtureRoot);
const db = getDb();

beforeEach(() => db.prepare("DELETE FROM events").run());
after(() => {
  db.close();
  process.chdir(originalCwd);
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function addEvent(sessionId, eventType, payload, minute) {
  db.prepare(`
    INSERT INTO events (session_id, event_type, payload, created_at)
    VALUES (?, ?, ?, datetime('now', 'start of day', ?))
  `).run(sessionId, eventType, JSON.stringify(payload), `+${minute} minutes`);
}

test("one Explorer attendee with one hosted voice call counts as one attendee", () => {
  addEvent("browser-explorer", "session_started", { audience: "explorer" }, 1);
  addEvent("browser-explorer", "step_viewed", { chapterId: 1, stepId: 1 }, 3);
  addEvent("browser-explorer", "call_initiated", { callSid: "CA-voice-call" }, 5);
  addEvent("CA-voice-call", "call_connected", { callSid: "CA-voice-call" }, 6);
  addEvent("CA-voice-call", "tool_used", { toolName: "getWeather" }, 8);
  addEvent("CA-voice-call", "handoff_triggered", { reason: "requested" }, 10);
  addEvent("CA-voice-call", "call_ended", { durationMs: 180_000 }, 30);

  for (const range of ["all", "today"]) {
    const metrics = getAllMetrics(range);
    assert.equal(metrics.overview.totalSessions, 1, `${range}: attendee count`);
    assert.equal(metrics.overview.sessionsToday, 1, `${range}: attendees today`);
    assert.equal(metrics.overview.builders, 0);
    assert.equal(metrics.overview.explorers, 1);
    assert.equal(metrics.pacing.totalSessions, 1, `${range}: browser session pacing`);
    assert.equal(metrics.engagement.avgEvents, 3, `${range}: browser events per session`);
    assert.equal(metrics.engagement.maxEvents, 3);
    assert.equal(metrics.engagement.minEvents, 3);
    assert.equal(metrics.calls.totalCalls, 1);
    assert.equal(metrics.calls.sessionsWithCalls, 1);
    assert.deepEqual(metrics.calls.toolUsage, [{ tool: "getWeather", c: 1 }]);
    assert.equal(metrics.calls.handoffs, 1);
    assert.equal(metrics.calls.avgCallDuration, 180);
  }
});

test("browser activity after an analytics reset still identifies an attendee", () => {
  // A tab can stay open when the organizer starts a new analytics run. Its
  // session_started event belonged to the archived run, but subsequent steps
  // remain browser-only evidence of an attendee in the new run.
  addEvent("still-open-browser", "step_viewed", { chapterId: 2, stepId: 1 }, 1);
  addEvent("still-open-browser", "step_completed", { chapterId: 2, stepId: 1 }, 3);
  addEvent("CA-voice-call", "call_connected", { callSid: "CA-voice-call" }, 2);
  addEvent("CA-voice-call", "call_ended", { durationMs: 60_000 }, 4);

  const metrics = getAllMetrics("all");
  assert.equal(metrics.overview.totalSessions, 1);
  assert.equal(metrics.overview.sessionsToday, 1);
  assert.equal(metrics.overview.builders, 0);
  assert.equal(metrics.overview.explorers, 0);
  assert.equal(metrics.pacing.totalSessions, 1);
  assert.equal(metrics.engagement.avgEvents, 2);
  assert.equal(metrics.calls.avgCallDuration, 60);
});

test("feedback totals cover the full range while recent comments stop at 200", () => {
  db.prepare(`
    INSERT INTO events (session_id, event_type, payload, created_at)
    VALUES (?, 'feedback', ?, datetime('now', 'start of day', '-1 day', '+1 minute'))
  `).run("older-feedback", JSON.stringify({ nps: 8, comment: "earlier response" }));
  db.prepare(`
    INSERT INTO events (session_id, event_type, payload, created_at)
    VALUES ('bad-feedback', 'feedback', '{invalid-json', datetime('now', 'start of day'))
  `).run();

  for (let index = 0; index < 205; index++) {
    addEvent(`feedback-${index}`, "feedback", {
      nps: index < 5 ? 0 : 10,
      comment: `response-${index}`,
    }, 2);
  }

  const all = getAllMetrics("all").feedback;
  assert.equal(all.total, 206);
  assert.equal(all.avgNps, 9.7);
  assert.equal(all.promoters, 200);
  assert.equal(all.passives, 1);
  assert.equal(all.detractors, 5);
  assert.equal(all.npsScore, 95);
  assert.equal(all.items.length, 200);
  assert.equal(all.items[0].comment, "response-204");
  assert.equal(all.items.at(-1).comment, "response-5");

  const today = getAllMetrics("today").feedback;
  assert.equal(today.total, 205);
  assert.equal(today.avgNps, 9.8);
  assert.equal(today.promoters, 200);
  assert.equal(today.passives, 0);
  assert.equal(today.detractors, 5);
  assert.equal(today.npsScore, 95);
  assert.equal(today.items.length, 200);
});
