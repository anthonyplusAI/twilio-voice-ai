import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAzureCallLimitStore,
  createCallLimiter,
  createSqliteCallLimitStore,
} from "../src/lib/call-limiter.mjs";

const PHONE = "+12065550101";

function fixture({ fetchCallStatus = async () => "in-progress" } = {}) {
  let time = Date.UTC(2026, 9, 20, 12);
  const store = createSqliteCallLimitStore(":memory:");
  const limiter = createCallLimiter({
    store,
    hashSecret: "test-only-secret",
    now: () => time,
    fetchCallStatus,
  });
  return {
    limiter,
    advance(ms) { time += ms; },
    close() { store.close(); },
  };
}

test("a pending reservation blocks another call to the same number", async () => {
  const { limiter, close } = fixture();
  try {
    const first = await limiter.reserve(PHONE);
    assert.equal(first.allowed, true);

    const second = await limiter.reserve(PHONE);
    assert.equal(second.allowed, false);
    assert.equal(second.reason, "active");
  } finally {
    close();
  }
});

test("a failed Twilio creation releases its reservation without using hourly capacity", async () => {
  const { limiter, close } = fixture();
  try {
    for (let i = 0; i < 11; i++) {
      const attempt = await limiter.reserve(PHONE);
      assert.equal(attempt.allowed, true);
      await limiter.cancel(PHONE, attempt.reservationId);
    }
  } finally {
    close();
  }
});

test("ten started calls fit in a rolling hour and the eleventh waits for the oldest to expire", async () => {
  const { limiter, advance, close } = fixture();
  try {
    for (let i = 0; i < 10; i++) {
      const attempt = await limiter.reserve(PHONE);
      assert.equal(attempt.allowed, true);
      const sid = `CA${String(i).padStart(32, "0")}`;
      await limiter.markStarted(PHONE, attempt.reservationId, sid);
      await limiter.complete(PHONE, attempt.reservationId, sid);
      advance(5 * 60 * 1000);
    }

    const blocked = await limiter.reserve(PHONE);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reason, "hourly");
    assert.equal(blocked.retryAfterSeconds, 600);

    advance(10 * 60 * 1000);
    assert.equal((await limiter.reserve(PHONE)).allowed, true);
  } finally {
    close();
  }
});

test("a terminal callback before the Calls API response does not reactivate the finished call", async () => {
  const { limiter, close } = fixture();
  try {
    const first = await limiter.reserve(PHONE);
    assert.equal(first.allowed, true);
    const sid = `CA${"1".repeat(32)}`;

    assert.equal(await limiter.complete(PHONE, first.reservationId, sid), true);
    await limiter.markStarted(PHONE, first.reservationId, sid);

    const next = await limiter.reserve(PHONE);
    assert.equal(next.allowed, true);
    assert.equal(await limiter.complete(PHONE, first.reservationId, sid), false);
    assert.equal((await limiter.reserve(PHONE)).reason, "active");
  } finally {
    close();
  }
});

test("terminal callbacks count started calls even when the application never marks them started", async () => {
  const { limiter, close } = fixture();
  try {
    for (let i = 0; i < 10; i++) {
      const attempt = await limiter.reserve(PHONE);
      assert.equal(attempt.allowed, true);
      const sid = `CA${String(i).padStart(32, "0")}`;
      assert.equal(await limiter.complete(PHONE, attempt.reservationId, sid), true);
    }
    assert.equal((await limiter.reserve(PHONE)).reason, "hourly");
  } finally {
    close();
  }
});

test("an orphan reservation expires but its late callback cannot release a newer call", async () => {
  const { limiter, advance, close } = fixture();
  try {
    const orphan = await limiter.reserve(PHONE);
    assert.equal(orphan.allowed, true);
    advance(10 * 60 * 1000 - 1);
    assert.equal((await limiter.reserve(PHONE)).reason, "active");

    advance(1);
    const next = await limiter.reserve(PHONE);
    assert.equal(next.allowed, true);
    assert.equal(await limiter.complete(PHONE, orphan.reservationId, `CA${"2".repeat(32)}`), true);
    assert.equal((await limiter.reserve(PHONE)).reason, "active");
  } finally {
    close();
  }
});

test("a stale active call is reconciled from Twilio status when its callback is missing", async () => {
  let status = "in-progress";
  let checks = 0;
  const { limiter, advance, close } = fixture({
    fetchCallStatus: async () => {
      checks++;
      return status;
    },
  });
  try {
    const first = await limiter.reserve(PHONE);
    const sid = `CA${"3".repeat(32)}`;
    await limiter.markStarted(PHONE, first.reservationId, sid);

    advance(15_000);
    assert.equal((await limiter.reserve(PHONE)).reason, "active");
    assert.equal(checks, 1);

    status = "completed";
    assert.equal((await limiter.reserve(PHONE)).reason, "active");
    assert.equal(checks, 1);

    advance(15_000);
    assert.equal((await limiter.reserve(PHONE)).allowed, true);
    assert.equal(checks, 2);
  } finally {
    close();
  }
});

