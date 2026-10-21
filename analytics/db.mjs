import Database from "better-sqlite3";
import { TableClient } from "@azure/data-tables";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createAzureAnalyticsStore } from "./durable-store.mjs";

export { createAzureAnalyticsStore } from "./durable-store.mjs";

let db = null;

function getDbPath() {
  // SQLite stays local because Azure Files does not provide its locking
  // semantics. Production durability comes from Azure Table storage.
  const dir = join(process.cwd(), "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "analytics.db");
}

export function initializeAnalyticsSchema(instance) {
  instance.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      event_uid TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
  `);
  if (!instance.pragma("table_info(events)").some((column) => column.name === "event_uid")) {
    instance.exec("ALTER TABLE events ADD COLUMN event_uid TEXT");
  }
  instance.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_events_uid ON events(event_uid)");
}

export function getDb() {
  if (db) return db;

  const instance = new Database(getDbPath());
  instance.pragma("journal_mode = WAL");
  instance.pragma("synchronous = NORMAL");
  instance.pragma("busy_timeout = 5000");
  initializeAnalyticsSchema(instance);

  db = instance;
  return db;
}

export function createAnalyticsRepository({ database = getDb, store = null, now = () => new Date(), idFactory = randomUUID } = {}) {
  const getDatabase = typeof database === "function" ? database : () => database;
  // Admin pages refresh every 30 seconds. Keep one Table scan per replica in
  // each ten-second window and share an in-flight scan across concurrent pages.
  const refreshIntervalMs = 10_000;
  let cachedGenerationId;
  let lastRefreshAt = -Infinity;
  let mutationVersion = 0;
  let scannedMutationVersion = -1;
  let refreshInFlight;
  const insertSql = `
    INSERT INTO events (session_id, event_type, payload, created_at, event_uid)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(event_uid) DO NOTHING
  `;
  const insert = (event) => {
    const d = getDatabase();
    const result = d.prepare(insertSql)
      .run(event.sessionId, event.eventType, event.payloadJson, event.createdAt, event.id);
    if (result.changes === 1) return true;
    const existing = d.prepare("SELECT session_id, event_type, payload FROM events WHERE event_uid = ?").get(event.id);
    if (!existing || existing.session_id !== event.sessionId ||
        existing.event_type !== event.eventType || existing.payload !== event.payloadJson) {
      throw new Error("Analytics event ID was reused for different content");
    }
    return false;
  };

  function replaceCache(events) {
    const d = getDatabase();
    const sorted = [...events].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      (a.legacyOrder ?? 0) - (b.legacyOrder ?? 0) ||
      a.id.localeCompare(b.id));
    d.transaction(() => {
      d.prepare("DELETE FROM events").run();
      d.prepare("DELETE FROM sqlite_sequence WHERE name = 'events'").run();
      const statement = d.prepare(insertSql);
      for (const event of sorted) {
        statement.run(event.sessionId, event.eventType, event.payloadJson, event.createdAt, event.id);
      }
    })();
  }

  function addNewEvents(events) {
    const d = getDatabase();
    const currentCount = d.prepare("SELECT COUNT(*) AS count FROM events").get().count;
    if (currentCount === events.length) return;
    // The durable generation is append-only. If its count shrinks, rebuild the
    // disposable cache from the source of truth instead of showing stale rows.
    if (currentCount > events.length) {
      replaceCache(events);
      return;
    }
    const existingIds = new Set(d.prepare("SELECT event_uid FROM events").all().map((row) => row.event_uid));
    const additions = events.filter((event) => !existingIds.has(event.id));
    const lastCreatedAt = d.prepare("SELECT MAX(created_at) AS time FROM events").get().time;
    if (additions.some((event) => lastCreatedAt !== null && event.createdAt <= lastCreatedAt)) {
      // A historical import or delayed event can change the order used by
      // session and recent-activity queries. Reorder only on that rare path.
      replaceCache(events);
      return;
    }
    const sorted = additions.sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      (a.legacyOrder ?? 0) - (b.legacyOrder ?? 0) ||
      a.id.localeCompare(b.id));
    const statement = d.prepare(insertSql);
    d.transaction(() => {
      for (const event of sorted) {
        statement.run(event.sessionId, event.eventType, event.payloadJson, event.createdAt, event.id);
      }
    })();
  }

  function clearLocalCache() {
    const d = getDatabase();
    d.transaction(() => {
      d.prepare("DELETE FROM events").run();
      d.prepare("DELETE FROM sqlite_sequence WHERE name = 'events'").run();
    })();
  }

  async function refreshCache() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const generation = await store.getGeneration();
      const currentTime = new Date(now()).getTime();
      const age = currentTime - lastRefreshAt;
      if (cachedGenerationId === generation.id &&
          scannedMutationVersion === mutationVersion &&
          age >= 0 && age < refreshIntervalMs) {
        const count = getDatabase().prepare("SELECT COUNT(*) AS count FROM events").get().count;
        return { generation: generation.id, count };
      }
      const versionAtStart = mutationVersion;
      const events = await store.listEvents(generation.id);
      const beforeApply = await store.getGeneration();
      if (beforeApply.id !== generation.id) continue;
      if (cachedGenerationId === generation.id) addNewEvents(events);
      else replaceCache(events);
      cachedGenerationId = generation.id;
      const afterApply = await store.getGeneration();
      if (afterApply.id === generation.id) {
        lastRefreshAt = new Date(now()).getTime();
        scannedMutationVersion = versionAtStart;
        return { generation: generation.id, count: events.length };
      }
    }
    throw new Error("Analytics reset changed while refreshing the dashboard; retry the request");
  }

  return {
    async recordEvent(sessionId, eventType, payload, eventId = idFactory(), createdAt, legacyOrder, occurredAt) {
      const event = {
        id: eventId,
        sessionId,
        eventType,
        payloadJson: payload == null ? null : JSON.stringify(payload),
        createdAt: createdAt ?? new Date(now()).toISOString().replace("T", " ").replace("Z", ""),
        legacyOrder,
        ...(typeof occurredAt === "string" ? { occurredAt } : {}),
      };
      if (store) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const generation = await store.getGeneration();
          const result = await store.writeEvent(generation.id, event);
          const active = await store.getGeneration();
          if (active.id !== generation.id) continue;
          // Only dashboard refreshes mutate the local query cache. Otherwise a
          // write racing a Table scan could be overwritten by that scan.
          mutationVersion++;
          return result;
        }
        throw new Error("Analytics reset changed while recording an event; retry the event");
      }
      return { inserted: insert(event), event };
    },
    async syncFromDurableStore() {
      if (!store) return;
      if (!refreshInFlight) {
        refreshInFlight = refreshCache().finally(() => { refreshInFlight = null; });
      }
      return refreshInFlight;
    },
    async wipeAllEvents() {
      if (store) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const generation = await store.getGeneration();
          const events = await store.listEvents(generation.id);
          const nextGeneration = await store.rotateGeneration(generation.version);
          if (!nextGeneration) continue;
          // The Table rotation already committed. A broken disposable cache
          // must not make the organizer see a failure and reset again.
          try {
            clearLocalCache();
          } catch (error) {
            console.error("[analytics] Could not clear the local query cache after reset:", error);
          }
          // Force the next dashboard read to rebuild from the active Table
          // generation, even if clearing SQLite failed.
          cachedGenerationId = undefined;
          lastRefreshAt = -Infinity;
          scannedMutationVersion = -1;
          return events.length;
        }
        throw new Error("Analytics reset changed concurrently; retry the request");
      }
      const d = getDatabase();
      const before = d.prepare("SELECT COUNT(*) AS c FROM events").get().c;
      clearLocalCache();
      return before;
    },
  };
}

let defaultRepository;
function getDefaultRepository() {
  if (!defaultRepository) {
    const connectionString = process.env.CALL_LIMIT_AZURE_TABLE_CONNECTION_STRING;
    if (!connectionString && process.env.NODE_ENV === "production" &&
        process.env.ANALYTICS_LOCAL_ONLY_FOR_TESTS !== "1") {
      throw new Error("Durable Azure Table storage is required for production analytics");
    }
    const store = connectionString
      ? createAzureAnalyticsStore(TableClient.fromConnectionString(
        connectionString,
        process.env.ANALYTICS_AZURE_TABLE_NAME || "AnalyticsEvents",
      ))
      : null;
    defaultRepository = createAnalyticsRepository({ store });
  }
  return defaultRepository;
}

export async function recordEvent(sessionId, eventType, payload, eventId, createdAt, legacyOrder, occurredAt) {
  return getDefaultRepository().recordEvent(sessionId, eventType, payload, eventId, createdAt, legacyOrder, occurredAt);
}

export async function syncFromDurableStore() {
  return getDefaultRepository().syncFromDurableStore();
}

export async function wipeAllEvents() {
  return getDefaultRepository().wipeAllEvents();
}
