const MAX_EVENTS_PER_REQUEST = 100;
const MAX_BODY_BYTES = 32 * 1024;
const STORAGE_PREFIX = "workshop-analytics-event:";
const encoder = new TextEncoder();

/**
 * @typedef {{ id: string, type: string, payload: Record<string, unknown>, occurredAt: string }} QueuedEvent
 * @typedef {{ sessionId: string, event: QueuedEvent, queuedAt: number }} StoredEvent
 * @typedef {{ length: number, key(index: number): string | null, getItem(key: string): string | null, setItem(key: string, value: string): void, removeItem(key: string): void }} QueueStorage
 */

/**
 * Keep browser events until the API has acknowledged them. A beacon only
 * starts a best-effort send; it cannot prove that the server stored the data.
 *
 * @param {{
 *   sessionId: string,
 *   storage?: QueueStorage | null,
 *   send: (body: string) => Promise<{ status: number }>,
 *   beacon: (body: string) => boolean,
 *   newId: () => string,
 *   now?: () => Date,
 * }} options
 */
export function createAnalyticsQueue({ sessionId, storage, send, beacon, newId, now = () => new Date() }) {
  // One localStorage key per event lets tabs append and acknowledge without
  // rewriting each other's queues. Each record carries its original session
  // ID so a later visit can retry it after the originating tab has closed.
  /** @type {Map<string, StoredEvent>} */
  const unpersisted = new Map();
  const acknowledged = new Set();
  let lastQueuedAt = 0;
  /** @type {Promise<boolean> | null} */
  let inFlight = null;

  function readPending() {
    const found = new Map(unpersisted);
    try {
      if (storage) {
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          if (!key?.startsWith(STORAGE_PREFIX)) continue;
          const saved = storage.getItem(key);
          if (!saved) continue;
          let record;
          try {
            record = JSON.parse(saved);
          } catch {
            continue;
          }
          if (typeof record?.sessionId !== "string" ||
              !/^[A-Za-z0-9_-]{1,128}$/.test(record.sessionId) ||
              typeof record.queuedAt !== "number" ||
              !Number.isFinite(record.queuedAt) ||
              typeof record.event?.id !== "string" ||
              key !== `${STORAGE_PREFIX}${record.event.id}` ||
              typeof record.event.type !== "string" ||
              record.event.payload === null ||
              typeof record.event.payload !== "object" ||
              Array.isArray(record.event.payload) ||
              acknowledged.has(record.event.id)) continue;
          // Preserve records written by a prior queue version before event
          // timestamps were included in the HTTP body.
          if (typeof record.event.occurredAt !== "string") {
            record.event.occurredAt = new Date(record.queuedAt).toISOString();
          }
          found.set(record.event.id, record);
        }
      }
    } catch (error) {
      console.warn("[analytics] Could not read pending events", error);
    }
    return [...found.values()].sort((left, right) =>
      left.queuedAt - right.queuedAt || left.event.id.localeCompare(right.event.id));
  }

  /** @param {string} batchSessionId @param {QueuedEvent[]} events */
  function bodyFor(batchSessionId, events) {
    return JSON.stringify({ sessionId: batchSessionId, events });
  }

  /** @param {string} body */
  function fits(body) {
    return encoder.encode(body).byteLength <= MAX_BODY_BYTES;
  }

  /** @param {QueuedEvent} event */
  function fitConfigurationEvent(event) {
    if (event.type !== "agent_configured" || typeof event.payload.value !== "string") {
      return event;
    }
    const value = event.payload.value.slice(0, 8_192);
    const candidate = { ...event, payload: { ...event.payload, value } };
    if (fits(bodyFor(sessionId, [candidate]))) return candidate;

    // Escaped control characters can use six JSON bytes per character. Trim
    // only when needed so one valid configuration event never blocks the queue.
    let low = 0;
    let high = value.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      candidate.payload.value = value.slice(0, middle);
      if (fits(bodyFor(sessionId, [candidate]))) low = middle;
      else high = middle - 1;
    }
    candidate.payload.value = value.slice(0, low);
    return candidate;
  }

  /** @param {StoredEvent[]} pending */
  function nextBatch(pending) {
    const batchSessionId = pending[0]?.sessionId;
    /** @type {QueuedEvent[]} */
    const events = [];
    /** @type {StoredEvent[]} */
    const records = [];
    let body = "";
    for (const record of pending) {
      if (events.length === MAX_EVENTS_PER_REQUEST) break;
      if (record.sessionId !== batchSessionId) continue;
      const candidate = bodyFor(batchSessionId, [...events, record.event]);
      if (!fits(candidate)) break;
      events.push(record.event);
      records.push(record);
      body = candidate;
    }
    return records.length ? { records, body } : null;
  }

  /** @param {string} type @param {Record<string, unknown>} [payload] */
  function emit(type, payload = {}) {
    const emittedAt = now();
    const event = fitConfigurationEvent({
      id: newId(), type, payload, occurredAt: emittedAt.toISOString(),
    });
    lastQueuedAt = Math.max(emittedAt.getTime(), lastQueuedAt + 1);
    const record = { sessionId, event, queuedAt: lastQueuedAt };
    let saved = false;
    try {
      if (storage) {
        storage.setItem(`${STORAGE_PREFIX}${event.id}`, JSON.stringify(record));
        saved = true;
      }
    } catch (error) {
      console.warn("[analytics] Could not persist pending event", error);
    }
    if (!saved) unpersisted.set(event.id, record);
  }

  function flush() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      while (true) {
        const pending = readPending();
        if (pending.length === 0) return true;
        const batch = nextBatch(pending);
        if (!batch) {
          console.error("[analytics] An event exceeds the request body limit");
          return false;
        }
        let response;
        try {
          response = await send(batch.body);
        } catch {
          return false;
        }
        // This endpoint's only success response is 204. A 200 from a proxy
        // or redirected page does not prove the events were stored.
        if (response.status !== 204) return false;

        // A different tab may have appended events during the request.
        // Remove only the acknowledged IDs, then rescan shared storage.
        for (const record of batch.records) {
          acknowledged.add(record.event.id);
          unpersisted.delete(record.event.id);
          try {
            storage?.removeItem(`${STORAGE_PREFIX}${record.event.id}`);
          } catch (error) {
            console.warn("[analytics] Could not clear acknowledged event", error);
          }
        }
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  function beaconOnPagehide() {
    const batch = nextBatch(readPending());
    try {
      return batch ? beacon(batch.body) : false;
    } catch {
      return false;
    }
  }

  return { emit, flush, beaconOnPagehide };
}
