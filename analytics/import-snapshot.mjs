import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { recordEvent, syncFromDurableStore } from "./db.mjs";

/** Replay a consistent legacy SQLite snapshot into the active durable generation. */
export async function importLegacySnapshot(snapshotPath, { sourceId = basename(snapshotPath), repository } = {}) {
  if (typeof sourceId !== "string" || !sourceId) throw new Error("A stable snapshot source ID is required");
  if (!repository && !process.env.CALL_LIMIT_AZURE_TABLE_CONNECTION_STRING) {
    throw new Error("Azure Table storage must be configured before importing a snapshot");
  }
  const destination = repository ?? { recordEvent, syncFromDurableStore };
  const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  let rows;
  try {
    rows = snapshot.prepare(`
      SELECT id, session_id, event_type, payload, created_at
      FROM events ORDER BY id
    `).all();
  } finally {
    snapshot.close();
  }

  let imported = 0;
  let skipped = 0;
  // Bound Azure requests so a large legacy snapshot finishes promptly without
  // flooding the single Table partition used by one workshop generation.
  for (let offset = 0; offset < rows.length; offset += 8) {
    const batch = rows.slice(offset, offset + 8).map((row) => {
      const eventId = createHash("sha256")
        .update(sourceId).update("\0").update(String(row.id)).digest("hex");
      const payload = row.payload === null ? undefined : JSON.parse(row.payload);
      return [row.session_id, row.event_type, payload, eventId, row.created_at, row.id];
    });
    const results = await Promise.allSettled(batch.map((args) => destination.recordEvent(...args)));
    let firstError;
    for (const result of results) {
      if (result.status === "rejected") firstError ??= result.reason;
      else if (result.value.inserted) imported++;
      else skipped++;
    }
    if (firstError) throw firstError;
  }
  await destination.syncFromDurableStore();
  return { total: rows.length, imported, skipped };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [snapshotPath, flag, sourceId, extra] = process.argv.slice(2);
  if (!snapshotPath || extra || (flag && (flag !== "--source" || !sourceId))) {
    console.error("Usage: node analytics/import-snapshot.mjs <snapshot.db> [--source <stable-source-id>]");
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(await importLegacySnapshot(snapshotPath, { sourceId: sourceId || basename(snapshotPath) })));
    } catch (error) {
      console.error(`Snapshot import failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
