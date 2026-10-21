import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test, { mock } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import * as analyticsDb from "../analytics/db.mjs";

function createMemoryStore() {
  let generation = "generation-1";
  let version = 1;
  const events = new Map();
  return {
    getGeneration: async () => ({ id: generation, version: String(version) }),
    async writeEvent(generationId, event) {
      const key = `${generationId}/${event.id}`;
      const existing = events.get(key);
      if (existing) return { inserted: false, event: existing };
      events.set(key, event);
      return { inserted: true, event };
    },
    listEvents: async (generationId) => [...events.entries()]
      .filter(([key]) => key.startsWith(`${generationId}/`))
      .map(([, event]) => event),
    async rotateGeneration(expectedVersion) {
      if (expectedVersion !== String(version)) return null;
      generation = `generation-${++version}`;
      return { id: generation, version: String(version) };
    },
    allEvents: events,
  };
}

class FakeTableClient {
  constructor() {
    this.entities = new Map();
    this.version = 0;
  }

  async createTable() {}

  async getEntity(partitionKey, rowKey) {
    const entity = this.entities.get(`${partitionKey}/${rowKey}`);
    if (!entity) throw Object.assign(new Error("not found"), { statusCode: 404 });
    return { ...entity };
  }

  async createEntity(entity) {
    const key = `${entity.partitionKey}/${entity.rowKey}`;
    if (this.entities.has(key)) throw Object.assign(new Error("exists"), { statusCode: 409 });
    this.entities.set(key, { ...entity, etag: `etag-${++this.version}` });
  }

  async updateEntity(entity, mode, { etag }) {
    const key = `${entity.partitionKey}/${entity.rowKey}`;
    const current = this.entities.get(key);
    if (!current) throw Object.assign(new Error("not found"), { statusCode: 404 });
    if (current.etag !== etag) throw Object.assign(new Error("stale"), { statusCode: 412 });
    if (mode !== "Replace") throw new Error("Expected a full marker replacement");
    this.entities.set(key, { ...entity, etag: `etag-${++this.version}` });
  }

  async *listEntities({ queryOptions }) {
    const match = /^PartitionKey eq '([^']+)'$/.exec(queryOptions.filter);
    if (!match) throw new Error("Expected a partition-scoped Azure query");
    for (const entity of this.entities.values()) {
      if (entity.partitionKey === match[1]) yield { ...entity };
    }
  }
}

test("a retried event ID is counted once in local development", async () => {
  const database = new Database(":memory:");
  assert.equal(typeof analyticsDb.createAnalyticsRepository, "function");
  const { createAnalyticsRepository, initializeAnalyticsSchema } = analyticsDb;
  initializeAnalyticsSchema(database);
  const analytics = createAnalyticsRepository({ database, now: () => new Date("2026-10-21T17:00:00.123Z") });

  await analytics.recordEvent("session-1", "step_viewed", { stepId: 2 }, "event-1");
  await analytics.recordEvent("session-1", "step_viewed", { stepId: 2 }, "event-1");

  const rows = database.prepare("SELECT session_id, event_type, payload, created_at FROM events").all();
  assert.deepEqual(rows, [{
    session_id: "session-1",
    event_type: "step_viewed",
    payload: '{"stepId":2}',
    created_at: "2026-10-21 17:00:00.123",
  }]);
  database.close();
});

test("local development rejects an event ID reused for different content", async () => {
  const database = new Database(":memory:");
  analyticsDb.initializeAnalyticsSchema(database);
  const analytics = analyticsDb.createAnalyticsRepository({ database });
  await analytics.recordEvent("session-1", "step_viewed", { stepId: 1 }, "same-id");

  await assert.rejects(
    analytics.recordEvent("session-1", "step_viewed", { stepId: 2 }, "same-id"),
    /event ID was reused/,
  );
  assert.deepEqual(database.prepare("SELECT payload FROM events").all(), [{ payload: '{"stepId":1}' }]);
  database.close();
});

