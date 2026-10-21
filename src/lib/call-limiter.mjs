import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { TableClient } from "@azure/data-tables";
import Database from "better-sqlite3";
import twilio from "twilio";

const MAX_CAS_ATTEMPTS = 20;
const HOUR_MS = 60 * 60 * 1000;
const MAX_STARTED_PER_HOUR = 10;
const ORPHAN_RESERVATION_MS = 10 * 60 * 1000;
const STATUS_CHECK_INTERVAL_MS = 15 * 1000;
const TERMINAL_CALL_STATUSES = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);
const TABLE_PARTITION_KEY = "v1";

/** Durable store. Each write uses an Azure Table ETag so separate replicas cannot reserve together. */
export function createAzureCallLimitStore(tableClient) {
  let tableReady;
  async function ensureTable() {
    if (!tableReady) {
      tableReady = tableClient.createTable().catch((error) => {
        tableReady = null;
        throw error;
      });
    }
    await tableReady;
  }

  return {
    async read(key) {
      await ensureTable();
      try {
        const entity = await tableClient.getEntity(TABLE_PARTITION_KEY, key);
        if (!entity.etag) throw new Error("Azure Table omitted the ETag for a call-limit row");
        return { version: entity.etag, state: JSON.parse(entity.stateJson) };
      } catch (error) {
        if (error.statusCode === 404) return null;
        throw error;
      }
    },
    async insert(key, state) {
      await ensureTable();
      try {
        await tableClient.createEntity({
          partitionKey: TABLE_PARTITION_KEY,
          rowKey: key,
          stateJson: JSON.stringify(state),
        });
        return true;
      } catch (error) {
        if (error.statusCode === 409) return false;
        throw error;
      }
    },
    async replace(key, version, state) {
      if (typeof version !== "string" || !version || version === "*") {
        throw new Error("An Azure Table ETag is required to update a call-limit row");
      }
      await ensureTable();
      try {
        await tableClient.updateEntity({
          partitionKey: TABLE_PARTITION_KEY,
          rowKey: key,
          stateJson: JSON.stringify(state),
        }, "Replace", { etag: version });
        return true;
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 412) return false;
        throw error;
      }
    },
  };
}