test("an accepted call still consumes hourly capacity if recording its SID fails", async () => {
  let time = Date.UTC(2026, 9, 20, 12);
  let storageUnavailable = false;
  const db = createSqliteCallLimitStore(":memory:");
  const limiter = createCallLimiter({
    store: {
      ...db,
      async replace(...args) {
        if (storageUnavailable) throw new Error("storage unavailable");
        return db.replace(...args);
      },
    },
    hashSecret: "test-only-secret",
    now: () => time,
    fetchCallStatus: async () => "in-progress",
  });
  try {
    const accepted = await limiter.reserve(PHONE);
    storageUnavailable = true;
    await assert.rejects(
      limiter.markStarted(PHONE, accepted.reservationId, `CA${"4".repeat(32)}`),
      /storage unavailable/
    );
    storageUnavailable = false;
    time += 10 * 60 * 1000;

    for (let i = 0; i < 9; i++) {
      const attempt = await limiter.reserve(PHONE);
      assert.equal(attempt.allowed, true);
      const sid = `CA${String(i).padStart(32, "0")}`;
      await limiter.markStarted(PHONE, attempt.reservationId, sid);
      await limiter.complete(PHONE, attempt.reservationId, sid);
    }
    assert.equal((await limiter.reserve(PHONE)).reason, "hourly");
  } finally {
    db.close();
  }
});

test("a known rejected request can release an expired provisional count without touching a newer call", async () => {
  const { limiter, advance, close } = fixture();
  try {
    const rejected = await limiter.reserve(PHONE);
    advance(10 * 60 * 1000);
    const newer = await limiter.reserve(PHONE);
    assert.equal(newer.allowed, true);

    assert.equal(await limiter.cancel(PHONE, rejected.reservationId), true);
    assert.equal((await limiter.reserve(PHONE)).reason, "active");
    assert.equal(await limiter.cancel(PHONE, newer.reservationId), true);

    for (let i = 0; i < 10; i++) {
      const attempt = await limiter.reserve(PHONE);
      assert.equal(attempt.allowed, true);
      const sid = `CA${String(i).padStart(32, "0")}`;
      await limiter.markStarted(PHONE, attempt.reservationId, sid);
      await limiter.complete(PHONE, attempt.reservationId, sid);
    }
    assert.equal((await limiter.reserve(PHONE)).reason, "hourly");
  } finally {
    close();
  }
});

test("Azure Table ETags admit only one concurrent reservation and never store the phone number", async () => {
  let entity = null;
  let version = 0;
  const table = {
    async createTable() {},
    async getEntity(partitionKey, rowKey) {
      if (!entity || entity.partitionKey !== partitionKey || entity.rowKey !== rowKey) {
        throw Object.assign(new Error("not found"), { statusCode: 404 });
      }
      return structuredClone(entity);
    },
    async createEntity(next) {
      if (entity) throw Object.assign(new Error("already exists"), { statusCode: 409 });
      entity = { ...structuredClone(next), etag: `v${++version}` };
    },
    async updateEntity(next, mode, options) {
      if (mode !== "Replace" || options.etag !== entity.etag) {
        throw Object.assign(new Error("ETag changed"), { statusCode: 412 });
      }
      entity = { ...structuredClone(next), etag: `v${++version}` };
    },
  };
  const makeLimiter = () => createCallLimiter({
    store: createAzureCallLimitStore(table),
    hashSecret: "test-only-secret",
    now: () => Date.UTC(2026, 9, 20, 12),
    fetchCallStatus: async () => "in-progress",
  });
  const first = makeLimiter();
  const second = makeLimiter();
  const initial = await first.reserve(PHONE);
  await first.cancel(PHONE, initial.reservationId);

  const attempts = await Promise.all([first.reserve(PHONE), second.reserve(PHONE)]);
  assert.equal(attempts.filter((attempt) => attempt.allowed).length, 1);
  assert.equal(attempts.filter((attempt) => attempt.reason === "active").length, 1);
  assert.match(entity.rowKey, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(entity), /12065550101/);
});

test("production refuses calls when durable Azure Table storage is not configured", () => {
  const env = { ...process.env, NODE_ENV: "production", TWILIO_AUTH_TOKEN: "test-token" };
  delete env.CALL_LIMIT_AZURE_TABLE_CONNECTION_STRING;
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    "import { getCallLimiter } from './src/lib/call-limiter.mjs'; getCallLimiter();",
  ], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /durable Azure Table storage is not configured/i);
});
