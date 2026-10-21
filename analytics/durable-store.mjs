import { randomUUID } from "node:crypto";

const CONTROL_PARTITION = "_meta";
const CONTROL_ROW = "active";

function isStatus(error, status) {
  return error && typeof error === "object" && error.statusCode === status;
}

function decodeEvent(entity) {
  if (typeof entity.rowKey !== "string" ||
      typeof entity.sessionId !== "string" ||
      typeof entity.eventType !== "string" ||
      typeof entity.createdAt !== "string") {
    throw new Error("Azure Table returned an invalid analytics event");
  }
  const event = {
    id: entity.rowKey,
    sessionId: entity.sessionId,
    eventType: entity.eventType,
    payloadJson: entity.payloadJson || null,
    createdAt: entity.createdAt,
  };
  if (typeof entity.occurredAt === "string") event.occurredAt = entity.occurredAt;
  if (Number.isInteger(entity.legacyOrder) && entity.legacyOrder > 0) {
    event.legacyOrder = entity.legacyOrder;
  }
  return event;
}

/** Azure Table is the source of truth; SQLite is rebuilt from its active generation. */
export function createAzureAnalyticsStore(tableClient, { idFactory = randomUUID } = {}) {
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

  async function getGeneration() {
    await ensureTable();
    let entity;
    try {
      entity = await tableClient.getEntity(CONTROL_PARTITION, CONTROL_ROW);
    } catch (error) {
      if (!isStatus(error, 404)) throw error;
      try {
        await tableClient.createEntity({
          partitionKey: CONTROL_PARTITION,
          rowKey: CONTROL_ROW,
          generationId: idFactory(),
        });
      } catch (createError) {
        if (!isStatus(createError, 409)) throw createError;
      }
      entity = await tableClient.getEntity(CONTROL_PARTITION, CONTROL_ROW);
    }
    if (typeof entity.generationId !== "string" || !entity.generationId ||
        typeof entity.etag !== "string" || !entity.etag || entity.etag === "*") {
      throw new Error("Azure Table returned an invalid analytics generation marker");
    }
    return { id: entity.generationId, version: entity.etag };
  }

  return {
    getGeneration,
    async writeEvent(generationId, event) {
      await ensureTable();
      const entity = {
        partitionKey: generationId,
        rowKey: event.id,
        sessionId: event.sessionId,
        eventType: event.eventType,
        payloadJson: event.payloadJson ?? "",
        createdAt: event.createdAt,
      };
      if (Number.isInteger(event.legacyOrder) && event.legacyOrder > 0) {
        entity.legacyOrder = event.legacyOrder;
      }
      if (typeof event.occurredAt === "string") entity.occurredAt = event.occurredAt;
      try {
        await tableClient.createEntity(entity);
        return { inserted: true, event };
      } catch (error) {
        if (!isStatus(error, 409)) throw error;
        const existing = decodeEvent(await tableClient.getEntity(generationId, event.id));
        if (existing.sessionId !== event.sessionId ||
            existing.eventType !== event.eventType ||
            existing.payloadJson !== event.payloadJson ||
            (existing.legacyOrder ?? null) !== (event.legacyOrder ?? null)) {
          throw new Error("Analytics event ID was reused for different content");
        }
        return { inserted: false, event: existing };
      }
    },
    async listEvents(generationId) {
      await ensureTable();
      const filter = `PartitionKey eq '${generationId.replaceAll("'", "''")}'`;
      const events = [];
      for await (const entity of tableClient.listEntities({ queryOptions: { filter } })) {
        events.push(decodeEvent(entity));
      }
      return events;
    },
    async rotateGeneration(expectedVersion) {
      await ensureTable();
      if (typeof expectedVersion !== "string" || !expectedVersion || expectedVersion === "*") {
        throw new Error("An Azure Table ETag is required to reset analytics");
      }
      const nextId = idFactory();
      let response;
      try {
        response = await tableClient.updateEntity({
          partitionKey: CONTROL_PARTITION,
          rowKey: CONTROL_ROW,
          generationId: nextId,
        }, "Replace", { etag: expectedVersion });
      } catch (error) {
        // Azure may commit the update and lose the response. Read back the
        // marker before treating that ambiguous outcome as a failed reset.
        try {
          const active = await getGeneration();
          if (active.id === nextId) return active;
        } catch { /* Preserve the original update error below. */ }
        if (isStatus(error, 404) || isStatus(error, 412)) return null;
        throw error;
      }
      if (typeof response?.etag === "string" && response.etag && response.etag !== "*") {
        return { id: nextId, version: response.etag };
      }
      return getGeneration();
    },
  };
}