/** Local development store. Conditional SQL writes preserve the same atomic contract as Azure Table ETags. */
export function createSqliteCallLimitStore(path) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS call_limits (
      phone_key TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      state_json TEXT NOT NULL
    )
  `);

  const read = db.prepare("SELECT version, state_json FROM call_limits WHERE phone_key = ?");
  const insert = db.prepare("INSERT OR IGNORE INTO call_limits (phone_key, version, state_json) VALUES (?, 1, ?)");
  const replace = db.prepare("UPDATE call_limits SET version = version + 1, state_json = ? WHERE phone_key = ? AND version = ?");

  return {
    async read(key) {
      const row = read.get(key);
      return row ? { version: row.version, state: JSON.parse(row.state_json) } : null;
    },
    async insert(key, state) {
      return insert.run(key, JSON.stringify(state)).changes === 1;
    },
    async replace(key, version, state) {
      return replace.run(JSON.stringify(state), key, version).changes === 1;
    },
    close() { db.close(); },
  };
}

/** Reserve a phone number before asking Twilio to create the outbound call. */
export function createCallLimiter({ store, hashSecret, now = Date.now, fetchCallStatus }) {
  if (!store || !hashSecret) throw new Error("Call limiter store and hash secret are required");

  function phoneKey(phoneNumber) {
    if (!/^\+[1-9]\d{1,14}$/.test(phoneNumber)) throw new Error("Expected E.164 phone number");
    return createHmac("sha256", hashSecret).update(phoneNumber).digest("hex");
  }

  async function releaseKnownCall(key, reservationId, callSid) {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const row = await store.read(key);
      if (row?.state.active?.id !== reservationId || row.state.active.sid !== callSid) return false;
      if (await store.replace(key, row.version, { ...row.state, active: null })) return true;
    }
    throw new Error("Call limiter is too busy; try again shortly");
  }

  async function reserve(phoneNumber) {
    const key = phoneKey(phoneNumber);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const row = await store.read(key);
      const currentTime = now();
      const active = row?.state.active;
      if (active?.sid) {
        if (currentTime - (active.lastStatusCheckAt ?? active.reservedAt) < STATUS_CHECK_INTERVAL_MS) {
          return { allowed: false, reason: "active", retryAfterSeconds: 30 };
        }
        const claimed = {
          ...row.state,
          active: { ...active, lastStatusCheckAt: currentTime },
        };
        if (!await store.replace(key, row.version, claimed)) continue;
        let status;
        try {
          status = await fetchCallStatus(active.sid);
        } catch {
          return { allowed: false, reason: "active", retryAfterSeconds: 30 };
        }
        if (TERMINAL_CALL_STATUSES.has(status)) {
          await releaseKnownCall(key, active.id, active.sid);
          continue;
        }
        return { allowed: false, reason: "active", retryAfterSeconds: 30 };
      }
      if (active && currentTime - active.reservedAt < ORPHAN_RESERVATION_MS) {
        return { allowed: false, reason: "active", retryAfterSeconds: 30 };
      }

      const reservationId = randomUUID();
      const state = row?.state || { starts: [], active: null };
      const starts = state.starts.filter((start) => start.at > currentTime - HOUR_MS);
      if (starts.length >= MAX_STARTED_PER_HOUR) {
        return {
          allowed: false,
          reason: "hourly",
          retryAfterSeconds: Math.ceil((starts[0].at + HOUR_MS - currentTime) / 1000),
        };
      }
      // Count the reserved attempt now. If the Calls API later rejects it,
      // cancel removes this entry; an ambiguous accepted call still counts.
      const next = {
        ...state,
        starts: [...starts, { id: reservationId, at: currentTime }],
        active: { id: reservationId, reservedAt: currentTime },
      };
      const saved = row
        ? await store.replace(key, row.version, next)
        : await store.insert(key, next);
      if (saved) return { allowed: true, reservationId };
    }
    throw new Error("Call limiter is too busy; try again shortly");
  }

  async function cancel(phoneNumber, reservationId) {
    const key = phoneKey(phoneNumber);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const row = await store.read(key);
      if (!row) return false;
      const active = row.state.active;
      if (active?.id === reservationId && active.sid) return false;
      const activeMatches = active?.id === reservationId;
      const hasProvisional = row.state.starts.some((start) => start.id === reservationId && !start.sid);
      if (!activeMatches && !hasProvisional) return false;
      const starts = row.state.starts.filter((start) => start.id !== reservationId || start.sid);
      const next = { ...row.state, starts, active: activeMatches ? null : active };
      if (await store.replace(key, row.version, next)) return true;
    }
    throw new Error("Call limiter is too busy; try again shortly");
  }

  async function markStarted(phoneNumber, reservationId, callSid) {
    const key = phoneKey(phoneNumber);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const row = await store.read(key);
      if (!row || row.state.active?.id !== reservationId) {
        if (row?.state.starts.some((start) => start.id === reservationId && start.sid === callSid)) return false;
        throw new Error("Call reservation was lost after Twilio accepted the call");
      }
      const active = row.state.active;
      if (active.sid === callSid) return false;
      if (active.sid) throw new Error("Call reservation already belongs to another call");
      const provisional = row.state.starts.find((start) => start.id === reservationId);
      if (provisional?.sid && provisional.sid !== callSid) {
        throw new Error("Call reservation already belongs to another call");
      }
      const starts = provisional
        ? row.state.starts.map((start) => start.id === reservationId ? { ...start, sid: callSid } : start)
        : [...row.state.starts, { id: reservationId, sid: callSid, at: now() }];
      const next = {
        ...row.state,
        starts,
        active: { ...active, sid: callSid, lastStatusCheckAt: now() },
      };
      if (await store.replace(key, row.version, next)) return true;
    }
    throw new Error("Call limiter is too busy; try again shortly");
  }

  async function complete(phoneNumber, reservationId, callSid) {
    const key = phoneKey(phoneNumber);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const row = await store.read(key);
      if (!row) return false;
      const active = row.state.active;
      const activeMatches = active?.id === reservationId;
      const provisional = row.state.starts.find((start) => start.id === reservationId);
      if (!activeMatches && (!provisional || provisional.sid)) return false;
      if (activeMatches && active.sid && active.sid !== callSid) return false;
      if (provisional?.sid && provisional.sid !== callSid) return false;
      const next = {
        ...row.state,
        starts: provisional
          ? row.state.starts.map((start) => start.id === reservationId ? { ...start, sid: callSid } : start)
          : [...row.state.starts, { id: reservationId, sid: callSid, at: now() }],
        active: activeMatches ? null : active,
      };
      if (await store.replace(key, row.version, next)) return true;
    }
    throw new Error("Call limiter is too busy; try again shortly");
  }

  return { reserve, cancel, markStarted, complete };
}

let defaultLimiter;

/** Request-time singleton. Production must have shared Azure Table storage. */
export function getCallLimiter() {
  if (defaultLimiter) return defaultLimiter;

  const connectionString = process.env.CALL_LIMIT_AZURE_TABLE_CONNECTION_STRING;
  if (!connectionString && process.env.NODE_ENV === "production") {
    throw new Error("Durable Azure Table storage is not configured for call limits");
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("Twilio credentials are required for call limits");

  let store;
  if (connectionString) {
    const tableName = process.env.CALL_LIMIT_AZURE_TABLE_NAME || "CallLimits";
    const tableClient = TableClient.fromConnectionString(connectionString, tableName);
    store = createAzureCallLimitStore(tableClient);
  } else {
    const dbPath = process.env.CALL_LIMIT_SQLITE_PATH || join(process.cwd(), "data", "call-limits.db");
    mkdirSync(dirname(dbPath), { recursive: true });
    store = createSqliteCallLimitStore(dbPath);
  }

  const twilioClient = twilio(accountSid, authToken);
  defaultLimiter = createCallLimiter({
    store,
    hashSecret: process.env.CALL_LIMIT_HASH_SECRET || authToken,
    fetchCallStatus: async (sid) => (await twilioClient.calls(sid).fetch()).status,
  });
  return defaultLimiter;
}