test("a second replica rebuilds its query cache from durable events", async () => {
  const store = createMemoryStore();
  const firstDb = new Database(":memory:");
  const secondDb = new Database(":memory:");
  analyticsDb.initializeAnalyticsSchema(firstDb);
  analyticsDb.initializeAnalyticsSchema(secondDb);
  const first = analyticsDb.createAnalyticsRepository({
    database: firstDb, store, now: () => new Date("2026-10-21T17:01:02.345Z"),
  });
  const second = analyticsDb.createAnalyticsRepository({ database: secondDb, store });

  await first.recordEvent("session-2", "badge_earned", { badgeId: "chapter-6" }, "event-2");
  await second.syncFromDurableStore();
  await second.syncFromDurableStore();

  assert.deepEqual(secondDb.prepare("SELECT session_id, event_type, payload, created_at FROM events").all(), [{
    session_id: "session-2",
    event_type: "badge_earned",
    payload: '{"badgeId":"chapter-6"}',
    created_at: "2026-10-21 17:01:02.345",
  }]);
  firstDb.close();
  secondDb.close();
});

test("dashboard refreshes share one Table scan and do not rescan a warm cache", async () => {
  let clock = Date.parse("2026-10-21T17:00:00.000Z");
  const store = createMemoryStore();
  const listEvents = store.listEvents;
  let scans = 0;
  store.listEvents = async (generationId) => {
    scans++;
    await new Promise((resolve) => setImmediate(resolve));
    return listEvents(generationId);
  };
  const database = new Database(":memory:");
  analyticsDb.initializeAnalyticsSchema(database);
  const analytics = analyticsDb.createAnalyticsRepository({
    database, store, now: () => new Date(clock),
  });

  await Promise.all([
    analytics.syncFromDurableStore(),
    analytics.syncFromDurableStore(),
    analytics.syncFromDurableStore(),
  ]);
  assert.equal(scans, 1);
  await analytics.syncFromDurableStore();
  assert.equal(scans, 1);
  clock += 11_000;
  await analytics.syncFromDurableStore();
  assert.equal(scans, 2);
  database.close();
});

test("ordinary refresh adds new events without deleting existing cached rows", async () => {
  let clock = Date.parse("2026-10-21T17:00:00.000Z");
  const store = createMemoryStore();
  const database = new Database(":memory:");
  analyticsDb.initializeAnalyticsSchema(database);
  const analytics = analyticsDb.createAnalyticsRepository({ database, store, now: () => new Date(clock) });
  await analytics.recordEvent("session-1", "session_started", {}, "first-id");
  await analytics.syncFromDurableStore();
  database.exec(`
    CREATE TABLE cache_deletions (event_uid TEXT);
    CREATE TRIGGER track_cache_deletions AFTER DELETE ON events
    BEGIN INSERT INTO cache_deletions (event_uid) VALUES (old.event_uid); END;
  `);
  await store.writeEvent((await store.getGeneration()).id, {
    id: "second-id", sessionId: "session-2", eventType: "session_started",
    payloadJson: "{}", createdAt: "2026-10-21 17:00:05.000",
  });
  clock += 11_000;
  await analytics.syncFromDurableStore();

  assert.equal(database.prepare("SELECT COUNT(*) AS c FROM cache_deletions").get().c, 0);
  assert.deepEqual(database.prepare("SELECT event_uid FROM events ORDER BY id").all(), [
    { event_uid: "first-id" }, { event_uid: "second-id" },
  ]);
  database.close();
});

test("a reset is visible immediately even while the prior cache is warm", async () => {
  let clock = Date.parse("2026-10-21T17:00:00.000Z");
  const store = createMemoryStore();
  const database = new Database(":memory:");
  analyticsDb.initializeAnalyticsSchema(database);
  const analytics = analyticsDb.createAnalyticsRepository({ database, store, now: () => new Date(clock) });
  await analytics.recordEvent("session-old", "session_started", {}, "old-id");
  await analytics.syncFromDurableStore();
  clock += 1_000;
  const current = await store.getGeneration();
  await store.rotateGeneration(current.version);
  await analytics.syncFromDurableStore();
  assert.equal(database.prepare("SELECT COUNT(*) AS c FROM events").get().c, 0);
  database.close();
});

test("a durable write failure rejects the event and leaves no local success", async () => {
  const store = createMemoryStore();
  store.writeEvent = async () => { throw new Error("Azure Table unavailable"); };
  const database = new Database(":memory:");
  analyticsDb.initializeAnalyticsSchema(database);
  const analytics = analyticsDb.createAnalyticsRepository({ database, store });

  await assert.rejects(
    analytics.recordEvent("session-3", "step_completed", { stepId: 3 }, "event-3"),
    /Azure Table unavailable/,
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS c FROM events").get().c, 0);
  database.close();
});

test("a committed durable event succeeds even if its disposable SQLite cache fails", async () => {
  const store = createMemoryStore();
  const database = new Database(":memory:");
  analyticsDb.initializeAnalyticsSchema(database);
  const analytics = analyticsDb.createAnalyticsRepository({ database, store });
  database.close();
  const errorLog = mock.method(console, "error", () => {});
  try {
    const result = await analytics.recordEvent("session-5", "step_viewed", { stepId: 5 }, "event-5");
    assert.equal(result.inserted, true);
    const active = await store.getGeneration();
    assert.equal((await store.listEvents(active.id)).length, 1);
  } finally {
    errorLog.mock.restore();
  }
});

test("reset hides old durable events on every replica while retaining them for recovery", async () => {
  const store = createMemoryStore();
  const firstDb = new Database(":memory:");
  const secondDb = new Database(":memory:");
  analyticsDb.initializeAnalyticsSchema(firstDb);
  analyticsDb.initializeAnalyticsSchema(secondDb);
  const first = analyticsDb.createAnalyticsRepository({ database: firstDb, store });
  const second = analyticsDb.createAnalyticsRepository({ database: secondDb, store });

  await first.recordEvent("session-old", "session_started", {}, "old-event");
  assert.equal(await first.wipeAllEvents(), 1);
  await second.syncFromDurableStore();
  assert.equal(secondDb.prepare("SELECT COUNT(*) AS c FROM events").get().c, 0);
  assert.equal(store.allEvents.size, 1);

  await second.recordEvent("session-new", "session_started", {}, "new-event");
  await first.syncFromDurableStore();
  assert.deepEqual(firstDb.prepare("SELECT session_id FROM events").all(), [{ session_id: "session-new" }]);
  firstDb.close();
  secondDb.close();
});

test("a durable reset succeeds even when its disposable SQLite cache is broken", async () => {
  const store = createMemoryStore();
  const active = await store.getGeneration();
  await store.writeEvent(active.id, {
    id: "old-event", sessionId: "session-old", eventType: "session_started",
    payloadJson: "{}", createdAt: "2026-10-21 17:00:00.000",
  });
  const database = new Database(":memory:");
  analyticsDb.initializeAnalyticsSchema(database);
  database.close();
  const analytics = analyticsDb.createAnalyticsRepository({ database, store });
  const errorLog = mock.method(console, "error", () => {});
  try {
    assert.equal(await analytics.wipeAllEvents(), 1);
    assert.equal((await store.getGeneration()).id, "generation-2");
    assert.equal((await store.listEvents("generation-2")).length, 0);
    assert.equal((await store.listEvents("generation-1")).length, 1);
  } finally {
    errorLog.mock.restore();
  }
});

test("a reset racing an event write keeps the event in the new active generation", async () => {
  const store = createMemoryStore();
  const originalWrite = store.writeEvent;
  let resetOnce = false;
  store.writeEvent = async (generationId, event) => {
    const result = await originalWrite(generationId, event);
    if (!resetOnce) {
      resetOnce = true;
      const current = await store.getGeneration();
      await store.rotateGeneration(current.version);
    }
    return result;
  };
  const database = new Database(":memory:");
  analyticsDb.initializeAnalyticsSchema(database);
  const analytics = analyticsDb.createAnalyticsRepository({ database, store });

  await analytics.recordEvent("session-race", "step_completed", { stepId: 4 }, "race-id");
  const active = await store.getGeneration();
  assert.equal((await store.listEvents(active.id)).length, 1);
  assert.equal(store.allEvents.size, 2);
  database.close();
});

test("a skewed browser clock cannot silently lose a post-reset event", async () => {
  let clock = Date.parse("2026-10-21T17:00:00.000Z");
  const store = createMemoryStore();
  const database = new Database(":memory:");
  analyticsDb.initializeAnalyticsSchema(database);
  const analytics = analyticsDb.createAnalyticsRepository({ database, store, now: () => new Date(clock) });
  clock += 60_000;
  const current = await store.getGeneration();
  await store.rotateGeneration(current.version);

  const result = await analytics.recordEvent(
    "session-old", "step_completed", { stepId: 1 }, "late-id",
    undefined, undefined, "2026-10-21T17:00:30.000Z",
  );
  assert.equal(result.inserted, true);
  assert.equal(result.discarded, undefined);
  assert.equal((await store.listEvents((await store.getGeneration()).id)).length, 1);
  database.close();
});

test("a reset racing a browser write keeps the acknowledged event in the active run", async () => {
  let clock = Date.parse("2026-10-21T17:00:00.000Z");
  const store = createMemoryStore();
  const originalWrite = store.writeEvent;
  let resetOnce = false;
  store.writeEvent = async (generationId, event) => {
    const result = await originalWrite(generationId, event);
    if (!resetOnce) {
      resetOnce = true;
      clock += 60_000;
      const current = await store.getGeneration();
      await store.rotateGeneration(current.version);
    }
    return result;
  };
  const database = new Database(":memory:");
  analyticsDb.initializeAnalyticsSchema(database);
  const analytics = analyticsDb.createAnalyticsRepository({ database, store, now: () => new Date(clock) });

  const result = await analytics.recordEvent(
    "session-old", "step_completed", { stepId: 1 }, "racing-late-id",
    undefined, undefined, "2026-10-21T17:00:00.000Z",
  );
  assert.equal(result.inserted, true);
  assert.equal(result.discarded, undefined);
  assert.equal((await store.listEvents((await store.getGeneration()).id)).length, 1);
  assert.equal(store.allEvents.size, 2);
  database.close();
});

test("Azure Table adapter creates one event per ID and rotates a conditional generation", async () => {
  assert.equal(typeof analyticsDb.createAzureAnalyticsStore, "function");
  const client = new FakeTableClient();
  const generations = ["generation-first", "generation-new"];
  const store = analyticsDb.createAzureAnalyticsStore(client, { idFactory: () => generations.shift() });
  const current = await store.getGeneration();
  assert.equal(current.id, "generation-first");
  const event = {
    id: "event-4",
    sessionId: "session-4",
    eventType: "feedback",
    payloadJson: '{"nps":10}',
    createdAt: "2026-10-21 17:02:03.000",
  };

  assert.equal((await store.writeEvent(current.id, event)).inserted, true);
  assert.equal((await store.writeEvent(current.id, { ...event, createdAt: "2026-10-21 17:09:00.000" })).inserted, false);
  assert.deepEqual(await store.listEvents(current.id), [event]);
  const next = await store.rotateGeneration(current.version);
  assert.equal(next.id, "generation-new");
  assert.equal(await store.rotateGeneration(current.version), null);
  assert.deepEqual(await store.listEvents(next.id), []);
  assert.deepEqual(await store.listEvents(current.id), [event]);
});

test("a reset confirms an Azure update whose response was lost", async () => {
  const client = new FakeTableClient();
  const originalUpdate = client.updateEntity.bind(client);
  client.updateEntity = async (...args) => {
    await originalUpdate(...args);
    throw new Error("Azure response lost after commit");
  };
  const generations = ["generation-first", "generation-new"];
  const store = analyticsDb.createAzureAnalyticsStore(client, { idFactory: () => generations.shift() });
  const current = await store.getGeneration();

  const next = await store.rotateGeneration(current.version);
  assert.equal(next.id, "generation-new");
  assert.equal((await store.getGeneration()).id, "generation-new");
});

test("production refuses to record analytics without durable storage", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "analytics-no-cloud-"));
  try {
    const modulePath = fileURLToPath(new URL("../analytics/db.mjs", import.meta.url));
    const program = `import { recordEvent } from ${JSON.stringify(modulePath)};
      try { await recordEvent("session", "session_started", {}, "id"); }
      catch (error) { console.error(error.message); process.exitCode = 17; }`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
      cwd: workingDirectory,
      env: { ...process.env, NODE_ENV: "production", CALL_LIMIT_AZURE_TABLE_CONNECTION_STRING: "" },
      encoding: "utf8",
    });
    assert.equal(result.status, 17, result.stderr);
    assert.match(result.stderr, /Durable Azure Table storage/);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("an explicit test fixture override permits local analytics in a production-mode subprocess", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "analytics-test-override-"));
  try {
    const modulePath = fileURLToPath(new URL("../analytics/db.mjs", import.meta.url));
    const program = `import { getDb, recordEvent } from ${JSON.stringify(modulePath)};
      await recordEvent("session", "session_started", {}, "id");
      console.log(getDb().prepare("SELECT COUNT(*) AS c FROM events").get().c);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
      cwd: workingDirectory,
      env: {
        ...process.env,
        NODE_ENV: "production",
        CALL_LIMIT_AZURE_TABLE_CONNECTION_STRING: "",
        ANALYTICS_LOCAL_ONLY_FOR_TESTS: "1",
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "1");
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("the exported event function forwards legacy snapshot ordering metadata", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "analytics-order-wrapper-"));
  try {
    const modulePath = fileURLToPath(new URL("../analytics/db.mjs", import.meta.url));
    const program = `import { recordEvent } from ${JSON.stringify(modulePath)};
      const result = await recordEvent("session", "step_viewed", {}, "id", "2026-04-18 14:22:00", 42);
      console.log(result.event.legacyOrder);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
      cwd: workingDirectory,
      env: { ...process.env, NODE_ENV: "development", CALL_LIMIT_AZURE_TABLE_CONNECTION_STRING: "" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "42");
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("legacy snapshot import preserves timestamps and skips a repeated import", async () => {
  const importer = await import("../analytics/import-snapshot.mjs").catch(() => ({}));
  assert.equal(typeof importer.importLegacySnapshot, "function");
  const workingDirectory = mkdtempSync(join(tmpdir(), "analytics-import-"));
  const snapshotPath = join(workingDirectory, "april.db");
  const snapshot = new Database(snapshotPath);
  snapshot.exec(`CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL
  )`);
  snapshot.prepare("INSERT INTO events (session_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)")
    .run("session-April", "session_started", '{"audience":"builder"}', "2026-04-18 14:22:00");
  snapshot.prepare("INSERT INTO events (session_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)")
    .run("session-April", "step_viewed", '{"stepId":1}', "2026-04-18 14:22:00");
  snapshot.close();

  const targetDb = new Database(":memory:");
  analyticsDb.initializeAnalyticsSchema(targetDb);
  const repository = analyticsDb.createAnalyticsRepository({ database: targetDb, store: createMemoryStore() });
  try {
    assert.deepEqual(await importer.importLegacySnapshot(snapshotPath, { sourceId: "april-share", repository }),
      { total: 2, imported: 2, skipped: 0 });
    assert.deepEqual(await importer.importLegacySnapshot(snapshotPath, { sourceId: "april-share", repository }),
      { total: 2, imported: 0, skipped: 2 });
    assert.deepEqual(targetDb.prepare("SELECT event_type, created_at FROM events ORDER BY id").all(), [
      { event_type: "session_started", created_at: "2026-04-18 14:22:00" },
      { event_type: "step_viewed", created_at: "2026-04-18 14:22:00" },
    ]);
  } finally {
    targetDb.close();
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
